import type { MessageListItem, ReadingPositionInput } from "../../lib/types";
import { resolveActiveReadingTarget } from "./reader-active-position";
import { textOffsetAtReadingLine } from "./text-anchor";
const ACTIVE_READING_OFFSET = 120;
const numberOrNull = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export function captureReadingPosition(
  root: HTMLElement,
  messages: MessageListItem[],
  totalMessages: number,
): ReadingPositionInput | null {
  const activeTarget = resolveActiveReadingTarget(root, ACTIVE_READING_OFFSET);
  const messageId = activeTarget?.messageId;
  if (!messageId) {
    return null;
  }
  const article = root.querySelector<HTMLElement>(`[id="message-${CSS.escape(messageId)}"]`);
  if (!article) {
    return null;
  }
  const readingLine = root.getBoundingClientRect().top + ACTIVE_READING_OFFSET;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  let activeBlock = activeTarget?.blockId ? root.querySelector<HTMLElement>(`[id="${CSS.escape(activeTarget.blockId)}"]`) : null;
  if (!activeBlock || !article.contains(activeBlock)) {
    activeBlock = null;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.top <= readingLine) {
        activeBlock = block;
      }
      if (rect.top <= readingLine && rect.bottom >= readingLine) {
        activeBlock = block;
        break;
      }
    }
  }
  const anchorElement = activeBlock ?? article;
  const activeBlockIndex = numberOrNull(activeBlock?.dataset.blockIndex);
  let headingBlockIndex: number | null = null;
  for (const block of blocks) {
    const blockIndex = numberOrNull(block.dataset.blockIndex);
    if (blockIndex === null || (activeBlockIndex !== null && blockIndex > activeBlockIndex)) {
      break;
    }
    if (block.dataset.blockType === "heading") {
      headingBlockIndex = blockIndex;
    }
  }
  const message = messages.find((item) => item.id === messageId);
  const ordinal = message?.ordinal ?? null;
  const blockOffset = Math.max(0, Math.round(readingLine - anchorElement.getBoundingClientRect().top));
  const scrollableHeight = Math.max(0, root.scrollHeight - root.clientHeight);
  const block = (message?.render_blocks ?? message?.current_version?.blocks ?? []).find(item => item.block_index === activeBlockIndex);
  const characterOffset = activeBlock
    ? textOffsetAtReadingLine(activeBlock, readingLine, block?.plain_text ?? "") ?? null : null;
  const image = activeBlock ? Array.from(activeBlock.querySelectorAll<HTMLImageElement>("img[alt]")).find(item => {
    const rect = item.getBoundingClientRect();
    return rect.top <= readingLine && rect.bottom >= readingLine && Boolean(item.alt.trim());
  }) : undefined;
  return {
    message_id: messageId,
    block_index: activeBlockIndex,
    scroll_offset: blockOffset,
    anchor_data: {
      locator_version: 2,
      position_mode: "block-relative-v2",
      block_id: activeBlock?.dataset.blockId ?? null,
      version_id: message?.current_version?.id ?? null,
      order_key: message?.order_key ?? article.dataset.orderKey ?? "",
      scroll_ratio: scrollableHeight > 0 ? root.scrollTop / scrollableHeight : 0,
      block_offset: blockOffset,
      character_offset: characterOffset,
      ...(image ? { reading_label: Array.from(image.alt).slice(0, 160).join("") } : {}),
      ordinal,
      progress: ordinal && totalMessages > 0 ? Math.min(100, Math.max(0, (ordinal / totalMessages) * 100)) : null,
      heading_block_index: headingBlockIndex,
      current_version_id: message?.current_version?.id ?? null,
    },
  };
}
