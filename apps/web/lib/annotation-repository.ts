import {
  createConversationAnnotation,
  deleteConversationAnnotation,
  getConversationAnnotations,
  getConversationNotebook,
  getConversationNotebookConflicts,
  updateConversationAnnotation,
  updateConversationNotebook,
} from "./api";
import { offlineDb, queueOfflineOperation, syncOfflineAnnotationSearch } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
export { flushAnnotationOutbox } from "./annotation-sync";
import type {
  AnnotationCreateInput,
  AnnotationRead,
  AnnotationUpdateInput,
  NotebookBlock,
  NotebookRead,
} from "./types";

export interface AnnotationRepository {
  readonly mode: "remote" | "offline";
  list(conversationId: string): Promise<AnnotationRead[]>;
  create(conversationId: string, input: AnnotationCreateInput): Promise<AnnotationRead>;
  update(annotation: AnnotationRead, input: Omit<AnnotationUpdateInput, "base_revision">): Promise<AnnotationRead>;
  delete(annotation: AnnotationRead): Promise<void>;
  getNotebook(conversationId: string): Promise<NotebookRead>;
  listNotebookConflicts(conversationId: string): Promise<NotebookRead[]>;
  saveNotebook(notebook: NotebookRead, blocks: NotebookBlock[], title?: string | null): Promise<NotebookRead>;
}

export const remoteAnnotationRepository: AnnotationRepository = {
  mode: "remote",
  async list(conversationId) {
    return (await getConversationAnnotations(conversationId)).map(normalizeAnnotationStatus);
  },
  async create(conversationId, input) {
    return normalizeAnnotationStatus(await createConversationAnnotation(conversationId, input));
  },
  update(annotation, input) {
    return updateConversationAnnotation(annotation.id, { ...input, base_revision: annotation.revision }).then(normalizeAnnotationStatus);
  },
  delete(annotation) {
    return deleteConversationAnnotation(annotation.id, annotation.revision);
  },
  getNotebook: getConversationNotebook,
  listNotebookConflicts: getConversationNotebookConflicts,
  saveNotebook(notebook, blocks, title) {
    return updateConversationNotebook(notebook.conversation_id, {
      id: notebook.id,
      title: title === undefined ? notebook.title : title,
      blocks,
      base_revision: notebook.revision,
    });
  },
};

export const offlineAnnotationRepository: AnnotationRepository = {
  mode: "offline",
  async list(conversationId) {
    return (await offlineDb.annotations.where("conversation_id").equals(conversationId).filter((item) => !item.is_deleted).sortBy("created_at"))
      .map(normalizeAnnotationStatus);
  },
  async create(conversationId, input) {
    return localEdit(async (db) => {
      const now = new Date().toISOString();
      const annotation: AnnotationRead = {
        id: input.id ?? crypto.randomUUID(), conversation_id: conversationId,
        message_id: input.message_id ?? null, message_version_id: input.message_version_id ?? null,
        annotation_type: input.annotation_type, color: input.color ?? (input.annotation_type === "bookmark" ? null : "yellow"),
        start_block_index: input.start_block_index ?? null, start_offset: input.start_offset ?? null,
        end_block_index: input.end_block_index ?? null, end_offset: input.end_offset ?? null,
        quote: input.quote ?? null, prefix: input.prefix ?? null, suffix: input.suffix ?? null,
        comment_markdown: input.comment_markdown ?? "", anchor_status: input.anchor_status ?? "valid",
        revision: 1, is_deleted: false, conflict_of_id: null, metadata: input.metadata ?? {}, created_at: now, updated_at: now,
      };
      await db.annotations.add(annotation);
      await syncOfflineAnnotationSearch(annotation, db);
      await queueOfflineOperation({ operation_id: crypto.randomUUID(), entity_type: "annotation", entity_id: annotation.id,
        action: "upsert", conversation_id: conversationId, base_revision: 0, payload: annotationPayload(annotation) }, db);
      return annotation;
    });
  },
  async update(annotation, input) {
    return localEdit(async (db) => {
      const current = await db.annotations.get(annotation.id);
      if (!current || current.is_deleted) throw new Error("Annotation is no longer available.");
      for (const field of Object.keys(input) as Array<keyof typeof input>) {
        if (!sameValue(current[field], annotation[field]) && !sameValue(current[field], input[field])) throw new Error("The annotation changed. Your draft is retained; reload before saving again.");
      }
      const updated = { ...current, ...input, revision: current.revision + 1, updated_at: new Date().toISOString() };
      await db.annotations.put(updated);
      await syncOfflineAnnotationSearch(updated, db);
      await queueOfflineOperation({ operation_id: crypto.randomUUID(), entity_type: "annotation", entity_id: updated.id,
        action: "upsert", conversation_id: updated.conversation_id, base_revision: current.revision, payload: annotationPayload(updated) }, db);
      return updated;
    });
  },
  async delete(annotation) {
    await localEdit(async (db) => {
      const current = await db.annotations.get(annotation.id);
      if (!current || current.is_deleted) return;
      if (current.revision !== annotation.revision) throw new Error("The annotation changed. Review it before deleting.");
      const deleted = { ...current, is_deleted: true, revision: current.revision + 1, updated_at: new Date().toISOString() };
      await db.annotations.put(deleted);
      await syncOfflineAnnotationSearch(deleted, db);
      await queueOfflineOperation({ operation_id: crypto.randomUUID(), entity_type: "annotation", entity_id: current.id,
        action: "delete", conversation_id: current.conversation_id, base_revision: current.revision, payload: {} }, db);
    });
  },
  async getNotebook(conversationId) {
    const db = offlineDb;
    return db.transaction("rw", db.notebooks, async () => {
      const existing = await db.notebooks.where("conversation_id").equals(conversationId).filter((item) => !item.is_conflict).first();
      if (existing) return existing;
      const now = new Date().toISOString();
      const notebook: NotebookRead = { id: crypto.randomUUID(), conversation_id: conversationId, title: null, blocks: [], revision: 0,
        is_conflict: false, conflict_of_id: null, created_at: now, updated_at: now };
      await db.notebooks.add(notebook);
      return notebook;
    });
  },
  async listNotebookConflicts(conversationId) {
    return offlineDb.notebooks.where("conversation_id").equals(conversationId).filter((item) => item.is_conflict).toArray();
  },
  async saveNotebook(notebook, blocks, title) {
    return localEdit(async (db) => {
      const current = await db.notebooks.get(notebook.id);
      if (!current) throw new Error("Notebook changed. Reopen it before saving.");
      const nextBlocks = sameValue(blocks, notebook.blocks) ? current.blocks : blocks;
      const nextTitle = title === undefined || title === notebook.title ? current.title : title;
      if ((!sameValue(current.blocks, notebook.blocks) && !sameValue(nextBlocks, current.blocks))
        || (current.title !== notebook.title && nextTitle !== current.title)) {
        throw new Error("The notebook changed. Your draft is retained; reload before saving again.");
      }
      const updated: NotebookRead = { ...current, title: nextTitle, blocks: nextBlocks, revision: current.revision + 1, updated_at: new Date().toISOString() };
      await db.notebooks.put(updated);
      await queueOfflineOperation({ operation_id: crypto.randomUUID(), entity_type: "notebook", entity_id: updated.id,
        action: "upsert", conversation_id: updated.conversation_id, base_revision: current.revision,
        payload: { title: updated.title, blocks: updated.blocks } }, db);
      return updated;
    });
  },
};

function sameValue(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

async function localEdit<T>(edit: (db: typeof offlineDb) => Promise<T>): Promise<T> {
  const access = captureOfflineAccess(), db = offlineDb;
  const result = await db.transaction("rw", [db.annotations, db.notebooks, db.searchDocuments, db.conversations, db.outbox, db.settings], () => edit(db));
  assertOfflineAccess(access);
  window.dispatchEvent(new Event("chat-reader:outbox"));
  return result;
}

function annotationPayload(annotation: AnnotationRead): Record<string, unknown> {
  return {
    message_id: annotation.message_id,
    message_version_id: annotation.message_version_id,
    annotation_type: annotation.annotation_type,
    color: annotation.color,
    start_block_index: annotation.start_block_index,
    start_offset: annotation.start_offset,
    end_block_index: annotation.end_block_index,
    end_offset: annotation.end_offset,
    quote: annotation.quote,
    prefix: annotation.prefix,
    suffix: annotation.suffix,
    comment_markdown: annotation.comment_markdown,
    anchor_status: annotation.anchor_status,
    metadata: annotation.metadata,
  };
}

function normalizeAnnotationStatus(annotation: AnnotationRead): AnnotationRead {
  const legacyStatus = annotation.anchor_status as string;
  const anchorStatus = legacyStatus === "active"
    ? "valid"
    : legacyStatus === "relocated"
      ? "remapped"
      : legacyStatus === "stale"
        ? "needs_review"
        : annotation.anchor_status;
  return anchorStatus === annotation.anchor_status ? annotation : { ...annotation, anchor_status: anchorStatus };
}
