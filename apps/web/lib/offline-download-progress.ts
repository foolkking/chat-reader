import type { OfflineDownload } from "./offline-downloads";

/** A cursor counts processed children, not necessarily successful copies.
 * Older records had no failure ledger: only their committed prefix is complete. */
export function offlineConversationResult(record: OfflineDownload, id: string, index: number) {
  return record.conversationResults?.[id]
    ?? (index < (record.conversationCursor ?? 0) ? { state: "completed" as const } : undefined);
}

export function offlineDownloadCounts(record: OfflineDownload) {
  const ids = record.targetConversationIds ?? [];
  let completed = 0, failed = 0;
  ids.forEach((id, index) => {
    const result = offlineConversationResult(record, id, index);
    if (result?.state === "completed") completed++;
    else if (result?.state === "failed") failed++;
  });
  return { total: ids.length, completed, failed, pending: ids.length - completed - failed };
}

export function offlineDownloadSummary(record: OfflineDownload, zh: boolean): string {
  const { total, completed, failed, pending } = offlineDownloadCounts(record);
  if (!total) return "";
  return zh
    ? `已完成 ${completed}/${total}${failed ? ` · ${failed} 项待处理` : ""}${pending ? ` · ${pending} 项未完成` : ""}`
    : `${completed}/${total} completed${failed ? ` · ${failed} need attention` : ""}${pending ? ` · ${pending} unfinished` : ""}`;
}

export function offlineQueueIsPaused(records: Pick<OfflineDownload, "state" | "queuePaused">[]): boolean {
  return records.some(record => record.state === "failed" && record.queuePaused === true);
}

/** Queued work cannot block the space-recovery action while the writer is paused.
 * Callers still acquire the existing account writer lock and recheck this state. */
export function offlineDownloadBlocksCleanup(records: Pick<OfflineDownload, "state" | "queuePaused">[]): boolean {
  const paused = offlineQueueIsPaused(records);
  return records.some(record => ["generating", "downloading", "writing"].includes(record.state)
    || record.state === "queued" && !paused);
}
