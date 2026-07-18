import { AssistantMessageRenderer } from "./assistant-message-renderer";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { editMessage, splitMessage } from "../../lib/api";
import { EditMessageForm } from "../editing/edit-message-form";
import { VersionHistoryButton } from "../editing/version-history-button";
import { VersionHistoryPanel } from "../editing/version-history-panel";

export function MessageItem({
  message,
  onChanged,
  readOnly = false,
  selected = false,
  onSelectedChange,
  highlightTargetId,
  expandHeavyBlocks = false,
  cachedBlocks,
  onLoadBlocks,
  hasPreviousBlocks = false,
  hasMoreBlocks = false,
  onLoadPreviousBlocks,
  onLoadMoreBlocks,
}: {
  message: MessageListItem;
  onChanged?: () => Promise<void> | void;
  readOnly?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  highlightTargetId?: string | null;
  expandHeavyBlocks?: boolean;
  cachedBlocks?: RenderBlockRead[];
  onLoadBlocks?: (messageId: string) => Promise<RenderBlockRead[]>;
  hasPreviousBlocks?: boolean;
  hasMoreBlocks?: boolean;
  onLoadPreviousBlocks?: () => Promise<void>;
  onLoadMoreBlocks?: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [showHeavyBlocks, setShowHeavyBlocks] = useState(!message.is_heavy);
  const [isLoadingHeavyBlocks, setIsLoadingHeavyBlocks] = useState(false);
  const [isLoadingPreviousBlocks, setIsLoadingPreviousBlocks] = useState(false);
  const [isLoadingMoreBlocks, setIsLoadingMoreBlocks] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [showSplitPanel, setShowSplitPanel] = useState(false);
  const [splitOffsetValue, setSplitOffsetValue] = useState("");
  const [splitReason, setSplitReason] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const autoLoadRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const blocks = normalizedBlocks(message, cachedBlocks);
  const currentText = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  const defaultSplitOffset = Math.max(1, Math.floor(currentText.length / 2));

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasActions = !readOnly || Boolean(onSelectedChange);

  useEffect(() => {
    if (expandHeavyBlocks && message.is_heavy) {
      setShowHeavyBlocks(true);
    }
  }, [expandHeavyBlocks, message.is_heavy]);

  useEffect(() => {
    setSplitOffsetValue(String(defaultSplitOffset));
    setSplitReason("");
    setShowSplitPanel(false);
    setIsEditing(false);
    setShowVersions(false);
  }, [defaultSplitOffset, message.id]);

  useEffect(() => {
    const target = autoLoadRef.current;
    if (!target || !message.is_heavy || showHeavyBlocks || isLoadingHeavyBlocks || !onLoadBlocks) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setIsLoadingHeavyBlocks(true);
        void onLoadBlocks(message.id)
          .then(() => setShowHeavyBlocks(true))
          .finally(() => setIsLoadingHeavyBlocks(false));
      },
      { rootMargin: "600px 0px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [isLoadingHeavyBlocks, message.id, message.is_heavy, onLoadBlocks, showHeavyBlocks]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreBlocks || isLoadingMoreBlocks || !onLoadMoreBlocks) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setIsLoadingMoreBlocks(true);
        void onLoadMoreBlocks().finally(() => setIsLoadingMoreBlocks(false));
      },
      { rootMargin: "500px 0px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreBlocks, isLoadingMoreBlocks, onLoadMoreBlocks]);

  async function submitSplit() {
    const splitOffset = Number.parseInt(splitOffsetValue, 10);
    if (!Number.isFinite(splitOffset) || splitOffset <= 0 || splitOffset >= currentText.length) {
      window.alert(`Split offset must be between 1 and ${Math.max(currentText.length - 1, 1)}.`);
      return;
    }
    setIsSplitting(true);
    try {
      await splitMessage(message.id, {
        splitOffset,
        editReason: splitReason.trim() || "manual split",
      });
      setShowSplitPanel(false);
      setSplitReason("");
      await onChanged?.();
    } finally {
      setIsSplitting(false);
    }
  }

  const actionControls = (
    <>
      {onSelectedChange ? (
        <label className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d1d5db] bg-white/90 px-3 text-xs font-medium text-[#374151]">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
          />
          Select
        </label>
      ) : null}
      {!readOnly ? (
        <>
          <button
            type="button"
            onClick={() => setIsEditing((current) => !current)}
            className="min-h-10 rounded-full border border-[#d1d5db] bg-white/90 px-3 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
          >
            {isEditing ? "Close edit" : "Edit"}
          </button>
          <button
            type="button"
            disabled={isSplitting}
            onClick={() => {
              setIsEditing(false);
              setShowSplitPanel((current) => {
                const next = !current;
                if (next && !splitOffsetValue) {
                  setSplitOffsetValue(String(defaultSplitOffset));
                }
                return next;
              });
            }}
            className="min-h-10 rounded-full border border-[#d1d5db] bg-white/90 px-3 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-60"
          >
            {showSplitPanel ? "Close split" : isSplitting ? "Splitting" : "Split"}
          </button>
          <VersionHistoryButton isOpen={showVersions} onToggle={() => setShowVersions((current) => !current)} />
        </>
      ) : null}
    </>
  );

  return (
    <article
      id={`message-${message.id}`}
      data-message-id={message.id}
      data-order-key={message.order_key}
      className={`group relative block w-full max-w-full scroll-mt-3 rounded-lg transition sm:flex sm:rounded-2xl ${
        highlightTargetId === `message-${message.id}` ? "ring-2 ring-[#f59e0b]/70 ring-offset-4 ring-offset-[#f7f7f8]" : ""
      } ${isUser ? "sm:justify-end" : "sm:justify-start"}`}
    >
      <div className={`${isUser ? "w-full sm:ml-auto sm:max-w-[72%]" : "w-full max-w-full flex-1"} min-w-0`}>
        {isUser ? (
          <div className="mb-2 flex items-center justify-end gap-2 pr-10">
            <span className="text-xs font-semibold text-[#6b7280]">你</span>
          </div>
        ) : null}
        {!isUser ? (
          <div className="mb-2 flex items-center gap-2 pr-10">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#111827] text-[10px] font-semibold text-white">CR</span>
            <span className="text-xs font-semibold text-[#6b7280]">ChatGPT</span>
            <span className="hidden font-mono text-[11px] text-[#9ca3af] group-hover:inline">{message.order_key}</span>
          </div>
        ) : null}

        <div
          className={
            isUser
              ? "message-user w-full min-w-0 rounded-lg border border-[#e5e7eb] bg-[#f4f4f4] px-3 py-3 text-[clamp(1rem,0.24vw+0.94rem,1.125rem)] leading-8 text-[#111827] sm:rounded-[22px] sm:border-0 sm:px-4 sm:shadow-sm"
              : isAssistant
                ? "text-[clamp(1rem,0.24vw+0.94rem,1.125rem)] leading-8 text-[#111827]"
                : "rounded-2xl border border-[#e5e5e5] bg-white px-4 py-3 text-[clamp(1rem,0.24vw+0.94rem,1.125rem)] leading-8 text-[#111827]"
          }
        >
          {isUser ? <span className="sr-only">User message {message.order_key}</span> : null}
          {hasActions ? (
            <>
              <details className="absolute right-0 top-0 z-20 sm:hidden">
                <summary aria-label="消息操作" className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-lg text-[#6b7280] hover:bg-[#ececeb] marker:hidden">
                  ⋯
                </summary>
                <div className="absolute right-0 top-10 flex w-64 flex-wrap gap-2 rounded-lg border border-[#e5e7eb] bg-white p-3 shadow-xl">{actionControls}</div>
              </details>
              <div className="hidden h-0 -translate-y-2 flex-wrap justify-end gap-2 overflow-visible opacity-0 transition sm:flex sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {actionControls}
              </div>
            </>
          ) : null}

          {isEditing && !readOnly ? (
            <EditMessageForm
              initialText={currentText}
              onCancel={() => setIsEditing(false)}
              onSave={async (text, reason) => {
                await editMessage(message.id, {
                  displayText: text,
                  editReason: reason,
                  baseVersionId: message.current_version?.id,
                });
                await queryClient.invalidateQueries({ queryKey: ["message-versions", message.id] });
                setIsEditing(false);
                await onChanged?.();
              }}
            />
          ) : (
            <>
              {showSplitPanel && !readOnly ? (
                <SplitMessageForm
                  textLength={currentText.length}
                  offsetValue={splitOffsetValue}
                  reason={splitReason}
                  busy={isSplitting}
                  onOffsetChange={setSplitOffsetValue}
                  onReasonChange={setSplitReason}
                  onCancel={() => {
                    setShowSplitPanel(false);
                    setSplitOffsetValue(String(defaultSplitOffset));
                    setSplitReason("");
                  }}
                  onSubmit={() => void submitSplit()}
                />
              ) : null}
              {message.is_heavy && !showHeavyBlocks ? (
            <div ref={autoLoadRef} className="border-l-2 border-[#d1fae5] py-3 pl-3">
              <p className="text-sm text-[#6b7280]">{isLoadingHeavyBlocks ? "正在加载完整内容…" : "长内容将在进入阅读区域时自动加载"}</p>
              <button
                type="button"
                onClick={async () => {
                  setIsLoadingHeavyBlocks(true);
                  try {
                    await onLoadBlocks?.(message.id);
                    setShowHeavyBlocks(true);
                  } finally {
                    setIsLoadingHeavyBlocks(false);
                  }
                }}
                disabled={isLoadingHeavyBlocks}
                className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-70"
              >
                {isLoadingHeavyBlocks ? <Spinner /> : null}
                {isLoadingHeavyBlocks ? "正在加载" : "立即展开"}
              </button>
            </div>
              ) : (
                <>
                  {hasPreviousBlocks ? (
                    <BlockPageButton
                      label="Load previous blocks"
                      loadingLabel="Loading previous blocks"
                      loading={isLoadingPreviousBlocks}
                      onClick={async () => {
                        setIsLoadingPreviousBlocks(true);
                        try {
                          await onLoadPreviousBlocks?.();
                        } finally {
                          setIsLoadingPreviousBlocks(false);
                        }
                      }}
                    />
                  ) : null}
                  <AssistantMessageRenderer message={message} blocks={blocks} highlightTargetId={highlightTargetId} />
                  {hasMoreBlocks ? <div ref={loadMoreRef} className="flex min-h-10 items-center justify-center text-xs text-[#6b7280]">{isLoadingMoreBlocks ? "正在继续加载…" : "继续滚动以加载后续内容"}</div> : null}
                </>
              )}
            </>
          )}
        </div>

      {showVersions && !readOnly ? (
        <div className="mt-3">
          <VersionHistoryPanel
            messageId={message.id}
            onChanged={async () => {
              await queryClient.invalidateQueries({ queryKey: ["message-versions", message.id] });
              await onChanged?.();
            }}
          />
        </div>
      ) : null}
      </div>
    </article>
  );
}

function BlockPageButton({
  label,
  loadingLabel,
  loading,
  onClick,
}: {
  label: string;
  loadingLabel: string;
  loading: boolean;
  onClick: () => Promise<void>;
}) {
  return (
    <div className="my-4 flex justify-center">
      <button
        type="button"
        disabled={loading}
        onClick={() => void onClick()}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? <Spinner /> : null}
        {loading ? loadingLabel : label}
      </button>
    </div>
  );
}

function SplitMessageForm({
  textLength,
  offsetValue,
  reason,
  busy,
  onOffsetChange,
  onReasonChange,
  onCancel,
  onSubmit,
}: {
  textLength: number;
  offsetValue: string;
  reason: string;
  busy: boolean;
  onOffsetChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mb-3 rounded-2xl border border-[#dbeafe] bg-white/90 p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs font-medium text-[#374151]">
          Split offset
          <input
            type="number"
            min={1}
            max={Math.max(textLength - 1, 1)}
            value={offsetValue}
            onChange={(event) => onOffsetChange(event.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-[#d1d5db] bg-white px-3 text-sm text-[#111827]"
          />
        </label>
        <label className="min-w-0 flex-[2] text-xs font-medium text-[#374151]">
          Reason
          <input
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="manual split"
            className="mt-1 min-h-10 w-full rounded-lg border border-[#d1d5db] bg-white px-3 text-sm text-[#111827]"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-[#6b7280]">Message length: {textLength} characters. The offset must be inside the message.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || textLength < 2}
          onClick={onSubmit}
          className="min-h-9 rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Splitting" : "Split message"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-9 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />;
}

function normalizedBlocks(message: MessageListItem, cachedBlocks?: RenderBlockRead[]): RenderBlockRead[] {
  if (cachedBlocks && cachedBlocks.length > 0) {
    return cachedBlocks;
  }
  const renderBlocks = message.render_blocks ?? [];
  if (renderBlocks.length > 0) {
    return renderBlocks;
  }
  const versionBlocks = message.current_version?.blocks ?? [];
  if (versionBlocks.length > 0) {
    return versionBlocks.map((block, index) => normalizeVersionBlock(block, index));
  }

  const displayText = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  if (!displayText) {
    return [];
  }

  return [
    {
      block_index: 0,
      block_type: "paragraph",
      plain_text: displayText,
      data: { text: displayText },
    },
  ];
}

function normalizeVersionBlock(block: RenderBlockRead | Record<string, unknown>, fallbackIndex: number): RenderBlockRead {
  const data = readRecord(block.data) ?? {};
  const blockIndex = typeof block.block_index === "number" ? block.block_index : fallbackIndex;
  const blockType = typeof block.block_type === "string" ? block.block_type : "paragraph";
  const plainText = typeof block.plain_text === "string" ? block.plain_text : readTextFromData(data);
  return {
    id: typeof block.id === "string" ? block.id : undefined,
    block_index: blockIndex,
    block_type: blockType,
    plain_text: plainText,
    data,
    char_count: typeof block.char_count === "number" ? block.char_count : plainText.length,
    collapsed_by_default: Boolean(block.collapsed_by_default),
    render_priority: typeof block.render_priority === "number" ? block.render_priority : 0,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readTextFromData(data: Record<string, unknown>): string {
  const value = data.text ?? data.title ?? data.code;
  return typeof value === "string" ? value : "";
}
