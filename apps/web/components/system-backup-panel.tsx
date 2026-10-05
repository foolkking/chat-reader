"use client";
import { ExportArtifactDelivery } from "../features/exporting/export-artifact-delivery";
import { releaseExportScope } from "../lib/export-usage";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Download, FileArchive, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { cancelTask, confirmSystemArchiveRestore, discardSystemArchiveUpload, getSystemArchiveCapabilities, getSystemArchiveTasks, getTask, queueSystemArchiveExport, retryTask, uploadSystemArchive } from "../lib/api";
import type { BackgroundTaskRead } from "../lib/types";
import { ArchivePreview, ArchiveProgress, archiveError, archiveStatus, archiveTaskLabel } from "./archive-ui";
import { SystemArchiveOwnership } from "./system-archive-ownership";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

const active = (task?: BackgroundTaskRead) => !!task && ["queued", "processing", "cancelling"].includes(task.status);
const bytes = (size: number) => `${(size / 1024 / 1024).toFixed(size >= 1024 * 1024 ? 1 : 2)} MB`;
const button = "btn-secondary min-h-11 px-3 text-sm";

export function AdminSystemPanel({ onDirtyChange, initialTaskId }: { onDirtyChange?: (dirty: boolean) => void; initialTaskId?: string }) {
  const { resolvedLocale, retryPreferenceSync } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const client = useQueryClient(), { confirm } = useInteractionDialog();
  const [mode, setMode] = useState<"backup" | "restore">(initialTaskId ? "restore" : "backup");
  const [includeArchived, setIncludeArchived] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId ?? null);
  const [file, setFile] = useState<File | null>(null), [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [online, setOnline] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mappingBusy, setMappingBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), uploadHandle = useRef<{ cancel: () => void } | null>(null);
  const requestKeys = useRef({ upload: "", backup: "" }), mounted = useRef(true), handled = useRef(new Set<string>());
  const capabilities = useQuery({ queryKey: ["system-archive-capabilities"], queryFn: getSystemArchiveCapabilities, enabled: online, retry: false });
  const history = useInfiniteQuery({ queryKey: ["system-archive-tasks"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getSystemArchiveTasks(pageParam), getNextPageParam: (last) => last.length === 30 ? last[last.length - 1].job_id : undefined,
    enabled: online, retry: false, refetchInterval: (query) => query.state.data?.pages.flat().some(active) ? 1500 : 30_000, refetchIntervalInBackground: false });
  const selectedQuery = useQuery({ queryKey: ["task", selectedId], queryFn: () => getTask(selectedId!), enabled: online && !!selectedId, retry: false, refetchInterval: (query) => active(query.state.data) ? 1500 : false });
  const tasks = history.data?.pages.flat() ?? [];
  const fromHistory = tasks.find((task) => task.job_id === selectedId);
  const selected = selectedQuery.data?.status === "committed" && fromHistory?.status !== "committed" ? selectedQuery.data : fromHistory ?? selectedQuery.data;
  const preview = selected?.job_type === "system_archive_preflight" && selected.status === "committed" ? selected : null;
  const confirmed = preview ? tasks.find((task) => task.job_type === "system_archive_restore" && task.result.parent_task_id === preview.job_id && task.status !== "cancelled") : undefined;
  const available = (task: BackgroundTaskRead) => task.result.artifact_available !== false && Date.parse(String(task.result.expires_at)) > Date.now();
  const limit = capabilities.data?.maximum_upload_bytes;

  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploadHandle.current?.cancel(); }; }, []);
  useLayoutEffect(() => { onDirtyChange?.(busy || mappingBusy || !!file); }, [busy, mappingBusy, file, onDirtyChange]);
  useEffect(() => {
    for (const task of history.data?.pages.flat() ?? []) {
      if (task.job_type !== "system_archive_restore" || task.status !== "committed" || handled.current.has(task.job_id)) continue;
      handled.current.add(task.job_id);
      for (const key of ["projects", "conversations", "sidebar-conversations", "project-conversations", "offline-catalog", "admin-users", "account-capabilities"]) void client.invalidateQueries({ queryKey: [key] });
      if (task.result.preferences_imported) void retryPreferenceSync();
      void client.invalidateQueries({ queryKey: ["system-archive-capabilities"] });
    }
  }, [client, history.data, retryPreferenceSync]);

  async function refresh() { await Promise.all([client.invalidateQueries({ queryKey: ["system-archive-accounts"] }), client.invalidateQueries({ queryKey: ["system-archive-capabilities"] }), client.invalidateQueries({ queryKey: ["system-archive-tasks"] }), client.invalidateQueries({ queryKey: ["active-tasks"] }), client.invalidateQueries({ queryKey: ["task"] })]); }
  function openTask(task: BackgroundTaskRead) {
    releaseExportScope("backup:system");
    setFile(null); setSelectedId(task.job_id); setError("");
    setMode(task.job_type === "system_archive_export" ? "backup" : "restore");
    requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: "nearest" }); });
  }
  async function perform(work: () => Promise<void>) {
    if (busy || mappingBusy) return; setBusy(true); setError(""); setNotice("");
    try { await work(); await refresh(); }
    catch (failure) {
      if (mounted.current) {
        if (failure instanceof DOMException && failure.name === "AbortError") setNotice(zh ? "上传已停止，文件选择已保留。已登记的任务可从下方记录查看。" : "Upload stopped; your file selection is retained. Any accepted task appears in the records below.");
        else setError(archiveError(failure instanceof Error ? failure.message : "", zh));
        void refresh();
      }
    }
    finally { if (mounted.current) setBusy(false); }
  }
  async function backup() {
    requestKeys.current.backup ||= crypto.randomUUID();
    await perform(async () => { const task = await queueSystemArchiveExport(includeArchived, requestKeys.current.backup); requestKeys.current.backup = ""; openTask(task); client.setQueryData(["task", task.job_id], task); });
  }
  async function upload() {
    if (!file) return;
    if (limit && file.size > limit) { setError(zh ? `文件超过 ${bytes(limit)} 的上传上限。` : `The file exceeds the ${bytes(limit)} upload limit.`); return; }
    requestKeys.current.upload ||= crypto.randomUUID();
    await perform(async () => {
      setUploadProgress(0); const handle = uploadSystemArchive(file, requestKeys.current.upload, setUploadProgress); uploadHandle.current = handle;
      try { const task = await handle.promise; if (mounted.current) { requestKeys.current.upload = ""; openTask(task); client.setQueryData(["task", task.job_id], task); } }
      finally { uploadHandle.current = null; if (mounted.current) setUploadProgress(null); }
    });
  }
  async function restore(revision: string) {
    if (!preview || !available(preview)) return;
    await perform(async () => { const task = await confirmSystemArchiveRestore(preview.job_id, String(preview.result.content_digest), revision); openTask(task); client.setQueryData(["task", task.job_id], task); });
  }
  async function discard(task: BackgroundTaskRead) {
    if (!await confirm({ title: zh ? "移除上传的归档文件？" : "Remove this uploaded archive?", description: zh ? "只移除临时上传文件。已恢复的项目和对话会保留。" : "Only the temporary upload is removed. Restored projects and conversations remain.", confirmLabel: zh ? "移除上传文件" : "Remove upload" })) return;
    await perform(async () => { await discardSystemArchiveUpload(task.job_id); setSelectedId(null); });
  }
  async function switchMode(next: "backup" | "restore") {
    if ((file) && !await confirm({ title: zh ? "放弃当前未提交的选择？" : "Discard the current unsent selection?", confirmLabel: zh ? "切换" : "Switch" })) return;
    releaseExportScope("backup:system");
    setMode(next); setSelectedId(null); setFile(null); setError("");
  }

  return <div className="grid min-w-0 gap-5">

    <div role="group" aria-label={zh ? "备份操作" : "Backup action"} className="flex border-b border-ui">{(["backup", "restore"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy || mappingBusy} onClick={() => void switchMode(value)} className={`min-h-11 flex-1 border-b-2 px-3 text-sm ${mode === value ? "border-[var(--text)] font-semibold text-primary" : "border-transparent text-secondary hover:bg-subtle"}`}>{value === "backup" ? (zh ? "备份整个系统" : "Back up the system") : (zh ? "恢复归档" : "Restore archive")}</button>)}</div>
    {!online ? <p role="status" className="rounded-lg bg-subtle p-3 text-sm leading-6 text-secondary">{zh ? "系统备份与恢复需要联网。离线时可在资料库导出已保存的快照；服务器上的任务会继续。" : "System backups and restores need a connection. Offline snapshots can be exported from Library. Server tasks continue while you are away."}</p> : null}
    {mode === "restore" && capabilities.data?.empty_instance === false ? <p role="status" className="border-l-2 border-[var(--warning)] pl-3 text-sm leading-6 text-secondary">{zh ? "当前实例已有资料或自定义配置，可以预检归档，但不能执行新的系统恢复。请在空实例恢复；本人资料请使用「数据与备份」。" : "This instance contains materials or custom settings. You can preview an archive, but a new system restore requires an empty instance. Use Data & backup for your own materials."}</p> : null}
    {capabilities.isError ? <button type="button" disabled={!online} className={button} onClick={() => void capabilities.refetch()}>{zh ? "重试读取恢复条件与上传限制" : "Retry loading restore requirements and upload limits"}</button> : null}
    <section className="grid min-w-0 gap-4" aria-labelledby="system-backup-heading">
      <h3 id="system-backup-heading" ref={heading} tabIndex={-1} className="text-base font-semibold text-primary outline-none">{selected ? archiveTaskLabel(selected, zh) : mode === "backup" ? (zh ? "保存整个阅读资料库" : "Preserve the whole reading library") : (zh ? "选择一份系统归档" : "Choose a system archive")}</h3>
      {!selectedId && mode === "backup" ? <>
        <ul className="grid gap-2 text-sm leading-6 text-secondary">{(zh ? ["所有账户的项目、对话、历史版本与附件", "批注、笔记、阅读位置与账户偏好", "格式、噪声规则、现有 Skill 与功能／访问策略"] : ["Every account’s projects, conversations, versions and attachments", "Annotations, notes, reading positions and account preferences", "Formats, noise rules, existing Skills and feature / access policies"]).map((label) => <li key={label} className="flex gap-2"><CheckCircle2 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />{label}</li>)}</ul>
        <label className="flex min-h-11 items-center gap-3 rounded-lg bg-subtle px-3 py-2 text-sm text-primary"><input type="checkbox" checked={includeArchived} disabled={busy || mappingBusy} onChange={(event) => { setIncludeArchived(event.target.checked); requestKeys.current.backup = ""; }} className="h-4 w-4 accent-[var(--accent)]" />{zh ? "包含已归档的项目和对话" : "Include archived projects and conversations"}</label>
        <p className="text-xs leading-5 text-secondary">{zh ? "包含用于恢复归属的账户身份；不包含密码、会话、有效分享链接或服务器配置。这是应用数据归档。" : "Includes account identities for ownership recovery. Passwords, sessions, active share links and server configuration are excluded. This is an application data archive."}</p>
        <button type="button" disabled={busy || !online} onClick={() => void backup()} className="btn-primary flex min-h-11 items-center justify-center gap-2 px-4 text-sm"><Download aria-hidden="true" className="h-4 w-4" />{busy ? (zh ? "正在创建任务…" : "Creating task…") : (zh ? "生成系统归档 (.cr)" : "Create system archive (.cr)")}</button>
      </> : null}
      {!selectedId && mode === "restore" ? <>
        <p className="text-sm leading-6 text-secondary">{zh ? "先上传并校验归档，再核对内容与账户归属。确认后仅在空实例中恢复；现有管理员身份和凭据保留。" : "Upload and validate the archive, then review its contents and account ownership. Restoration requires an empty instance and retains the current administrator identity and credentials."}</p>
        <div className="grid gap-3 rounded-lg border border-dashed border-ui bg-surface p-4"><label htmlFor="system-archive-file" className="text-sm font-medium text-primary">{zh ? "系统归档文件 (.cr)" : "System archive file (.cr)"}</label><input id="system-archive-file" type="file" accept=".cr" disabled={busy || !online} className="min-h-11 max-w-full text-sm text-secondary file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:px-3" onChange={(event) => { setFile(event.target.files?.[0] ?? null); requestKeys.current.upload = ""; setError(""); }} /><p className="text-xs leading-5 text-secondary">{limit ? (zh ? `上传上限 ${bytes(limit)}。预检结果保留 24 小时。` : `Upload limit ${bytes(limit)}. The preview remains available for 24 hours.`) : (zh ? "正在读取上传限制…" : "Loading upload limits…")}</p></div>
        {uploadProgress !== null ? <div role="status" className="grid gap-2 text-sm text-secondary"><p>{uploadProgress === 100 ? (zh ? "上传完成，正在登记预检任务…" : "Upload complete. Registering preview task…") : (zh ? `正在上传 ${uploadProgress}%` : `Uploading ${uploadProgress}%`)}</p><progress max={100} value={uploadProgress} className="h-2 w-full accent-[var(--accent)]" /><button type="button" className={button} onClick={() => uploadHandle.current?.cancel()}>{zh ? "取消上传" : "Cancel upload"}</button></div> : <button type="button" disabled={busy || !online || !file || !limit} onClick={() => void upload()} className="btn-primary flex min-h-11 items-center justify-center gap-2 px-4 text-sm"><Upload aria-hidden="true" className="h-4 w-4" />{zh ? "上传并预检" : "Upload & preview"}</button>}
      </> : null}
      {selectedId && !selected ? <><p role={selectedQuery.isError ? "alert" : "status"} className="text-sm text-secondary">{selectedQuery.isError ? (zh ? "无法读取任务，请刷新重试。" : "Unable to load this task. Refresh to retry.") : (zh ? "正在读取任务…" : "Loading task…")}</p><button type="button" className={button} onClick={() => void refresh()}>{zh ? "刷新任务" : "Refresh task"}</button></> : null}
      {selected ? <>
        <ArchiveProgress task={selected} zh={zh} />
        {active(selected) ? <p className="text-xs leading-5 text-secondary">{zh ? "可以关闭此窗口，稍后从任务中心或下方记录继续。" : "You can close this panel and return through Tasks or the records below."}</p> : null}
        {selected.cancellable ? <button type="button" disabled={busy || !online || selected.status === "cancelling"} className={button} onClick={() => void perform(async () => { await cancelTask(selected.job_id); })}>{selected.status === "cancelling" ? (zh ? "正在取消…" : "Cancelling…") : (zh ? "取消任务" : "Cancel task")}</button> : null}
        {selected.status === "failed" ? <><p role="alert" className="break-words text-sm text-[var(--danger)]">{archiveError(selected.error_message ?? "", zh)}</p><button type="button" disabled={busy || !online} className={button} onClick={() => void perform(async () => { await retryTask(selected.job_id); })}>{zh ? "重试任务" : "Retry task"}</button></> : null}
        {selected.status === "failed" && selected.job_type === "system_archive_restore" && typeof selected.result.parent_task_id === "string" ? <button type="button" disabled={busy || !online} className={button} onClick={() => setSelectedId(String(selected.result.parent_task_id))}>{zh ? "返回预检，调整账户归属" : "Review preview and account ownership"}</button> : null}
        {selected.status === "committed" && selected.job_type === "system_archive_export" ? <>
          {Number(selected.result.missing_attachments) > 0 ? <p role="status" className="text-sm text-[var(--warning)]">{zh ? `有 ${selected.result.missing_attachments} 个附件缺少文件，这份归档不完整。` : `${selected.result.missing_attachments} attachments have no file. This archive is incomplete.`}</p> : null}
          <p className="text-xs text-secondary">{bytes(Number(selected.result.byte_size))}</p>
          {selected.result.artifact_id ? <ExportArtifactDelivery artifactId={selected.result.artifact_id} scope="backup:system" label={zh ? "下载系统归档 (.cr)" : "Download system archive (.cr)"} onRegenerated={task => { openTask(task); void refresh(); }} /> : null}
        </> : null}
        {preview ? <>
          <ArchivePreview task={preview} zh={zh} />
          {confirmed ? <button type="button" className={button} onClick={() => openTask(confirmed)}>{zh ? "查看已确认的恢复任务" : "View the confirmed restore task"}</button> : null}{(!confirmed || confirmed.status === "failed") && available(preview) ? <SystemArchiveOwnership key={preview.job_id} preview={preview} online={online} busy={busy} canRestore={capabilities.data?.empty_instance === true} onRestore={restore} onBusyChange={setMappingBusy} /> : !available(preview) ? <p role="status" className="text-sm text-secondary">{zh ? "预检已过期或上传文件已移除，请重新上传。" : "The preview expired or its upload was removed. Upload the file again."}</p> : null}

        </> : null}
        {selected.status === "committed" && selected.job_type === "system_archive_restore" ? <>
          <p role="status" className="text-sm leading-6 text-primary">{selected.result.already_restored ? (zh ? "这份归档已恢复过，本次没有重复创建。" : "This archive was already restored. No duplicates were created.") : (zh ? `已恢复 ${selected.result.counts?.projects ?? 0} 个项目、${selected.result.counts?.conversations ?? 0} 个对话。` : `Restored ${selected.result.counts?.projects ?? 0} projects and ${selected.result.counts?.conversations ?? 0} conversations.`)}</p>
          {Number(selected.result.missing_assets) > 0 ? <p className="text-sm text-[var(--warning)]">{zh ? `${selected.result.missing_assets} 个附件文件仍缺失，引用已保留。` : `${selected.result.missing_assets} attachment files remain missing; references were retained.`}</p> : null}
          {selected.result.preferences_imported ? <p className="text-xs text-secondary">{zh ? "已导入账户偏好。" : "Account preferences imported."}</p> : null}
          <p className="text-xs leading-5 text-secondary">{zh ? "管理员身份和凭据保持不变；新建的普通账户需由管理员生成密码重置链接。" : "Administrator credentials are unchanged. Newly created users need an administrator-issued password reset link."}</p>
        </> : null}
        {selected.job_type === "system_archive_preflight" && !active(selected) ? <button type="button" disabled={busy || !online || active(confirmed)} className="btn-ghost min-h-11 px-3 text-sm" onClick={() => void discard(selected)}>{zh ? "移除上传文件" : "Remove uploaded file"}</button> : null}
      </> : null}
      {selectedId ? <button type="button" disabled={busy || mappingBusy} className="btn-ghost flex min-h-11 items-center justify-center gap-2 px-3 text-sm" onClick={() => void switchMode(mode)}><ArrowLeft aria-hidden="true" className="h-4 w-4" />{zh ? "返回操作选择" : "Back to options"}</button> : null}
      {error ? <p role="alert" className="break-words text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-secondary">{notice}</p> : null}
    </section>
    <section className="grid gap-2 border-t border-ui pt-4" aria-label={zh ? "备份与恢复记录" : "Backup and restore records"}>
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-primary">{zh ? "备份与恢复记录" : "Backup and restore records"}</h3><button type="button" aria-label={zh ? "刷新归档记录" : "Refresh archive records"} disabled={busy || !online || history.isFetching} className="btn-ghost flex h-11 w-11 items-center justify-center" onClick={() => void refresh()}><RefreshCw aria-hidden="true" className="h-4 w-4" /></button></div>
      {history.isError ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "读取记录失败，请刷新重试。" : "Records could not be loaded. Refresh to retry."}</p> : null}
      {history.isPending && online ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取记录…" : "Loading records…"}</p> : !tasks.length ? <p className="py-3 text-sm leading-6 text-secondary">{zh ? "还没有归档任务。生成一份备份，或上传系统归档开始恢复。" : "No archive tasks yet. Create a backup or upload a system archive to get started."}</p> : null}
      <div className="divide-y divide-[var(--border)]">{tasks.map((task) => <button type="button" key={task.job_id} disabled={busy || mappingBusy || !!file} onClick={() => openTask(task)} className="flex min-h-16 w-full items-center gap-3 px-1 py-3 text-left hover:bg-subtle"><FileArchive aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-primary">{archiveTaskLabel(task, zh)}</span><span className="mt-1 block text-xs text-secondary">{task.queued_at ? new Date(task.queued_at).toLocaleString(resolvedLocale) : ""}</span></span><span className="shrink-0 text-xs text-secondary">{archiveStatus(task, zh)}{active(task) ? ` ${task.progress}%` : ""}</span></button>)}</div>
      {history.hasNextPage ? <button type="button" disabled={busy || history.isFetchingNextPage || !online} onClick={() => void history.fetchNextPage()} className={button}>{zh ? "加载更早记录" : "Load earlier records"}</button> : null}
    </section>
  </div>;
}
