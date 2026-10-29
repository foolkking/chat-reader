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

  const rows: string[][] = [];
  let hasHeader = false;
  let cellCount = 0;
  for (const section of node.children ?? []) {
    if (section.tagName === "thead") hasHeader = true;
    const sectionRows = section.tagName === "tr"
      ? [section]
      : (section.children ?? []).filter((child) => child.tagName === "tr");
    for (const row of sectionRows) {
      const cells = (row.children ?? []).filter((child) => child.tagName === "th" || child.tagName === "td");
      rows.push(cells.map(readCellText));
      cellCount += cells.length;
      if (cellCount > MAX_EXPORTED_TABLE_CELLS) return { tooLarge: true };
    }
  }

  if (!rows.length) return null;
  const totalCells = rows.reduce((total, row) => total + row.length, 0);
  return totalCells <= MAX_EXPORTED_TABLE_CELLS ? { rows, hasHeader } : { tooLarge: true };
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
  return (node.children ?? []).map(readCellText).join("");
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
