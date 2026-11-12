"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { offlineDb } from "../../lib/offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "../../lib/offline-access";

export type SourceDraft = {
  conversation_id: string; message_id: string; base_version: number;
  base_version_id?: string | null; base_content_hash?: string | null;
  text: string; saved_at: string; revision: number;
};
export function draftMatchesSource(draft: SourceDraft, versionId?: string, contentHash?: string) {
  return Boolean(versionId && contentHash && draft.base_version_id === versionId && draft.base_content_hash === contentHash);
}
export function useSourceDraft(conversationId: string | undefined, messageId: string | undefined,
  version: number, text: string, baseline: string, versionId?: string, contentHash?: string) {
  const [nonce] = useState(() => crypto.randomUUID());
  const [candidate, setCandidate] = useState<{ key: string; value: SourceDraft } | null>(null);
  const [status, setStatus] = useState<"loading" | "saved" | "error">("loading");
  const key = messageId ? `source-editor-draft:${messageId}:${nonce}` : null;
  const tail = useRef(Promise.resolve());
  const revision = useRef(0);
  const retiredRevision = useRef(0);
  const persistedRevision = useRef(0);
  const base = useRef<Pick<SourceDraft, "base_version" | "base_version_id" | "base_content_hash"> | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const active = useRef(true);
  const latestText = useRef(text);
  latestText.current = text;
  const queue = useCallback((write: () => Promise<void>) => {
    const next = tail.current.catch(() => undefined).then(write);
    tail.current = next;
    void next.then(() => { if (active.current) setStatus("saved"); }, () => { if (active.current) setStatus("error"); });
    return next;
  }, []);
  useEffect(() => {
    active.current = true;
    if (!messageId) { setStatus("saved"); return; }
    void (async () => {
      const db = offlineDb, access = captureOfflineAccess();
      const rows = await db.settings.where("key").startsWith(`source-editor-draft:${messageId}:`).toArray();
      assertOfflineAccess(access);
      if (!active.current) return;
      const found = rows.filter(row => row.key !== key && (row.value as SourceDraft).conversation_id === conversationId).sort((a, b) =>
        (b.value as SourceDraft).saved_at.localeCompare((a.value as SourceDraft).saved_at))[0];
      setCandidate(found ? found as { key: string; value: SourceDraft } : null);
      setStatus("saved");
    })().catch(() => { if (active.current) setStatus("error"); });
    return () => { active.current = false; };
  }, [conversationId, key, messageId]);
  useEffect(() => {
    if (!key || !messageId || !conversationId) return;
    const db = offlineDb;
    if (text === baseline) {
      pending.current = null;
      if (!base.current) return;
      base.current = null;
      retiredRevision.current = ++revision.current;
      try {
        const access = captureOfflineAccess();
        void queue(async () => { assertOfflineAccess(access); await db.settings.delete(key); });
      } catch { setStatus("error"); }
      return;
    }
    let access: ReturnType<typeof captureOfflineAccess>;
    try { access = captureOfflineAccess(); } catch { setStatus("error"); return; }
    base.current ??= { base_version: version, base_version_id: versionId ?? null, base_content_hash: contentHash ?? null };
    const value: SourceDraft = { conversation_id: conversationId, message_id: messageId,
      ...base.current, text, saved_at: new Date().toISOString(), revision: ++revision.current };
    const persist = () => { void queue(async () => {
      assertOfflineAccess(access);
      if (value.revision !== revision.current || value.revision <= retiredRevision.current
        || value.revision <= persistedRevision.current) return;
      if (text.length > 8 * 1024 * 1024) throw new Error("Draft exceeds local storage budget");
      await db.settings.put({ key, value });
      assertOfflineAccess(access);
      persistedRevision.current = value.revision;
    }); };
    pending.current = persist;
    const timer = setTimeout(persist, 300);
    // A dependency change is not an editor close: coalesce the next revision.
    return () => { clearTimeout(timer); };
  }, [baseline, contentHash, conversationId, key, messageId, queue, text, version, versionId]);
  useEffect(() => {
    const flush = () => pending.current?.();
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
  }, []);
  const remove = useCallback(async (entryKey = key, expectedRevision?: number) => {
    if (!entryKey) return;
    const db = offlineDb, access = captureOfflineAccess();
    await queue(() => db.transaction("rw", db.settings, async () => {
      assertOfflineAccess(access);
      const stored = (await db.settings.get(entryKey))?.value as SourceDraft | undefined;
      if (expectedRevision !== undefined && stored?.revision !== expectedRevision) throw new Error("Draft changed");
      await db.settings.delete(entryKey);
    }));
    if (entryKey === candidate?.key) setCandidate(null);
  }, [candidate?.key, key, queue]);
  const acknowledge = useCallback(async (savedText: string, confirmedBase?: Pick<SourceDraft, "base_version" | "base_version_id" | "base_content_hash">) => {
    if (latestText.current === savedText) {
      retiredRevision.current = revision.current;
      pending.current = null;
      base.current = null;
      // Capture the revision before the asynchronous queue: new typing must
      // not be deleted by an old acknowledgement.
      const acknowledgedRevision = revision.current;
      const access = captureOfflineAccess();
      await queue(async () => {
        assertOfflineAccess(access);
        if (key && revision.current === acknowledgedRevision) await offlineDb.settings.delete(key);
      });
    } else if (confirmedBase) {
      base.current = confirmedBase;
    }
    if (candidate?.value.text === savedText) await remove(candidate.key, candidate.value.revision);
  }, [candidate, key, queue, remove]);
  const restoreBase = useCallback((value: SourceDraft) => {
    base.current = { base_version: value.base_version, base_version_id: value.base_version_id,
      base_content_hash: value.base_content_hash };
  }, []);
  return { candidate, status, remove, acknowledge, restoreBase };
}
