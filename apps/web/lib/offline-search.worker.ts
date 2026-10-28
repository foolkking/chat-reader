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
        scope: documentScopeTags(document),
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
    // This FlexSearch version unions multiple tag lists. A single compound tag
    // makes the selected dimensions conjunctive before the field limit.
    const tag = scope && (scope.conversationId || scope.documentType || scope.role)
      ? { scope: scopeKey(scope) }
      : undefined;
    // One lookahead document proves continuation without claiming that the
    // bounded field result length is the full corpus count.
    const fetchLimit = offset + limit + 1;
    const result = index.search(query, {
      limit: fetchLimit,
      enrich: true,
      index: scope?.contentOnly ? ["body"] : ["title", "body"],
      ...(tag ? { tag } : {}),
    });
    const ids = new Set<string>();
    for (const field of result) {
      for (const item of field.result) ids.add(String(typeof item === "object" ? item.id : item));
    }
    const ordered = Array.from(ids);
    self.postMessage({
      requestId,
      items: ordered.slice(offset, offset + limit).map((id) => documents.get(id)).filter(Boolean),
      total: ordered.length,
      totalIsExact: result.every((field) => field.result.length < fetchLimit),
      hasMore: offset + limit < ordered.length,
    });
  }
});

function createIndex() {
  return new Document({
    tokenize: "forward",
    cache: 100,
    document: { id: "id", index: ["title", "body"], tag: "scope" },
  });
}

function scopeKey(scope: OfflineSearchScope): string {
  return JSON.stringify([scope.conversationId || null, scope.documentType || null, scope.role || null]);
}

function documentScopeTags(document: OfflineSearchDocument): string[] {
  const tags: string[] = [];
  // Seven fixed combinations at most; no extra per-conversation text index.
  for (let mask = 1; mask < 8; mask++) {
    if ((mask & 4) && !document.role) continue;
    tags.push(scopeKey({
      conversationId: mask & 1 ? document.conversation_id : undefined,
      documentType: mask & 2 ? document.document_type : undefined,
      role: mask & 4 ? document.role ?? undefined : undefined,
    }));
  }
  return tags;
}

export {};
