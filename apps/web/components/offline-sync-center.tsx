"use client";

import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { getOfflineCatalog } from "../lib/api";
import { offlineLeaseExpiresAt } from "../lib/auth-client";
import { clearOfflineAttachmentCache, inspectOfflineCopyAssets, offlineDb, OfflinePendingChangesError, OfflineDownloadInProgressError, removeOfflineConversations, type OfflineConversationRecord, type OfflineOutboxRecord } from "../lib/offline-db";
import { cancelOfflineDownload, enqueueOfflineDownload, listOfflineDownloads, retryOfflineDownload, type OfflineAssetMode, type OfflineDownload } from "../lib/offline-downloads";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { OfflineConflictReview } from "./offline-conflict-review";
import { exportOfflinePending, readOfflinePending, type OfflinePendingSnapshot } from "../lib/offline-pending";
import type { NotebookDraft } from "../lib/notebook-drafts";
import { PendingChangesPanel } from "./pending-changes-panel";
import { PreferenceSyncStatus } from "./preference-sync-status";
import { ReadingPositionSyncStatus } from "./reading-position-sync-status";

type Copy = { conversation: OfflineConversationRecord; assets: Awaited<ReturnType<typeof inspectOfflineCopyAssets>> };
type Conflict = { key: string; conversationId: string };

// Intent: a reader prepares reliable copies and resolves a specific failed
// operation. Quiet ledger rows retain the reading-workbench hierarchy. Existing
// paper/graphite/sea-green tokens, bordered sections, application font, 4px grid.
export function OfflineSyncCenter({ onDirtyChange, initialConflictKey }: { onDirtyChange?: (dirty: boolean) => void; initialConflictKey?: string }) {
  const { resolvedLocale, preferenceSync } = usePreferences(), { confirm } = useInteractionDialog();
  const preferenceCount = Object.keys(preferenceSync?.changes ?? {}).length;
  const zh = resolvedLocale === "zh-CN";
  const [tab, setTab] = useState<"copies" | "pending" | "failures">(initialConflictKey ? "failures" : "copies");
  const [online, setOnline] = useState(navigator.onLine);
  const [mode, setMode] = useState<OfflineAssetMode>("all");
  const [copies, setCopies] = useState<Copy[]>([]);
  const [downloads, setDownloads] = useState<OfflineDownload[]>([]);
  const [pending, setPending] = useState<OfflineOutboxRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [drafts, setDrafts] = useState<Array<{ key: string; value: NotebookDraft }>>([]), [draftCount, setDraftCount] = useState(0);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [syncFailures, setSyncFailures] = useState<OfflineOutboxRecord[]>([]), [syncFailureCount, setSyncFailureCount] = useState(0);
  const [page, setPage] = useState(0), [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(initialConflictKey ?? null);
  const [cleanup, setCleanup] = useState<{ conversationId: string; attachmentsOnly: boolean; snapshot: OfflinePendingSnapshot } | null>(null);
  const catalog = useQuery({ queryKey: ["offline-catalog"], queryFn: getOfflineCatalog, enabled: online, retry: 1 });
  const [project, setProject] = useState("");
  const activeDownload = downloads.some((item) => ["queued", "generating", "downloading", "writing"].includes(item.state));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const subscription = liveQuery(async () => {
      const db = offlineDb;
      const failed = () => db.outbox.filter((item) => Boolean(item.last_error) && item.last_error !== "CONFLICT");
      const [count, rows, tasks, operations, operationCount, markers, failedRows, failedCount, draftRows, draftsTotal] = await Promise.all([
        db.conversations.count(), db.conversations.orderBy("downloaded_at").reverse().offset(page * 20).limit(20).toArray(),
        listOfflineDownloads(db), db.outbox.orderBy("queued_at").offset(tab === "pending" ? page * 20 : 0).limit(20).toArray(), db.outbox.count(),
        db.settings.where("key").startsWith("sync-conflict:").toArray(),
        failed().offset(page * 20).limit(20).toArray(), failed().count(),
        db.settings.where("key").startsWith("notebook-draft:").offset(page * 20).limit(20).toArray(), db.settings.where("key").startsWith("notebook-draft:").count(),
      ]);
      return { count, rows, tasks, operations, operationCount, markers, failedRows, failedCount, draftRows, draftsTotal };
    }).subscribe({ next: (data) => {
      if (!active) return;
      setTotal(data.count); setDownloads(data.tasks); setPending(data.operations); setPendingCount(data.operationCount);
      setDrafts(data.draftRows as Array<{ key: string; value: NotebookDraft }>); setDraftCount(data.draftsTotal);
      setSyncFailures(data.failedRows); setSyncFailureCount(data.failedCount);
      setConflicts(data.markers.map((row) => ({ key: row.key, conversationId: (row.value as { conversation_id: string }).conversation_id })));
      void Promise.all(data.rows.map(async (conversation) => ({ conversation, assets: await inspectOfflineCopyAssets(conversation.id, mode) })))
        .then((value) => { if (active) { setCopies(value); setLoading(false); } }).catch(() => { if (active) { setLoading(false); setError(zh ? "无法检查离线资源，请重试。" : "Unable to check offline resources. Retry."); } });
    }, error: () => { if (active) { setLoading(false); setError(zh ? "无法读取本地存储，请重试。" : "Unable to read local storage. Retry."); } } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [page, tab, mode, refresh, zh]);

  const action = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); setRefresh((value) => value + 1); }
    catch (cause) { setError(cause instanceof OfflineDownloadInProgressError ? (zh ? "下载进行中，请先取消或等待完成再清理。" : "A download is running. Cancel it or wait before clearing data.") : cause instanceof OfflinePendingChangesError
      ? (zh ? `还有 ${cause.count} 项未同步修改，请先同步。副本已保留。` : `${cause.count} unsynced changes remain. Sync first; the copy is retained.`)
      : (zh ? "操作未完成，现有副本已保留。请检查连接或本地存储后重试。" : "The operation did not finish. Existing copies are retained. Check the connection or local storage and retry.")); }
    finally { setBusy(false); }
  }, [zh]);
  const download = (scope: OfflineDownload["scope"], scopeId?: string) => action(() => enqueueOfflineDownload({ scope, scopeId, assetMode: mode }));
  const remove = (copy: Copy, attachmentsOnly: boolean) => action(async () => {
    const snapshot = await readOfflinePending([copy.conversation.id]);
    if (snapshot.count) { setCleanup({ conversationId: copy.conversation.id, attachmentsOnly, snapshot }); return; }
    if (!await confirm({ title: zh ? (attachmentsOnly ? "清除此副本的附件缓存？" : "删除此离线副本？") : (attachmentsOnly ? "Clear attachment cache?" : "Delete this offline copy?"),
      description: zh ? "服务器资料不受影响；再次离线使用需要重新下载。含未同步修改时不会清除。" : "Server content remains. Download again before offline use. Unsynced changes prevent removal.", confirmLabel: zh ? "清除" : "Clear", danger: true })) return;
    await (attachmentsOnly ? clearOfflineAttachmentCache([copy.conversation.id], snapshot.fingerprint) : removeOfflineConversations([copy.conversation.id], snapshot.fingerprint));
  });
  const retrySync = () => action(async () => {
    await offlineDb.outbox.filter((item) => item.last_error !== "CONFLICT").modify({ attempts: 0, last_error: null, retry_after: 0 });
    window.dispatchEvent(new Event("chat-reader:outbox"));
  });
  const exportChanges = () => action(async () => {
    const blob = await exportOfflinePending(await readOfflinePending()), url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "chat-reader-unsynced-changes.zip"; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  const expiry = offlineLeaseExpiresAt();
  const failures = downloads.filter((item) => item.state === "failed" || item.state === "cancelled");
  const pages = Math.ceil((tab === "copies" ? total : tab === "pending" ? Math.max(pendingCount, draftCount) : Math.max(failures.length, conflicts.length, syncFailureCount)) / 20);
  const stateLabel = (state: OfflineDownload["state"]) => (zh ? { queued: "排队中", generating: "生成中", downloading: "下载中", writing: "写入中", completed: "已完成", failed: "失败", cancelled: "已取消" } : { queued: "Queued", generating: "Generating", downloading: "Downloading", writing: "Writing", completed: "Completed", failed: "Failed", cancelled: "Cancelled" })[state];

  if (selectedConflict?.startsWith("sync-conflict:reading_position:")) return <section className="space-y-3"><button className="btn-secondary min-h-9 px-3 text-sm" onClick={() => setSelectedConflict(null)}>{zh ? "返回同步中心" : "Back to sync center"}</button><ReadingPositionSyncStatus conversationId={selectedConflict.slice("sync-conflict:reading_position:".length)} showIdle /></section>;
  if (selectedConflict) return <OfflineConflictReview conflictKey={selectedConflict} onDirtyChange={onDirtyChange} onBack={() => { setSelectedConflict(null); setRefresh((value) => value + 1); requestAnimationFrame(() => document.getElementById("offline-tab-failures")?.focus()); }} />;
  if (cleanup) return <PendingChangesPanel initial={cleanup.snapshot} purpose={cleanup.attachmentsOnly ? "clear-files" : "delete-copy"} conversationIds={[cleanup.conversationId]} onCancel={() => setCleanup(null)} onProceed={async (fingerprint) => {
    if (cleanup.attachmentsOnly) await clearOfflineAttachmentCache([cleanup.conversationId], fingerprint);
    else await removeOfflineConversations([cleanup.conversationId], fingerprint);
    setCleanup(null); setRefresh((value) => value + 1);
  }} />;
  return <section className="space-y-4" aria-label={zh ? "离线与同步中心" : "Offline and sync center"}>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-secondary">
      <p>{online ? (zh ? "已联网" : "Online") : (zh ? "离线" : "Offline")}{Number.isFinite(expiry) ? ` · ${zh ? "离线授权至" : "Offline access until"} ${new Date(expiry).toLocaleString(resolvedLocale)}` : ""}</p>
      <button className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3" disabled={busy} onClick={() => { setError(""); setRefresh((value) => value + 1); if (online) void catalog.refetch(); }}><RefreshCw className="h-3.5 w-3.5" />{zh ? "刷新" : "Refresh"}</button>
    </div>
    <div className="flex border-b border-ui" role="tablist" aria-label={zh ? "同步中心内容" : "Sync center views"}>
      {(["copies", "pending", "failures"] as const).map((value, index) => <button key={value} type="button" role="tab" aria-selected={tab === value} aria-controls={`offline-${value}`} id={`offline-tab-${value}`} tabIndex={tab === value ? 0 : -1}
        onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3; const selected = (["copies", "pending", "failures"] as const)[next]; setTab(selected); setPage(0); document.getElementById(`offline-tab-${selected}`)?.focus(); } }}
        onClick={() => { setTab(value); setPage(0); }} className={`min-h-11 flex-1 border-b-2 px-2 text-sm font-medium ${tab === value ? "border-[var(--accent)] text-accent" : "border-transparent text-secondary hover:bg-subtle"}`}>
        {value === "copies" ? (zh ? "离线副本" : "Offline copies") : value === "pending" ? (zh ? "待同步修改" : "Pending edits") : (zh ? "失败与冲突" : "Failures & conflicts")}
      </button>)}
    </div>
    {error ? <p role="alert" className="border-l-2 border-[var(--danger)] pl-3 text-sm text-[var(--danger)]">{error}</p> : null}
    <div role="tabpanel" id={`offline-${tab}`} aria-labelledby={`offline-tab-${tab}`} className="space-y-4">
      {tab === "copies" ? <>
        <p className="text-xs leading-5 text-secondary">{zh ? "下载后可阅读正文、搜索、查看目录及已缓存附件。降低附件档位不会清除已下载的文件。" : "Downloaded copies support reading, search, contents and cached attachments. Lowering the attachment tier keeps existing files."}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-40 flex-1 text-xs text-secondary">{zh ? "下载附件" : "Download attachments"}<select className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-3 text-sm text-primary" value={mode} onChange={(event) => setMode(event.target.value as OfflineAssetMode)}><option value="none">{zh ? "仅附件信息" : "Metadata only"}</option><option value="small">{zh ? "小附件（≤10 MiB）" : "Small files (≤10 MiB)"}</option><option value="all">{zh ? "全部附件" : "All attachments"}</option></select></label>
          <button className="btn-primary inline-flex min-h-11 items-center gap-2 px-3 text-sm" disabled={!online || busy} onClick={() => void download("all")}><Download className="h-4 w-4" />{zh ? "下载／更新全部" : "Download / update all"}</button>
        </div>
        {online && catalog.data?.projects.length ? <div className="flex flex-wrap gap-2"><select aria-label={zh ? "选择项目" : "Choose project"} className="min-h-11 min-w-0 flex-1 rounded-md border border-ui bg-surface px-3 text-sm" value={project} onChange={(event) => setProject(event.target.value)}><option value="">{zh ? "选择项目" : "Choose project"}</option>{catalog.data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="btn-secondary min-h-11 px-3 text-sm" disabled={!project || busy} onClick={() => void download("project", project)}>{zh ? "下载项目" : "Download project"}</button></div> : null}
        {catalog.isError && online ? <p className="text-xs text-secondary">{zh ? "服务器目录暂不可用；本地副本仍可访问。" : "Server catalog is unavailable; local copies remain accessible."}</p> : null}
        {downloads.filter((item) => ["queued", "generating", "downloading", "writing"].includes(item.state)).map((item) => <div key={item.id} className="space-y-2 border-y border-ui py-3" role="status"><div className="flex items-center gap-3"><span className="min-w-0 flex-1 break-words text-sm">{item.label || (zh ? "全部对话" : "All conversations")} · {stateLabel(item.state)}</span><button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy || item.cancelRequested} onClick={() => void action(() => cancelOfflineDownload(item.id))}>{item.cancelRequested ? (zh ? "正在取消" : "Cancelling") : (zh ? "取消" : "Cancel")}</button></div><progress className="h-1.5 w-full accent-[var(--accent)]" max={100} value={item.progress} aria-label={zh ? "下载进度" : "Download progress"} /></div>)}
        {loading ? <p role="status" className="text-sm text-secondary">{zh ? "正在检查离线副本…" : "Checking offline copies…"}</p> : null}
        <ul className="divide-y divide-[var(--border)]">{copies.map((copy) => <li key={copy.conversation.id} className="space-y-2 py-4">
          <a className="break-words text-sm font-semibold text-primary hover:text-accent" href={`/library?conversationId=${copy.conversation.id}`}>{copy.conversation.display_title}</a>
          <p className="text-xs text-secondary">{copy.conversation.message_count} {zh ? "条消息" : "messages"} · {zh ? "已缓存附件" : "Cached files"} {copy.assets.available}/{copy.assets.total} · {copy.assets.missing ? (zh ? `需补充 ${copy.assets.missing} 个附件` : `${copy.assets.missing} files missing`) : catalog.data?.conversations.some((row) => row.id === copy.conversation.id && row.revision !== copy.conversation.offline_revision) ? (zh ? "正文有更新" : "Content update available") : (zh ? "当前副本可用" : "Current copy available")}</p>
          <div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-9 px-3 text-xs" disabled={!online || busy} onClick={() => void download("conversation", copy.conversation.id)}>{zh ? "检查并更新" : "Check and update"}</button><button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy || activeDownload || !copy.assets.available} onClick={() => void remove(copy, true)}>{zh ? "仅清附件缓存" : "Clear cached files"}</button><button className="min-h-9 rounded-md px-3 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50" disabled={busy || activeDownload} onClick={() => void remove(copy, false)}>{zh ? "删除副本" : "Delete copy"}</button></div>
        </li>)}</ul>
        {!loading && !total ? <p className="py-6 text-center text-sm text-secondary">{zh ? "还没有离线副本。联网后选择全部、项目，或从资料库下载单个对话。" : "No offline copies yet. Connect to download all, a project, or one conversation from the library."}</p> : null}
      </> : tab === "pending" ? <>
        <PreferenceSyncStatus />
        <div className="flex items-center justify-between gap-3"><p className="text-sm text-secondary">{pendingCount} {zh ? "项待同步修改" : "pending edits"}</p><button className="btn-primary min-h-11 px-3 text-sm" disabled={!online || busy || !pendingCount} onClick={() => void retrySync()}>{zh ? "同步／重试" : "Sync / retry"}</button></div>
        <button className="btn-secondary min-h-9 px-3 text-sm" disabled={busy || !(pendingCount || draftCount || conflicts.length || preferenceCount)} onClick={() => void exportChanges()}>{zh ? "导出本机修改与草稿" : "Export local edits and drafts"}</button>
        {draftCount ? <section className="space-y-2 border-y border-ui py-3"><h3 className="text-sm font-semibold">{zh ? "本机笔记草稿" : "Local notebook drafts"} · {draftCount}</h3>{drafts.map((row) => <a key={row.key} className="block min-h-9 break-words py-2 text-sm text-accent hover:underline" href={`${row.value.mode === "offline" ? `/library?conversationId=${row.value.conversation_id}&` : `/conversations/${row.value.conversation_id}?`}annotations=open&notebookDraft=${encodeURIComponent(row.key)}`}>{row.value.title || (zh ? "恢复无标题草稿" : "Restore untitled draft")}</a>)}</section> : null}
        <ul className="divide-y divide-[var(--border)]">{pending.map((item) => <li key={item.operation_id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><a href={item.entity_type === "reading_position" && online ? `/conversations/${item.conversation_id}` : `/library?conversationId=${item.conversation_id}${item.entity_type === "reading_position" ? "" : "&annotations=open"}`} className="font-medium hover:text-accent">{item.entity_type === "reading_position" ? (zh ? "阅读进度" : "Reading progress") : item.entity_type === "notebook" ? (zh ? "笔记修改" : "Notebook edit") : (zh ? "批注修改" : "Annotation edit")}</a><span className="text-xs text-secondary">{item.last_error === "CONFLICT" ? (zh ? "冲突，等待处理" : "Conflict, awaiting review") : item.last_error ? (zh ? `同步失败 · 已尝试 ${item.attempts} 次` : `Sync failed · ${item.attempts} attempts`) : (zh ? "等待同步" : "Waiting to sync")}</span></li>)}</ul>
        {!pendingCount && !draftCount && !preferenceCount ? <p className="py-6 text-center text-sm text-secondary">{zh ? "没有待同步修改。" : "No pending edits."}</p> : null}
      </> : <>
        <ul className="divide-y divide-[var(--border)]">{failures.slice(page * 20, page * 20 + 20).map((item) => <li key={item.id} className="space-y-2 py-3"><p className="text-sm font-medium">{item.label || (zh ? "全部对话" : "All conversations")} · {stateLabel(item.state)}</p><p className="text-xs text-secondary">{item.error === "GONE" ? (zh ? "服务器包已被替换，重试将重新生成。" : "The server package was replaced. Retry to rebuild.") : item.error === "QUOTA" ? (zh ? "浏览器空间不足，请先释放空间。" : "Browser storage is full. Free space before retrying.") : (zh ? "现有本地副本已保留。" : "Existing local copies are retained.")}</p><button disabled={!online || busy} className="btn-secondary min-h-9 px-3 text-xs" onClick={() => void action(() => retryOfflineDownload(item.id))}>{zh ? "重试下载" : "Retry download"}</button></li>)}{conflicts.slice(page * 20, page * 20 + 20).map((item) => <li key={item.key} className="space-y-2 py-3"><p className="text-sm font-medium">{item.key.startsWith("sync-conflict:reading_position:") ? (zh ? "阅读位置存在冲突" : "Reading position conflict") : (zh ? "批注／笔记存在冲突" : "Annotation / notebook conflict")}</p><button className="btn-secondary min-h-9 px-3 text-sm" disabled={!online || busy} onClick={() => setSelectedConflict(item.key)}>{zh ? "比较并解决" : "Compare and resolve"}</button><a className="ml-3 inline-flex min-h-9 items-center text-sm text-accent hover:underline" href={`/library?conversationId=${item.conversationId}&annotations=open`}>{zh ? "打开对话" : "Open conversation"}</a></li>)}</ul>
        {syncFailures.length ? <section className="space-y-2 border-t border-ui pt-3"><h3 className="text-sm font-semibold">{zh ? "同步失败" : "Sync failures"}</h3><p className="text-xs text-secondary">{syncFailureCount} {zh ? "项修改仍保留在本机" : "edits retained on this device"}</p>{syncFailures.map((item) => <a key={item.operation_id} className="block min-h-9 py-2 text-sm text-accent hover:underline" href={item.entity_type === "reading_position" && online ? `/conversations/${item.conversation_id}` : `/library?conversationId=${item.conversation_id}${item.entity_type === "reading_position" ? "" : "&annotations=open"}`}>{item.entity_type === "reading_position" ? (zh ? "查看未同步进度" : "View unsynced progress") : item.entity_type === "notebook" ? (zh ? "查看未同步笔记" : "View unsynced notebook") : (zh ? "查看未同步批注" : "View unsynced annotation")}</a>)}<button className="btn-secondary min-h-9 px-3 text-sm" disabled={!online || busy} onClick={() => void retrySync()}>{zh ? "重试同步" : "Retry sync"}</button></section> : null}
        {!failures.length && !conflicts.length && !syncFailureCount ? <p className="py-6 text-center text-sm text-secondary">{zh ? "没有失败任务或已记录冲突。" : "No failed tasks or recorded conflicts."}</p> : null}
      </>}
    </div>
    {pages > 1 ? <nav className="flex items-center justify-between border-t border-ui pt-3 text-xs" aria-label={zh ? "离线中心分页" : "Offline center pages"}><button className="btn-secondary min-h-9 px-3" disabled={!page} onClick={() => setPage((value) => value - 1)}>{zh ? "上一页" : "Previous"}</button><span>{page + 1} / {pages}</span><button className="btn-secondary min-h-9 px-3" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>{zh ? "下一页" : "Next"}</button></nav> : null}
  </section>;
}
