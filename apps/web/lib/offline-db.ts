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
  AttachmentRead,
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
export type OfflineAttachmentRecord = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  message_version_id: string | null;
  display_name: string;
  original_filename: string;
  declared_mime_type: string | null;
  detected_mime_type: string;
  byte_size: number;
  sha256: string;
  content_path: string | null;
  status?: string;
  scan_status?: string;
  resolution_status?: string;
  occurrences?: Array<{
    message_id: string;
    message_version_id: string;
    occurrence_key: string;
    placement: string;
    relation_type: string;
    display_order: number;
    block_index: number | null;
    display_mode: string;
    alt_text: string | null;
    caption: string | null;
  }>;
};

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
  attachments!: EntityTable<OfflineAttachmentRecord, "id">;

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
    this.version(2).stores({
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
      attachments: "id, conversation_id, message_id, message_version_id",
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
  attachments?: OfflineAttachmentRecord[];
};

type OfflinePackagePayload = {
  format: "chat-reader-offline-package";
  version: 1 | 2 | 3;
  update_mode?: "conversation-delta";
  base_revisions?: Record<string, number>;
  catalog_revision: string;
  scope: "conversation" | "project" | "all";
  scope_id: string | null;
  conversations: PackageConversation[];
};

export async function importOfflinePackage(packageId: string, response: Response): Promise<OfflinePackageMeta> {
  if (!response.ok) throw new Error(`Offline package download failed (${response.status}).`);
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (declaredBytes > 0 && estimate?.quota !== undefined && estimate?.usage !== undefined && declaredBytes > estimate.quota - estimate.usage) {
    throw new Error("Browser storage quota is too small for this offline package.");
  }
  const compressed = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(compressed);
  const packageEntry = entries["package.json"];
  if (!packageEntry) throw new Error("Offline package is missing package.json.");
  const payload = JSON.parse(strFromU8(packageEntry)) as OfflinePackagePayload;
  if (payload.format !== "chat-reader-offline-package" || ![1, 2, 3].includes(payload.version)) {
    throw new Error("Unsupported offline package version.");
  }
  const now = new Date().toISOString();
  const conversationIds = payload.conversations.map((conversation) => conversation.id);
  if (!conversationIds.length && payload.version === 1) {
    throw new Error("Offline package does not contain conversations.");
  }
  const packageMeta: OfflinePackageMeta = {
    id: packageId,
    scope: payload.scope,
    scope_id: payload.scope_id,
    catalog_revision: payload.catalog_revision,
    conversation_ids: conversationIds,
    byte_size: compressed.byteLength,
    downloaded_at: now,
  };

  const cache = await caches.open("chat-reader-offline-assets-v1");
  const cachedUrls = new Set<string>();
  const previousCacheEntries = new Map<string, Response | null>();
  const previousAttachments = conversationIds.length
    ? await offlineDb.attachments.where("conversation_id").anyOf(conversationIds).toArray()
    : [];

  try {
    if (payload.version === 3) {
      for (const conversation of payload.conversations) {
        for (const attachment of conversation.attachments ?? []) {
          if (!attachment.content_path) continue;
          const binary = entries[attachment.content_path];
          if (!binary) throw new Error(`Offline package is missing ${attachment.content_path}.`);
          const digest = await crypto.subtle.digest("SHA-256", binary);
          const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
          if (sha256 !== attachment.sha256 || binary.byteLength !== attachment.byte_size) throw new Error("Offline attachment checksum failed.");
          const url = offlineAttachmentCacheUrl(attachment.id, attachment.sha256);
          if (!previousCacheEntries.has(url)) {
            const previous = await cache.match(url);
            previousCacheEntries.set(url, previous ? previous.clone() : null);
          }
          await cache.put(url, new Response(binary, { headers: { "Content-Type": attachment.detected_mime_type, "Content-Length": String(binary.byteLength) } }));
          cachedUrls.add(url);
        }
      }
    }
    await offlineDb.transaction(
    "rw",
    [offlineDb.conversations, offlineDb.messages, offlineDb.blocks, offlineDb.headings, offlineDb.searchDocuments, offlineDb.annotations, offlineDb.notebooks, offlineDb.readingPositions, offlineDb.packages, offlineDb.outbox, offlineDb.attachments],
    async () => {
      const existingConversations = new Map(
        (await offlineDb.conversations.bulkGet(conversationIds))
          .filter((item): item is OfflineConversationRecord => Boolean(item))
          .map((item) => [item.id, item]),
      );
      const existingPositions = new Map(
        (await offlineDb.readingPositions.bulkGet(conversationIds))
          .filter((item): item is ReadingPositionRead => Boolean(item))
          .map((item) => [item.conversation_id, item]),
      );
      const pendingOperations = conversationIds.length
        ? await offlineDb.outbox.where("conversation_id").anyOf(conversationIds).toArray()
        : [];
      const pendingAnnotationIds = new Set(
        pendingOperations.filter((item) => item.entity_type === "annotation").map((item) => item.entity_id),
      );
      const pendingNotebookIds = new Set(
        pendingOperations.filter((item) => item.entity_type === "notebook").map((item) => item.entity_id),
      );
      const pendingAnnotations = await offlineDb.annotations.bulkGet(Array.from(pendingAnnotationIds));
      const pendingNotebooks = await offlineDb.notebooks.bulkGet(Array.from(pendingNotebookIds));
      if (conversationIds.length) {
        await Promise.all([
          offlineDb.messages.where("conversation_id").anyOf(conversationIds).delete(),
          offlineDb.blocks.where("conversation_id").anyOf(conversationIds).delete(),
          offlineDb.headings.where("conversation_id").anyOf(conversationIds).delete(),
          offlineDb.searchDocuments.where("conversation_id").anyOf(conversationIds).delete(),
          offlineDb.annotations.where("conversation_id").anyOf(conversationIds).delete(),
          offlineDb.notebooks.where("conversation_id").anyOf(conversationIds).delete(),
          offlineDb.attachments.where("conversation_id").anyOf(conversationIds).delete(),
        ]);
      }
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
        conversation.last_read_at = existingConversations.get(raw.id)?.last_read_at ?? conversation.last_read_at;
        await offlineDb.conversations.put(conversation);
        if (messages.length) await offlineDb.messages.bulkPut(messages);
        if (blocks.length) await offlineDb.blocks.bulkPut(blocks);
        if (raw.headings?.length) await offlineDb.headings.bulkPut(raw.headings.map((item) => ({ ...item, conversation_id: raw.id })));
        if (raw.search_documents?.length) await offlineDb.searchDocuments.bulkPut(raw.search_documents.map((item) => ({ ...item, conversation_id: raw.id })));
        if (raw.annotations?.length) await offlineDb.annotations.bulkPut(raw.annotations);
        if (raw.notebook) await offlineDb.notebooks.put(raw.notebook);
        if (raw.reading_position && isNewerReadingPosition(raw.reading_position, existingPositions.get(raw.id))) {
          await offlineDb.readingPositions.put(raw.reading_position);
        }
        if (raw.attachments?.length) {
          await offlineDb.attachments.bulkPut(raw.attachments.map((attachment) => ({ ...attachment, conversation_id: raw.id })));
        }
      }
      const localAnnotations = pendingAnnotations.filter((item): item is AnnotationRead => Boolean(item));
      const localNotebooks = pendingNotebooks.filter((item): item is NotebookRead => Boolean(item));
      if (localAnnotations.length) await offlineDb.annotations.bulkPut(localAnnotations);
      if (localNotebooks.length) await offlineDb.notebooks.bulkPut(localNotebooks);
      await offlineDb.packages.put(packageMeta);
    },
    );
  } catch (error) {
    // Restore the last known-good cache entry for every URL touched before the
    // Dexie transaction committed. Attachment URLs are business-identity
    // keyed, so deleting a failed update's URL could otherwise destroy the
    // previous package's readable original.
    await Promise.all(Array.from(previousCacheEntries, async ([url, previous]) => {
      if (previous) await cache.put(url, previous.clone()).catch(() => undefined);
      else await cache.delete(url).catch(() => false);
    }));
    throw error;
  }
  const retainedCacheUrls = new Set(cachedUrls);
  await Promise.all(
    previousAttachments
      .flatMap(offlineAttachmentCacheUrls)
      .filter((url) => !retainedCacheUrls.has(url))
      .map((url) => cache.delete(url).catch(() => false)),
  );
  return packageMeta;
}

export async function removeOfflineConversations(conversationIds: string[]): Promise<void> {
  const attachments = conversationIds.length
    ? await offlineDb.attachments.where("conversation_id").anyOf(conversationIds).toArray()
    : [];
  await offlineDb.transaction(
    "rw",
    [offlineDb.conversations, offlineDb.messages, offlineDb.blocks, offlineDb.headings, offlineDb.searchDocuments, offlineDb.annotations, offlineDb.notebooks, offlineDb.readingPositions, offlineDb.packages, offlineDb.attachments],
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
        offlineDb.attachments.where("conversation_id").anyOf(conversationIds).delete(),
      ]);
      const packages = await offlineDb.packages.toArray();
      for (const item of packages) {
        const remaining = item.conversation_ids.filter((id) => !conversationIds.includes(id));
        if (!remaining.length) await offlineDb.packages.delete(item.id);
        else if (remaining.length !== item.conversation_ids.length) await offlineDb.packages.update(item.id, { conversation_ids: remaining });
      }
    },
  );
  if (attachments.length) {
    const cache = await caches.open("chat-reader-offline-assets-v1");
    await Promise.all(attachments.flatMap(offlineAttachmentCacheUrls).map((url) => cache.delete(url)));
  }
}

export async function getOfflineAttachment(attachmentId: string): Promise<AttachmentRead> {
  const record = await offlineDb.attachments.get(attachmentId);
  if (!record) throw new Error("Offline attachment metadata was not found.");
  const cached = await readVerifiedCachedAttachment(record);
  return offlineAttachmentRead(record, cached ? URL.createObjectURL(await cached.blob()) : null, Boolean(cached));
}

export async function getOfflineAttachmentBytes(attachmentId: string): Promise<Uint8Array | null> {
  const record = await offlineDb.attachments.get(attachmentId);
  if (!record) return null;
  const response = await readVerifiedCachedAttachment(record);
  return response ? new Uint8Array(await response.arrayBuffer()) : null;
}

export async function listOfflineConversationAttachments(conversationId: string): Promise<AttachmentRead[]> {
  const records = await offlineDb.attachments.where("conversation_id").equals(conversationId).toArray();
  const cached = await Promise.all(records.map(async (record) => Boolean(await readVerifiedCachedAttachment(record))));
  return records
    .map((record, index) => offlineAttachmentRead(record, null, cached[index]))
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

async function readVerifiedCachedAttachment(record: OfflineAttachmentRecord): Promise<Response | null> {
  if (!record.content_path) return null;
  try {
    const cache = await caches.open("chat-reader-offline-assets-v1");
    for (const url of offlineAttachmentCacheUrls(record)) {
      const response = await cache.match(url);
      if (!response) continue;
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (record.byte_size >= 0 && bytes.byteLength !== record.byte_size) {
        await cache.delete(url);
        continue;
      }
      if (record.sha256) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
        if (sha256 !== record.sha256.toLowerCase()) {
          await cache.delete(url);
          continue;
        }
      }
      return response;
    }
    return null;
  } catch {
    return null;
  }
}

export function releaseOfflineAttachmentUrls(attachment?: AttachmentRead | null): void {
  const urls = new Set([attachment?.content_url, attachment?.download_url]);
  urls.forEach((url) => {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  });
}

declare global {
  interface Window {
    __chatReaderPwaNegativeTest?: {
      importOfflinePackage: typeof importOfflinePackage;
    };
  }
}

// Compile-time opt-in only: normal production bundles do not expose a fault
// seam. Release E uses it to exercise the real Cache Storage/IndexedDB path.
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_PWA_NEGATIVE_TESTS === "1") {
  window.__chatReaderPwaNegativeTest = { importOfflinePackage };
}

function offlineAttachmentRead(record: OfflineAttachmentRecord, contentUrl: string | null, cached: boolean): AttachmentRead {
  const occurrences = (record.occurrences ?? []).map((occurrence) => ({
    ...occurrence,
    is_current_version: true,
    block_index: occurrence.block_index,
  }));
  return {
    id: record.id,
    conversation_id: record.conversation_id,
    asset_object: {
      id: record.id,
      sha256: record.sha256,
      byte_size: record.byte_size,
      detected_mime_type: record.detected_mime_type,
      detected_extension: null,
      scan_status: record.scan_status ?? "unscanned",
      status: cached ? "available" : "metadata_only",
    },
    original_filename: record.original_filename,
    display_name: record.display_name,
    declared_mime_type: record.declared_mime_type,
    status: record.status ?? (record.resolution_status === "missing" ? "missing" : "available"),
    scan_status: record.scan_status ?? "unscanned",
    source_type: "offline_package",
    source_attachment_id: record.id,
    metadata: { offline_resource_available: cached },
    resolution_status: record.resolution_status === "missing"
      ? "missing"
      : cached
        ? "resolved"
        : "offline_unavailable",
    created_at: new Date(0).toISOString(),
    occurrence_count: occurrences.length,
    current_occurrence_count: occurrences.length,
    message_count: new Set(occurrences.map((occurrence) => occurrence.message_id)).size,
    is_used: occurrences.length > 0,
    occurrences,
    content_url: contentUrl,
    download_url: contentUrl,
  };
}

function offlineAttachmentCacheUrls(record: Pick<OfflineAttachmentRecord, "id" | "sha256">): string[] {
  return [
    offlineAttachmentCacheUrl(record.id, record.sha256),
    offlineAttachmentCacheUrl(record.id),
  ];
}

function offlineAttachmentCacheUrl(attachmentId: string, sha256?: string): string {
  const base = `https://offline.chat-reader.local/assets/${encodeURIComponent(attachmentId)}`;
  return sha256 ? `${base}/${encodeURIComponent(sha256.toLowerCase())}` : base;
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

export async function syncOfflineAnnotationSearch(annotation: AnnotationRead): Promise<void> {
  const existing = await offlineDb.searchDocuments.where("document_type").equals("annotation").filter((item) => item.metadata?.annotation_id === annotation.id).toArray();
  if (existing.length) await offlineDb.searchDocuments.bulkDelete(existing.map((item) => item.id));
  if (annotation.is_deleted) return;
  const plainText = [annotation.comment_markdown, annotation.quote].filter(Boolean).join(" ").trim();
  if (!plainText) return;
  const conversation = await offlineDb.conversations.get(annotation.conversation_id);
  await offlineDb.searchDocuments.put({
    id: `local-annotation:${annotation.id}`,
    conversation_id: annotation.conversation_id,
    message_id: annotation.message_id,
    document_type: "annotation",
    role: null,
    title: conversation?.display_title ?? conversation?.title ?? "Conversation",
    plain_text: plainText,
    search_text: plainText,
    order_key: typeof annotation.metadata.message_order_key === "string" ? annotation.metadata.message_order_key : null,
    turn_index: null,
    metadata: {
      annotation_id: annotation.id,
      annotation_type: annotation.annotation_type,
      annotation_color: annotation.color,
      block_index: annotation.start_block_index,
      character_offset: annotation.start_offset,
      anchor_status: annotation.anchor_status,
    },
  });
}

export async function clearOfflineAnnotationSearch(conversationId: string): Promise<void> {
  const stale = await offlineDb.searchDocuments
    .where("document_type")
    .equals("annotation")
    .filter((item) => item.conversation_id === conversationId)
    .primaryKeys();
  if (stale.length) await offlineDb.searchDocuments.bulkDelete(stale);
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

function isNewerReadingPosition(incoming: ReadingPositionRead, current?: ReadingPositionRead): boolean {
  if (!current) return true;
  const incomingTimestamp = Date.parse(incoming.updated_at);
  const currentTimestamp = Date.parse(current.updated_at);
  if (!Number.isFinite(incomingTimestamp)) return false;
  if (!Number.isFinite(currentTimestamp)) return true;
  return incomingTimestamp > currentTimestamp;
}
