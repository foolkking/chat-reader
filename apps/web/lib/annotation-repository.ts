import {
  createConversationAnnotation,
  getConversationAnnotations,
  getConversationNotebook,
  getConversationNotebookConflicts,
  syncConversationAnnotations,
  updateConversationAnnotation,
  updateConversationNotebook,
} from "./api";
import { offlineDb, queueOfflineOperation } from "./offline-db";
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
  getNotebook(conversationId: string): Promise<NotebookRead>;
  listNotebookConflicts(conversationId: string): Promise<NotebookRead[]>;
  saveNotebook(notebook: NotebookRead, blocks: NotebookBlock[], title?: string | null): Promise<NotebookRead>;
}

export const remoteAnnotationRepository: AnnotationRepository = {
  mode: "remote",
  list: getConversationAnnotations,
  create: createConversationAnnotation,
  update(annotation, input) {
    return updateConversationAnnotation(annotation.id, { ...input, base_revision: annotation.revision });
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
    return offlineDb.annotations.where("conversation_id").equals(conversationId).filter((item) => !item.is_deleted).sortBy("created_at");
  },
  async create(conversationId, input) {
    const now = new Date().toISOString();
    const annotation: AnnotationRead = {
      id: input.id ?? crypto.randomUUID(),
      conversation_id: conversationId,
      message_id: input.message_id ?? null,
      message_version_id: input.message_version_id ?? null,
      annotation_type: input.annotation_type,
      color: input.color ?? (input.annotation_type === "highlight" ? "yellow" : null),
      start_block_index: input.start_block_index ?? null,
      start_offset: input.start_offset ?? null,
      end_block_index: input.end_block_index ?? null,
      end_offset: input.end_offset ?? null,
      quote: input.quote ?? null,
      prefix: input.prefix ?? null,
      suffix: input.suffix ?? null,
      comment_markdown: input.comment_markdown ?? "",
      anchor_status: input.anchor_status ?? "active",
      revision: 1,
      is_deleted: false,
      conflict_of_id: null,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
    };
    await offlineDb.annotations.put(annotation);
    await queueOfflineOperation({
      operation_id: crypto.randomUUID(),
      entity_type: "annotation",
      entity_id: annotation.id,
      action: "upsert",
      conversation_id: conversationId,
      base_revision: 0,
      payload: annotationPayload(annotation),
    });
    return annotation;
  },
  async update(annotation, input) {
    const updated: AnnotationRead = {
      ...annotation,
      ...input,
      revision: annotation.revision + 1,
      updated_at: new Date().toISOString(),
    };
    await offlineDb.annotations.put(updated);
    await queueOfflineOperation({
      operation_id: crypto.randomUUID(),
      entity_type: "annotation",
      entity_id: updated.id,
      action: "upsert",
      conversation_id: updated.conversation_id,
      base_revision: annotation.revision,
      payload: annotationPayload(updated),
    });
    return updated;
  },
  async getNotebook(conversationId) {
    const existing = await offlineDb.notebooks.where("conversation_id").equals(conversationId).filter((item) => !item.is_conflict).first();
    if (existing) return existing;
    const now = new Date().toISOString();
    const notebook: NotebookRead = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      title: null,
      blocks: [],
      revision: 0,
      is_conflict: false,
      conflict_of_id: null,
      created_at: now,
      updated_at: now,
    };
    await offlineDb.notebooks.put(notebook);
    return notebook;
  },
  async listNotebookConflicts(conversationId) {
    return offlineDb.notebooks.where("conversation_id").equals(conversationId).filter((item) => item.is_conflict).toArray();
  },
  async saveNotebook(notebook, blocks, title) {
    const updated: NotebookRead = {
      ...notebook,
      title: title === undefined ? notebook.title : title,
      blocks,
      revision: notebook.revision + 1,
      updated_at: new Date().toISOString(),
    };
    await offlineDb.notebooks.put(updated);
    await queueOfflineOperation({
      operation_id: crypto.randomUUID(),
      entity_type: "notebook",
      entity_id: updated.id,
      action: "upsert",
      conversation_id: updated.conversation_id,
      base_revision: notebook.revision,
      payload: { title: updated.title, blocks: updated.blocks },
    });
    return updated;
  },
};

export async function flushAnnotationOutbox(): Promise<{ synced: number; conflicts: number }> {
  if (!navigator.onLine) return { synced: 0, conflicts: 0 };
  const operations = await offlineDb.outbox.orderBy("queued_at").toArray();
  if (!operations.length) return { synced: 0, conflicts: 0 };
  let response: Awaited<ReturnType<typeof syncConversationAnnotations>>;
  try {
    response = await syncConversationAnnotations(operations.map(({ queued_at: _queuedAt, attempts: _attempts, last_error: _lastError, ...operation }) => operation));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await offlineDb.transaction("rw", offlineDb.outbox, async () => {
      await Promise.all(operations.map((item) => offlineDb.outbox.update(item.operation_id, {
        attempts: item.attempts + 1,
        last_error: message,
      })));
    });
    throw error;
  }
  const completed = response.results.map((item) => item.operation_id);
  await offlineDb.outbox.bulkDelete(completed);
  const conversationIds = Array.from(new Set(operations.map((item) => item.conversation_id)));
  for (const conversationId of conversationIds) {
    const annotations = await getConversationAnnotations(conversationId);
    await offlineDb.annotations.where("conversation_id").equals(conversationId).delete();
    if (annotations.length) await offlineDb.annotations.bulkPut(annotations);
    const [notebook, notebookConflicts] = await Promise.all([
      getConversationNotebook(conversationId),
      getConversationNotebookConflicts(conversationId),
    ]);
    await offlineDb.notebooks.where("conversation_id").equals(conversationId).delete();
    await offlineDb.notebooks.bulkPut([notebook, ...notebookConflicts]);
  }
  return { synced: completed.length, conflicts: response.results.filter((item) => item.status === "conflict").length };
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
