import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownTableSourceAnalysis } from "./markdown-table-source-analysis";

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
export type MarkdownTableStructureAction =
  | { type: "insert-row" | "insert-column"; index: number; count: number }
  | { type: "delete-row" | "delete-column"; index: number };
export type MarkdownTableDraft = Pick<MarkdownTableModel, "headers" | "rows" | "alignments" | "newline" | "prefix" | "continuationPrefix">;
export type MarkdownTableAction = MarkdownTableStructureAction
  | { type: "create"; columns: number; rows: number }
  | { type: "normalize" }
  | { type: "replace"; markdown: string }
  | { type: "add-row"; position: "before" | "after"; count: number }
  | { type: "add-column"; position: "before" | "after"; count: number };

/** Whole-table structure changes, independent of preview paging and UI state.
 * Row indices refer only to data rows; the GFM header cannot be deleted. */
export function changeMarkdownTableStructure<T extends MarkdownTableDraft>(table: T, action: MarkdownTableStructureAction): T | null {
  const column = action.type.endsWith("column");
  const size = column ? table.headers.length : table.rows.length;
  const insert = action.type.startsWith("insert");
  if (!Number.isInteger(action.index) || action.index < 0 || action.index > size
    || (!insert && action.index === size)) return null;
  const count = "count" in action ? action.count : 1;
  if (!integerIn(count, 1, column ? 50 : 100) || (!insert && column && size === 1)) return null;
  const spliceCells = (cells: MarkdownTableCell[]) => [
    ...cells.slice(0, action.index),
    ...(insert ? Array.from({ length: count }, empty) : []),
    ...cells.slice(action.index + (insert ? 0 : 1)),
  ];
  const next = column ? {
    ...table,
    headers: spliceCells(table.headers),
    rows: table.rows.map(spliceCells),
    alignments: [
      ...table.alignments.slice(0, action.index),
      ...(insert ? Array.from({ length: count }, () => "left" as const) : []),
      ...table.alignments.slice(action.index + (insert ? 0 : 1)),
    ],
  } : {
    ...table,
    rows: [
      ...table.rows.slice(0, action.index),
      ...(insert ? Array.from({ length: count }, () => Array.from({ length: table.headers.length }, empty)) : []),
      ...table.rows.slice(action.index + (insert ? 0 : 1)),
    ],
  };
  if (next.headers.length > MAX_COLUMNS || next.rows.length + 2 > MAX_LINES
    || next.headers.length * (next.rows.length + 2) > MAX_CELLS) return null;
  return next;
}
/** Frozen editor context, reused only for the exact source it was parsed from. */
export type MarkdownTableSourceContext = {
  source: string;
  parsedTo?: number;
  tree?: ReturnType<typeof markdownLanguage.parser.parse>;
  rendered?: MarkdownTableSourceAnalysis;
};
type SourceLine = { start: number; end: number; text: string };
export const MARKDOWN_TABLE_LIMITS = { lines: 5_000, columns: 200, cells: 50_000, bytes: 1024 * 1024 } as const;
const { lines: MAX_LINES, columns: MAX_COLUMNS, cells: MAX_CELLS, bytes: MAX_BYTES } = MARKDOWN_TABLE_LIMITS;
const textEncoder = new TextEncoder();
const empty = (): MarkdownTableCell => ({ value: "", raw: "" });
const SIMPLE_TABLE_CELL_UNSAFE_RE = /[\\`*_~[\]<>$&\r\n]/;
// GFM table padding is ASCII space/tab. NBSP, BOM and other Unicode spacing
// inside a cell are its content, not expendable Markdown boundary padding.
function trimTablePadding(value: string) {
  let start = 0, end = value.length;
  while (start < end && (value[start] === " " || value[start] === "\t")) start++;
  while (end > start && (value[end - 1] === " " || value[end - 1] === "\t")) end--;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

export function inspectMarkdownTable(source: string, from: number, to: number, context?: MarkdownTableSourceContext): MarkdownTableModel | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > source.length) return null;
  const selected = from !== to;
  const range = tableRange(source, from, to);
  if (!range) return null;
  const fragment = source.slice(range.start, range.end);
  if (fragment.length > MAX_BYTES) return null;
  const fragmentBytes = textEncoder.encode(fragment).byteLength;
  if (fragmentBytes > MAX_BYTES) return null;
  const lines = sourceLines(fragment, range.start);
  if (lines.length < 1 || lines.length > MAX_LINES || lines.some(line => !line.text.trim())) return null;
  const prefixes = tablePrefixes(lines);
  if (!prefixes) return null;
  const parsed = lines.map((line, index) => parseRow(line.text.slice(prefixes[index].length)));
  if (parsed.some(row => !row.hasPipe || !row.balanced)
    || fragmentBytes + parsed.reduce((bytes, row) => bytes + row.encodedByteGrowth, 0) > MAX_BYTES) return null;
  const delimiterIndex = parsed[1]?.delimiter ? 1 : -1;
  // A delimiter-shaped opening row may be literal header text, and any
  // delimiter-shaped row after the canonical second-row separator is data.
  // A later-only separator is ambiguous in an explicit multi-row selection:
  // don't silently absorb the preceding pipe prose as a different header.
  if (selected && delimiterIndex === -1 && parsed.slice(2).some(row => row.delimiter)) return null;
  if (lines.length === 1 || (delimiterIndex === -1 && !parsed.some(row => row.cells.length > 1))) return null;
  const columns = Math.max(...parsed.map(row => row.cells.length));
  const dataRows = parsed.filter((_, index) => index !== 0 && index !== delimiterIndex);
  if (columns > MAX_COLUMNS || dataRows.length + 2 > MAX_LINES || columns * (dataRows.length + 2) > MAX_CELLS) return null;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  if (!selected && insideLiteralBlock(source, range.start + prefixes[0].length, context, newline)) return null;
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
    newline,
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

/** A pasted table may have exterior blank lines, but never silently ignore prose. */
export function inspectMarkdownTableDraft(source: string): MarkdownTableModel | null {
  if (source.length > MAX_BYTES) return null;
  const first = source.search(/[^ \t\r\n]/);
  if (first < 0) return null;
  const start = source.lastIndexOf("\n", first - 1) + 1;
  let last = source.length;
  while (last > 0 && (source[last - 1] === " " || source[last - 1] === "\t"
    || source[last - 1] === "\r" || source[last - 1] === "\n")) last--;
  const simple = inspectSimpleMarkdownTableDraft(source, start, last);
  if (simple) return simple;
  return inspectMarkdownTable(source, start, last);
}

/** Fast path for the common canonical table produced by the editor.  It is
 * intentionally conservative: any syntax that needs the full balanced
 * Markdown scanner falls through to inspectMarkdownTable unchanged. */
function inspectSimpleMarkdownTableDraft(source: string, start: number, last: number): MarkdownTableModel | null {
  if (start !== 0 || last !== source.length) return null;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(newline);
  if (lines.length < 2 || lines.length > MAX_LINES || lines.some(line => !line.trim())) return null;
  const parseRow = (line: string) => {
    if (!line.startsWith("|") || !line.endsWith("|") || SIMPLE_TABLE_CELL_UNSAFE_RE.test(line)) return null;
    const cells = line.slice(1, -1).split("|").map(trimTablePadding);
    return cells.length > 0 && cells.every(value => !SIMPLE_TABLE_CELL_UNSAFE_RE.test(value))
      ? cells : null;
  };
  const headers = parseRow(lines[0]);
  const delimiter = parseRow(lines[1]);
  if (!headers || !delimiter || !headers.length || delimiter.length !== headers.length
    || delimiter.some(cell => !/^:?-{3,}:?$/.test(cell))) return null;
  const rows = lines.slice(2).map(parseRow);
  if (rows.some(row => !row || row.length !== headers.length)) return null;
  if (headers.length > MAX_COLUMNS || headers.length * (rows.length + 2) > MAX_CELLS) return null;
  const fragmentBytes = textEncoder.encode(source).byteLength;
  if (fragmentBytes > MAX_BYTES) return null;
  return {
    start: 0, end: source.length, lineStart: 0, lineEnd: source.length,
    newline, prefix: "", continuationPrefix: "",
    headers: headers.map(value => ({ value, raw: value })),
    rows: (rows as string[][]).map(row => row.map(value => ({ value, raw: value }))),
    alignments: delimiter.map(cell => cell.startsWith(":")
      ? (cell.endsWith(":") ? "center" : "left")
      : cell.endsWith(":") ? "right" : null),
    hadDelimiter: true,
    diagnostics: ["统一首尾竖线、分隔线与单元格边界空白；保留单元格内部内容。"],
    currentRow: -2,
    currentColumn: -1,
  };
}

type SimpleMarkdownTableDraft = Pick<MarkdownTableModel,
  "headers" | "rows" | "alignments" | "newline" | "prefix" | "continuationPrefix">;

/** Update one plain canonical table line without reparsing every cell's syntax.
 * Arbitrary edits, structural changes, rich inline syntax, and mixed line
 * endings deliberately return null so the full parser remains authoritative. */
export function updateSimpleMarkdownTableDraft(
  previousSource: string,
  previousDraft: SimpleMarkdownTableDraft,
  nextSource: string,
): SimpleMarkdownTableDraft | null {
  if (!previousSource || previousSource === nextSource || nextSource.length > MAX_BYTES
    || previousDraft.prefix || previousDraft.continuationPrefix
    || previousDraft.headers.some(cell => SIMPLE_TABLE_CELL_UNSAFE_RE.test(cell.value))
    || previousDraft.rows.some(row => row.some(cell => SIMPLE_TABLE_CELL_UNSAFE_RE.test(cell.value)))) return null;
  const newline = previousDraft.newline;
  if (!nextSource || (newline === "\n" && nextSource.includes("\r"))
    || textEncoder.encode(nextSource).byteLength > MAX_BYTES) return null;
  const oldLines = previousSource.split(newline);
  const nextLines = nextSource.split(newline);
  if (oldLines.length !== previousDraft.rows.length + 2 || nextLines.length !== oldLines.length
    || nextLines.some(line => !line.trim())) return null;
  let prefix = 0;
  while (prefix < previousSource.length && prefix < nextSource.length && previousSource[prefix] === nextSource[prefix]) prefix++;
  let oldEnd = previousSource.length;
  let nextEnd = nextSource.length;
  while (oldEnd > prefix && nextEnd > prefix && previousSource[oldEnd - 1] === nextSource[nextEnd - 1]) {
    oldEnd--;
    nextEnd--;
  }
  const oldEdit = previousSource.slice(prefix, oldEnd);
  const nextEdit = nextSource.slice(prefix, nextEnd);
  if ((!oldEdit && !nextEdit) || oldEdit.includes("\n") || oldEdit.includes("\r")
    || nextEdit.includes("\n") || nextEdit.includes("\r")) return null;
  const lastNewline = previousSource.lastIndexOf(newline, prefix - 1);
  const lineStart = lastNewline < 0 ? 0 : lastNewline + newline.length;
  const lineIndex = previousSource.slice(0, lineStart).split(newline).length - 1;
  if (lineIndex < 0 || lineIndex >= oldLines.length) return null;
  const line = nextLines[lineIndex];
  if (!line.startsWith("|") || !line.endsWith("|") || SIMPLE_TABLE_CELL_UNSAFE_RE.test(line)) return null;
  const values = line.slice(1, -1).split("|").map(trimTablePadding);
  if (!values.length || values.some(value => SIMPLE_TABLE_CELL_UNSAFE_RE.test(value))) return null;
  if (lineIndex === 1) {
    if (values.length !== previousDraft.headers.length || values.some(value => !/^:?-{3,}:?$/.test(value))) return null;
    return {
      ...previousDraft,
      alignments: values.map(value => value.startsWith(":")
        ? (value.endsWith(":") ? "center" : "left")
        : value.endsWith(":") ? "right" : null),
    };
  }
  if (lineIndex === 0) {
    if (values.length !== previousDraft.headers.length) return null;
    return {
      ...previousDraft,
      headers: values.map(value => ({ value, raw: value })),
    };
  }
  const rowIndex = lineIndex - 2;
  if (rowIndex >= previousDraft.rows.length || values.length !== previousDraft.headers.length) return null;
  const rows = previousDraft.rows.slice();
  rows[rowIndex] = values.map(value => ({ value, raw: value }));
  return { ...previousDraft, rows };
}

export function applyMarkdownTableAction(source: string, from: number, to: number, action: MarkdownTableAction, context?: MarkdownTableSourceContext):
  { from: number; to: number; insert: string; selection: { anchor: number; head?: number }; model?: MarkdownTableModel } | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > source.length) return null;
  if (action.type === "replace") {
    if (textEncoder.encode(action.markdown).byteLength > MAX_BYTES) return null;
    const original = inspectMarkdownTable(source, from, to, context);
    const model = inspectMarkdownTableDraft(action.markdown);
    if (!original || !model) return null;
    const insert = renderMarkdownTable(model.headers, model.rows, model.alignments, original.newline, original.prefix, original.continuationPrefix);
    if (textEncoder.encode(insert).byteLength > MAX_BYTES) return null;
    return {
      from: original.start,
      to: original.end,
      insert,
      selection: { anchor: original.start + original.prefix.length + 2 },
      model,
    };
  }
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
  const model = inspectMarkdownTable(source, from, to, context);
  if (!model) return null;
  let next = model;
  if (action.type === "add-row") {
    if (!integerIn(action.count, 1, 100)) return null;
    const index = model.currentRow === -2 ? model.rows.length : model.currentRow < 0 ? 0
      : model.currentRow + (action.position === "after" ? 1 : 0);
    const changed = changeMarkdownTableStructure(model, { type: "insert-row", index, count: action.count });
    if (!changed) return null;
    next = changed;
  } else if (action.type === "add-column") {
    if (!integerIn(action.count, 1, 50)) return null;
    const index = model.currentColumn < 0 ? model.headers.length : model.currentColumn + (action.position === "after" ? 1 : 0);
    const changed = changeMarkdownTableStructure(model, { type: "insert-column", index, count: action.count });
    if (!changed) return null;
    next = changed;
  } else if (action.type !== "normalize") {
    const changed = changeMarkdownTableStructure(model, action);
    if (!changed) return null;
    next = changed;
  }
  const { headers, rows, alignments } = next;
  if (headers.length > MAX_COLUMNS || (rows.length + 2) > MAX_LINES || headers.length * (rows.length + 2) > MAX_CELLS) return null;
  const insert = renderMarkdownTable(headers, rows, alignments, model.newline, model.prefix, model.continuationPrefix);
  if (textEncoder.encode(insert).byteLength > MAX_BYTES) return null;
  return { from: model.start, to: model.end, insert, selection: { anchor: model.start + model.prefix.length + 2 }, model };
}

export function renderMarkdownTable(headers: MarkdownTableCell[], rows: MarkdownTableCell[][],
  alignments: MarkdownTableAlignment[], newline = "\n", prefix = "", continuationPrefix = prefix): string {
  const cells = (row: MarkdownTableCell[], rowPrefix = "") => renderMarkdownTableRow(row, rowPrefix);
  const delimiter = `| ${headers.map((_, index) => alignments[index] === "center" ? ":---:"
    : alignments[index] === "right" ? "---:" : alignments[index] === "left" ? ":---" : "---").join(" | ")} |`;
  return [prefix + cells(headers), continuationPrefix + delimiter, ...rows.map(row => continuationPrefix + cells(row))].join(newline);
}

export function renderMarkdownTableRow(row: MarkdownTableCell[], prefix = ""): string {
  return prefix + `| ${row.map(cell => escapePipes(cell.value)).join(" | ")} |`;
}

/** Validate inline structure for a single grid-cell edit without reparsing the
 * rest of an already accepted table. The serializer escapes cell pipes first,
 * so a valid cell cannot change the table's row/column structure. */
export function isMarkdownTableCellValueValid(value: string): boolean {
  if (value.length > MAX_BYTES || /[\r\n]/.test(value)) return false;
  const parsed = parseRow(`| ${escapePipes(value)} |`);
  return parsed.balanced && parsed.cells.length === 1;
}

function parseRow(line: string) {
  const text = trimTablePadding(line);
  const values: string[] = [], boundaries: number[] = [];
  const brackets: TableBracketKind[] = [];
  const bracketKind = createTableBracketKindReader(text);
  const codeSpanHasClose = createTableCodeSpanReader(text);
  // Only actual table-tag syntax is structural. Code, escapes, alt/reference
  // data and attribute prose such as `colspan=2` must remain editable text.
  // Sticky matching avoids copying/scanning the suffix at every '<'.
  const htmlTableTag = /<\/?(?:table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col)(?=[\t\n\f\r />]|$)/iy;
  let current = "", backticks = 0, parentheses = 0, hasPipe = false, invalidStructure = false, encodedByteGrowth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const math = !backticks && !parentheses && (character === "\\" || character === "$")
      && brackets.at(-1) !== "alt" && brackets.at(-1) !== "reference"
      ? tableMathAt(text, index, !brackets.length || brackets.at(-1) === "caption") : null;
    if (math) {
      current += text.slice(index, math.end);
      invalidStructure ||= math.invalid;
      encodedByteGrowth += math.encodedByteGrowth;
      index = math.end - 1;
      continue;
    }
    // A backslash cannot escape the closing backtick inside a code span.
    if (character === "\\" && index + 1 < text.length && (!backticks || text[index + 1] !== "`")) {
      current += character + text[++index]; continue;
    }
    if (character === "`") {
      let end = index + 1;
      while (text[end] === "`") end++;
      const length = end - index;
      if (backticks === length) backticks = 0;
      else if (!backticks && codeSpanHasClose(index)) backticks = length;
      current += text.slice(index, end); index = end - 1; continue;
    }
    if (!backticks) {
      if (character === "<" && !parentheses && brackets.at(-1) !== "alt" && !tableReferenceBracket(brackets.at(-1))) {
        htmlTableTag.lastIndex = index;
        // Real HTML table/merged-cell semantics cannot be preserved by the
        // pipe-table tool. Use this same refusal for full and single-cell edits.
        invalidStructure ||= htmlTableTag.test(text);
      }
      if (character === "[") brackets.push(bracketKind(index, brackets.at(-1)));
      if (character === "]" && brackets.length) brackets.pop();
      if (character === "(" && (text[index - 1] === "]" || parentheses)) parentheses++;
      if (character === ")" && parentheses) parentheses--;
    }
    if (character === "|" && !backticks && !brackets.length && !parentheses) {
      hasPipe = true;
      boundaries.push(index + 1);
      values.push(trimTablePadding(current)); current = "";
    } else {
      current += character;
      if (character === "|") {
        encodedByteGrowth++;
        // Escaping this pipe would rename the reference while its definition
        // lies outside the selected table. Do not repair only half that link.
        if (tableReferenceBracket(brackets.at(-1))) invalidStructure = true;
      }
    }
  }
  values.push(trimTablePadding(current));
  if (text.startsWith("|")) values.shift();
  if (text.endsWith("|") && !escapedAt(text, text.length - 1)) values.pop();
  if (!text.startsWith("|")) boundaries.unshift(0);
  const cells = values.map(value => ({ value: unescapePipes(value), raw: value }));
  return { cells, hasPipe, boundaries, leadingPipe: text.startsWith("|"), trailingPipe: text.endsWith("|") && !escapedAt(text, text.length - 1),
    balanced: !invalidStructure && backticks === 0 && !brackets.length && parentheses === 0, encodedByteGrowth,
    delimiter: cells.length > 0 && cells.every(cell => /^:?\s*-+\s*:?$/.test(cell.value)) };
}
function escapePipes(value: string) {
  if (!value.includes("|")) return value;
  return mapCellPipes(value, true);
}
function unescapePipes(value: string) {
  if (!value.includes("\\|")) return value;
  return mapCellPipes(value, false);
}

/** Only inline formulas with definite delimiters own their internal pipes.
 * A TeX \| is a norm, not an escaped absolute-value bar. GFM's \| would change
 * a bare TeX | into that different operator, so encode bare math bars as \vert.
 * Text/preamble/macro arguments need a real TeX parser: decline, never guess.
 */
function tableMathAt(text: string, index: number, rewritePipes = true) {
  const character = text[index];
  const delimiter = character === "\\" && (text[index + 1] === "(" || text[index + 1] === "[")
    ? text.slice(index, index + 2) : character === "$" && text[index - 1] !== "$"
      ? (text[index + 1] === "$" ? "$$" : "$") : "";
  if (!delimiter || (character === "$" && text[index + delimiter.length] === "$")) return null;
  const closing = delimiter === "\\(" ? "\\)" : delimiter === "\\[" ? "\\]" : delimiter;
  const bodyStart = index + delimiter.length;
  let bodyEnd = text.indexOf(closing, bodyStart);
  while (bodyEnd >= 0 && (escapedAt(text, bodyEnd)
    || (character === "$" && (text[bodyEnd - 1] === "$" || text[bodyEnd + closing.length] === "$")))) {
    bodyEnd = text.indexOf(closing, bodyEnd + closing.length);
  }
  if (bodyEnd < 0) return character === "\\" ? { end: text.length, bodyStart, bodyEnd: text.length, invalid: true, encodedByteGrowth: 0 } : null;
  const body = text.slice(bodyStart, bodyEnd);
  const trimmed = body.trim();
  // Same currency exclusions as the shared renderer, without importing its AST
  // transform into this pure tool. In particular, $20 | $30 stays two cells.
  if (character === "$" && /^\d/.test(trimmed) && !/[\\_^=<>+*/{}]/.test(trimmed)
    && (/^\d+(?:[.,]\d+)?$/.test(trimmed) || /\b(?:and|or|to|usd|eur|gbp|cny|rmb|dollars?|euros?|yuan)\b/i.test(trimmed) || /\s/.test(trimmed))) return null;
  let barePipes = 0;
  for (let cursor = 0; cursor < body.length; cursor++) {
    if (body[cursor] === "\\" && cursor + 1 < body.length) cursor++;
    else if (body[cursor] === "|") barePipes++;
  }
  return {
    end: bodyEnd + closing.length, bodyStart, bodyEnd, encodedByteGrowth: barePipes * 5,
    invalid: barePipes > 0 && (!rewritePipes || delimiter === "\\["
      || /\\(?:begin|end|text[A-Za-z]*|[mhv]box|(?:f?color|raise)box|tag|verb|char|operatorname|def|gdef|edef|xdef|newcommand|renewcommand|let|color|class|href|url|html[A-Za-z]*)\b/.test(body)),
  };
}

function mapCellPipes(value: string, encode: boolean) {
  let output = "";
  let backticks = 0, linkParentheses = 0;
  const brackets: TableBracketKind[] = [];
  const bracketKind = createTableBracketKindReader(value);
  const codeSpanHasClose = createTableCodeSpanReader(value);
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const math = !backticks && !linkParentheses && (character === "\\" || character === "$")
      && brackets.at(-1) !== "alt" && brackets.at(-1) !== "reference"
      ? tableMathAt(value, index, !brackets.length || brackets.at(-1) === "caption") : null;
    if (math) {
      if (!encode || math.invalid) output += value.slice(index, math.end);
      else {
        output += value.slice(index, math.bodyStart);
        for (let cursor = math.bodyStart; cursor < math.bodyEnd; cursor++) {
          if (value[cursor] === "\\" && cursor + 1 < math.bodyEnd) output += value[cursor] + value[++cursor];
          else output += value[cursor] === "|" ? "\\vert " : value[cursor];
        }
        output += value.slice(math.bodyEnd, math.end);
      }
      index = math.end - 1;
      continue;
    }
    if (character === "\\" && index + 1 < value.length && (!backticks || value[index + 1] !== "`")) {
      // Consume pairs, not individual slashes: an even run before a pipe is
      // literal content, whereas the last slash of an odd run is GFM escaping.
      output += !encode && value[index + 1] === "|" && !tableReferenceBracket(brackets.at(-1)) ? "|" : character + value[index + 1];
      index++;
      continue;
    }
    if (character === "`") {
      let end = index + 1;
      while (value[end] === "`") end++;
      const length = end - index;
      if (backticks === length) backticks = 0;
      else if (!backticks && codeSpanHasClose(index)) backticks = length;
      output += value.slice(index, end);
      index = end - 1;
      continue;
    }
    if (!backticks) {
      if (character === "[") brackets.push(bracketKind(index, brackets.at(-1)));
      if (character === "]" && brackets.length) brackets.pop();
      if (character === "(" && (value[index - 1] === "]" || linkParentheses)) linkParentheses++;
      if (character === ")" && linkParentheses) linkParentheses--;
    }
    output += encode && character === "|" && !tableReferenceBracket(brackets.at(-1)) ? "\\|" : character;
  }
  return output;
}

/** Unpaired backticks are ordinary Markdown text, not an unclosed container.
 * One lazy byte per code unit records which runs have an equal-length closer.
 * Closers ignore backslashes inside code; outside it an escape can consume the
 * first tick of a longer run, so also index that run's one-tick-shorter suffix.
 * Each row/cell owns its index; never rescan the suffix for every opener.
 */
function createTableCodeSpanReader(text: string) {
  let matched: Uint8Array | undefined;
  return (start: number): boolean => {
    if (!matched) {
      matched = new Uint8Array(text.length);
      const lengths = new Set<number>();
      for (let index = text.length - 1; index >= 0;) {
        if (text[index] !== "`") { index--; continue; }
        const end = index + 1;
        while (index >= 0 && text[index] === "`") index--;
        const offset = index + 1, length = end - offset;
        if (lengths.has(length)) matched[offset] = 1;
        if (length > 1 && lengths.has(length - 1)) matched[offset + 1] = 1;
        lengths.add(length);
      }
    }
    return matched[start] === 1;
  };
}

type TableBracketKind = "caption" | "alt" | "reference" | "ambiguous";
function tableReferenceBracket(kind?: TableBracketKind) { return kind === "reference" || kind === "ambiguous"; }
function createTableBracketKindReader(text: string) {
  let nextClosingBracket: Int32Array | undefined;
  return (start: number, parent?: TableBracketKind): TableBracketKind => {
    // Image alt and reference identifiers are data, not visible math captions.
    // Rewriting their TeX-looking text would silently rename a reference/alt.
    if (parent === "alt" || parent === "reference") return parent;
    const precededByMark = !escapedAt(text, start - 1);
    const image = precededByMark && text[start - 1] === "!";
    if (!image && text[start + 1] === "^") return "reference";
    if (precededByMark && text[start - 1] === "]") return "reference";
    if (parent && !image) return parent;
    nextClosingBracket ??= indexTableClosingBrackets(text);
    const end = nextClosingBracket[start + 1];
    if (end >= 0) {
      // A collapsed/shortcut image or link's caption is also its lookup ID.
      // Only an explicit destination or nonempty second label separates them.
      if (text[end + 1] === "[" && text[end + 2] === "]") return "reference";
      if (text[end + 1] === "(" || text[end + 1] === "[") return image ? "alt" : "caption";
      return image ? "reference" : "ambiguous";
    }
    return "ambiguous";
  };
}

/** The first unmatched ] reachable from each offset in normal inline context.
 * A suffix lookup skips nested [...] and backtick spans without depending on
 * earlier code/math context. Unlike rescanning from every opening image, this
 * also stays linear for many unclosed ![ tokens. One ephemeral 4-byte entry per
 * source code unit is allocated lazily, only when bracket classification needs it.
 */
function indexTableClosingBrackets(text: string) {
  const next = new Int32Array(text.length + 1);
  // Mark tokens first. Escapes are consumed in pairs, including inside code,
  // exactly as in the existing conservative table-inline parser.
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\") { index++; continue; }
    if (text[index] === "`") {
      let end = index + 1;
      while (text[end] === "`") end++;
      next[index] = end - index;
      index = end - 1;
    } else if (text[index] === "[") next[index] = -2;
    else if (text[index] === "]") next[index] = -3;
  }
  const nextBacktickRun = new Map<number, number>();
  next[text.length] = -1;
  for (let index = text.length - 1; index >= 0; index--) {
    const token = next[index];
    if (token === -3) next[index] = index;
    else if (token === -2) {
      const end = next[index + 1];
      next[index] = end < 0 ? -1 : next[end + 1];
    } else if (token > 0) {
      const end = nextBacktickRun.get(token);
      next[index] = end === undefined ? -1 : next[end + token];
      nextBacktickRun.set(token, index);
    } else {
      next[index] = next[index + 1];
    }
  }
  return next;
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
  if (count > MAX_LINES || end - start > MAX_BYTES) return null;
  const lines = sourceLines(source.slice(start, end), start);
  const parsed = lines.map(line => parseRow(line.text.slice(linePrefix(line.text).length)));
  const delimiter = parsed.findIndex((row, index) => index > 0 && row.delimiter);
  if (delimiter > 0) {
    // A real delimiter establishes exactly one preceding header, not every
    // adjacent prose line that happens to contain a pipe.
    start = lines[delimiter - 1].start;
    const header = parsed[delimiter - 1];
    for (let index = delimiter + 1; index < parsed.length; index++) {
      const row = parsed[index];
      if ((header.leadingPipe || header.trailingPipe) && !row.leadingPipe && !row.trailingPipe) {
        end = lines[index].start - (source[lines[index].start - 2] === "\r" ? 2 : 1);
        break;
      }
    }
    if (from < start || from > end) return null;
  }
  return { start, end };
}
function sourceLines(fragment: string, base: number): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start <= fragment.length) {
    const newline = fragment.indexOf("\n", start);
    const end = newline < 0 ? fragment.length : newline - (fragment[newline - 1] === "\r" ? 1 : 0);
    lines.push({ start: base + start, end: base + end, text: fragment.slice(start, end) });
    if (newline < 0) break;
    // Each physical newline owns its width, even in mixed CRLF/LF imports.
    start = newline + 1;
  }
  return lines;
}
function tablePrefixes(lines: SourceLine[]): string[] | null {
  const prefixes = lines.map(line => linePrefix(line.text));
  const first = prefixes[0];
  const continued = first.replace(/(?:[-+*]|\d+[.)])([ \t]+)$/, match => " ".repeat(match.length));
  if (!prefixes.slice(1).every(prefix => prefix === continued)) return null;
  return prefixes;
}
function linePrefix(line: string) {
  return line.match(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/)?.[0] ?? "";
}
function insideLiteralBlock(source: string, offset: number, context: MarkdownTableSourceContext | undefined, newline: "\n" | "\r\n") {
  let end = source.indexOf("\n", offset);
  if (end < 0) end = source.length;
  const analysis = context?.rendered;
  if (context?.source === source && analysis?.source === source && analysis.complete) {
    return analysis.literalRanges.some(range => range.start <= offset && offset < range.end);
  }
  // Installed CodeMirror and GFM disagree on textarea and quoted HTML blank
  // lines. Neither its HTMLBlock nor its Paragraph node is sufficient authority
  // here. Require the bounded renderer probe, or an explicit sample selection.
  // This is deliberately a cheap conservative trigger, not an HTML scanner.
  if (source.slice(0, end).includes("<")) return true;
  // The editor normally supplies its existing tree. Standalone transformations
  // parse only through the header line, never the table body or following text.
  // Do not reuse an incomplete tree or one belonging to another source revision.
  // CodeMirror editor text uses LF. Raw CRLF strings need an offset-preserving
  // parser view: Lezer otherwise sees the CR as content on an HTML blank line.
  // Never trust a raw-string CRLF tree to override that normalized context.
  const tree = newline !== "\r\n" && context?.source === source && typeof context.parsedTo === "number" && Number.isInteger(context.parsedTo)
    && context.parsedTo >= end && context.parsedTo <= source.length && context.tree && context.tree.length >= context.parsedTo
    ? context.tree : markdownLanguage.parser.parse(source.slice(0, end).replace(/\r(?=\n|$)/g, " "));
  // Stay in the outer Markdown tree even if code/HTML mounts another language.
  // These blocks contain literal source, not GFM tables. Explicit selections
  // can still edit examples, but normalization must not remove their wrappers.
  for (let node: ReturnType<typeof tree.resolve> | null = tree.resolve(offset, 1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock"
      || node.name === "HTMLBlock" || node.name === "CommentBlock" || node.name === "ProcessingInstructionBlock") return true;
  }
  return false;
}
function pad(cells: MarkdownTableCell[], size: number) { return Array.from({ length: size }, (_, index) => cells[index] ?? empty()); }
function integerIn(value: number, minimum: number, maximum: number) { return Number.isInteger(value) && value >= minimum && value <= maximum; }
