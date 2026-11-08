import type { AnnotationCreateInput, AnnotationRead, MessageListItem, ReadingPositionInput } from "../../lib/types";

export type BookmarkRequest = { conversationId?: string; messageId: string; position?: ReadingPositionInput };

export function readingBookmarkInput(message: MessageListItem, position?: ReadingPositionInput): AnnotationCreateInput {
  const blockIndex = position?.block_index;
  const block = (message.render_blocks ?? message.current_version?.blocks ?? []).find(item => item.block_index === blockIndex);
  const text = Array.from(block?.plain_text ?? "");
  const capturedOffset = position?.anchor_data?.character_offset;
  const hasTextPoint = typeof capturedOffset === "number" && Number.isInteger(capturedOffset) && capturedOffset >= 0 && capturedOffset < text.length;
  const offset = hasTextPoint ? capturedOffset : 0;
  const quote = hasTextPoint ? text.slice(offset, offset + 160).join("") : "";
  const label = [position?.anchor_data?.reading_label, block?.data?.alt, block?.data?.alt_text, block?.data?.caption, block?.data?.filename, block?.data?.title]
    .find(value => typeof value === "string" && value.trim());
  return {
    id: crypto.randomUUID(), annotation_type: "bookmark", color: null,
    message_id: message.id, message_version_id: message.current_version?.id ?? null,
    ...(blockIndex != null ? {
      start_block_index: blockIndex, end_block_index: blockIndex,
      start_offset: quote ? offset : null, end_offset: quote ? offset + Array.from(quote).length : null,
      quote: quote || null, prefix: quote ? text.slice(Math.max(0, offset - 120), offset).join("") : "",
      suffix: quote ? text.slice(offset + Array.from(quote).length, offset + Array.from(quote).length + 120).join("") : "",
    } : {}),
    metadata: {
      message_role: message.role, message_order_key: message.order_key, message_role_number: message.ordinal ?? null,
      ...(position ? { bookmark_kind: "reading_point", reading_anchor: position.anchor_data ?? {},
        reading_block_type: block?.block_type,
        ...(typeof label === "string" ? { reading_label: Array.from(label).slice(0, 160).join("") } : {}) } : {}),
    },
  };
}

export function sameBookmark(item: AnnotationRead, input: AnnotationCreateInput): boolean {
  return item.annotation_type === "bookmark" && item.message_id === input.message_id
    && item.message_version_id === input.message_version_id
    && (item.start_block_index ?? null) === (input.start_block_index ?? null)
    && (item.start_offset ?? null) === (input.start_offset ?? null)
    && (item.quote ?? "") === (input.quote ?? "")
    && (Boolean(input.quote) || JSON.stringify((item.metadata?.reading_anchor as Record<string, unknown> | undefined)?.block_offset ?? null)
      === JSON.stringify((input.metadata?.reading_anchor as Record<string, unknown> | undefined)?.block_offset ?? null))
    && !["orphaned", "needs_review"].includes(item.anchor_status);
}
