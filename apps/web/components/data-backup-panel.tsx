"use client";

import { useQuery } from "@tanstack/react-query";
import { Archive, Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { getTask, queueSystemArchiveExport, restoreSystemArchive } from "../lib/api";
import { usePreferences } from "./preferences-provider";

export function DataBackupPanel() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const inputRef = useRef<HTMLInputElement>(null);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busyRestore, setBusyRestore] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const taskQuery = useQuery({
    queryKey: ["task", jobId],
    queryFn: () => getTask(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "committed" || status === "failed" || status === "cancelled" ? false : 1500;
    },
  });
  const downloadUrl = taskQuery.data?.status === "committed" ? taskQuery.data.result.download_url : null;

  return (
    <div className="space-y-3 border-t border-ui pt-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary"><Archive className="h-4 w-4" />{zh ? "数据与备份" : "Data and backup"}</div>
      <p className="text-xs leading-5 text-secondary">
        {zh ? "系统归档包含项目、全部消息版本、附件、批注和笔记。附件会自动包含。" : "The system archive includes projects, all message versions, attachments, annotations, and notes. Attachments are always included."}
      </p>
      <label className="flex min-h-9 items-center justify-between gap-3 text-xs text-primary">
        <span>{zh ? "包含已归档内容" : "Include archived content"}</span>
        <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
      </label>
      {!includeArchived ? <p className="text-xs leading-5 text-[var(--danger)]">{zh ? "这不是完整系统备份，已归档项目和对话不会包含。" : "This is not a complete system backup. Archived projects and conversations are excluded."}</p> : null}
      {downloadUrl ? (
        <a href={String(downloadUrl)} className="btn-secondary flex min-h-9 items-center justify-center gap-2 px-3 text-xs font-medium"><Download className="h-4 w-4" />{zh ? "下载系统归档 (.cr)" : "Download system archive (.cr)"}</a>
      ) : (
        <button type="button" disabled={Boolean(jobId) && !["failed", "cancelled"].includes(taskQuery.data?.status ?? "queued")} onClick={() => void (async () => {
          setMessage(null);
          try {
            const task = await queueSystemArchiveExport(includeArchived);
            setJobId(task.job_id);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : (zh ? "无法创建归档" : "Unable to create archive"));
          }
        })()} className="btn-secondary flex min-h-9 w-full items-center justify-center gap-2 px-3 text-xs font-medium disabled:cursor-wait disabled:opacity-60"><Download className="h-4 w-4" />{jobId ? (zh ? `正在生成 ${taskQuery.data?.progress ?? 0}%` : `Generating ${taskQuery.data?.progress ?? 0}%`) : (zh ? "导出系统归档 (.cr)" : "Export system archive (.cr)")}</button>
      )}
      <input ref={inputRef} type="file" accept=".cr,application/vnd.chat-reader.archive+zip" className="hidden" onChange={(event) => void (async () => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setBusyRestore(true);
        setMessage(null);
        try {
          await restoreSystemArchive(file);
          setMessage(zh ? "恢复完成，请刷新页面。" : "Restore complete. Refresh the page.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : (zh ? "恢复失败" : "Restore failed"));
        } finally {
          setBusyRestore(false);
        }
      })()} />
      <button type="button" disabled={busyRestore} onClick={() => inputRef.current?.click()} className="btn-secondary flex min-h-9 w-full items-center justify-center gap-2 px-3 text-xs font-medium disabled:opacity-60"><Upload className="h-4 w-4" />{busyRestore ? (zh ? "正在恢复" : "Restoring") : (zh ? "恢复系统归档" : "Restore system archive")}</button>
      <p className="text-xs leading-5 text-secondary">{zh ? "第一版仅允许恢复到没有对话和附件的空实例；非空实例会拒绝并保持现状。" : "This version restores only into an instance with no conversations or attachments. A non-empty instance is rejected unchanged."}</p>
      {message ? <p className="text-xs leading-5 text-secondary" role="status">{message}</p> : null}
    </div>
  );
}
