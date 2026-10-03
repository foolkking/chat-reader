"use client";
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authenticationGeneration, assertOfflineAccess } from "../../lib/offline-access";
import { offlineDb } from "../../lib/offline-db";
import { ContinuationDraftChangedError, listContinuationDrafts, removeContinuationDraft, writeContinuationDraft, type ContinuationDraft, type SavedContinuationDraft } from "../../lib/continuation-drafts";

export function useContinuationDraft(conversationId: string, member: ContinuationDraft["member"]) {
  const access = useRef(authenticationGeneration());
  const active = useRef<{ key: string; version: number } | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const serial = useRef(0);
  const [status, setStatus] = useState<"saved" | "saving" | "failed">("saved");
  const list = useQuery({ queryKey: ["continuation-drafts", offlineDb.name, conversationId, member],
    queryFn: () => listContinuationDrafts(conversationId, member), networkMode: "always" });
  const newKey = () => `continuation-draft:${conversationId}:${member}:${crypto.randomUUID()}`;
  const begin = (saved?: SavedContinuationDraft) => {
    active.current = saved ? { key: saved.key, version: saved.value.version } : { key: newKey(), version: 0 };
    setStatus("saved");
  };
  const retain = (text: string, original: string, baseGeneration: number) => {
    const sequence = ++serial.current;
    const value = { conversation_id: conversationId, member, text, original, base_generation: baseGeneration, updated_at: new Date().toISOString() };
    setStatus("saving");
    writes.current = writes.current.catch(() => undefined).then(async () => {
      if (sequence !== serial.current || !active.current) return;
      assertOfflineAccess(access.current);
      try {
        if (text === original) {
          await removeContinuationDraft(active.current.key, active.current.version);
          active.current.version = 0;
        } else active.current.version = await writeContinuationDraft(active.current.key, active.current.version, value);
      }
      catch (error) {
        if (!(error instanceof ContinuationDraftChangedError)) throw error;
        // Two windows may resume the same draft. Preserve both edits instead
        // of replacing a newer local copy with this window's older version.
        active.current = { key: newKey(), version: 0 };
        active.current.version = await writeContinuationDraft(active.current.key, 0, value);
      }
      if (sequence === serial.current) setStatus("saved");
    }).catch(() => { if (sequence === serial.current) setStatus("failed"); });
  };
  const discard = useCallback(async () => {
    await writes.current;
    if (active.current) {
      assertOfflineAccess(access.current);
      await removeContinuationDraft(active.current.key, active.current.version);
      active.current = null;
    }
    setStatus("saved");
  }, []);
  const remove = async (saved: SavedContinuationDraft) => {
    assertOfflineAccess(access.current);
    await removeContinuationDraft(saved.key, saved.value.version);
    await list.refetch();
  };
  return { list, status, begin, retain, discard, remove };
}
