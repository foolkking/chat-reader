import { AssistantMessageRenderer } from "./assistant-message-renderer";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { useEffect, useState } from "react";
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
}) {
  const queryClient = useQueryClient();
  const [showHeavyBlocks, setShowHeavyBlocks] = useState(!message.is_heavy);
  const [isLoadingHeavyBlocks, setIsLoadingHeavyBlocks] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const blocks = normalizedBlocks(message, cachedBlocks);
  const currentText = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasActions = !readOnly || Boolean(onSelectedChange);

  useEffect(() => {
    if (expandHeavyBlocks && message.is_heavy) {
      setShowHeavyBlocks(true);
    }
  }, [expandHeavyBlocks, message.is_heavy]);
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
            onClick={async () => {
              const raw = window.prompt(
                `Split offset, 1-${Math.max(currentText.length - 1, 1)}`,
                String(Math.max(1, Math.floor(currentText.length / 2))),
              );
              if (!raw) {
                return;
              }
              const splitOffset = Number.parseInt(raw, 10);
              if (!Number.isFinite(splitOffset) || splitOffset <= 0 || splitOffset >= currentText.length) {
                window.alert("Invalid split offset.");
                return;
              }
              setIsSplitting(true);
              try {
                await splitMessage(message.id, { splitOffset, editReason: "manual split" });
                await onChanged?.();
              } finally {
                setIsSplitting(false);
              }
            }}
            className="min-h-10 rounded-full border border-[#d1d5db] bg-white/90 px-3 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-60"
          >
            {isSplitting ? "Splitting" : "Split"}
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
      className={`group relative w-full max-w-full rounded-2xl transition ${
        highlightTargetId === `message-${message.id}` ? "ring-2 ring-[#f59e0b]/70 ring-offset-4 ring-offset-[#f7f7f8]" : ""
      } ${isUser ? "flex justify-end" : "flex justify-start"}`}
    >
      <div className={`${isUser ? "max-w-[78%] sm:max-w-[72%]" : "max-w-full flex-1"} min-w-0`}>
        {!isUser ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#111827] text-xs font-semibold uppercase text-white">
              {message.role.slice(0, 1)}
            </span>
            <span className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">{message.role}</span>
            <span className="hidden font-mono text-[11px] text-[#9ca3af] group-hover:inline">{message.order_key}</span>
          </div>
        ) : null}

        <div
          className={
            isUser
              ? "message-user rounded-[22px] bg-[#f4f4f4] px-4 py-3 text-[15px] leading-7 text-[#111827] shadow-sm"
              : isAssistant
                ? "text-[15px] leading-7 text-[#111827]"
                : "rounded-2xl border border-[#e5e5e5] bg-white px-4 py-3 text-[15px] leading-7 text-[#111827]"
          }
        >
          {isUser ? <span className="sr-only">User message {message.order_key}</span> : null}
          {hasActions ? (
            <>
              <details className="mb-2 sm:hidden">
                <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-full border border-[#d1d5db] bg-white/90 px-3 text-xs font-medium text-[#374151] marker:hidden">
                  ...
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">{actionControls}</div>
              </details>
              <div className="mb-2 hidden min-h-9 flex-wrap items-center gap-2 opacity-0 transition sm:flex sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
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
          ) : message.is_heavy && !showHeavyBlocks ? (
            <div className="rounded-xl border border-[#e5e5e5] bg-white/70 p-3">
              <p className="text-sm text-[#6b7280]">
                Heavy message: {message.char_count} characters / {message.block_count} blocks.
              </p>
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
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-70"
              >
                {isLoadingHeavyBlocks ? <Spinner /> : null}
                {isLoadingHeavyBlocks ? "Loading blocks" : "Load blocks"}
              </button>
            </div>
          ) : (
            <AssistantMessageRenderer message={message} blocks={blocks} highlightTargetId={highlightTargetId} />
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
