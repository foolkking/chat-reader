"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, getGlobalCleanupScanRequest, scanExistingConversations } from "../lib/api";
import { getCurrentOfflineRuntimeUserId } from "../lib/auth-client";
import { authenticationGeneration, offlineAuthenticationRequired } from "../lib/offline-access";
import type { CleanupScanRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

export function GlobalCleanupScan({ onOpenTasks }: { onOpenTasks: () => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const { confirm } = useInteractionDialog();
  const [phase, setPhase] = useState<"loading" | "idle" | "unknown" | "retry" | "confirmed">("loading");
  const [message, setMessage] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const [reviewClosed, setReviewClosed] = useState(false);
  const requestId = useRef<string | null>(null);
  const storageKey = useRef<string | null>(null);
  const generation = useRef(authenticationGeneration());
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  const signal = () => { controller.current?.abort(); controller.current = new AbortController(); return controller.current.signal; };
  useEffect(() => {
    mounted.current = true;
    const owner = getCurrentOfflineRuntimeUserId();
    if (owner || !offlineAuthenticationRequired()) {
      storageKey.current = `chat-reader:global-noise:${owner ?? "local"}`;
      try {
        const value = sessionStorage.getItem(storageKey.current);
        if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) requestId.current = value;
      } catch { setStorageFailed(true); }
    } else setStorageFailed(true);
    setPhase(requestId.current ? "unknown" : "idle");
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const clearRequest = () => {
    requestId.current = null;
    try { if (storageKey.current) sessionStorage.removeItem(storageKey.current); } catch { setStorageFailed(true); }
  };
  const acknowledge = async (scan?: CleanupScanRead | null) => {
    if (scan) await client.cancelQueries({ queryKey: ["content-cleanup-scan", scan.id] });
    if (!active()) return;
    if (scan) client.setQueryData(["content-cleanup-scan", scan.id], scan);
    clearRequest(); setMessage(""); setReviewClosed(!scan); setPhase("confirmed");
    void client.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
    void client.invalidateQueries({ queryKey: ["active-tasks"] });
  };
  const submit = useMutation({
    mutationFn: () => scanExistingConversations(requestId.current!, signal()),
    onSuccess: scan => { if (active()) return acknowledge(scan); },
    onError: error => {
      if (!active()) return;
      if (error instanceof ApiRequestError && [400, 422].includes(error.status)) {
        clearRequest(); setPhase("idle");
        if (error.message.includes("No active cleanup rules")) void client.invalidateQueries({ queryKey: ["content-cleanup-rules"] });
        setMessage(error.message.includes("No active cleanup rules") ? (zh ? "请先启用至少一条噪声规则。" : "Enable at least one noise rule first.")
          : error.message.includes("At least one active conversation") ? (zh ? "还没有可扫描的活动对话。请先导入或创建对话。" : "No active conversations to scan. Import or create a conversation first.")
            : (zh ? "此次扫描未受理，请重新打开规则库后重试。" : "This scan was not accepted. Reopen the rule library and retry."));
      } else { setPhase("unknown"); setMessage(zh ? "尚未确认扫描是否已排队，请先核对结果。" : "Scan admission is unconfirmed. Check the result first."); }
    },
  });
  const check = useMutation({
    mutationFn: () => getGlobalCleanupScanRequest(requestId.current!, signal()),
    onSuccess: async result => {
      if (!active()) return;
      if (result.found) await acknowledge(result.scan);
      else { setPhase("retry"); setMessage(""); }
    },
    onError: () => { if (active()) setMessage(zh ? "核对失败，原请求仍保留。请检查连接后重试核对。" : "The check failed. Your original request is kept; check the connection and retry."); },
  });
  const start = async () => {
    if (!await confirm({ title: zh ? "扫描现有对话？" : "Scan existing conversations?", description: zh ? "扫描本人的全部活动对话，归档除外。后台扫描只生成候选，正文不变。" : "Scan all your active conversations, excluding archives. The background scan creates candidates; content stays unchanged.", confirmLabel: zh ? "开始后台扫描" : "Start background scan" }) || !active()) return;
    requestId.current = crypto.randomUUID();
    try { if (storageKey.current) sessionStorage.setItem(storageKey.current, requestId.current); } catch { setStorageFailed(true); }
    setMessage(""); setPhase("unknown"); submit.mutate();
  };
  const busy = submit.isPending || check.isPending;
  useEffect(() => {
    if (phase === "confirmed" || message) feedback.current?.focus({ preventScroll: true });
  }, [phase, message]);
  return <>
    <button type="button" disabled={busy || !["idle", "confirmed"].includes(phase)} onClick={() => void start()} className="btn-secondary min-h-11 px-3 text-xs">{submit.isPending ? (zh ? "正在提交…" : "Submitting…") : (zh ? "扫描现有对话" : "Scan existing conversations")}</button>
    {phase === "confirmed" || phase === "unknown" || phase === "retry" || message ? <div ref={feedback} tabIndex={-1} aria-label={zh ? "扫描请求状态" : "Scan request status"} className="basis-full space-y-2 text-xs leading-5 outline-none">
      {message ? <p role="alert" className="text-[var(--danger)]">{message}</p> : null}
      {phase === "confirmed" ? <><p role="status" className="text-secondary">{reviewClosed ? (zh ? "此次请求已有任务记录，审查已结束或关闭。如需再次检查，请发起新的扫描。" : "This request has a task record, but its review has ended or closed. Start a new scan if needed.") : (zh ? "已找到此次扫描任务，可在任务中心查看进度和结果。" : "This scan task is available. View progress and results in the task center.")}</p>{!reviewClosed ? <button type="button" onClick={onOpenTasks} className="btn-secondary min-h-11 px-3">{zh ? "打开任务中心" : "Open task center"}</button> : null}</> : null}
      {phase === "unknown" && !submit.isPending ? <>{!message ? <p className="text-secondary">{zh ? "保留了上次请求，核对不会再次扫描。" : "Your previous request is kept. Checking does not start another scan."}</p> : null}<button type="button" disabled={busy} onClick={() => { setMessage(""); check.mutate(); }} className="btn-secondary min-h-11 px-3">{check.isPending ? (zh ? "正在核对…" : "Checking…") : (zh ? "检查扫描结果" : "Check scan result")}</button></> : null}
      {phase === "retry" ? <><p role="status" className="text-secondary">{zh ? "暂未找到此次任务。可以继续提交原请求，不会重复创建。" : "This task has not been found yet. Resubmit the same request without creating a duplicate."}</p><button type="button" disabled={busy} onClick={() => { setMessage(""); submit.mutate(); }} className="btn-secondary min-h-11 px-3">{zh ? "继续提交扫描" : "Resubmit scan"}</button></> : null}
      {storageFailed && ["unknown", "retry"].includes(phase) ? <p className="text-secondary">{zh ? "浏览器无法记住此请求，请在关闭页面前完成核对。" : "This browser cannot remember the request. Check its result before closing the page."}</p> : null}
    </div> : null}
  </>;
}
