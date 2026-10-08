import { offlineGenerationFailureCode, offlineFailureNeedsRebuild } from "./offline-download-errors";
export { offlineDownloadFailureMessage } from "./offline-download-errors";
import { ApiRequestError, cancelTask, getOfflineCatalog, getTask, queueOfflinePackage } from "./api";
import { liveQuery } from "dexie";
import { assertOfflineAccess, captureOfflineAccess, notifyAuthenticationFailure, authenticationGeneration } from "./offline-access";
import { importOfflinePackage, inspectOfflineCopyAssets, offlineDb, OfflinePackageImportError } from "./offline-db";

export type OfflineAssetMode = "none" | "small" | "all";
export type OfflineDownload = {
  id: string; scope: "conversation" | "project" | "all"; scopeId?: string; label: string; assetMode: OfflineAssetMode;
  state: "queued" | "generating" | "downloading" | "writing" | "completed" | "failed" | "cancelled";
  progress: number; jobId: string | null; packageId: string | null; idempotencyKey: string;
  knownRevisions: Record<string, number>; cancelRequested: boolean; error: string | null;
  createdAt: string; updatedAt: string;
  admissionStarted?: boolean;
  attemptRevision?: number;
  serverCancellation?: "pending" | "failed";
};
export const OFFLINE_DOWNLOAD_CHANGED_EVENT = "chat-reader:offline-downloads";
const PREFIX = "offline-download:";
const CANCELLATION_PREFIX = "offline-cancellation:";
type PendingCancellation = { download: OfflineDownload; attempts: number; retryAt: number };
const ACTIVE = new Set(["queued", "generating", "downloading", "writing"]);
const controllers = new Map<string, AbortController>();

export async function listOfflineDownloads(db = offlineDb): Promise<OfflineDownload[]> {
  return (await db.settings.where("key").startsWith(PREFIX).toArray()).map((row) => row.value as OfflineDownload)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function usableOfflineRevisions(mode: OfflineAssetMode): Promise<Record<string, number>> {
  const access = captureOfflineAccess(), db = offlineDb;
  const revisions: Record<string, number> = {};
  for (const local of await db.conversations.toArray()) {
    const assets = await inspectOfflineCopyAssets(local.id, mode);
    if (assets.metadataKnown && !assets.missing) revisions[local.id] = local.offline_revision;
  }
  assertOfflineAccess(access);
  return revisions;
}

export async function enqueueOfflineDownload(input: { scope: OfflineDownload["scope"]; scopeId?: string; assetMode: OfflineAssetMode }): Promise<OfflineDownload> {
  const access = captureOfflineAccess(), db = offlineDb;
  const catalog = await getOfflineCatalog();
  const knownRevisions = await usableOfflineRevisions(input.assetMode);
  assertOfflineAccess(access);
  const label = input.scope === "conversation" ? catalog.conversations.find((item) => item.id === input.scopeId)?.display_title
    : input.scope === "project" ? catalog.projects.find((item) => item.id === input.scopeId)?.name : "";
  const result = await db.transaction("rw", db.settings, async () => {
    const existing = (await listOfflineDownloads(db)).find((item) => (ACTIVE.has(item.state) || item.state === "failed" && ["NETWORK", "DOWNLOAD"].includes(item.error ?? "")) && !item.cancelRequested && item.scope === input.scope && item.scopeId === input.scopeId && item.assetMode === input.assetMode);
    if (existing) {
      if (existing.state === "failed") { existing.state = "queued"; existing.error = null; existing.attemptRevision = (existing.attemptRevision ?? 0) + 1; await db.settings.put({ key: PREFIX + existing.id, value: existing }); }
      return existing;
    }
    const now = new Date().toISOString();
    const record: OfflineDownload = { ...input, label: label ?? "", id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      state: "queued", progress: 0, jobId: null, packageId: null, knownRevisions, cancelRequested: false, error: null, createdAt: now, updatedAt: now };
    await db.settings.put({ key: PREFIX + record.id, value: record });
    return record;
  });
  changed();
  return result;
}

export async function cancelOfflineDownload(id: string): Promise<void> {
  const db = offlineDb;
  await db.transaction("rw", db.settings, async () => {
    const record = (await db.settings.get(PREFIX + id))?.value as OfflineDownload | undefined;
    if (record && ACTIVE.has(record.state)) await patch(db, id, { cancelRequested: true });
  });
  controllers.get(id)?.abort();
  changed();
}

export async function retryOfflineDownload(id: string): Promise<void> {
  const db = offlineDb, record = (await db.settings.get(PREFIX + id))?.value as OfflineDownload | undefined;
  if (!record || !["failed", "cancelled"].includes(record.state)) return;
  const rebuild = record.state === "cancelled" || offlineFailureNeedsRebuild(record.error);
  const knownRevisions = rebuild ? await usableOfflineRevisions(record.assetMode) : record.knownRevisions;
  await db.transaction("rw", db.settings, async () => {
    const current = (await db.settings.get(PREFIX + id))?.value as OfflineDownload | undefined;
    if (!current || !["failed", "cancelled"].includes(current.state) || current.idempotencyKey !== record.idempotencyKey || (current.attemptRevision ?? 0) !== (record.attemptRevision ?? 0)) return;
    await patch(db, id, { state: "queued", progress: 0, error: null, cancelRequested: false, attemptRevision: (current.attemptRevision ?? 0) + 1,
      ...(rebuild ? { jobId: null, packageId: null, admissionStarted: false, idempotencyKey: crypto.randomUUID(), knownRevisions } : {}) });
  });
  changed();
}

/** One browser writer per account. The API uses the existing single worker. */
export async function resumeOfflineDownloads(signal: AbortSignal): Promise<void> {
  const access = captureOfflineAccess(), db = offlineDb;
  const work = async () => {
    assertOfflineAccess(access);
    signal.throwIfAborted();
    const records = await listOfflineDownloads(db);
    // Cancellation must not wait for a connection or another queued download.
    const record = records.find((item) => ACTIVE.has(item.state) && item.cancelRequested)
      ?? (navigator.onLine ? records.reverse().find((item) => ACTIVE.has(item.state)) : undefined);
    if (record) await runDownload(db, record, access, signal);
  };
  if (navigator.locks) await navigator.locks.request(`chat-reader:downloads:${db.name}`, { ifAvailable: true }, async (lock) => { if (lock) await work(); });
  else await work();
}

/** Remote acknowledgements cannot delay local cancellation or cleanup. */
export async function resumeOfflineServerCancellations(signal: AbortSignal): Promise<void> {
  if (!navigator.onLine || signal.aborted) return;
  const access = captureOfflineAccess(), db = offlineDb;
  const cancel = () => resumeServerCancellation(db, access, signal);
  if (navigator.locks) await navigator.locks.request(`chat-reader:download-cancellations:${db.name}`, { ifAvailable: true }, async lock => { if (lock) await cancel(); });
  else await cancel();
}

export async function retryOfflineCancellation(id: string): Promise<void> {
  const db = offlineDb;
  await db.transaction("rw", db.settings, async () => {
    const record = (await db.settings.get(PREFIX + id))?.value as OfflineDownload | undefined;
    if (!record) return;
    const rows = await db.settings.where("key").startsWith(CANCELLATION_PREFIX).filter(row => (row.value as PendingCancellation).download.id === id).toArray();
    if (!rows.length) return;
    await db.settings.bulkPut(rows.map(row => ({ key: row.key, value: { ...(row.value as PendingCancellation), attempts: 0, retryAt: 0 } })));
    await patch(db, id, { serverCancellation: "pending" });
  });
}

async function runDownload(db: typeof offlineDb, initial: OfflineDownload, access: number, parentSignal: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, parentSignal]);
  controllers.set(initial.id, controller);
  const cancellation = liveQuery(() => db.settings.get(PREFIX + initial.id)).subscribe({ next: (row) => {
    if ((row?.value as OfflineDownload | undefined)?.cancelRequested) controller.abort();
  }, error: () => controller.abort() });
  let record = initial;
  const check = async () => {
    assertOfflineAccess(access);
    record = (await db.settings.get(PREFIX + record.id))?.value as OfflineDownload;
    if (record.cancelRequested) controller.abort();
    signal.throwIfAborted();
  };
  try {
    await check();
    if (record.packageId && await db.packages.get(record.packageId)) {
      await patch(db, record.id, { state: "completed", progress: 100 });
      return;
    }
    if (!record.jobId) {
      record = await patch(db, record.id, { admissionStarted: true });
      const queued = await queueOfflinePackage(packageInput(record), record.idempotencyKey, requestSignal(signal));
      assertOfflineAccess(access);
      record = await patch(db, record.id, { jobId: queued.job_id, packageId: queued.package_id, state: "generating", progress: 1 });
    }
    while (true) {
      await check();
      const task = await getTask(record.jobId!, requestSignal(signal));
      await check();
      if (task.status === "cancelled") { await patch(db, record.id, { state: "cancelled" }); return; }
      if (task.status === "failed") throw new DownloadFailure(offlineGenerationFailureCode(task.error_message));
      if (task.status === "committed") {
        const packageId = String(task.result.package_id ?? record.packageId);
        await patch(db, record.id, { packageId, state: "downloading", progress: 90 });
        const generation = authenticationGeneration();
        const response = await fetch(`/api/offline/packages/${encodeURIComponent(packageId)}/download`, { credentials: "same-origin", cache: "no-store", signal });
        if (response.status === 401) notifyAuthenticationFailure(generation);
        if (response.status === 404) throw new DownloadFailure("GONE");
        if (!response.ok) throw new DownloadFailure("NETWORK");
        await check();
        await importOfflinePackage(packageId, response, { signal, onWriting: () => { void patch(db, record.id, { state: "writing", progress: 95 }).catch(() => undefined); } });
        // A committed package wins a cancellation arriving after its commit.
        await patch(db, record.id, { state: "completed", progress: 100, error: null });
        return;
      }
      await patch(db, record.id, { state: "generating", progress: Math.min(89, Math.max(1, task.progress * 0.89)) });
      await pause(signal);
    }
  } catch (error) {
    assertOfflineAccess(access);
    record = (await db.settings.get(PREFIX + record.id))?.value as OfflineDownload;
    if (record.packageId && await db.packages.get(record.packageId)) await patch(db, record.id, { state: "completed", progress: 100, error: null });
    else if (record.cancelRequested) {
      // We still hold the browser writer lock: no import can publish after
      // this terminal state. Keep remote intent separate so a user retry cannot
      // erase an older job's cancellation, including a lost admission receipt.
      await db.transaction("rw", db.settings, async () => {
        const remote = Boolean(record.jobId || record.admissionStarted);
        if (remote) await db.settings.put({ key: CANCELLATION_PREFIX + record.idempotencyKey, value: { download: record, attempts: 0, retryAt: 0 } satisfies PendingCancellation });
        await patch(db, record.id, { state: "cancelled", error: null,
          serverCancellation: record.serverCancellation === "failed" ? "failed" : remote ? "pending" : record.serverCancellation });
      });
    } else if (parentSignal.aborted) {
      return; // Navigation/network loss retains resumable state.
    } else {
      const code = error instanceof DownloadFailure ? error.code : error instanceof OfflinePackageImportError ? error.code : error instanceof ApiRequestError && error.status === 404 ? "GONE" : "NETWORK";
      await patch(db, record.id, { state: "failed", error: code });
    }
  } finally { cancellation.unsubscribe(); controllers.delete(initial.id); changed(); }
}

function packageInput(record: OfflineDownload) {
  return { scope: record.scope, conversation_id: record.scope === "conversation" ? record.scopeId : undefined,
    project_id: record.scope === "project" ? record.scopeId : undefined, include_assets: record.assetMode, known_revisions: record.knownRevisions };
}

function requestSignal(signal: AbortSignal) { return AbortSignal.any([signal, AbortSignal.timeout(15_000)]); }

async function resumeServerCancellation(db: typeof offlineDb, access: number, signal: AbortSignal) {
  const row = await db.settings.where("key").startsWith(CANCELLATION_PREFIX)
    .filter((item) => { const value = item.value as PendingCancellation; return value.attempts < 5 && value.retryAt <= Date.now(); }).first();
  if (!row) return;
  const pending = row.value as PendingCancellation;
  try {
    assertOfflineAccess(access);
    // Reuse the original admission key, never the key of a later retry.
    if (!pending.download.jobId) {
      const queued = await queueOfflinePackage(packageInput(pending.download), pending.download.idempotencyKey, requestSignal(signal));
      assertOfflineAccess(access);
      pending.download.jobId = queued.job_id;
      await db.settings.put({ key: row.key, value: pending });
    }
    await cancelTask(pending.download.jobId, requestSignal(signal));
    assertOfflineAccess(access);
    await acknowledge();
  } catch (error) {
    assertOfflineAccess(access);
    if (signal.aborted) return;
    if (error instanceof ApiRequestError && error.status === 404) { await acknowledge(); return; }
    if (error instanceof ApiRequestError && error.status === 409 && pending.download.jobId) {
      // A job may have finished before the cancellation arrived. Only a fresh
      // terminal read confirms there is no server work left to stop; a generic
      // conflict or failed lookup must retain the cancellation intent.
      try {
        const task = await getTask(pending.download.jobId, requestSignal(signal));
        assertOfflineAccess(access);
        if (["committed", "failed", "cancelled"].includes(task.status)) { await acknowledge(); return; }
      } catch {
        assertOfflineAccess(access);
        if (signal.aborted) return;
      }
    }
    pending.attempts += 1;
    pending.retryAt = Date.now() + Math.min(60_000, 2_000 * 2 ** (pending.attempts - 1));
    await db.transaction("rw", db.settings, async () => {
      await db.settings.put({ key: row.key, value: pending });
      await updateDownload();
    });
  }
  async function updateDownload() {
    const latest = (await db.settings.get(PREFIX + pending.download.id))?.value as OfflineDownload | undefined;
    if (!latest) return;
    // A retry keeps the same local row but has a new admission key. Reflect
    // remaining old cancellation intents without altering the new attempt.
    const remaining = await db.settings.where("key").startsWith(CANCELLATION_PREFIX)
      .filter(row => (row.value as PendingCancellation).download.id === latest.id).toArray();
    const serverCancellation = remaining.some(row => (row.value as PendingCancellation).attempts >= 5) ? "failed" : remaining.length ? "pending" : undefined;
    await patch(db, latest.id, { serverCancellation });
  }
  async function acknowledge() {
    await db.transaction("rw", db.settings, async () => { await db.settings.delete(row!.key); await updateDownload(); });
  }
}


async function patch(db: typeof offlineDb, id: string, changes: Partial<OfflineDownload>): Promise<OfflineDownload> {
  return db.transaction("rw", db.settings, async () => {
    const old = (await db.settings.get(PREFIX + id))?.value as OfflineDownload;
    if (!old) throw new Error("Download record unavailable.");
    const record = { ...old, ...changes, updatedAt: new Date().toISOString() };
    await db.settings.put({ key: PREFIX + id, value: record });
    changed();
    return record;
  });
}
function changed() { window.dispatchEvent(new Event(OFFLINE_DOWNLOAD_CHANGED_EVENT)); }
function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Paused", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
class DownloadFailure extends Error { constructor(readonly code: string) { super(code); } }
