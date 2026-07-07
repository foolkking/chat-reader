import { BlockRenderer } from "./block-renderer";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";

const roleStyles: Record<string, string> = {
  user: "border-cyan-200 bg-cyan-50",
  assistant: "border-slate-200 bg-white",
  system: "border-amber-200 bg-amber-50",
  tool: "border-violet-200 bg-violet-50",
};

export function MessageItem({ message }: { message: MessageListItem }) {
  const blocks = normalizedBlocks(message);

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

      {blocks.length > 0 ? (
        <div className="space-y-3">
          {blocks.map((block, index) => (
            <BlockRenderer key={block.id ?? `${message.id}-${index}`} block={block} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No displayable content.</p>
      )}
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
