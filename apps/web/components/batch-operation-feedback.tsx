"use client";

import type { BatchSelectionProgress } from "../lib/batch-selection";

export function BatchOperationFeedback({
  progress,
  zh,
  onStop,
}: {
  progress: BatchSelectionProgress | null;
  zh: boolean;
  onStop: () => void;
}) {
  if (!progress) return null;
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded-lg border border-ui bg-surface px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-secondary">
        {zh
          ? `批量处理中：完成 ${progress.succeeded}，明确失败 ${progress.failed}，结果未确认 ${progress.unconfirmed}，处理中 ${progress.inFlight}，尚未开始 ${progress.notStarted}。`
          : `Batch in progress: ${progress.succeeded} completed, ${progress.failed} definite failures, ${progress.unconfirmed} unconfirmed, ${progress.inFlight} in flight, ${progress.notStarted} not started.`}
        {progress.stopped ? (zh ? " 已停止后续派发；已经发出的请求仍会完成，不会自动撤销。" : " Pending dispatch stopped. Requests already sent will settle; they are not undone.") : ""}
      </span>
      {progress.notStarted > 0 && !progress.stopped ? <button type="button" onClick={onStop} className="min-h-11 rounded-md border border-ui px-3 text-xs font-medium text-primary">
        {zh ? "停止后续操作" : "Stop pending items"}
      </button> : null}
    </div>
  );
}
