import Dexie, { type EntityTable } from "dexie";
import { unzipSync, strFromU8 } from "fflate";
import type {
  AnnotationRead,
  AnnotationSyncOperation,
  ConversationDetail,
  MessageListItem,
  NotebookRead,
  ReadingPositionRead,
  RenderBlockRead,
  TocItem,
} from "./types";

export type OfflineConversationRecord = ConversationDetail & {
  downloaded_at: string;
  last_read_at: string | null;
};

type OfflineMessageRecord = Omit<MessageListItem, "render_blocks"> & { conversation_id: string };
type OfflineBlockRecord = RenderBlockRead & { key: string; conversation_id: string; message_id: string };
type OfflineHeadingRecord = TocItem & { conversation_id: string };
export type OfflineSearchDocument = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  document_type: string;
  role: string | null;
  title: string | null;
  plain_text: string;
  search_text: string;
  order_key: string | null;
  turn_index: number | null;
  metadata: Record<string, unknown>;
};
type OfflinePackageMeta = {
  id: string;
  scope: "conversation" | "project" | "all";
  scope_id: string | null;
  catalog_revision: string;
  conversation_ids: string[];
  byte_size: number;
  downloaded_at: string;
};
type OfflineOutboxRecord = AnnotationSyncOperation & { queued_at: string; attempts: number; last_error: string | null };
type OfflineSetting = { key: string; value: unknown };

class OfflineLibraryDatabase extends Dexie {
  conversations!: EntityTable<OfflineConversationRecord, "id">;
  messages!: EntityTable<OfflineMessageRecord, "id">;
  blocks!: EntityTable<OfflineBlockRecord, "key">;
  headings!: EntityTable<OfflineHeadingRecord, "id">;
  searchDocuments!: EntityTable<OfflineSearchDocument, "id">;
  annotations!: EntityTable<AnnotationRead, "id">;
  notebooks!: EntityTable<NotebookRead, "id">;
  readingPositions!: EntityTable<ReadingPositionRead, "conversation_id">;
  packages!: EntityTable<OfflinePackageMeta, "id">;
  outbox!: EntityTable<OfflineOutboxRecord, "operation_id">;
  settings!: EntityTable<OfflineSetting, "key">;

  constructor() {
    super("chat-reader-offline-library");
    this.version(1).stores({
      conversations: "id, project_id, offline_revision, last_read_at, downloaded_at",
      messages: "id, conversation_id, [conversation_id+order_key]",
      blocks: "key, conversation_id, message_id, [message_id+block_index]",
      headings: "id, conversation_id, message_id, [conversation_id+heading_index]",
      searchDocuments: "id, conversation_id, message_id, document_type",
      annotations: "id, conversation_id, message_id, updated_at, conflict_of_id",
      notebooks: "id, conversation_id, updated_at, conflict_of_id",
      readingPositions: "conversation_id, updated_at",
      packages: "id, scope, scope_id, downloaded_at",
      outbox: "operation_id, conversation_id, entity_type, queued_at",
      settings: "key",
    });
  }
}

export const offlineDb = new OfflineLibraryDatabase();

type PackageConversation = Record<string, unknown> & {
  id: string;
  messages: MessageListItem[];
  headings: TocItem[];
  search_documents: OfflineSearchDocument[];
  annotations: AnnotationRead[];
  notebook: NotebookRead | null;
  reading_position: ReadingPositionRead | null;
};

type OfflinePackagePayload = {
  format: "chat-reader-offline-package";
  version: 1;
  catalog_revision: string;
  scope: "conversation" | "project" | "all";
  scope_id: string | null;
  conversations: PackageConversation[];
};

export async function importOfflinePackage(packageId: string, response: Response): Promise<OfflinePackageMeta> {
  if (!response.ok) throw new Error(`Offline package download failed (${response.status}).`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(compressed);
  const packageEntry = entries["package.json"];
  if (!packageEntry) throw new Error("Offline package is missing package.json.");
  const payload = JSON.parse(strFromU8(packageEntry)) as OfflinePackagePayload;
  if (payload.format !== "chat-reader-offline-package" || payload.version !== 1) {
    throw new Error("Unsupported offline package version.");
  }
  const now = new Date().toISOString();
  const conversationIds = payload.conversations.map((conversation) => conversation.id);
  if (!conversationIds.length) throw new Error("Offline package does not contain conversations.");
  const packageMeta: OfflinePackageMeta = {
    id: packageId,
    scope: payload.scope,
    scope_id: payload.scope_id,
    catalog_revision: payload.catalog_revision,
    conversation_ids: conversationIds,
    byte_size: compressed.byteLength,
    downloaded_at: now,
  };

  await offlineDb.transaction(
    "rw",
    [offlineDb.conversations, offlineDb.messages, offlineDb.blocks, offlineDb.headings, offlineDb.searchDocuments, offlineDb.annotations, offlineDb.notebooks, offlineDb.readingPositions, offlineDb.packages, offlineDb.outbox],
    async () => {
      const pendingOperations = await offlineDb.outbox.where("conversation_id").anyOf(conversationIds).toArray();
      const pendingAnnotationIds = new Set(
        pendingOperations.filter((item) => item.entity_type === "annotation").map((item) => item.entity_id),
      );
      const pendingNotebookIds = new Set(
        pendingOperations.filter((item) => item.entity_type === "notebook").map((item) => item.entity_id),
      );
      const pendingAnnotations = await offlineDb.annotations.bulkGet(Array.from(pendingAnnotationIds));
      const pendingNotebooks = await offlineDb.notebooks.bulkGet(Array.from(pendingNotebookIds));
      await Promise.all([
        offlineDb.messages.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.blocks.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.headings.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.searchDocuments.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.annotations.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.notebooks.where("conversation_id").anyOf(conversationIds).delete(),
      ]);
      for (const raw of payload.conversations) {
        const messages: OfflineMessageRecord[] = [];
        const blocks: OfflineBlockRecord[] = [];
        for (const message of raw.messages ?? []) {
          const { render_blocks: renderBlocks = [], ...messageWithoutBlocks } = message;
          messages.push({ ...messageWithoutBlocks, conversation_id: raw.id });
          for (const block of renderBlocks) {
            blocks.push({ ...block, key: `${message.id}:${block.block_index}`, conversation_id: raw.id, message_id: message.id });
          }
        }
        const conversation = normalizeOfflineConversation(raw, now);
        await offlineDb.conversations.put(conversation);
        if (messages.length) await offlineDb.messages.bulkPut(messages);
        if (blocks.length) await offlineDb.blocks.bulkPut(blocks);
        if (raw.headings?.length) await offlineDb.headings.bulkPut(raw.headings.map((item) => ({ ...item, conversation_id: raw.id })));
        if (raw.search_documents?.length) await offlineDb.searchDocuments.bulkPut(raw.search_documents.map((item) => ({ ...item, conversation_id: raw.id })));
        if (raw.annotations?.length) await offlineDb.annotations.bulkPut(raw.annotations);
        if (raw.notebook) await offlineDb.notebooks.put(raw.notebook);
        if (raw.reading_position) await offlineDb.readingPositions.put(raw.reading_position);
      }
      const localAnnotations = pendingAnnotations.filter((item): item is AnnotationRead => Boolean(item));
      const localNotebooks = pendingNotebooks.filter((item): item is NotebookRead => Boolean(item));
      if (localAnnotations.length) await offlineDb.annotations.bulkPut(localAnnotations);
      if (localNotebooks.length) await offlineDb.notebooks.bulkPut(localNotebooks);
      await offlineDb.packages.put(packageMeta);
    },
  );
  return packageMeta;
}

export async function removeOfflineConversations(conversationIds: string[]): Promise<void> {
  await offlineDb.transaction(
    "rw",
    [offlineDb.conversations, offlineDb.messages, offlineDb.blocks, offlineDb.headings, offlineDb.searchDocuments, offlineDb.annotations, offlineDb.notebooks, offlineDb.readingPositions, offlineDb.packages],
    async () => {
      await Promise.all([
        offlineDb.conversations.bulkDelete(conversationIds),
        offlineDb.messages.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.blocks.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.headings.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.searchDocuments.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.annotations.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.notebooks.where("conversation_id").anyOf(conversationIds).delete(),
        offlineDb.readingPositions.bulkDelete(conversationIds),
      ]);
      const packages = await offlineDb.packages.toArray();
      for (const item of packages) {
        const remaining = item.conversation_ids.filter((id) => !conversationIds.includes(id));
        if (!remaining.length) await offlineDb.packages.delete(item.id);
        else if (remaining.length !== item.conversation_ids.length) await offlineDb.packages.update(item.id, { conversation_ids: remaining });
      }
    },
  );
}

export async function requestPersistentStorage(): Promise<{ persisted: boolean; quota: number | null; usage: number | null }> {
  const persisted = await navigator.storage?.persist?.().catch(() => false) ?? false;
  const estimate: StorageEstimate | undefined = await navigator.storage?.estimate?.().catch(() => undefined);
  return { persisted, quota: estimate?.quota ?? null, usage: estimate?.usage ?? null };
}

export async function queueOfflineOperation(operation: AnnotationSyncOperation): Promise<void> {
  await offlineDb.outbox.put({ ...operation, queued_at: new Date().toISOString(), attempts: 0, last_error: null });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("chat-reader:outbox"));
}

function normalizeOfflineConversation(raw: PackageConversation, downloadedAt: string): OfflineConversationRecord {
  return {
    id: String(raw.id),
    title: String(raw.title ?? raw.display_title ?? "Conversation"),
    display_title: String(raw.display_title ?? raw.title ?? "Conversation"),
    description_markdown: typeof raw.description_markdown === "string" ? raw.description_markdown : null,
    source_type: String(raw.source_type ?? "offline"),
    source_profile: String(raw.source_profile ?? "offline_package"),
    message_count: Number(raw.message_count ?? raw.messages?.length ?? 0),
    turn_count: Number(raw.turn_count ?? 0),
    created_at: typeof raw.created_at === "string" ? raw.created_at : null,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
    imported_at: typeof raw.imported_at === "string" ? raw.imported_at : null,
    first_user_message: typeof raw.first_user_message === "string" ? raw.first_user_message : null,
    status: String(raw.status ?? "active"),
    is_global_pinned: false,
    global_pinned_at: null,
    last_read_at: null,
    manual_sort_order: 0,
    project_id: typeof raw.project_id === "string" ? raw.project_id : null,
    project_name: typeof raw.project_name === "string" ? raw.project_name : null,
    offline_revision: Number(raw.offline_revision ?? 1),
    external_source_id: null,
    parser_version: "offline-package-v1",
    render_version: Number(raw.render_version ?? 1),
    content_hash: typeof raw.content_hash === "string" ? raw.content_hash : null,
    sort_time: typeof raw.updated_at === "string" ? raw.updated_at : null,
    downloaded_at: downloadedAt,
  };
}
