import { ApiRequestError, getConversationAnnotations, getConversationNotebook, getConversationNotebookConflicts, syncConversationAnnotations } from "./api";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import { offlineDb, syncOfflineAnnotationSearch } from "./offline-db";
import { OFFLINE_SYNC_CHANGED_EVENT } from "./annotation-sync";
import type { AnnotationRead, AnnotationSyncOperation, NotebookRead } from "./types";

export type ConflictMarker = {
  entity_type: "annotation" | "notebook"; entity_id: string; local_entity_id: string;
  conversation_id: string; conflict_copy_id: string; local_action?: string; local_payload?: Record<string, unknown>;
  resolution?: { operation: AnnotationSyncOperation; supersedes: string[]; baseLocal?: AnnotationRead | NotebookRead; error?: "STALE" | "NETWORK" };
};
export type ConflictPreview = {
  key: string; marker: ConflictMarker; local: AnnotationRead | NotebookRead; server: AnnotationRead | NotebookRead;
  copy: AnnotationRead | NotebookRead; pendingIds: string[];
  references: AnnotationRead[];
};
export class ConflictChangedError extends Error {}

export async function ensureNotebookConflict(current: NotebookRead, copies: NotebookRead[]): Promise<string> {
  const key = `sync-conflict:notebook:${current.conversation_id}`, db = offlineDb, access = captureOfflineAccess();
  return db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    if (await db.settings.get(key)) return key;
    const copy = copies.find((item) => item.conflict_of_id === current.id);
    if (!copy) throw new ConflictChangedError();
    await db.settings.put({ key, value: { entity_type: "notebook", entity_id: current.id, local_entity_id: current.id,
      conversation_id: current.conversation_id, conflict_copy_id: copy.id, local_action: "upsert", local_payload: { title: copy.title, blocks: copy.blocks } } });
    return key;
  });
}

const related = (item: { entity_type: string; entity_id: string; conversation_id: string }, marker: ConflictMarker) =>
  item.entity_type === marker.entity_type && (item.entity_type === "notebook" ? item.conversation_id === marker.conversation_id : item.entity_id === marker.local_entity_id);

export async function loadOfflineConflict(key: string): Promise<ConflictPreview> {
  const db = offlineDb, access = captureOfflineAccess();
  const marker = (await db.settings.get(key))?.value as ConflictMarker | undefined;
  if (!marker) throw new ConflictChangedError();
  const rows = marker.entity_type === "annotation"
    ? await getConversationAnnotations(marker.conversation_id, true)
    : [await getConversationNotebook(marker.conversation_id), ...await getConversationNotebookConflicts(marker.conversation_id)];
  assertOfflineAccess(access);
  const references = marker.entity_type === "annotation" ? rows as AnnotationRead[] : await getConversationAnnotations(marker.conversation_id, true);
  assertOfflineAccess(access);
  const server = rows.find((item) => item.id === marker.entity_id), copy = rows.find((item) => item.id === marker.conflict_copy_id);
  // An unacknowledged successful resolution may have removed the copy. Retry
  // its saved operation first; its server receipt remains authoritative.
  if (!server || !copy) throw new ConflictChangedError();
  return db.transaction("r", [db.settings, db.outbox, db.annotations, db.notebooks], async () => {
    if (JSON.stringify((await db.settings.get(key))?.value) !== JSON.stringify(marker)) throw new ConflictChangedError();
    const pending = await db.outbox.filter((item) => related(item, marker)).sortBy("queued_at");
    const latest = pending.at(-1);
    const payload = latest?.payload ?? marker.local_payload;
    const action = latest?.action ?? marker.local_action;
    const local = marker.entity_type === "annotation"
      ? { ...copy, ...payload, id: marker.local_entity_id, is_deleted: action === "delete" || (!action && (copy as AnnotationRead).is_deleted) } as AnnotationRead
      : { ...copy, ...payload, id: marker.local_entity_id, is_conflict: false } as NotebookRead;
    return { key, marker, server, copy, local, references, pendingIds: pending.map((item) => item.operation_id) };
  });
}

export async function prepareOfflineResolution(preview: ConflictPreview, choice: "local" | "server" | "merge", merged?: AnnotationRead | NotebookRead): Promise<void> {
  const db = offlineDb, access = captureOfflineAccess();
  const chosen = choice === "server" ? preview.server : choice === "merge" ? merged! : preview.local;
  await db.transaction("rw", [db.settings, db.outbox, db.annotations, db.notebooks], async () => {
    assertOfflineAccess(access);
    const marker = (await db.settings.get(preview.key))?.value as ConflictMarker | undefined;
    const pending = await db.outbox.filter((item) => related(item, preview.marker)).sortBy("queued_at");
    if (!marker || JSON.stringify(marker) !== JSON.stringify(preview.marker)
      || JSON.stringify(pending.map((item) => item.operation_id)) !== JSON.stringify(preview.pendingIds)) throw new ConflictChangedError();
    if (marker.resolution && marker.resolution.error !== "STALE") throw new ConflictChangedError();
    const operation: AnnotationSyncOperation = {
      operation_id: crypto.randomUUID(), entity_type: marker.entity_type, entity_id: marker.entity_id,
      conversation_id: marker.conversation_id, action: "resolve", base_revision: preview.server.revision,
      payload: { conflict_copy_id: marker.conflict_copy_id, conflict_revision: preview.copy.revision, choice,
        ...(choice === "server" ? {} : marker.entity_type === "annotation"
          ? { ...((chosen as AnnotationRead).is_deleted ? {} : { annotation: chosen }), deleted: (chosen as AnnotationRead).is_deleted } : { notebook: chosen }) },
    };
    const baseLocal = marker.entity_type === "annotation" ? await db.annotations.get(marker.local_entity_id)
      : await db.notebooks.get(marker.local_entity_id) ?? await db.notebooks.get(marker.entity_id);
    await db.settings.put({ key: preview.key, value: { ...marker, resolution: { operation, supersedes: preview.pendingIds, baseLocal } } });
  });
}

export async function retryOfflineResolution(key: string): Promise<void> {
  const db = offlineDb, access = captureOfflineAccess();
  const work = async () => {
    assertOfflineAccess(access);
    const marker = (await db.settings.get(key))?.value as ConflictMarker | undefined;
    if (!marker?.resolution) throw new ConflictChangedError();
    const { operation, supersedes } = marker.resolution;
    try {
      const response = await syncConversationAnnotations([operation]);
      assertOfflineAccess(access);
      const receipt = response.results[0];
      if (response.results.length !== 1 || receipt.operation_id !== operation.operation_id || receipt.entity_id !== operation.entity_id
        || receipt.entity_type !== operation.entity_type || !["applied", "duplicate"].includes(receipt.status)
        || receipt.conflict_copy_id || !Number.isInteger(receipt.revision) || receipt.revision < 1) throw new Error("Invalid receipt");
      const canonical = marker.entity_type === "annotation"
        ? (await getConversationAnnotations(marker.conversation_id, true)).find((item) => item.id === marker.entity_id)
        : await getConversationNotebook(marker.conversation_id);
      assertOfflineAccess(access);
      if (!canonical) throw new Error("Missing canonical result");
      const notebooks = marker.entity_type === "annotation"
        ? [await getConversationNotebook(marker.conversation_id), ...await getConversationNotebookConflicts(marker.conversation_id)] : [];
      assertOfflineAccess(access);
      await db.transaction("rw", [db.settings, db.outbox, db.annotations, db.notebooks, db.searchDocuments, db.conversations], async () => {
        const currentMarker = (await db.settings.get(key))?.value as ConflictMarker | undefined;
        if (currentMarker?.resolution?.operation.operation_id !== operation.operation_id) throw new ConflictChangedError();
        // Delete only the edits explicitly included in the user's comparison.
        await db.outbox.bulkDelete(supersedes);
        const newer = await db.outbox.filter((item) => related(item, marker)).sortBy("queued_at");
        let rebased = { ...canonical }, prior = marker.resolution!.baseLocal as Record<string, unknown> | undefined;
        for (const [index, item] of newer.entries()) {
          const fields = marker.entity_type === "notebook" ? ["title", "blocks"] : Object.keys(item.payload);
          const delta = Object.fromEntries(fields.filter((field) => !prior || JSON.stringify(item.payload[field]) !== JSON.stringify(prior[field]))
            .map((field) => [field, item.payload[field]]));
          rebased = { ...rebased, ...delta, ...(marker.entity_type === "annotation" ? { is_deleted: item.action === "delete" } : {}), revision: receipt.revision + index + 1 };
          await db.outbox.update(item.operation_id, {
            entity_id: marker.entity_id, base_revision: receipt.revision + index, attempts: 0, last_error: null,
            payload: item.action === "delete" ? {} : marker.entity_type === "notebook" ? { title: (rebased as NotebookRead).title, blocks: (rebased as NotebookRead).blocks } : rebased,
          });
          prior = item.payload;
        }
        if (marker.entity_type === "annotation") {
          const copy = await db.annotations.get(marker.conflict_copy_id);
          if (copy) await syncOfflineAnnotationSearch({ ...copy, is_deleted: true }, db);
          await db.annotations.delete(marker.conflict_copy_id);
          const result = rebased as AnnotationRead;
          await db.annotations.put(result);
          await syncOfflineAnnotationSearch(result, db);
          const pendingNotes = await db.outbox.where("conversation_id").equals(marker.conversation_id).filter((item) => item.entity_type === "notebook").count();
          if (!pendingNotes) {
            await db.notebooks.where("conversation_id").equals(marker.conversation_id).delete();
            await db.notebooks.bulkPut(notebooks);
          } else {
            await db.notebooks.where("conversation_id").equals(marker.conversation_id).modify((note) => {
              note.blocks = note.blocks.map((block) => block.annotation_id === marker.conflict_copy_id ? { ...block, annotation_id: marker.entity_id } : block);
            });
          }
        } else {
          await db.notebooks.bulkDelete([...new Set([marker.conflict_copy_id, marker.local_entity_id])]);
          await db.notebooks.put(rebased as NotebookRead);
        }
        await db.settings.bulkDelete([key, `sync-resolution-draft:${key}`]);
      });
      window.dispatchEvent(new Event(OFFLINE_SYNC_CHANGED_EVENT));
      window.dispatchEvent(new Event("chat-reader:outbox"));
    } catch (error) {
      assertOfflineAccess(access);
      await db.transaction("rw", db.settings, async () => {
        const current = (await db.settings.get(key))?.value as ConflictMarker | undefined;
        if (current?.resolution?.operation.operation_id === operation.operation_id) await db.settings.put({ key, value: {
          ...current, resolution: { ...current.resolution, error: error instanceof ApiRequestError && [404, 409, 422].includes(error.status) ? "STALE" : "NETWORK" },
        } });
      });
      throw error;
    }
  };
  return navigator.locks ? navigator.locks.request(`chat-reader:sync:${db.name}`, work) : work();
}
