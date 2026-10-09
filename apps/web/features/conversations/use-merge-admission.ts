"use client";

import { useEffect, useRef, useState } from "react";
import { ApiRequestError, getConversationMergeRequest } from "../../lib/api";
import { getCurrentOfflineRuntimeUserId } from "../../lib/auth-client";
import { authenticationGeneration, OFFLINE_ACCESS_LOCKED_EVENT, offlineAuthenticationRequired } from "../../lib/offline-access";
import type { BackgroundTaskRead } from "../../lib/types";

export type MergeAdmissionRequest = { idempotencyKey: string; conversationIds: string[]; title: string };
type Phase = "loading" | "idle" | "submitting" | "unknown" | "checking" | "retry" | "confirmed" | "locked";
type Context = { owner: string | null; epoch: number; open: boolean; storageKey: string; request: MergeAdmissionRequest | null; phase: Phase };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pendingRequests = new Map<string, MergeAdmissionRequest>();

export function decodeMergeRequest(raw: string | null): MergeAdmissionRequest | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("idempotencyKey" in value) || typeof value.idempotencyKey !== "string" || !uuid.test(value.idempotencyKey)
    || !("title" in value) || typeof value.title !== "string" || !("conversationIds" in value) || !Array.isArray(value.conversationIds)
    || value.conversationIds.length < 2 || value.conversationIds.length > 5000
    || !value.conversationIds.every(id => typeof id === "string" && uuid.test(id)) || new Set(value.conversationIds).size !== value.conversationIds.length) {
    throw new Error("Invalid saved merge request");
  }
  return { idempotencyKey: value.idempotencyKey, conversationIds: [...value.conversationIds], title: value.title };
}

export function useMergeAdmission({ open, projectId, onSubmit, onAccepted }: {
  open: boolean;
  projectId?: string;
  onSubmit: (request: MergeAdmissionRequest, signal: AbortSignal) => Promise<BackgroundTaskRead>;
  onAccepted: (task: BackgroundTaskRead) => void;
}) {
  const owner = getCurrentOfflineRuntimeUserId();
  const epoch = authenticationGeneration();
  const [phase, setPhase] = useState<Phase>("loading");
  const [request, setRequest] = useState<MergeAdmissionRequest | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const context = useRef<Context | null>(null);
  const flight = useRef<{ context: Context; controller: AbortController } | null>(null);
  const storageKey = `chat-reader:merge-request:${owner ?? "local"}:${projectId ?? "all"}`;
  const callbacks = useRef({ onSubmit, onAccepted, open, storageKey });
  callbacks.current = { onSubmit, onAccepted, open, storageKey };
  // New props can render before passive cleanup. Fence old work against that
  // render too, before it can use the new parent's callbacks or clear a receipt.
  const active = (value: Context) => value.open && callbacks.current.open && callbacks.current.storageKey === value.storageKey
    && context.current === value && value.epoch === authenticationGeneration()
    && value.owner === getCurrentOfflineRuntimeUserId() && (value.owner !== null || !offlineAuthenticationRequired());
  const transition = (value: Context, next: Phase) => { value.phase = next; setPhase(next); };

  useEffect(() => {
    // The page keeps this owner mounted while closed so recovery remains
    // discoverable without a new selection. Hydration never performs HTTP.
    const value: Context = { owner, epoch, open, storageKey, request: null, phase: "loading" };
    context.current = value;
    setError(null); setRequest(null); setStorageFailed(false);
    if (!owner && offlineAuthenticationRequired()) { value.phase = "locked"; setPhase("locked"); }
    else {
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(storageKey); } catch { setStorageFailed(true); }
      try {
        value.request = pendingRequests.get(storageKey) ?? decodeMergeRequest(raw);
        value.phase = value.request ? "unknown" : "idle";
      } catch {
        // An unreadable saved receipt is not evidence that no write occurred.
        value.phase = "locked"; setStorageFailed(true);
      }
      setRequest(value.request); setPhase(value.phase);
    }
    const lock = () => {
      if (context.current !== value) return;
      flight.current?.controller.abort();
      context.current = null; setRequest(null); setPhase("locked");
    };
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, lock);
    return () => {
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, lock);
      if (flight.current?.context === value) { flight.current.controller.abort(); flight.current = null; }
      if (context.current === value) context.current = null;
    };
  }, [open, owner, epoch, storageKey]);

  const remember = (value: Context, next: MergeAdmissionRequest | null) => {
    const previousKey = value.request?.idempotencyKey;
    value.request = next; setRequest(next);
    if (next) pendingRequests.set(value.storageKey, next);
    else if (pendingRequests.get(value.storageKey)?.idempotencyKey === previousKey) pendingRequests.delete(value.storageKey);
    try {
      if (next) sessionStorage.setItem(value.storageKey, JSON.stringify(next));
      else {
        const saved = decodeMergeRequest(sessionStorage.getItem(value.storageKey));
        if (saved?.idempotencyKey === previousKey) sessionStorage.removeItem(value.storageKey);
      }
    } catch { setStorageFailed(true); }
  };
  const acknowledge = (value: Context, task: BackgroundTaskRead) => {
    remember(value, null); setError(null); transition(value, "confirmed");
    // Refresh/parent callbacks are not part of the write's outcome.
    try { void Promise.resolve(callbacks.current.onAccepted(task)).catch(() => {}); } catch { /* Admission remains confirmed. */ }
  };
  const submit = async (value: Context, original: MergeAdmissionRequest) => {
    if (!active(value) || flight.current) return;
    const operation = { context: value, controller: new AbortController() };
    flight.current = operation; transition(value, "submitting"); setError(null);
    try {
      const task = await callbacks.current.onSubmit(original, operation.controller.signal);
      if (active(value)) acknowledge(value, task);
    } catch (reason) {
      if (!active(value)) return;
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      if (reason instanceof ApiRequestError && [400, 422].includes(reason.status)) {
        remember(value, null); transition(value, "idle");
      } else transition(value, "unknown");
    } finally { if (flight.current === operation) flight.current = null; }
  };
  const start = (conversationIds: string[], title: string) => {
    const value = context.current;
    if (!value || !active(value) || value.phase !== "idle" || flight.current || conversationIds.length < 2) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(value.storageKey); } catch { setStorageFailed(true); }
    try {
      const saved = pendingRequests.get(value.storageKey) ?? decodeMergeRequest(raw);
      if (saved) { value.request = saved; setRequest(saved); transition(value, "unknown"); return; }
    } catch { setStorageFailed(true); transition(value, "locked"); return; }
    const original = { idempotencyKey: crypto.randomUUID(), conversationIds: [...conversationIds], title: title.trim() || "Merged conversation" };
    remember(value, original);
    void submit(value, original);
  };
  const check = async () => {
    const value = context.current;
    if (!value || !active(value) || !value.request || flight.current || !["unknown", "retry"].includes(value.phase)) return;
    const operation = { context: value, controller: new AbortController() };
    flight.current = operation; transition(value, "checking"); setError(null);
    try {
      const result = await getConversationMergeRequest(value.request.idempotencyKey, operation.controller.signal);
      if (!active(value)) return;
      if (result.found && result.task) acknowledge(value, result.task);
      else if (result.found === false && result.task === null) transition(value, "retry");
      else throw new Error("Incomplete merge receipt");
    } catch (reason) {
      if (active(value)) { setError(reason instanceof Error ? reason : new Error(String(reason))); transition(value, "unknown"); }
    } finally { if (flight.current === operation) flight.current = null; }
  };
  const retry = () => {
    const value = context.current;
    if (value && active(value) && value.phase === "retry" && value.request) void submit(value, value.request);
  };
  const current = context.current;
  const visible = current?.open === open && current.storageKey === storageKey && current.epoch === epoch;
  return { phase: visible ? phase : "loading", request: visible ? request : null, error: visible ? error : null,
    storageFailed, start, check, retry, clearError: () => setError(null) };
}
