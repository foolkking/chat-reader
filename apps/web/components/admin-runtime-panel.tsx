"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { adminApi, type AdminRuntimeStatus } from "../lib/admin-client";
import { usePreferences } from "./preferences-provider";

export function AdminRuntimePanel() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update(); document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const query = useQuery({ queryKey: ["admin", "runtime-status"], queryFn: ({ signal }) => adminApi.runtimeStatus(AbortSignal.any([signal, AbortSignal.timeout(15_000)])), enabled: visible,
    refetchInterval: visible ? 30_000 : false, refetchIntervalInBackground: false, refetchOnWindowFocus: false, staleTime: 0, retry: false });
  const data = query.data;
  const unavailable = zh ? "不可用" : "Unavailable";
  const date = (value: string | null) => value ? new Date(value).toLocaleString(resolvedLocale) : "—";
  const states: Record<string, string> = { QUEUED: zh ? "排队中" : "Queued", RUNNING: zh ? "进行中" : "Running", COMPLETED: zh ? "已完成" : "Completed", FAILED: zh ? "失败" : "Failed", CANCELLED: zh ? "已取消" : "Cancelled" };
  const workerStates = { alive_idle: zh ? "在线 · 空闲" : "Online · Idle", alive_busy: zh ? "在线 · 工作中" : "Online · Busy", stale: zh ? "心跳已过期" : "Heartbeat is stale", unavailable };
  const archive = (metric: AdminRuntimeStatus["backup"]) => !metric.available ? unavailable : !metric.record ? (zh ? "暂无记录" : "No records yet") : <><span>{states[metric.record.status] ?? unavailable}</span><span className="mt-1 block text-xs text-secondary">{zh ? "发起：" : "Started: "}{date(metric.record.created_at)}{metric.record.completed_at ? <><br />{zh ? "完成：" : "Finished: "}{date(metric.record.completed_at)}</> : null}</span></>;
  return <section aria-label={zh ? "运行状态" : "Runtime status"} className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-xl text-sm leading-6 text-secondary">{zh ? "页面可见时每 30 秒刷新。只读汇总用于定位任务和存储问题。" : "Refreshes every 30 seconds while visible. Read-only summaries help investigate task and storage issues."}</p><button type="button" className="btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{query.isFetching ? (zh ? "读取中…" : "Loading…") : (zh ? "刷新状态" : "Refresh status")}</button></div>
    {query.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取运行状态…" : "Reading runtime status…"}</p> : null}
    {query.isError ? <p role="alert" className="text-sm text-[var(--danger)]">{data ? (zh ? "刷新失败，以下为上次结果，可能已过时。请重试。" : "Refresh failed. The previous result below may be outdated. Retry when connected.") : (zh ? "无法读取运行状态，请检查连接并重试。" : "Runtime status is unavailable. Check your connection and retry.")}</p> : null}
    {data ? <>
      <div className="flex items-start gap-3 rounded-lg bg-subtle p-4"><Activity className="mt-0.5 h-5 w-5 shrink-0 text-secondary" aria-hidden="true" /><div><h3 className="text-sm font-semibold text-primary">{zh ? "后台 Worker" : "Background worker"} · {data.worker.available ? workerStates[data.worker.status] : unavailable}</h3><p className="mt-1 text-xs leading-5 text-secondary">{zh ? "采集时间：" : "Snapshot: "}{date(data.generated_at)}{!data.complete ? ` · ${zh ? "统计不完整" : "Incomplete metrics"}` : ""}</p>{data.worker.available ? <p className="mt-1 text-xs leading-5 text-secondary">{zh ? "最近心跳：" : "Last heartbeat: "}{date(data.worker.heartbeat_at)}{data.worker.heartbeat_age_seconds !== null ? ` (${Math.floor(data.worker.heartbeat_age_seconds)}s)` : ""}</p> : null}</div></div>
      <div><h3 className="mb-2 text-sm font-semibold">{zh ? "任务队列" : "Task queues"}</h3>{data.queue.available ? <dl className="divide-y divide-[var(--border)] border-y border-ui">{(["jobs", "imports"] as const).map((kind) => <StatusRow key={kind} label={kind === "jobs" ? (zh ? "后台任务" : "Background jobs") : (zh ? "导入" : "Imports")}><span className="flex flex-wrap justify-end gap-x-4 gap-y-1"><span>{zh ? "排队" : "Queued"} {data.queue.available ? data.queue[kind].queued : "—"}</span><span>{zh ? "处理中" : "Processing"} {data.queue.available ? data.queue[kind].processing + data.queue[kind].cancelling : "—"}</span><span>{zh ? "失败" : "Failed"} {data.queue.available ? data.queue[kind].failed : "—"}</span></span></StatusRow>)}</dl> : <p className="text-sm text-secondary">{unavailable}</p>}<p className="mt-2 text-xs leading-5 text-secondary">{zh ? "失败数包含保留的历史任务；处理中包含取消中的任务。" : "Failures include retained historical tasks. Processing includes tasks being cancelled."}</p></div>
      <div><h3 className="mb-2 text-sm font-semibold">{zh ? "存储" : "Storage"}</h3><dl className="divide-y divide-[var(--border)] border-y border-ui">{(["imports", "exports", "offline", "assets"] as const).map((key) => { const value = data.storage[key]; return <StatusRow key={key} label={({ imports: zh ? "导入资料" : "Imports", exports: zh ? "导出与备份" : "Exports & backups", offline: zh ? "离线包" : "Offline packages", assets: zh ? "附件" : "Attachments" })[key]}>{!value.available ? unavailable : <>{formatStorageBytes(value.bytes)} · {value.file_count} {value.kind === "object_records" ? (zh ? "对象记录" : "object records") : (zh ? "文件" : "files")}{!value.complete ? <span className="block text-xs text-secondary">{zh ? "扫描不完整 · 仅已统计部分" : "Incomplete scan · counted portion only"}</span> : null}</>}</StatusRow>; })}</dl><p className="mt-2 text-xs leading-5 text-secondary">{data.storage.assets.kind === "object_records" ? (zh ? "附件为数据库对象记录的逻辑大小，并非远端存储实测用量。" : "Attachment size is the logical total of database object records, not measured remote storage usage.") : (zh ? "有界扫描不读取文件内容；未能完成的统计单独标注。" : "Bounded scans do not read file contents. Partial totals are marked.")}</p></div>
      <div><h3 className="mb-2 text-sm font-semibold">{zh ? "备份与邮件" : "Backups & email"}</h3><dl className="divide-y divide-[var(--border)] border-y border-ui"><StatusRow label={zh ? "最近系统备份" : "Latest system backup"}>{archive(data.backup)}</StatusRow><StatusRow label={zh ? "最近系统恢复" : "Latest system restore"}>{archive(data.restore)}</StatusRow><StatusRow label={zh ? "邮件配置" : "Email configuration"}>{data.mail.configured ? (zh ? "已配置（未测试投递）" : "Configured (delivery not tested)") : (zh ? "未配置" : "Not configured")}</StatusRow></dl></div>
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
