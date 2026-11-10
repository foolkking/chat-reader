export const TABLE_PREVIEW_LIMITS = {
  rows: 10_001, columns: 256, cells: 50_000, fieldUnits: 4_096, inputUnits: 2 * 1024 * 1024,
  pageRows: 50, pageCells: 2_000,
} as const;
export type TablePreviewLimit = "rows" | "columns" | "cells" | "field" | "input" | "quotes";
export type DelimitedPreview = { rows: string[][]; columns: number; stoppedAt: TablePreviewLimit | null };
type PreviewBudget = { rows: number; columns: number; cells: number; fieldUnits: number; inputUnits: number };

// A preview is an ordered prefix. Stop at the first exceeded budget; never
// skip a wide row and accidentally promote a later data row to the header.
// Limits count UTF-16 units/cells, not bytes or measured browser memory.
export function parseDelimitedPreview(text: string, delimiter: string, budget?: Partial<PreviewBudget>): DelimitedPreview {
  if (delimiter !== "," && delimiter !== "\t") throw new Error("Unsupported delimiter");
  const limits: PreviewBudget = { ...TABLE_PREVIEW_LIMITS };
  for (const key of ["rows", "columns", "cells", "fieldUnits", "inputUnits"] as const) {
    const requested = budget?.[key];
    if (requested !== undefined && Number.isFinite(requested)) {
      limits[key] = Math.min(limits[key], Math.max(1, Math.floor(requested)));
    }
  }
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, started = false, cells = 0, columns = 0;
  let stoppedAt: TablePreviewLimit | null = null;
  const finishRow = () => { if (row.length) { columns = Math.max(columns, row.length); rows.push(row); row = []; } };
  const finishField = () => { row.push(field); cells++; field = ""; started = false; };
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; index < text.length; index++) {
    if (index >= limits.inputUnits) { stoppedAt = "input"; break; }
    if (rows.length >= limits.rows) { stoppedAt = "rows"; break; }
    if (row.length >= limits.columns) { stoppedAt = "columns"; break; }
    if (cells >= limits.cells) { stoppedAt = "cells"; break; }
    const char = text[index];
    let value = "";
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value = '"'; index++; }
      else { quoted = !quoted; started = true; }
    } else if (char === delimiter && !quoted) {
      finishField(); started = true;
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      finishField(); finishRow();
    } else {
      const code = text.charCodeAt(index), next = text.charCodeAt(index + 1);
      const pair = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
      value = pair ? text.slice(index, index + 2) : char;
      if (pair) index++;
    }
    if (value) {
      if (index >= limits.inputUnits) { stoppedAt = "input"; break; }
      if (field.length + value.length > limits.fieldUnits) { stoppedAt = "field"; break; }
      field += value; started = true;
    }
  }
  if (!stoppedAt && quoted) stoppedAt = "quotes";
  if (rows.length < limits.rows) {
    if ((started || field.length) && row.length < limits.columns && cells < limits.cells) finishField();
    else if (!stoppedAt && started) stoppedAt = row.length >= limits.columns ? "columns" : "cells";
    finishRow();
  }
  return { rows, columns, stoppedAt };
}

/** Same quoted-field grammar as Viewer, with a smaller bounded reading prefix.
 * One lookahead record decides expansion; embedded newlines are not new rows. */
export function parseInlineDelimitedPreview(text: string, delimiter: string, expanded = false) {
  const visibleRows = expanded ? 28 : 8;
  const preview = parseDelimitedPreview(text, delimiter, {
    rows: visibleRows + 1, cells: (visibleRows + 1) * TABLE_PREVIEW_LIMITS.columns, inputUnits: 131_072,
  });
  return {
    rows: preview.rows.slice(0, visibleRows).map(row => row.slice(0, 8)),
    hasMoreRows: preview.rows.length > visibleRows,
    limited: preview.rows.length > visibleRows || preview.columns > 8 || preview.stoppedAt !== null,
  };
}

// Retain the existing small-file parser contract for callers needing rows only.
export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  return parseDelimitedPreview(text, delimiter).rows;
}

export function tablePreviewPageSize(columns: number): number {
  return Math.min(TABLE_PREVIEW_LIMITS.pageRows, Math.max(1, Math.floor(TABLE_PREVIEW_LIMITS.pageCells / Math.max(1, columns))));
}
