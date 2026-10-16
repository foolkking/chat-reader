import type { CleanupOccurrenceRead, CleanupRemovalRange } from "../../lib/types";

export function fullCandidateRange(item: Pick<CleanupOccurrenceRead, "start_offset" | "end_offset">): CleanupRemovalRange[] {
  return [{ start_offset: item.start_offset, end_offset: item.end_offset }];
}

// Shared by inline markers and the retained-text view. Empty ranges are valid
// only for a local keep-all draft; the save contract still requires 1–20.
export function candidateRemovalParts(item: Pick<CleanupOccurrenceRead, "start_offset" | "end_offset" | "match_text">, ranges: CleanupRemovalRange[]): { gaps: string[]; removed: string[] } | null {
  if (!Number.isSafeInteger(item.start_offset) || !Number.isSafeInteger(item.end_offset)
    || item.start_offset < 0 || item.end_offset <= item.start_offset || !Array.isArray(ranges) || ranges.length > 20) return null;
  const chars = Array.from(item.match_text);
  if (chars.length !== item.end_offset - item.start_offset) return null;
  let cursor = 0;
  const gaps: string[] = [], removed: string[] = [];
  for (const range of ranges) {
    if (!range || typeof range !== "object" || Object.keys(range).length !== 2) return null;
    if (!Number.isSafeInteger(range.start_offset) || !Number.isSafeInteger(range.end_offset)) return null;
    const start = range.start_offset - item.start_offset, end = range.end_offset - item.start_offset;
    if (start < cursor || end <= start || end > chars.length) return null;
    gaps.push(chars.slice(cursor, start).join(""));
    removed.push(chars.slice(start, end).join(""));
    cursor = end;
  }
  gaps.push(chars.slice(cursor).join(""));
  return { gaps, removed };
}

export function candidateAfterText(item: Pick<CleanupOccurrenceRead, "start_offset" | "end_offset" | "match_text">, ranges: CleanupRemovalRange[]): string | null {
  return candidateRemovalParts(item, ranges)?.gaps.join("") ?? null;
}

// Native textarea selection offsets are UTF-16 over LF-normalized text. Keep
// canonical CRLF/CR and astral code points in the server's Unicode offset model.
export function candidateSelectionSource(text: string) {
  const chars = Array.from(text), boundaries: Array<number | null> = [0], display: string[] = [];
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char === "\r") {
      if (chars[index + 1] === "\n") index++;
      display.push("\n"); boundaries.push(index + 1);
    } else {
      display.push(char);
      if (char.length === 2) boundaries.push(null);
      boundaries.push(index + 1);
    }
  }
  return { text: display.join(""), boundaries };
}

export function mergeCandidateRanges(ranges: CleanupRemovalRange[]): CleanupRemovalRange[] {
  const result: CleanupRemovalRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start_offset - b.start_offset)) {
    const previous = result.at(-1);
    if (previous && range.start_offset <= previous.end_offset) previous.end_offset = Math.max(previous.end_offset, range.end_offset);
    else result.push({ ...range });
  }
  return result;
}
