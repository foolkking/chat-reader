"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import type { ShareCreateInput } from "../../lib/types";

export type ShareCreationIntent = {
  key: string; payload: ShareCreateInput; generation: number;
  phase: "writing" | "unknown" | "checking" | "absent" | "confirmed"; url?: string;
};
// One unresolved intent per conversation in this tab, independent of panel mounts.
// Passwords stay in memory only; account fences discard them with the old epoch.
const intents = new Map<string, ShareCreationIntent>();
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function currentShareIntent(conversationId: string) {
  const intent = intents.get(conversationId);
  return intent?.generation === authenticationGeneration() ? intent : null;
}
export function beginShareIntent(conversationId: string, payload: ShareCreateInput) {
  const existing = currentShareIntent(conversationId);
  if (existing && existing.phase !== "confirmed") throw new Error("SHARE_RESULT_REQUIRES_CHECK");
  const intent: ShareCreationIntent = { key: crypto.randomUUID(), payload, generation: authenticationGeneration(), phase: "writing" };
  intents.set(conversationId, intent); publish();
  return intent;
}
export function updateShareIntent(conversationId: string, owned: ShareCreationIntent, changes: Partial<ShareCreationIntent> | null) {
  if (owned.generation !== authenticationGeneration() || currentShareIntent(conversationId)?.key !== owned.key) return;
  if (changes) intents.set(conversationId, { ...owned, ...changes });
  else intents.delete(conversationId);
  publish();
}
export function useShareCreationIntent(conversationId: string) {
  const snapshot = useCallback(() => currentShareIntent(conversationId), [conversationId]);
  const intent = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => {
    const reset = () => {
      for (const [id, value] of intents) if (value.generation !== authenticationGeneration()) intents.delete(id);
      publish();
    };
    reset();
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, reset);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, reset);
  }, []);
  return intent;
}
