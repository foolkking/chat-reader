import { offlineDb } from "./offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import type { SupportAction, SupportFlight, SupportKind } from "./support-client";

export type SupportDraft = {
  version: number; kind: SupportKind; title: string; body: string; importLimit: string; mergeLimit: string;
  action: SupportAction; notify: boolean; notifyReplies: boolean; diagnostics: string;
  baseRevision: number; flight: SupportFlight | null; updatedAt: string;
};
export type SavedSupportDraft = { key: string; value: SupportDraft };
export class SupportDraftConflict extends Error {}
export const supportDraftKey = (target: string) => `support-draft:${target}`;
export const emptySupportDraft = (kind: SupportKind = "QUESTION", revision = 0): SupportDraft => ({ version: 0, kind, title: "", body: "", importLimit: "", mergeLimit: "", action: "REPLY", notify: false, notifyReplies: false, diagnostics: "", baseRevision: revision, flight: null, updatedAt: "" });
export async function readSupportDraft(key: string) { return (await offlineDb.settings.get(key))?.value as SupportDraft | undefined; }
export async function writeSupportDraft(key: string, expectedVersion: number, draft: SupportDraft, access = captureOfflineAccess()): Promise<number> {
  assertOfflineAccess(access);
  const db = offlineDb;
  return db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    const current = await readSupportDraft(key);
    if ((current?.version ?? 0) !== expectedVersion) throw new SupportDraftConflict();
    const version = expectedVersion + 1;
    await db.settings.put({ key, value: { ...draft, version, updatedAt: new Date().toISOString() } });
    return version;
  });
}
export async function removeSupportDraft(key: string, expectedVersion: number, access = captureOfflineAccess()) {
  assertOfflineAccess(access);
  const db = offlineDb;
  await db.transaction("rw", db.settings, async () => {
    assertOfflineAccess(access);
    const current = await readSupportDraft(key);
    if (current && current.version !== expectedVersion) throw new SupportDraftConflict();
    await db.settings.delete(key);
  });
}
