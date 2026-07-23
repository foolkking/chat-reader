import type { OfflineSearchDocument } from "./offline-db";

let worker: Worker | null = null;
const pending = new Map<string, (items: OfflineSearchDocument[]) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./offline-search.worker.ts", import.meta.url));
  worker.addEventListener("message", (event: MessageEvent<{ requestId: string; items: OfflineSearchDocument[] }>) => {
    pending.get(event.data.requestId)?.(event.data.items);
    pending.delete(event.data.requestId);
  });
  return worker;
}

export async function initializeOfflineSearch(documents: OfflineSearchDocument[]): Promise<void> {
  await request("init", { documents });
}

export async function searchOffline(query: string, limit = 80): Promise<OfflineSearchDocument[]> {
  if (!query.trim()) return [];
  return request("search", { query, limit });
}

function request(type: string, payload: Record<string, unknown>): Promise<OfflineSearchDocument[]> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    getWorker().postMessage({ type, requestId, ...payload });
  });
}
