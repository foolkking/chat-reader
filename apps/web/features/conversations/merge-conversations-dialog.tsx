"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { ApiRequestError } from "../../lib/api";
import { readAccountCapabilities } from "../../lib/auth-client";
import { SupportLimitAction } from "../../components/support-limit-action";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { usePreferences } from "../../components/preferences-provider";
import { MergeOrderList } from "./merge-order-list";
import { useMergeAdmission, type MergeAdmissionRequest } from "./use-merge-admission";
import type { BackgroundTaskRead } from "../../lib/types";

type MergeConversation = { id: string; title: string; display_title: string; message_count: number };

export function MergeConversationsDialog({ open, conversations, title, busy: parentBusy, recoveryDisabled = false, projectId, onTitleChange, onReorder, onMerge, onAccepted, onOpen, onClose, resultFocus }: {
  open: boolean;
  conversations: MergeConversation[];
  title: string;
  busy: boolean;
  recoveryDisabled?: boolean;
  projectId?: string;
  onTitleChange: (title: string) => void;
  onReorder: (ids: string[]) => void;
  onMerge: (request: MergeAdmissionRequest, signal: AbortSignal) => Promise<BackgroundTaskRead>;
  onAccepted: (task: BackgroundTaskRead) => void;
  onOpen: () => void;
  onClose: () => void;
  resultFocus?: () => HTMLElement | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const recoveryRef = useRef<HTMLButtonElement>(null);
  const acceptedRef = useRef(false);
  const queryClient = useQueryClient();
  const admission = useMergeAdmission({ open, projectId, onSubmit: onMerge, onAccepted: task => {
    acceptedRef.current = true;
    void Promise.resolve().then(() => queryClient.invalidateQueries({ queryKey: ["active-tasks"] })).catch(() => {});
    onAccepted(task);
    onClose();
  } });
  const error = admission.error;
  const busy = parentBusy || admission.phase === "submitting" || admission.phase === "checking";
  const frozen = busy || admission.phase !== "idle";
  const capabilities = useQuery({ queryKey: ["account-capabilities"], queryFn: ({ signal }) => readAccountCapabilities(signal), enabled: open, staleTime: 0, refetchOnWindowFocus: true });
  const totalMessages = conversations.reduce((total, conversation) => total + conversation.message_count, 0);
  const overLimit = capabilities.data && totalMessages > capabilities.data.maximum_merge_message_count;
  const serverLimitError = error instanceof ApiRequestError && error.code === "MERGE_MESSAGE_LIMIT";
  useEffect(() => {
    if (!serverLimitError) return;
    void queryClient.invalidateQueries({ queryKey: ["account-capabilities"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["conversations"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["project-conversations"] }).catch(() => {});
  }, [serverLimitError, queryClient]);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const byId = new Map(conversations.map(conversation => [conversation.id, conversation]));
  const ordered = admission.request ? admission.request.conversationIds.map((id, index) => byId.get(id) ?? {
    id, title: zh ? `之前选择的对话 ${index + 1}` : `Previously selected conversation ${index + 1}`, display_title: "", message_count: 0,
  }) : conversations;

  useDialogFocus({ open, rootRef, initialFocusRef: titleRef, onClose: () => { if (!busy) onClose(); },
    restoreFocus: () => acceptedRef.current ? resultFocus?.() ?? null : recoveryRef.current });
  useEffect(() => { if (open) acceptedRef.current = false; }, [open]);
  if (typeof document === "undefined") return null;
  if (!open) return admission.request ? <div role="status" className="flex flex-wrap items-center gap-x-3 rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-secondary">
    <span>{zh ? `有 ${admission.request.conversationIds.length} 个对话的合并尚待核对。` : `A merge of ${admission.request.conversationIds.length} conversations needs checking.`}</span>
    <button ref={recoveryRef} type="button" onClick={onOpen} disabled={parentBusy || recoveryDisabled}
      className="btn-secondary min-h-11 px-3 disabled:opacity-60">{zh ? "核对原合并" : "Review merge request"}</button>
  </div> : null;

  return createPortal(
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="merge-conversations-title" className="fixed inset-0 z-[270] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-[2vw]">
      <button type="button" data-dialog-backdrop aria-label={zh ? "关闭" : "Close"} className="absolute inset-0" disabled={busy} onPointerDown={onClose} />
      <section className="relative flex max-h-[min(86dvh,44rem)] w-full flex-col overflow-hidden rounded-t-xl border border-ui bg-raised shadow-2xl sm:max-w-xl sm:rounded-xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-ui px-5 py-4">
          <div className="min-w-0 flex-1"><h2 id="merge-conversations-title" className="text-base font-semibold text-primary">{zh ? "合并对话" : "Merge conversations"}</h2><p className="mt-1 text-sm text-secondary">{admission.request ? (zh ? `保留了 ${ordered.length} 个对话的原合并请求。` : `The original request for ${ordered.length} conversations is kept.`) : (zh ? `确认 ${conversations.length} 个对话的标题与合并顺序。` : `Confirm the title and order for ${conversations.length} conversations.`)}</p></div>
          <button type="button" disabled={busy} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:opacity-40" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="text-sm font-medium text-primary">{zh ? "合并标题" : "Merge title"}<input ref={titleRef} value={admission.request?.title ?? title} readOnly={frozen} onChange={(event) => { if (!frozen) { onTitleChange(event.target.value); admission.clearError(); } }} className="mt-2 block h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          <p className="mt-5 text-sm font-medium text-primary">{zh ? "合并顺序" : "Merge order"}</p>
          <p className="mt-1 text-xs text-secondary">{admission.request ? (zh ? "正在保留提交时的标题与顺序，核对不会再次合并。" : "The submitted title and order are kept. Checking does not start another merge.") : (zh ? "从上到下组成新对话。拖动手柄或使用上下按钮调整顺序。" : "The new conversation follows this order. Drag the handle or use the arrows to reorder.")}</p>
          <MergeOrderList conversations={ordered} disabled={frozen} onReorder={(ids) => { if (!frozen) onReorder(ids); }} />
          {!admission.request ? <div className="mt-4 space-y-2 border-t border-ui pt-3">
            {capabilities.data ? <p className="text-sm text-secondary">{zh ? `共 ${totalMessages.toLocaleString()} 条消息 · 当前上限 ${capabilities.data.maximum_merge_message_count.toLocaleString()} 条` : `${totalMessages.toLocaleString()} messages · Current limit ${capabilities.data.maximum_merge_message_count.toLocaleString()}`}</p> : capabilities.isError ? <p role="alert" className="text-sm text-secondary">{zh ? "无法读取合并限制。" : "Could not read merge limits."}<button type="button" className="btn-secondary ml-2 min-h-11 px-3" onClick={() => void capabilities.refetch()}>{zh ? "重试" : "Retry"}</button></p> : <p role="status" className="text-sm text-secondary">{zh ? "正在读取合并限制…" : "Loading merge limits…"}</p>}
            {overLimit ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "消息数超过当前上限，可申请提高或减少所选对话。" : "These messages exceed your limit. Request an increase or select fewer conversations."}</p> : null}
            {capabilities.data ? <SupportLimitAction capabilities={capabilities.data} limit="merge_message_count" active={Boolean(overLimit || serverLimitError)} requestedValue={totalMessages} returnFocus={() => titleRef.current} onReturn={() => { admission.clearError(); void capabilities.refetch(); }} /> : null}
          </div> : null}
          {admission.phase === "unknown" ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{zh ? "尚未确认合并是否已排队，请先检查原请求的结果。" : "Merge admission is unconfirmed. Check the original request first."}</p> : null}
          {admission.phase === "retry" ? <p role="status" className="mt-3 text-sm text-secondary">{zh ? "暂未找到此请求。可继续提交保留的原请求，标题和顺序保持不变。" : "This request has not been found. Resubmit the saved request with its original title and order."}</p> : null}
          {admission.phase === "locked" ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{zh ? "无法读取此账户的合并恢复记录。请关闭后重新打开并重试核对。" : "The merge recovery record is unavailable for this account. Close and reopen to retry recovery."}</p> : null}
          {admission.storageFailed ? <p className="mt-3 text-sm text-secondary">{zh ? "浏览器无法可靠保存此请求。请在刷新或关闭标签页前完成核对。" : "This browser cannot reliably remember the request. Check its result before reloading or closing the tab."}</p> : null}
          {error && admission.phase === "idle" ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{serverLimitError ? (zh ? "合并限制或源对话已更新，请确认最新消息数与限制后重试。" : "The merge limit or source conversations changed. Review the latest counts and limits, then retry.") : (zh ? "此次合并未受理，请检查所选对话后重试。" : "This merge was not accepted. Review the selected conversations and retry.")}</p> : null}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ui bg-surface px-5 py-4">
          <button key="close" type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-40">{admission.request ? (zh ? "关闭" : "Close") : (zh ? "取消" : "Cancel")}</button>
          {admission.phase === "retry" ? <button key="recheck" type="button" disabled={busy} onClick={() => void admission.check()} className="btn-secondary min-h-11 px-3 text-sm">{zh ? "检查合并结果" : "Check merge result"}</button> : null}
          <button key="merge-admission-primary" type="button"
            disabled={busy || (admission.request ? !["unknown", "retry"].includes(admission.phase) : frozen || conversations.length < 2 || !capabilities.data || Boolean(overLimit))}
            onClick={() => { if (admission.phase === "unknown") void admission.check(); else if (admission.phase === "retry") admission.retry(); else if (admission.phase === "idle") admission.start(conversations.map(conversation => conversation.id), title); }}
            className="min-h-11 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-60">
            {admission.phase === "submitting" ? (zh ? "正在提交合并…" : "Submitting merge…")
              : admission.phase === "checking" ? (zh ? "正在核对…" : "Checking…")
                : admission.phase === "unknown" ? (zh ? "检查合并结果" : "Check merge result")
                  : admission.phase === "retry" ? (zh ? "继续提交原合并" : "Resubmit original merge")
                    : (zh ? `合并 ${conversations.length} 个对话` : `Merge ${conversations.length} conversations`)}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function MergeAdmissionNotice({ task, zh }: { task: BackgroundTaskRead; zh: boolean }) {
  const message = task.status === "committed" ? (zh ? "原合并已完成。" : "The original merge completed.")
    : task.status === "failed" ? (zh ? "原合并任务失败，未另建任务。" : "The original merge failed; no new task was created.")
      : task.status === "cancelled" ? (zh ? "原合并已取消，未重新开始。" : "The original merge was cancelled; it was not restarted.")
        : (zh ? "合并请求已受理，可在任务中心查看进度。" : "Merge request accepted. View progress in Tasks.");
  const resultId = task.result?.conversation_id;
  return <>{message}{task.status === "committed" && typeof resultId === "string" && /^[0-9a-f-]{36}$/i.test(resultId) ? <a href={`/conversations/${resultId}`} className="ml-2 inline-flex min-h-11 items-center text-accent underline">{zh ? "打开合并对话" : "Open merged conversation"}</a> : null}</>;
}
