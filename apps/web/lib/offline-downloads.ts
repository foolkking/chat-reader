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
};
export const OFFLINE_DOWNLOAD_CHANGED_EVENT = "chat-reader:offline-downloads";
const PREFIX = "offline-download:";
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
      if (existing.state === "failed") { existing.state = "queued"; existing.error = null; await db.settings.put({ key: PREFIX + existing.id, value: existing }); }
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
  await patch(db, id, { cancelRequested: true });
  controllers.get(id)?.abort();
  changed();
}

export async function retryOfflineDownload(id: string): Promise<void> {
  const db = offlineDb, record = (await db.settings.get(PREFIX + id))?.value as OfflineDownload | undefined;
  if (!record || ACTIVE.has(record.state)) return;
  const rebuild = record.state === "cancelled" || record.error === "GONE" || record.error === "GENERATION";
  await patch(db, id, { state: "queued", progress: 0, error: null, cancelRequested: false,
    ...(rebuild ? { jobId: null, packageId: null, idempotencyKey: crypto.randomUUID(), knownRevisions: await usableOfflineRevisions(record.assetMode) } : {}) });
  changed();
}

/** One browser writer per account. The API uses the existing single worker. */
export async function resumeOfflineDownloads(signal: AbortSignal): Promise<void> {
  const access = captureOfflineAccess(), db = offlineDb;
  const work = async () => {
    assertOfflineAccess(access);
    signal.throwIfAborted();
    const records = await listOfflineDownloads(db);
    const record = records.reverse().find((item) => ACTIVE.has(item.state));
    if (record) await runDownload(db, record, access, signal);
  };
  if (navigator.locks) await navigator.locks.request(`chat-reader:downloads:${db.name}`, { ifAvailable: true }, async (lock) => { if (lock) await work(); });
  else await work();
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
      const queued = await queueOfflinePackage({ scope: record.scope, conversation_id: record.scope === "conversation" ? record.scopeId : undefined,
        project_id: record.scope === "project" ? record.scopeId : undefined, include_assets: record.assetMode, known_revisions: record.knownRevisions }, record.idempotencyKey);
      assertOfflineAccess(access);
      record = await patch(db, record.id, { jobId: queued.job_id, packageId: queued.package_id, state: "generating", progress: 1 });
    }
    while (true) {
      await check();
      const task = await getTask(record.jobId!);
      await check();
      if (task.status === "cancelled") { await patch(db, record.id, { state: "cancelled" }); return; }
      if (task.status === "failed") throw new DownloadFailure("GENERATION");
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
    if (parentSignal.aborted) return; // Navigation/network loss retains resumable state.
    assertOfflineAccess(access);
    record = (await db.settings.get(PREFIX + record.id))?.value as OfflineDownload;
    if (record.packageId && await db.packages.get(record.packageId)) await patch(db, record.id, { state: "completed", progress: 100, error: null });
    else if (record.cancelRequested) {
      if (record.jobId) await cancelTask(record.jobId).catch(() => undefined);
      await patch(db, record.id, { state: "cancelled", error: null });
    } else {
      const code = error instanceof DownloadFailure ? error.code : error instanceof OfflinePackageImportError ? error.code : error instanceof ApiRequestError && error.status === 404 ? "GONE" : "NETWORK";
      await patch(db, record.id, { state: "failed", error: code });
    }
  } finally { cancellation.unsubscribe(); controllers.delete(initial.id); changed(); }
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
