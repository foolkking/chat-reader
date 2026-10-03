import { offlineDb } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";

export type ContinuationDraft = {
  version: number;
  conversation_id: string;
  member: "current" | "index";
  text: string;
  original: string;
  base_generation: number;
  updated_at: string;
};
export type SavedContinuationDraft = { key: string; value: ContinuationDraft };
export class ContinuationDraftChangedError extends Error {}

export async function listContinuationDrafts(conversationId: string, member: ContinuationDraft["member"]): Promise<SavedContinuationDraft[]> {
  const rows = await offlineDb.settings.where("key").startsWith(`continuation-draft:${conversationId}:${member}:`).toArray();
  return (rows as SavedContinuationDraft[]).sort((a, b) => b.value.updated_at.localeCompare(a.value.updated_at));
}

export async function writeContinuationDraft(key: string, expectedVersion: number, value: Omit<ContinuationDraft, "version">): Promise<number> {
  const db = offlineDb, access = captureOfflineAccess();
  if (new Blob([value.text]).size > (value.member === "current" ? 1 : 8) * 1024 * 1024) throw new Error("Draft exceeds file size limit.");
  return db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    const current = (await db.settings.get(key))?.value as ContinuationDraft | undefined;
    if ((current?.version ?? 0) !== expectedVersion) throw new ContinuationDraftChangedError();
    const version = expectedVersion + 1;
    await db.settings.put({ key, value: { ...value, version } });
    return version;
  });
}

export async function removeContinuationDraft(key: string, expectedVersion: number): Promise<void> {
  const db = offlineDb, access = captureOfflineAccess();
  return db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    const current = (await db.settings.get(key))?.value as ContinuationDraft | undefined;
    if (current && current.version !== expectedVersion) throw new ContinuationDraftChangedError();
    await db.settings.delete(key);
  });
}
