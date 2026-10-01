import { offlineDb } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import type { NotebookBlock, NotebookRead } from "./types";

export type NotebookDraft = { version: number; conversation_id: string; mode: "remote" | "offline"; base: NotebookRead; title: string; blocks: NotebookBlock[] };
export class NotebookDraftChangedError extends Error {}
let tabId: string | undefined;

export function notebookDraftKey(conversationId: string, mode: NotebookDraft["mode"]): string {
  if (!tabId) {
    try {
      tabId = sessionStorage.getItem("chat-reader:notebook-draft-tab") || crypto.randomUUID();
      sessionStorage.setItem("chat-reader:notebook-draft-tab", tabId);
    } catch { tabId = crypto.randomUUID(); }
  }
  return `notebook-draft:${conversationId}:${mode}:${tabId}`;
}

export async function readNotebookDraft(key: string): Promise<NotebookDraft | undefined> {
  return (await offlineDb.settings.get(key))?.value as NotebookDraft | undefined;
}

export async function writeNotebookDraft(key: string, expectedVersion: number, value: Omit<NotebookDraft, "version">): Promise<number> {
  const db = offlineDb, access = captureOfflineAccess();
  return db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    const current = (await db.settings.get(key))?.value as NotebookDraft | undefined;
    if ((current?.version ?? 0) !== expectedVersion) throw new NotebookDraftChangedError();
    const version = expectedVersion + 1;
    await db.settings.put({ key, value: { ...value, version } });
    return version;
  });
}

export async function removeNotebookDraft(key: string, expectedVersion: number): Promise<void> {
  const db = offlineDb, access = captureOfflineAccess();
  return db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    const current = (await db.settings.get(key))?.value as NotebookDraft | undefined;
    if (current && current.version !== expectedVersion) throw new NotebookDraftChangedError();
    await db.settings.delete(key);
  });
}
