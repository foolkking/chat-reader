/// <reference lib="webworker" />

import { Document } from "flexsearch";
import type { OfflineSearchDocument } from "./offline-db";
import type { OfflineSearchScope } from "./offline-search";

let documents = new Map<string, OfflineSearchDocument>();
let index = createIndex();
let readerScope: { id: string; rows: OfflineSearchDocument[] } | null = null;
const readerTypes = new Set(["message", "heading", "code", "annotation", "attachment"]);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const literal = (s: string) => s.trim().replace(/\s+/gu, " ").toLowerCase();

self.addEventListener("message", (event: MessageEvent<{ type: string; requestId: string; documents?: OfflineSearchDocument[]; query?: string; limit?: number; offset?: number; scope?: OfflineSearchScope }>) => {
  const { type, requestId } = event.data;
  if (type === "runtime") {
    // Report the compiled entry and importScripts dependencies from inside the
    // running worker. A main-thread URL expression emits the raw TypeScript asset.
    self.postMessage({ requestId, items: [], runtime: {
      workerUrl: self.location.href,
      assets: [...new Set([self.location.href, ...performance.getEntriesByType("resource").map((entry) => entry.name)])],
    } });
    return;
  }
  if (type === "init") {
    readerScope = null;
    documents = new Map();
    index = createIndex();
    for (const document of event.data.documents ?? []) {
      documents.set(document.id, document);
      const body = document.search_text ?? document.plain_text;
      index.add({
        id: document.id,
        title: document.title ?? "",
        // A file's own name is content, not its conversation's title. Keep it
        // searchable even when a legacy record only stores an extract in body.
        body: document.document_type === "attachment" && document.title
          ? `${document.title}\n${body}` : body,
      });
    }
    self.postMessage({ requestId, items: [] });
    return;
  }
  if (type === "search") {
    const query = event.data.query?.trim() ?? "";
    const limit = event.data.limit ?? 80;
    const offset = event.data.offset ?? 0;
    if (!query || limit <= 0) {
      self.postMessage({ requestId, items: [], total: 0, totalIsExact: true, hasMore: false });
      return;
    }
    const scope = event.data.scope;
    if (!scope) {
      // Directory search is not token-prefix completion. Match every literal
      // word/quoted phrase in the same document, including Chinese infixes
      // and identifiers. Reuse stored references, not a second text corpus.
      const terms = [...query.matchAll(/"([^"]+)"|(\S+)/gu)]
        .map(hit => literal(hit[1] ?? hit[2])).filter(Boolean);
      const titleNeedle = literal(query);
      const items: OfflineSearchDocument[] = [];
      let total = 0;
      // Exact titles, containing titles, then body hits: deterministic across
      // pages without materializing or sorting a copy of the complete corpus.
      for (let rank = 0; rank < 3; rank++) for (const d of documents.values()) {
        const title = literal(d.title ?? "");
        const tier = title === titleNeedle ? 0 : terms.every(term => title.includes(term)) ? 1 : 2;
        if (tier !== rank) continue;
        if (!terms.length) continue;
        if (rank === 2) {
          const body = literal(d.search_text ?? d.plain_text);
          if (!terms.every(term => title.includes(term) || body.includes(term))) continue;
        }
        if (++total > offset + limit) {
          self.postMessage({ requestId, items, total, totalIsExact: false, hasMore: true });
          return;
        }
        if (total > offset) items.push(d);
      }
      self.postMessage({ requestId, items, total, totalIsExact: true, hasMore: false });
      return;
    }
    if (scope?.conversationId && scope.contentOnly) {
      // Forward tokenization misses substrings in the middle of a Chinese
      // sentence or an identifier. Find inside this one local conversation;
      // sort references (not copies of text) before pagination, not each page.
      if (readerScope?.id !== scope.conversationId) {
        const rows: OfflineSearchDocument[] = [];
        for (const d of documents.values()) {
          if (d.conversation_id === scope.conversationId && readerTypes.has(d.document_type)) rows.push(d);
        }
        rows.sort((a, b) => Number(a.order_key == null) - Number(b.order_key == null)
          || compare(a.order_key ?? "", b.order_key ?? "") || compare(a.id, b.id));
        readerScope = { id: scope.conversationId, rows };
      }
      const text = literal(query), items: OfflineSearchDocument[] = [];
      let total = 0;
      for (const d of readerScope.rows) {
        if ((scope.documentType && d.document_type !== scope.documentType) || (scope.role && d.role !== scope.role)) continue;
        const body = d.document_type === "attachment" ? `${d.title ?? ""}\n${d.search_text ?? d.plain_text}` : d.plain_text;
        if (!literal(body).includes(text)) continue;
        if (++total > offset + limit) break;
        if (total > offset) items.push(d);
      }
      const hasMore = total > offset + limit;
      self.postMessage({ requestId, items, total, totalIsExact: !hasMore, hasMore });
      return;
    }
    // FlexSearch 0.8's tag intersection applies a default 100-result content
    // window before filtering. Query with an explicit positive corpus bound
    // (zero also means the default), then scope IDs before the page window.
    // Reuse the document map; do not duplicate the text index per scope.
    const hasScope = Boolean(scope && (scope.conversationId || scope.documentType || scope.role));
    // One lookahead document proves continuation without claiming that the
    // bounded field result length is the full corpus count.
    const pageLimit = offset + limit + 1;
    const fetchLimit = hasScope ? Math.max(1, documents.size) : pageLimit;
    const result = index.search(query, {
      limit: fetchLimit,
      enrich: true,
      index: scope?.contentOnly ? ["body"] : ["title", "body"],
    });
    const ids = new Set<string>();
    for (const field of result) {
      for (const item of field.result) {
        const id = String(typeof item === "object" ? item.id : item);
        const document = documents.get(id);
        if (!document
          || (scope?.conversationId && document.conversation_id !== scope.conversationId)
          || (scope?.documentType && document.document_type !== scope.documentType)
          || (scope?.role && document.role !== scope.role)) continue;
        ids.add(id);
      }
    }
    const ordered = Array.from(ids);
    const pageCandidates = hasScope ? ordered.slice(0, pageLimit) : ordered;
    self.postMessage({
      requestId,
      items: pageCandidates.slice(offset, offset + limit).map((id) => documents.get(id)).filter(Boolean),
      total: pageCandidates.length,
      totalIsExact: hasScope ? ordered.length < pageLimit : result.every((field) => field.result.length < fetchLimit),
      hasMore: offset + limit < pageCandidates.length,
    });
  }
});

function createIndex() {
  return new Document({
    tokenize: "forward",
    cache: 100,
    document: { id: "id", index: ["title", "body"] },
  });
}

export {};
