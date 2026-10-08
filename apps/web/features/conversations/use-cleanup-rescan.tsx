"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { ApiRequestError, getCleanupRescanRequest, rescanCleanup } from "../../lib/api";
import { getCurrentOfflineRuntimeUserId } from "../../lib/auth-client";
import { authenticationGeneration, offlineAuthenticationRequired } from "../../lib/offline-access";
import type { CleanupScanRead } from "../../lib/types";

// One owner per displayed review; selection and preview share this state even
// while the selection subtree stays mounted but hidden.
export function useCleanupRescan(scanId: string | null, onNext: (scan: CleanupScanRead) => void) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const { confirm } = useInteractionDialog();
  const [phase, setPhase] = useState<"loading" | "idle" | "unknown" | "retry" | "closed">("loading");
  const [busy, setBusy] = useState<"submit" | "check" | "confirm" | null>(null);
  const [message, setMessage] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const state = useRef<{ id: string | null; key: string | null; request: string | null; generation: number; controller: AbortController | null; busy: boolean } | null>(null);
  useEffect(() => {
    const owner = getCurrentOfflineRuntimeUserId();
    const current = { id: scanId, key: scanId && (owner || !offlineAuthenticationRequired()) ? `chat-reader:noise-rescan:${owner ?? "local"}:${scanId}` : null, request: null as string | null, generation: authenticationGeneration(), controller: null as AbortController | null, busy: false };
    state.current = current;
    setMessage(""); setBusy(null); setStorageFailed(!current.key && Boolean(scanId));
    try {
      const value = current.key ? sessionStorage.getItem(current.key) : null;
      if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) current.request = value;
    } catch { setStorageFailed(true); }
    setPhase(current.request ? "unknown" : "idle");
    return () => { current.controller?.abort(); if (state.current === current) state.current = null; };
  }, [scanId]);
  const active = (current: NonNullable<typeof state.current>) => state.current === current && current.generation === authenticationGeneration();
  const clear = (current: NonNullable<typeof state.current>) => {
    current.request = null;
    try { if (current.key) sessionStorage.removeItem(current.key); } catch { setStorageFailed(true); }
  };
  const run = async (mode: "submit" | "check") => {
    const current = state.current;
    if (!current?.id || !current.request || current.busy || !active(current)) return;
    current.busy = true; current.controller = new AbortController(); setBusy(mode); setMessage("");
    try {
      const result = mode === "submit"
        ? { found: true, scan: await rescanCleanup(current.id, current.request, current.controller.signal) }
        : await getCleanupRescanRequest(current.id, current.request, current.controller.signal);
      if (!active(current)) return;
      if (!result.found) { setPhase("retry"); return; }
      if (result.scan) await client.cancelQueries({ queryKey: ["content-cleanup-scan", result.scan.id] });
      if (!active(current)) return;
      clear(current);
      if (result.scan) {
        client.setQueryData(["content-cleanup-scan", result.scan.id], result.scan);
        onNext(result.scan);
      } else setPhase("closed");
      void client.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
      void client.invalidateQueries({ queryKey: ["active-tasks"] });
    } catch (error) {
      if (!active(current)) return;
      if (mode === "submit" && error instanceof ApiRequestError && [400, 404, 422].includes(error.status)) {
        clear(current); setPhase("idle");
        setMessage(error.status === 404 ? (zh ? "原审查已不可用，请从任务中心重新打开。" : "The original review is unavailable. Reopen it from the task center.")
          : error.message.includes("No active cleanup rules") ? (zh ? "请先在规则库启用至少一条噪声规则。" : "Enable at least one rule in the rule library first.")
            : (zh ? "原范围已没有可扫描的活动对话。" : "There are no active conversations left in the original scope."));
      } else {
        setPhase("unknown");
        setMessage(mode === "check" ? (zh ? "核对失败，原请求仍保留。请重试核对。" : "The check failed. Your original request is kept; retry the check.")
          : (zh ? "尚未确认是否已重新扫描，请先核对结果。" : "Rescan admission is unconfirmed. Check the result first."));
      }
    } finally { if (active(current)) { current.busy = false; setBusy(null); } }
  };
  const start = async (selectedCount: number) => {
    const current = state.current;
    if (!current?.id || current.busy || !active(current) || !["idle", "closed"].includes(phase)) return;
    current.busy = true; setBusy("confirm");
    const accepted = !selectedCount || await confirm({
      title: zh ? "开始新的审查？" : "Start a fresh review?",
      description: zh ? `原审查的 ${selectedCount} 项选择会保留，可随时返回。新审查按最新正文和规则扫描，默认全部保留。` : `Your ${selectedCount} selections stay in the previous review. The new review uses current content and rules, with everything kept by default.`,
      confirmLabel: zh ? "重新扫描" : "Rescan",
    });
    if (!active(current)) return;
    current.busy = false; setBusy(null);
    if (!accepted) return;
    current.request = crypto.randomUUID();
    try { if (current.key) sessionStorage.setItem(current.key, current.request); } catch { setStorageFailed(true); }
    setPhase("unknown");
    void run("submit");
  };
  return { phase, busy, message, storageFailed, start, check: () => void run("check"), retry: () => void run("submit"), blocking: Boolean(busy) || ["loading", "unknown", "retry"].includes(phase) };
}

type RescanProps = { rescan: ReturnType<typeof useCleanupRescan>; disabled?: boolean };

export function CleanupRescanButton({ rescan, selectedCount, disabled }: RescanProps & { selectedCount: number }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  return <button type="button" disabled={disabled || rescan.blocking} onClick={() => void rescan.start(selectedCount)} className="btn-secondary min-h-11 px-3 text-xs">
    {rescan.busy === "submit" ? (zh ? "正在提交…" : "Submitting…") : (zh ? "重新扫描原对话" : "Rescan conversations")}
  </button>;
}

export function CleanupRescanFeedback({ rescan, disabled, visible = true }: RescanProps & {
  visible?: boolean;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visible && !rescan.busy && (rescan.message || ["unknown", "retry", "closed"].includes(rescan.phase))) {
      feedback.current?.focus({ preventScroll: true });
      feedback.current?.scrollIntoView({ block: "nearest" });
    }
  }, [visible, rescan.busy, rescan.message, rescan.phase]);
  return rescan.message || ["unknown", "retry", "closed"].includes(rescan.phase) ? <div ref={feedback} tabIndex={-1} aria-label={zh ? "重新扫描状态" : "Rescan status"} className="space-y-2 text-xs leading-5 outline-none">
      {rescan.message ? <p role="alert" className="text-[var(--danger)]">{rescan.message}</p> : null}
      {rescan.phase === "unknown" && rescan.busy !== "submit" ? <>
        {!rescan.message ? <p className="text-secondary">{zh ? "保留了上次请求，核对不会再次扫描。" : "Your previous request is kept. Checking does not start another scan."}</p> : null}
        <button type="button" disabled={Boolean(rescan.busy) || disabled} onClick={rescan.check} className="btn-secondary min-h-11 px-3">{rescan.busy === "check" ? (zh ? "正在核对…" : "Checking…") : (zh ? "检查重新扫描结果" : "Check rescan result")}</button>
      </> : null}
      {rescan.phase === "retry" ? <><p role="status" className="text-secondary">{zh ? "暂未找到此次任务。继续提交原请求不会重复创建。" : "No task found yet. Resubmit the same request without creating a duplicate."}</p><button type="button" disabled={Boolean(rescan.busy) || disabled} onClick={rescan.retry} className="btn-secondary min-h-11 px-3">{zh ? "继续提交扫描" : "Resubmit scan"}</button></> : null}
      {rescan.phase === "closed" ? <p role="status" className="text-secondary">{zh ? "此次请求已有任务记录，审查已结束或关闭。需要时可重新发起扫描。" : "This request has a task record, but its review has ended or closed. You can start a new scan if needed."}</p> : null}
      {rescan.storageFailed && ["unknown", "retry"].includes(rescan.phase) ? <p className="text-secondary">{zh ? "浏览器无法记住此请求，请在关闭页面前完成核对。" : "This browser cannot remember the request. Check it before closing the page."}</p> : null}
    </div> : null;
}

export function CleanupRescanControls(props: RescanProps & { selectedCount: number }) {
  return <div className="min-w-0 space-y-2"><CleanupRescanButton {...props} /><CleanupRescanFeedback {...props} /></div>;
}
