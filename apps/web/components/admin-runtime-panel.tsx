"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { adminApi, AdminRequestError, type AdminRuntimeStatus } from "../lib/admin-client";
import { usePreferences } from "./preferences-provider";
import { authenticationGeneration, AUTH_GENERATION_CHANGED_EVENT } from "../lib/offline-access";
import { withRequestDeadline } from "../lib/request-deadline";
import { AdminExecutionRecovery } from "./admin-execution-recovery";

function subscribeAuthentication(listener: () => void) {
  window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, listener);
}
function accessDenied(error: unknown) {
  return error instanceof AdminRequestError && [401, 403, 404].includes(error.status);
}

export function AdminRuntimePanel() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const generation = useSyncExternalStore(subscribeAuthentication, authenticationGeneration, () => 0);
  const [deniedGeneration, setDeniedGeneration] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [recoveryGeneration, setRecoveryGeneration] = useState<number | null>(null);
  const recoveryTrigger = useRef<HTMLButtonElement | null>(null);
  const openRecovery = (trigger: HTMLButtonElement) => { recoveryTrigger.current = trigger; setRecoveryGeneration(generation); };
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update(); document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const query = useQuery({ queryKey: ["admin", "runtime-status", generation], queryFn: async ({ signal }) => {
    try {
      const result = await withRequestDeadline(next => adminApi.runtimeStatus(next), signal, 15_000);
      if (generation !== authenticationGeneration()) throw new Error("Runtime authentication retired");
      if (!signal.aborted) setDeniedGeneration(null);
      return result;
    } catch (error) {
      // A later transport failure must not resurrect a cache that was denied.
      // Only a successful current read re-establishes access.
      if (!signal.aborted && generation === authenticationGeneration() && accessDenied(error)) setDeniedGeneration(generation);
      throw error;
    }
  }, enabled: visible,
    refetchInterval: visible ? 30_000 : false, refetchIntervalInBackground: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0, retry: false });
  const denied = deniedGeneration === generation || accessDenied(query.error);
  const data = denied ? undefined : query.data;
  const unavailable = zh ? "不可用" : "Unavailable";
  const date = (value: string | null) => value ? new Date(value).toLocaleString(resolvedLocale) : "—";
  const states: Record<string, string> = { QUEUED: zh ? "排队中" : "Queued", RUNNING: zh ? "进行中" : "Running", COMPLETED: zh ? "已完成" : "Completed", FAILED: zh ? "失败" : "Failed", CANCELLED: zh ? "已取消" : "Cancelled" };
  const workerStates = { alive_idle: zh ? "在线 · 空闲" : "Online · Idle", alive_busy: zh ? "在线 · 工作中" : "Online · Busy", stale: zh ? "心跳已过期" : "Heartbeat is stale", unavailable };
  const archive = (metric: AdminRuntimeStatus["backup"]) => !metric.available ? unavailable : !metric.record ? (zh ? "暂无记录" : "No records yet") : <><span>{states[metric.record.status] ?? unavailable}</span><span className="mt-1 block text-xs text-secondary">{zh ? "发起：" : "Started: "}{date(metric.record.created_at)}{metric.record.completed_at ? <><br />{zh ? "完成：" : "Finished: "}{date(metric.record.completed_at)}</> : null}</span></>;
  return <section aria-label={zh ? "运行状态" : "Runtime status"} className="space-y-6">
    <div className="flex justify-end"><button type="button" className="btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{query.isFetching ? (zh ? "读取中…" : "Loading…") : (zh ? "刷新状态" : "Refresh status")}</button></div>
    {query.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取运行状态…" : "Reading runtime status…"}</p> : null}
    {query.isError ? <p role="alert" className="text-sm text-[var(--danger)]">{denied
      ? (zh ? "当前账户无法查看运行状态，请恢复访问后刷新。" : "Runtime status is unavailable for your account. Restore access, then refresh.")
      : data ? (zh ? "刷新失败，以下为上次结果，可能已过时。请重试。" : "Refresh failed. The previous result below may be outdated. Retry when connected.") : (zh ? "无法读取运行状态，请检查连接并重试。" : "Runtime status is unavailable. Check your connection and retry.")}</p> : null}
    {data ? <>
      <div className="flex items-start gap-3 rounded-lg bg-subtle p-4"><Activity className="mt-0.5 h-5 w-5 shrink-0 text-secondary" aria-hidden="true" /><div><h3 className="text-sm font-semibold text-primary">{zh ? "后台 Worker" : "Background worker"} · {data.worker.available ? workerStates[data.worker.status] : unavailable}</h3><p className="mt-1 text-xs leading-5 text-secondary">{zh ? "采集时间：" : "Snapshot: "}{date(data.generated_at)}{!data.complete ? ` · ${zh ? "统计不完整" : "Incomplete metrics"}` : ""}</p>{data.worker.available ? <p className="mt-1 text-xs leading-5 text-secondary">{zh ? "最近心跳：" : "Last heartbeat: "}{date(data.worker.heartbeat_at)}{data.worker.heartbeat_age_seconds !== null ? ` (${Math.floor(data.worker.heartbeat_age_seconds)}s)` : ""}</p> : null}</div></div>
      <div><h3 className="mb-2 text-sm font-semibold">{zh ? "任务队列" : "Task queues"}</h3>{data.queue.available ? <dl className="divide-y divide-[var(--border)] border-y border-ui">{(["jobs", "imports"] as const).map((kind) => {
        const counts = data.queue.available ? data.queue[kind] : null;
        const extra = { paused: zh ? "已暂停" : "Paused", previewed: zh ? "待确认" : "Awaiting review", analyzing: zh ? "分析会话" : "Analysis sessions", other: zh ? "其他状态" : "Other states" };
        return <StatusRow key={kind} label={kind === "jobs" ? (zh ? "后台任务" : "Background jobs") : (zh ? "导入" : "Imports")}>
          <span className="flex flex-wrap justify-end gap-x-4 gap-y-1">
            <span>{zh ? "排队" : "Queued"} {counts?.queued ?? "—"}</span>
            <span>{zh ? "处理中" : "Processing"} {counts ? counts.processing + counts.cancelling : "—"}</span>
            <span>{zh ? "失败记录" : "Failure records"} {counts?.failed ?? "—"}</span>
            {(Object.keys(extra) as (keyof typeof extra)[]).map(state => (counts?.[state] ?? 0) > 0 ? <span key={state}>{extra[state]} {counts?.[state]}</span> : null)}
          </span>
        </StatusRow>;
      })}</dl> : <p className="text-sm text-secondary">{unavailable}</p>}</div>
      {data.worker.available && data.worker.execution && recoveryGeneration !== generation ? <p className="text-sm text-secondary" role="status">
        {data.worker.execution.state === "running"
          ? (zh ? `任务最近推进：${data.worker.execution.progress_age_seconds} 秒前。` : `Last task progress: ${data.worker.execution.progress_age_seconds}s ago.`)
          : data.worker.execution.state === "reconciling"
            ? (zh ? "正在核对上一项执行结果，核对后继续排队任务。" : "Checking the previous execution before starting the next task.")
            : data.worker.execution.state === "stalled"
              ? (zh ? "任务暂未推进，等待后台核对和停止；尚未确认退出。" : "No recent task progress. Waiting for the worker to check and stop it; exit is not confirmed.")
            : (zh ? "正在安全停止执行；确认退出并核对结果后继续队列。" : "Safely stopping execution; the queue continues after exit and outcome checks.")}
      </p> : null}
      {data.worker.available && (data.worker.execution || (data.worker.status === "stale" && (data.worker.processing_task_count ?? 0) > 0))
        ? <button type="button" aria-expanded={recoveryGeneration === generation} className="btn-secondary min-h-11 px-3 text-sm" onClick={event => openRecovery(event.currentTarget)}>{zh ? "处理当前执行" : "Review current execution"}</button> : null}
      {recoveryGeneration === generation ? <AdminExecutionRecovery key={generation} generation={generation} zh={zh} locale={resolvedLocale} onClose={() => {
        setRecoveryGeneration(null);
        if (recoveryTrigger.current?.isConnected) recoveryTrigger.current.focus({ preventScroll: true });
      }} /> : null}
      <div><h3 className="mb-2 text-sm font-semibold">{zh ? "存储" : "Storage"}</h3><dl className="divide-y divide-[var(--border)] border-y border-ui">{(["imports", "exports", "offline", "assets"] as const).map((key) => { const value = data.storage[key]; return <StatusRow key={key} label={({ imports: zh ? "导入资料" : "Imports", exports: zh ? "导出与归档" : "Exports & archives", offline: zh ? "离线包" : "Offline packages", assets: zh ? "附件" : "Attachments" })[key]}>{!value.available ? unavailable : <>{formatStorageBytes(value.bytes)} · {value.file_count} {value.kind === "object_records" ? (zh ? "对象（逻辑用量）" : "objects (logical size)") : (zh ? "文件" : "files")}{!value.complete ? <span className="block text-xs text-secondary">{zh ? "扫描不完整 · 仅已统计部分" : "Incomplete scan · counted portion only"}</span> : null}</>}</StatusRow>; })}</dl></div>
      {data.export_cleanup && (!data.export_cleanup.available || data.export_cleanup.pending_count > 0 || data.export_cleanup.failed_count > 0) ? <div><h3 className="mb-2 text-sm font-semibold">{zh ? "临时文件回收" : "Temporary file cleanup"}</h3><dl className="divide-y divide-[var(--border)] border-y border-ui"><StatusRow label={zh ? "等待释放" : "Pending reclamation"}>{data.export_cleanup.available ? `${data.export_cleanup.pending_count} · ${formatStorageBytes(data.export_cleanup.pending_bytes)}` : unavailable}</StatusRow>{data.export_cleanup.available && data.export_cleanup.failed_count > 0 ? <StatusRow label={zh ? "回收失败，等待重试" : "Failed, awaiting retry"}>{data.export_cleanup.failed_count}</StatusRow> : null}</dl></div> : null}
      {data.source_cleanup && (!data.source_cleanup.available || data.source_cleanup.pending_count > 0) ? <div className="text-sm">
        <h3 className="font-semibold">{zh ? "已放弃的导入来源" : "Discarded import sources"}</h3>
        <p className="mt-1 text-secondary">{!data.source_cleanup.available ? unavailable
          : zh ? `${data.source_cleanup.pending_count} 个会话待清理，可由原任务重试；其中 ${data.source_cleanup.blocked_count} 个需检查存储位置。`
            : `${data.source_cleanup.pending_count} sessions need cleanup; retry from their original tasks. ${data.source_cleanup.blocked_count} need a storage-location check.`}</p>
      </div> : null}
      {data.upload_cleanup && (!data.upload_cleanup.available || data.upload_cleanup.pending_count > 0) ? <p className="text-sm text-secondary">
        {!data.upload_cleanup.available ? unavailable : zh
          ? `${data.upload_cleanup.pending_count} 个已完成或已放弃上传待清理，${data.upload_cleanup.failed_count} 个等待重试。未完成来源受保护。`
          : `${data.upload_cleanup.pending_count} completed or discarded uploads await cleanup; ${data.upload_cleanup.failed_count} will be retried. Unfinished sources remain protected.`}
      </p> : null}
      <details className="border-t border-ui">
        <summary className="min-h-11 cursor-pointer content-center py-3 text-sm text-secondary">{zh ? "更多运行信息" : "More runtime information"}
          {[data.backup, data.restore].some(metric => !metric.available || (metric.record && ["FAILED", "UNKNOWN"].includes(metric.record.status))) ? <span className="ml-2 text-[var(--danger)]">{zh ? "归档记录需检查" : "Check archive records"}</span> : null}
        </summary>
        <p className="mb-3 text-xs leading-5 text-secondary">{zh
          ? "以下仅为应用 .cr 归档任务记录，不包含服务器备份；完成不代表文件仍可下载或已验证恢复。"
          : "These are application .cr archive task records; this does not include server backups. Completion does not verify file availability or recovery."}</p>
        <button type="button" className="btn-secondary mb-3 min-h-11 px-3 text-sm" onClick={event => openRecovery(event.currentTarget)}>{zh ? "查看执行与停止记录" : "View execution and stop records"}</button>
        <dl className="divide-y divide-[var(--border)] border-y border-ui">
          <StatusRow label={zh ? "最近应用归档" : "Latest application archive"}>{archive(data.backup)}</StatusRow>
          <StatusRow label={zh ? "最近应用恢复" : "Latest application restore"}>{archive(data.restore)}</StatusRow>
          <StatusRow label={zh ? "邮件配置" : "Email configuration"}>{data.mail.configured ? (zh ? "已配置（未测试投递）" : "Configured (delivery not tested)") : (zh ? "未配置" : "Not configured")}</StatusRow>
        </dl>
      </details>
    </> : null}
  </section>;
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-3 text-sm"><dt className="text-secondary">{label}</dt><dd className="min-w-0 text-right text-primary">{children}</dd></div>;
}
function formatStorageBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}
