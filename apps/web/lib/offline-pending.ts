import { strToU8, zipSync } from "fflate";
import { getActiveOfflineStorageContext, offlineDb } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import type { NotebookDraft } from "./notebook-drafts";
import type { ConflictMarker } from "./offline-conflicts";
import type { PreferenceSyncState } from "./preference-sync";

export class OfflinePendingChangedError extends Error {
  constructor() { super("Local changes changed. Review them before continuing."); this.name = "OfflinePendingChangedError"; }
}
export async function readOfflinePending(conversationIds?: string[]) {
  const db = offlineDb, access = captureOfflineAccess(), userId = getActiveOfflineStorageContext().userId;
  const included = (id: string) => !conversationIds || conversationIds.includes(id);
  const data = await db.transaction("r", [db.outbox, db.settings, db.annotations, db.notebooks, db.readingPositions], async () => {
    const preferenceState = !conversationIds ? (await db.settings.get("account-preferences:v1"))?.value as PreferenceSyncState | undefined : undefined;
    const preferences = preferenceState && Object.keys(preferenceState.changes).length ? { changes: preferenceState.changes, conflicts: preferenceState.conflicts, flight: preferenceState.flight, server: preferenceState.server } : null;
    const operations = await db.outbox.filter((row) => included(row.conversation_id)).sortBy("queued_at");
    const conflicts = await db.settings.where("key").startsWith("sync-conflict:").filter((row) => included((row.value as ConflictMarker).conversation_id)).toArray();
    const conflictKeys = new Set(conflicts.map((row) => row.key));
    const resolutionDrafts = await db.settings.where("key").startsWith("sync-resolution-draft:")
      .filter((row) => conflictKeys.has(row.key.slice("sync-resolution-draft:".length))).toArray();
    const drafts = await db.settings.where("key").startsWith("notebook-draft:").filter((row) => included((row.value as NotebookDraft).conversation_id)).toArray();
    const ids = new Set([...operations.map((row) => row.conversation_id), ...conflicts.map((row) => (row.value as ConflictMarker).conversation_id), ...drafts.map((row) => (row.value as NotebookDraft).conversation_id)]);
    const annotations = ids.size ? await db.annotations.where("conversation_id").anyOf([...ids]).toArray() : [];
    const notebooks = ids.size ? await db.notebooks.where("conversation_id").anyOf([...ids]).toArray() : [];
    const readingPositions = ids.size ? (await db.readingPositions.bulkGet([...ids])).filter(Boolean) : [];
    return { operations, conflicts, drafts, resolutionDrafts, annotations, notebooks, preferences, readingPositions };
  });
  assertOfflineAccess(access);
  const canonical = JSON.stringify({ userId, ...data, operations: data.operations.map(({ attempts: _a, last_error: _e, retry_after: _r, submitted: _s, ...row }) => row) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  assertOfflineAccess(access);
  return { ...data, userId, fingerprint: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""), count: data.operations.length + data.conflicts.length + data.drafts.length + Object.keys(data.preferences?.changes ?? {}).length };
}
export type OfflinePendingSnapshot = Awaited<ReturnType<typeof readOfflinePending>>;

export async function exportOfflinePending(snapshot: OfflinePendingSnapshot): Promise<Blob> {
  const access = captureOfflineAccess();
  if (snapshot.userId !== getActiveOfflineStorageContext().userId) throw new OfflinePendingChangedError();
  // A portable, readable copy of the actual unsynced data. It contains no
  // credentials, session tokens or attachment bytes and does not mark edits synced.
  const json = JSON.stringify({ format: "chat-reader-unsynced-changes", version: 1, exported_at: new Date().toISOString(),
    operations: snapshot.operations, conflicts: snapshot.conflicts, drafts: snapshot.drafts, resolution_drafts: snapshot.resolutionDrafts, annotations: snapshot.annotations, notebooks: snapshot.notebooks, preferences: snapshot.preferences, reading_positions: snapshot.readingPositions }, null, 2);
  const blocks = (items: Array<{ type: string; markdown?: string | null; annotation_id?: string | null }>) => items.map((item) => item.type === "markdown" ? item.markdown ?? "" : `[Annotation reference: ${item.annotation_id}]`).join("\n\n");
  const readable = ["# Unsynced changes / 未同步修改", "This is a readable recovery copy, not a .cr archive. Copy text back into a notebook or annotation when needed. / 这是可读恢复副本，不是 .cr 归档；可将正文复制回笔记或批注。", "## Notebooks / 笔记",
    ...snapshot.notebooks.map((note) => `### ${note.title ?? "Untitled"}\n\n${blocks(note.blocks)}`), "## Local drafts / 本机草稿",
    ...snapshot.drafts.map((row) => { const draft = row.value as NotebookDraft; return `### ${draft.title || "Untitled"}\n\n${blocks(draft.blocks)}`; }), "## Annotations / 批注",
    ...snapshot.resolutionDrafts.map((row) => { const draft = row.value as { title?: string; blocks?: Parameters<typeof blocks>[0]; comment_markdown?: string }; return `### Merge draft / 合并草稿\n\n${draft.title ?? ""}\n\n${draft.blocks ? blocks(draft.blocks) : draft.comment_markdown ?? ""}`; }),
    ...snapshot.annotations.map((item) => `### ${item.is_deleted ? "Deletion / 删除" : "Annotation / 批注"}\n\n${item.quote ?? ""}\n\n${item.comment_markdown}`),
    "## Preferences / 偏好", ...Object.entries(snapshot.preferences?.changes ?? {}).map(([key, change]) => `- ${key}: ${JSON.stringify(change?.value)}`),
    "Conflict intentions, pending deletions and exact anchors are also retained in changes.json. / 冲突意图、待同步删除及精确锚点同时保存在 changes.json。"].join("\n\n");
  const jsonBytes = strToU8(json), textBytes = strToU8(readable);
  if (jsonBytes.byteLength + textBytes.byteLength > 256 * 1024 * 1024) throw new Error("Pending export exceeds the browser's 256 MiB export limit.");
  const archive = zipSync({ "changes.json": jsonBytes, "notes.md": textBytes });
  assertOfflineAccess(access);
  return new Blob([archive as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}
