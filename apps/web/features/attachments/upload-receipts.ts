import { offlineDb } from "../../lib/offline-db";
import { assertOfflineAccess, authenticationGeneration, captureOfflineAccess } from "../../lib/offline-access";

/** Small recovery receipts only. Reading them never uploads or finalizes. */
export type UploadReceipt = {
  id: string; sessionRequestId: string; itemRequestId?: string; sessionId?: string; uploadItemId?: string;
  sessionAttempted?: boolean; uploadAttempted?: boolean; expiresAt?: string;
  status: string; progress: number; error?: string;
  filename: string; byteSize: number; mimeType: string; lastModified: number;
  baseVersionId?: string;
};
const memory = new Map<string, { generation: number; receipt: UploadReceipt; file?: File }>();
const writes = new Map<string, Promise<void>>();
const prefix = (scope: string) => `attachment-upload-receipt:${scope}:`;
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Receipt storage unavailable")), 3000);
  })]); } finally { clearTimeout(timer); }
}

export async function keepUploadReceipt(scope: string, receipt: UploadReceipt, file?: File): Promise<boolean> {
  const key = prefix(scope) + receipt.id;
  const generation = authenticationGeneration();
  const previous = memory.get(key);
  memory.set(key, { generation, receipt, file: file ?? (previous?.generation === generation ? previous.file : undefined) });
  try {
    const access = captureOfflineAccess(), db = offlineDb;
    const task = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertOfflineAccess(access);
      if (memory.get(key)?.receipt !== receipt) return;
      if (receipt.status === "committed" || receipt.status === "removed") {
        await db.settings.delete(key);
        memory.delete(key);
      } else await db.settings.put({ key, value: receipt });
    });
    writes.set(key, task);
    void task.finally(() => { if (writes.get(key) === task) writes.delete(key); }).catch(() => undefined);
    await bounded(task);
    return true;
  } catch { return false; }
}

export async function readUploadReceipts(scope: string): Promise<Array<{ receipt: UploadReceipt; file?: File }>> {
  const generation = authenticationGeneration();
  const found = new Map<string, { receipt: UploadReceipt; file?: File }>();
  try {
    const access = captureOfflineAccess();
    const rows = await bounded(offlineDb.settings.where("key").startsWith(prefix(scope)).limit(100).toArray());
    assertOfflineAccess(access);
    for (const row of rows) {
      const receipt = row.value as UploadReceipt;
      if (receipt?.id && receipt.sessionRequestId && typeof receipt.filename === "string") found.set(row.key, { receipt });
    }
  } catch { /* Runtime receipts still permit recovery without IndexedDB. */ }
  if (generation !== authenticationGeneration()) return [];
  for (const [key, value] of memory) {
    if (value.generation !== generation) { memory.delete(key); continue; }
    if (key.startsWith(prefix(scope))) found.set(key, value);
  }
  return [...found.values()].filter(item => !["committed", "removed"].includes(item.receipt.status));
}
