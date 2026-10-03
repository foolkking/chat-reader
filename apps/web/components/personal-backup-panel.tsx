"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Download, FileArchive, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { cancelTask, confirmPersonalArchiveRestore, discardPersonalArchiveUpload, getPersonalArchiveCapabilities, getPersonalArchiveTasks, getTask, queuePersonalArchiveExport, retryTask, uploadPersonalArchive } from "../lib/api";
import type { BackgroundTaskRead } from "../lib/types";
import { ArchivePreview, ArchiveProgress, archiveError, archiveStatus, archiveTaskLabel } from "./archive-ui";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

const active = (task?: BackgroundTaskRead) => !!task && ["queued", "processing", "cancelling"].includes(task.status);
const bytes = (size: number) => `${(size / 1024 / 1024).toFixed(size >= 1024 * 1024 ? 1 : 2)} MB`;
const button = "btn-secondary min-h-11 px-3 text-sm";

export function DataBackupPanel({ focused = false, onDirtyChange, initialTaskId, onRestoreConversation }: { focused?: boolean; onDirtyChange?: (dirty: boolean) => void; initialTaskId?: string; onRestoreConversation?: () => void }) {
  const { resolvedLocale, retryPreferenceSync } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const client = useQueryClient(), { confirm } = useInteractionDialog();
  const [mode, setMode] = useState<"backup" | "restore">(initialTaskId ? "restore" : "backup");
  const [includeArchived, setIncludeArchived] = useState(true), [includePreferences, setIncludePreferences] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId ?? null);
  const [file, setFile] = useState<File | null>(null), [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [online, setOnline] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null), uploadHandle = useRef<{ cancel: () => void } | null>(null);
  const requestKeys = useRef({ upload: "", backup: "" }), mounted = useRef(true), handled = useRef(new Set<string>());
  const capabilities = useQuery({ queryKey: ["personal-archive-capabilities"], queryFn: getPersonalArchiveCapabilities, enabled: online, retry: false });
  const history = useInfiniteQuery({ queryKey: ["personal-archive-tasks"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getPersonalArchiveTasks(pageParam), getNextPageParam: (last) => last.length === 30 ? last[last.length - 1].job_id : undefined,
    enabled: online, retry: false, refetchInterval: (query) => query.state.data?.pages.flat().some(active) ? 1500 : 30_000, refetchIntervalInBackground: false });
  const selectedQuery = useQuery({ queryKey: ["task", selectedId], queryFn: () => getTask(selectedId!), enabled: online && !!selectedId, retry: false, refetchInterval: (query) => active(query.state.data) ? 1500 : false });
  const tasks = history.data?.pages.flat() ?? [];
  const fromHistory = tasks.find((task) => task.job_id === selectedId);
  const selected = selectedQuery.data?.status === "committed" && fromHistory?.status !== "committed" ? selectedQuery.data : fromHistory ?? selectedQuery.data;
  const preview = selected?.job_type === "personal_archive_preflight" && selected.status === "committed" ? selected : null;
  const confirmed = preview ? tasks.find((task) => task.job_type === "personal_archive_restore" && task.result.parent_task_id === preview.job_id && task.status !== "cancelled") : undefined;
  const available = (task: BackgroundTaskRead) => task.result.artifact_available !== false && Date.parse(String(task.result.expires_at)) > Date.now();
  const limit = capabilities.data?.maximum_upload_bytes;

  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploadHandle.current?.cancel(); }; }, []);
  useLayoutEffect(() => { onDirtyChange?.(busy || !!file || includePreferences); }, [busy, file, includePreferences, onDirtyChange]);
  useEffect(() => {
    for (const task of history.data?.pages.flat() ?? []) {
      if (task.job_type !== "personal_archive_restore" || task.status !== "committed" || handled.current.has(task.job_id)) continue;
      handled.current.add(task.job_id);
      for (const key of ["projects", "conversations", "sidebar-conversations", "project-conversations", "offline-catalog"]) void client.invalidateQueries({ queryKey: [key] });
      if (task.result.preferences_imported) void retryPreferenceSync();
    }
  }, [client, history.data, retryPreferenceSync]);

  async function refresh() { await Promise.all([client.invalidateQueries({ queryKey: ["personal-archive-tasks"] }), client.invalidateQueries({ queryKey: ["active-tasks"] }), client.invalidateQueries({ queryKey: ["task"] })]); }
  function openTask(task: BackgroundTaskRead) {
    setFile(null); setIncludePreferences(false); setSelectedId(task.job_id); setError("");
    setMode(task.job_type === "personal_archive_export" ? "backup" : "restore");
    requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: "nearest" }); });
  }
  async function perform(work: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
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
    await perform(async () => { const task = await queuePersonalArchiveExport(includeArchived, requestKeys.current.backup); requestKeys.current.backup = ""; openTask(task); client.setQueryData(["task", task.job_id], task); });
  }
  async function upload() {
    if (!file) return;
    if (limit && file.size > limit) { setError(zh ? `文件超过 ${bytes(limit)} 的上传上限。` : `The file exceeds the ${bytes(limit)} upload limit.`); return; }
    requestKeys.current.upload ||= crypto.randomUUID();
    await perform(async () => {
      setUploadProgress(0); const handle = uploadPersonalArchive(file, requestKeys.current.upload, setUploadProgress); uploadHandle.current = handle;
      try { const task = await handle.promise; if (mounted.current) { requestKeys.current.upload = ""; openTask(task); client.setQueryData(["task", task.job_id], task); } }
      finally { uploadHandle.current = null; if (mounted.current) setUploadProgress(null); }
    });
  }
  async function restore() {
    if (!preview || !available(preview)) return;
    await perform(async () => { const task = await confirmPersonalArchiveRestore(preview.job_id, String(preview.result.content_digest), includePreferences); openTask(task); client.setQueryData(["task", task.job_id], task); });
  }
  async function discard(task: BackgroundTaskRead) {
    if (!await confirm({ title: zh ? "移除上传的归档文件？" : "Remove this uploaded archive?", description: zh ? "只移除临时上传文件。已恢复的项目和对话会保留。" : "Only the temporary upload is removed. Restored projects and conversations remain.", confirmLabel: zh ? "移除上传文件" : "Remove upload" })) return;
    await perform(async () => { await discardPersonalArchiveUpload(task.job_id); setSelectedId(null); });
  }
  async function switchMode(next: "backup" | "restore") {
    if ((file || includePreferences) && !await confirm({ title: zh ? "放弃当前未提交的选择？" : "Discard the current unsent selection?", confirmLabel: zh ? "切换" : "Switch" })) return;
    setMode(next); setSelectedId(null); setFile(null); setIncludePreferences(false); setError("");
  }

  return <div className={focused ? "grid min-w-0 gap-5" : "grid min-w-0 gap-5 border-t border-ui pt-4"}>
    <div role="group" aria-label={zh ? "备份操作" : "Backup action"} className="flex border-b border-ui">{(["backup", "restore"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => void switchMode(value)} className={`min-h-11 flex-1 border-b-2 px-3 text-sm ${mode === value ? "border-[var(--text)] font-semibold text-primary" : "border-transparent text-secondary hover:bg-subtle"}`}>{value === "backup" ? (zh ? "备份我的数据" : "Back up my data") : (zh ? "恢复归档" : "Restore archive")}</button>)}</div>
    {!online ? <p role="status" className="rounded-lg bg-subtle p-3 text-sm leading-6 text-secondary">{zh ? "个人备份与恢复需要联网。离线时可在资料库导出已保存的快照；服务器上的任务会继续。" : "Personal backups and restores need a connection. Offline snapshots can be exported from Library. Server tasks continue while you are away."}</p> : null}
    <section className="grid min-w-0 gap-4" aria-labelledby="personal-backup-heading">
      <h3 id="personal-backup-heading" ref={heading} tabIndex={-1} className="text-base font-semibold text-primary outline-none">{selected ? archiveTaskLabel(selected, zh) : mode === "backup" ? (zh ? "带走你的阅读资料" : "Take your reading materials with you") : (zh ? "选择一份个人归档" : "Choose a personal archive")}</h3>
      {!selectedId && mode === "backup" ? <>
        <ul className="grid gap-2 text-sm leading-6 text-secondary">{(zh ? ["项目、对话与所有历史版本", "附件、批注、笔记与阅读位置", "个人偏好、已持有的格式、噪声规则与 Skill"] : ["Projects, conversations and every saved version", "Attachments, annotations, notes and reading positions", "Preferences, acquired formats, noise rules and Skills"]).map((label) => <li key={label} className="flex gap-2"><CheckCircle2 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />{label}</li>)}</ul>
        <label className="flex min-h-11 items-center gap-3 rounded-lg bg-subtle px-3 py-2 text-sm text-primary"><input type="checkbox" checked={includeArchived} disabled={busy} onChange={(event) => { setIncludeArchived(event.target.checked); requestKeys.current.backup = ""; }} className="h-4 w-4 accent-[var(--accent)]" />{zh ? "包含已归档的项目和对话" : "Include archived projects and conversations"}</label>
        <p className="text-xs leading-5 text-secondary">{zh ? "仅包含当前账户的数据，不包含密码、登录会话或有效分享链接。" : "Only this account’s data is included. Passwords, sign-in sessions and active share links are excluded."}</p>
        <button type="button" disabled={busy || !online} onClick={() => void backup()} className="btn-primary flex min-h-11 items-center justify-center gap-2 px-4 text-sm"><Download aria-hidden="true" className="h-4 w-4" />{busy ? (zh ? "正在创建任务…" : "Creating task…") : (zh ? "生成个人归档 (.cr)" : "Create personal archive (.cr)")}</button>
      </> : null}
      {!selectedId && mode === "restore" ? <>
        {onRestoreConversation ? <button type="button" disabled={busy || !online} className="btn-secondary min-h-11 px-3 text-sm" onClick={onRestoreConversation}>{zh ? "恢复单个对话归档 (.cr)" : "Restore a conversation archive (.cr)"}</button> : null}
        <p className="text-sm leading-6 text-secondary">{zh ? "上传后先核对内容。确认恢复会新增项目和对话，不覆盖当前资料。" : "Review the contents after uploading. Confirming restore adds projects and conversations while preserving your current materials."}</p>
        <div className="grid gap-3 rounded-lg border border-dashed border-ui bg-surface p-4"><label htmlFor="personal-archive-file" className="text-sm font-medium text-primary">{zh ? "个人归档文件 (.cr)" : "Personal archive file (.cr)"}</label><input id="personal-archive-file" type="file" accept=".cr" disabled={busy || !online} className="min-h-11 max-w-full text-sm text-secondary file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:px-3" onChange={(event) => { setFile(event.target.files?.[0] ?? null); requestKeys.current.upload = ""; setError(""); }} /><p className="text-xs leading-5 text-secondary">{limit ? (zh ? `上传上限 ${bytes(limit)}。预检结果保留 24 小时。` : `Upload limit ${bytes(limit)}. The preview remains available for 24 hours.`) : (zh ? "正在读取上传限制…" : "Loading upload limits…")}</p></div>
        {uploadProgress !== null ? <div role="status" className="grid gap-2 text-sm text-secondary"><p>{uploadProgress === 100 ? (zh ? "上传完成，正在登记预检任务…" : "Upload complete. Registering preview task…") : (zh ? `正在上传 ${uploadProgress}%` : `Uploading ${uploadProgress}%`)}</p><progress max={100} value={uploadProgress} className="h-2 w-full accent-[var(--accent)]" /><button type="button" className={button} onClick={() => uploadHandle.current?.cancel()}>{zh ? "取消上传" : "Cancel upload"}</button></div> : <button type="button" disabled={busy || !online || !file || !limit} onClick={() => void upload()} className="btn-primary flex min-h-11 items-center justify-center gap-2 px-4 text-sm"><Upload aria-hidden="true" className="h-4 w-4" />{zh ? "上传并预检" : "Upload & preview"}</button>}
        {capabilities.isError ? <button type="button" onClick={() => void capabilities.refetch()} className={button}>{zh ? "重试读取上传限制" : "Retry loading upload limits"}</button> : null}
      </> : null}
      {selectedId && !selected ? <><p role={selectedQuery.isError ? "alert" : "status"} className="text-sm text-secondary">{selectedQuery.isError ? (zh ? "无法读取任务，请刷新重试。" : "Unable to load this task. Refresh to retry.") : (zh ? "正在读取任务…" : "Loading task…")}</p><button type="button" className={button} onClick={() => void refresh()}>{zh ? "刷新任务" : "Refresh task"}</button></> : null}
      {selected ? <>
        <ArchiveProgress task={selected} zh={zh} />
        {active(selected) ? <p className="text-xs leading-5 text-secondary">{zh ? "可以关闭此窗口，稍后从任务中心或下方记录继续。" : "You can close this panel and return through Tasks or the records below."}</p> : null}
        {selected.cancellable ? <button type="button" disabled={busy || !online || selected.status === "cancelling"} className={button} onClick={() => void perform(async () => { await cancelTask(selected.job_id); })}>{selected.status === "cancelling" ? (zh ? "正在取消…" : "Cancelling…") : (zh ? "取消任务" : "Cancel task")}</button> : null}
        {selected.status === "failed" ? <><p role="alert" className="break-words text-sm text-[var(--danger)]">{archiveError(selected.error_message ?? "", zh)}</p><button type="button" disabled={busy || !online} className={button} onClick={() => void perform(async () => { await retryTask(selected.job_id); })}>{zh ? "重试任务" : "Retry task"}</button></> : null}
        {selected.status === "committed" && selected.job_type === "personal_archive_export" ? <>
          {Number(selected.result.missing_attachments) > 0 ? <p role="status" className="text-sm text-[var(--warning)]">{zh ? `有 ${selected.result.missing_attachments} 个附件缺少文件，这份归档不完整。` : `${selected.result.missing_attachments} attachments have no file. This archive is incomplete.`}</p> : null}
          <p className="text-sm text-secondary">{bytes(Number(selected.result.byte_size))} · {zh ? "下载有效至 " : "Download available until "}{new Date(String(selected.result.expires_at)).toLocaleString(resolvedLocale)}</p>
          {available(selected) ? <a href={String(selected.result.download_url)} className="btn-primary flex min-h-11 items-center justify-center gap-2 px-4 text-sm"><Download aria-hidden="true" className="h-4 w-4" />{zh ? "下载个人归档 (.cr)" : "Download personal archive (.cr)"}</a> : <p role="status" className="text-sm text-secondary">{zh ? "下载已过期或文件已移除，请重新生成。" : "The download expired or was removed. Create a new archive."}</p>}
          <button type="button" disabled={busy || !online} className={button} onClick={() => void backup()}>{zh ? "重新生成归档" : "Create a fresh archive"}</button>
        </> : null}
        {preview ? <>
          <ArchivePreview task={preview} zh={zh} />
          {confirmed ? <button type="button" className={button} onClick={() => openTask(confirmed)}>{zh ? "查看已确认的恢复任务" : "View the confirmed restore task"}</button> : available(preview) ? <>
            <label className="flex min-h-11 items-start gap-3 rounded-lg bg-subtle p-3 text-sm text-primary"><input type="checkbox" checked={includePreferences} disabled={busy} onChange={(event) => setIncludePreferences(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" /><span>{zh ? "同时导入账户偏好" : "Also import account preferences"}<span className="mt-1 block text-xs leading-5 text-secondary">{zh ? "默认保留当前主题、语言和阅读设置。勾选后使用归档中的偏好。" : "Current appearance and reading settings are kept by default. Select this to use the archived preferences."}</span></span></label>
            <div className="sticky bottom-0 grid gap-2 border-t border-ui bg-raised pb-1 pt-3"><p className="text-xs leading-5 text-secondary">{zh ? "确认后新增导入；同一份归档重复提交不会重复创建。" : "Confirm to add these materials. Submitting the same archive again will not create duplicates."}</p><button type="button" disabled={busy || !online} onClick={() => void restore()} className="btn-primary min-h-11 px-4 text-sm">{busy ? (zh ? "正在提交恢复…" : "Submitting restore…") : (zh ? "确认新增恢复" : "Restore these materials")}</button></div>
          </> : <p role="status" className="text-sm text-secondary">{zh ? "预检已过期或上传文件已移除，请重新上传。" : "The preview expired or its upload was removed. Upload the file again."}</p>}
        </> : null}
        {selected.status === "committed" && selected.job_type === "personal_archive_restore" ? <>
          <p role="status" className="text-sm leading-6 text-primary">{selected.result.already_restored ? (zh ? "这份归档已恢复过，本次没有重复创建。" : "This archive was already restored. No duplicates were created.") : (zh ? `已新增 ${selected.result.counts?.projects ?? 0} 个项目、${selected.result.counts?.conversations ?? 0} 个对话。` : `Added ${selected.result.counts?.projects ?? 0} projects and ${selected.result.counts?.conversations ?? 0} conversations.`)}</p>
          {Number(selected.result.missing_assets) > 0 ? <p className="text-sm text-[var(--warning)]">{zh ? `${selected.result.missing_assets} 个附件文件仍缺失，引用已保留。` : `${selected.result.missing_assets} attachment files remain missing; references were retained.`}</p> : null}
          <p className="text-xs text-secondary">{selected.result.preferences_imported ? (zh ? "已导入账户偏好。" : "Account preferences imported.") : (zh ? "当前账户偏好已保留。" : "Current account preferences retained.")}</p>
        </> : null}
        {selected.job_type === "personal_archive_preflight" && !active(selected) ? <button type="button" disabled={busy || !online || active(confirmed)} className="btn-ghost min-h-11 px-3 text-sm" onClick={() => void discard(selected)}>{zh ? "移除上传文件" : "Remove uploaded file"}</button> : null}
      </> : null}
      {selectedId ? <button type="button" disabled={busy} className="btn-ghost flex min-h-11 items-center justify-center gap-2 px-3 text-sm" onClick={() => void switchMode(mode)}><ArrowLeft aria-hidden="true" className="h-4 w-4" />{zh ? "返回操作选择" : "Back to options"}</button> : null}
      {error ? <p role="alert" className="break-words text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-secondary">{notice}</p> : null}
    </section>
    <section className="grid gap-2 border-t border-ui pt-4" aria-label={zh ? "备份与恢复记录" : "Backup and restore records"}>
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-primary">{zh ? "备份与恢复记录" : "Backup and restore records"}</h3><button type="button" aria-label={zh ? "刷新归档记录" : "Refresh archive records"} disabled={busy || !online || history.isFetching} className="btn-ghost flex h-11 w-11 items-center justify-center" onClick={() => void refresh()}><RefreshCw aria-hidden="true" className="h-4 w-4" /></button></div>
      {history.isError ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "读取记录失败，请刷新重试。" : "Records could not be loaded. Refresh to retry."}</p> : null}
      {history.isPending && online ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取记录…" : "Loading records…"}</p> : !tasks.length ? <p className="py-3 text-sm leading-6 text-secondary">{zh ? "还没有归档任务。生成一份备份，或上传个人归档开始恢复。" : "No archive tasks yet. Create a backup or upload a personal archive to get started."}</p> : null}
      <div className="divide-y divide-[var(--border)]">{tasks.map((task) => <button type="button" key={task.job_id} disabled={busy || !!file || includePreferences} onClick={() => openTask(task)} className="flex min-h-16 w-full items-center gap-3 px-1 py-3 text-left hover:bg-subtle"><FileArchive aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-primary">{archiveTaskLabel(task, zh)}</span><span className="mt-1 block text-xs text-secondary">{task.queued_at ? new Date(task.queued_at).toLocaleString(resolvedLocale) : ""}</span></span><span className="shrink-0 text-xs text-secondary">{archiveStatus(task, zh)}{active(task) ? ` ${task.progress}%` : ""}</span></button>)}</div>
      {history.hasNextPage ? <button type="button" disabled={busy || history.isFetchingNextPage || !online} onClick={() => void history.fetchNextPage()} className={button}>{zh ? "加载更早记录" : "Load earlier records"}</button> : null}
    </section>
  </div>;
}
