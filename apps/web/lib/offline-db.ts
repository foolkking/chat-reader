import Dexie, { type DBCoreTransaction, type EntityTable } from "dexie";
import { unzipSync, strFromU8 } from "fflate";
import { assertOfflineAccess, captureOfflineAccess, lockOfflineAccess } from "./offline-access";
import { assertOfflineWritable } from "./offline-write-guard";
import { ingestReadingPosition } from "./reading-position-sync";
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
  offline_asset_mode?: "none" | "small" | "all";
};

export type OfflineMessageRecord = Omit<MessageListItem, "render_blocks"> & { conversation_id: string };
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
  /** IndexedDB omits this when it is identical to plain_text to avoid storing
   * every search document twice. The worker falls back to plain_text. */
  search_text?: string;
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
export type OfflineOutboxRecord = Omit<AnnotationSyncOperation, "entity_type"> & { entity_type: AnnotationSyncOperation["entity_type"] | "reading_position"; queued_at: string; attempts: number; last_error: string | null; submitted?: boolean; retry_after?: number };
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
  downloadable?: boolean;
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
    render_block_id?: string | null;
    start_offset?: number | null;
    end_offset?: number | null;
    display_mode: string;
    alt_text: string | null;
    caption: string | null;
  }>;
};

const protectedTransactions = new Set<DBCoreTransaction>();

function abortProtectedTransactions(): void {
  for (const transaction of protectedTransactions) { try { transaction.abort(); } catch { /* Already settled. */ } }
  protectedTransactions.clear();
}

export class OfflineLibraryDatabase extends Dexie {
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

  constructor(databaseName: string) {
    super(databaseName);
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
    const isCurrentDatabase = () => this === offlineDb;
    this.use({ stack: "dbcore", name: "protected-offline-access", create: (core) => {
      const tickets = new WeakMap<DBCoreTransaction, number>();
      function guard(transaction: DBCoreTransaction): number {
        const ticket = tickets.get(transaction) ?? captureOfflineAccess();
        assertOfflineAccess(ticket);
        if (!isCurrentDatabase()) throw new Error("Offline account changed. Open the current library again.");
        return ticket;
      }
      function checked<T>(transaction: DBCoreTransaction, operation: () => Promise<T>): Promise<T> {
        const ticket = guard(transaction);
        return operation().then((value) => { assertOfflineAccess(ticket); guard(transaction); return value; });
      }
      return { ...core,
        transaction(stores, mode, options) {
          const ticket = captureOfflineAccess();
          if (mode === "readwrite") assertOfflineWritable(getActiveOfflineStorageContext().userId);
          if (!isCurrentDatabase()) throw new Error("Offline account changed.");
          const transaction = core.transaction(stores, mode, options);
          tickets.set(transaction, ticket);
          protectedTransactions.add(transaction);
          const raw = transaction as IDBTransaction;
          raw.addEventListener("complete", () => protectedTransactions.delete(transaction), { once: true });
          raw.addEventListener("abort", () => protectedTransactions.delete(transaction), { once: true });
          return transaction;
        },
        table(name) {
          const table = core.table(name);
          return { ...table,
            get: (request) => checked(request.trans, () => table.get(request)),
            getMany: (request) => checked(request.trans, () => table.getMany(request)),
            query: (request) => checked(request.trans, () => table.query(request)),
            count: (request) => checked(request.trans, () => table.count(request)),
            openCursor: (request) => checked(request.trans, () => table.openCursor(request)),
            mutate: (request) => checked(request.trans, () => {
              try { assertOfflineWritable(getActiveOfflineStorageContext().userId); }
              catch (error) { request.trans.abort(); throw error; }
              return table.mutate(request);
            }),
          };
        },
      };
    } });
  }
}

const LEGACY_OFFLINE_DATABASE_NAME = "chat-reader-offline-library";
const OFFLINE_DATABASE_PREFIX = `${LEGACY_OFFLINE_DATABASE_NAME}--`;
const LEGACY_OFFLINE_ASSET_CACHE_NAME = "chat-reader-offline-assets-v1";
const OFFLINE_ASSET_CACHE_PREFIX = `${LEGACY_OFFLINE_ASSET_CACHE_NAME}--`;
const ACTIVE_OFFLINE_USER_KEY = "chat-reader:offline-active-user-v1";
const LEGACY_OFFLINE_OWNER_KEY = "chat-reader:offline-legacy-owner-v1";
const LOCAL_DEFAULT_USER = "local:default";

export type OfflineStorageContext = {
  userId: string | null;
  namespace: string;
  databaseName: string;
  assetCacheName: string;
  usesLegacyStorage: boolean;
};

let activeOfflineContext: OfflineStorageContext = legacyOfflineStorageContext(null);
export let offlineDb = new OfflineLibraryDatabase(activeOfflineContext.databaseName);
const attachmentObjectUrls = new Set<string>();

export function lockProtectedOfflineData(notify = true): void {
  abortProtectedTransactions();
  lockOfflineAccess(notify);
  offlineDb.close();
  // Keep persisted owner bindings and the real database/cache. The disconnected
  // handle cannot auto-open a former account's data while authentication runs.
  activeOfflineContext = { userId: null, namespace: "locked", databaseName: "chat-reader-offline-locked", assetCacheName: "chat-reader-offline-locked", usesLegacyStorage: false };
  offlineDb = new OfflineLibraryDatabase(activeOfflineContext.databaseName);
  offlineDb.close();
  for (const url of attachmentObjectUrls) URL.revokeObjectURL(url);
  attachmentObjectUrls.clear();
}

export function getActiveOfflineStorageContext(): OfflineStorageContext {
  return { ...activeOfflineContext };
}

export function readPersistedOfflineUserId(): string | null {
  if (typeof window === "undefined") return null;
  try { return normalizeOfflineUserId(window.localStorage.getItem(ACTIVE_OFFLINE_USER_KEY)); } catch { return null; }
}

export async function activateProtectedOfflineData(
  userId: string | null | undefined,
  options: { openDatabase?: boolean; claimLegacy?: boolean; signal?: AbortSignal } = {},
): Promise<OfflineStorageContext> {
  const normalizedUserId = normalizeOfflineUserId(userId) ?? LOCAL_DEFAULT_USER;
  const context = await resolveOfflineStorageContext(normalizedUserId, { claimLegacy: options.claimLegacy }).catch((error: unknown) => {
    if (options.openDatabase !== false) throw error;
    // Online authentication does not require browser persistence. When it is
    // unavailable, use only the verified account's namespace, never legacy data.
    return namespacedOfflineStorageContext(normalizedUserId);
  });
  options.signal?.throwIfAborted();
  if (activeOfflineContext.userId === normalizedUserId && offlineDb.name === context.databaseName) {
    if (options.openDatabase !== false) await offlineDb.open();
    options.signal?.throwIfAborted();
    return getActiveOfflineStorageContext();
  }

  const nextDb = new OfflineLibraryDatabase(context.databaseName);
  if (options.openDatabase !== false) await nextDb.open();
  if (options.signal?.aborted) {
    nextDb.close();
    options.signal.throwIfAborted();
  }
  offlineDb.close();
  offlineDb = nextDb;
  abortProtectedTransactions();
  lockOfflineAccess(false);
  activeOfflineContext = context;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(ACTIVE_OFFLINE_USER_KEY, normalizedUserId); } catch {
      // The scoped in-memory pointer is sufficient for online use.
    }
  }
  return getActiveOfflineStorageContext();
}

export async function clearProtectedOfflineData(userId?: string | null, notify = true): Promise<OfflineStorageContext> {
  const context = await captureProtectedOfflineStorageContext(userId);
  const persistedUserId = context.userId;
  if (offlineDb.name === context.databaseName || activeOfflineContext.userId === null) lockProtectedOfflineData(notify);
  if (typeof window !== "undefined") {
    try {
      if (readPersistedOfflineUserId() === persistedUserId) window.localStorage.removeItem(ACTIVE_OFFLINE_USER_KEY);
      // Keep the legacy owner binding if deletion is blocked by another tab.
    } catch { /* Browser storage may already be unavailable. */ }
  }
  await deleteProtectedOfflineStorage(context);
  return context;
}

export async function captureProtectedOfflineStorageContext(userId?: string | null): Promise<OfflineStorageContext> {
  const persistedUserId = normalizeOfflineUserId(userId) ?? readPersistedOfflineUserId() ?? activeOfflineContext.userId;
  if (persistedUserId && activeOfflineContext.userId === persistedUserId) return getActiveOfflineStorageContext();
  const context = persistedUserId
    ? await resolveOfflineStorageContext(persistedUserId, { claimLegacy: false }).catch(() => (
      activeOfflineContext.userId === persistedUserId ? getActiveOfflineStorageContext() : namespacedOfflineStorageContext(persistedUserId)
    ))
    : getActiveOfflineStorageContext();
  return context;
}

// Operates on an already captured account context, including after signout has
// cleared the active account pointer. A failed deletion must stay retryable.
export async function deleteProtectedOfflineStorage(context: OfflineStorageContext): Promise<void> {
  const results = await Promise.allSettled([
    Dexie.delete(context.databaseName),
    ...(typeof caches !== "undefined" ? [caches.delete(context.assetCacheName)] : []),
  ]);
  if (results.some((result) => result.status === "rejected")) throw new Error("Protected browser data could not be cleared.");
}

function normalizeOfflineUserId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : null;
}

function offlineNamespaceForUser(userId: string): string {
  const bytes = new TextEncoder().encode(userId);
  return `user-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function legacyOfflineStorageContext(userId: string | null): OfflineStorageContext {
  return {
    userId,
    namespace: "legacy",
    databaseName: LEGACY_OFFLINE_DATABASE_NAME,
    assetCacheName: LEGACY_OFFLINE_ASSET_CACHE_NAME,
    usesLegacyStorage: true,
  };
}

function namespacedOfflineStorageContext(userId: string): OfflineStorageContext {
  const namespace = offlineNamespaceForUser(userId);
  return {
    userId,
    namespace,
    databaseName: `${OFFLINE_DATABASE_PREFIX}${namespace}`,
    assetCacheName: `${OFFLINE_ASSET_CACHE_PREFIX}${namespace}`,
    usesLegacyStorage: false,
  };
}

async function resolveOfflineStorageContext(
  userId: string,
  options: { claimLegacy?: boolean } = {},
): Promise<OfflineStorageContext> {
  if (typeof window === "undefined") return namespacedOfflineStorageContext(userId);
  const claimLegacy = options.claimLegacy ?? true;
  const legacyOwner = normalizeOfflineUserId(window.localStorage.getItem(LEGACY_OFFLINE_OWNER_KEY));
  const persistedUser = readPersistedOfflineUserId();

  // A previous single-owner offline lease had no user id. Once that same
  // browser verifies the migrated account online, transfer the logical owner
  // binding to the real User UUID without copying a potentially large DB.
  if (claimLegacy && legacyOwner === LOCAL_DEFAULT_USER && persistedUser === LOCAL_DEFAULT_USER && userId !== LOCAL_DEFAULT_USER) {
    window.localStorage.setItem(LEGACY_OFFLINE_OWNER_KEY, userId);
    return legacyOfflineStorageContext(userId);
  }
  if (legacyOwner === userId) return legacyOfflineStorageContext(userId);
  if (!legacyOwner && claimLegacy && await Dexie.exists(LEGACY_OFFLINE_DATABASE_NAME)) {
    window.localStorage.setItem(LEGACY_OFFLINE_OWNER_KEY, userId);
    return legacyOfflineStorageContext(userId);
  }
  return namespacedOfflineStorageContext(userId);
}

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
  asset_mode?: "none" | "small" | "all";
  update_mode?: "conversation-delta";
  base_revisions?: Record<string, number>;
  catalog_revision: string;
  scope: "conversation" | "project" | "all";
  scope_id: string | null;
  conversations: PackageConversation[];
};

export type OfflinePackageImportErrorCode = "DOWNLOAD" | "QUOTA" | "MALFORMED" | "STORAGE_WRITE";

export class OfflinePackageImportError extends Error {
  constructor(
    public readonly code: OfflinePackageImportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OfflinePackageImportError";
  }
}

function validateOfflinePackageMessageCounts(payload: OfflinePackagePayload): void {
  for (const conversation of payload.conversations) {
    if (!Array.isArray(conversation.messages)) {
      // v1 packages may omit the embedded array; preserve their legacy
      // metadata-only compatibility. Newer package versions must carry the
      // records that their aggregate claims to describe.
      if (payload.version === 1) continue;
      throw new OfflinePackageImportError("MALFORMED", "Offline package conversation is missing message records.");
    }
    const declared = conversation.message_count;
    // Early v1 packages did not require this aggregate. When it is present,
    // however, it is the package's completeness contract and must agree with
    // the embedded records before any previous offline copy is touched.
    if (declared === undefined || declared === null) continue;
    const expected = Number(declared);
    if (!Number.isSafeInteger(expected) || expected < 0 || expected !== conversation.messages.length) {
      throw new OfflinePackageImportError("MALFORMED", "Offline package message count does not match its message records.");
    }
  }
}

function validateOfflinePackageStoreShape(payload: OfflinePackagePayload): void {
  // v1 packages intentionally remain permissive because early exports did not
  // include every derived store. v2+ packages must declare each store they
  // claim to contain so a malformed package cannot look like an empty Reader.
  if (payload.version === 1) return;
  const stores = ["messages", "headings", "search_documents", "annotations"] as const;
  payload.conversations.forEach((conversation, index) => {
    for (const store of stores) {
      if (!Array.isArray(conversation[store])) {
        throw new OfflinePackageImportError("MALFORMED", `Offline package schema mismatch: conversations[${index}].${store} must be an array.`);
      }
    }
    if (conversation.notebook !== null && conversation.notebook !== undefined && typeof conversation.notebook !== "object") {
      throw new OfflinePackageImportError("MALFORMED", `Offline package schema mismatch: conversations[${index}].notebook must be an object or null.`);
    }
    if (conversation.reading_position !== null && conversation.reading_position !== undefined && typeof conversation.reading_position !== "object") {
      throw new OfflinePackageImportError("MALFORMED", `Offline package schema mismatch: conversations[${index}].reading_position must be an object or null.`);
    }
    if (payload.version === 3 && conversation.attachments !== undefined && !Array.isArray(conversation.attachments)) {
      throw new OfflinePackageImportError("MALFORMED", `Offline package schema mismatch: conversations[${index}].attachments must be an array.`);
    }
  });
}

type BulkPutTable<T> = { bulkPut(items: T[]): Promise<unknown> };

const OFFLINE_STORAGE_FIXED_RESERVE_BYTES = 1024 * 1024;
const OFFLINE_JSON_INDEXED_DB_MULTIPLIER = 2.25;
const OFFLINE_ASSET_CACHE_MULTIPLIER = 1.05;
const OFFLINE_INDEX_BYTES_PER_RECORD = 384;

async function bulkPutChunked<T>(table: BulkPutTable<T>, items: T[], chunkSize = 100): Promise<void> {
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    await table.bulkPut(items.slice(offset, offset + chunkSize));
  }
}

async function inspectOfflineBulkPutChunking(itemCount: number): Promise<number[]> {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > 100_000) {
    throw new Error("Offline chunk probe item count is out of bounds.");
  }
  const batchSizes: number[] = [];
  await bulkPutChunked(
    { bulkPut: async (items: number[]) => { batchSizes.push(items.length); } },
    Array.from({ length: itemCount }, (_, index) => index),
  );
  return batchSizes;
}

function estimateOfflineStorageBytes(
  payload: OfflinePackagePayload,
  entries: ReturnType<typeof unzipSync>,
): number {
  const packageJsonBytes = entries["package.json"]?.byteLength ?? 0;
  const assetBytes = Object.entries(entries).reduce(
    (sum, [name, value]) => sum + (name === "package.json" ? 0 : value.byteLength),
    0,
  );
  let recordCount = 1; // package metadata
  for (const conversation of payload.conversations) {
    const messages = conversation.messages ?? [];
    recordCount += 1
      + messages.length
      + messages.reduce((sum, message) => sum + (message.render_blocks?.length ?? 0), 0)
      + (conversation.headings?.length ?? 0)
      + (conversation.search_documents?.length ?? 0)
      + (conversation.annotations?.length ?? 0)
      + (conversation.notebook ? 1 : 0)
      + (conversation.reading_position ? 1 : 0)
      + (conversation.attachments?.length ?? 0);
  }
  return Math.ceil(
    OFFLINE_STORAGE_FIXED_RESERVE_BYTES
      + packageJsonBytes * OFFLINE_JSON_INDEXED_DB_MULTIPLIER
      + assetBytes * OFFLINE_ASSET_CACHE_MULTIPLIER
      + recordCount * OFFLINE_INDEX_BYTES_PER_RECORD,
  );
}

export async function importOfflinePackage(packageId: string, response: Response, options: { signal?: AbortSignal; onWriting?: () => void } = {}): Promise<OfflinePackageMeta> {
  options.signal?.throwIfAborted();
  const access = captureOfflineAccess();
  const db = offlineDb;
  const context = getActiveOfflineStorageContext();
  if (!response.ok) throw new OfflinePackageImportError("DOWNLOAD", `Offline package download failed (${response.status}).`);
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (declaredBytes > 0 && estimate?.quota !== undefined && estimate?.usage !== undefined && declaredBytes > estimate.quota - estimate.usage) {
    throw new OfflinePackageImportError("QUOTA", "Browser storage quota is too small for this offline package.");
  }
  const compressed = new Uint8Array(await response.arrayBuffer());
  options.signal?.throwIfAborted();
  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(compressed);
  } catch (cause) {
    throw new OfflinePackageImportError("MALFORMED", "Offline package archive could not be read.", { cause });
  }
  const packageEntry = entries["package.json"];
  if (!packageEntry) throw new OfflinePackageImportError("MALFORMED", "Offline package is missing package.json.");
  let payload: OfflinePackagePayload;
  try {
    payload = JSON.parse(strFromU8(packageEntry)) as OfflinePackagePayload;
  } catch (cause) {
    throw new OfflinePackageImportError("MALFORMED", "Offline package metadata could not be read.", { cause });
  }
  if (payload.format !== "chat-reader-offline-package" || ![1, 2, 3].includes(payload.version)) {
    throw new OfflinePackageImportError("MALFORMED", "Unsupported offline package version.");
  }
  if (!Array.isArray(payload.conversations)) throw new OfflinePackageImportError("MALFORMED", "Offline package does not contain a valid conversation list.");
  validateOfflinePackageStoreShape(payload);
  validateOfflinePackageMessageCounts(payload);
  const now = new Date().toISOString();
  const conversationIds = payload.conversations.map((conversation) => conversation.id);
  if (!conversationIds.length && payload.version === 1) {
    throw new OfflinePackageImportError("MALFORMED", "Offline package does not contain conversations.");
  }
  // ZIP size can be much smaller than the IndexedDB footprint. Account for
  // the expanded JSON/assets before opening a write transaction so a quota
  // failure is reported immediately instead of aborting halfway through a
  // thousands-of-documents bulk write.
  const requiredStorageBytes = estimateOfflineStorageBytes(payload, entries);
  const currentEstimate = await navigator.storage?.estimate?.().catch(() => estimate);
  if (currentEstimate?.quota !== undefined && currentEstimate.usage !== undefined && requiredStorageBytes > currentEstimate.quota - currentEstimate.usage) {
    throw new OfflinePackageImportError("QUOTA", "Browser storage quota is too small for this offline package.");
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

  assertOfflineAccess(access);
  const cache = await caches.open(context.assetCacheName);
  const cachedUrls = new Set<string>();
  const previousCacheEntries = new Map<string, Response | null>();
  const previousAttachments = conversationIds.length
    ? await db.attachments.where("conversation_id").anyOf(conversationIds).toArray()
    : [];

  try {
    options.onWriting?.();
    if (payload.version === 3) {
      for (const conversation of payload.conversations) {
        for (const attachment of conversation.attachments ?? []) {
          if (!attachment.content_path) continue;
          const binary = entries[attachment.content_path];
          if (!binary) throw new OfflinePackageImportError("MALFORMED", `Offline package is missing ${attachment.content_path}.`);
          if (binary.byteLength !== attachment.byte_size) throw new OfflinePackageImportError("MALFORMED", "Offline attachment size validation failed.");
          const url = offlineAttachmentCacheUrl(attachment.id, attachment.sha256);
          if (!previousCacheEntries.has(url)) {
            const previous = await cache.match(url);
            previousCacheEntries.set(url, previous ? previous.clone() : null);
          }
          assertOfflineAccess(access);
          options.signal?.throwIfAborted();
          await cache.put(url, new Response(binary, { headers: { "Content-Type": attachment.detected_mime_type, "Content-Length": String(binary.byteLength) } }));
          cachedUrls.add(url);
        }
      }
    }
    assertOfflineAccess(access);
    await db.transaction(
    "rw",
    [db.conversations, db.messages, db.blocks, db.headings, db.searchDocuments, db.annotations, db.notebooks, db.readingPositions, db.packages, db.outbox, db.attachments, db.settings],
    async () => {
      options.signal?.throwIfAborted();
      const transaction = Dexie.currentTransaction!;
      const abort = () => transaction.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      transaction.on("complete", () => options.signal?.removeEventListener("abort", abort));
      transaction.on("abort", () => options.signal?.removeEventListener("abort", abort));
      const existingConversations = new Map(
        (await db.conversations.bulkGet(conversationIds))
          .filter((item): item is OfflineConversationRecord => Boolean(item))
          .map((item) => [item.id, item]),
      );
      const pendingOperations = conversationIds.length
        ? await db.outbox.where("conversation_id").anyOf(conversationIds).toArray()
        : [];
      const pendingAnnotationIds = new Set(
        pendingOperations.filter((item) => item.entity_type === "annotation").map((item) => item.entity_id),
      );
      const pendingNotebookIds = new Set(
        pendingOperations.filter((item) => item.entity_type === "notebook").map((item) => item.entity_id),
      );
      const pendingNotebookConversations = new Set(
        pendingOperations.filter((item) => item.entity_type === "notebook").map((item) => item.conversation_id),
      );
      // A conflicted operation has a durable receipt and may have no outbox
      // descendants. Package refresh must still preserve its working rows,
      // including while a resolution is awaiting acknowledgment.
      const conflictMarkers = await db.settings.where("key").startsWith("sync-conflict:").toArray();
      for (const row of conflictMarkers) {
        const marker = row.value as { entity_type: string; conversation_id: string; entity_id: string; local_entity_id: string; conflict_copy_id: string };
        if (!conversationIds.includes(marker.conversation_id)) continue;
        const ids = marker.entity_type === "notebook" ? pendingNotebookIds : pendingAnnotationIds;
        for (const id of [marker.entity_id, marker.local_entity_id, marker.conflict_copy_id]) if (id) ids.add(id);
        if (marker.entity_type === "notebook") pendingNotebookConversations.add(marker.conversation_id);
      }
      const pendingAnnotations = await db.annotations.bulkGet(Array.from(pendingAnnotationIds));
      const pendingNotebooks = await db.notebooks.bulkGet(Array.from(pendingNotebookIds));
      if (conversationIds.length) {
        await Promise.all([
          db.messages.where("conversation_id").anyOf(conversationIds).delete(),
          db.blocks.where("conversation_id").anyOf(conversationIds).delete(),
          db.headings.where("conversation_id").anyOf(conversationIds).delete(),
          db.searchDocuments.where("conversation_id").anyOf(conversationIds).delete(),
          db.annotations.where("conversation_id").anyOf(conversationIds).delete(),
          db.notebooks.where("conversation_id").anyOf(conversationIds).delete(),
          db.attachments.where("conversation_id").anyOf(conversationIds).delete(),
        ]);
      }
      for (const raw of payload.conversations) {
        const messages: OfflineMessageRecord[] = [];
        const blocks: OfflineBlockRecord[] = [];
        for (const message of raw.messages ?? []) {
          const { render_blocks: renderBlocks = [], ...messageWithoutBlocks } = message;
          // Normalize identifiers at the package boundary. Older packages
          // were produced before every serializer guaranteed string UUIDs;
          // keeping the value explicitly string here also makes the
          // conversation index deterministic across browsers.
          messages.push({
            ...messageWithoutBlocks,
            id: String(message.id),
            conversation_id: String(raw.id),
            current_version: message.current_version
              ? { ...message.current_version, id: String(message.current_version.id) }
              : null,
          });
          for (const block of renderBlocks) {
            blocks.push({
              ...block,
              id: block.id ? String(block.id) : block.id,
              key: `${String(message.id)}:${block.block_index}`,
              conversation_id: String(raw.id),
              message_id: String(message.id),
            });
          }
        }
        const conversation = normalizeOfflineConversation(raw, now);
        conversation.offline_asset_mode = payload.asset_mode ?? (payload.version === 3 ? "all" : undefined);
        conversation.last_read_at = existingConversations.get(raw.id)?.last_read_at ?? conversation.last_read_at;
        await db.conversations.put(conversation);
        // Keep IndexedDB request batches bounded. Large exports can contain
        // tens of thousands of search documents; queuing every request in one
        // transaction causes Chromium to abort the transaction mid-write
        // (often reported as "N of M operations failed"). Chunking preserves
        // the package transaction/rollback semantics while avoiding oversized
        // request queues.
        if (messages.length) await bulkPutChunked(db.messages, messages);
        // A package that advertises messages but writes none is corrupt. Do
        // not leave a misleading conversation shell in IndexedDB: fail the
        // package transaction so the previous offline copy remains intact.
        if (messages.length) {
          let storedCount = await db.messages.where("conversation_id").equals(String(raw.id)).count();
          if (storedCount === 0) {
            storedCount = (await db.messages.toArray()).filter((item) => String(item.conversation_id) === String(raw.id)).length;
          }
          if (storedCount < messages.length) throw new OfflinePackageImportError("STORAGE_WRITE", "Offline package message records could not be verified.");
        }
        if (blocks.length) await bulkPutChunked(db.blocks, blocks);
        if (raw.headings?.length) await bulkPutChunked(db.headings, raw.headings.map((item) => ({ ...item, conversation_id: raw.id })));
        if (raw.search_documents?.length) {
          const documents = raw.search_documents.map((item) => {
            const { search_text, ...rest } = item;
            return {
              ...rest,
              ...(search_text && search_text !== item.plain_text ? { search_text } : {}),
              conversation_id: raw.id,
            };
          });
          await bulkPutChunked(db.searchDocuments, documents);
        }
        if (raw.annotations?.length) await bulkPutChunked(db.annotations, raw.annotations);
        if (raw.notebook && !pendingNotebookConversations.has(raw.id)) await db.notebooks.put(raw.notebook);
        if (raw.reading_position) await ingestReadingPosition(raw.id, raw.reading_position, db);
        if (raw.attachments?.length) {
          await bulkPutChunked(db.attachments, raw.attachments.map((attachment) => ({ ...attachment, conversation_id: raw.id })));
        }
      }
      const localAnnotations = pendingAnnotations.filter((item): item is AnnotationRead => Boolean(item));
      const localNotebooks = pendingNotebooks.filter((item): item is NotebookRead => Boolean(item));
      if (localAnnotations.length) await bulkPutChunked(db.annotations, localAnnotations);
      for (const annotation of localAnnotations) await syncOfflineAnnotationSearch(annotation, db);
      if (localNotebooks.length) await bulkPutChunked(db.notebooks, localNotebooks);
      await db.packages.put(packageMeta);
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
    const errorName = error instanceof Error ? error.name : "";
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorName === "QuotaExceededError") {
      throw new OfflinePackageImportError("QUOTA", "Browser storage quota is too small for this offline package.", { cause: error });
    }
    if (errorName === "AbortError" || /transaction was aborted|operations failed/i.test(errorMessage)) {
      throw new OfflinePackageImportError("STORAGE_WRITE", "Offline package storage transaction was aborted.", { cause: error });
    }
    throw error;
  }
  const retainedCacheUrls = new Set(cachedUrls);
  // A lower download tier never clears files that are already available.
  for (const raw of payload.conversations) for (const attachment of raw.attachments ?? []) {
    for (const url of offlineAttachmentCacheUrls(attachment)) retainedCacheUrls.add(url);
  }
  await Promise.all(
    previousAttachments
      .flatMap(offlineAttachmentCacheUrls)
      .filter((url) => !retainedCacheUrls.has(url))
      .map((url) => cache.delete(url).catch(() => false)),
  );
  return packageMeta;
}

export class OfflinePendingChangesError extends Error {
  constructor(readonly count: number) {
    super("Unsynced changes must be resolved before deleting this offline copy.");
    this.name = "OfflinePendingChangesError";
  }
}

export class OfflineDownloadInProgressError extends Error {
  constructor() { super("Wait for the download to finish or cancel it before clearing local data."); this.name = "OfflineDownloadInProgressError"; }
}

async function assertNoActiveOfflineDownload(db: OfflineLibraryDatabase): Promise<void> {
  const active = await db.settings.where("key").startsWith("offline-download:").filter((row) =>
    ["queued", "generating", "downloading", "writing"].includes((row.value as { state: string }).state)).count();
  if (active) throw new OfflineDownloadInProgressError();
}

export async function removeOfflineConversations(conversationIds: string[], reviewedFingerprint?: string): Promise<void> {
  return withOfflineDataWrite(() => removeOfflineConversationsUnlocked(conversationIds, reviewedFingerprint));
}

async function withOfflineDataWrite(work: () => Promise<void>): Promise<void> {
  const access = captureOfflineAccess(), db = offlineDb;
  await assertNoActiveOfflineDownload(db);
  const run = async () => { assertOfflineAccess(access); await assertNoActiveOfflineDownload(db); await work(); };
  const synchronize = () => navigator.locks ? navigator.locks.request(`chat-reader:sync:${db.name}`, run) : run();
  if (navigator.locks) await navigator.locks.request(`chat-reader:downloads:${db.name}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new OfflineDownloadInProgressError();
    await synchronize();
  });
  else await synchronize();
}

async function verifyReviewedPending(conversationIds: string[], reviewedFingerprint?: string): Promise<void> {
  if (reviewedFingerprint === undefined) {
    const pending = await countOfflinePendingChanges(conversationIds);
    if (pending) throw new OfflinePendingChangesError(pending);
    return;
  }
  // Keep the containing write transaction alive while hashing. New edits cannot
  // slip between the reviewed snapshot check and removal of the selected rows.
  const { readOfflinePending, OfflinePendingChangedError } = await Dexie.waitFor(import("./offline-pending"));
  const snapshot = await Dexie.waitFor(readOfflinePending(conversationIds));
  if (snapshot.fingerprint !== reviewedFingerprint) throw new OfflinePendingChangedError();
}

async function removeOfflineConversationsUnlocked(conversationIds: string[], reviewedFingerprint?: string): Promise<void> {
  const access = captureOfflineAccess();
  const db = offlineDb;
  const context = getActiveOfflineStorageContext();
  const attachments = conversationIds.length
    ? await db.attachments.where("conversation_id").anyOf(conversationIds).toArray()
    : [];
  await db.transaction(
    "rw",
    [db.conversations, db.messages, db.blocks, db.headings, db.searchDocuments, db.annotations, db.notebooks, db.readingPositions, db.packages, db.attachments, db.outbox, db.settings],
    async () => {
      await assertNoActiveOfflineDownload(db);
      await verifyReviewedPending(conversationIds, reviewedFingerprint);
      const conflictKeys = await db.settings.where("key").startsWith("sync-conflict:")
        .filter((row) => conversationIds.includes((row.value as { conversation_id: string }).conversation_id)).primaryKeys();
      await db.settings.bulkDelete(conflictKeys.map((key) => `sync-resolution-draft:${key}`));
      await Promise.all([
        db.conversations.bulkDelete(conversationIds),
        db.messages.where("conversation_id").anyOf(conversationIds).delete(),
        db.blocks.where("conversation_id").anyOf(conversationIds).delete(),
        db.headings.where("conversation_id").anyOf(conversationIds).delete(),
        db.searchDocuments.where("conversation_id").anyOf(conversationIds).delete(),
        db.annotations.where("conversation_id").anyOf(conversationIds).delete(),
        db.notebooks.where("conversation_id").anyOf(conversationIds).delete(),
        db.readingPositions.bulkDelete(conversationIds),
        db.attachments.where("conversation_id").anyOf(conversationIds).delete(),
        db.outbox.where("conversation_id").anyOf(conversationIds).delete(),
        db.settings.filter((row) => (row.key.startsWith("sync-conflict:") || row.key.startsWith("notebook-draft:") || row.key.startsWith("reading-sync:"))
          && conversationIds.includes((row.value as { conversation_id: string }).conversation_id)).delete(),
      ]);
      const packages = await db.packages.toArray();
      for (const item of packages) {
        const remaining = item.conversation_ids.filter((id) => !conversationIds.includes(id));
        if (!remaining.length) await db.packages.delete(item.id);
        else if (remaining.length !== item.conversation_ids.length) await db.packages.update(item.id, { conversation_ids: remaining });
      }
    },
  );
  if (attachments.length) {
    assertOfflineAccess(access);
    const cache = await caches.open(context.assetCacheName);
    await Promise.all(attachments.flatMap(offlineAttachmentCacheUrls).map((url) => cache.delete(url)));
  }
}

export async function getOfflineAttachment(attachmentId: string): Promise<AttachmentRead> {
  const access = captureOfflineAccess();
  const record = await offlineDb.attachments.get(attachmentId);
  if (!record) throw new Error("Offline attachment metadata was not found.");
  const cached = await readVerifiedCachedAttachment(record);
  const blob = cached ? await cached.blob() : null;
  assertOfflineAccess(access);
  const url = blob ? URL.createObjectURL(blob) : null;
  if (url) attachmentObjectUrls.add(url);
  return offlineAttachmentRead(record, url, Boolean(cached));
}

export async function getOfflineAttachmentBytes(attachmentId: string): Promise<Uint8Array | null> {
  const access = captureOfflineAccess();
  const record = await offlineDb.attachments.get(attachmentId);
  if (!record) return null;
  const response = await readVerifiedCachedAttachment(record);
  const bytes = response ? new Uint8Array(await response.arrayBuffer()) : null;
  assertOfflineAccess(access);
  return bytes;
}

export async function listOfflineConversationAttachments(conversationId: string): Promise<AttachmentRead[]> {
  const access = captureOfflineAccess();
  const records = await offlineDb.attachments.where("conversation_id").equals(conversationId).toArray();
  const cached = await Promise.all(records.map(async (record) => Boolean(await readVerifiedCachedAttachment(record))));
  assertOfflineAccess(access);
  return records
    .map((record, index) => offlineAttachmentRead(record, null, cached[index]))
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

async function readVerifiedCachedAttachment(record: OfflineAttachmentRecord): Promise<Response | null> {
  const access = captureOfflineAccess();
  if (!record.sha256 || record.resolution_status === "missing" || record.downloadable === false) return null;
  try {
    const cache = await caches.open(activeOfflineContext.assetCacheName);
    for (const url of offlineAttachmentCacheUrls(record)) {
      const response = await cache.match(url);
      if (!response) continue;
      const blob = await response.clone().blob();
      assertOfflineAccess(access);
      if (record.byte_size >= 0 && blob.size !== record.byte_size) {
        await cache.delete(url);
        continue;
      }
      return response;
    }
    return null;
  } catch {
    return null;
  }
}

export async function inspectOfflineCopyAssets(conversationId: string, mode: "none" | "small" | "all"): Promise<{ total: number; available: number; required: number; missing: number; metadataKnown: boolean }> {
  const access = captureOfflineAccess(), db = offlineDb;
  const conversation = await db.conversations.get(conversationId);
  const attachments = await db.attachments.where("conversation_id").equals(conversationId).toArray();
  let available = 0, required = 0, missing = 0;
  for (const attachment of attachments) {
    const cached = Boolean(await readVerifiedCachedAttachment(attachment));
    if (cached) available += 1;
    const needed = mode !== "none" && Boolean(attachment.sha256) && attachment.resolution_status !== "missing" && attachment.downloadable !== false
      && (mode === "all" || attachment.byte_size <= 10 * 1024 * 1024);
    if (needed) { required += 1; if (!cached) missing += 1; }
  }
  assertOfflineAccess(access);
  return { total: attachments.length, available, required, missing, metadataKnown: conversation?.offline_asset_mode !== undefined };
}

export async function clearOfflineAttachmentCache(conversationIds: string[], reviewedFingerprint?: string): Promise<void> {
  return withOfflineDataWrite(() => clearOfflineAttachmentCacheUnlocked(conversationIds, reviewedFingerprint));
}

async function clearOfflineAttachmentCacheUnlocked(conversationIds: string[], reviewedFingerprint?: string): Promise<void> {
  const access = captureOfflineAccess(), db = offlineDb, context = getActiveOfflineStorageContext();
  await assertNoActiveOfflineDownload(db);
  await db.transaction("rw", [db.outbox, db.settings, db.annotations, db.notebooks, db.attachments, db.readingPositions], async () => {
    await verifyReviewedPending(conversationIds, reviewedFingerprint);
    const attachments = await db.attachments.where("conversation_id").anyOf(conversationIds).toArray();
    await Dexie.waitFor((async () => {
      const cache = await caches.open(context.assetCacheName);
      for (const attachment of attachments) for (const url of offlineAttachmentCacheUrls(attachment)) {
        assertOfflineAccess(access);
        await cache.delete(url);
      }
    })());
  });
}

export function releaseOfflineAttachmentUrls(attachment?: AttachmentRead | null): void {
  const urls = new Set([attachment?.content_url, attachment?.download_url]);
  urls.forEach((url) => {
    if (url?.startsWith("blob:")) { URL.revokeObjectURL(url); attachmentObjectUrls.delete(url); }
  });
}

declare global {
  interface Window {
    __chatReaderPwaNegativeTest?: {
      importOfflinePackage: typeof importOfflinePackage;
      inspectOfflineBulkPutChunking: typeof inspectOfflineBulkPutChunking;
      activateProtectedOfflineData: typeof activateProtectedOfflineData;
      clearProtectedOfflineData: typeof clearProtectedOfflineData;
      getActiveOfflineStorageContext: typeof getActiveOfflineStorageContext;
    };
  }
}

// Compile-time opt-in only: normal production bundles do not expose a fault
// seam. Release E uses it to exercise the real Cache Storage/IndexedDB path.
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_PWA_NEGATIVE_TESTS === "1") {
  window.__chatReaderPwaNegativeTest = {
    importOfflinePackage,
    inspectOfflineBulkPutChunking,
    activateProtectedOfflineData,
    clearProtectedOfflineData,
    getActiveOfflineStorageContext,
  };
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

export async function queueOfflineOperation(operation: AnnotationSyncOperation, db = offlineDb): Promise<void> {
  const last = await db.outbox.orderBy("queued_at").last();
  const time = Math.max(Date.now(), last ? Date.parse(last.queued_at) + 1 : 0);
  const entity = operation.entity_type === "notebook" ? operation.conversation_id : operation.entity_id;
  const conflict = await db.settings.get(`sync-conflict:${operation.entity_type}:${entity}`);
  await db.outbox.put({ ...operation, queued_at: new Date(time).toISOString(), attempts: 0, last_error: conflict ? "CONFLICT" : null });
}

export async function countOfflinePendingChanges(conversationIds: string[], db = offlineDb): Promise<number> {
  const ids = new Set(conversationIds);
  const operations = await db.outbox.where("conversation_id").anyOf(conversationIds).count();
  const conflicts = await db.settings.where("key").startsWith("sync-conflict:")
    .filter((item) => ids.has((item.value as { conversation_id: string }).conversation_id)).count();
  const drafts = await db.settings.where("key").startsWith("notebook-draft:")
    .filter((item) => ids.has((item.value as { conversation_id: string }).conversation_id)).count();
  return operations + conflicts + drafts;
}

export async function syncOfflineAnnotationSearch(annotation: AnnotationRead, db = offlineDb): Promise<void> {
  const existing = await db.searchDocuments.where("document_type").equals("annotation").filter((item) => item.metadata?.annotation_id === annotation.id).toArray();
  if (existing.length) await db.searchDocuments.bulkDelete(existing.map((item) => item.id));
  if (annotation.is_deleted) return;
  const plainText = [annotation.comment_markdown, annotation.quote].filter(Boolean).join(" ").trim();
  if (!plainText) return;
  const conversation = await db.conversations.get(annotation.conversation_id);
  await db.searchDocuments.put({
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

export async function clearOfflineAnnotationSearch(conversationId: string, db = offlineDb): Promise<void> {
  const stale = await db.searchDocuments
    .where("document_type")
    .equals("annotation")
    .filter((item) => item.conversation_id === conversationId)
    .primaryKeys();
  if (stale.length) await db.searchDocuments.bulkDelete(stale);
}

function normalizeOfflineConversation(raw: PackageConversation, downloadedAt: string): OfflineConversationRecord {
  const messageCount = Array.isArray(raw.messages) ? raw.messages.length : 0;
  return {
    id: String(raw.id),
    title: String(raw.title ?? raw.display_title ?? "Conversation"),
    display_title: String(raw.display_title ?? raw.title ?? "Conversation"),
    description_markdown: typeof raw.description_markdown === "string" ? raw.description_markdown : null,
    source_type: String(raw.source_type ?? "offline"),
    source_profile: String(raw.source_profile ?? "offline_package"),
    // Prefer the payload's actual message array over a potentially stale
    // server-side aggregate. The Reader uses this value for its header and a
    // stale zero makes a valid offline package look empty.
    message_count: Array.isArray(raw.messages) ? messageCount : Number(raw.message_count ?? 0),
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
