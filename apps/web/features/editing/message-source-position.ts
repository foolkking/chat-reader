import type { MessageListItem, RenderBlockRead } from "../../lib/types";

export type ResolvedSourcePosition = {
  block: RenderBlockRead;
  blockIndex: number;
  renderBlockId?: string;
  canonicalOffset: number;
  sourceOffset: number;
};

type SourceBlockSpan = {
  block: RenderBlockRead;
  startCodeUnit: number;
  endCodeUnit: number;
};

type SourceProjection = {
  text: string;
  rawToProjected: number[];
  projectedToRaw: number[];
};

/** Resolve a CodeMirror code-point offset to a canonical block-local offset. */
export function resolveSourcePosition(
  text: string,
  blocks: RenderBlockRead[],
  sourceCodePointOffset: number,
): ResolvedSourcePosition | null {
  const spans = sourceBlockSpans(text, blocks);
  if (!spans.length) return null;
  const sourceCodeUnitOffset = codePointToCodeUnit(text, sourceCodePointOffset);
  const span = spans.find((item) => sourceCodeUnitOffset < item.endCodeUnit) ?? spans.at(-1);
  if (!span) return null;
  const raw = text.slice(span.startCodeUnit, span.endCodeUnit);
  const localCodePointOffset = codeUnitToCodePoint(raw, sourceCodeUnitOffset - span.startCodeUnit);
  const projection = projectMarkdownSource(raw, span.block.block_type);
  const projectedOffset = projection.rawToProjected[clamp(localCodePointOffset, 0, projection.rawToProjected.length - 1)] ?? 0;
  const canonicalOffset = alignProjectedOffset(projection.text, projectedOffset, blockText(span.block));
  return {
    block: span.block,
    blockIndex: span.block.block_index,
    renderBlockId: span.block.id,
    canonicalOffset,
    sourceOffset: codeUnitToCodePoint(text, sourceCodeUnitOffset),
  };
}

/** Convert a canonical block-local offset back to a CodeMirror code-point offset. */
export function sourceOffsetForBlock(
  text: string,
  blocks: RenderBlockRead[],
  blockId?: string | null,
  canonicalOffset = 0,
): number {
  const targetIndex = blockIndexFromDomId(blockId);
  const targetBlockId = blockId && blocks.some((block) => block.id === blockId) ? blockId : null;
  const span = sourceBlockSpans(text, blocks).find(({ block }) => (
    (targetIndex !== null && block.block_index === targetIndex) || block.id === targetBlockId
  ));
  if (!span) {
    if (targetIndex === null && !targetBlockId) return 0;
    return Math.round(((targetIndex ?? 0) / Math.max(blocks.length - 1, 1)) * Array.from(text).length);
  }
  const raw = text.slice(span.startCodeUnit, span.endCodeUnit);
  const projection = projectMarkdownSource(raw, span.block.block_type);
  const projectedOffset = alignCanonicalOffset(blockText(span.block), canonicalOffset, projection.text);
  const rawOffset = projection.projectedToRaw[clamp(projectedOffset, 0, projection.projectedToRaw.length - 1)] ?? 0;
  return codeUnitToCodePoint(text, span.startCodeUnit) + rawOffset;
}

export function blockIndexForSourceOffset(text: string, blocks: RenderBlockRead[], offset: number): number {
  return resolveSourcePosition(text, blocks, offset)?.blockIndex ?? blocks[0]?.block_index ?? 0;
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

function sourceBlockSpans(source: string, blocks: RenderBlockRead[]): SourceBlockSpan[] {
  const starts: Array<{ block: RenderBlockRead; startCodeUnit: number }> = [];
  let cursor = 0;
  for (const block of blocks) {
    const found = findBlockStart(source, block, cursor);
    const startCodeUnit = found >= 0 ? found : cursor;
    starts.push({ block, startCodeUnit });
    cursor = Math.max(startCodeUnit + blockText(block).length, cursor);
  }
  return starts.map((item, index) => ({
    ...item,
    endCodeUnit: Math.max(item.startCodeUnit, starts[index + 1]?.startCodeUnit ?? source.length),
  }));
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
  return { id: typeof block.id === "string" ? block.id : undefined, block_index: blockIndex, block_type: blockType, plain_text: plainText, data, char_count: typeof block.char_count === "number" ? block.char_count : Array.from(plainText).length, collapsed_by_default: Boolean(block.collapsed_by_default), render_priority: typeof block.render_priority === "number" ? block.render_priority : 0 };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readTextFromData(data: Record<string, unknown>): string {
  const value = data.text ?? data.title ?? data.code;
  return typeof value === "string" ? value : "";
}

function blockText(block: RenderBlockRead): string {
  return block.plain_text ?? readTextFromData(block.data);
}

function findBlockStart(source: string, block: RenderBlockRead, cursor: number): number {
  const plainText = blockText(block);
  if (!plainText) return cursor;
  const direct = source.indexOf(plainText, cursor);
  if (direct >= 0) {
    if (block.block_type === "code") {
      const before = source.slice(cursor, direct);
      const fence = /(?:^|\n)[ \t]{0,3}(?:```|~~~)[^\n]*\n[^]*$/.exec(before);
      if (fence) return cursor + fence.index + (fence[0].startsWith("\n") ? 1 : 0);
    }
    const lineStart = source.lastIndexOf("\n", Math.max(cursor, direct - 1)) + 1;
    const lineEnd = source.indexOf("\n", direct);
    const rawLine = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    const firstPlainLine = plainText.split(/\r?\n/, 1)[0] ?? plainText;
    if (normalizeSourceText(rawLine).includes(normalizeSourceText(firstPlainLine))) return lineStart;
    return direct;
  }
  const normalized = normalizeSourceText(plainText);
  if (!normalized) return -1;
  let offset = cursor;
  for (const rawLine of source.slice(cursor).split(/\r?\n/)) {
    const line = normalizeSourceText(rawLine);
    if (line && (line === normalized || line.includes(normalized) || normalized.includes(line))) return offset;
    offset += rawLine.length + 1;
  }
  return -1;
}

function projectMarkdownSource(raw: string, blockType: string): SourceProjection {
  const characters = Array.from(raw);
  const output: string[] = [];
  const rawToProjected = new Array<number>(characters.length + 1).fill(0);
  const projectedToRaw: number[] = [0];
  let lineStart = 0;
  let skipThrough = 0;
  let linkDestinationDepth = 0;
  let htmlTag = false;

  for (let index = 0; index < characters.length; index += 1) {
    rawToProjected[index] = output.length;
    if (index === lineStart) {
      const lineEnd = characters.indexOf("\n", lineStart);
      const line = characters.slice(lineStart, lineEnd === -1 ? characters.length : lineEnd).join("");
      skipThrough = Math.max(skipThrough, lineStart + structuralPrefixLength(line, blockType));
      if (/^[ \t]{0,3}(?:```|~~~)/.test(line)) skipThrough = lineEnd === -1 ? characters.length : lineEnd + 1;
    }

    const character = characters[index] ?? "";
    const next = characters[index + 1] ?? "";
    let skip = index < skipThrough;
    if (!skip && htmlTag) {
      skip = true;
      if (character === ">") htmlTag = false;
    } else if (!skip && character === "<" && /[A-Za-z/]/.test(next)) {
      htmlTag = true;
      skip = true;
    } else if (!skip && linkDestinationDepth > 0) {
      skip = true;
      if (character === "(") linkDestinationDepth += 1;
      if (character === ")") linkDestinationDepth -= 1;
    } else if (!skip && character === "]" && next === "(") {
      skip = true;
      skipThrough = index + 2;
      linkDestinationDepth = 1;
    } else if (!skip && (character === "[" || character === "]" || (character === "!" && next === "["))) {
      skip = true;
    } else if (!skip && (character === "`" || character === "*" || character === "~" || character === "_")) {
      skip = true;
    }

    if (skip) projectedToRaw[output.length] = index + 1;
    else {
      output.push(character);
      projectedToRaw.push(index + 1);
    }
    if (character === "\n") lineStart = index + 1;
  }
  rawToProjected[characters.length] = output.length;
  return { text: output.join(""), rawToProjected, projectedToRaw };
}

function structuralPrefixLength(line: string, blockType: string): number {
  if (blockType === "code") return 0;
  let remaining = line;
  let consumed = 0;
  for (let depth = 0; depth < 3; depth += 1) {
    const match = remaining.match(/^[ \t]{0,3}(?:#{1,6}\s+|>\s?|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/);
    if (!match?.[0]) break;
    consumed += Array.from(match[0]).length;
    remaining = remaining.slice(match[0].length);
  }
  return consumed;
}

function alignProjectedOffset(projected: string, projectedOffset: number, plain: string): number {
  const projectedCharacters = Array.from(projected);
  const plainCharacters = Array.from(plain);
  if (!plainCharacters.length) return 0;
  const expected = Math.round((projectedOffset / Math.max(projectedCharacters.length, 1)) * plainCharacters.length);
  const before = projectedCharacters.slice(0, projectedOffset);
  for (let length = Math.min(32, before.length); length >= 3; length -= 1) {
    const sample = before.slice(-length).join("");
    const match = closestOccurrence(plain, sample, expected - length);
    if (match >= 0) return clamp(codeUnitToCodePoint(plain, match) + length, 0, plainCharacters.length);
  }
  const after = projectedCharacters.slice(projectedOffset);
  for (let length = Math.min(32, after.length); length >= 3; length -= 1) {
    const sample = after.slice(0, length).join("");
    const match = closestOccurrence(plain, sample, expected);
    if (match >= 0) return clamp(codeUnitToCodePoint(plain, match), 0, plainCharacters.length);
  }
  return clamp(expected, 0, plainCharacters.length);
}

function alignCanonicalOffset(plain: string, canonicalOffset: number, projected: string): number {
  const plainCharacters = Array.from(plain);
  const projectedCharacters = Array.from(projected);
  const target = clamp(canonicalOffset, 0, plainCharacters.length);
  if (!projectedCharacters.length) return 0;
  const expected = Math.round((target / Math.max(plainCharacters.length, 1)) * projectedCharacters.length);
  const before = plainCharacters.slice(0, target);
  for (let length = Math.min(32, before.length); length >= 3; length -= 1) {
    const sample = before.slice(-length).join("");
    const match = closestOccurrence(projected, sample, expected - length);
    if (match >= 0) return clamp(codeUnitToCodePoint(projected, match) + length, 0, projectedCharacters.length);
  }
  const after = plainCharacters.slice(target);
  for (let length = Math.min(32, after.length); length >= 3; length -= 1) {
    const sample = after.slice(0, length).join("");
    const match = closestOccurrence(projected, sample, expected);
    if (match >= 0) return clamp(codeUnitToCodePoint(projected, match), 0, projectedCharacters.length);
  }
  return clamp(expected, 0, projectedCharacters.length);
}

function closestOccurrence(source: string, sample: string, expectedCodePointOffset: number): number {
  let cursor = 0;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  while (cursor <= source.length - sample.length) {
    const match = source.indexOf(sample, cursor);
    if (match < 0) break;
    const distance = Math.abs(codeUnitToCodePoint(source, match) - expectedCodePointOffset);
    if (distance < bestDistance) {
      best = match;
      bestDistance = distance;
    }
    cursor = match + Math.max(1, sample.length);
  }
  return best;
}

function normalizeSourceText(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/[`*_~]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function codePointToCodeUnit(value: string, offset: number): number {
  const characters = Array.from(value);
  return characters.slice(0, clamp(offset, 0, characters.length)).join("").length;
}

function codeUnitToCodePoint(value: string, offset: number): number {
  return Array.from(value.slice(0, clamp(offset, 0, value.length))).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
