"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureOfflineAccess, assertOfflineAccess } from "../lib/offline-access";
import { readSupportDraft, removeSupportDraft, writeSupportDraft, type SupportDraft } from "../lib/support-drafts";

/** Ordered, account-fenced writes. Network retries persist the exact original payload. */
export function useSupportDraft(key: string, initial: SupportDraft, onDirtyChange?: (dirty: boolean) => void) {
  const [draft, setDraft] = useState(initial), [ready, setReady] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [restored, setRestored] = useState(false);
  const value = useRef(initial), version = useRef(0), queue = useRef(Promise.resolve()), failure = useRef<unknown>(null), pending = useRef(0), mounted = useRef(true);
  const ownerAccess = useRef<number | null>(null);
  const captureDraftAccess = useCallback(() => {
    ownerAccess.current ??= captureOfflineAccess();
    assertOfflineAccess(ownerAccess.current);
    return ownerAccess.current;
  }, []);
  const defaults = useRef(initial);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(async () => {
    const access = captureDraftAccess();
    await queue.current;
    assertOfflineAccess(access);
    const stored = await readSupportDraft(key);
    assertOfflineAccess(access);
    if (!mounted.current) return;
    version.current = stored?.version ?? 0;
    setRestored(Boolean(stored));
    value.current = stored ?? defaults.current; setDraft(value.current);
    failure.current = null; setError(null); setReady(true);
  }, [key, captureDraftAccess]);
  useEffect(() => { void reload().catch(e => { if (mounted.current) setError(e); }); }, [reload]);
  useEffect(() => { onDirtyChange?.(saving || Boolean(error)); }, [saving, error, onDirtyChange]);
  const persist = useCallback(async (next: SupportDraft) => {
    const access = captureDraftAccess();
    value.current = next; setDraft(next); pending.current++; setSaving(true);
    const job = queue.current.then(async () => {
      if (failure.current) throw failure.current;
      version.current = await writeSupportDraft(key, version.current, next, access);
    });
    queue.current = job.catch(e => { failure.current = e; if (mounted.current) setError(e); }).finally(() => { pending.current--; if (mounted.current) setSaving(pending.current > 0); });
    return job;
  }, [key, captureDraftAccess]);
  const change = useCallback((patch: Partial<SupportDraft>) => { void persist({ ...value.current, ...patch }).catch(() => undefined); }, [persist]);
  const flush = useCallback(async () => { await queue.current; if (failure.current) throw failure.current; }, []);
  const retry = useCallback(async () => { await queue.current; failure.current = null; setError(null); await persist(value.current); }, [persist]);
  const remove = useCallback(async () => { const access = captureDraftAccess(); await flush(); await removeSupportDraft(key, version.current, access); version.current = 0; }, [flush, key, captureDraftAccess]);
  return { draft, ready, saving, error, restored, change, persist, flush, remove, reload, retry };
}
