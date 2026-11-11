"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../lib/api";
import { authenticationGeneration, AUTH_GENERATION_CHANGED_EVENT } from "../../lib/offline-access";
import {
  checkContinuationIntent, rejectedContinuationWrite, submitContinuationIntent,
  type ContinuationIntent, type ContinuationWriteResult,
} from "../../lib/continuation-write-recovery";

type Receipt = {
  intent: ContinuationIntent;
  phase: "submitting" | "unknown" | "rejected" | "confirmed";
  notFound?: boolean;
  error?: unknown;
  result?: ContinuationWriteResult;
};
export type ContinuationSubmit = (intent: ContinuationIntent, confirmed: (result: ContinuationWriteResult) => Promise<void>) => Promise<void>;

// One retained intent per conversation in the existing auth-cleared query
// cache. No File is persisted to disk, replayed by an effect, or rebased.
export function useContinuationWrite(id: string, fallback: (result: ContinuationWriteResult) => Promise<void>) {
  const cache = useQueryClient();
  const [generation] = useState(authenticationGeneration);
  const [epoch, setEpoch] = useState(generation);
  const key = ["continuation-write", generation, id];
  const receipt = useQuery<Receipt | null>({ queryKey: key, queryFn: () => null,
    enabled: false, staleTime: Infinity, gcTime: Infinity }).data;
  const alive = useRef(true), lock = useRef(false);
  const callback = useRef<{ key: string; run: (result: ContinuationWriteResult) => Promise<void> } | null>(null);
  const defaultCallback = useRef(fallback);
  defaultCallback.current = fallback;
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [followupFailed, setFollowupFailed] = useState(false);
  const consume = useRef<string | null>(null);
  const valid = () => generation === authenticationGeneration();
  const current = () => cache.getQueryData<Receipt>(key);
  useEffect(() => {
    alive.current = true;
    const changed = () => {
      setEpoch(authenticationGeneration());
      cache.removeQueries({ queryKey: ["continuation-write", generation, id], exact: true });
      callback.current = null;
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
    return () => { alive.current = false; window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, changed); };
  }, [cache, generation, id]);

  async function acknowledge(prior: Receipt, result: ContinuationWriteResult) {
    if (!valid()) return;
    cache.setQueryData<Receipt>(key, { intent: prior.intent, phase: "confirmed", result });
    if (!alive.current) return; // Re-entry consumes the receipt, not another write.
    consume.current = prior.intent.key;
    try {
      await (callback.current?.key === prior.intent.key ? callback.current.run : defaultCallback.current)(result);
      if (valid() && current()?.intent.key === prior.intent.key) {
        cache.setQueryData(key, null);
        callback.current = null;
      }
    } catch {
      // A confirmed server write cannot become "unknown" because rendering,
      // local draft removal or a follow-up read failed.
      if (alive.current && valid()) setFollowupFailed(true);
    }
  }
  async function perform(intent: ContinuationIntent) {
    lock.current = true;
    setCheckFailed(false); setFollowupFailed(false);
    cache.setQueryData<Receipt>(key, { intent, phase: "submitting" });
    let result: ContinuationWriteResult;
    try { result = await submitContinuationIntent(id, intent); }
    catch (error) {
      if (valid()) cache.setQueryData<Receipt>(key, { intent, phase: rejectedContinuationWrite(error) ? "rejected" : "unknown", error });
      lock.current = false;
      return;
    }
    try { await acknowledge({ intent, phase: "confirmed" }, result); }
    finally { lock.current = false; }
  }
  const submit: ContinuationSubmit = async (intent, confirmed) => {
    if (!valid() || lock.current || ["submitting", "unknown", "confirmed"].includes(current()?.phase ?? "")) return;
    callback.current = { key: intent.key, run: confirmed };
    await perform(intent);
  };
  const check = async () => {
    const prior = current();
    if (!valid() || !prior || prior.phase !== "unknown" || lock.current) return;
    lock.current = true; setChecking(true); setCheckFailed(false);
    try {
      const result = await checkContinuationIntent(id, prior.intent);
      if (!valid()) return;
      if (result.state === "confirmed") await acknowledge(prior, result.result);
      else if (result.state === "conflict") cache.setQueryData<Receipt>(key, { ...prior, phase: "rejected",
        error: new ApiRequestError("CONTEXT_BASE_CHANGED", 409, "", "CONTEXT_BASE_CHANGED") });
      else cache.setQueryData<Receipt>(key, { ...prior, notFound: true });
    } catch { if (alive.current && valid()) setCheckFailed(true); }
    finally { lock.current = false; if (alive.current && valid()) setChecking(false); }
  };
  const retry = async () => {
    const prior = current();
    if (!valid() || !prior || prior.phase !== "unknown" || !prior.notFound || lock.current) return;
    // The original key, base and File objects are reused, including after the
    // panel unmounted. A read never invokes this action.
    await perform(prior.intent).catch(() => undefined);
  };
  useEffect(() => {
    if (receipt?.phase !== "confirmed" || !receipt.result || lock.current || consume.current === receipt.intent.key || epoch !== generation) return;
    consume.current = receipt.intent.key;
    void acknowledge(receipt, receipt.result);
    // Re-entry only. All changing callback dependencies live in refs.
  }, [receipt, epoch, generation]);
  const refreshConfirmed = async () => {
    const prior = current();
    if (!valid() || !prior?.result || prior.phase !== "confirmed" || lock.current) return;
    lock.current = true; setChecking(true); setFollowupFailed(false);
    try { await acknowledge(prior, prior.result); }
    finally { lock.current = false; if (alive.current && valid()) setChecking(false); }
  };
  return {
    receipt: epoch === generation ? receipt : null, checking, checkFailed, followupFailed,
    locked: epoch !== generation || ["submitting", "unknown", "confirmed"].includes(receipt?.phase ?? ""),
    submit, check, retry, refreshConfirmed,
  };
}
