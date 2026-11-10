export type MarkdownTableNode = {
  type?: string;
  tagName?: string;
  value?: unknown;
  properties?: Record<string, unknown>;
  children?: MarkdownTableNode[];
};

export type MarkdownTableData = {
  rows: string[][];
  hasHeader: boolean;
};

export type MarkdownTableReadResult = MarkdownTableData | { tooLarge: true };

export type TableExportFormat = "tsv" | "csv";

export const MAX_EXPORTED_TABLE_CELLS = 50_000;

export function readMarkdownTableData(node: unknown): MarkdownTableReadResult | null {
  if (!isTableNode(node)) return null;

  const cellRows: MarkdownTableNode[][] = [];
  let hasHeader = false;
  let cellCount = 0;
  for (const section of node.children ?? []) {
    if (section.tagName === "thead") hasHeader = true;
    const sectionRows = section.tagName === "tr" ? [section] : section.children ?? [];
    for (const row of sectionRows) {
      if (row.tagName !== "tr") continue;
      const cells: MarkdownTableNode[] = [];
      for (const cell of row.children ?? []) {
        if (cell.tagName !== "th" && cell.tagName !== "td") continue;
        if (++cellCount > MAX_EXPORTED_TABLE_CELLS) return { tooLarge: true };
        cells.push(cell);
      }
      if (cells.length) cellRows.push(cells);
    }
  }

  // Establish the complete bound before walking any (potentially dense math)
  // cell contents. Never materialize a partial oversized export.
  if (!cellCount) return null;
  return { rows: cellRows.map(cells => cells.map(readCellText)), hasHeader };
}

export function serializeTableData(
  rows: string[][],
  format: TableExportFormat,
  { includeHeader = true, protectFormulaCells = true, hasHeader = false } = {},
): { text: string; protectedCellCount: number } {
  const selectedRows = includeHeader || !hasHeader ? rows : rows.slice(1);
  let protectedCellCount = 0;
  const text = selectedRows.map((row) => row.map((cell) => {
    let value = cell;
    if (protectFormulaCells && isFormulaLikeCell(value)) {
      value = `'${value}`;
      protectedCellCount += 1;
    }
    return escapeDelimitedCell(value, format);
  }).join(format === "tsv" ? "\t" : ",")).join("\r\n");
  return { text, protectedCellCount };
}

function isTableNode(value: unknown): value is MarkdownTableNode {
  return Boolean(value && typeof value === "object" && (value as MarkdownTableNode).tagName === "table");
}

function readCellText(node: MarkdownTableNode): string {
  if (node.type === "text") return typeof node.value === "string" ? node.value : "";
  if (node.tagName === "br") return "\n";
  if (node.tagName === "img") {
    const alt = node.properties?.alt;
    return typeof alt === "string" ? alt : "";
  }
  const classes = node.properties?.className;
  if ((Array.isArray(classes) ? classes : String(classes ?? "").split(/\s+/)).includes("katex")) {
    const source = findMathSource(node);
    // KaTeX contains accessible MathML, its TeX annotation and visual HTML.
    // Export the annotation once, without changing any rendered/accessible DOM.
    if (source !== null) return source;
  }
  return (node.children ?? []).map(readCellText).join("");
}

function findMathSource(node: MarkdownTableNode): string | null {
  if (node.tagName === "annotation" && node.properties?.encoding === "application/x-tex") {
    return (node.children ?? []).map(readCellText).join("");
  }
  for (const child of node.children ?? []) {
    const source = findMathSource(child);
    if (source !== null) return source;
  }
  return null;
}

function isFormulaLikeCell(value: string): boolean {
  const first = value.trimStart()[0];
  if (first === "=" || first === "+" || first === "@") return true;
  if (first !== "-") return false;
  return !/^\s*-\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value);
}

function escapeDelimitedCell(value: string, format: TableExportFormat): string {
  const requiresQuotes = format === "csv"
    ? /[",\r\n]/.test(value)
    : /["\t\r\n]/.test(value);
  return requiresQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}
