export const TABLE_PREVIEW_LIMITS = {
  rows: 10_001, columns: 256, cells: 50_000, fieldUnits: 4_096, inputUnits: 2 * 1024 * 1024,
  pageRows: 50, pageCells: 2_000,
} as const;
export type TablePreviewLimit = "rows" | "columns" | "cells" | "field" | "input" | "quotes";
export type DelimitedPreview = { rows: string[][]; columns: number; stoppedAt: TablePreviewLimit | null };

// A preview is an ordered prefix. Stop at the first exceeded budget; never
// skip a wide row and accidentally promote a later data row to the header.
// Limits count UTF-16 units/cells, not bytes or measured browser memory.
export function parseDelimitedPreview(text: string, delimiter: string): DelimitedPreview {
  if (delimiter !== "," && delimiter !== "\t") throw new Error("Unsupported delimiter");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, started = false, cells = 0, columns = 0;
  let stoppedAt: TablePreviewLimit | null = null;
  const finishRow = () => { if (row.length) { columns = Math.max(columns, row.length); rows.push(row); row = []; } };
  const finishField = () => { row.push(field); cells++; field = ""; started = false; };
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; index < text.length; index++) {
    if (index >= TABLE_PREVIEW_LIMITS.inputUnits) { stoppedAt = "input"; break; }
    if (rows.length >= TABLE_PREVIEW_LIMITS.rows) { stoppedAt = "rows"; break; }
    if (row.length >= TABLE_PREVIEW_LIMITS.columns) { stoppedAt = "columns"; break; }
    if (cells >= TABLE_PREVIEW_LIMITS.cells) { stoppedAt = "cells"; break; }
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
      if (index >= TABLE_PREVIEW_LIMITS.inputUnits) { stoppedAt = "input"; break; }
      if (field.length + value.length > TABLE_PREVIEW_LIMITS.fieldUnits) { stoppedAt = "field"; break; }
      field += value; started = true;
    }
  }
  if (!stoppedAt && quoted) stoppedAt = "quotes";
  if (rows.length < TABLE_PREVIEW_LIMITS.rows) {
    if ((started || field.length) && row.length < TABLE_PREVIEW_LIMITS.columns && cells < TABLE_PREVIEW_LIMITS.cells) finishField();
    else if (!stoppedAt && started) stoppedAt = row.length >= TABLE_PREVIEW_LIMITS.columns ? "columns" : "cells";
    finishRow();
  }
  return { rows, columns, stoppedAt };
}

// Retain the existing small-file parser contract for callers needing rows only.
export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  return parseDelimitedPreview(text, delimiter).rows;
}

export function tablePreviewPageSize(columns: number): number {
  return Math.min(TABLE_PREVIEW_LIMITS.pageRows, Math.max(1, Math.floor(TABLE_PREVIEW_LIMITS.pageCells / Math.max(1, columns))));
}
