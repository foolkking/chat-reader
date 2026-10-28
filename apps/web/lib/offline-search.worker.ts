/// <reference lib="webworker" />

import { Document } from "flexsearch";
import type { OfflineSearchDocument } from "./offline-db";
import type { OfflineSearchScope } from "./offline-search";

let documents = new Map<string, OfflineSearchDocument>();
let index = createIndex();

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
