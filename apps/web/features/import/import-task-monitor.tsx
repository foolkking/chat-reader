"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, RefreshCw, X, Eraser } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cancelTask, dismissCleanupScan, getActiveTasks, getPendingCleanupScans, getTask, retryTask } from "../../lib/api";
import type { BackgroundTaskRead, CleanupScanRead } from "../../lib/types";
import { ContentCleanupDialog } from "../conversations/content-cleanup-panel";
import { useTranslations } from "../../components/preferences-provider";

export function ImportTaskMonitor({ placement, forceVisible = false }: { placement: "sidebar" | "mobile" | "center"; forceVisible?: boolean }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const previousTasks = useRef<BackgroundTaskRead[]>([]);
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
    const current = (tasksQuery.data ?? []).filter((task) => task.job_type !== "content_noise_scan");
    const currentIds = new Set(current.map((task) => task.job_id));
    const finished = previousTasks.current.filter(
      (task) => ["queued", "processing", "cancelling"].includes(task.status) && !currentIds.has(task.job_id),
    );
    previousTasks.current = current;
    for (const task of finished) {
      void getTask(task.job_id).then((result) => {
        if (!["committed", "cancelled"].includes(result.status)) return;
        setCompletedTask(result);
        void invalidateReaderQueries(queryClient);
        window.setTimeout(
          () => setCompletedTask((value) => (value?.job_id === result.job_id ? null : value)),
          result.status === "cancelled" ? 6000 : 10000,
        );
      });
    }
  }, [queryClient, tasksQuery.data]);

  const tasks = (tasksQuery.data ?? []).filter((task) => task.job_type !== "content_noise_scan" && !dismissedTaskIds.has(task.job_id));
  const visibleTask = tasks.find((task) => task.status === "processing") ?? tasks[0] ?? completedTask;
  const scans = scansQuery.data ?? [];
  if (!visibleTask && !scans.length && !forceVisible) return null;

  if (placement === "mobile") {
    return <><div className="fixed inset-x-3 bottom-3 z-40 space-y-2 rounded-xl border border-[#d8dee9] bg-white p-3 shadow-xl md:hidden">{visibleTask ? <TaskContent task={visibleTask} compact onCancel={() => cancelMutation.mutate(visibleTask.job_id)} onDismiss={visibleTask.status === "failed" ? () => dismissTask(visibleTask.job_id) : undefined} /> : null}<NoiseReviewSummary scans={scans} onReview={setReviewScanId} onDismiss={(id) => void dismissCleanupScan(id).then(() => void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }))} /></div>{reviewScanId ? <NoiseReviewDialog scanId={reviewScanId} onClose={() => { setReviewScanId(null); void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}</>;
  }

  if (placement === "center") {
    return <div className="space-y-4" aria-label={t("tasks")}><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-primary">{t("backgroundTasks")}</p><p className="mt-1 text-xs text-secondary">{t("backgroundTasksHint")}</p></div><span className="text-xs text-secondary">{tasks.length + scans.length} 项</span></div>{!visibleTask && !scans.length ? <div className="rounded-lg border border-dashed border-ui px-4 py-8 text-center text-sm text-secondary">{t("noActiveTasks")}</div> : null}{tasks.map((task) => <div key={task.job_id} className="rounded-xl border border-ui bg-surface p-4"><TaskContent task={task} onRetry={() => retryMutation.mutate(task.job_id)} onCancel={() => cancelMutation.mutate(task.job_id)} onDismiss={task.status === "failed" ? () => dismissTask(task.job_id) : undefined} /></div>)}{completedTask ? <div className="rounded-xl border border-ui bg-subtle p-4"><TaskContent task={completedTask} onRetry={() => retryMutation.mutate(completedTask.job_id)} /></div> : null}<NoiseReviewSummary scans={scans} onReview={setReviewScanId} onDismiss={(id) => void dismissCleanupScan(id).then(() => void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }))} />{reviewScanId ? <NoiseReviewDialog scanId={reviewScanId} onClose={() => { setReviewScanId(null); void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}</div>;
  }

  return (
    <div className="mb-3 space-y-2">
      {visibleTask ? (
        <div key={visibleTask.job_id} className="rounded-xl border border-[#d8dee9] bg-white p-3 shadow-sm">
          <TaskContent task={visibleTask} onRetry={() => retryMutation.mutate(visibleTask.job_id)} onCancel={() => cancelMutation.mutate(visibleTask.job_id)} onDismiss={visibleTask.status === "failed" ? () => dismissTask(visibleTask.job_id) : undefined} />
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
      <NoiseReviewSummary scans={scans} onReview={setReviewScanId} onDismiss={(id) => void dismissCleanupScan(id).then(() => void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }))} />
      {reviewScanId ? <NoiseReviewDialog scanId={reviewScanId} onClose={() => { setReviewScanId(null); void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}
    </div>
  );
}

function NoiseReviewSummary({ scans, onReview, onDismiss }: { scans: CleanupScanRead[]; onReview: (id: string) => void; onDismiss: (id: string) => void }) {
  const visible = scans.filter((scan) => scan.source === "IMPORT" || scan.source === "BATCH");
  if (!visible.length) return null;
  return <div className="space-y-2 border-t border-[#e5e7eb] pt-3" aria-label="Noise reviews">{visible.map((scan) => <div key={scan.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950"><p className="flex items-center gap-1.5 font-medium"><Eraser className="h-3.5 w-3.5" />{scan.source === "BATCH" ? (scan.status === "READY" ? `${scan.occurrence_count} candidates found in existing conversations` : `Existing conversation scan ${scan.progress}%`) : (scan.status === "READY" ? `${scan.occurrence_count} noise candidates ready for review` : `Noise review ${scan.progress}%`)}</p><p className="mt-1 text-[11px] text-amber-800">{scan.target_count} conversations · {scan.project_target_count} in projects · {scan.unassigned_target_count} unclassified · {scan.excluded_archived_count} archived excluded · {scan.processed_messages}/{scan.total_messages} messages</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-amber-100"><div className="h-full bg-amber-500 transition-[width]" style={{ width: `${Math.max(scan.progress, 2)}%` }} /></div><div className="mt-2 flex items-center gap-3"><button type="button" onClick={() => onReview(scan.id)} disabled={scan.status !== "READY"} className="font-medium underline disabled:opacity-50">Open review</button><button type="button" onClick={() => onDismiss(scan.id)} disabled={!['READY', 'FAILED', 'STALE'].includes(scan.status)} className="text-amber-800 underline disabled:opacity-50">Ignore this result</button></div></div>)}</div>;
}

function NoiseReviewDialog({ scanId, onClose }: { scanId: string; onClose: () => void }) {
  return <ContentCleanupDialog open initialScanId={scanId} onClose={onClose} />;
}

function TaskContent({ task, compact = false, onRetry, onCancel, onDismiss }: { task: BackgroundTaskRead; compact?: boolean; onRetry?: () => void; onCancel?: () => void; onDismiss?: () => void }) {
  const failed = task.status === "failed";
  const committed = task.status === "committed";
  const conversationId = taskConversationId(task);
  const itemFailures = Array.isArray(task.result.failed) ? task.result.failed.length : 0;
  return (
    <div className="min-w-0 text-xs text-[#475569]" data-testid={`task-${task.job_type}-${task.status}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-medium text-[#111827]">{task.label || taskTypeLabel(task)}</p>
        <div className="flex shrink-0 items-center gap-1">
          <span>{committed ? "100%" : `${task.progress}%`}</span>
          {onDismiss ? <button type="button" onClick={onDismiss} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[#f1f5f9]" aria-label="关闭任务提示" title="关闭任务提示"><X className="h-4 w-4" /></button> : null}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">
        <div
          className={`h-full rounded-full transition-[width] ${failed ? "bg-red-500" : "bg-[#10a37f]"}`}
          style={{ width: `${committed ? 100 : Math.max(task.progress, 2)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span>{phaseLabel(task)}</span>
        {task.total_items > 0 ? <span>{task.processed_items} / {task.total_items}</span> : null}
      </div>
      {failed ? (
        <div className="mt-2">
          <p className="line-clamp-2 text-red-700">{task.error_message || "任务失败"}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="mt-1 inline-flex items-center gap-1 font-medium text-red-800 underline">
              <RefreshCw className="h-3.5 w-3.5" /> 重试
            </button>
          ) : null}
        </div>
      ) : null}
      {committed && itemFailures > 0 ? <p className="mt-2 text-amber-700">{itemFailures} 个项目删除失败，已保留并恢复到列表</p> : null}
      {task.status === "cancelling" ? <p className="mt-2 font-medium text-amber-700">{task.job_type === "conversation_batch_delete" ? "正在完成当前删除，随后停止后续项目…" : "正在取消并回滚…"}</p> : null}
      {task.cancellable && task.status !== "cancelling" && onCancel ? (
        <button type="button" onClick={onCancel} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)]">
          <Ban className="h-3.5 w-3.5" />{task.job_type === "conversation_batch_delete" ? "停止后续删除" : "取消合并"}
        </button>
      ) : null}
      {compact && committed && conversationId ? (
        <Link className="mt-1 inline-block font-medium text-[#0f766e] underline" href={`/conversations/${conversationId}`}>
          打开会话
        </Link>
      ) : null}
    </div>
  );
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
  }[task.job_type] ?? "后台任务";
}

function completedLabel(jobType: string): string {
  return `${taskTypeLabel({ job_type: jobType } as BackgroundTaskRead)}完成`;
}

function taskConversationId(task: BackgroundTaskRead): string | null {
  return task.result.conversation_id ?? task.result.conversation_ids?.[0] ?? null;
}

async function invalidateReaderQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["conversations", "active"] }),
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["project-conversations"] }),
  ]);
}
