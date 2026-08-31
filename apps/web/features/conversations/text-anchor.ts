export type TextAnchor = {
  quote?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  startOffset?: number;
  endOffset?: number;
};

type TextNodeSegment = {
  node: Text;
  start: number;
  end: number;
};

type NormalizedText = {
  text: string;
  sourceIndexes: number[];
};

type TextIndex = {
  text: string;
  segments: TextNodeSegment[];
  codePointToCodeUnit: number[];
};

/** Convert canonical Unicode code-point offsets to DOM/UTF-16 offsets. */
export function codePointOffsetToCodeUnit(text: string, offset: number): number {
  const target = Math.max(0, Math.min(Math.trunc(offset), Array.from(text).length));
  let codePoints = 0;
  let codeUnits = 0;
  for (const character of text) {
    if (codePoints >= target) break;
    codeUnits += character.length;
    codePoints += 1;
  }
  return codeUnits;
}

export function matchTextAnchor(
  source: string,
  quote: string,
  prefix?: string | null,
  suffix?: string | null,
): { start: number; end: number } | null {
  return bestMatch(source, quote, prefix, suffix);
}

// Resolving an anchor can run for several animation frames while virtualized
// content settles. Keep the expensive TreeWalker pass per mounted root, and
// explicitly invalidate it when the observed DOM changes.
const textIndexCache = new WeakMap<HTMLElement, TextIndex>();

export function invalidateTextAnchorCache(root: HTMLElement): void {
  textIndexCache.delete(root);
}

export function resolveTextAnchorRange(root: HTMLElement, anchor: TextAnchor): Range | null {
  const source = collectText(root);
  if (!source.text) return null;

  const quote = anchor.quote?.trim();
  if (quote) {
    const exact = bestMatch(source.text, quote, anchor.prefix, anchor.suffix);
    if (exact) return rangeForTextOffsets(source.segments, exact.start, exact.end);

    const normalizedSource = normalizeMarkdownAnchor(source.text);
    const normalizedQuote = normalizeMarkdownAnchor(quote).text.trim();
    if (normalizedQuote) {
      const normalizedMatch = bestMatch(
        normalizedSource.text,
        normalizedQuote,
        normalizeMarkdownAnchor(anchor.prefix ?? "").text,
        normalizeMarkdownAnchor(anchor.suffix ?? "").text,
      );
      if (normalizedMatch) {
        const start = normalizedSource.sourceIndexes[normalizedMatch.start];
        const last = normalizedSource.sourceIndexes[Math.max(normalizedMatch.start, normalizedMatch.end - 1)];
        if (start !== undefined && last !== undefined) {
          const range = rangeForTextOffsets(source.segments, start, last + 1);
          if (range) return range;
        }
      }
    }
  }

  if (anchor.startOffset === undefined) return null;
  const startCodePoint = clamp(anchor.startOffset, 0, source.codePointToCodeUnit.length - 1);
  const endCodePoint = clamp(anchor.endOffset ?? startCodePoint + 1, startCodePoint, source.codePointToCodeUnit.length - 1);
  const start = source.codePointToCodeUnit[startCodePoint] ?? source.text.length;
  const end = source.codePointToCodeUnit[endCodePoint] ?? source.text.length;
  return rangeForTextOffsets(source.segments, start, end);
}

export function firstVisibleRangeRect(range: Range): DOMRect | null {
  const rect = Array.from(range.getClientRects()).find((candidate) => candidate.width > 0 || candidate.height > 0);
  if (rect) return rect;
  const fallback = range.getBoundingClientRect();
  return fallback.width > 0 || fallback.height > 0 ? fallback : null;
}

function collectText(root: HTMLElement): TextIndex {
  const cached = textIndexCache.get(root);
  if (cached) return cached;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest("[data-annotation-overlay-root]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const segments: TextNodeSegment[] = [];
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.textContent ?? "";
    if (!value) continue;
    const start = text.length;
    text += value;
    segments.push({ node, start, end: text.length });
  }
  const codePointToCodeUnit = [0];
  let codeUnitOffset = 0;
  for (const character of text) {
    codeUnitOffset += character.length;
    codePointToCodeUnit.push(codeUnitOffset);
  }
  const index = { text, segments, codePointToCodeUnit };
  textIndexCache.set(root, index);
  return index;
}

function rangeForTextOffsets(segments: TextNodeSegment[], start: number, end: number): Range | null {
  const startSegment = segments.find((segment) => start <= segment.end);
  const endSegment = segments.find((segment) => end <= segment.end) ?? segments.at(-1);
  if (!startSegment || !endSegment) return null;
  const range = document.createRange();
  range.setStart(startSegment.node, clamp(start - startSegment.start, 0, startSegment.node.length));
  range.setEnd(endSegment.node, clamp(end - endSegment.start, 0, endSegment.node.length));
  return range.collapsed && end > start ? null : range;
}

function bestMatch(source: string, quote: string, prefix?: string | null, suffix?: string | null): { start: number; end: number } | null {
  let cursor = 0;
  let best: { start: number; end: number; score: number } | null = null;
  while (cursor <= source.length - quote.length) {
    const start = source.indexOf(quote, cursor);
    if (start < 0) break;
    const end = start + quote.length;
    const before = source.slice(Math.max(0, start - 160), start);
    const after = source.slice(end, end + 160);
    const score = contextScore(before, prefix, "prefix") + contextScore(after, suffix, "suffix");
    if (!best || score > best.score) best = { start, end, score };
    cursor = start + Math.max(1, quote.length);
  }
  return best;
}

function contextScore(source: string, expected: string | null | undefined, side: "prefix" | "suffix"): number {
  const value = expected?.trim();
  if (!value) return 0;
  const sample = value.slice(side === "prefix" ? -80 : 0, side === "prefix" ? undefined : 80);
  if (side === "prefix") return source.endsWith(sample) ? sample.length : 0;
  return source.startsWith(sample) ? sample.length : 0;
}

function normalizeMarkdownAnchor(value: string): NormalizedText {
  let text = "";
  const sourceIndexes: number[] = [];
  let previousWasSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (/\s/.test(character)) {
      if (!previousWasSpace && text) {
        text += " ";
        sourceIndexes.push(index);
      }
      previousWasSpace = true;
      continue;
    }
    previousWasSpace = false;
    // This path is only used after exact matching fails. Removing Markdown
    // delimiters lets historical anchors survive richer inline rendering.
    if (character === "`" || character === "*" || character === "_" || character === "~") continue;
    text += character;
    sourceIndexes.push(index);
  }
  return { text: text.trim(), sourceIndexes };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
