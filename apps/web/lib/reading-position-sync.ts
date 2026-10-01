import { ApiRequestError, getReadingPosition, syncReadingPosition } from "./api";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import { offlineDb, type OfflineOutboxRecord } from "./offline-db";
import type { ReadingPositionInput, ReadingPositionRead, ReadingPositionResponse } from "./types";

export const readingSyncKey = (id: string) => `reading-sync:${id}`;
export const readingConflictKey = (id: string) => `sync-conflict:reading_position:${id}`;
export type ReadingSyncState = { conversation_id: string; server: ReadingPositionRead | null; known: boolean };
export const readingInput = (row: ReadingPositionRead | ReadingPositionInput): ReadingPositionInput => ({ message_id: row.message_id ?? null, block_index: row.block_index ?? null, scroll_offset: row.scroll_offset, anchor_data: row.anchor_data ?? {} });
export const readingSignature = (row?: ReadingPositionRead | ReadingPositionInput | null): string => row ? JSON.stringify(readingInput(row)) : "null";
const notify = () => window.dispatchEvent(new Event("chat-reader:outbox"));
const isPosition = (row: OfflineOutboxRecord) => row.entity_type === "reading_position";

async function stateFor(id: string, db = offlineDb): Promise<ReadingSyncState> {
  const existing = (await db.settings.get(readingSyncKey(id)))?.value as ReadingSyncState | undefined;
  if (existing) return existing;
  const local = await db.readingPositions.get(id);
  return { conversation_id: id, server: local?.revision ? local : null, known: Boolean(local?.revision) };
}

async function queue(id: string, input: ReadingPositionInput, base: number, db = offlineDb) {
  // Coalesce only never-submitted positions. A submitted ID and payload remain
  // immutable until acknowledged, including after timeout and browser restart.
  const pending = await db.outbox.where("conversation_id").equals(id).filter(isPosition).toArray();
  await db.outbox.bulkDelete(pending.filter((row) => !row.submitted).map((row) => row.operation_id));
  const last = await db.outbox.orderBy("queued_at").last();
  const conflict = await db.settings.get(readingConflictKey(id));
  await db.outbox.put({ operation_id: crypto.randomUUID(), entity_type: "reading_position", entity_id: id, conversation_id: id,
    action: "upsert", base_revision: base, payload: input, queued_at: new Date(Math.max(Date.now(), last ? Date.parse(last.queued_at) + 1 : 0)).toISOString(), attempts: 0, last_error: conflict ? "CONFLICT" : null });
}

export async function saveLocalReadingPosition(id: string, input: ReadingPositionInput): Promise<void> {
  const db = offlineDb, access = captureOfflineAccess();
  await db.transaction("rw", [db.settings, db.readingPositions, db.outbox], async () => {
    const state = await stateFor(id, db), current = await db.readingPositions.get(id);
    if (readingSignature(current) === readingSignature(input)) return;
    const now = new Date().toISOString();
    await db.settings.put({ key: readingSyncKey(id), value: state });
    await db.readingPositions.put({ id: current?.id ?? crypto.randomUUID(), conversation_id: id, ...readingInput(input), message_id: input.message_id ?? null, block_index: input.block_index ?? null,
      anchor_data: input.anchor_data ?? {}, revision: state.server?.revision ?? 0, created_at: current?.created_at ?? now, updated_at: now });
    await queue(id, readingInput(input), state.server?.revision ?? 0, db);
  });
  assertOfflineAccess(access); notify();
}

export async function ingestReadingPosition(id: string, fresh: ReadingPositionRead | null, db = offlineDb) {
  const state = await stateFor(id, db), local = await db.readingPositions.get(id);
  if ((fresh?.revision ?? 0) < (state.server?.revision ?? 0)) return;
  let pending = await db.outbox.where("conversation_id").equals(id).filter(isPosition).count();
  // Old unversioned copies may contain an offline position. Preserve it for
  // explicit comparison instead of inferring ownership of the newer clock.
  if (!state.known && local && !pending && readingSignature(local) !== readingSignature(fresh)) {
    await queue(id, readingInput(local), 0, db); pending = 1;
  }
  state.server = fresh; state.known = true;
  await db.settings.put({ key: readingSyncKey(id), value: state });
  if (!pending && !await db.settings.get(readingConflictKey(id))) {
    if (fresh) await db.readingPositions.put(fresh);
    else await db.readingPositions.delete(id);
  }
}

export async function readSyncedReadingPosition(id: string, online: boolean, strict = false): Promise<ReadingPositionResponse> {
  const db = offlineDb, access = captureOfflineAccess();
  if (online && navigator.onLine) {
    let fresh: ReadingPositionResponse;
    try { fresh = await getReadingPosition(id); } catch (error) {
      assertOfflineAccess(access);
      if (strict) throw error;
      const local = await db.readingPositions.get(id);
      if (!local) throw error;
      return { conversation_id: id, position: local };
    }
    assertOfflineAccess(access);
    try {
      await db.transaction("rw", [db.settings, db.outbox, db.readingPositions], () => ingestReadingPosition(id, fresh.position, db));
    } catch (error) {
      assertOfflineAccess(access);
      if (strict) throw error;
      // Online reading remains available when browser persistence fails. Prefer
      // an existing local working position; never silently resolve a conflict.
      const local = await db.readingPositions.get(id).catch(() => undefined);
      assertOfflineAccess(access);
      return { conversation_id: id, position: local ?? fresh.position };
    }
    notify();
  }
  assertOfflineAccess(access);
  return { conversation_id: id, position: await db.readingPositions.get(id) ?? null };
}

// Called under the same account Web Lock as annotation sync and signout.
export async function flushReadingPositionBatch(db: typeof offlineDb, access: number): Promise<{ synced: number; conflicts: number; retryAt?: number }> {
  const seen = new Set<string>();
  const selected = await db.outbox.orderBy("queued_at").filter((row) => {
    if (!isPosition(row) || seen.has(row.conversation_id)) return false;
    seen.add(row.conversation_id);
    return row.attempts < 5 && !["AUTH", "INVALID", "CONFLICT"].includes(row.last_error ?? "") && (row.retry_after ?? 0) <= Date.now();
  }).limit(5).toArray();
  let synced = 0, conflicts = 0;
  for (const selectedRow of selected) {
    assertOfflineAccess(access);
    const sent = await db.transaction("rw", db.outbox, async () => {
      const current = await db.outbox.get(selectedRow.operation_id); if (!current) return null;
      current.submitted = true; await db.outbox.put(current); return current;
    });
    if (!sent) continue;
    try {
      const response = await syncReadingPosition(sent.conversation_id, { operation_id: sent.operation_id, base_revision: sent.base_revision, position: sent.payload as ReadingPositionInput });
      assertOfflineAccess(access);
      if (response.operation_id !== sent.operation_id || response.position.conversation_id !== sent.conversation_id
        || !Number.isInteger(response.position.revision) || response.position.revision! < 1 || !["applied", "conflict"].includes(response.status)) throw new Error("Invalid reading sync receipt.");
      await db.transaction("rw", [db.outbox, db.settings, db.readingPositions], async () => {
        const state = await stateFor(sent.conversation_id, db);
        if (response.position.revision! >= (state.server?.revision ?? 0)) state.server = response.position;
        state.known = true;
        await db.settings.put({ key: readingSyncKey(sent.conversation_id), value: state });
        await db.outbox.delete(sent.operation_id);
        const later = await db.outbox.where("conversation_id").equals(sent.conversation_id).filter(isPosition).toArray();
        if (response.status === "conflict") {
          await db.settings.put({ key: readingConflictKey(sent.conversation_id), value: { conversation_id: sent.conversation_id, entity_type: "reading_position", local_payload: sent.payload } });
          for (const row of later) await db.outbox.update(row.operation_id, { last_error: "CONFLICT" });
        } else {
          for (const row of later) if (!row.submitted) await db.outbox.update(row.operation_id, { base_revision: response.position.revision! });
          if (!later.length) await db.readingPositions.put(state.server!);
        }
      });
      synced += 1; if (response.status === "conflict") conflicts += 1;
    } catch (error) {
      assertOfflineAccess(access);
      const code = error instanceof ApiRequestError ? [401, 403].includes(error.status) ? "AUTH" : [400, 404, 409, 422].includes(error.status) ? "INVALID" : "NETWORK" : "NETWORK";
      await db.outbox.update(sent.operation_id, { attempts: sent.attempts + 1, last_error: code, retry_after: Date.now() + Math.min(30_000, 2_000 * 2 ** sent.attempts) });
    }
  }
  window.dispatchEvent(new Event("chat-reader:sync-changed"));
  const retries = await db.outbox.filter((row) => isPosition(row) && row.last_error === "NETWORK" && row.attempts < 5).toArray();
  return { synced, conflicts, retryAt: retries.length ? Math.min(...retries.map((row) => row.retry_after ?? Date.now())) : undefined };
}

export async function resolveReadingPosition(id: string, choice: "local" | "server", expectedRevision: number, expectedLocal: string): Promise<ReadingPositionRead | null> {
  const db = offlineDb, access = captureOfflineAccess();
  const work = async () => {
    assertOfflineAccess(access);
    if (navigator.onLine) await readSyncedReadingPosition(id, true, true);
    return db.transaction("rw", [db.settings, db.outbox, db.readingPositions], async () => {
      const state = await stateFor(id, db), local = await db.readingPositions.get(id);
      if (!local || !await db.settings.get(readingConflictKey(id)) || state.server?.revision !== expectedRevision || readingSignature(local) !== expectedLocal) throw new Error("Reading positions changed. Review them again.");
      await db.outbox.where("conversation_id").equals(id).filter(isPosition).delete();
      await db.settings.delete(readingConflictKey(id));
      if (choice === "server") { await db.readingPositions.put(state.server); return state.server; }
      await queue(id, readingInput(local), expectedRevision, db); return null;
    });
  };
  const result = navigator.locks ? await navigator.locks.request(`chat-reader:sync:${db.name}`, work) : await work();
  assertOfflineAccess(access); notify(); return result;
}
