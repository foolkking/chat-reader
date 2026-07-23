/// <reference lib="webworker" />

import { Document } from "flexsearch";
import type { OfflineSearchDocument } from "./offline-db";

let documents = new Map<string, OfflineSearchDocument>();
let index = createIndex();

self.addEventListener("message", (event: MessageEvent<{ type: string; requestId: string; documents?: OfflineSearchDocument[]; query?: string; limit?: number }>) => {
  const { type, requestId } = event.data;
  if (type === "init") {
    documents = new Map();
    index = createIndex();
    for (const document of event.data.documents ?? []) {
      documents.set(document.id, document);
      index.add({ id: document.id, title: document.title ?? "", body: document.search_text, type: document.document_type });
    }
    self.postMessage({ requestId, items: [] });
    return;
  }
  if (type === "search") {
    const result = index.search(event.data.query ?? "", { limit: event.data.limit ?? 80, enrich: true });
    const ids = new Set<string>();
    for (const field of result) {
      for (const item of field.result) ids.add(String(typeof item === "object" ? item.id : item));
    }
    self.postMessage({ requestId, items: Array.from(ids).map((id) => documents.get(id)).filter(Boolean) });
  }
});

function createIndex() {
  return new Document({
    tokenize: "forward",
    cache: 100,
    document: { id: "id", index: ["title", "body", "type"] },
  });
}

export {};
