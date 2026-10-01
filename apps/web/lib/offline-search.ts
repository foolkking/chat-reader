import type { OfflineSearchDocument } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";

let worker: Worker | null = null;
const pending = new Map<string, (items: OfflineSearchDocument[]) => void>();

export function resetOfflineSearch(): void {
  worker?.terminate();
  worker = null;
  for (const resolve of pending.values()) resolve([]);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./offline-search.worker.ts", import.meta.url));
  worker.addEventListener("message", (event: MessageEvent<{ requestId: string; items: OfflineSearchDocument[] }>) => {
    pending.get(event.data.requestId)?.(event.data.items);
    pending.delete(event.data.requestId);
  });
  return worker;
}

export function getOfflineSearchWorkerUrl(): string {
  return new URL("./offline-search.worker.ts", import.meta.url).href;
}

export async function initializeOfflineSearch(documents: OfflineSearchDocument[]): Promise<void> {
  const access = captureOfflineAccess();
  await request("init", { documents });
  assertOfflineAccess(access);
}

export async function searchOffline(query: string, limit = 80): Promise<OfflineSearchDocument[]> {
  const access = captureOfflineAccess();
  if (!query.trim()) return [];
  const result = await request("search", { query, limit });
  assertOfflineAccess(access);
  return result;
}

function request(type: string, payload: Record<string, unknown>): Promise<OfflineSearchDocument[]> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    getWorker().postMessage({ type, requestId, ...payload });
  });
}
