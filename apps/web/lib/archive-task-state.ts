import type { BackgroundTaskRead } from "./types";

const time = (value: string | null) => value ? Date.parse(value) || 0 : 0;
const activity = (task: BackgroundTaskRead) => Math.max(time(task.started_at), time(task.heartbeat_at), time(task.completed_at));
const stage = (task: BackgroundTaskRead) => task.status === "queued" ? 0 : task.status === "processing" ? 1 : task.status === "cancelling" ? 2 : 3;

/** Server queue time fences retries; delayed reads cannot revive an older run. */
export function latestArchiveTask(history: BackgroundTaskRead | undefined, detail: BackgroundTaskRead | undefined, historyReadAt: number, detailReadAt: number) {
  if (!history) return detail;
  if (!detail || detail.job_id !== history.job_id) return history;
  const order = time(detail.queued_at) - time(history.queued_at)
    || activity(detail) - activity(history)
    || stage(detail) - stage(history);
  if (order) return order > 0 ? detail : history;
  // Availability can change after completion without changing job timestamps.
  return detailReadAt >= historyReadAt ? detail : history;
}

export function archiveRequestSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
