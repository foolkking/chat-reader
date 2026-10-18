/** User-invoked, bounded source transformations. Never used by the reader. */
export type MarkdownTableAlignment = "left" | "center" | "right" | null;
export type MarkdownTableCell = { value: string; raw: string };
export type MarkdownTableModel = {
  start: number; end: number; lineStart: number; lineEnd: number;
  newline: "\n" | "\r\n"; prefix: string; continuationPrefix: string;
  headers: MarkdownTableCell[]; rows: MarkdownTableCell[][];
  alignments: MarkdownTableAlignment[]; hadDelimiter: boolean; diagnostics: string[];
  currentRow: number; currentColumn: number;
};
export type MarkdownTableAction =
  | { type: "create"; columns: number; rows: number }
  | { type: "normalize" }
  | { type: "add-row"; position: "before" | "after"; count: number }
  | { type: "add-column"; position: "before" | "after"; count: number };
type SourceLine = { start: number; end: number; text: string };
const MAX_LINES = 5_000, MAX_COLUMNS = 200, MAX_CELLS = 50_000, MAX_BYTES = 1024 * 1024;
const empty = (): MarkdownTableCell => ({ value: "", raw: "" });

export function inspectMarkdownTable(source: string, from: number, to: number): MarkdownTableModel | null {
  if (from < 0 || to < from || to > source.length) return null;
  const selected = from !== to;
  const range = tableRange(source, from, to);
  if (!range || (!selected && insideFence(source, range.start))) return null;
  const fragment = source.slice(range.start, range.end);
  if (fragment.length > MAX_BYTES || new TextEncoder().encode(fragment).byteLength > MAX_BYTES) return null;
  // HTML tables and merged cells have semantics that GFM pipe tables cannot
  // preserve. Keep them intact rather than flattening them into guessed cells.
  if (/<\s*\/?\s*(?:table|thead|tbody|tr|td|th)\b|\b(?:colspan|rowspan)\s*=/i.test(fragment)) return null;
  const lines = sourceLines(fragment, range.start);
  if (lines.length < 1 || lines.length > MAX_LINES || lines.some(line => !line.text.trim())) return null;
  const prefixes = tablePrefixes(lines);
  if (!prefixes) return null;
  const parsed = lines.map((line, index) => parseRow(line.text.slice(prefixes[index].length)));
  if (parsed.some(row => !row.hasPipe || !row.balanced)) return null;
  const delimiterIndex = parsed[1]?.delimiter ? 1 : -1;
  if (parsed.some((row, index) => row.delimiter && index !== delimiterIndex)) return null;
  if (lines.length === 1 || (delimiterIndex === -1 && !parsed.some(row => row.cells.length > 1))) return null;
  const columns = Math.max(...parsed.map(row => row.cells.length));
  const dataRows = parsed.filter((_, index) => index !== 0 && index !== delimiterIndex);
  if (columns > MAX_COLUMNS || columns * (dataRows.length + 2) > MAX_CELLS) return null;
  const currentLine = selected ? -1 : lines.findIndex(line => from >= line.start && from <= line.end);
  const rowLine = currentLine < 0 ? -1 : currentLine - (delimiterIndex >= 0 && currentLine >= delimiterIndex ? 1 : 0) - 1;
  const currentLineText = currentLine < 0 ? "" : lines[currentLine].text.slice(prefixes[currentLine].length);
  const currentLineIndent = currentLineText.length - currentLineText.trimStart().length;
  const currentColumn = currentLine < 0 ? -1 : Math.min(columns - 1, parsed[currentLine].boundaries
    .filter(offset => offset <= from - lines[currentLine].start - prefixes[currentLine].length - currentLineIndent).length - 1);
  const diagnostics: string[] = [];
  if (delimiterIndex === -1) diagnostics.push("缺少表头分隔行：第一行将作为表头。");
  if (parsed.some(row => row.cells.length !== columns)) diagnostics.push("列数不齐：保留所有内容，为缺少的单元格补空。");
  diagnostics.push("统一首尾竖线、分隔线与单元格边界空白；保留单元格内部内容。");
  return {
    start: range.start, end: range.end, lineStart: range.start, lineEnd: range.end,
    newline: source.includes("\r\n") ? "\r\n" : "\n",
    prefix: prefixes[0], continuationPrefix: prefixes[1] ?? prefixes[0],
    headers: pad(parsed[0].cells, columns), rows: dataRows.map(row => pad(row.cells, columns)),
    alignments: Array.from({ length: columns }, (_, index) => {
      const cell = delimiterIndex >= 0 ? parsed[delimiterIndex].cells[index]?.value.replace(/\s/g, "") ?? "" : "";
      return cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null;
    }),
    hadDelimiter: delimiterIndex >= 0, diagnostics, currentRow: selected ? -2 : Math.max(-1, rowLine),
    currentColumn: Math.max(-1, currentColumn),
  };
}

export function applyMarkdownTableAction(source: string, from: number, to: number, action: MarkdownTableAction):
  { from: number; to: number; insert: string; selection: { anchor: number; head?: number }; model?: MarkdownTableModel } | null {
  if (action.type === "create") {
    if (!integerIn(action.columns, 1, 50) || !integerIn(action.rows, 1, 100)) return null;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const table = renderMarkdownTable(Array.from({ length: action.columns }, empty),
      Array.from({ length: action.rows }, () => Array.from({ length: action.columns }, empty)), [], newline);
    // Create is an insertion operation, never a replacement: a toolbar
    // selection remains untouched even when the user opens Table tools from it.
    const before = from > 0 && source[from - 1] !== "\n" ? newline + newline : "";
    const after = from < source.length && source[from] !== "\n" ? newline + newline : "";
    return { from, to: from, insert: before + table + after, selection: { anchor: from + before.length + 2 } };
  }
  const model = inspectMarkdownTable(source, from, to);
  if (!model) return null;
  let { headers, rows, alignments } = model;
  if (action.type === "add-row") {
    if (!integerIn(action.count, 1, 100)) return null;
    const index = model.currentRow === -2 ? rows.length : model.currentRow < 0 ? 0
      : model.currentRow + (action.position === "after" ? 1 : 0);
    const additions = Array.from({ length: action.count }, () => Array.from({ length: headers.length }, empty));
    rows = [...rows.slice(0, index), ...additions, ...rows.slice(index)];
  } else if (action.type === "add-column") {
    if (!integerIn(action.count, 1, 50)) return null;
    const index = model.currentColumn < 0 ? headers.length : model.currentColumn + (action.position === "after" ? 1 : 0);
    const add = (row: MarkdownTableCell[]) => [...row.slice(0, index), ...Array.from({ length: action.count }, empty), ...row.slice(index)];
    headers = add(headers); rows = rows.map(add);
    alignments = [...alignments.slice(0, index), ...Array.from({ length: action.count }, () => "left" as const), ...alignments.slice(index)];
  }
  if (headers.length > MAX_COLUMNS || (rows.length + 2) > MAX_LINES || headers.length * (rows.length + 2) > MAX_CELLS) return null;
  const insert = renderMarkdownTable(headers, rows, alignments, model.newline, model.prefix, model.continuationPrefix);
  if (new TextEncoder().encode(insert).byteLength > MAX_BYTES) return null;
  return { from: model.start, to: model.end, insert, selection: { anchor: model.start + model.prefix.length + 2 }, model };
}

export function renderMarkdownTable(headers: MarkdownTableCell[], rows: MarkdownTableCell[][],
  alignments: MarkdownTableAlignment[], newline = "\n", prefix = "", continuationPrefix = prefix): string {
  const cells = (row: MarkdownTableCell[]) => `| ${row.map(cell => escapePipes(cell.value)).join(" | ")} |`;
  const delimiter = `| ${headers.map((_, index) => alignments[index] === "center" ? ":---:"
    : alignments[index] === "right" ? "---:" : alignments[index] === "left" ? ":---" : "---").join(" | ")} |`;
  return [prefix + cells(headers), continuationPrefix + delimiter, ...rows.map(row => continuationPrefix + cells(row))].join(newline);
}

function parseRow(line: string) {
  const text = line.trim();
  const values: string[] = [], boundaries: number[] = [];
  let current = "", backticks = 0, brackets = 0, parentheses = 0, hasPipe = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\" && index + 1 < text.length) { current += character + text[++index]; continue; }
    if (character === "`") {
      const run = text.slice(index).match(/^`+/)![0];
      if (!backticks) backticks = run.length;
      else if (backticks === run.length) backticks = 0;
      current += run; index += run.length - 1; continue;
    }
    if (!backticks) {
      if (character === "[") brackets++;
      if (character === "]" && brackets) brackets--;
      if (character === "(" && (text[index - 1] === "]" || parentheses)) parentheses++;
      if (character === ")" && parentheses) parentheses--;
    }
    if (character === "|" && !backticks && !brackets && !parentheses) {
      hasPipe = true;
      boundaries.push(index + 1);
      values.push(current.trim()); current = "";
    } else current += character;
  }
  values.push(current.trim());
  if (text.startsWith("|")) values.shift();
  if (text.endsWith("|") && !escapedAt(text, text.length - 1)) values.pop();
  if (!text.startsWith("|")) boundaries.unshift(0);
  const cells = values.map(value => ({ value, raw: value }));
  return { cells, hasPipe, boundaries, balanced: backticks === 0 && brackets === 0 && parentheses === 0,
    delimiter: cells.length > 0 && cells.every(cell => /^:?\s*-+\s*:?$/.test(cell.value)) };
}
function escapePipes(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "|" && !escapedAt(value, index)) output += "\\";
    output += value[index];
  }
  return output;
}
function escapedAt(value: string, index: number) {
  let count = 0;
  while (index > 0 && value[--index] === "\\") count++;
  return count % 2 === 1;
}
function tableRange(source: string, from: number, to: number) {
  let start = source.lastIndexOf("\n", from - 1) + 1;
  const last = to > from && source[to - 1] === "\n" ? to - 1 : to;
  let end = source.indexOf("\n", last);
  if (end < 0) end = source.length;
  if (end > start && source[end - 1] === "\r") end--;
  if (from !== to) {
    if (source.slice(start, from).trim() || source.slice(to, end).trim()) return null;
    return { start, end };
  }
  const candidate = (left: number, right: number) => {
    const text = source.slice(left, right);
    return text.trim().length > 0 && text.includes("|") && !/^\s*(?:```|~~~)/.test(text);
  };
  if (!candidate(start, end)) return null;
  let count = 1;
  while (start > 0 && count <= MAX_LINES && end - start <= MAX_BYTES) {
    const previousEnd = start - (source[start - 2] === "\r" ? 2 : 1);
    const previousStart = source.lastIndexOf("\n", previousEnd - 1) + 1;
    if (!candidate(previousStart, previousEnd)) break;
    start = previousStart; count++;
  }
  while (end < source.length && count <= MAX_LINES && end - start <= MAX_BYTES) {
    const nextStart = end + (source[end] === "\r" ? 2 : 1);
    let nextEnd = source.indexOf("\n", nextStart);
    if (nextEnd < 0) nextEnd = source.length;
    if (source[nextEnd - 1] === "\r") nextEnd--;
    if (!candidate(nextStart, nextEnd)) break;
    end = nextEnd; count++;
  }
  return count > MAX_LINES || end - start > MAX_BYTES ? null : { start, end };
}
function sourceLines(fragment: string, base: number): SourceLine[] {
  let cursor = base;
  return fragment.split(/\r?\n/).map(text => {
    const line = { start: cursor, end: cursor + text.length, text };
    cursor += text.length + (fragment.includes("\r\n") ? 2 : 1);
    return line;
  });
}
function tablePrefixes(lines: SourceLine[]): string[] | null {
  const prefixes = lines.map(line => line.text.match(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/)?.[0] ?? "");
  const first = prefixes[0];
  const continued = first.replace(/(?:[-+*]|\d+[.)])([ \t]+)$/, match => " ".repeat(match.length));
  if (!prefixes.slice(1).every(prefix => prefix === continued)) return null;
  return prefixes;
}
function insideFence(source: string, offset: number) {
  let fence = "", length = 0;
  for (const match of source.slice(0, offset).matchAll(/^(?: {0,3})(`{3,}|~{3,})[^\r\n]*$/gm)) {
    if (!fence) { fence = match[1][0]; length = match[1].length; }
    else if (match[1][0] === fence && match[1].length >= length) { fence = ""; length = 0; }
  }
  return Boolean(fence);
}
function pad(cells: MarkdownTableCell[], size: number) { return Array.from({ length: size }, (_, index) => cells[index] ?? empty()); }
function integerIn(value: number, minimum: number, maximum: number) { return Number.isInteger(value) && value >= minimum && value <= maximum; }
