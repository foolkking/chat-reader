"use client";

import { useState } from "react";
import { offlineDownloadFailureMessage, offlineFailureCanRetry } from "../lib/offline-download-errors";
import { offlineDownloadCounts, offlineDownloadSummary } from "../lib/offline-download-progress";
import { retryOfflineDownload, type OfflineAssetMode, type OfflineDownload } from "../lib/offline-downloads";
import { assertOfflineAccess, captureOfflineAccess } from "../lib/offline-access";
import { useInteractionDialog } from "./interaction-dialog-provider";

// A reader recovers unfinished copies without redoing their successful work.
// Existing paper/graphite/sea-green tokens, flat divided rows, no raised cards;
// application text-sm/text-xs and the 4px spacing grid, with 44px controls.
export function OfflineDownloadRecovery({ item, zh, disabled, onRetry, onAction, retryLabel }: {
  item: OfflineDownload; zh: boolean; disabled: boolean;
  retryLabel?: string;
  onRetry: () => void;
  onAction: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  const { confirm } = useInteractionDialog();
  const [shown, setShown] = useState(10);
  const counts = offlineDownloadCounts(item);
  const failures = (item.targetConversationIds ?? []).flatMap((id, index) => {
    const result = item.conversationResults?.[id];
    return result?.state === "failed" ? [{ id, index, ...result }] : [];
  });
  const canReduce = item.state === "failed" && item.error !== "UNAVAILABLE_TARGET"
    && item.assetMode !== "none" && (["CAPACITY", "QUOTA"].includes(item.error ?? "")
      || failures.some(result => result.error === "CAPACITY"));
  const reduce = (assetMode: OfflineAssetMode) => void onAction(async () => {
    const access = captureOfflineAccess();
    if (!await confirm({
      title: zh ? "减少未完成项的下载附件？" : "Download fewer attachments for unfinished items?",
      description: zh
        ? `仅调整未完成的对话：${assetMode === "none" ? "下载完整正文与附件信息，不下载附件文件" : "仅下载不超过 10 MiB 的附件"}。已完成项不重做，旧副本在新包完整写入前保留；这不会修复损坏的正文或绕过安全校验。`
        : `Only unfinished conversations change: ${assetMode === "none" ? "download complete text and attachment metadata, without attachment files" : "download only attachments up to 10 MiB"}. Completed items are not repeated. Older copies remain until the new package commits; this does not repair damaged content or bypass verification.`,
      confirmLabel: zh ? "按此选项继续" : "Continue with this option",
    })) return;
    assertOfflineAccess(access);
    await retryOfflineDownload(item.id, { assetMode, expectedAttemptRevision: item.attemptRevision ?? 0 });
  });
  return <div className="space-y-2 text-xs text-secondary">
    {counts.total ? <p>{offlineDownloadSummary(item, zh)}</p> : null}
    {item.state === "failed" && item.currentConversationLabel ? <p className="break-words">{zh ? "停在：" : "Stopped at: "}{item.currentConversationLabel}</p> : null}
    {item.queuePaused ? <p>{zh ? "后续下载已暂停；处理此项后继续。旧副本仍可阅读。" : "Later downloads are paused until this item is resolved. Older copies remain readable."}</p> : null}
    {failures.length > 1 || failures.length === 1 && counts.total > 1 ? <details>
      <summary className="flex min-h-11 cursor-pointer items-center text-primary">{zh ? "查看未完成项及原因" : "Review unfinished items and reasons"}</summary>
      <ul className="divide-y divide-[var(--border)]">
        {failures.slice(0, shown).map(result => <li className="space-y-1 py-2" key={result.id}>
          <p className="break-words font-medium text-primary">{result.label || (zh ? `第 ${result.index + 1} 个对话` : `Conversation ${result.index + 1}`)}</p>
          <p>{offlineDownloadFailureMessage(result.error ?? null, zh, false)}</p>
        </li>)}
      </ul>
      {failures.length > shown ? <button type="button" className="min-h-11 px-2 text-accent underline" onClick={() => setShown(value => value + 10)}>{zh ? `再显示 ${Math.min(10, failures.length - shown)} 项` : `Show ${Math.min(10, failures.length - shown)} more`}</button> : null}
    </details> : null}
    <div className="flex flex-wrap gap-2">
      {item.state !== "completed" && (item.state === "cancelled" || offlineFailureCanRetry(item.error) || item.error === "UNAVAILABLE_TARGET") ? <button type="button" disabled={disabled} className="btn-secondary min-h-11 px-3 text-xs" onClick={onRetry}>
        {item.error === "UNAVAILABLE_TARGET" ? (zh ? "重新核对范围" : "Review scope")
          : counts.total > 1 ? (zh ? "仅重试未完成项" : "Retry unfinished only") : retryLabel ?? (zh ? "重试下载" : "Retry download")}
      </button> : null}
      {/* The parent owns the action lock while confirmation is open. Native
          disabled blurs its opener before the dialog can capture that trigger. */}
      {canReduce && item.assetMode === "all" ? <button type="button" aria-disabled={disabled || undefined} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { if (!disabled) reduce("small"); }}>{zh ? "改为仅小附件" : "Use small attachments"}</button> : null}
      {canReduce ? <button type="button" aria-disabled={disabled || undefined} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { if (!disabled) reduce("none"); }}>{zh ? "改为正文与附件信息" : "Use text and file metadata"}</button> : null}
    </div>
  </div>;
}
