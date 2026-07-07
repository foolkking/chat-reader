import { BlockRenderer } from "./block-renderer";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { editMessage } from "../../lib/api";
import { EditMessageForm } from "../editing/edit-message-form";
import { VersionHistoryButton } from "../editing/version-history-button";
import { VersionHistoryPanel } from "../editing/version-history-panel";

const roleStyles: Record<string, string> = {
  user: "ml-auto max-w-[720px] border-[#d7f3ea] bg-[#eaf7f2]",
  assistant: "max-w-[820px] border-[#e5e5e5] bg-white",
  system: "max-w-[820px] border-amber-200 bg-amber-50",
  tool: "max-w-[820px] border-violet-200 bg-violet-50",
};

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

  return (
    <article
      id={`message-${message.id}`}
      data-message-id={message.id}
      data-order-key={message.order_key}
      className={`group rounded-2xl border p-4 shadow-sm ${roleStyles[message.role] ?? roleStyles.assistant}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#111827] text-xs font-semibold uppercase text-white">
            {message.role.slice(0, 1)}
          </span>
          <span className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">{message.role}</span>
        </div>
        <span className="font-mono text-xs text-[#9ca3af]">{message.order_key}</span>
      </div>

      {!readOnly || onSelectedChange ? (
        <div className="mb-3 flex flex-wrap gap-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {onSelectedChange ? (
            <label className="flex items-center gap-2 rounded-md border border-[#d1d5db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#374151]">
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
                className="rounded-md border border-[#d1d5db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
              >
                {isEditing ? "Close edit" : "Edit"}
              </button>
              <VersionHistoryButton isOpen={showVersions} onToggle={() => setShowVersions((current) => !current)} />
            </>
          ) : null}
        </div>
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
            className="mt-3 rounded-lg bg-[#111827] px-3 py-2 text-sm font-medium text-white"
          >
            Load blocks
          </button>
        </div>
      ) : blocks.length > 0 ? (
        <div className="space-y-4 text-[15px] leading-7 text-[#111827]">
          {blocks.map((block, index) => (
            <div
              key={block.id ?? `${message.id}-${index}`}
              id={`block-${message.id}-${block.block_index}`}
              data-block-index={block.block_index}
            >
              <BlockRenderer block={block} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#6b7280]">No displayable content.</p>
      )}

      {showVersions && !readOnly ? (
        <VersionHistoryPanel
          messageId={message.id}
          onChanged={async () => {
            await queryClient.invalidateQueries({ queryKey: ["message-versions", message.id] });
            await onChanged?.();
          }}
        />
      ) : null}
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
