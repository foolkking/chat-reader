"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { ApiRequestError } from "../../lib/api";
import { readAccountCapabilities } from "../../lib/auth-client";
import { SupportLimitAction } from "../../components/support-limit-action";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { usePreferences } from "../../components/preferences-provider";
import { MergeOrderList } from "./merge-order-list";

type MergeConversation = { id: string; title: string; display_title: string; message_count: number };

export function MergeConversationsDialog({ open, conversations, title, busy, onTitleChange, onReorder, onMerge, onClose }: {
  open: boolean;
  conversations: MergeConversation[];
  title: string;
  busy: boolean;
  onTitleChange: (title: string) => void;
  onReorder: (ids: string[]) => void;
  onMerge: () => Promise<void>;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();
  const capabilities = useQuery({ queryKey: ["account-capabilities"], queryFn: ({ signal }) => readAccountCapabilities(signal), enabled: open, staleTime: 0, refetchOnWindowFocus: true });
  const totalMessages = conversations.reduce((total, conversation) => total + conversation.message_count, 0);
  const overLimit = capabilities.data && totalMessages > capabilities.data.maximum_merge_message_count;
  const serverLimitError = error instanceof ApiRequestError && error.code === "MERGE_MESSAGE_LIMIT";
  useEffect(() => { if (!open) setError(null); }, [open]);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";

  useDialogFocus({ open, rootRef, initialFocusRef: titleRef, onClose: () => { if (!busy) onClose(); } });
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="merge-conversations-title" className="fixed inset-0 z-[270] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-[2vw]">
      <button type="button" data-dialog-backdrop aria-label={zh ? "关闭" : "Close"} className="absolute inset-0" disabled={busy} onPointerDown={onClose} />
      <section className="relative flex max-h-[min(86dvh,44rem)] w-full flex-col overflow-hidden rounded-t-xl border border-ui bg-raised shadow-2xl sm:max-w-xl sm:rounded-xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-ui px-5 py-4">
          <div className="min-w-0 flex-1"><h2 id="merge-conversations-title" className="text-base font-semibold text-primary">{zh ? "合并对话" : "Merge conversations"}</h2><p className="mt-1 text-sm text-secondary">{zh ? `确认 ${conversations.length} 个对话的标题与合并顺序。` : `Confirm the title and order for ${conversations.length} conversations.`}</p></div>
          <button type="button" disabled={busy} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:opacity-40" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="text-sm font-medium text-primary">{zh ? "合并标题" : "Merge title"}<input ref={titleRef} value={title} onChange={(event) => { onTitleChange(event.target.value); setError(null); }} className="mt-2 block h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          <p className="mt-5 text-sm font-medium text-primary">{zh ? "合并顺序" : "Merge order"}</p>
          <p className="mt-1 text-xs text-secondary">{zh ? "从上到下组成新对话。拖动手柄或使用上下按钮调整顺序。" : "The new conversation follows this order. Drag the handle or use the arrows to reorder."}</p>
          <MergeOrderList conversations={conversations} disabled={busy} onReorder={onReorder} />
          <div className="mt-4 space-y-2 border-t border-ui pt-3">
            {capabilities.data ? <p className="text-sm text-secondary">{zh ? `共 ${totalMessages.toLocaleString()} 条消息 · 当前上限 ${capabilities.data.maximum_merge_message_count.toLocaleString()} 条` : `${totalMessages.toLocaleString()} messages · Current limit ${capabilities.data.maximum_merge_message_count.toLocaleString()}`}</p> : capabilities.isError ? <p role="alert" className="text-sm text-secondary">{zh ? "无法读取合并限制。" : "Could not read merge limits."}<button type="button" className="btn-secondary ml-2 min-h-11 px-3" onClick={() => void capabilities.refetch()}>{zh ? "重试" : "Retry"}</button></p> : <p role="status" className="text-sm text-secondary">{zh ? "正在读取合并限制…" : "Loading merge limits…"}</p>}
            {overLimit ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "消息数超过当前上限，可申请提高或减少所选对话。" : "These messages exceed your limit. Request an increase or select fewer conversations."}</p> : null}
            {capabilities.data ? <SupportLimitAction capabilities={capabilities.data} limit="merge_message_count" active={Boolean(overLimit || serverLimitError)} requestedValue={totalMessages} returnFocus={() => titleRef.current} onReturn={() => { setError(null); void capabilities.refetch(); }} /> : null}
          </div>
          {error ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{serverLimitError ? (zh ? "合并限制或源对话已更新，请确认最新消息数与限制后重试。" : "The merge limit or source conversations changed. Review the latest counts and limits, then retry.") : error.message}</p> : null}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-ui bg-surface px-5 py-4">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-40">{zh ? "取消" : "Cancel"}</button>
          <button type="button" disabled={busy || conversations.length < 2 || !capabilities.data || Boolean(overLimit)} onClick={async () => { setError(null); try { await onMerge(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason : new Error(String(reason))); if (reason instanceof ApiRequestError && reason.code === "MERGE_MESSAGE_LIMIT") { void capabilities.refetch(); void queryClient.invalidateQueries({ queryKey: ["conversations"] }); void queryClient.invalidateQueries({ queryKey: ["project-conversations"] }); } } }} className="min-h-11 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-60">{busy ? (zh ? "正在合并…" : "Merging…") : (zh ? `合并 ${conversations.length} 个对话` : `Merge ${conversations.length} conversations`)}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
