import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownTableSourceAnalysis } from "./markdown-table-source-analysis";

export const TABLE_REFERENCE_PREVIEW_LIMITS = {
  sourceBytes: 1024 * 1024,
  definitionBytes: 32 * 1024,
  definitions: 256,
} as const;

/** Read-only context for the selected table's preview, never for serialization.
 * Reuse the source editor's parser so fenced/indented examples are not mistaken
 * for definitions. The shared renderer still resolves IDs and sanitizes URLs.
 */
export function collectMarkdownTableReferenceContext(source: string, rendered?: MarkdownTableSourceAnalysis): { markdown: string; limited: boolean } {
  if (!source.includes("]:")) return { markdown: "", limited: false };
  const encoder = new TextEncoder();
  if (source.length > TABLE_REFERENCE_PREVIEW_LIMITS.sourceBytes
    || encoder.encode(source).byteLength > TABLE_REFERENCE_PREVIEW_LIMITS.sourceBytes) {
    return { markdown: "", limited: true };
  }
  const analysis = rendered?.source === source && rendered.complete ? rendered : undefined;
  if (source.includes("<") && !analysis) return { markdown: "", limited: true };
  const definitions: string[] = [];
  const matched = new Set<number>();
  let bytes = 0, limited = analysis?.hasFootnotes ?? false, definitionIndex = 0;
  // GFM has already decided which nodes are literal. Mask them in a same-width
  // view before reusing the editor's raw label/URL extraction. In particular,
  // textarea examples cannot lend definitions to a real outside table, and a
  // quote's HTML opener cannot hide a later legitimate definition.
  let view = source;
  if (analysis?.literalRanges.length) {
    const pieces: string[] = [];
    let position = 0;
    for (const range of analysis.literalRanges) {
      if (range.end <= position) continue;
      const start = Math.max(position, range.start);
      pieces.push(source.slice(position, start), source.slice(start, range.end).replace(/[^\r\n]/g, " "));
      position = range.end;
    }
    pieces.push(source.slice(position));
    view = pieces.join("");
  }
  // Preserve every source coordinate while making CRLF blank lines equivalent
  // to the editor's LF input. Extract the original spelling below, not this view.
  const cursor = markdownLanguage.parser.parse(view.replace(/\r(?=\n|$)/g, " ")).cursor();
  do {
    if (cursor.name === "Paragraph") {
      // Footnote bodies are not link destinations. Do not invent a partial
      // footnote from a URL-looking first word or copy arbitrary body blocks.
      if (/\[\^[^\]\r\n]+\]:/.test(source.slice(cursor.from, cursor.to))) limited = true;
      continue;
    }
    if (cursor.name !== "LinkReference") continue;
    const labelNode = cursor.node.getChild("LinkLabel");
    const urlNode = cursor.node.getChild("URL");
    if (!labelNode || !urlNode) { limited = true; continue; }
    if (analysis) {
      while (analysis.definitionRanges[definitionIndex]?.end <= labelNode.from) definitionIndex++;
      const range = analysis.definitionRanges[definitionIndex];
      if (!range || labelNode.from < range.start || urlNode.to > range.end) continue;
      matched.add(definitionIndex);
    }
    const label = source.slice(labelNode.from, labelNode.to);
    const url = source.slice(urlNode.from, urlNode.to);
    if (label.startsWith("[^") || /[\r\n]/.test(label + url)) { limited = true; continue; }
    // Titles do not affect this inert preview's visible caption/alt text. Keep
    // the original definition outside the table untouched, including its title.
    const definition = `${label}: ${url}`;
    const size = encoder.encode(definition).byteLength + (definitions.length ? 1 : 0);
    if (definitions.length >= TABLE_REFERENCE_PREVIEW_LIMITS.definitions
      || bytes + size > TABLE_REFERENCE_PREVIEW_LIMITS.definitionBytes) {
      limited = true;
      break;
    }
    definitions.push(definition);
    bytes += size;
  } while (cursor.next());
  if (analysis && matched.size < analysis.definitionRanges.length) limited = true;
  return { markdown: definitions.join("\n"), limited };
}
