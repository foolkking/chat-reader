import type { SearchMatch } from "./types";

/** Search a normalized shadow, but return half-open canonical code-point ranges. */
export function findSearchTextMatches(
  text: string,
  query: string,
  blockIndex: number | null,
  renderBlockId: string | null = null,
  limit = 100,
): SearchMatch[] {
  if (limit <= 0) return [];
  const source = normalizeSearchText(text);
  const needle = normalizeSearchText(query).text;
  if (!source.text || !needle) return [];
  const matches: SearchMatch[] = [];
  let cursor = 0;
  while (cursor <= source.text.length - needle.length) {
    const index = source.text.indexOf(needle, cursor);
    if (index < 0) break;
    const start = source.spans[index][0];
    const end = source.spans[index + needle.length - 1][1];
    const previous = matches.at(-1);
    if (!previous || previous.match_start !== start || previous.match_end !== end) {
      matches.push(searchMatch(source.codePoints, start, end, blockIndex, renderBlockId));
      if (matches.length >= limit) break;
    }
    cursor = index + Math.max(1, needle.length);
  }
  if (!matches.length) {
    for (const token of needle.replace(/"/g, " ").split(/\s+/).filter(Boolean)) {
      const index = source.text.indexOf(token);
      if (index < 0) continue;
      matches.push(searchMatch(
        source.codePoints,
        source.spans[index][0],
        source.spans[index + token.length - 1][1],
        blockIndex,
        renderBlockId,
      ));
      break;
    }
  }
  return matches;
}

function searchMatch(
  text: string[],
  start: number,
  end: number,
  blockIndex: number | null,
  renderBlockId: string | null,
): SearchMatch {
  return {
    block_index: blockIndex,
    render_block_id: renderBlockId,
    match_start: start,
    match_end: end,
    quote: text.slice(start, end).join(""),
    context_before: text.slice(Math.max(0, start - 80), start).join(""),
    context_after: text.slice(end, end + 80).join(""),
  };
}

function normalizeSearchText(value: string) {
  const codePoints = Array.from(value);
  const parts: string[] = [];
  // String#indexOf uses UTF-16 positions, not code-point positions. Expanded
  // lowercase characters and surrogate pairs each need one span per code unit.
  const spans: Array<[number, number]> = [];
  let whitespaceStart: number | null = null;
  let whitespaceEnd = 0;
  for (const [index, char] of codePoints.entries()) {
    if (/\s/u.test(char)) {
      if (parts.length && whitespaceStart === null) whitespaceStart = index;
      whitespaceEnd = index + 1;
      continue;
    }
    if (whitespaceStart !== null) {
      parts.push(" ");
      spans.push([whitespaceStart, whitespaceEnd]);
      whitespaceStart = null;
    }
    parts.push(char);
    const width = char.toLowerCase().length;
    for (let unit = 0; unit < width; unit++) spans.push([index, index + 1]);
  }
  // Whole-string lowercasing retains context-sensitive sigma behavior. This
  // keeps the existing lowercase matching policy; it does not add casefold
  // recall to FlexSearch or change the offline package.
  return { text: parts.join("").toLowerCase(), spans, codePoints };
}
