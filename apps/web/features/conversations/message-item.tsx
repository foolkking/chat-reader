"use client";

import { memo, useEffect, useRef, useState } from "react";
import { BookmarkPlus, CheckSquare2, MoreHorizontal, Pencil, Plus, Square, Trash2, X } from "lucide-react";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { normalizedMessageBlocks } from "../editing/message-source-position";
import { VersionHistoryPanel } from "../editing/version-history-panel";
import { useMessageVersionHistory } from "../editing/use-message-version-history";
import { AssistantMessageRenderer } from "./assistant-message-renderer";
import { AttachmentAccessProvider, type AttachmentAccess } from "../attachments/attachment-access";
import { ApiRequestError, toggleMessageTask } from "../../lib/api";

function MessageItemComponent({
  message,
  onChanged,
  readOnly = false,
  selected = false,
  onSelectedChange,
  highlightTargetId,
  editing = false,
  onEdit,
  onBookmark,
  onInsert,
  onDelete,
  scrollRootMode = "element",
  attachmentAccess = { kind: "owner" },
  userLabel,
}: {
  message: MessageListItem;
  onChanged?: (message?: MessageListItem, conversationRevision?: number) => Promise<void> | void;
  readOnly?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  highlightTargetId?: string | null;
  editing?: boolean;
  onEdit?: (message: MessageListItem, blockId?: string | null) => void;
  onBookmark?: (message: MessageListItem) => void | Promise<void>;
  onInsert?: (message: MessageListItem) => void;
  onDelete?: (message: MessageListItem) => void | Promise<void>;
  scrollRootMode?: "element" | "window";
  attachmentAccess?: AttachmentAccess;
  userLabel?: string;
}) {
  const { t, resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const articleRef = useRef<HTMLElement | null>(null);
  const mobileActionsRef = useRef<HTMLDivElement | null>(null);
  const mobileActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const taskToggleInFlightRef = useRef(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [pendingTaskKeys, setPendingTaskKeys] = useState<Set<string>>(() => new Set());
  const [taskCheckedOverrides, setTaskCheckedOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [taskError, setTaskError] = useState<string | null>(null);
  const blocks = normalizedMessageBlocks(message);
  const currentText = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const wideUserMessage = isUser && shouldUseWideUserLayout(currentText, blocks);
  const hasActions = !readOnly || Boolean(onSelectedChange) || Boolean(onBookmark);
  const messageDomId = `message-${message.id}`;
  const mobileActionsId = `message-actions-${message.id}`;
  const isNavigationTarget = highlightTargetId === messageDomId || Boolean(highlightTargetId?.startsWith(`block-${message.id}-`));
  const versionHistory = useMessageVersionHistory({
    message, enabled: !readOnly && Boolean(onChanged), zh,
    onChanged: replaceMessagePreservingAnchor,
  });

  useEffect(() => {
    if (!mobileActionsOpen) return;
    mobileActionsRef.current?.focus({ preventScroll: true });
    const restoreFocus = () => {
      window.setTimeout(() => mobileActionsTriggerRef.current?.focus({ preventScroll: true }), 0);
    };
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (mobileActionsRef.current?.contains(target) || mobileActionsTriggerRef.current?.contains(target)) return;
      setMobileActionsOpen(false);
      restoreFocus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMobileActionsOpen(false);
      restoreFocus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [mobileActionsOpen]);

  function scrollBy(delta: number) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
    if (scrollRootMode === "window") {
      window.scrollBy({ top: delta, behavior: "auto" });
      return;
    }
    const root = articleRef.current?.closest<HTMLElement>("[data-reader-scroll-root]");
    if (root) root.scrollTop += delta;
  }

  async function afterLayout() {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function visibleBlockAnchor(): HTMLElement | null {
    const candidates = Array.from(articleRef.current?.querySelectorAll<HTMLElement>("[id^='block-']") ?? []);
    return candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 72 && rect.top < window.innerHeight - 72;
    }) ?? candidates[0] ?? articleRef.current;
  }

  async function replaceMessagePreservingAnchor(nextMessage: MessageListItem, conversationRevision?: number, isCurrent: () => boolean = () => true) {
    if (!isCurrent()) return;
    const anchor = visibleBlockAnchor();
    const anchorId = anchor?.id;
    const anchorTop = anchor?.getBoundingClientRect().top ?? 96;
    await onChanged?.(nextMessage, conversationRevision);
    if (!isCurrent()) return;
    await afterLayout();
    if (!isCurrent()) return;
    const nextAnchor = (anchorId ? document.getElementById(anchorId) : null) ?? articleRef.current;
    if (nextAnchor) scrollBy(nextAnchor.getBoundingClientRect().top - anchorTop);
  }

  async function handleTaskToggle(taskKey: string, checked: boolean) {
    const baseVersionId = message.current_version?.id;
    if (readOnly || !baseVersionId || taskToggleInFlightRef.current) return;
    taskToggleInFlightRef.current = true;
    setTaskError(null);
    setPendingTaskKeys(new Set([taskKey]));
    setTaskCheckedOverrides(new Map([[taskKey, checked]]));
    try {
      const response = await toggleMessageTask(message.id, taskKey, { baseVersionId, checked });
      try {
        await replaceMessagePreservingAnchor(response.message, response.conversation_revision);
        setTaskCheckedOverrides(new Map());
      } catch {
        setTaskCheckedOverrides(new Map([[taskKey, checked]]));
        setTaskError(zh
          ? "任务状态已保存，但正文未能刷新。当前勾选已保留，请稍后刷新消息。"
          : "The task state was saved, but the message could not refresh. The checked state is retained; refresh the message later.");
      }
    } catch (error) {
      setTaskCheckedOverrides(new Map());
      setTaskError(taskToggleError(error, zh));
    } finally {
      taskToggleInFlightRef.current = false;
      setPendingTaskKeys(new Set());
    }
  }

  const actions = (mobile: boolean) => (
    <div className={mobile ? "flex w-full flex-wrap items-center gap-2" : "flex items-center gap-1"}>
      {onBookmark ? (
        <button type="button" onClick={() => void onBookmark(message)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "\u6536\u85cf\u6d88\u606f" : "Bookmark message"} title={zh ? "\u6536\u85cf\u6d88\u606f" : "Bookmark message"}>
          <BookmarkPlus className="h-4 w-4" />
        </button>
      ) : null}
      {onSelectedChange ? (
        <button type="button" onClick={() => onSelectedChange(!selected)} className={`inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-subtle ${selected ? "text-accent" : "text-secondary"}`} aria-pressed={selected} aria-label={selected ? (zh ? "\u53d6\u6d88\u9009\u62e9\u6d88\u606f" : "Deselect message") : t("select")} title={selected ? (zh ? "\u53d6\u6d88\u9009\u62e9" : "Deselect") : t("select")}>
          {selected ? <CheckSquare2 className="h-4 w-4" /> : <Square className="h-4 w-4" />}
        </button>
      ) : null}
      {!readOnly ? (
        <>
          {onInsert ? <button type="button" onClick={() => onInsert(message)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "在此处插入消息" : "Insert message here"} title={zh ? "插入消息" : "Insert message"}><Plus className="h-4 w-4" /></button> : null}
          <button type="button" disabled={!onEdit} onClick={() => { setMobileActionsOpen(false); onEdit?.(message, visibleBlockAnchor()?.id); }} className={`inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-subtle disabled:opacity-40 ${editing ? "bg-[var(--accent-soft)] text-accent" : "text-secondary"}`} aria-pressed={editing} aria-label={zh ? "\u7f16\u8f91 Markdown \u6e90\u7801" : "Edit Markdown source"} title={zh ? "\u7f16\u8f91 Markdown \u6e90\u7801" : "Edit Markdown source"}>
            <Pencil className="h-4 w-4" />
          </button>
          <VersionHistoryPanel controller={versionHistory} mobile={mobile} />
          {onDelete ? <button type="button" onClick={() => void onDelete(message)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--danger)] hover:bg-[var(--danger-soft)]" aria-label={zh ? "删除消息" : "Delete message"} title={zh ? "删除消息" : "Delete message"}><Trash2 className="h-4 w-4" /></button> : null}
        </>
      ) : null}
    </div>
  );

  return (
    <article
      ref={articleRef}
      id={messageDomId}
      data-message-id={message.id}
      data-message-version-id={message.current_version?.id}
      data-order-key={message.order_key}
      data-navigation-target={isNavigationTarget ? "true" : undefined}
      data-hover-surface="none"
      aria-current={isNavigationTarget ? "location" : undefined}
      data-state={highlightTargetId === messageDomId ? (selected ? "current-selected" : "current") : selected ? "selected" : undefined}
      className={`reader-message reader-interactive-row group relative block w-full max-w-full scroll-mt-3 rounded-lg transition sm:flex sm:justify-start sm:rounded-2xl ${highlightTargetId === messageDomId ? "ring-2 ring-[var(--mark-border)] ring-offset-4 ring-offset-[var(--page)]" : ""}`}
    >
      <div className="min-w-0 w-full max-w-full flex-1">
        <div data-message-meta className="relative mb-2 flex min-h-10 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${isUser ? "bg-[var(--accent-soft)] text-accent" : "bg-[var(--text)] text-[var(--surface)]"}`}>{isUser ? "U" : "CR"}</span>
          <span className="text-xs font-semibold text-secondary">{isUser ? userLabel ?? t("you") : "Assistant"} - #{message.ordinal ?? message.order_key}</span>
          {!isUser ? <span className="hidden font-mono text-[11px] text-secondary group-hover:inline">{message.order_key}</span> : null}
          {hasActions ? (
            <>
              <div className={`ml-auto hidden min-h-10 items-center transition group-hover:opacity-100 group-focus-within:opacity-100 sm:flex ${versionHistory.needsAttention ? "opacity-100" : "opacity-0"}`}>{actions(false)}</div>
              <div className="ml-auto sm:hidden">
                <button
                  ref={mobileActionsTriggerRef}
                  type="button"
                  aria-label={t("messageActions")}
                  aria-expanded={mobileActionsOpen}
                  aria-controls={mobileActionsId}
                  data-testid="mobile-message-actions-trigger"
                  onClick={() => setMobileActionsOpen((value) => !value)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle"
                >
                  {mobileActionsOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
                </button>
                {mobileActionsOpen ? (
                  <div
                    ref={mobileActionsRef}
                    id={mobileActionsId}
                    role="dialog"
                    aria-label={t("messageActions")}
                    tabIndex={-1}
                    data-testid="mobile-message-actions-sheet"
                    className="fixed inset-x-2 bottom-[calc(.75rem+env(safe-area-inset-bottom))] z-[160] max-h-[min(70dvh,24rem)] overflow-y-auto overscroll-contain rounded-lg border border-ui bg-raised p-3 shadow-2xl outline-none"
                  >
                    {actions(true)}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
        <div className={isUser
          ? wideUserMessage
            ? "reader-message-body message-user message-user-rich w-full min-w-0 text-primary"
            : "reader-message-body message-user w-full min-w-0 rounded-lg border-l-2 border-[var(--accent)] bg-subtle px-4 py-4 text-primary sm:px-5"
          : isAssistant
            ? "reader-message-body text-primary"
            : "reader-message-body rounded-lg border border-ui bg-surface px-4 py-3 text-primary"}>
          {isUser ? <span className="sr-only">User message {message.order_key}</span> : null}
          {taskError ? <p className="mb-2 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">{taskError}</p> : null}
          <AttachmentAccessProvider access={attachmentAccess}>
            <AssistantMessageRenderer
              message={message}
              blocks={blocks}
              highlightTargetId={highlightTargetId}
              scrollRootMode={scrollRootMode}
              pendingTaskKeys={pendingTaskKeys}
              taskCheckedOverrides={taskCheckedOverrides}
              onTaskToggle={readOnly ? undefined : handleTaskToggle}
            />
          </AttachmentAccessProvider>
        </div>
      </div>
    </article>
  );
}

export const MessageItem = memo(MessageItemComponent, (previous, next) => (
  previous.message === next.message
  && previous.userLabel === next.userLabel
  && previous.readOnly === next.readOnly
  && previous.selected === next.selected
  && previous.highlightTargetId === next.highlightTargetId
  && previous.editing === next.editing
  && previous.onInsert === next.onInsert
  && previous.onDelete === next.onDelete
  && previous.scrollRootMode === next.scrollRootMode
  && previous.attachmentAccess?.kind === next.attachmentAccess?.kind
  && (previous.attachmentAccess?.kind !== "admin" || next.attachmentAccess?.kind !== "admin" || previous.attachmentAccess.userId === next.attachmentAccess.userId)
  && (previous.attachmentAccess?.kind !== "share" || next.attachmentAccess?.kind !== "share" || previous.attachmentAccess.token === next.attachmentAccess.token)
));

function shouldUseWideUserLayout(text: string, blocks: RenderBlockRead[]): boolean {
  if (text.length > 360 || text.split(/\r?\n/).length > 5) return true;
  const richTypes = new Set(["heading", "code", "table", "blockquote", "image", "attachment", "math", "mermaid"]);
  return blocks.some((block) => richTypes.has(block.block_type));
}

function taskToggleError(error: unknown, zh: boolean): string {
  const status = error instanceof ApiRequestError ? error.status : undefined;
  if (status === 401) return zh ? "登录状态已过期，请重新登录后再保存任务状态。" : "Your session expired. Sign in again before saving the task state.";
  if (status === 403) return zh ? "当前权限不允许修改此任务状态。" : "Your current permissions do not allow changing this task state.";
  if (status === 404) return zh ? "任务或消息已不存在，请刷新正文后重试。" : "This task or message is no longer available. Refresh the message and try again.";
  if (status === 409) return zh ? "消息版本已变化，请刷新正文后重试。" : "The message changed. Refresh it before trying again.";
  if (status === 422) return zh ? "任务状态请求无效，请刷新正文后重试。" : "The task update was invalid. Refresh the message and try again.";
  if (status === 429) return zh ? "请求过于频繁，请稍后再试。" : "Too many requests. Try again shortly.";
  return zh ? "任务状态保存失败，请稍后重试。" : "The task state could not be saved. Try again shortly.";
}
