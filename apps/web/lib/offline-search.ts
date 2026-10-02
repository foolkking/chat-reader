import type { OfflineSearchDocument } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";

let worker: Worker | null = null;
type WorkerReply = { requestId: string; items: OfflineSearchDocument[]; runtime?: { workerUrl: string; assets: string[] } };
const pending = new Map<string, { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

export function resetOfflineSearch(): void {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("Offline search is unavailable."));
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./offline-search.worker.ts", import.meta.url));
  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const request = pending.get(event.data.requestId);
    if (request) {
      clearTimeout(request.timer);
      request.resolve(event.data);
    }
    pending.delete(event.data.requestId);
  });
  const current = worker;
  const fail = () => { if (worker === current) resetOfflineSearch(); };
  worker.addEventListener("error", fail);
  worker.addEventListener("messageerror", fail);
  return worker;
}

export async function getOfflineSearchRuntime(): Promise<{ workerUrl: string; assets: string[] }> {
  const access = captureOfflineAccess();
  const reply = await request("runtime", {});
  assertOfflineAccess(access);
  if (!reply.runtime?.workerUrl || !reply.runtime.assets.length) throw new Error("Offline search runtime is unavailable.");
  return reply.runtime;
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
  return result.items;
}

function request(type: string, payload: Record<string, unknown>): Promise<WorkerReply> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resetOfflineSearch, 10_000);
    pending.set(requestId, { resolve, reject, timer });
    try { getWorker().postMessage({ type, requestId, ...payload }); }
    catch { resetOfflineSearch(); }
  });
}
