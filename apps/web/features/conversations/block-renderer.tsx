import { memo } from "react";
import type { RenderBlockRead } from "../../lib/types";
import { InlineHeadingMarkdown, MarkdownRenderer, ThinkingDisclosure, stripLeadingTimestamp, type MarkdownTaskItem } from "./markdown-renderer";
import { AttachmentBlock, embeddedAttachment } from "../attachments/attachment-block";

const THINKING_LABEL = "\u601d\u8003\u8fc7\u7a0b";

export const BlockRenderer = memo(function BlockRenderer({
  block,
  messageId,
  galleryItems,
  isAssistant = true,
  taskItems,
  pendingTaskKeys,
  onTaskToggle,
}: {
  block: RenderBlockRead;
  messageId?: string;
  galleryItems?: import("../attachments/attachment-viewer").AttachmentViewerItem[];
  isAssistant?: boolean;
  taskItems?: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
}) {
  if (block.block_type === "image" || block.block_type === "attachment") {
    const attachmentId = readString(block.data.attachmentId);
    if (!attachmentId) return null;
    return (
      <AttachmentBlock
        attachmentId={attachmentId}
        attachment={embeddedAttachment(block.data.attachment, attachmentId)}
        displayMode={readString(block.data.displayMode) ?? (block.block_type === "image" ? "inline" : "card")}
        alt={readString(block.data.alt) ?? undefined}
        caption={readString(block.data.caption) ?? undefined}
        messageId={messageId}
        messageVersionId={readString(block.data.messageVersionId) ?? undefined}
        occurrenceKey={readString(block.data.occurrenceKey) ?? undefined}
        blockIndex={block.block_index}
        displayOrder={readNumber(block.data.displayOrder) ?? undefined}
        galleryItems={galleryItems}
      />
    );
  }
  const text = stripLeadingTimestamp(block.plain_text ?? readText(block));

  if (!text.trim()) {
    return null;
  }

  if (block.collapsed_by_default && block.block_type !== "heading" && block.block_type !== "code") {
    return <ThinkingDisclosure label={THINKING_LABEL} text={text} />;
  }

  if (block.block_type === "heading") {
    const level = normalizeHeadingLevel(block.data.level);
    const title = stripLeadingTimestamp(readString(block.data.title) ?? text);
    const baseClass = "reader-heading whitespace-pre-wrap break-words font-semibold tracking-normal text-primary";
    const content = <InlineHeadingMarkdown text={title} />;

    if (level === 1) {
      return <h1 className={`${baseClass} reader-heading-1 border-b border-ui pb-2`}>{content}</h1>;
    }
    if (level === 2) {
      return <h2 className={`${baseClass} reader-heading-2`}>{content}</h2>;
    }
    if (level === 3) {
      return <h3 className={`${baseClass} reader-heading-3`}>{content}</h3>;
    }
    return <h4 className={`${baseClass} reader-heading-4`}>{content}</h4>;
  }

  if (block.block_type === "code") {
    const code = readString(block.data.code) ?? text;
    const language = readString(block.data.language);
    return <MarkdownRenderer text={`\`\`\`${language ?? ""}\n${code}\n\`\`\``} isAssistant={false} scopeId={`${messageId ?? "message"}-${block.id ?? block.block_index}`} />;
  }

  return <MarkdownRenderer text={text} isAssistant={isAssistant} taskItems={taskItems} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} scopeId={`${messageId ?? "message"}-${block.id ?? block.block_index}`} />;
}, (previous, next) => previous.block === next.block
  && previous.messageId === next.messageId
  && previous.galleryItems === next.galleryItems
  && previous.isAssistant === next.isAssistant
  && previous.taskItems === next.taskItems
  && previous.pendingTaskKeys === next.pendingTaskKeys
  && previous.onTaskToggle === next.onTaskToggle);

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeHeadingLevel(value: unknown): 1 | 2 | 3 | 4 {
  const level = typeof value === "number" ? value : Number(value);
  if (level === 1 || level === 2 || level === 3 || level === 4) {
    return level;
  }
  return 3;
}

function readText(block: RenderBlockRead): string {
  return readString(block.data.text) ?? readString(block.data.title) ?? readString(block.data.code) ?? "";
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
