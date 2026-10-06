"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { exportArtifactApi } from "../../lib/api";
import { ExportUsage, type ExportUsageState } from "../../lib/export-usage";
import { authenticationGeneration } from "../../lib/offline-access";
import type { BackgroundTaskRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";

export function ExportArtifactDelivery(props: { artifactId: string; scope: string; label?: string; onRegenerated?: (task: BackgroundTaskRead) => void }) {
  // A new artifact needs its own request key, state and session, even when React
  // keeps the containing task row or dialog mounted.
  return <Delivery key={`${props.scope}:${props.artifactId}`} {...props} />;
}

function Delivery({ artifactId, scope, label, onRegenerated }: { artifactId: string; scope: string; label?: string; onRegenerated?: (task: BackgroundTaskRead) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const usage = useRef<ExportUsage | null>(null);
  const [state, setState] = useState<ExportUsageState>({ status: null, error: false });
  const [busy, setBusy] = useState<"download" | "regenerate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false), requestKey = useRef<string | null>(null), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const session = new ExportUsage(artifactId, scope);
    usage.current = session;
    const stop = session.observe(setState);
    const resume = () => void session.refresh();
    window.addEventListener("online", resume);
    return () => { mounted.current = false; stop(); window.removeEventListener("online", resume); };
  }, [artifactId, scope]);
  const available = state.status?.status === "available";
  const expired = !!state.status && !available;
  const retentionSeconds = state.status?.retention_seconds;
  const availableNotice = retentionSeconds != null && retentionSeconds > 0
    ? (zh ? `临时下载，生成后保留 ${Math.ceil(retentionSeconds / 60)} 分钟。` : `Temporary download, retained for ${Math.ceil(retentionSeconds / 60)} minutes after generation.`)
    : (zh ? "临时下载，到期后可重新生成。" : "Temporary download. Generate it again after expiry.");
  async function act(action: "download" | "regenerate") {
    if (lock.current) return;
    lock.current = true; setBusy(action); setError(null);
    const generation = authenticationGeneration();
    try {
      if (action === "download") await usage.current?.download();
      else {
        requestKey.current ??= crypto.randomUUID();
        const task = await exportArtifactApi.regenerate(artifactId, requestKey.current);
        if (generation !== authenticationGeneration()) return;
        client.setQueryData(["task", task.job_id], task);
        // The result owner can outlive this delivery control (e.g. a background
        // continuation refresh temporarily hides it). Bind the new job as soon
        // as the server accepts it, even if only this child was unmounted.
        onRegenerated?.(task);
        await Promise.all(["active-tasks", "personal-archive-tasks", "system-archive-tasks"].map(key => client.invalidateQueries({ queryKey: [key] })));
        if (generation !== authenticationGeneration()) return;
        if (mounted.current && !onRegenerated) window.dispatchEvent(new Event("chat-reader:open-task-center"));
      }
    } catch {
      if (mounted.current && generation === authenticationGeneration()) {
        setError(action === "download" ? (zh ? "无法开始下载，请检查连接并重试。" : "Could not start the download. Check your connection and retry.") : (zh ? "重新生成失败，请重试；来源已删除时请返回重新选择。" : "Could not regenerate. Retry, or choose another source if it was deleted."));
        void usage.current?.refresh();
      }
    } finally { lock.current = false; if (mounted.current) setBusy(null); }
  }
  return <div className="grid min-w-0 gap-2" data-testid="export-artifact-delivery">
    {state.error ? <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => void usage.current?.refresh()}>{zh ? "下载状态暂不可用，重试" : "Download status unavailable; retry"}</button> : <button type="button" data-testid="task-result-download" disabled={!!busy || !state.status} onClick={() => void act(expired ? "regenerate" : "download")} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-3 text-sm disabled:opacity-60">
      {expired ? <RefreshCw className="h-4 w-4 shrink-0" aria-hidden /> : <Download className="h-4 w-4 shrink-0" aria-hidden />}
      {busy === "download" ? (zh ? "正在开始下载…" : "Starting download…") : busy === "regenerate" ? (zh ? "正在创建任务…" : "Creating task…") : !state.status ? (zh ? "正在读取下载状态…" : "Checking download…") : expired ? (zh ? "重新生成" : "Generate again") : label ?? (zh ? "下载结果" : "Download result")}
    </button>}
    <p className="text-xs leading-5 text-secondary" role="status">{expired ? (zh ? "临时文件已失效，将按原选项从当前资料重新生成。" : "This temporary file is no longer available. Regeneration uses the original options and current data.") : available ? availableNotice : null}</p>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
  </div>;
}
