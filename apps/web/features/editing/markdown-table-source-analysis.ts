import { projectChatGptRichText } from "../rich-markdown/chatgpt-rich-text-compatibility";

type Range = { start: number; end: number };
type SourceEdit = Range & { text: string };
type MarkdownNode = {
  type?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: MarkdownNode[];
};

export type MarkdownTableSourceAnalysis = {
  source: string;
  complete: boolean;
  literalRanges: readonly Range[];
  definitionRanges: readonly Range[];
  hasFootnotes: boolean;
};

export const TABLE_SOURCE_ANALYSIS_LIMITS = {
  bytes: 1024 * 1024,
  nodes: 100_000,
  ranges: 8192,
} as const;

/** The editor grammar is sufficient for ordinary Markdown, but its HTML block
 * rules differ from the renderer. A cheap trigger, not a second HTML parser. */
export const needsMarkdownTableSourceAnalysis = (source: string) => source.includes("<");

/** Track the existing display-math preprocessing without changing canonical
 * coordinates. Only this bounded, read-only context check needs the map. */
export function projectTableContextMath(source: string) {
  let text = source;
  const stages: ((offset: number) => number)[] = [];
  const apply = (edits: SourceEdit[]) => {
    if (!edits.length) return;
    edits.sort((left, right) => left.start - right.start);
    let cursor = 0, length = 0;
    const pieces: string[] = [];
    const mappings: (Range & { sourceStart: number; sourceEnd: number })[] = [];
    for (const edit of edits) {
      pieces.push(text.slice(cursor, edit.start), edit.text);
      length += edit.start - cursor;
      mappings.push({ start: length, end: length + edit.text.length, sourceStart: edit.start, sourceEnd: edit.end });
      length += edit.text.length;
      cursor = edit.end;
    }
    pieces.push(text.slice(cursor));
    text = pieces.join("");
    stages.push(offset => {
      let low = 0, high = mappings.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (mappings[middle].start <= offset) low = middle + 1;
        else high = middle;
      }
      const mapping = mappings[low - 1];
      return !mapping ? offset : offset < mapping.end
        ? mapping.sourceStart : mapping.sourceEnd + offset - mapping.end;
    });
  };
  apply(Array.from(text.matchAll(/([^\r\n\\\s])[\t ]*\\\[(?=\r?\n)/g), match => ({
    start: match.index + 1, end: match.index + match[0].length - 2, text: "\n\n",
  })));
  apply(Array.from(text.matchAll(/(\r?\n)\\\]([^\r\n])/g), match => ({
    start: match.index + match[1].length + 2, end: match.index + match[1].length + 2, text: "\n\n",
  })));
  const commands: SourceEdit[] = [];
  for (const display of text.matchAll(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g)) {
    for (const command of display[1].matchAll(/\\(left\[|right\])/g)) {
      const start = display.index + 2 + command.index + command[0].length - 1;
      commands.push({ start, end: start + 1, text: command[1] === "left[" ? "\\lbrack" : "\\rbrack" });
    }
  }
  apply(commands);
  return {
    text,
    sourceOffset(offset: number) {
      for (let stage = stages.length - 1; stage >= 0; stage--) offset = stages[stage](offset);
      return offset;
    },
  };
}

/** A remark probe for the existing ReactMarkdown runtime. It captures only
 * source ranges, then empties the tree before HAST, KaTeX or DOM generation.
 * Rendering/committing the probe is the caller's job: never call a React
 * component as an undocumented parser function. No processor/source cache. */
export function createMarkdownTableSourceProbe(source: string) {
  let result: MarkdownTableSourceAnalysis = {
    source, complete: false, literalRanges: [], definitionRanges: [], hasFootnotes: false,
  };
  if (source.length > TABLE_SOURCE_ANALYSIS_LIMITS.bytes
    || new TextEncoder().encode(source).byteLength > TABLE_SOURCE_ANALYSIS_LIMITS.bytes) {
    return { text: "", limited: true, plugin: () => () => {}, result: () => result };
  }
  const math = projectTableContextMath(source);
  const rich = projectChatGptRichText(math.text);
  const restore = (offset: number) => math.sourceOffset(rich.sourcePosition?.(offset).offset ?? offset);
  return {
    text: rich.text,
    limited: false,
    plugin: () => (tree: MarkdownNode) => {
      const literalRanges: Range[] = [], definitionRanges: Range[] = [];
      const pending = [tree];
      let count = 0, complete = true, hasFootnotes = false;
      while (pending.length) {
        if (++count > TABLE_SOURCE_ANALYSIS_LIMITS.nodes) { complete = false; break; }
        const node = pending.pop()!;
        hasFootnotes ||= node.type === "footnoteDefinition";
        const target = node.type === "html" || node.type === "code" || node.type === "math" || node.type === "inlineCode"
          ? literalRanges : node.type === "definition" ? definitionRanges : null;
        if (target) {
          const from = node.position?.start?.offset, to = node.position?.end?.offset;
          if (typeof from !== "number" || typeof to !== "number") { complete = false; break; }
          const start = restore(from), end = restore(to);
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length
            || literalRanges.length + definitionRanges.length >= TABLE_SOURCE_ANALYSIS_LIMITS.ranges) {
            complete = false;
            break;
          }
          target.push({ start, end });
        }
        const children = node.children ?? [];
        if (count + pending.length + children.length > TABLE_SOURCE_ANALYSIS_LIMITS.nodes) { complete = false; break; }
        for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
      }
      literalRanges.sort((left, right) => left.start - right.start);
      definitionRanges.sort((left, right) => left.start - right.start);
      result = { source, complete, literalRanges, definitionRanges, hasFootnotes };
      tree.children = [];
    },
    result: () => result,
  };
}
