import { offlineDb } from "../../lib/offline-db";
import { assertOfflineAccess, authenticationGeneration, captureOfflineAccess } from "../../lib/offline-access";
import { editMessage } from "../../lib/api";

// This is a receipt for this existing operation, not an offline write queue.
// Loading/checking never sends PATCH. A deliberate retry reuses its exact payload.
export type SourceSaveAttempt = {
  operationId: string;
  text: string;
  payload: Parameters<typeof editMessage>[1];
  generation: number;
};
const memory = new Map<string, SourceSaveAttempt>();
const keyFor = (messageId: string) => `source-save-receipt:${messageId}`;
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Local receipt storage unavailable")), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function rememberSourceSave(messageId: string, attempt: SourceSaveAttempt): Promise<boolean> {
  memory.set(messageId, attempt);
  try {
    const access = captureOfflineAccess();
    const db = offlineDb;
    if (attempt.text.length > 8 * 1024 * 1024) return false;
    await bounded(db.settings.put({ key: keyFor(messageId), value: attempt }));
    assertOfflineAccess(access);
    return true;
  } catch { return false; }
}

export async function readSourceSave(messageId: string): Promise<SourceSaveAttempt | null> {
  const generation = authenticationGeneration();
  const cached = memory.get(messageId);
  if (cached?.generation === generation) return cached;
  memory.delete(messageId);
  try {
    const access = captureOfflineAccess();
    const stored = (await bounded(offlineDb.settings.get(keyFor(messageId))))?.value as SourceSaveAttempt | undefined;
    assertOfflineAccess(access);
    if (!stored?.operationId || stored.payload?.operationId !== stored.operationId
      || stored.text !== stored.payload.contentMarkdown) return null;
    const current = { ...stored, generation };
    memory.set(messageId, current);
    return current;
  } catch { return null; }
}

export async function forgetSourceSave(messageId: string, operationId: string): Promise<void> {
  if (memory.get(messageId)?.operationId === operationId) memory.delete(messageId);
  try {
    const db = offlineDb, access = captureOfflineAccess();
    await db.transaction("rw", db.settings, async () => {
      assertOfflineAccess(access);
      const value = (await db.settings.get(keyFor(messageId)))?.value as SourceSaveAttempt | undefined;
      if (value?.operationId === operationId) await db.settings.delete(keyFor(messageId));
    });
  } catch {
    // A confirmed server result never becomes a failure because local receipt
    // cleanup failed. A remaining receipt will only trigger another read.
  }
}
