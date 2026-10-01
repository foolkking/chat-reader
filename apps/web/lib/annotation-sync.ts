import { ApiRequestError, getConversationAnnotations, getConversationNotebook, getConversationNotebookConflicts, syncConversationAnnotations } from "./api";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import { clearOfflineAnnotationSearch, offlineDb, syncOfflineAnnotationSearch, type OfflineOutboxRecord } from "./offline-db";
import type { AnnotationRead, NotebookRead } from "./types";
import { flushReadingPositionBatch } from "./reading-position-sync";

export const OFFLINE_SYNC_CHANGED_EVENT = "chat-reader:sync-changed";
export const OFFLINE_SYNC_MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
type SyncResult = { synced: number; conflicts: number; retryAt?: number };
const running = new WeakMap<typeof offlineDb, Promise<SyncResult>>();

export function flushAnnotationOutbox(): Promise<SyncResult> {
  if (!navigator.onLine) return Promise.resolve({ synced: 0, conflicts: 0 });
  const db = offlineDb;
  const existing = running.get(db);
  if (existing) return existing;
  const access = captureOfflineAccess();
  const work = async () => {
    assertOfflineAccess(access);
    let annotations = { synced: 0, conflicts: 0 }, failed = false;
    try { annotations = await flushBatch(db, access); } catch { assertOfflineAccess(access); failed = true; }
    const positions = await flushReadingPositionBatch(db, access);
    const retryAt = failed ? Math.min(positions.retryAt ?? Infinity, Date.now() + 2_000) : positions.retryAt;
    return { synced: annotations.synced + positions.synced, conflicts: annotations.conflicts + positions.conflicts, retryAt };
  };
  const promise = (async () => navigator.locks ? await navigator.locks.request(`chat-reader:sync:${db.name}`, work) : await work())()
    .finally(() => { running.delete(db); });
  running.set(db, promise);
  return promise;
}

async function flushBatch(db: typeof offlineDb, access: number): Promise<SyncResult> {
  const seen = new Set<string>();
  // Only the first operation for each entity may advance. A conflict/failure
  // pauses its descendants instead of creating a new conflict for each edit.
  const operations = await db.outbox.orderBy("queued_at").filter((item) => {
    if (item.entity_type === "reading_position") return false;
    const key = entityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return item.last_error !== "CONFLICT" && item.last_error !== "INVALID" && item.last_error !== "AUTH"
      && item.attempts < OFFLINE_SYNC_MAX_ATTEMPTS;
  }).limit(BATCH_SIZE).toArray();
  if (!operations.length) return { synced: 0, conflicts: 0 };
  try {
    assertOfflineAccess(access);
    const response = await syncConversationAnnotations(operations.map((item) => ({
      operation_id: item.operation_id, entity_type: item.entity_type as "annotation" | "notebook", entity_id: item.entity_id,
      conversation_id: item.conversation_id, action: item.action, base_revision: item.base_revision, payload: item.payload,
    })));
    assertOfflineAccess(access);
    const byId = new Map(operations.map((item) => [item.operation_id, item]));
    const acknowledged = new Set<string>();
    if (!Array.isArray(response.results)) throw new Error("Invalid synchronization receipt.");
    for (const result of response.results) {
      const sent = byId.get(result.operation_id);
      if (!sent || acknowledged.has(result.operation_id) || sent.entity_type !== result.entity_type
        || (sent.entity_type === "annotation" && sent.entity_id !== result.entity_id)
        || !["applied", "duplicate", "conflict"].includes(result.status)
        || !Number.isInteger(result.revision) || result.revision < 1) throw new Error("Invalid synchronization receipt.");
      acknowledged.add(result.operation_id);
    }
    if (acknowledged.size !== operations.length) throw new Error("Incomplete synchronization receipt.");
    const snapshots: Array<{ conversationId: string; annotations: AnnotationRead[]; notebook: NotebookRead; conflicts: NotebookRead[] }> = [];
    for (const conversationId of new Set(operations.map((item) => item.conversation_id))) {
      const [annotations, notebook, conflicts] = await Promise.all([
        getConversationAnnotations(conversationId), getConversationNotebook(conversationId), getConversationNotebookConflicts(conversationId),
      ]);
      assertOfflineAccess(access);
      snapshots.push({ conversationId, annotations, notebook, conflicts });
    }
    // Fetch before acknowledging: a failed snapshot fetch leaves retryable
    // operation IDs. Receipts make retry safe after the server already committed.
    await db.transaction("rw", [db.outbox, db.annotations, db.notebooks, db.searchDocuments, db.conversations, db.settings], async () => {
      assertOfflineAccess(access);
      await db.outbox.bulkDelete([...acknowledged]);
      for (const result of response.results) {
        const sent = byId.get(result.operation_id)!;
        if (result.status === "conflict" || result.conflict_copy_id) {
          const key = entityKey(sent);
          await db.settings.put({ key: `sync-conflict:${key}`, value: { ...result, conversation_id: sent.conversation_id, local_entity_id: sent.entity_id, local_action: sent.action, local_payload: sent.payload } });
          await db.outbox.where("conversation_id").equals(sent.conversation_id).filter((item) => entityKey(item) === key).modify({ last_error: "CONFLICT" });
        }
      }
      for (const snapshot of snapshots) {
        const pending = await db.outbox.where("conversation_id").equals(snapshot.conversationId).toArray();
        const pendingAnnotations = new Set(pending.filter((item) => item.entity_type === "annotation").map((item) => item.entity_id));
        const localAnnotations = await db.annotations.where("conversation_id").equals(snapshot.conversationId).toArray();
        const annotations = [
          ...snapshot.annotations.filter((item) => !pendingAnnotations.has(item.id)),
          ...localAnnotations.filter((item) => pendingAnnotations.has(item.id)),
        ];
        await db.annotations.where("conversation_id").equals(snapshot.conversationId).delete();
        await db.annotations.bulkPut(annotations);
        await clearOfflineAnnotationSearch(snapshot.conversationId, db);
        for (const annotation of annotations) await syncOfflineAnnotationSearch(annotation, db);
        // A new edit queued during either fetch remains the current local note.
        if (!pending.some((item) => item.entity_type === "notebook")) {
          await db.notebooks.where("conversation_id").equals(snapshot.conversationId).delete();
          await db.notebooks.put(snapshot.notebook);
        }
        await db.notebooks.bulkPut(snapshot.conflicts);
      }
    });
    assertOfflineAccess(access);
    window.dispatchEvent(new Event(OFFLINE_SYNC_CHANGED_EVENT));
    return { synced: acknowledged.size, conflicts: response.results.filter((item) => item.status === "conflict" || item.conflict_copy_id).length };
  } catch (error) {
    // Never record A's failure in B's namespace, or reopen a locked database.
    assertOfflineAccess(access);
    const code = error instanceof ApiRequestError
      ? error.status === 401 ? "AUTH" : error.status === 409 ? "CONFLICT" : error.status >= 400 && error.status < 500 && error.status !== 429 ? "INVALID" : "NETWORK"
      : "NETWORK";
    await db.transaction("rw", db.outbox, async () => {
      for (const item of operations) await db.outbox.update(item.operation_id, { attempts: item.attempts + 1, last_error: code });
    });
    window.dispatchEvent(new Event(OFFLINE_SYNC_CHANGED_EVENT));
    throw error;
  }
}

function entityKey(item: OfflineOutboxRecord): string {
  return `${item.entity_type}:${item.entity_type === "notebook" ? item.conversation_id : item.entity_id}`;
}
