import type { RenderBlockRead } from "../../lib/types";

export type ChatGptRichTextProfile = { escapedMarkdown: boolean };
type Range = { start: number; end: number };
type Edit = Range & { text: string };
type Tag = Range & { name: string; closing: boolean; selfClosing: boolean; escaped: boolean };
type Scan = { protectedRanges: Range[]; codeDelimiters: Edit[]; tags: Tag[] };
type Position = { offset?: number; line?: number; column?: number };
type Node = { position?: { start?: Position; end?: Position }; children?: Node[] };

export const CHATGPT_RICH_TEXT_LIMITS = { sourceUnits: 524_288, tokens: 8192, depth: 64 } as const;
const TAG = /\\{0,3}<\/?(?:box|row|text|badge|divider)\b[^<>\r\n]{0,512}>/gi;
const ATTRIBUTE = /^(?:\s+(?:border|radius|padding|gap|justify|align|color|size|background|direction|wrap|flex|height|width|minHeight|minWidth|maxHeight|maxWidth|minSize|maxSize|margin|aspectRatio|variant|pill|weight|textAlign|italic|lineThrough|truncate|maxLines|minLines|flush|spacing)(?:\s*=\s*(?:"[^"<>\r\n]{0,80}"|'[^'<>\r\n]{0,80}'|\{\s*\d{1,3}\s*\}|\d{1,3}|true|false))?)*\s*$/i;

/** A sample-specific reading fallback, not an HTML/JSX parser or export format. */
export function detectChatGptRichText(source: string): ChatGptRichTextProfile | null {
  if (!source.includes("<") || source.length > CHATGPT_RICH_TEXT_LIMITS.sourceUnits) return null;
  const scanned = scan(source);
  if (!scanned) return null;
  const stack: string[] = [];
  let richChild = false;
  let escapedMarkdown = false;
  for (const tag of scanned.tags) {
    if (!stack.length) {
      const lineStart = source.lastIndexOf("\n", tag.start - 1) + 1;
      if (tag.name !== "box" || tag.closing || tag.selfClosing
        || !/^(?:[ \t]|&#(?:x20|32);)*$/i.test(source.slice(lineStart, tag.start))) continue;
      stack.push(tag.name);
      richChild = false;
      escapedMarkdown = tag.escaped;
      continue;
    }
    escapedMarkdown ||= tag.escaped;
    if (tag.closing) {
      if (stack.at(-1) !== tag.name) return null;
      stack.pop();
      if (!stack.length && richChild) return { escapedMarkdown };
    } else {
      richChild ||= tag.name === "text" || tag.name === "badge" || tag.name === "divider";
      if (!tag.selfClosing) stack.push(tag.name);
      if (stack.length > CHATGPT_RICH_TEXT_LIMITS.depth) return null;
    }
  }
  return null;
}

export type RichTextProjection = {
  text: string;
  /** Restores source-preview anchors after this display-only projection. */
  sourcePosition?: (offset: number) => Required<Position>;
};

export function projectChatGptRichText(
  source: string,
  inheritedProfile?: ChatGptRichTextProfile | null,
): RichTextProjection {
  const profile = inheritedProfile === undefined ? detectChatGptRichText(source) : inheritedProfile;
  if (!profile || source.length > CHATGPT_RICH_TEXT_LIMITS.sourceUnits) return { text: source };
  const scanned = scan(source, profile.escapedMarkdown);
  if (!scanned) return { text: source };
  const edits: Edit[] = [];
  const add = (start: number, end: number, text: string) => {
    if (!overlaps(scanned.protectedRanges, start, end)) edits.push({ start, end, text });
  };
  for (const tag of scanned.tags) {
    const text = tag.name === "divider" ? "\n\n---\n\n" : tag.name === "badge" ? " " : "\n\n";
    add(tag.start, tag.end, text);
  }
  // Export indentation is presentation, not a new indented-code block.
  for (const match of source.matchAll(/^(?:[ \t]|&#(?:x20|32);)+/gim)) {
    const end = match.index + match[0].length;
    const tail = source.slice(end, end + 24);
    if (/&#(?:x20|32);/i.test(match[0])
      || (profile.escapedMarkdown && /^\\{1,3}(?:#{1,6}\s|(?:\\{1,3}\*)?\*)/.test(tail))) {
      add(match.index, end, "");
    }
  }
  if (profile.escapedMarkdown) {
    for (const match of source.matchAll(/^([ \t]*)\\{1,3}(?=#{1,6}[ \t])/gm)) {
      add(match.index + match[1].length, match.index + match[0].length, "");
    }
    for (const match of source.matchAll(/((?:\\{1,3}\*){2})([^\r\n]+?)((?:\\{1,3}\*){2})/g)) {
      add(match.index, match.index + match[1].length, "**");
      const end = match.index + match[0].length;
      add(end - match[3].length, end, "**");
    }
    for (const match of source.matchAll(/^([ \t]{0,3}\d{1,9})\\{1,3}([.)])(?=[ \t])/gm)) {
      const start = match.index + match[1].length;
      add(start, match.index + match[0].length - 1, "");
    }
    // Only the delimiters of an established escaped code span are restored.
    // Its body, including literal tags and Markdown escapes, remains untouched.
    edits.push(...scanned.codeDelimiters);
  }
  if (!edits.length || edits.length > CHATGPT_RICH_TEXT_LIMITS.tokens) return { text: source };
  edits.sort((left, right) => left.start - right.start);
  let cursor = 0;
  let length = 0;
  const parts: string[] = [];
  const mappings: (Range & { sourceStart: number; sourceEnd: number })[] = [];
  for (const edit of edits) {
    if (edit.start < cursor) return { text: source }; // Fail closed, never half-convert.
    parts.push(source.slice(cursor, edit.start), edit.text);
    length += edit.start - cursor;
    mappings.push({ start: length, end: length + edit.text.length, sourceStart: edit.start, sourceEnd: edit.end });
    length += edit.text.length;
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  const text = parts.join("");
  const lines = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") lines.push(index + 1);
  return {
    text,
    sourcePosition(offset) {
      const index = lastAtOrBefore(mappings, offset, item => item.start);
      const mapping = mappings[index];
      const restored = !mapping ? offset : offset < mapping.end
        ? mapping.sourceStart
        : mapping.sourceEnd + offset - mapping.end;
      const bounded = Math.max(0, Math.min(source.length, restored));
      const line = lastAtOrBefore(lines, bounded, value => value);
      return { offset: bounded, line: line + 1, column: bounded - lines[line] + 1 };
    },
  };
}

export function remarkRichTextSourcePositions(projection: RichTextProjection) {
  return () => (tree: Node) => {
    const restore = projection.sourcePosition;
    if (!restore) return;
    const walk = (node: Node) => {
      for (const point of [node.position?.start, node.position?.end]) {
        if (typeof point?.offset === "number") Object.assign(point, restore(point.offset));
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

/** Ephemeral UI metadata only: source strings, copy text and DOM anchors stay canonical. */
export function withChatGptRichTextProfile(blocks: RenderBlockRead[], profile: ChatGptRichTextProfile | null): RenderBlockRead[] {
  if (!profile) return blocks;
  return blocks.map(block => block.block_type === "code" || block.block_type === "image" || block.block_type === "attachment"
    ? block : { ...block, data: { ...block.data, chatGptRichTextProfile: profile } });
}

export function readChatGptRichTextProfile(value: unknown): ChatGptRichTextProfile | undefined {
  return value && typeof value === "object" && "escapedMarkdown" in value && typeof value.escapedMarkdown === "boolean"
    ? { escapedMarkdown: value.escapedMarkdown } : undefined;
}

function scan(source: string, allowEscapedIndentation = false): Scan | null {
  const protectedRanges: Range[] = [];
  const codeDelimiters: Edit[] = [];
  let fence: { start: number; marker: string; size: number } | null = null;
  let layoutDepth = 0;
  let lineStart = 0;
  for (const line of source.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.size && !marker[2].trim()) {
        protectedRanges.push({ start: fence.start, end: lineStart + line.length });
        fence = null;
      }
    } else if (marker) {
      fence = { start: lineStart, marker: marker[1][0], size: marker[1].length };
    } else {
      const knownLayoutLine = TAG.test(line);
      const escapedLayoutLine = /^\\{1,3}(?:<|#|\*)/.test(line.trimStart());
      if (/^(?: {4}|\t)/.test(line)
        && !(layoutDepth > 0 && knownLayoutLine)
        && !(allowEscapedIndentation && escapedLayoutLine)) {
        protectedRanges.push({ start: lineStart, end: lineStart + line.length });
      } else if (knownLayoutLine) {
        // Indented markup is layout only within an established non-code box.
        // A standalone four-space code example must never establish a profile.
        TAG.lastIndex = 0;
        for (const tag of line.matchAll(TAG)) {
          const stripped = tag[0].replace(/^\\+/, "").toLowerCase();
          if (/^<box\b/.test(stripped)) layoutDepth += 1;
          else if (/^<\/box\s*>/.test(stripped)) layoutDepth = Math.max(0, layoutDepth - 1);
        }
      }
    }
    TAG.lastIndex = 0;
    lineStart += line.length + 1;
    if (protectedRanges.length > CHATGPT_RICH_TEXT_LIMITS.tokens) return null;
  }
  if (fence) protectedRanges.push({ start: fence.start, end: source.length });
  // Match paired exact backtick runs in linear passes, without rescanning the
  // remainder for each unmatched opener.
  const delimiters = [...source.matchAll(/\\{1,3}`|`+/g)].filter(match =>
    source[match.index - 1] !== "\\" && !overlaps(protectedRanges, match.index, match.index + match[0].length));
  if (delimiters.length > CHATGPT_RICH_TEXT_LIMITS.tokens) return null;
  const next = new Map<string, number>();
  const closing: (number | undefined)[] = [];
  for (let index = delimiters.length - 1; index >= 0; index -= 1) {
    closing[index] = next.get(delimiters[index][0]);
    next.set(delimiters[index][0], index);
  }
  const inlineRanges: Range[] = [];
  for (let index = 0; index < delimiters.length; index += 1) {
    const endIndex = closing[index];
    if (endIndex === undefined) continue;
    const open = delimiters[index], close = delimiters[endIndex];
    const end = close.index + close[0].length;
    if (overlaps(protectedRanges, open.index, end)
      || /\r?\n[ \t]*\r?\n/.test(source.slice(open.index, end))) continue;
    inlineRanges.push({ start: open.index, end });
    if (open[0].startsWith("\\")) {
      codeDelimiters.push({ start: open.index, end: open.index + open[0].length, text: "`" });
      codeDelimiters.push({ start: close.index, end, text: "`" });
    }
    index = endIndex;
  }
  protectedRanges.push(...inlineRanges);
  protectedRanges.sort((left, right) => left.start - right.start);
  const tags: Tag[] = [];
  for (const match of source.matchAll(TAG)) {
    const start = match.index, end = start + match[0].length;
    if (source[start - 1] === "\\" || overlaps(protectedRanges, start, end)) continue;
    const parsed = /^(\\*)<(\/?)(box|row|text|badge|divider)(.*?)>$/i.exec(match[0])!;
    const closing = Boolean(parsed[2]);
    const selfClosing = /\/\s*$/.test(parsed[4]);
    const attributes = parsed[4].replace(/\/\s*$/, "");
    if (closing ? attributes.trim() || selfClosing : !ATTRIBUTE.test(attributes)) continue;
    const name = parsed[3].toLowerCase();
    if ((name === "divider") !== selfClosing) continue;
    tags.push({ start, end, name, closing, selfClosing, escaped: Boolean(parsed[1]) });
    if (tags.length > CHATGPT_RICH_TEXT_LIMITS.tokens) return null;
  }
  return { protectedRanges, codeDelimiters, tags };
}

function overlaps(ranges: Range[], start: number, end: number): boolean {
  const index = lastAtOrBefore(ranges, end - 1, item => item.start);
  return index >= 0 && ranges[index].end > start;
}

function lastAtOrBefore<T>(items: T[], value: number, key: (item: T) => number): number {
  let low = 0, high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (key(items[middle]) <= value) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
