"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { offlineDb } from "../../lib/offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "../../lib/offline-access";

export type SourceDraft = {
  conversation_id: string; message_id: string; base_version: number;
  text: string; saved_at: string; revision: number;
};
export function useSourceDraft(conversationId: string | undefined, messageId: string | undefined,
  version: number, text: string, baseline: string) {
  const [nonce] = useState(() => crypto.randomUUID());
  const [candidate, setCandidate] = useState<{ key: string; value: SourceDraft } | null>(null);
  const [status, setStatus] = useState<"loading" | "saved" | "error">("loading");
  const key = messageId ? `source-editor-draft:${messageId}:${nonce}` : null;
  const tail = useRef(Promise.resolve());
  const revision = useRef(0);
  const retiredRevision = useRef(0);
  const confirmedText = useRef<string | null>(null);
  const active = useRef(true);
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
      const found = rows.filter(row => row.key !== key).sort((a, b) =>
        (b.value as SourceDraft).saved_at.localeCompare((a.value as SourceDraft).saved_at))[0];
      setCandidate(found ? found as { key: string; value: SourceDraft } : null);
      setStatus("saved");
    })().catch(() => { if (active.current) setStatus("error"); });
    return () => { active.current = false; };
  }, [key, messageId]);
  useEffect(() => {
    if (!key || !messageId || !conversationId || text === baseline) return;
    const db = offlineDb;
    let access: ReturnType<typeof captureOfflineAccess>;
    try { access = captureOfflineAccess(); } catch { setStatus("error"); return; }
    const value: SourceDraft = { conversation_id: conversationId, message_id: messageId,
      base_version: version, text, saved_at: new Date().toISOString(), revision: ++revision.current };
    const persist = () => queue(async () => {
      assertOfflineAccess(access);
      if (value.revision <= retiredRevision.current || confirmedText.current === value.text) return;
      if (text.length > 8 * 1024 * 1024) throw new Error("Draft exceeds local storage budget");
      await db.settings.put({ key, value });
      assertOfflineAccess(access);
    });
    const timer = setTimeout(() => void persist(), 300);
    return () => { clearTimeout(timer); void persist(); };
  }, [baseline, conversationId, key, messageId, queue, text, version]);
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
  const acknowledge = useCallback(async (savedText: string) => {
    retiredRevision.current = revision.current;
    confirmedText.current = savedText;
    await remove();
    if (candidate?.value.text === savedText) await remove(candidate.key, candidate.value.revision);
  }, [candidate, remove]);
  return { candidate, status, remove, acknowledge };
}
