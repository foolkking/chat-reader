import { BlockRenderer } from "./block-renderer";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { editMessage } from "../../lib/api";
import { EditMessageForm } from "../editing/edit-message-form";
import { VersionHistoryButton } from "../editing/version-history-button";
import { VersionHistoryPanel } from "../editing/version-history-panel";

const roleStyles: Record<string, string> = {
  user: "border-cyan-200 bg-cyan-50",
  assistant: "border-slate-200 bg-white",
  system: "border-amber-200 bg-amber-50",
  tool: "border-violet-200 bg-violet-50",
};

export function MessageItem({
  message,
  onChanged,
}: {
  message: MessageListItem;
  onChanged?: () => Promise<void> | void;
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
      className={`rounded-lg border p-4 shadow-sm ${roleStyles[message.role] ?? roleStyles.assistant}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-medium capitalize text-white">
          {message.role}
        </span>
        <span className="font-mono text-xs text-slate-500">{message.order_key}</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setIsEditing((current) => !current)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {isEditing ? "Close edit" : "Edit"}
        </button>
        <VersionHistoryButton isOpen={showVersions} onToggle={() => setShowVersions((current) => !current)} />
      </div>

      {isEditing ? (
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
        <div className="rounded-md border border-slate-200 bg-white/70 p-3">
          <p className="text-sm text-slate-600">
            Heavy message: {message.char_count} characters / {message.block_count} blocks.
          </p>
          <button
            type="button"
            onClick={() => setShowHeavyBlocks(true)}
            className="mt-3 rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white"
          >
            Load blocks
          </button>
        </div>
      ) : blocks.length > 0 ? (
        <div className="space-y-3">
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
        <p className="text-sm text-slate-500">No displayable content.</p>
      )}

      {showVersions ? (
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
