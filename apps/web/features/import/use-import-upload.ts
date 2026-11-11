"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, createAdaptiveImportSession, getAdaptiveImportSession, getAdaptiveUploadReceipt } from "../../lib/api";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import type { AdaptiveImportSession } from "../../lib/types";
import type { UploadProgress } from "../../lib/upload-transport";

type Intent = {
  files: File[];
  // Preserve the source editor without decoding a generated File on reopen.
  // This immutable string shares the intent's bounded, account-scoped lifetime.
  pastedText?: string;
  repairProfileId?: string | null;
  targetProjectId?: string | null;
};
type Receipt = {
  requestId: string;
  phase: "uploading" | "unknown" | "rejected" | "confirmed";
  intent?: Intent;
  progress?: UploadProgress;
  cancel?: () => void;
  importId?: string;
  error?: unknown;
  notFound?: boolean;
  checking?: boolean;
  checkFailed?: boolean;
  unavailable?: boolean;
};

/** One current initial upload per account epoch. Query cache owns the intent,
 * not the dialog. Closing never loses its receipt or cancels server work. */
export function useImportUpload(active: boolean, accept: (session: AdaptiveImportSession) => void) {
  const cache = useQueryClient();
  const [generation] = useState(authenticationGeneration);
  const [epoch, setEpoch] = useState(generation);
  const key = ["adaptive-import-upload", generation];
  const retainedKey = ["adaptive-import-upload-retained", generation];
  const receipt = useQuery<Receipt | null>({ queryKey: key, queryFn: () => null,
    enabled: false, staleTime: Infinity, gcTime: Infinity }).data;
  const retained = useQuery<Receipt[]>({ queryKey: retainedKey, queryFn: () => [],
    enabled: false, staleTime: Infinity, gcTime: Infinity }).data ?? [];
  const alive = useRef(true), consumes = useRef<string | null>(null);
  const latest = useRef({ active, accept });
  latest.current = { active, accept };
  const valid = () => generation === authenticationGeneration();
  const current = () => cache.getQueryData<Receipt>(key);
  const owns = (id: string) => valid() && current()?.requestId === id;
  useEffect(() => {
    alive.current = true;
    const changed = () => {
      cache.getQueryData<Receipt>(["adaptive-import-upload", generation])?.cancel?.();
      cache.removeQueries({ queryKey: ["adaptive-import-upload", generation], exact: true });
      cache.removeQueries({ queryKey: ["adaptive-import-upload-retained", generation], exact: true });
      setEpoch(authenticationGeneration());
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
    return () => { alive.current = false; window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, changed); };
  }, [cache, generation]);
  useEffect(() => {
    if (!receipt?.intent || receipt.phase === "rejected") return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [receipt?.intent, receipt?.phase]);

  function publishConfirmed(requestId: string, result: AdaptiveImportSession) {
    if (!owns(requestId)) return;
    // Release File references before any UI/session-storage work can fail.
    cache.setQueryData<Receipt>(key, { requestId, phase: "confirmed", importId: result.import_id });
    if (!alive.current || !latest.current.active) return;
    consumes.current = requestId;
    try {
      latest.current.accept(result);
      if (owns(requestId)) cache.setQueryData(key, null);
    } catch {
      if (owns(requestId)) cache.setQueryData<Receipt>(key, { requestId, phase: "confirmed",
        importId: result.import_id, checkFailed: true });
    }
  }
  async function perform(requestId: string, intent: Intent, uncertainRetry = false) {
    const controller = new AbortController();
    consumes.current = null;
    cache.setQueryData<Receipt>(key, { requestId, intent, phase: "uploading",
      progress: { stage: "uploading", percent: null }, cancel: () => controller.abort() });
    try {
      const result = await createAdaptiveImportSession(intent.files, intent.repairProfileId, intent.targetProjectId, {
        requestId, signal: controller.signal, onProgress: progress => {
          if (owns(requestId)) cache.setQueryData<Receipt>(key, previous =>
            previous?.phase === "uploading" ? { ...previous, progress } : previous);
        },
      });
      if (!result || !result.import_id || !result.state) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
      publishConfirmed(requestId, result);
    } catch (error) {
      if (owns(requestId)) {
        const rejected = !uncertainRetry && error instanceof ApiRequestError && error.status >= 400 && error.status < 500
          && ![408, 429].includes(error.status) && !["IMPORT_UPLOAD_REQUEST_PENDING", "IMPORT_UPLOAD_REQUEST_CONFLICT",
            "IMPORT_UPLOAD_RECEIPT_UNAVAILABLE"].includes(error.code ?? "");
        cache.setQueryData<Receipt>(key, { requestId, intent, phase: rejected ? "rejected" : "unknown", error });
      }
    } finally {
      if (!valid()) cache.removeQueries({ queryKey: key, exact: true });
    }
  }
  const submit = async (intent: Intent) => {
    // Synchronous cache state, not React's next render, prevents double clicks.
    if (!valid() || (current() && current()?.phase !== "rejected")) return;
    await perform(crypto.randomUUID(), { ...intent, files: [...intent.files] });
  };
  const check = async () => {
    const prior = current();
    if (!valid() || !prior || prior.checking || prior.unavailable || !["unknown", "confirmed"].includes(prior.phase)) return;
    cache.setQueryData<Receipt>(key, { ...prior, checking: true, checkFailed: false });
    try {
      let importId = prior.importId;
      if (!importId) {
        const response = await getAdaptiveUploadReceipt(prior.requestId);
        if (!owns(prior.requestId)) return;
        if (!response || !Object.hasOwn(response, "receipt")) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
        if (response.receipt === null) {
          cache.setQueryData<Receipt>(key, { ...prior, notFound: true });
          return;
        }
        importId = response.receipt.import_id;
        if (!importId) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
      }
      consumes.current = prior.requestId;
      // A failed subsequent session read must never re-enable an upload.
      cache.setQueryData<Receipt>(key, { requestId: prior.requestId, phase: "confirmed", importId, checking: true });
      const result = await getAdaptiveImportSession(importId);
      if (result.import_id !== importId) throw new Error("IMPORT_UPLOAD_RECEIPT_INVALID");
      publishConfirmed(prior.requestId, result);
    } catch (error) {
      if (owns(prior.requestId)) cache.setQueryData<Receipt>(key, value => {
        if (!value) return value;
        const unavailable = error instanceof ApiRequestError && (
          error.code === "IMPORT_UPLOAD_RECEIPT_UNAVAILABLE"
          || (Boolean(value.importId) && error.status === 404));
        return unavailable ? { requestId: value.requestId, phase: "confirmed", importId: value.importId, unavailable: true }
          : { ...value, checking: false, checkFailed: true, notFound: false, error };
      });
    }
  };
  const retry = async () => {
    const prior = current();
    if (!valid() || !prior?.intent || prior.checking || prior.phase !== "unknown" || !prior.notFound) return;
    await perform(prior.requestId, prior.intent, true);
  };
  useEffect(() => {
    if (!active || epoch !== generation || receipt?.phase !== "confirmed" || receipt.checking || receipt.unavailable
      || consumes.current === receipt.requestId) return;
    consumes.current = receipt.requestId;
    void check();
  }, [active, epoch, generation, receipt]);
  const clearRejected = () => {
    if (valid() && current()?.phase === "rejected") cache.setQueryData(key, null);
  };
  const dismiss = (expected: Receipt) => {
    // Explicit local-only release, never a server cancel/delete. A stale
    // confirmation cannot dismiss a changed receipt or active transmission.
    if (!alive.current || !valid() || current() !== expected || expected.checking
      || !["unknown", "confirmed"].includes(expected.phase)) return false;
    cache.setQueryData(key, null);
    return true;
  };
  const detach = () => {
    const prior = current(), saved = cache.getQueryData<Receipt[]>(retainedKey) ?? [];
    if (!valid() || !prior || prior.phase !== "unknown" || prior.checking || saved.length >= 3) return false;
    cache.setQueryData(retainedKey, [...saved, prior]);
    cache.setQueryData(key, null);
    return true;
  };
  const reopen = (requestId: string) => {
    const previous = current();
    if (!valid() || previous?.checking || (previous && !["rejected", "unknown"].includes(previous.phase))) return;
    const saved = cache.getQueryData<Receipt[]>(retainedKey) ?? [];
    const prior = saved.find(item => item.requestId === requestId);
    if (!prior) return;
    cache.setQueryData(key, prior);
    // At the bounded retention cap, switching checks swaps intents instead
    // of locking every older recovery behind the current unresolved one.
    cache.setQueryData(retainedKey, [...saved.filter(item => item.requestId !== requestId),
      ...(previous?.phase === "unknown" ? [previous] : [])]);
  };
  return {
    receipt: epoch === generation ? receipt : null, submit, check, retry, clearRejected, dismiss,
    retained: epoch === generation ? retained : [], detach, reopen,
    canDetach: epoch === generation && receipt?.phase === "unknown" && !receipt.checking && retained.length < 3,
    locked: epoch !== generation || Boolean(receipt && receipt.phase !== "rejected"),
  };
}
