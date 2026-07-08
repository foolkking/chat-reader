import { BlockRenderer } from "./block-renderer";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { editMessage } from "../../lib/api";
import { EditMessageForm } from "../editing/edit-message-form";
import { VersionHistoryButton } from "../editing/version-history-button";
import { VersionHistoryPanel } from "../editing/version-history-panel";

export function MessageItem({
  message,
  onChanged,
  readOnly = false,
  selected = false,
  onSelectedChange,
}: {
  message: MessageListItem;
  onChanged?: () => Promise<void> | void;
  readOnly?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [showHeavyBlocks, setShowHeavyBlocks] = useState(!message.is_heavy);
  const [isEditing, setIsEditing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const blocks = normalizedBlocks(message);
  const currentText = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasActions = !readOnly || Boolean(onSelectedChange);
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
      className={`group relative w-full max-w-full ${isUser ? "flex justify-end" : "flex justify-start"}`}
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
              ? "rounded-[22px] bg-[#f4f4f4] px-4 py-3 text-[15px] leading-7 text-[#111827] shadow-sm"
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
                onClick={() => setShowHeavyBlocks(true)}
                className="mt-3 min-h-10 rounded-lg bg-[#111827] px-3 text-sm font-medium text-white"
              >
                Load blocks
              </button>
            </div>
          ) : blocks.length > 0 ? (
            <div className="space-y-4 break-words">
              {blocks.map((block, index) => (
                <div
                  key={block.id ?? `${message.id}-${index}`}
                  id={`block-${message.id}-${block.block_index}`}
                  data-block-index={block.block_index}
                  className="max-w-full"
                >
                  <BlockRenderer block={block} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#6b7280]">No displayable content.</p>
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

function normalizedBlocks(message: MessageListItem): RenderBlockRead[] {
  const renderBlocks = message.render_blocks ?? [];
  if (renderBlocks.length > 0) {
    return renderBlocks;
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
