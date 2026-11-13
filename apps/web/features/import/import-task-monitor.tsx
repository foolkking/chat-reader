"use client";

import { importFailureMessage } from "./import-workspace-copy";
import { offlineDownloadFailureMessage, offlineGenerationFailureCode } from "../../lib/offline-download-errors";
import { batchExportError, exportNeedsAdjustment } from "../../lib/batch-export-errors";
import { archiveUploadRecovery } from "../../lib/archive-recovery";
import { archiveError } from "../../components/archive-ui";
import { ExportArtifactDelivery } from "../exporting/export-artifact-delivery";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, RefreshCw, X, Eraser } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cancelTask, getActiveTasks, getPendingCleanupScans, getTask, retryTask } from "../../lib/api";
import { contextReturnFailureMessage, contextReturnRecovery } from "../../lib/context-return-recovery";
import type { BackgroundTaskRead, CleanupScanRead } from "../../lib/types";
import { ContentCleanupDialog } from "../conversations/content-cleanup-panel";
import { CleanupDismissAction } from "../conversations/cleanup-dismiss-action";
import { CleanupScanCancelAction, cleanupScanLabel } from "../conversations/cleanup-scan-progress";
import { usePreferences, useTranslations } from "../../components/preferences-provider";
import { SettingsFocusedDialog } from "../../components/settings-focused-dialog";
import { useImportDialog } from "../../components/import-dialog-provider";
import { fullActivityTime } from "../../lib/activity-time";
import { authenticationGeneration } from "../../lib/offline-access";

const taskReadRetryDelay = (attemptIndex: number) => Math.min(5000, 750 * 2 ** attemptIndex);
type TaskControl = {
  action: "retry" | "stop";
  state: "pending" | "unknown" | "rejected" | "checking";
  before: BackgroundTaskRead;
  rejected?: boolean;
};
type TaskControls = Record<string, TaskControl>;

function controlConfirmed(control: TaskControl, current: BackgroundTaskRead) {
  if (control.action === "stop") return current.execution_state === "stopping"
    || ["cancelling", "cancelled", "committed", "failed"].includes(current.status);
  if (needsSourceCleanup(control.before)) {
    const receipt = current.result.source_cleanup;
    return !!receipt && (receipt.state === "completed" || receipt.revision !== control.before.result.source_cleanup?.revision);
  }
  // A heartbeat/update alone is not evidence that a retry was accepted.
  return current.status !== control.before.status
    || current.attempt_count !== control.before.attempt_count
    || current.queued_at !== control.before.queued_at
    || current.started_at !== control.before.started_at;
}

export function ImportTaskMonitor({ placement, forceVisible = false }: { placement: "sidebar" | "mobile" | "center"; forceVisible?: boolean }) {
  const t = useTranslations();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const previousTasks = useRef<BackgroundTaskRead[]>([]);
  const handledTerminalTaskIds = useRef<Set<string>>(new Set());
  const [dismissFeedback, setDismissFeedback] = useState("");
  const dismissFeedbackRef = useRef<HTMLParagraphElement>(null);
  const pendingDismissFocus = useRef<{ row: HTMLElement; next: Element | null } | null>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const scanFocus = useRef<{ element: HTMLElement; id: string } | null>(null);
  const taskFocus = useRef<{ element: HTMLElement; rowId: string; generation: number } | null>(null);
  useLayoutEffect(() => {
    const dismissal = pendingDismissFocus.current;
    if (dismissal && !dismissal.row.isConnected && dismissFeedbackRef.current) {
      pendingDismissFocus.current = null;
      if (document.activeElement === document.body || dismissal.row.contains(document.activeElement)) {
        (dismissal.next?.isConnected ? dismissal.next.querySelector<HTMLElement>("button:not(:disabled)") : dismissFeedbackRef.current)?.focus({ preventScroll: true });
      }
    }
    const previous = scanFocus.current;
    if (previous && !previous.element.isConnected && document.activeElement === document.body) {
      monitorRef.current?.querySelector<HTMLElement>(`[data-cleanup-scan-id="${previous.id}"] button:not(:disabled)`)?.focus({ preventScroll: true });
    }
    const task = taskFocus.current;
    if (task && (task.generation !== authenticationGeneration() || !task.element.isConnected)) {
      taskFocus.current = null;
      // Query notifications can commit after a mutation's animation frame.
      // Recover from the actual DOM replacement, not a guessed paint boundary.
      const replacement = document.getElementById(task.rowId);
      if (task.generation === authenticationGeneration() && document.activeElement === document.body
        && replacement && monitorRef.current?.contains(replacement)) {
        replacement.focus({ preventScroll: true });
      }
    }
  });
  const reviewDismissed = (origin: HTMLElement | null) => {
    const row = origin?.closest<HTMLElement>("[data-cleanup-scan-id]");
    const next = row?.nextElementSibling ?? row?.previousElementSibling;
    pendingDismissFocus.current = row ? { row, next: next ?? null } : null;
    setDismissFeedback(zh ? "本次审查已结束，正文保持不变。" : "This review has ended. Content is unchanged.");
  };
  const generation = authenticationGeneration();
  const controlsKey = useMemo(() => ["task-controls", generation] as const, [generation]);
  // Keep an unconfirmed command across closing/reopening Tasks, but never
  // across an authentication generation. This cache never submits anything.
  const controlsQuery = useQuery<TaskControls>({
    queryKey: controlsKey, queryFn: async () => ({}), enabled: false,
    initialData: {}, staleTime: Infinity, gcTime: Infinity,
  });
  const controls = controlsQuery.data ?? {};
  const tracking = useMemo(() => ({
    generation, active: true,
    unresolved: new Map<string, { task: BackgroundTaskRead; pending: boolean; failed: boolean }>(),
  }), [generation]);
  const [trackingStatus, setTrackingStatus] = useState<{ owner: typeof tracking; checking: boolean; failed: boolean } | null>(null);
  const [trackingAttempt, setTrackingAttempt] = useState(0);
  const trackingError = trackingStatus?.owner === tracking && trackingStatus.failed;
  const checkingTerminal = trackingStatus?.owner === tracking && trackingStatus.checking;
  const [completedTask, setCompletedTask] = useState<BackgroundTaskRead | null>(null);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set());
  const [reviewScanId, setReviewScanId] = useState<string | null>(null);
  useEffect(() => {
    tracking.active = true;
    previousTasks.current = [];
    handledTerminalTaskIds.current.clear();
    setCompletedTask(null);
    return () => { tracking.active = false; };
  }, [tracking]);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem("chat-reader-dismissed-task-ids") ?? "[]");
      setDismissedTaskIds(new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string").slice(-100) : []));
    } catch {
      setDismissedTaskIds(new Set());
    }
  }, []);
  const dismissTask = (taskId: string) => {
    setDismissedTaskIds((current) => {
      const next = new Set([...current, taskId].slice(-100));
      try { window.localStorage.setItem("chat-reader-dismissed-task-ids", JSON.stringify([...next])); }
      catch { /* Optional persistence cannot prevent hiding this page's prompt. */ }
      return next;
    });
  };
  const tasksQuery = useQuery({
    queryKey: ["active-tasks"],
    queryFn: ({ signal }) => getActiveTasks(signal),
    retry: 2,
    retryDelay: taskReadRetryDelay,
    refetchInterval: (query) =>
      query.state.error ? 4000 : query.state.data?.some((task) => ["queued", "processing", "cancelling"].includes(task.status)) ? 1500 : false,
  });
  const scansQuery = useQuery({
    queryKey: ["content-cleanup-pending"],
    queryFn: getPendingCleanupScans,
    retry: 2,
    retryDelay: taskReadRetryDelay,
    refetchInterval: (query) => query.state.error ? 4000 : (query.state.data ?? []).some((scan) => ["QUEUED", "SCANNING"].includes(scan.status)) ? 1500 : 10_000,
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
  const publishControl = (id: string, value?: TaskControl) => {
    if (generation !== authenticationGeneration()) return;
    queryClient.setQueryData<TaskControls>(controlsKey, current => {
      const next = { ...current };
      if (value) next[id] = value; else delete next[id];
      return next;
    });
  };
  const publishTask = (task: BackgroundTaskRead) => {
    if (generation !== authenticationGeneration()) return;
    queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (current = []) => [
      task, ...current.filter(item => item.job_id !== task.job_id),
    ]);
  };
  const runControl = async (task: BackgroundTaskRead, action: TaskControl["action"]) => {
    if (generation !== authenticationGeneration()
      || queryClient.getQueryData<TaskControls>(controlsKey)?.[task.job_id]) return;
    const command: TaskControl = { action, before: task, state: "pending" };
    // Synchronous cache lock also protects two clicks before React re-renders.
    publishControl(task.job_id, command);
    try {
      const result = action === "retry" ? await retryTask(task.job_id)
        : await cancelTask(task.job_id, undefined, task.job_type === "adaptive_import_analysis" ? "retain" : undefined);
      publishTask(result);
      publishControl(task.job_id);
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
      const rejected = status >= 400 && status < 500 && status !== 408;
      publishControl(task.job_id, { ...command, state: rejected ? "rejected" : "unknown", rejected });
    }
  };
  const checkControl = async (task: BackgroundTaskRead) => {
    if (generation !== authenticationGeneration()) return;
    const command = queryClient.getQueryData<TaskControls>(controlsKey)?.[task.job_id];
    if (command?.state === "checking" || command?.state === "pending") return;
    // A cancellation can be acknowledged but not finished. Checking it is
    // still read-only, even when its original response was received normally.
    const checking: TaskControl = command ?? { action: "stop", state: "unknown", before: task };
    publishControl(task.job_id, { ...checking, state: "checking" });
    try {
      const result = await getTask(task.job_id);
      publishTask(result);
      publishControl(task.job_id, checking.rejected || controlConfirmed(checking, result) ? undefined
        : { ...checking, state: "unknown" });
    } catch {
      publishControl(task.job_id, { ...checking, state: "unknown" });
    }
  };
  useEffect(() => {
    if (tasksQuery.isError || generation !== authenticationGeneration()) return;
    for (const task of tasksQuery.data ?? []) {
      const control = queryClient.getQueryData<TaskControls>(controlsKey)?.[task.job_id];
      if (control?.state === "unknown" && controlConfirmed(control, task)) {
        queryClient.setQueryData<TaskControls>(controlsKey, current => {
          const next = { ...current }; delete next[task.job_id]; return next;
        });
      }
    }
  }, [controlsKey, generation, queryClient, tasksQuery.data, tasksQuery.isError]);

  useEffect(() => {
    const generation = tracking.generation;
    const current = tasksQuery.isError ? undefined : tasksQuery.data;
    const previousById = new Map([
      ...[...tracking.unresolved.values()].map(entry => entry.task),
      ...previousTasks.current,
    ].map((task) => [task.job_id, task]));
    const currentIds = new Set((current ?? []).map((task) => task.job_id));
    const disappeared = current ? previousTasks.current.filter(
      (task) => ["queued", "processing", "cancelling"].includes(task.status) && !currentIds.has(task.job_id),
    ) : [];
    // Never use the query-owned array as mutable recovery storage.
    if (current) previousTasks.current = [...current];
    for (const task of current ?? []) tracking.unresolved.delete(task.job_id);
    for (const task of disappeared) {
      if (!tracking.unresolved.has(task.job_id)) tracking.unresolved.set(task.job_id, { task, pending: false, failed: false });
    }
    const currentOwner = () => tracking.active && generation === authenticationGeneration();
    const publishTracking = () => {
      if (currentOwner()) setTrackingStatus({
        owner: tracking,
        checking: [...tracking.unresolved.values()].some(item => item.pending),
        failed: [...tracking.unresolved.values()].some(item => item.failed),
      });
    };
    const handleTerminal = (result: BackgroundTaskRead) => {
        if (!currentOwner()) return;
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
    for (const task of current ?? []) {
      const previous = previousById.get(task.job_id);
      if (previous && !isTerminalTask(previous) && isTerminalTask(task)) handleTerminal(task);
    }
    for (const [id, entry] of tracking.unresolved) {
      if (entry.pending) continue;
      entry.pending = true; entry.failed = false;
      void getTask(id).then(result => {
        if (!currentOwner() || tracking.unresolved.get(id) !== entry) return;
        if (isTerminalTask(result)) {
          tracking.unresolved.delete(id);
          handleTerminal(result);
        } else {
          entry.task = result;
          entry.failed = true; // The final result is still unconfirmed.
        }
      }).catch(() => {
        if (currentOwner() && tracking.unresolved.get(id) === entry) entry.failed = true;
      }).finally(() => {
        entry.pending = false;
        publishTracking();
      });
    }
    publishTracking();
  }, [queryClient, tasksQuery.data, tasksQuery.isError, tracking, trackingAttempt]);

  const listedTasks = tasksQuery.data ?? [];
  const retainedControls = Object.values(controls).map(control => control.before)
    .filter(task => !listedTasks.some(current => current.job_id === task.job_id));
  const allTasks = [...listedTasks, ...retainedControls].filter((task) => !dismissedTaskIds.has(task.job_id) || (placement === "center" && (needsFileCleanup(task) || controls[task.job_id])));
  const noiseTasks = allTasks.filter((task) => task.job_type === "content_noise_scan" && !["committed", "cancelled"].includes(task.status));
  const tasks = allTasks.filter((task) => task.job_type !== "content_noise_scan" || task.result.cleanup_apply?.status === "COMPLETED");
  const taskRows = completedTask && !dismissedTaskIds.has(completedTask.job_id) && !tasks.some((task) => task.job_id === completedTask.job_id)
    ? [...tasks, completedTask]
    : tasks;
  const processingTasks = taskRows.filter((task) => ["queued", "processing", "cancelling"].includes(task.status));
  const failedTasks = taskRows.filter((task) => task.status === "failed");
  const cleanupTasks = taskRows.filter((task) => needsSourceCleanup(task) || task.status === "committed" && (needsAccountCleanup(task) || hasItemFailures(task)));
  const completedTasks = taskRows.filter((task) => task.status === "committed" && !needsAccountCleanup(task) && !hasItemFailures(task));
  const cancelledTasks = taskRows.filter((task) => task.status === "cancelled" && !needsSourceCleanup(task));
  const visibleTask = processingTasks.find((task) => task.status === "processing")
    ?? processingTasks[0]
    ?? (placement === "mobile" ? completedTask : null);
  const allScans = scansQuery.data ?? [];
  const scans = allScans.filter(scan => scan.status === "STALE" || (scan.status === "READY" && scan.occurrence_count > 0));
  const scanningScans = allScans.filter(scan => ["QUEUED", "SCANNING", "APPLYING"].includes(scan.status));
  const failedScans = allScans.filter(scan => scan.status === "FAILED");
  const cancelledScans = allScans.filter(scan => scan.status === "CANCELLED" && allTasks.some(task => task.job_id === scan.background_job_id && task.status === "cancelled"));
  const activeNoiseTasks = noiseTasks.filter(task => task.status !== "failed");
  const failedNoiseTasks = noiseTasks.filter(task => task.status === "failed");
  const unboundNoiseCount = noiseTasks.filter(task => !allScans.some(scan => scan.background_job_id === task.job_id)).length;
  // Zero-result scans are informative completions, never attention reminders.
  // Only retained terminal tasks qualify; old pending rows must not become a
  // new unbounded completed-history list.
  const emptyScans = (scansQuery.data ?? []).filter(scan => scan.status === "READY" && scan.occurrence_count === 0
    && allTasks.some(task => task.job_id === scan.background_job_id && task.status === "committed"));
  const loadRecovering = (tasksQuery.isError && Boolean(tasksQuery.data)) || (scansQuery.isError && Boolean(scansQuery.data));
  const loadFailed = (tasksQuery.isError && !tasksQuery.data) || (scansQuery.isError && !scansQuery.data) || trackingError;
  const loadUnavailable = loadFailed || loadRecovering;
  const loading = tasksQuery.isLoading || scansQuery.isLoading || checkingTerminal;
  const retryLoading = () => { setTrackingAttempt(value => value + 1); void tasksQuery.refetch(); void scansQuery.refetch(); };
  const count = taskRows.length + scans.length + scanningScans.length + failedScans.length + unboundNoiseCount + (placement === "center" ? emptyScans.length + cancelledScans.length : 0);
  if (!visibleTask && !noiseTasks.length && !scans.length && !scanningScans.length && !failedScans.length && !loadUnavailable && !checkingTerminal && !forceVisible) return null;

  if (placement !== "center") {
    return <div className={placement === "mobile" ? "fixed bottom-[max(.75rem,env(safe-area-inset-bottom))] right-3 z-40 max-w-[calc(100vw-1.5rem)] md:hidden" : "mb-3"}>
      <button type="button" onClick={() => window.dispatchEvent(new Event("chat-reader:open-task-center"))} data-testid="task-summary-button" className="flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-ui bg-raised px-3 py-2 text-left text-xs text-primary shadow-sm">
        <RefreshCw className={`h-4 w-4 shrink-0 text-accent ${!loadUnavailable && !checkingTerminal && (processingTasks.length || scanningScans.some(scan => scan.background_job_status === "processing")) ? "animate-spin" : ""}`} aria-hidden="true" />
        <span className="min-w-0 truncate">{loadUnavailable ? (zh ? "任务状态暂不可用" : "Task status unavailable") : checkingTerminal ? (zh ? "正在确认任务结果" : "Checking task results") : visibleTask ? `${taskTypeLabel(visibleTask, zh)} · ${isTerminalTask(visibleTask) ? phaseLabel(visibleTask, zh) : `${visibleTask.progress}%`}` : scanningScans.length ? cleanupScanLabel(scanningScans[0], zh) : (zh ? `${count} 项任务待查看` : `${count} tasks to review`)}</span>
      </button>
    </div>;
  }

  if (placement === "center") {
    const taskRow = (task: BackgroundTaskRead) => (
      <div key={task.job_id} id={`task-row-${task.job_id}`} tabIndex={-1} data-task-row={task.job_type} className="px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]">
        <TaskContent task={task} busy={Boolean(controls[task.job_id])} control={controls[task.job_id]}
          onCheck={() => { void checkControl(task); }}
          onRetry={() => { void runControl(task, "retry"); }}
          onCancel={() => { void runControl(task, "stop"); }}
          onDismiss={isTerminalTask(task) && !needsFileCleanup(task) && !controls[task.job_id] ? () => dismissTask(task.job_id) : undefined} />
      </div>
    );
    return (
      <div ref={monitorRef} className="space-y-4" aria-label={t("tasks")} onFocusCapture={event => {
        const taskRow = event.target.closest<HTMLElement>("[data-task-row]");
        taskFocus.current = taskRow ? { element: event.target, rowId: taskRow.id, generation: authenticationGeneration() } : null;
        const row = event.target.closest<HTMLElement>("[data-cleanup-scan-id]");
        // Result dismissal owns its separate adjacent-row/notice restoration.
        const id = row && ["QUEUED", "SCANNING"].includes(row.dataset.cleanupScanStatus ?? "") ? row.dataset.cleanupScanId : null;
        scanFocus.current = id ? { element: event.target, id } : null;
      }} onBlurCapture={event => {
        // A deliberate move to another control retires this restoration, even
        // if that control is outside the monitor (for example, dialog Close).
        if (event.relatedTarget && event.relatedTarget !== document.body) taskFocus.current = null;
      }}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-secondary">{zh ? "任务进度与结果" : "Progress and results"}</span>
          <span className="text-xs tabular-nums text-secondary">{count} {zh ? "项" : "items"}</span>
        </div>
        {loading ? <p role="status" className="text-sm text-secondary">{checkingTerminal ? (zh ? "正在确认任务结果…" : "Checking task results…") : (zh ? "正在加载任务…" : "Loading tasks…")}</p> : null}
        {loadUnavailable ? <div role={loadFailed ? "alert" : "status"} className={loadFailed ? "border-l-2 border-[var(--danger)] pl-3 text-sm text-[var(--danger)]" : "text-sm text-secondary"}>
          <p>{trackingError ? (zh ? "有任务的最终结果尚未确认，请重新检查；不会重新提交任务。" : "A task's final result is unconfirmed. Retry checks its status without resubmitting it.") : loadFailed ? (zh ? "任务状态加载失败，已有任务可能仍在运行。" : "Could not load task status. Existing tasks may still be running.") : (zh ? "暂时无法刷新任务状态，当前显示上次结果；最新进度尚未确认。" : "Could not refresh task status. Previous results are shown; current progress is unconfirmed.")}</p>
          <button type="button" disabled={tasksQuery.isFetching || scansQuery.isFetching || checkingTerminal} onClick={retryLoading} className="min-h-11 underline">{zh ? "重试" : "Retry"}</button>
        </div> : null}
        {dismissFeedback ? <p ref={dismissFeedbackRef} tabIndex={-1} role="status" className="text-xs text-secondary outline-none">{dismissFeedback}</p> : null}
        {!loading && !loadUnavailable && !count ? <div className="rounded-lg border border-dashed border-ui px-4 py-8 text-center text-sm text-secondary">{t("noActiveTasks")}</div> : null}
        <TaskSection title={zh ? "处理中" : "In progress"} count={processingTasks.length + Math.max(scanningScans.length, activeNoiseTasks.length)}>{processingTasks.map(taskRow)}<NoiseReviewSummary scans={scanningScans} tasks={activeNoiseTasks} onReview={setReviewScanId} onDismissed={reviewDismissed} /></TaskSection>
        <TaskSection title={zh ? "失败" : "Failed"} count={failedTasks.length + Math.max(failedScans.length, failedNoiseTasks.length)}>{failedTasks.map(taskRow)}<NoiseReviewSummary scans={failedScans} tasks={failedNoiseTasks} onReview={setReviewScanId} onDismissed={reviewDismissed} /></TaskSection>
        <TaskSection title={zh ? "需要处理" : "Needs attention"} count={scans.length + cleanupTasks.length}>
          {cleanupTasks.map(taskRow)}
          <NoiseReviewSummary scans={scans} tasks={[]} onReview={setReviewScanId} onDismissed={reviewDismissed} />
        </TaskSection>
        <TaskSection title={zh ? "已完成" : "Completed"} count={completedTasks.length + emptyScans.length}>{completedTasks.map(taskRow)}<NoiseReviewSummary scans={emptyScans} tasks={allTasks} onReview={setReviewScanId} onDismissed={reviewDismissed} resultsOnly /></TaskSection>
        <TaskSection title={zh ? "已取消" : "Cancelled"} count={cancelledTasks.length + cancelledScans.length}>{cancelledTasks.map(taskRow)}<NoiseReviewSummary scans={cancelledScans} tasks={allTasks} onReview={setReviewScanId} onDismissed={reviewDismissed} resultsOnly /></TaskSection>
        {reviewScanId ? <NoiseReviewDialog scanId={reviewScanId} onClose={() => { setReviewScanId(null); void queryClient.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}
      </div>
    );
  }

  return null;
}

function TaskSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return <section aria-label={title}><div className="mb-2 flex items-center justify-between px-1"><h3 className="text-xs font-semibold text-primary">{title}</h3><span className="text-[11px] tabular-nums text-secondary">{count}</span></div><div className="divide-y divide-ui overflow-hidden rounded-xl border border-ui bg-surface ">{children}</div></section>;
}

function NoiseReviewSummary({ scans, tasks, onReview, onDismissed, busy = false, resultsOnly = false }: { busy?: boolean; resultsOnly?: boolean; scans: CleanupScanRead[]; tasks: BackgroundTaskRead[]; onReview: (id: string) => void; onDismissed: (origin: HTMLElement | null) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const visible = scans;
  const scanIds = new Set(visible.map((scan) => scan.id));
  const scanJobIds = new Set(visible.map(scan => scan.background_job_id));
  const pendingTasks = resultsOnly ? [] : tasks.filter(task => !scanJobIds.has(task.job_id) && (!task.result.scan_id || !scanIds.has(task.result.scan_id)));
  if (!visible.length && !pendingTasks.length) return null;
  return (
    <div className="divide-y divide-[var(--border)]" aria-label={zh ? "噪声审查" : "Noise reviews"}>
      {pendingTasks.map((task) => <div key={task.job_id} className="px-4 py-3"><TaskContent task={task} compact /></div>)}
      {visible.map((scan) => {
        const task = tasks.find((item) => item.job_id === scan.background_job_id || item.result.scan_id === scan.id);
        return (
          <div key={scan.id} data-cleanup-scan-id={scan.id} data-cleanup-scan-status={scan.status} className="px-4 py-3 text-xs text-primary">
            <p className="flex items-center gap-1.5 font-medium">
              <Eraser className="h-3.5 w-3.5 text-accent" />
              {scan.status === "READY" ? (scan.occurrence_count === 0 ? (zh ? "当前规则未发现噪声候选" : "No noise candidates found with the current rules") : (zh ? `${scan.occurrence_count} 个噪声候选待审查` : `${scan.occurrence_count} noise candidates ready for review`)) : ["FAILED", "STALE"].includes(scan.status) ? (zh ? "噪声扫描需要重试" : "Noise scan needs retry") : cleanupScanLabel(scan, zh)}
            </p>
            <p className="mt-1 text-[11px] text-secondary">
              {task?.result.parent_task_id ? (zh ? "导入后扫描 · " : "Import follow-up · ") : ""}{scan.target_count} {zh ? "个对话" : "conversations"} · {scan.processed_messages}/{scan.total_messages} {zh ? "条消息" : "messages"}
            </p>
            {["QUEUED", "SCANNING"].includes(scan.status) ? <div role="progressbar" aria-label={zh ? "噪声扫描" : "Noise scan"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={scan.progress} className="mt-2 h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${scan.progress}%` }} /></div> : null}
            <div className="mt-2 flex flex-wrap items-start gap-3">
              <button type="button" onClick={() => onReview(scan.id)} disabled={busy || scan.status === "APPLYING"} className="min-h-11 font-medium text-accent underline disabled:opacity-50">{resultsOnly ? (zh ? "查看结果" : "View result") : ["QUEUED", "SCANNING"].includes(scan.status) ? (zh ? "查看进度" : "View progress") : (zh ? "打开审查" : "Open review")}</button>
              {["QUEUED", "SCANNING"].includes(scan.status) ? <CleanupScanCancelAction scan={scan} /> : <CleanupDismissAction scan={scan} onDismissed={onDismissed} disabled={busy} />}
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

function needsSourceCleanup(task: BackgroundTaskRead): boolean {
  return task.job_type === "import" && task.status === "cancelled"
    && !!task.result.source_cleanup && ["pending", "failed", "blocked"].includes(task.result.source_cleanup.state);
}

function needsFileCleanup(task: BackgroundTaskRead): boolean {
  return needsAccountCleanup(task) || needsSourceCleanup(task);
}

function hasItemFailures(task: BackgroundTaskRead): boolean {
  return Array.isArray(task.result.failed) && task.result.failed.length > 0;
}

function TaskContent({ task, compact = false, onRetry, onCancel, onDismiss, onCheck, control, busy = false }: { busy?: boolean; task: BackgroundTaskRead; compact?: boolean; onRetry?: () => void; onCancel?: () => void; onDismiss?: () => void; onCheck?: () => void; control?: TaskControl }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const { openImportDialog } = useImportDialog();
  const [userOpen, setUserOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [stopUnconfirmed, setStopUnconfirmed] = useState(false);
  useEffect(() => {
    setStopUnconfirmed(false);
    if (task.status !== "cancelling" && task.execution_state !== "stopping") return;
    const stopTime = task.stop_requested_at ?? task.cancellation_requested_at;
    const requested = stopTime ? Date.parse(stopTime) : Date.now();
    const elapsed = Number.isFinite(requested) ? Math.max(0, Date.now() - requested) : 0;
    const timer = window.setTimeout(() => setStopUnconfirmed(true), Math.max(0, 30_000 - elapsed));
    return () => window.clearTimeout(timer);
  }, [task.job_id, task.status, task.cancellation_requested_at, task.execution_state, task.stop_requested_at]);
  const offlineTrigger = useRef<HTMLButtonElement>(null);
  const userTrigger = useRef<HTMLButtonElement>(null);
  const accountDelete = task.job_type === "user_account_delete";
  const accountDeleted = accountDelete && task.result.account_deleted === true;
  const cleanupPending = accountDeleted && Number(task.result.asset_cleanup_pending) > 0;
  const sourceCleanupPending = needsSourceCleanup(task);
  const failed = task.status === "failed";
  const exportAdjustment = failed && exportNeedsAdjustment(task.error_message);
  const analysisAdjustment = task.job_type === "adaptive_import_analysis" && task.failure?.retryable === false;
  const contextRecovery = contextReturnRecovery(task);
  const contextAdjustment = contextRecovery && contextRecovery.action !== "retry";
  const archiveTask = /^(personal|system)_archive_/.test(task.job_type);
  const committed = task.status === "committed";
  const conversationId = taskConversationId(task);
  const itemFailures = Array.isArray(task.result.failed) ? task.result.failed.length : 0;
  const completedItems = taskCompletedItems(task);
  const partial = committed && itemFailures > 0;
  const active = ["queued", "processing", "cancelling"].includes(task.status);
  const progress = Math.max(0, Math.min(100, task.progress));
  const format = taskFormatLabel(task, zh);
  const source = task.source_label ?? (task.job_type === "import" ? task.label : null);
  const timestamp = task.queued_at;
  const validTimestamp = timestamp && Number.isFinite(Date.parse(timestamp));
  return (
    <div className="min-w-0 text-xs text-secondary" data-testid={`task-${task.job_type}-${task.status}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-primary">{taskTypeLabel(task, zh)}</p>
          {format ? <span className="rounded border border-ui px-1.5 py-0.5 text-xs">{format}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active && task.phase !== "waiting_resources" ? <span className="tabular-nums">{progress}%</span> : null}
          {onDismiss ? <button type="button" data-testid={`task-dismiss-${task.job_id}`} onClick={onDismiss} className="-my-2 inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-subtle" aria-label={zh ? "关闭任务提示" : "Dismiss task"} title={zh ? "关闭任务提示" : "Dismiss task"}><X className="h-4 w-4" /></button> : null}
        </div>
      </div>
      {source ? <p className="mt-1 break-words text-sm text-primary">{source}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={failed ? "text-[var(--danger)]" : partial || cleanupPending || sourceCleanupPending ? "text-[var(--warning)]" : ""}>{task.execution_state === "stopping" ? (zh ? "正在停止并核对结果" : "Stopping and checking outcome") : partial ? (zh ? "部分完成" : "Partially completed") : phaseLabel(task, zh)}</span>
        {validTimestamp ? <time dateTime={timestamp} title={fullActivityTime(timestamp, resolvedLocale)} aria-label={`${zh ? "提交于" : "Submitted"} ${fullActivityTime(timestamp, resolvedLocale)}`} className="tabular-nums">{new Intl.DateTimeFormat(resolvedLocale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(timestamp))}</time> : null}
        {task.total_items > 0 && (active || task.total_items > 1) ? <span className="tabular-nums">{task.processed_items} / {task.total_items}</span> : null}
      </div>
      {active ? <div role="progressbar" aria-label={taskTypeLabel(task, zh)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${phaseLabel(task, zh)} · ${progress}%`} className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div> : null}
      {task.phase === "waiting_resources" ? <p role="status" className="mt-2 leading-5">{zh
        ? "自动间隔检查资源，累计最多等待 30 分钟；原文件和已完成处理保留，无需重新上传。"
        : "Automatically checking resources, for up to 30 minutes of total waiting. Sources and completed work are retained; no re-upload is needed."}</p> : null}
      {failed ? (
        <div className="mt-2">
          <p className="break-words whitespace-pre-wrap text-[var(--danger)]">{taskFailureMessage(task, zh)}</p>
          {onRetry && !exportAdjustment && !analysisAdjustment && !contextAdjustment && task.job_type !== "context_validation" && task.job_type !== "offline_package" && !archiveUploadRecovery(task) ? (
            <button type="button" disabled={busy} onClick={onRetry} className="mt-1 inline-flex min-h-11 min-w-11 items-center gap-1 font-medium text-[var(--danger)] underline">
              <RefreshCw className="h-3.5 w-3.5" /> {zh ? "重试" : "Retry"}
            </button>
          ) : null}
        </div>
      ) : null}
      {contextAdjustment ? <Link href={contextRecovery.conversation_id
        ? `/conversations/${encodeURIComponent(contextRecovery.conversation_id)}?continuation=current` : "/"}
        onClick={event => {
          if (contextRecovery.conversation_id && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
            const request = new CustomEvent("chat-reader:open-continuation", {
              cancelable: true, detail: { conversationId: contextRecovery.conversation_id },
            });
            if (!window.dispatchEvent(request)) event.preventDefault();
          }
          window.dispatchEvent(new Event("chat-reader:close-task-center"));
        }}
        className="inline-flex min-h-11 min-w-11 items-center font-medium text-accent underline">
        {contextRecovery.conversation_id ? (zh ? "打开接续文件" : "Open continuation files") : (zh ? "返回对话列表" : "Return to conversations")}
      </Link> : null}
      {exportAdjustment ? <Link href={conversationId ? `/conversations/${conversationId}` : "/"} onClick={() => window.dispatchEvent(new Event("chat-reader:close-task-center"))} className="inline-flex min-h-11 items-center font-medium text-accent underline">
        {conversationId ? (zh ? "返回对话调整导出" : "Return to the conversation to adjust export") : (zh ? "返回列表调整导出" : "Return to the list to adjust export")}
      </Link> : null}
      {cleanupPending && !failed ? <div className="mt-2 text-[var(--warning)]" role="status"><p>{zh ? `账户已删除，仍有 ${Number(task.result.asset_cleanup_pending)} 个文件待清理。` : `Account deleted. ${Number(task.result.asset_cleanup_pending)} files still need cleanup.`}</p>{committed && onRetry ? <button type="button" disabled={busy} onClick={onRetry} className="min-h-11 font-medium underline">{zh ? "重试文件清理" : "Retry file cleanup"}</button> : null}</div> : null}
      {sourceCleanupPending ? <div className="mt-2 text-[var(--warning)]" role="status">
        <p>{task.result.source_cleanup?.state === "blocked"
          ? (zh ? "导入已取消。来源存储位置需管理员检查，确认后可重试清理。" : "Import cancelled. Ask an administrator to check the source storage location before retrying cleanup.")
          : (zh ? "导入已取消，临时来源仍待清理。不影响继续导入其他文件。" : "Import cancelled; temporary sources still need cleanup. You can import other files.")}</p>
        {onRetry ? <button type="button" disabled={busy} onClick={onRetry} className="min-h-11 font-medium underline">{zh ? "重试文件清理" : "Retry file cleanup"}</button> : null}
      </div> : null}
      {partial ? <p className="mt-2 text-[var(--warning)]" role="status">{zh ? `${completedItems} \u9879\u5b8c\u6210 \u00b7 ${itemFailures} \u9879\u5931\u8d25` : `${completedItems} completed \u00b7 ${itemFailures} failed`}</p> : null}
      {control ? <div className="mt-2 border-l-2 border-ui pl-3" role="status">
        <p>{control.state === "pending" ? (zh ? "正在提交操作…" : "Submitting…")
          : control.state === "checking" ? (zh ? "正在核对原任务…" : "Checking the original task…")
          : control.state === "rejected" ? (zh ? "服务器未接受本次操作。请刷新任务状态后再选择。" : "The server did not accept this action. Check the current task before choosing again.")
          : (zh ? "操作结果尚未确认；不会自动重发，也不影响其他任务。" : "The result is unconfirmed. Nothing is resubmitted and other tasks remain available.")}</p>
        {onCheck && control.state !== "pending" ? <button type="button" disabled={control.state === "checking"} onClick={onCheck} className="min-h-11 font-medium text-accent underline">{zh ? "核对状态" : "Check status"}</button> : null}
      </div> : null}
      {(task.status === "cancelling" || task.execution_state === "stopping") && !control ? <div className="mt-2 text-[var(--warning)]" role="status">
        <p>{stopUnconfirmed ? (zh ? "停止尚未确认。可以核对状态或处理其他文件，不必退出账户。" : "Stopping is not yet confirmed. Check status or work on other files; signing out is unnecessary.")
          : task.execution_state === "stopping" ? (zh ? "正在等待执行退出并核对结果，队列尚未释放。" : "Waiting for execution exit and outcome checks; the queue is not released yet.")
          : (zh ? (task.job_type === "conversation_batch_delete" ? "正在完成当前删除，随后停止后续项目…" : "正在等待安全停止…") : "Waiting for a safe stop…")}</p>
        {stopUnconfirmed && onCheck && !control ? <button type="button" onClick={onCheck} className="min-h-11 font-medium underline">{zh ? "核对状态" : "Check status"}</button> : null}
      </div> : null}
      {task.cancellable && task.status !== "cancelling" && task.execution_state !== "stopping" && onCancel ? (
        <button type="button" disabled={busy} onClick={onCancel} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)]">
          <Ban className="h-3.5 w-3.5" />{task.job_type === "adaptive_import_analysis" ? (zh ? "停止并保留" : "Stop and retain") : (task.job_type.startsWith("personal_archive_") || task.job_type.startsWith("system_archive_")) ? (zh ? "取消归档任务" : "Cancel archive task") : task.job_type === "conversation_batch_delete" ? (zh ? "停止后续删除" : "Stop remaining deletions") : task.job_type === "conversation_merge" ? (zh ? "取消合并" : "Cancel merge") : task.job_type === "offline_package" ? (zh ? "取消服务器生成" : "Cancel server generation") : (zh ? "取消任务" : "Cancel task")}
        </button>
      ) : null}
      {task.job_type === "adaptive_import_analysis" && typeof task.result.import_id === "string" && (task.status !== "cancelled" || task.result.source_retained === true) ? <button type="button" className="mt-2 min-h-11 font-medium text-accent underline underline-offset-2" onClick={() => {
        window.dispatchEvent(new Event("chat-reader:close-task-center"));
        openImportDialog({ resumeImportId: String(task.result.import_id) });
      }}>{task.result.source_retained === true ? (zh ? "查看保留来源并继续" : "Review retained sources & continue") : zh ? (committed ? "查看分析结果并继续导入" : "查看导入分析") : (committed ? "Review analysis & continue importing" : "View import analysis")}</button> : null}
      {accountDelete && !accountDeleted && !committed && typeof task.result.target_user_id === "string" ? <button ref={userTrigger} className="min-h-11 font-medium text-accent underline" onClick={() => setUserOpen(true)}>{zh ? "查看账户与删除状态" : "Review account deletion"}</button> : null}
      {userOpen ? <SettingsFocusedDialog category="admin-users" initialAdminUserId={String(task.result.target_user_id)} onClose={() => setUserOpen(false)} restoreFocus={() => userTrigger.current} /> : null}
      {task.job_type === "offline_package" ? <button ref={offlineTrigger} type="button" className="min-h-11 font-medium text-accent underline underline-offset-2" onClick={() => setOfflineOpen(true)}>{failed ? (zh ? "处理离线下载" : "Resolve offline download") : (zh ? "查看离线下载" : "View offline download")}</button> : null}
      {offlineOpen ? <SettingsFocusedDialog category="offline" initialOfflineJobId={task.job_id} initialOfflineTarget={task.offline_target} onClose={() => setOfflineOpen(false)} restoreFocus={() => offlineTrigger.current} /> : null}
      {task.result.cleanup_apply?.status === "COMPLETED" && task.result.scan_id ? <>
        <p className="mt-2">{zh ? `已删除 ${task.result.cleanup_apply.applied} 个片段。` : `${task.result.cleanup_apply.applied} fragments removed.`}</p>
        <button type="button" className="min-h-11 font-medium text-accent underline" onClick={() => setCleanupOpen(true)}>{zh ? "查看清理结果" : "View cleanup result"}</button>
        {cleanupOpen ? <NoiseReviewDialog scanId={task.result.scan_id} onClose={() => setCleanupOpen(false)} /> : null}
      </> : null}
      {task.job_type !== "offline_package" && (committed || archiveTask && (failed || task.status === "cancelled")) ? <TaskResultActions task={task} conversationId={conversationId} compact={compact} zh={zh} /> : null}
    </div>
  );
}

function taskFailureMessage(task: BackgroundTaskRead, zh: boolean): string {
  const raw = task.error_message ?? "";
  if (raw === "TASK_STALLED") return zh ? "处理长时间未推进，已停止并保留来源。可调整输入后重试。" : "Processing stopped after making no progress. Sources are retained; adjust the input and retry.";
  if (raw === "TASK_EXECUTION_INTERRUPTED") return zh ? "执行被中断，已核对服务端结果。未完成的任务可重试。" : "Execution was interrupted and the server outcome checked. Unfinished work can be retried.";
  if (task.job_type === "adaptive_import_analysis" || task.job_type === "import") {
    const importFailure = importFailureMessage(
      task.failure ?? task.result.failure, raw,
      task.job_type === "import" ? "commit" : "analysis", zh,
    );
    if (importFailure) return importFailure;
  }
  const accountDelete = task.job_type === "user_account_delete";
  const accountDeleted = accountDelete && task.result.account_deleted === true;
  if (accountDelete) {
    return accountDeleted
      ? (zh ? "账户已删除，剩余文件清理失败，可重试清理。" : "Account deleted. Remaining file cleanup failed; retry cleanup.")
      : (zh ? "删除失败，资料已保留。可查看账户并重试。" : "Deletion failed. Data retained; review the account and retry.");
  }
  if (task.job_type === "offline_package") return offlineDownloadFailureMessage(offlineGenerationFailureCode(raw), zh, false);
  if (task.job_type === "context_validation") return zh ? "此流程已停用，请在上下文接续中直接更新文件。" : "This workflow is retired. Update files directly in Context continuation.";
  if (task.job_type === "conversation_batch_export" || /^(PLAIN|ATTACHMENT|CONTEXT)_EXPORT_/.test(raw)) return batchExportError(raw, zh);
  if (/^(?:personal|system)_archive_/.test(task.job_type)) return archiveError(raw, zh);

  const detail = raw.toLocaleLowerCase();
  const conflict = /conflict|changed|revision|stale|并发|变化|冲突/.test(detail);
  const limit = /too large|too many|limit|exceed|超过|限制|过大/.test(detail);
  const temporary = /connection|network|timeout|temporarily|service unavailable|fetch|连接|网络|超时|暂时不可用/.test(detail);
  const unavailable = !temporary && /not found|no longer|unavailable|deleted|removed|不存在|不可用|已删除|已移除/.test(detail);

  if (task.job_type === "conversation_export") {
    if (limit) return zh ? "导出内容超过当前限制，请减少范围或附件后重试。" : "The export exceeds the current limit. Reduce the scope or attachments and retry.";
    if (unavailable) return zh ? "导出所需的对话或附件已不可用，请重新打开对话后重试。" : "A conversation or attachment needed for export is unavailable. Reopen the conversation and retry.";
    if (temporary) return zh ? "导出暂时未完成，请检查连接后重试。" : "The export did not finish. Check the connection and retry.";
    return zh ? "导出未完成，请在任务中心核对后重试。" : "The export did not finish. Check the task result and retry.";
  }
  if (task.job_type === "conversation_merge") {
    if (conflict) return zh ? "合并未完成，对话刚刚发生变化。请重新打开后核对再重试。" : "Merge did not finish because the conversations changed. Reopen them, review, and retry.";
    if (limit) return zh ? "合并内容超过当前限制，请减少消息范围后重试。" : "The merge exceeds the current limit. Reduce the message range and retry.";
    if (unavailable) return zh ? "参与合并的对话已不可用，请重新打开列表后核对。" : "A conversation in the merge is unavailable. Reopen the list and review it.";
    return zh ? "合并未完成，请核对原对话后重试。" : "The merge did not finish. Review the original conversations and retry.";
  }
  if (task.job_type === "conversation_batch_delete") {
    if (conflict || unavailable) return zh ? "部分对话状态已变化，批量删除未完成。请刷新归档列表后核对。" : "Some conversations changed state, so batch deletion did not finish. Refresh the archive list and review it.";
    return zh ? "批量删除未完成，请刷新归档列表后核对再重试。" : "Batch deletion did not finish. Refresh the archive list, review it, and retry.";
  }
  if (task.job_type === "content_noise_scan") return zh ? "噪声扫描未完成，未应用清理。请重新扫描。" : "The noise scan did not finish; no cleanup was applied. Scan again.";
  if (task.job_type === "adaptive_import_analysis") {
    return zh ? "文件分析未完成，尚未导入对话。源文件仍保留，可重试或打开导入分析。" : "File analysis did not finish; conversations have not been imported. Source files are retained. Retry or open the import analysis.";
  }
  if (task.job_type === "conversation_auto_clean") return zh ? "对话清理未完成，请重新打开对话核对后重试。" : "Conversation cleanup did not finish. Reopen the conversation, review it, and retry.";
  if (task.job_type === "import") return zh ? "导入未完成，请检查源文件和任务状态后重试。" : "The import did not finish. Check the source files and task status, then retry.";
  if (task.job_type === "context_return") return contextReturnFailureMessage(task, zh);
  if (task.job_type === "context_package_export") return zh ? "上下文包导出未完成，请核对附件和任务状态后重试。" : "The Context Package export did not finish. Check attachments and the task status, then retry.";
  if (task.job_type === "attachment_batch_download") return zh ? "附件下载未完成，请检查附件状态后重试。" : "The attachment download did not finish. Check the attachment status and retry.";
  return zh ? "后台任务未完成，请查看任务状态后重试。" : "The background task did not finish. Check its status and retry.";
}

function TaskResultActions({ task, conversationId, compact, zh }: { task: BackgroundTaskRead; conversationId: string | null; compact: boolean; zh: boolean }) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  const conversationIds = Array.isArray(task.result.conversation_ids) ? task.result.conversation_ids : [];
  const importIds = task.job_type === "import" ? conversationIds : [];
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${compact ? "text-[11px]" : "text-xs"}`} data-testid={`task-result-${task.job_type}`}>
      {task.status === "failed" && task.job_type === "offline_package" && task.result.offline_failure ? <div className="w-full space-y-1">
        <p>{zh ? `预检发现 ${task.result.offline_failure.affected_count} 项文件依赖不可用；请先修复再重试。` : `Preflight found ${task.result.offline_failure.affected_count} unavailable dependencies. Repair before retrying.`}</p>
        {task.result.offline_failure.affected.slice(0, 20).map((item, index) => <Link key={item.conversation_id}
          className="mr-3 inline-flex min-h-11 items-center text-accent underline" href={`/conversations/${encodeURIComponent(item.conversation_id)}`}>
          {zh ? `查看受影响对话 ${index + 1}` : `Review affected conversation ${index + 1}`}
        </Link>)}
      </div> : null}
      {(task.job_type.startsWith("personal_archive_") || task.job_type.startsWith("system_archive_")) ? <button ref={archiveTrigger} type="button" className="min-h-11 font-medium text-accent underline underline-offset-2" onClick={() => setArchiveOpen(true)}>{task.status === "failed" || task.status === "cancelled" ? (zh ? "处理归档问题" : "Review archive problem") : task.job_type.endsWith("_archive_preflight") ? (zh ? "查看预检并恢复" : "Review preview & restore") : (zh ? "查看归档详情" : "View archive details")}</button> : null}
      {archiveOpen ? <SettingsFocusedDialog category={task.job_type.startsWith("system_archive_") ? "admin-system" : "data"} initialArchiveTaskId={task.job_id} onClose={() => setArchiveOpen(false)} restoreFocus={() => archiveTrigger.current} /> : null}
      {task.status === "committed" ? <>
      {task.result.artifact_id && ["conversation_export", "conversation_batch_export", "context_package_export", "attachment_batch_download", "personal_archive_export", "system_archive_export"].includes(task.job_type) ? <ExportArtifactDelivery artifactId={task.result.artifact_id} scope="tasks" /> : task.result.download_url ? <a data-testid="task-result-download" className="font-medium text-accent underline underline-offset-2" href={String(task.result.download_url)}>{zh ? "\u4e0b\u8f7d\u7ed3\u679c" : "Download result"}</a> : null}
      {conversationId && importIds.length <= 1 ? <Link data-testid="task-result-conversation" className="font-medium text-accent underline underline-offset-2" href={`/conversations/${conversationId}`}>{zh ? (task.job_type === "conversation_merge" ? "\u6253\u5f00\u5408\u5e76\u540e\u7684\u5bf9\u8bdd" : "\u6253\u5f00\u5bf9\u8bdd") : (task.job_type === "conversation_merge" ? "Open merged conversation" : "Open conversation")}</Link> : null}
      {importIds.length > 1 ? <><span className="text-secondary">{zh ? `\u5df2\u5bfc\u5165 ${importIds.length} \u4e2a\u5bf9\u8bdd` : `${importIds.length} conversations imported`}</span>{importIds.slice(0, 3).map((id, index) => <Link key={id} className="font-medium text-accent underline underline-offset-2" href={`/conversations/${id}`}>{zh ? `\u6253\u5f00\u7b2c ${index + 1} \u4e2a` : `Open ${index + 1}`}</Link>)}</> : null}
      </> : null}
    </div>
  );
}

function taskCompletedItems(task: BackgroundTaskRead): number {
  if (Array.isArray(task.result.deleted_ids)) return task.result.deleted_ids.length;
  if (Array.isArray(task.result.conversation_ids)) return task.result.conversation_ids.length;
  return Math.max(0, task.processed_items - (Array.isArray(task.result.failed) ? task.result.failed.length : 0));
}

function phaseLabel(task: BackgroundTaskRead, zh: boolean): string {
  if (task.status === "cancelled" && task.result.source_retained === true) return zh ? "已停止 · 来源保留" : "Stopped · sources retained";
  if (task.phase === "waiting_resources") return zh ? "等待可用资源" : "Waiting for resources";
  if (task.phase === "resource_paused") return zh ? "资源等待已暂停" : "Resource wait paused";
  if (task.job_type === "conversation_batch_export" && task.status === "processing") {
    return task.phase === "publishing" ? (zh ? "准备下载文件" : "Preparing download") : (zh ? "打包所选对话" : "Packaging selected conversations");
  }
  if (task.status === "processing" && (task.job_type.endsWith("_export") || task.job_type === "attachment_batch_download")) {
    if (task.phase === "publishing") return zh ? "准备下载文件" : "Preparing download";
    if (task.phase === "exporting") return zh ? "生成导出文件" : "Creating export file";
    if (task.phase === "serializing") return zh ? "整理导出内容" : "Preparing export content";
    if (task.phase === "packaging") return zh ? "打包导出文件" : "Packaging export file";
    if (task.phase === "assets" || task.phase === "packaging_assets") return zh ? "写入导出附件" : "Writing export attachments";
  }
  if (!zh) {
    const terminal = { queued: "Queued", cancelling: "Cancelling", cancelled: "Cancelled", failed: "Failed", committed: "Completed" }[task.status];
    if (terminal) return terminal;
    const phases: Record<string, string> = {
      deleting: "Deleting conversations", messages: "Copying messages", source_refs: "Copying source references",
      versions: "Copying version history", blocks: "Preparing message content", annotations: "Copying annotations",
      parsing: "Parsing conversations", persisting: "Saving messages", validating: "Checking source and order",
      creating: "Creating conversation", copying: "Copying messages", headings: "Building table of contents",
      search: "Building search index", publishing: "Saving result", exporting: "Creating export file",
      cleaning_messages: "Cleaning message content", cleaning_skill_files: "Removing unused Skill files",
      rebuilding_index: "Rebuilding contents and search", packaging_messages: "Preparing conversation messages",
      packaging_headings: "Preparing table of contents", packaging_search: "Preparing offline search index",
      checking_dependencies: "Checking required files",
      packaging_annotations: "Preparing annotations", packaging_metadata: "Preparing reading state and notes",
      packaging_attachments: "Preparing attachment index", packaging_conversations: "Preparing offline conversations",
      packaging_assets: "Writing offline attachments", validating_package: "Checking offline copy",
    };
    return phases[task.phase] ?? "Processing";
  }
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
    publishing: "保存结果",
    exporting: "生成导出文件",
    cleaning_messages: "清理消息内容",
    cleaning_skill_files: "清理未使用的 Skill 文件",
    rebuilding_index: "重建目录与搜索",
    packaging_messages: "整理对话消息",
    packaging_headings: "整理章节目录",
    packaging_search: "整理离线搜索索引",
    packaging_annotations: "整理批注",
    checking_dependencies: "检查必要文件",
    packaging_metadata: "整理阅读状态与笔记",
    packaging_attachments: "整理附件索引",
    packaging_conversations: "整理离线对话",
    packaging_assets: "写入离线附件",
    validating_package: "校验离线资料",
  };
  return labels[task.phase] ?? "正在处理";
}

function taskTypeLabel(task: BackgroundTaskRead, zh: boolean): string {
  if (task.job_type === "content_noise_scan" && task.result.cleanup_apply?.status === "COMPLETED") return zh ? "清理噪声" : "Cleanup";
  const additional: Record<string, [string, string]> = {
    adaptive_import_analysis: ["分析导入文件", "Analyze import files"],
    user_account_delete: ["删除用户账户", "Delete user account"],
    context_validation: ["旧接续校验（已停用）", "Legacy continuation validation (retired)"],
    context_object_cleanup: ["清理接续文件", "Clean up continuation files"],
    skill_object_cleanup: ["清理 Skill 文件", "Clean up Skill files"],
    attachment_batch_download: ["下载附件", "Download attachments"],
    conversation_derived_rebuild: ["更新对话索引", "Update conversation indexes"],
    toc_refresh: ["更新目录", "Update table of contents"],
  };
  if (additional[task.job_type]) return additional[task.job_type][zh ? 0 : 1];
  if (!zh) return ({ offline_package: "Prepare offline copy", conversation_batch_delete: "Delete archived conversations", conversation_merge: "Merge conversations", conversation_export: "Export conversation", conversation_batch_export: "Export conversations", context_package_export: "Export Context Package", context_return: "Update continuation", content_noise_scan: "Scan for noise", import: "Import conversations", conversation_auto_clean: "Clean conversation", personal_archive_export: "Back up my data", personal_archive_preflight: "Preview personal archive", personal_archive_restore: "Restore personal archive", system_archive_export: "Back up system data", system_archive_preflight: "Preview system archive", system_archive_restore: "Restore system archive" }[task.job_type] ?? "Background task");
  return {
    offline_package: "准备离线副本",
    context_package_export: "导出上下文包",
    context_return: "更新上下文接续",
    content_noise_scan: "扫描噪声",
    conversation_batch_delete: "删除归档对话",
    conversation_merge: "合并会话",
    conversation_export: "导出对话",
    conversation_batch_export: "批量导出对话",
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

function taskFormatLabel(task: BackgroundTaskRead, zh: boolean): string | null {
  const format = task.export_format;
  return ({
    cr_v2: ".cr",
    context_package: ".context.zip",
    markdown_bundle: zh ? "Markdown · 含附件" : "Markdown · attachments",
    markdown_v2: zh ? "Markdown · 单文件 ZIP" : "Markdown · single-file ZIP",
    canjson_v2: zh ? "CanJSON · 单文件 ZIP" : "CanJSON · single-file ZIP",
    canjson_bundle: zh ? "CanJSON · 含附件" : "CanJSON · attachments",
    canjson_batch: "CanJSON ZIP",
    attachments_zip: "ZIP",
  } as Record<string, string>)[format ?? ""] ?? null;
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
