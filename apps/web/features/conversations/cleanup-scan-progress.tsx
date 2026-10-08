"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { cancelTask, getTask } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { BackgroundTaskRead, CleanupScanRead } from "../../lib/types";

export function cleanupScanLabel(scan: CleanupScanRead, zh: boolean): string {
  if (scan.status === "APPLYING") return zh ? "正在应用清理…" : "Applying cleanup…";
  if (scan.status === "CANCELLED") return zh ? "扫描已取消" : "Scan cancelled";
  if (scan.background_job_status === "cancelling") return zh ? "正在停止扫描…" : "Stopping scan…";
  if (scan.status === "QUEUED" || scan.background_job_status === "queued") return zh ? "等待扫描" : "Waiting to scan";
  return zh ? "正在扫描消息…" : "Scanning messages…";
}

export function CleanupScanCancelAction({ scan }: { scan: CleanupScanRead }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(authenticationGeneration());
  const abort = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); }; }, []);
  useLayoutEffect(() => {
    if (lastFocus.current && !lastFocus.current.isConnected && document.activeElement === document.body) {
      const row = root.current?.closest<HTMLElement>("[data-cleanup-scan-id]");
      (row?.querySelector<HTMLElement>("button:not(:disabled)") ?? root.current)?.focus({ preventScroll: true });
    }
  });
  const live = ["QUEUED", "SCANNING"].includes(scan.status);
  const stopping = scan.background_job_status === "cancelling";
  const run = async (check: boolean) => {
    if (running.current || !scan.background_job_id || !active()) return;
    running.current = true; setBusy(true); setMessage("");
    const controller = new AbortController(); abort.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const task = await (check ? getTask : cancelTask)(scan.background_job_id, controller.signal);
      if (!active()) return;
      await Promise.all([client.cancelQueries({ queryKey: ["content-cleanup-pending"] }), client.cancelQueries({ queryKey: ["content-cleanup-scan", scan.id] }), client.cancelQueries({ queryKey: ["active-tasks"] })]);
      if (!active()) return;
      const patch = (old: CleanupScanRead): CleanupScanRead => ({ ...old, background_job_status: task.status,
        status: task.status === "cancelled" ? "CANCELLED" : task.status === "failed" ? "FAILED" : old.status,
        error_message: task.status === "failed" ? task.error_message : old.error_message });
      client.setQueryData<CleanupScanRead>(["content-cleanup-scan", scan.id], old => old ? patch(old) : undefined);
      client.setQueriesData<CleanupScanRead[]>({ queryKey: ["content-cleanup-pending"] }, old => old?.map(item => item.id === scan.id ? patch(item) : item));
      client.setQueryData<BackgroundTaskRead[]>(["active-tasks"], old => old?.map(item => item.job_id === task.job_id ? task : item));
      setUncertain(false);
      if (!["cancelled", "cancelling", "failed"].includes(task.status)) setMessage(task.status === "committed"
        ? (zh ? "扫描已完成，正在读取结果。" : "The scan finished. Loading its result.")
        : (zh ? "扫描尚未停止，可以再次取消。" : "The scan has not stopped. You can cancel it again."));
      void client.invalidateQueries({ queryKey: ["content-cleanup-scan", scan.id] });
      void client.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
      void client.invalidateQueries({ queryKey: ["active-tasks"] });
    } catch {
      if (active()) { setUncertain(true); setMessage(check ? (zh ? "核对失败，请重试。" : "The check failed. Please retry.") : (zh ? "尚未确认是否已停止，请核对结果。" : "Cancellation is unconfirmed. Check the result.")); }
    } finally { window.clearTimeout(deadline); if (active()) { running.current = false; setBusy(false); } }
  };
  if (!live || !scan.background_job_id) return null;
  return <div ref={root} tabIndex={-1} onFocusCapture={event => { lastFocus.current = event.target; }} className="space-y-2 text-xs outline-none" data-testid="cleanup-scan-cancel">
    {stopping ? <p role="status" className="text-secondary">{zh ? "当前批次结束后停止，正文保持不变。" : "Stopping after the current batch. Content stays unchanged."}</p>
      : <button type="button" disabled={busy || uncertain} onClick={() => void run(false)} className="btn-secondary min-h-11 px-3">{busy && !uncertain ? (zh ? "正在请求取消…" : "Requesting cancellation…") : (zh ? "取消扫描" : "Cancel scan")}</button>}
    {message || uncertain ? <div ref={feedback} tabIndex={-1} className="space-y-2 outline-none">
      {message ? <p role={uncertain ? "alert" : "status"} className={uncertain ? "text-[var(--danger)]" : "text-secondary"}>{message}</p> : null}
      {uncertain ? <button type="button" disabled={busy} onClick={() => void run(true)} className="btn-secondary min-h-11 px-3">{busy ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对扫描状态" : "Check scan status")}</button> : null}
    </div> : null}
  </div>;
}

export function CleanupScanProgress({ scan }: { scan: CleanupScanRead }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  return <div className="space-y-3 py-2" data-testid="cleanup-scan-progress">
    <p role="status" className="text-sm font-medium">{cleanupScanLabel(scan, zh)}</p>
    <p className="text-xs tabular-nums text-secondary">{zh ? `已扫描 ${scan.processed_messages} / ${scan.total_messages} 条消息` : `${scan.processed_messages} / ${scan.total_messages} messages scanned`}</p>
    <div role="progressbar" aria-label={zh ? "噪声扫描" : "Noise scan"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(scan.progress, 99)} className="h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-accent" style={{ width: `${Math.min(scan.progress, 99)}%` }} /></div>
    <CleanupScanCancelAction scan={scan} />
  </div>;
}
