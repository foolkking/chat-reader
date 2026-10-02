"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, RefreshCw, X, Eraser } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cancelTask, dismissCleanupScan, getActiveTasks, getPendingCleanupScans, getTask, retryTask } from "../../lib/api";
import type { BackgroundTaskRead, CleanupScanRead } from "../../lib/types";
import { ContentCleanupDialog } from "../conversations/content-cleanup-panel";
import { usePreferences, useTranslations } from "../../components/preferences-provider";
import { SettingsFocusedDialog } from "../../components/settings-focused-dialog";

export function ImportTaskMonitor({ placement, forceVisible = false }: { placement: "sidebar" | "mobile" | "center"; forceVisible?: boolean }) {
  const t = useTranslations();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const previousTasks = useRef<BackgroundTaskRead[]>([]);
  const handledTerminalTaskIds = useRef<Set<string>>(new Set());
  const [completedTask, setCompletedTask] = useState<BackgroundTaskRead | null>(null);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set());
  const [reviewScanId, setReviewScanId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("chat-reader-dismissed-task-ids") ?? "[]") as string[];
      setDismissedTaskIds(new Set(stored));
    } catch {
      setDismissedTaskIds(new Set());
    }
  }, []);
  const dismissTask = (taskId: string) => {
    setDismissedTaskIds((current) => {
      const next = new Set(current);
      next.add(taskId);
      window.localStorage.setItem("chat-reader-dismissed-task-ids", JSON.stringify([...next].slice(-100)));
      return next;
    });
  };
  const tasksQuery = useQuery({
    queryKey: ["active-tasks"],
    queryFn: getActiveTasks,
    refetchInterval: (query) =>
      query.state.data?.some((task) => ["queued", "processing", "cancelling"].includes(task.status)) ? 1500 : false,
  });
  const scansQuery = useQuery({
    queryKey: ["content-cleanup-pending"],
    queryFn: getPendingCleanupScans,
    refetchInterval: (query) => (query.state.data ?? []).some((scan) => ["QUEUED", "SCANNING"].includes(scan.status)) ? 1500 : 10_000,
  });
  useEffect(() => {
    for (const task of tasksQuery.data ?? []) {
      if (task.job_type !== "conversation_batch_delete") continue;
      const deletedIds = Array.isArray(task.result.deleted_ids) ? task.result.deleted_ids : [];
      if (!deletedIds.length) continue;
      window.dispatchEvent(new CustomEvent("chat-reader:conversation-delete-progress", {
        detail: { jobId: task.job_id, deletedIds },
      }));
    }
  }, [tasksQuery.data]);
  const retryMutation = useMutation({
    mutationFn: retryTask,
    onSuccess: (task) => {
      queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (current = []) => [
        task,
        ...current.filter((item) => item.job_id !== task.job_id),
      ]);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: cancelTask,
    onSuccess: (task) => {
      if (task.status === "cancelled") {
        setCompletedTask(task);
        void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
        window.setTimeout(() => setCompletedTask((value) => value?.job_id === task.job_id ? null : value), 6000);
        return;
      }
      queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (current = []) => [
        task,
        ...current.filter((item) => item.job_id !== task.job_id),
      ]);
    },
  });

  useEffect(() => {
    const current = tasksQuery.data ?? [];
    const previousById = new Map(previousTasks.current.map((task) => [task.job_id, task]));
    const currentIds = new Set(current.map((task) => task.job_id));
    const disappeared = previousTasks.current.filter(
      (task) => ["queued", "processing", "cancelling"].includes(task.status) && !currentIds.has(task.job_id),
    );
    previousTasks.current = current;
    const handleTerminal = (result: BackgroundTaskRead) => {
        if (!isTerminalTask(result) || handledTerminalTaskIds.current.has(result.job_id)) return;
        handledTerminalTaskIds.current.add(result.job_id);
        if (result.job_type === "content_noise_scan") {
          void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
          return;
        }
        if (result.job_type === "conversation_merge" && result.result.conversation_id) {
          window.dispatchEvent(new CustomEvent("chat-reader:conversation-merge-complete", {
            detail: {
              conversationId: result.result.conversation_id,
              sourceConversationIds: result.result.source_conversation_ids ?? [],
            },
          }));
        }
        setCompletedTask(result);
        void invalidateReaderQueries(queryClient);
        window.setTimeout(
          () => setCompletedTask((value) => (value?.job_id === result.job_id ? null : value)),
          result.status === "cancelled" ? 6000 : 10000,
        );
    };
    for (const task of current) {
      const previous = previousById.get(task.job_id);
      if (previous && !isTerminalTask(previous) && isTerminalTask(task)) handleTerminal(task);
    }
    for (const task of disappeared) {
      void getTask(task.job_id).then(handleTerminal);
    }
  }, [queryClient, tasksQuery.data]);

  const allTasks = (tasksQuery.data ?? []).filter((task) => !dismissedTaskIds.has(task.job_id) || (placement === "center" && needsAccountCleanup(task)));
  const noiseTasks = allTasks.filter((task) => task.job_type === "content_noise_scan");
  const tasks = allTasks.filter((task) => task.job_type !== "content_noise_scan");
  const taskRows = completedTask && !tasks.some((task) => task.job_id === completedTask.job_id)
    ? [...tasks, completedTask]
    : tasks;
  const processingTasks = taskRows.filter((task) => ["queued", "processing", "cancelling"].includes(task.status));
  const failedTasks = taskRows.filter((task) => task.status === "failed");
  const cleanupTasks = taskRows.filter((task) => task.status === "committed" && needsAccountCleanup(task));
  const completedTasks = taskRows.filter((task) => ["committed", "cancelled"].includes(task.status) && !needsAccountCleanup(task));
  const visibleTask = processingTasks.find((task) => task.status === "processing")
    ?? processingTasks[0]
    ?? (placement === "mobile" ? completedTask : null);
  const scans = scansQuery.data ?? [];
  if (!visibleTask && !noiseTasks.length && !scans.length && !forceVisible) return null;

  if (placement === "mobile") {
    return <><div className="fixed inset-x-3 bottom-3 z-40 divide-y divide-ui overflow-hidden rounded-xl border border-ui bg-surface shadow-xl md:hidden">{visibleTask ? <div className="p-3"><TaskContent task={visibleTask} compact onCancel={() => cancelMutation.mutate(visibleTask.job_id)} onDismiss={isTerminalTask(visibleTask) ? () => dismissTask(visibleTask.job_id) : undefined} /></div> : null}<NoiseReviewSummary scans={scans} tasks={noiseTasks} onReview={setReviewScanId} onDismiss={(id) => void dismissCleanupScan(id).then(() => void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }))} /></div>{reviewScanId ? <NoiseReviewDialog scanId={reviewScanId} onClose={() => { setReviewScanId(null); void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}</>;
  }

  if (placement === "center") {
    const taskRow = (task: BackgroundTaskRead) => <div key={task.job_id} data-task-row={task.job_type} className="px-4 py-4"><TaskContent task={task} onRetry={() => retryMutation.mutate(task.job_id)} onCancel={() => cancelMutation.mutate(task.job_id)} onDismiss={isTerminalTask(task) && !needsAccountCleanup(task) ? () => dismissTask(task.job_id) : undefined} /></div>;
    return <div className="space-y-4" aria-label={t("tasks")}><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-primary">{t("backgroundTasks")}</p><p className="mt-1 text-xs text-secondary">{t("backgroundTasksHint")}</p></div><span className="text-xs text-secondary">{taskRows.length + Math.max(scans.length, noiseTasks.length)} {zh ? "项" : "items"}</span></div>{!taskRows.length && !noiseTasks.length && !scans.length ? <div className="rounded-lg border border-dashed border-ui px-4 py-8 text-center text-sm text-secondary">{t("noActiveTasks")}</div> : null}<TaskSection title={zh ? "处理中" : "In progress"} count={processingTasks.length}>{processingTasks.map(taskRow)}</TaskSection><TaskSection title={zh ? "需要处理" : "Needs attention"} count={Math.max(scans.length, noiseTasks.length) + cleanupTasks.length}>{cleanupTasks.map(taskRow)}<NoiseReviewSummary scans={scans} tasks={noiseTasks} onReview={setReviewScanId} onDismiss={(id) => void dismissCleanupScan(id).then(() => void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }))} /></TaskSection><TaskSection title={zh ? "已完成" : "Completed"} count={completedTasks.length}>{completedTasks.map(taskRow)}</TaskSection><TaskSection title={zh ? "失败" : "Failed"} count={failedTasks.length}>{failedTasks.map(taskRow)}</TaskSection>{reviewScanId ? <NoiseReviewDialog scanId={reviewScanId} onClose={() => { setReviewScanId(null); void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}</div>;
  }

  return (
    <div className="mb-3 space-y-2">
      {visibleTask ? (
        <div key={visibleTask.job_id} className="rounded-xl border border-[#d8dee9] bg-white p-3 shadow-sm">
          {/* The compact sidebar is a status indicator only. Retry belongs to
              the expanded global Tasks surface so contextual retry controls
              cannot be mistaken for an editor upload retry. */}
          <TaskContent task={visibleTask} onCancel={() => cancelMutation.mutate(visibleTask.job_id)} onDismiss={isTerminalTask(visibleTask) ? () => dismissTask(visibleTask.job_id) : undefined} />
        </div>
      ) : null}
      {completedTask ? (
        <div className={`rounded-xl border p-3 text-xs ${completedTask.status === "cancelled" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <p className="flex items-center gap-1.5 font-medium">
            {completedTask.status === "cancelled" ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {completedTask.status === "cancelled"
              ? (completedTask.job_type === "conversation_batch_delete" ? "后续删除已停止" : "合并已取消")
              : completedLabel(completedTask.job_type)}
          </p>
          {taskConversationId(completedTask) ? (
            <Link className="mt-1 inline-block underline" href={`/conversations/${taskConversationId(completedTask)}`}>
              打开会话
            </Link>
          ) : null}
          {completedTask.result.download_url ? <a className="mt-1 inline-block underline" href={String(completedTask.result.download_url)}>下载归档</a> : null}
        </div>
      ) : null}
      <NoiseReviewSummary scans={scans} tasks={noiseTasks} onReview={setReviewScanId} onDismiss={(id) => void dismissCleanupScan(id).then(() => void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }))} />
      {reviewScanId ? <NoiseReviewDialog scanId={reviewScanId} onClose={() => { setReviewScanId(null); void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}
    </div>
  );
}

function TaskSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return <section aria-label={title}><div className="mb-2 flex items-center justify-between px-1"><h3 className="text-xs font-semibold text-primary">{title}</h3><span className="text-[11px] tabular-nums text-secondary">{count}</span></div><div className="divide-y divide-ui overflow-hidden rounded-xl border border-ui bg-surface shadow-[var(--shadow-subtle)]">{children}</div></section>;
}

function NoiseReviewSummary({ scans, tasks, onReview, onDismiss }: { scans: CleanupScanRead[]; tasks: BackgroundTaskRead[]; onReview: (id: string) => void; onDismiss: (id: string) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const visible = scans;
  const scanIds = new Set(visible.map((scan) => scan.id));
  const pendingTasks = tasks.filter((task) => !task.result.scan_id || !scanIds.has(task.result.scan_id));
  if (!visible.length && !pendingTasks.length) return null;
  return (
    <div className="divide-y divide-[var(--border)]" aria-label={zh ? "噪声审查" : "Noise reviews"}>
      {pendingTasks.map((task) => <div key={task.job_id} className="px-4 py-3"><TaskContent task={task} compact /></div>)}
      {visible.map((scan) => {
        const task = tasks.find((item) => item.result.scan_id === scan.id);
        return (
          <div key={scan.id} className="px-4 py-3 text-xs text-primary">
            <p className="flex items-center gap-1.5 font-medium">
              <Eraser className="h-3.5 w-3.5 text-accent" />
              {scan.status === "READY" ? (zh ? `${scan.occurrence_count} 个噪声候选待审查` : `${scan.occurrence_count} noise candidates ready for review`) : ["FAILED", "STALE"].includes(scan.status) ? (zh ? "噪声扫描需要重试" : "Noise scan needs retry") : (zh ? `噪声审查 ${scan.progress}%` : `Noise review ${scan.progress}%`)}
            </p>
            <p className="mt-1 text-[11px] text-secondary">
              {task?.result.parent_task_id ? (zh ? "导入后扫描 · " : "Import follow-up · ") : ""}{scan.target_count} {zh ? "个对话" : "conversations"} · {scan.processed_messages}/{scan.total_messages} {zh ? "条消息" : "messages"}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(scan.progress, 2)}%` }} /></div>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => onReview(scan.id)} disabled={!['READY', 'FAILED', 'STALE'].includes(scan.status)} className="min-h-9 font-medium text-accent underline disabled:opacity-50">{zh ? "打开审查" : "Open review"}</button>
              <button type="button" onClick={() => onDismiss(scan.id)} disabled={!['READY', 'FAILED', 'STALE'].includes(scan.status)} className="min-h-9 text-secondary underline disabled:opacity-50">{zh ? "忽略本次结果" : "Ignore this result"}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NoiseReviewDialog({ scanId, onClose }: { scanId: string; onClose: () => void }) {
  return <ContentCleanupDialog open initialScanId={scanId} onClose={onClose} />;
}

function needsAccountCleanup(task: BackgroundTaskRead): boolean {
  return task.job_type === "user_account_delete" && task.result.account_deleted === true && Number(task.result.asset_cleanup_pending) > 0;
}

function TaskContent({ task, compact = false, onRetry, onCancel, onDismiss }: { task: BackgroundTaskRead; compact?: boolean; onRetry?: () => void; onCancel?: () => void; onDismiss?: () => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [userOpen, setUserOpen] = useState(false);
  const userTrigger = useRef<HTMLButtonElement>(null);
  const accountDelete = task.job_type === "user_account_delete";
  const accountDeleted = accountDelete && task.result.account_deleted === true;
  const cleanupPending = accountDeleted && Number(task.result.asset_cleanup_pending) > 0;
  const failed = task.status === "failed";
  const committed = task.status === "committed";
  const conversationId = taskConversationId(task);
  const itemFailures = Array.isArray(task.result.failed) ? task.result.failed.length : 0;
  const completedItems = taskCompletedItems(task);
  const partial = committed && itemFailures > 0;
  return (
    <div className="min-w-0 text-xs text-[#475569]" data-testid={`task-${task.job_type}-${task.status}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-medium text-[#111827]">{accountDelete ? (zh ? "删除用户账户" : "Delete user account") : task.label || taskTypeLabel(task)}</p>
        <div className="flex shrink-0 items-center gap-1">
          <span>{committed ? "100%" : `${task.progress}%`}</span>
          {onDismiss ? <button type="button" data-testid={`task-dismiss-${task.job_id}`} onClick={onDismiss} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[#f1f5f9]" aria-label="关闭任务提示" title="关闭任务提示"><X className="h-4 w-4" /></button> : null}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">
        <div
          className={`h-full rounded-full transition-[width] ${failed ? "bg-red-500" : "bg-[#10a37f]"}`}
          style={{ width: `${committed ? 100 : Math.max(task.progress, 2)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span>{partial ? (zh ? "\u90e8\u5206\u5b8c\u6210" : "Partially completed") : phaseLabel(task)}</span>
        {task.total_items > 0 ? <span>{task.processed_items} / {task.total_items}</span> : null}
      </div>
      {failed ? (
        <div className="mt-2">
          <p className="line-clamp-2 text-red-700">{accountDelete ? accountDeleted ? (zh ? "账户已删除，剩余文件清理失败，可重试清理。" : "Account deleted. Remaining file cleanup failed; retry cleanup.") : (zh ? "删除失败，资料已保留。可查看账户并重试。" : "Deletion failed. Data retained; review the account and retry.") : task.error_message || "任务失败"}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="mt-1 inline-flex items-center gap-1 font-medium text-red-800 underline">
              <RefreshCw className="h-3.5 w-3.5" /> 重试
            </button>
          ) : null}
        </div>
      ) : null}
      {cleanupPending && !failed ? <div className="mt-2 text-[var(--warning)]" role="status"><p>{zh ? `账户已删除，仍有 ${Number(task.result.asset_cleanup_pending)} 个文件待清理。` : `Account deleted. ${Number(task.result.asset_cleanup_pending)} files still need cleanup.`}</p>{committed && onRetry ? <button type="button" onClick={onRetry} className="min-h-11 font-medium underline">{zh ? "重试文件清理" : "Retry file cleanup"}</button> : null}</div> : null}
      {partial ? <p className="mt-2 text-amber-700" role="status">{zh ? `${completedItems} \u9879\u5b8c\u6210 \u00b7 ${itemFailures} \u9879\u5931\u8d25` : `${completedItems} completed \u00b7 ${itemFailures} failed`}</p> : null}
      {task.status === "cancelling" ? <p className="mt-2 font-medium text-amber-700">{task.job_type === "conversation_batch_delete" ? "正在完成当前删除，随后停止后续项目…" : "正在取消并回滚…"}</p> : null}
      {task.cancellable && task.status !== "cancelling" && onCancel ? (
        <button type="button" onClick={onCancel} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)]">
          <Ban className="h-3.5 w-3.5" />{(task.job_type.startsWith("personal_archive_") || task.job_type.startsWith("system_archive_")) ? (zh ? "取消归档任务" : "Cancel archive task") : task.job_type === "conversation_batch_delete" ? "停止后续删除" : "取消合并"}
        </button>
      ) : null}
      {accountDelete && !accountDeleted && !committed && typeof task.result.target_user_id === "string" ? <button ref={userTrigger} className="min-h-11 font-medium text-accent underline" onClick={() => setUserOpen(true)}>{zh ? "查看账户与删除状态" : "Review account deletion"}</button> : null}
      {userOpen ? <SettingsFocusedDialog category="admin-users" initialAdminUserId={String(task.result.target_user_id)} onClose={() => setUserOpen(false)} restoreFocus={() => userTrigger.current} /> : null}
      {committed ? <TaskResultActions task={task} conversationId={conversationId} compact={compact} zh={zh} /> : null}
    </div>
  );
}

function TaskResultActions({ task, conversationId, compact, zh }: { task: BackgroundTaskRead; conversationId: string | null; compact: boolean; zh: boolean }) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  const conversationIds = Array.isArray(task.result.conversation_ids) ? task.result.conversation_ids : [];
  const importIds = task.job_type === "import" ? conversationIds : [];
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${compact ? "text-[11px]" : "text-xs"}`} data-testid={`task-result-${task.job_type}`}>
      {(task.job_type.startsWith("personal_archive_") || task.job_type.startsWith("system_archive_")) ? <button ref={archiveTrigger} type="button" className="min-h-11 font-medium text-accent underline underline-offset-2" onClick={() => setArchiveOpen(true)}>{task.job_type.endsWith("_archive_preflight") ? (zh ? "查看预检并恢复" : "Review preview & restore") : (zh ? "查看归档详情" : "View archive details")}</button> : null}
      {archiveOpen ? <SettingsFocusedDialog category={task.job_type.startsWith("system_archive_") ? "admin-system" : "data"} initialArchiveTaskId={task.job_id} onClose={() => setArchiveOpen(false)} restoreFocus={() => archiveTrigger.current} /> : null}
      {task.result.download_url ? <a data-testid="task-result-download" className="font-medium text-accent underline underline-offset-2" href={String(task.result.download_url)}>{zh ? "\u4e0b\u8f7d\u7ed3\u679c" : "Download result"}</a> : null}
      {conversationId && importIds.length <= 1 ? <Link data-testid="task-result-conversation" className="font-medium text-accent underline underline-offset-2" href={`/conversations/${conversationId}`}>{zh ? (task.job_type === "conversation_merge" ? "\u6253\u5f00\u5408\u5e76\u540e\u7684\u5bf9\u8bdd" : "\u6253\u5f00\u5bf9\u8bdd") : (task.job_type === "conversation_merge" ? "Open merged conversation" : "Open conversation")}</Link> : null}
      {importIds.length > 1 ? <><span className="text-secondary">{zh ? `\u5df2\u5bfc\u5165 ${importIds.length} \u4e2a\u5bf9\u8bdd` : `${importIds.length} conversations imported`}</span>{importIds.slice(0, 3).map((id, index) => <Link key={id} className="font-medium text-accent underline underline-offset-2" href={`/conversations/${id}`}>{zh ? `\u6253\u5f00\u7b2c ${index + 1} \u4e2a` : `Open ${index + 1}`}</Link>)}</> : null}
    </div>
  );
}

function taskCompletedItems(task: BackgroundTaskRead): number {
  if (Array.isArray(task.result.deleted_ids)) return task.result.deleted_ids.length;
  if (Array.isArray(task.result.conversation_ids)) return task.result.conversation_ids.length;
  return Math.max(0, task.processed_items - (Array.isArray(task.result.failed) ? task.result.failed.length : 0));
}

function phaseLabel(task: BackgroundTaskRead): string {
  if (task.status === "cancelling") return "正在取消";
  if (task.status === "cancelled") return "已取消";
  if (task.status === "queued") return "等待处理";
  if (task.status === "failed") return "处理失败";
  if (task.status === "committed") return "处理完成";
  const labels: Record<string, string> = {
    deleting: "按顺序删除对话",
    messages: "复制消息",
    source_refs: "复制来源引用",
    versions: "复制完整版本",
    blocks: "复制渲染块",
    annotations: "复制批注",
    parsing: "解析与对齐",
    persisting: "保存消息与 blocks",
    validating: "校验来源与顺序",
    creating: "创建目标会话",
    copying: "复制消息与 blocks",
    headings: "生成章节目录",
    search: "构建搜索索引",
    publishing: "发布会话",
    exporting: "生成 .cr 归档",
    cleaning_messages: "清理消息内容",
    rebuilding_index: "重建目录与搜索",
    packaging_messages: "整理对话消息",
    packaging_headings: "整理章节目录",
    packaging_search: "整理离线搜索索引",
    packaging_annotations: "整理批注",
    packaging_metadata: "整理阅读状态与笔记",
    packaging_attachments: "整理附件索引",
    packaging_conversations: "整理离线对话",
    packaging_assets: "写入离线附件",
    validating_package: "校验离线资料",
  };
  return labels[task.phase] ?? "正在处理";
}

function taskTypeLabel(task: BackgroundTaskRead): string {
  return {
    conversation_batch_delete: "删除归档对话",
    conversation_merge: "合并会话",
    conversation_export: "导出归档",
    conversation_auto_clean: "清理对话",
    import: "导入会话",
    system_archive_export: "备份系统数据",
    system_archive_preflight: "预检系统归档",
    system_archive_restore: "恢复系统归档",
    personal_archive_export: "备份我的数据",
    personal_archive_preflight: "预检个人归档",
    personal_archive_restore: "恢复个人归档",
  }[task.job_type] ?? "后台任务";
}

function completedLabel(jobType: string): string {
  return `${taskTypeLabel({ job_type: jobType } as BackgroundTaskRead)}完成`;
}

function taskConversationId(task: BackgroundTaskRead): string | null {
  return task.result.conversation_id ?? task.result.conversation_ids?.[0] ?? null;
}

function isTerminalTask(task: BackgroundTaskRead): boolean {
  return ["committed", "failed", "cancelled"].includes(task.status);
}

async function invalidateReaderQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["conversations", "active"] }),
    queryClient.invalidateQueries({ queryKey: ["conversations", "history"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["project-conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["reader-turn-window"] }),
    queryClient.invalidateQueries({ queryKey: ["conversation-index"] }),
    queryClient.invalidateQueries({ queryKey: ["toc"] }),
    queryClient.invalidateQueries({ queryKey: ["conversation-search"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-search"] }),
    queryClient.invalidateQueries({ queryKey: ["search"] }),
    queryClient.invalidateQueries({ queryKey: ["offline-catalog"] }),
  ]);
}
