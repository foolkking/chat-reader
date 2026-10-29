import type { SearchResultItem } from "../../lib/types";

export const MAX_SEARCH_READING_QUEUE_ITEMS = 100;
export const SEARCH_READING_QUEUE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_QUEUE_AGE_FUTURE_MS = 60_000;
const MAX_TARGET_HREF_LENGTH = 2_048;
const ALLOWED_TARGET_PARAMS = new Set([
  "messageId",
  "messageVersionId",
  "blockIndex",
  "renderBlockId",
  "characterOffset",
  "endCharacterOffset",
  "attachmentId",
  "annotationId",
  "annotations",
  "files",
]);
const READABLE_DOCUMENT_TYPES = new Set(["message", "heading", "code", "annotation"]);

export type SearchReadingQueue = {
  version: 1;
  createdAt: number;
  hrefs: string[];
  returnHref?: string;
};

/** Only message-anchored hits can form a reading sequence. No snippets are retained. */
export function buildSearchReadingQueue(
  items: SearchResultItem[],
  hrefForItem: (item: SearchResultItem) => string,
  now = Date.now(),
): SearchReadingQueue | null {
  const hrefs: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.message_id || !READABLE_DOCUMENT_TYPES.has(item.document_type)) continue;
    const href = sanitizeSearchReadingHref(hrefForItem(item));
    if (!href || seen.has(href)) continue;
    seen.add(href);
    hrefs.push(href);
    if (hrefs.length >= MAX_SEARCH_READING_QUEUE_ITEMS) break;
  }
  return hrefs.length >= 2 ? { version: 1, createdAt: now, hrefs } : null;
}

export function parseSearchReadingQueue(value: unknown, now = Date.now()): SearchReadingQueue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SearchReadingQueue>;
  if (record.version !== 1 || !Number.isSafeInteger(record.createdAt) || !Array.isArray(record.hrefs)) return null;
  if (record.createdAt! > now + MAX_QUEUE_AGE_FUTURE_MS || now - record.createdAt! > SEARCH_READING_QUEUE_TTL_MS) return null;
  if (record.hrefs.length < 2 || record.hrefs.length > MAX_SEARCH_READING_QUEUE_ITEMS) return null;
  const hrefs = record.hrefs.map(sanitizeSearchReadingHref);
  if (hrefs.some((href) => href === null)) return null;
  const safeHrefs = hrefs as string[];
  if (new Set(safeHrefs).size !== safeHrefs.length) return null;
  const returnHref = record.returnHref === undefined ? undefined : sanitizeSearchReturnHref(record.returnHref);
  if (returnHref === null) return null;
  return { version: 1, createdAt: record.createdAt!, hrefs: safeHrefs, ...(returnHref ? { returnHref } : {}) };
}

export function sanitizeSearchReadingHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TARGET_HREF_LENGTH || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(value, "https://chat-reader.invalid");
    if (url.origin !== "https://chat-reader.invalid" || !/^\/conversations\/[^/]+$/.test(url.pathname) || url.hash) return null;
    for (const [key, item] of url.searchParams) {
      if (!ALLOWED_TARGET_PARAMS.has(key) || item.length > 512) return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function sanitizeSearchReturnHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/search")) return null;
  try {
    const url = new URL(value, "https://chat-reader.invalid");
    if (url.origin !== "https://chat-reader.invalid" || url.pathname !== "/search" || url.hash) return null;
    const allowed = new Set(["q", "document_type", "role", "project_id", "status_scope", "date_from", "date_to"]);
    const seen = new Set<string>();
    for (const [key, item] of url.searchParams) {
      if (!allowed.has(key) || item.length > 512 || seen.has(key)) return null;
      seen.add(key);
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function searchReadingQueueStorageKey(queueId: string, ownerId: string | null = null): string {
  return `chat-reader:search-reading-queue:${ownerId ? `${ownerId}:` : ""}${queueId}`;
}

export function withSearchReadingQueue(href: string, queueId: string, index: number): string | null {
  const safeHref = sanitizeSearchReadingHref(href);
  if (!safeHref || !/^[a-zA-Z0-9-]{8,80}$/.test(queueId) || !Number.isSafeInteger(index) || index < 0) return null;
  const url = new URL(safeHref, "https://chat-reader.invalid");
  url.searchParams.set("searchQueue", queueId);
  url.searchParams.set("searchIndex", String(index));
  return `${url.pathname}${url.search}`;
}
