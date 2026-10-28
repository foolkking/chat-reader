import { offlineDb } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import type { AnnotationRead } from "./types";

export type CommentDraft = { base: AnnotationRead; text: string; status: "dirty" | "saving" | "error" | "conflict" };
export type StoredCommentDraft = {
  version: number;
  conversation_id: string;
  annotation_id: string;
  base: AnnotationRead;
  text: string;
  status: CommentDraft["status"];
  updated_at: string;
  mode: "remote" | "offline";
};
export type CommentDraftStorage = { db: typeof offlineDb; access: number };

export function captureCommentDraftStorage(): CommentDraftStorage {
  return { db: offlineDb, access: captureOfflineAccess() };
}

let tabId: string | undefined;
const persistence = new WeakMap<object, Map<string, Set<Promise<void>>>>();
// Retain the exact CAS baseline across an A → B → A visit. A transient
// delete failure must not make the discarded snapshot recoverable again.
const deleteIntents = new WeakMap<object, Map<string, { annotationId: string; expectedVersion: number }>>();
class DraftChangedError extends Error {
  constructor() { super("The comment draft changed in another task."); }
}

/** A rapid A → B → A visit must wait for A's last coalesced write, not read an older snapshot. */
export function trackCommentDraftPersistence(
  conversationId: string,
  mode: StoredCommentDraft["mode"],
  storage: CommentDraftStorage,
  task: Promise<void>,
): void {
  const scopes = persistence.get(storage.db) ?? new Map<string, Set<Promise<void>>>();
  persistence.set(storage.db, scopes);
  const key = `${draftPrefix(conversationId, mode)}${currentTabId()}`;
  const tasks = scopes.get(key) ?? new Set<Promise<void>>();
  scopes.set(key, tasks);
  tasks.add(task);
  const settled = () => {
    tasks.delete(task);
    if (!tasks.size && scopes.get(key) === tasks) scopes.delete(key);
  };
  void task.then(settled, settled);
}

function currentTabId(): string {
  if (tabId) return tabId;
  try {
    tabId = sessionStorage.getItem("chat-reader:comment-draft-tab") || crypto.randomUUID();
    sessionStorage.setItem("chat-reader:comment-draft-tab", tabId);
  } catch {
    tabId = crypto.randomUUID();
  }
  return tabId;
}

function draftPrefix(conversationId: string, mode: StoredCommentDraft["mode"]): string {
  // offlineDb itself is account-scoped. Remote and offline edits must not
  // silently overwrite one another's baselines.
  return `annotation-comment-draft:${conversationId}:${mode}:`;
}

function draftKey(conversationId: string, annotationId: string, mode: StoredCommentDraft["mode"]): string {
  return `${draftPrefix(conversationId, mode)}${annotationId}:${currentTabId()}`;
}

export async function readAnnotationCommentDrafts(
  conversationId: string,
  mode: StoredCommentDraft["mode"],
  { db, access } = captureCommentDraftStorage(),
): Promise<StoredCommentDraft[]> {
  assertOfflineAccess(access);
  const pendingKey = `${draftPrefix(conversationId, mode)}${currentTabId()}`;
  let pending = persistence.get(db)?.get(pendingKey);
  while (pending?.size) {
    await Promise.allSettled([...pending]);
    assertOfflineAccess(access);
    pending = persistence.get(db)?.get(pendingKey);
  }
  const suffix = `:${currentTabId()}`;
  const prefix = draftPrefix(conversationId, mode);
  for (const [key, intent] of [...(deleteIntents.get(db) ?? [])]) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    try {
      await removeAnnotationCommentDraft(conversationId, intent.annotationId, intent.expectedVersion, mode, { db, access });
    } catch (error) {
      // A newer, independently saved draft wins; transient failures instead
      // stop hydration and keep the storage recovery action visible.
      if (!(error instanceof DraftChangedError)) throw error;
    }
  }
  const rows = await db.settings.where("key").startsWith(draftPrefix(conversationId, mode))
    .filter((row) => row.key.endsWith(suffix)).toArray();
  assertOfflineAccess(access);
  return rows.map((row) => row.value as StoredCommentDraft).filter((record) =>
    record && typeof record === "object"
    && record.conversation_id === conversationId && record.mode === mode && record.base?.conversation_id === conversationId
    && record.base?.id === record.annotation_id && typeof record.text === "string"
    && Number.isSafeInteger(record.version) && record.version > 0);
}

export async function writeAnnotationCommentDraft(
  conversationId: string,
  annotationId: string,
  expectedVersion: number,
  value: CommentDraft,
  mode: StoredCommentDraft["mode"],
  { db, access } = captureCommentDraftStorage(),
): Promise<number> {
  const key = draftKey(conversationId, annotationId, mode);
  assertOfflineAccess(access);
  const priorDelete = deleteIntents.get(db)?.get(key);
  const version = await db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    const current = (await db.settings.get(key))?.value as StoredCommentDraft | undefined;
    assertOfflineAccess(access);
    if ((current?.version ?? 0) !== expectedVersion) throw new DraftChangedError();
    const version = expectedVersion + 1;
    const stored: StoredCommentDraft = {
      version, conversation_id: conversationId, annotation_id: annotationId, mode,
      base: value.base, text: value.text, status: value.status, updated_at: new Date().toISOString(),
    };
    await db.settings.put({ key, value: stored });
    return version;
  });
  if (priorDelete && deleteIntents.get(db)?.get(key) === priorDelete) deleteIntents.get(db)?.delete(key);
  return version;
}

export async function removeAnnotationCommentDraft(
  conversationId: string,
  annotationId: string,
  expectedVersion: number,
  mode: StoredCommentDraft["mode"],
  { db, access } = captureCommentDraftStorage(),
): Promise<void> {
  const key = draftKey(conversationId, annotationId, mode);
  assertOfflineAccess(access);
  const intents = deleteIntents.get(db) ?? new Map<string, { annotationId: string; expectedVersion: number }>();
  deleteIntents.set(db, intents);
  const previous = intents.get(key);
  const intent = previous?.expectedVersion === expectedVersion ? previous : { annotationId, expectedVersion };
  intents.set(key, intent);
  try {
    await db.transaction("rw", db.settings, async () => {
      assertOfflineAccess(access);
      const current = (await db.settings.get(key))?.value as StoredCommentDraft | undefined;
      assertOfflineAccess(access);
      if (current && current.version !== expectedVersion) throw new DraftChangedError();
      await db.settings.delete(key);
    });
    if (intents.get(key) === intent) intents.delete(key);
  } catch (error) {
    if (error instanceof DraftChangedError && intents.get(key) === intent) intents.delete(key);
    throw error;
  }
}
