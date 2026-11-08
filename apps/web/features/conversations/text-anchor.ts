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
    const preferredStart = anchor.startOffset === undefined ? undefined
      : source.codePointToCodeUnit[clamp(anchor.startOffset, 0, source.codePointToCodeUnit.length - 1)];
    const preferredEnd = anchor.endOffset === undefined
      ? preferredStart === undefined ? undefined : preferredStart + quote.length
      : source.codePointToCodeUnit[clamp(anchor.endOffset, 0, source.codePointToCodeUnit.length - 1)];
    // A range from the same canonical version disambiguates repeated text even
    // when both occurrences have identical surrounding context. Other callers'
    // explicit context must still be able to reject an outdated offset.
    if (preferredStart !== undefined && preferredEnd !== undefined
      && source.text.slice(preferredStart, preferredEnd) === quote
      && (!anchor.prefix?.trim() || contextScore(source.text.slice(0, preferredStart), anchor.prefix, "prefix") > 0)
      && (!anchor.suffix?.trim() || contextScore(source.text.slice(preferredEnd), anchor.suffix, "suffix") > 0)) {
      return rangeForTextOffsets(source.segments, preferredStart, preferredEnd);
    }
    const exact = bestMatch(source.text, quote, anchor.prefix, anchor.suffix, preferredStart);
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

/** Capture a real glyph on the reading line, in canonical Unicode code points.
 * A DOM/canonical mismatch is deliberately a block-offset fallback, not a
 * guessed character-zero anchor. Renderer controls use the same exclusions as
 * navigation. Binary search also works when caretFromPoint APIs are unavailable
 * or a floating tool obscures the text underneath the pointer. */
export function textOffsetAtReadingLine(root: HTMLElement, readingLine: number, canonicalText?: string): number | undefined {
  invalidateTextAnchorCache(root);
  const source = collectText(root);
  let closest: { segment: TextNodeSegment; rect: DOMRect; distance: number } | undefined;
  for (const segment of source.segments) {
    const range = document.createRange();
    range.selectNodeContents(segment.node);
    const bounds = range.getBoundingClientRect();
    const distance = Math.max(bounds.top - readingLine, readingLine - bounds.bottom, 0);
    if (bounds.height <= 0 || (closest && distance > closest.distance)) continue;
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const distance = Math.max(rect.top - readingLine, readingLine - rect.bottom, 0);
      if (!closest || distance < closest.distance) closest = { segment, rect, distance };
    }
  }
  if (!closest || closest.distance > closest.rect.height) return undefined;
  const { segment, rect } = closest;
  const boundaries = [0];
  for (const character of segment.node.textContent ?? "") boundaries.push(boundaries.at(-1)! + character.length);
  const glyph = (index: number) => {
    const range = document.createRange();
    range.setStart(segment.node, boundaries[index]);
    range.setEnd(segment.node, boundaries[index + 1]);
    return range.getBoundingClientRect();
  };
  let low = 0, high = boundaries.length - 2;
  const middleY = (rect.top + rect.bottom) / 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (glyph(middle).bottom <= middleY) low = middle + 1;
    else high = middle;
  }
  const actual = glyph(low);
  if (actual.height <= 0 || actual.top >= rect.bottom || actual.bottom <= rect.top) return undefined;
  let unitOffset = segment.start + boundaries[low];
  if (canonicalText !== undefined && canonicalText !== source.text) {
    const dom = normalizeMarkdownAnchor(source.text), canonical = normalizeMarkdownAnchor(canonicalText);
    if (!canonical.text || canonical.text !== dom.text) return undefined;
    const index = dom.sourceIndexes.findIndex(value => value >= unitOffset);
    if (index < 0 || canonical.sourceIndexes[index] === undefined) return undefined;
    unitOffset = canonical.sourceIndexes[index];
  }
  return Array.from((canonicalText ?? source.text).slice(0, unitOffset)).length;
}

function collectText(root: HTMLElement): TextIndex {
  const cached = textIndexCache.get(root);
  if (cached) return cached;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      // Renderer toolbars and manual-copy recovery UI are not part of the
      // canonical block text. In particular, a code language label must not
      // shift content-free search offsets into that label.
      return parent?.closest('[data-annotation-overlay-root], [data-markdown-copy-ignore="true"]')
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

function bestMatch(source: string, quote: string, prefix?: string | null, suffix?: string | null, preferredStart?: number): { start: number; end: number } | null {
  let cursor = 0;
  let best: { start: number; end: number; score: number } | null = null;
  while (cursor <= source.length - quote.length) {
    const start = source.indexOf(quote, cursor);
    if (start < 0) break;
    const end = start + quote.length;
    const before = source.slice(Math.max(0, start - 160), start);
    const after = source.slice(end, end + 160);
    const score = contextScore(before, prefix, "prefix") + contextScore(after, suffix, "suffix");
    if (!best || score > best.score || (score === best.score && preferredStart !== undefined
      && Math.abs(start - preferredStart) < Math.abs(best.start - preferredStart))) best = { start, end, score };
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
