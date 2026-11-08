import type {
  AnnotationRead,
  AttachmentRead,
  MessageListItem,
  NavigateTarget,
  TocItem,
} from "../../lib/types";
import { normalizedMessageBlocks, resolveSourcePosition } from "../editing/message-source-position";

export type AttachmentOccurrence = NonNullable<AttachmentRead["occurrences"]>[number];

export function attachmentNavigationTarget(
  attachment: Pick<AttachmentRead, "id">,
  occurrence: AttachmentOccurrence,
): NavigateTarget {
  return {
    messageId: occurrence.message_id,
    messageVersionId: occurrence.message_version_id,
    renderBlockId: occurrence.render_block_id,
    blockIndex: occurrence.block_index ?? undefined,
    characterOffset: occurrence.start_offset ?? undefined,
    endCharacterOffset: occurrence.end_offset ?? undefined,
    occurrenceKey: occurrence.occurrence_key,
    attachmentId: attachment.id,
    source: "attachment",
  };
}

export function annotationNavigationTarget(
  annotation: AnnotationRead,
  explicitBlockIndex?: number,
): NavigateTarget {
  const unresolved = annotation.anchor_status === "orphaned" || annotation.anchor_status === "needs_review";
  const blockIndex = unresolved ? undefined : explicitBlockIndex ?? annotation.start_block_index ?? undefined;
  const savedAnchor = annotation.metadata?.reading_anchor as Record<string, unknown> | undefined;
  const nonTextOffset = annotation.annotation_type === "bookmark" && !annotation.quote
    && annotation.metadata?.bookmark_kind === "reading_point" && typeof savedAnchor?.block_offset === "number"
    && Number.isFinite(savedAnchor.block_offset) && savedAnchor.block_offset >= 0
    ? savedAnchor.block_offset : null;
  return {
    messageId: annotation.message_id ?? "",
    messageVersionId: annotation.message_version_id,
    blockIndex,
    characterOffset: blockIndex === undefined ? undefined : annotation.start_offset ?? undefined,
    endCharacterOffset: blockIndex === undefined ? undefined : annotation.end_offset ?? undefined,
    quote: blockIndex === undefined ? null : annotation.quote,
    prefix: blockIndex === undefined ? null : annotation.prefix,
    suffix: blockIndex === undefined ? null : annotation.suffix,
    anchorStatus: annotation.anchor_status,
    annotationId: annotation.id,
    ...(blockIndex !== undefined && nonTextOffset !== null ? { alignmentOffset: 120 - nonTextOffset } : {}),
    preferTocPipeline: true,
    allowMessageFallback: true,
    source: "annotation",
  };
}

export function tocNavigationTarget(item: TocItem): NavigateTarget {
  return {
    messageId: item.message_id,
    messageVersionId: item.message_version_id,
    renderBlockId: item.render_block_id,
    blockIndex: item.block_index,
    preferTocPipeline: true,
    allowMessageFallback: true,
    source: "section-toc",
  };
}

export function sourceEditorNavigationTarget(
  message: MessageListItem,
  sourceText: string,
  sourceCodePointOffset: number,
): NavigateTarget {
  const position = resolveSourcePosition(
    sourceText,
    normalizedMessageBlocks(message),
    sourceCodePointOffset,
  );
  if (!position) {
    return { messageId: message.id, allowMessageFallback: true, source: "source-editor" };
  }
  const plainText = locatorBlockText(position.block);
  const plainLength = Array.from(plainText).length;
  const start = Math.min(position.canonicalOffset, plainLength);
  const end = Math.min(plainLength, start + (start < plainLength ? 1 : 0));
  return {
    messageId: message.id,
    messageVersionId: message.current_version?.id,
    renderBlockId: position.renderBlockId,
    blockIndex: position.blockIndex,
    characterOffset: start,
    endCharacterOffset: end,
    canonicalStart: start,
    canonicalEnd: end,
    allowMessageFallback: true,
    source: "source-editor",
  };
}

function locatorBlockText(block: ReturnType<typeof normalizedMessageBlocks>[number]): string {
  if (block.plain_text) return block.plain_text;
  const candidate = block.data.text ?? block.data.title ?? block.data.code;
  return typeof candidate === "string" ? candidate : "";
}
