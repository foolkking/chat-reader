import type { MessageListItem, RenderBlockRead } from "../../lib/types";

export function sourceOffsetForBlock(text: string, blocks: RenderBlockRead[], blockId?: string | null): number {
  const targetIndex = blockIndexFromDomId(blockId);
  if (targetIndex === null) return 0;
  let cursor = 0;
  for (const block of blocks) {
    const blockText = block.plain_text ?? readTextFromData(block.data);
    const found = blockText ? text.indexOf(blockText, cursor) : cursor;
    const start = found >= 0 ? found : cursor;
    if (block.block_index === targetIndex) return start;
    cursor = Math.max(start + blockText.length, cursor);
  }
  return Math.round((targetIndex / Math.max(blocks.length - 1, 1)) * text.length);
}

export function blockIndexForSourceOffset(text: string, blocks: RenderBlockRead[], offset: number): number {
  let cursor = 0;
  let nearest = blocks[0]?.block_index ?? 0;
  for (const block of blocks) {
    const blockText = block.plain_text ?? readTextFromData(block.data);
    const found = blockText ? text.indexOf(blockText, cursor) : cursor;
    const start = found >= 0 ? found : cursor;
    if (start > offset) return nearest;
    nearest = block.block_index;
    if (offset <= start + Math.max(blockText.length, 1)) return block.block_index;
    cursor = Math.max(start + blockText.length, cursor);
  }
  return nearest;
}

export function normalizedMessageBlocks(message: MessageListItem): RenderBlockRead[] {
  const renderBlocks = message.render_blocks ?? [];
  if (renderBlocks.length > 0) return renderBlocks;
  const versionBlocks = message.current_version?.blocks ?? [];
  if (versionBlocks.length > 0) return versionBlocks.map((block, index) => normalizeVersionBlock(block, index));
  const displayText = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  if (!displayText) return [];
  return [{ block_index: 0, block_type: "paragraph", plain_text: displayText, data: { text: displayText } }];
}

function blockIndexFromDomId(blockId?: string | null): number | null {
  if (!blockId) return null;
  const match = blockId.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeVersionBlock(block: RenderBlockRead | Record<string, unknown>, fallbackIndex: number): RenderBlockRead {
  const data = readRecord(block.data) ?? {};
  const blockIndex = typeof block.block_index === "number" ? block.block_index : fallbackIndex;
  const blockType = typeof block.block_type === "string" ? block.block_type : "paragraph";
  const plainText = typeof block.plain_text === "string" ? block.plain_text : readTextFromData(data);
  return { id: typeof block.id === "string" ? block.id : undefined, block_index: blockIndex, block_type: blockType, plain_text: plainText, data, char_count: typeof block.char_count === "number" ? block.char_count : plainText.length, collapsed_by_default: Boolean(block.collapsed_by_default), render_priority: typeof block.render_priority === "number" ? block.render_priority : 0 };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readTextFromData(data: Record<string, unknown>): string {
  const value = data.text ?? data.title ?? data.code;
  return typeof value === "string" ? value : "";
}
