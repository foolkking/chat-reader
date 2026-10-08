"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { ApiRequestError, dismissCleanupScan, getCleanupDismissal } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { BackgroundTaskRead, CleanupScanRead } from "../../lib/types";

export function CleanupDismissAction({ scan, onDismissed, finish = false, disabled = false }: {
  scan: CleanupScanRead; onDismissed?: (origin: HTMLElement | null) => void; finish?: boolean; disabled?: boolean;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const { confirm } = useInteractionDialog();
  const [phase, setPhase] = useState<"idle" | "unknown" | "retry" | "done">("idle");
  const [busy, setBusy] = useState<"dismiss" | "check" | "confirm" | null>(null);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const generation = useRef(authenticationGeneration());
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const actionRoot = useRef<HTMLDivElement>(null);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (message || phase === "retry") {
      feedback.current?.focus({ preventScroll: true }); feedback.current?.scrollIntoView({ block: "nearest" });
    }
  }, [message, phase]);
  const acknowledge = async () => {
    await Promise.all([client.cancelQueries({ queryKey: ["content-cleanup-pending"] }), client.cancelQueries({ queryKey: ["active-tasks"] })]);
    if (!active()) return;
    // Capture the visible row before cache updates detach it. A disabled button
    // can already have lost focus, so activeElement alone is not an origin.
    onDismissed?.(actionRoot.current);
    client.setQueriesData<CleanupScanRead[]>({ queryKey: ["content-cleanup-pending"] }, old => old?.filter(item => item.id !== scan.id));
    client.setQueryData<BackgroundTaskRead[]>(["active-tasks"], old => old?.filter(item => item.job_id !== scan.background_job_id));
    setPhase("done"); setMessage("");
    void client.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
    void client.invalidateQueries({ queryKey: ["active-tasks"] });
  };
  const run = async (mode: "dismiss" | "check") => {
    if (running.current || !active()) return;
    running.current = true; setBusy(mode); setMessage(""); controller.current = new AbortController();
    try {
      if (mode === "dismiss") { await dismissCleanupScan(scan.id, controller.current.signal); if (active()) await acknowledge(); }
      else {
        const result = await getCleanupDismissal(scan.id, controller.current.signal);
        if (!active()) return;
        if (result.status === "DISMISSED") await acknowledge();
        else {
          client.setQueryData(["content-cleanup-scan", scan.id], result.scan);
          client.setQueriesData<CleanupScanRead[]>({ queryKey: ["content-cleanup-pending"] }, old => old?.map(item => item.id === scan.id ? result.scan : item));
          setPhase("retry");
          setMessage(["QUEUED", "SCANNING", "APPLYING"].includes(result.scan.status)
            ? (zh ? "服务器仍在处理此审查，请稍后再核对。" : "This review is still being processed. Check again shortly.")
            : (zh ? "此审查仍保留，可以再次结束。" : "This review is still available. You can finish it again."));
        }
      }
    } catch (error) {
      if (!active()) return;
      setPhase("unknown");
      setMessage(error instanceof ApiRequestError && error.status === 404
        ? (zh ? "暂时找不到此审查或结束记录。可关闭窗口后从任务中心查看。" : "This review or its dismissal record is unavailable. Close this window and check the task center.")
        : mode === "check" ? (zh ? "核对失败，请检查连接后重试。" : "The check failed. Check the connection and retry.")
          : (zh ? "尚未确认审查是否已结束，请先核对结果。" : "Dismissal is unconfirmed. Check the result first."));
    } finally { if (active()) { running.current = false; setBusy(null); } }
  };
  const start = async () => {
    if (running.current || !active()) return;
    running.current = true; setBusy("confirm");
    const accepted = !scan.delete_count || await confirm({ title: zh ? "结束本次审查？" : "Finish this review?",
      description: zh ? `会移除本次审查及其 ${scan.delete_count} 项选择，正文保持不变。若要稍后继续，请关闭窗口。` : `This removes the review and its ${scan.delete_count} selections. Content stays unchanged. Close the window if you want to continue later.`,
      confirmLabel: zh ? "结束审查" : "Finish review" });
    if (!active()) return;
    running.current = false; setBusy(null);
    if (accepted) void run("dismiss");
  };
  const canDismiss = ["READY", "FAILED", "STALE", "CANCELLED"].includes(scan.status);
  return <div ref={actionRoot} className="space-y-2" data-testid="cleanup-dismiss-action">
    {phase === "done" ? <p role="status" className="text-xs text-secondary">{zh ? "本次审查已结束。" : "This review has ended."}</p> : <button type="button" disabled={disabled || Boolean(busy) || phase === "unknown" || !canDismiss} onClick={() => void start()} className={finish ? "btn-primary min-h-11 px-4 text-sm" : "min-h-11 text-xs text-secondary underline disabled:opacity-50"}>
      {busy === "dismiss" ? (zh ? "正在结束…" : "Finishing…") : finish ? (zh ? "完成" : "Done") : (zh ? "忽略本次结果" : "Ignore this result")}
    </button>}
    {message || phase === "unknown" || phase === "retry" ? <div ref={feedback} tabIndex={-1} aria-label={zh ? "结束审查状态" : "Review dismissal status"} className="space-y-2 text-xs leading-5 outline-none">
      {message ? <p role={phase === "retry" ? "status" : "alert"} className={phase === "retry" ? "text-secondary" : "text-[var(--danger)]"}>{message}</p> : null}
      <button type="button" disabled={Boolean(busy)} onClick={() => void run("check")} className="btn-secondary min-h-11 px-3">{busy === "check" ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对结束结果" : "Check dismissal result")}</button>
    </div> : null}
  </div>;
}
