"use client";

import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, X } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { MarkdownTablePreview } from "../conversations/markdown-renderer";
import { collectMarkdownTableReferenceContext } from "./markdown-table-reference-preview";
import { needsMarkdownTableSourceAnalysis, type MarkdownTableSourceAnalysis } from "./markdown-table-source-analysis";
import { MarkdownTableSourceProbe } from "./markdown-table-source-probe";
import {
  inspectMarkdownTable,
  inspectMarkdownTableDraft,
  isMarkdownTableCellValueValid,
  MARKDOWN_TABLE_LIMITS,
  renderMarkdownTable,
  renderMarkdownTableRow,
  type MarkdownTableAction,
  type MarkdownTableModel,
  type MarkdownTableSourceContext,
  updateSimpleMarkdownTableDraft,
} from "./markdown-table-tools";

type TableDraft = Pick<MarkdownTableModel, "headers" | "rows" | "alignments" | "newline" | "prefix" | "continuationPrefix">;
type SerializedMarkdown = {
  text: string;
  byteLength: number;
  replacedLineIndex?: number;
  replacedLineDelta?: number;
};
const EMPTY_TABLE_ROWS: TableDraft["rows"] = [];
const TABLE_CELL_TITLE_CODE_UNITS = 240;
const TABLE_PREVIEW_MAX_CELLS = 400;
const TABLE_PREVIEW_LARGE_INPUT_CELLS = 120;
const TABLE_PREVIEW_LARGE_INPUT_THRESHOLD = 3_200;
const textEncoder = new TextEncoder();
const emptyCell = () => ({ value: "", raw: "" });
const serialize = (draft: TableDraft) => renderMarkdownTable(draft.headers, draft.rows, draft.alignments, draft.newline, draft.prefix, draft.continuationPrefix);
const TABLE_TOOL_PREVIEW_CELL_CODE_UNITS = 32 * 1024;
const previewCellTooLarge = (value: string) => value.length > TABLE_TOOL_PREVIEW_CELL_CODE_UNITS;
const previewCellPlaceholder = (cell: TableDraft["headers"][number]) =>
  previewCellTooLarge(cell.value) ? { ...cell, value: "" } : cell;
const cellTitle = (value: string, label: string, zh: boolean) => {
  if (!value) return label;
  if (previewCellTooLarge(value)) return zh
    ? "内容较长；完整内容保留在下方 Markdown"
    : "Long content; full value remains in the Markdown editor below";
  return value.length > TABLE_CELL_TITLE_CODE_UNITS
    ? `${value.slice(0, TABLE_CELL_TITLE_CODE_UNITS - 1)}…`
    : value;
};
const EDGE_BUTTON = "inline-flex h-11 w-11 items-center justify-center rounded-md text-sm text-secondary opacity-0 hover:bg-[var(--accent-soft)] hover:text-primary hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] group-focus-within/table:opacity-100 [@media(hover:none)]:opacity-100 disabled:cursor-not-allowed disabled:text-secondary disabled:opacity-30";
const EDGE_MARK = <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-ui bg-surface">+</span>;
const PAGE_BUTTON = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-subtle active:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-default disabled:opacity-40";

export function TableToolDialog({ zh, source, range, stale, onRefresh, onClose, onApply, restoreFocus }: {
  zh: boolean;
  source: string;
  range: { from: number; to: number; revision: number; context?: MarkdownTableSourceContext };
  stale: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onApply: (action: MarkdownTableAction, context?: MarkdownTableSourceContext) => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const needsAnalysis = needsMarkdownTableSourceAnalysis(source);
  const [analysis, setAnalysis] = useState<MarkdownTableSourceAnalysis | null>(null);
  const acceptAnalysis = useCallback((result: MarkdownTableSourceAnalysis) => {
    if (result.source === source) setAnalysis(result);
  }, [source]);
  const checkingSource = needsAnalysis && analysis?.source !== source;
  const sourceContext = useMemo(() => ({
    ...range.context, source, rendered: analysis?.source === source ? analysis : undefined,
  }), [analysis, range.context, source]);
  const original = useMemo(() => checkingSource ? null : inspectMarkdownTable(source, range.from, range.to, sourceContext),
    [checkingSource, range.from, range.to, source, sourceContext]);
  const referenceContext = useMemo(() => collectMarkdownTableReferenceContext(source, analysis ?? undefined), [analysis, source]);
  const initialMarkdown = useMemo(() => original ? serialize(original) : "", [original]);
  const [draft, setDraft] = useState<TableDraft | null>(original);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [draftValid, setDraftValid] = useState(Boolean(original));
  const [rawInvalid, setRawInvalid] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [sourceMarkdownNeedsParse, setSourceMarkdownNeedsParse] = useState(false);
  const [markdownCanonical, setMarkdownCanonical] = useState(true);
  const [markdownByteLength, setMarkdownByteLength] = useState(() => textEncoder.encode(initialMarkdown).byteLength);
  const [page, setPage] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const canonicalLineStartsRef = useRef<number[] | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const restorePagerFocus = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [verifiedPreview, setVerifiedPreview] = useState<string | null>(null);
  const [checkedPreview, setCheckedPreview] = useState<string | null>(null);
  const [cellFocusTarget, setCellFocusTarget] = useState<{ row: number; column: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; column: number } | null>(null);
  useDialogFocus({ open: true, rootRef: dialogRef, onClose, restoreFocus });
  // Only the frozen opening snapshot can initialize this state. The read-only
  // context probe commits before editing becomes available; it never follows
  // cell input or resets a user's in-progress draft.
  useLayoutEffect(() => {
    setDraft(original);
    setMarkdown(initialMarkdown);
    setDraftValid(Boolean(original));
    setRawInvalid(false);
    setActionError(false);
    setSourceMarkdownNeedsParse(false);
    setMarkdownCanonical(true);
    setMarkdownByteLength(textEncoder.encode(initialMarkdown).byteLength);
    canonicalLineStartsRef.current = null;
    setPage(0);
    setEditingCell(null);
  }, [initialMarkdown, original]);

  // Bound both rows and cells: very wide tables need additional pages to keep
  // Markdown reconciliation and editable controls responsive.
  const tableCellCount = draft ? draft.headers.length * (draft.rows.length + 2) : 0;
  const previewCellBudget = tableCellCount > TABLE_PREVIEW_LARGE_INPUT_THRESHOLD
    ? TABLE_PREVIEW_LARGE_INPUT_CELLS
    : TABLE_PREVIEW_MAX_CELLS;
  const pageSize = draft ? Math.max(1, Math.min(30, Math.floor(previewCellBudget / draft.headers.length) - 1)) : 30;
  const pages = Math.max(1, Math.ceil((draft?.rows.length ?? 0) / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rowOffset = currentPage * pageSize;
  const visibleRows = useMemo(
    () => draft?.rows.slice(rowOffset, rowOffset + pageSize) ?? EMPTY_TABLE_ROWS,
    [draft?.rows, pageSize, rowOffset],
  );
  const largePreviewCellCount = useMemo(
    () => {
      if (!draft) return 0;
      let count = draft.headers.reduce((total, cell) => total + (previewCellTooLarge(cell.value) ? 1 : 0), 0);
      for (const row of visibleRows) {
        for (const cell of row) count += previewCellTooLarge(cell.value) ? 1 : 0;
      }
      return count;
    },
    [draft, visibleRows],
  );
  const previewMarkdown = useMemo(
    () => draft ? serialize({
      ...draft,
      headers: draft.headers.map(previewCellPlaceholder),
      rows: visibleRows.map(row => row.map(previewCellPlaceholder)),
      // The table's quote/list ancestors may be outside its edit range. Preview
      // the table itself; retain the original prefixes in Markdown and Apply.
      prefix: "",
      continuationPrefix: "",
    })
      + (referenceContext.markdown ? `\n\n${referenceContext.markdown}` : "") : "",
    [draft, referenceContext.markdown, visibleRows],
  );
  // Keep textarea/grid input urgent while allowing the shared GFM/Math renderer
  // to coalesce intermediate snapshots during rapid typing. Apply remains
  // disabled until the rendered snapshot catches up and is structurally checked.
  const renderedPreviewMarkdown = useDeferredValue(previewMarkdown);
  // Keep the Markdown textarea urgent. A large pasted/edited table is parsed
  // on the deferred path; a grid edit already has a parsed draft and must not
  // immediately parse the full serialized table again.
  const deferredMarkdown = useDeferredValue(markdown);
  const parsedDeferredMarkdown = useMemo(
    () => sourceMarkdownNeedsParse && deferredMarkdown === markdown
      ? inspectMarkdownTableDraft(deferredMarkdown)
      : null,
    [deferredMarkdown, markdown, sourceMarkdownNeedsParse],
  );
  const previewPending = sourceMarkdownNeedsParse || renderedPreviewMarkdown !== previewMarkdown;
  const draftRef = useRef<TableDraft | null>(draft);
  const markdownRef = useRef(markdown);
  const markdownByteLengthRef = useRef(markdownByteLength);
  const draftValidRef = useRef(draftValid);
  const rawInvalidRef = useRef(rawInvalid);
  const sourceMarkdownNeedsParseRef = useRef(sourceMarkdownNeedsParse);
  const markdownCanonicalRef = useRef(markdownCanonical);
  const rowOffsetRef = useRef(rowOffset);
  const previewPendingRef = useRef(previewPending);
  const currentPageRef = useRef(currentPage);
  const pageSizeRef = useRef(pageSize);
  draftRef.current = draft;
  markdownRef.current = markdown;
  markdownByteLengthRef.current = markdownByteLength;
  draftValidRef.current = draftValid;
  rawInvalidRef.current = rawInvalid;
  sourceMarkdownNeedsParseRef.current = sourceMarkdownNeedsParse;
  markdownCanonicalRef.current = markdownCanonical;
  rowOffsetRef.current = rowOffset;
  previewPendingRef.current = previewPending;
  currentPageRef.current = currentPage;
  pageSizeRef.current = pageSize;
  useLayoutEffect(() => {
    if (!sourceMarkdownNeedsParse || deferredMarkdown !== markdown || !original) return;
    setSourceMarkdownNeedsParse(false);
    if (!parsedDeferredMarkdown) {
      setDraftValid(false);
      setRawInvalid(true);
      return;
    }
    // Editing Markdown must not silently remove a quote/list container or
    // convert the surrounding document's CRLF convention.
    setDraft({
      ...parsedDeferredMarkdown,
      newline: original.newline,
      prefix: original.prefix,
      continuationPrefix: original.continuationPrefix,
    });
    const byteLength = textEncoder.encode(deferredMarkdown).byteLength;
    markdownByteLengthRef.current = byteLength;
    setMarkdownByteLength(byteLength);
    setDraftValid(true);
    setRawInvalid(false);
  }, [deferredMarkdown, markdown, original, parsedDeferredMarkdown, sourceMarkdownNeedsParse]);
  useLayoutEffect(() => {
    const table = previewRef.current?.querySelector("table");
    const valid = table && table.rows.length === visibleRows.length + 1
      && Array.from(table.rows).every(row => row.cells.length === draft?.headers.length);
    setCheckedPreview(renderedPreviewMarkdown);
    setVerifiedPreview(valid ? renderedPreviewMarkdown : null);
  }, [draft?.headers.length, renderedPreviewMarkdown, visibleRows.length]);
  const previewShapeInvalid = Boolean(
    draft && draftValid && !rawInvalid && !previewPending
      && renderedPreviewMarkdown === previewMarkdown
      && checkedPreview === previewMarkdown
      && verifiedPreview === null,
  );
  const ready = Boolean(original && draft && draftValid && !rawInvalid && !stale && !previewPending
    && renderedPreviewMarkdown === previewMarkdown && verifiedPreview === previewMarkdown);
  const canAddRow = Boolean(draft && draftValid && !rawInvalid && !previewPending && draft.rows.length + 3 <= MARKDOWN_TABLE_LIMITS.lines
    && draft.headers.length * (draft.rows.length + 3) <= MARKDOWN_TABLE_LIMITS.cells);
  const canAddColumn = Boolean(draft && draftValid && !rawInvalid && !previewPending && draft.headers.length < MARKDOWN_TABLE_LIMITS.columns
    && (draft.headers.length + 1) * (draft.rows.length + 2) <= MARKDOWN_TABLE_LIMITS.cells);
  useLayoutEffect(() => {
    if (!restorePagerFocus.current) return;
    restorePagerFocus.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !pagerRef.current?.contains(active)) return;
    if (active instanceof HTMLButtonElement && !active.disabled) return;
    // A boundary command disables its own focused button. Keep keyboard flow
    // in the pager instead of dropping to BODY or entering a data cell.
    pagerRef.current?.querySelector<HTMLButtonElement>(
      currentPage === 0 ? '[data-table-page="next"]' : '[data-table-page="previous"]',
    )?.focus({ preventScroll: true });
  }, [currentPage]);
  useLayoutEffect(() => {
    if (!cellFocusTarget || previewPending) return;
    const active = document.activeElement;
    // A deferred page preview can settle after the user has deliberately moved
    // to Markdown or another control. Never steal that newer focus decision.
    if (active instanceof HTMLElement && active !== document.body && !gridRef.current?.contains(active)) {
      setCellFocusTarget(null);
      return;
    }
    const targetPage = cellFocusTarget.row === 0 ? currentPage : Math.floor((cellFocusTarget.row - 1) / pageSize);
    if (targetPage !== currentPage) return;
    const target = previewRef.current?.querySelector<HTMLButtonElement>(
      `[data-table-cell][data-row-index="${cellFocusTarget.row}"][data-column-index="${cellFocusTarget.column}"]`,
    );
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    setCellFocusTarget(null);
  }, [cellFocusTarget, currentPage, pageSize, previewPending, renderedPreviewMarkdown]);

  const replaceCanonicalRow = useCallback((row: number, next: TableDraft): SerializedMarkdown | null => {
    const currentMarkdown = markdownRef.current;
    const lineIndex = row === 0 ? 0 : row + 1; // Canonical serialization always includes its delimiter row.
    const newline = next.newline;
    let lineStarts = canonicalLineStartsRef.current;
    if (!lineStarts || lineStarts.length !== (draftRef.current?.rows.length ?? 0) + 2) {
      lineStarts = [0];
      let start = 0;
      while (lineStarts.length < (draftRef.current?.rows.length ?? 0) + 2) {
        const newlineAt = currentMarkdown.indexOf(newline, start);
        if (newlineAt < 0) return null;
        start = newlineAt + newline.length;
        lineStarts.push(start);
      }
      canonicalLineStartsRef.current = lineStarts;
    }
    const start = lineStarts[lineIndex];
    if (typeof start !== "number" || start > currentMarkdown.length) return null;
    const end = currentMarkdown.indexOf(newline, start);
    const rowCells = row === 0 ? next.headers : next.rows[row - 1];
    if (!rowCells || (end < 0 && start > currentMarkdown.length)) return null;
    const replacement = renderMarkdownTableRow(rowCells, row === 0 ? next.prefix : next.continuationPrefix);
    const oldLine = currentMarkdown.slice(start, end < 0 ? currentMarkdown.length : end);
    const lineDelta = replacement.length - oldLine.length;
    return {
      text: currentMarkdown.slice(0, start) + replacement + (end < 0 ? "" : currentMarkdown.slice(end)),
      byteLength: markdownByteLengthRef.current - textEncoder.encode(oldLine).byteLength + textEncoder.encode(replacement).byteLength,
      replacedLineIndex: lineIndex,
      replacedLineDelta: lineDelta,
    };
  }, []);

  const updateDraft = useCallback((next: TableDraft, validity?: boolean, serialized?: SerializedMarkdown): boolean => {
    const text = serialized?.text ?? serialize(next);
    const byteLength = serialized?.byteLength ?? textEncoder.encode(text).byteLength;
    if (text.length > MARKDOWN_TABLE_LIMITS.bytes || byteLength > MARKDOWN_TABLE_LIMITS.bytes) {
      setActionError(true);
      return false;
    }
    const valid = validity ?? Boolean(inspectMarkdownTableDraft(text));
    draftRef.current = next;
    markdownRef.current = text;
    markdownByteLengthRef.current = byteLength;
    if (serialized?.replacedLineIndex !== undefined && serialized.replacedLineDelta !== undefined
      && canonicalLineStartsRef.current) {
      for (let index = serialized.replacedLineIndex + 1; index < canonicalLineStartsRef.current.length; index++) {
        canonicalLineStartsRef.current[index] += serialized.replacedLineDelta;
      }
    } else {
      canonicalLineStartsRef.current = null;
    }
    draftValidRef.current = valid;
    rawInvalidRef.current = false;
    sourceMarkdownNeedsParseRef.current = false;
    markdownCanonicalRef.current = true;
    setDraft(next);
    setMarkdown(text);
    setMarkdownByteLength(byteLength);
    setMarkdownCanonical(true);
    setSourceMarkdownNeedsParse(false);
    setDraftValid(valid);
    setRawInvalid(false);
    setActionError(false);
    return true;
  }, []);

  const changeCell = useCallback((row: number, column: number, value: string): boolean => {
    const currentDraft = draftRef.current;
    if (!currentDraft || rawInvalidRef.current || sourceMarkdownNeedsParseRef.current) return false;
    // This value cannot fit the existing UTF-8 table budget even before any
    // serialization. Reject it without allocating its syntax index/escaped copy.
    if (value.length > MARKDOWN_TABLE_LIMITS.bytes) {
      setActionError(true);
      return false;
    }
    const next = row === 0
      ? { ...currentDraft, headers: currentDraft.headers.map((cell, index) => index === column ? { ...cell, value } : cell) }
      : (() => {
        const rows = currentDraft.rows.slice();
        rows[row - 1] = rows[row - 1].map((cell, cellIndex) => cellIndex === column ? { ...cell, value } : cell);
        return { ...currentDraft, rows };
      })();
    const serializedText = markdownCanonicalRef.current && draftValidRef.current
      ? replaceCanonicalRow(row, next)
      : undefined;
    return updateDraft(
      next,
      draftValidRef.current ? isMarkdownTableCellValueValid(value) : undefined,
      serializedText ?? undefined,
    );
  }, [replaceCanonicalRow, updateDraft]);

  const handleEditingChange = useCallback((row: number, column: number, editing: boolean, restoreCellFocus = false) => {
    if (restoreCellFocus) setCellFocusTarget({ row, column });
    setEditingCell(current =>
      editing
        ? { row, column }
        : current?.row === row && current.column === column ? null : current,
    );
  }, []);

  const handleVerticalNavigate = useCallback((currentRow: number, currentColumn: number, delta: -1 | 1) => {
    const currentDraft = draftRef.current;
    const currentPage = currentPageRef.current;
    if (!currentDraft || previewPendingRef.current) return false;
    const rowOffset = rowOffsetRef.current;
    const pageSize = pageSizeRef.current;
    const targetRow = currentRow === 0 && delta > 0 ? rowOffset + 1 : currentRow + delta;
    if (targetRow < 0 || targetRow > currentDraft.rows.length) return false;
    const targetPage = targetRow === 0 ? currentPage : Math.floor((targetRow - 1) / pageSize);
    setCellFocusTarget({ row: targetRow, column: currentColumn });
    if (targetPage !== currentPage) setPage(targetPage);
    return true;
  }, []);

  const handleHorizontalNavigate = useCallback((currentRow: number, currentColumn: number, delta: -1 | 1) => {
    const currentDraft = draftRef.current;
    if (!currentDraft || previewPendingRef.current) return false;
    const columnCount = currentDraft.headers.length;
    const targetColumn = currentColumn + delta;
    if (targetColumn < 0 || targetColumn >= columnCount) return false;
    setCellFocusTarget({ row: currentRow, column: targetColumn });
    return true;
  }, []);

  function changePage(nextPage: number) {
    restorePagerFocus.current = Boolean(pagerRef.current?.contains(document.activeElement));
    setCellFocusTarget(null);
    setPage(Math.max(0, Math.min(nextPage, pages - 1)));
  }

  function addEdge(axis: "row" | "column", position: "before" | "after") {
    if (!draft || (axis === "row" ? !canAddRow : !canAddColumn)) return;
    if (axis === "row") {
      const row = Array.from({ length: draft.headers.length }, emptyCell);
      const rows = position === "before" ? [row, ...draft.rows] : [...draft.rows, row];
      if (updateDraft({ ...draft, rows })) {
        const targetRow = position === "before" ? 1 : rows.length;
        setPage(position === "before" ? 0 : Math.floor((targetRow - 1) / pageSize));
        setCellFocusTarget({ row: targetRow, column: 0 });
      }
    } else {
      const index = position === "before" ? 0 : draft.headers.length;
      const insert = (cells: TableDraft["headers"]) => [...cells.slice(0, index), emptyCell(), ...cells.slice(index)];
      if (updateDraft({
        ...draft,
        headers: insert(draft.headers),
        rows: draft.rows.map(insert),
        alignments: [...draft.alignments.slice(0, index), "left", ...draft.alignments.slice(index)],
      })) setCellFocusTarget({ row: 0, column: index });
    }
  }

  function changeMarkdown(value: string) {
    const previousMarkdown = markdownRef.current;
    const fastDraft = !sourceMarkdownNeedsParseRef.current && !rawInvalidRef.current && draftRef.current
      ? updateSimpleMarkdownTableDraft(previousMarkdown, draftRef.current, value)
      : null;
    markdownRef.current = value;
    const byteLength = textEncoder.encode(value).byteLength;
    markdownByteLengthRef.current = byteLength;
    canonicalLineStartsRef.current = null;
    sourceMarkdownNeedsParseRef.current = true;
    markdownCanonicalRef.current = false;
    setMarkdown(value);
    setMarkdownByteLength(byteLength);
    setMarkdownCanonical(false);
    setActionError(false);
    if (fastDraft) {
      draftRef.current = fastDraft;
      draftValidRef.current = true;
      rawInvalidRef.current = false;
      sourceMarkdownNeedsParseRef.current = false;
      setDraft(fastDraft);
      setDraftValid(true);
      setRawInvalid(false);
      setSourceMarkdownNeedsParse(false);
    } else {
      setSourceMarkdownNeedsParse(true);
    }
  }

  function applyDraft() {
    if (!ready || !draft) return;
    const output = serialize(draft);
    if (output.length > MARKDOWN_TABLE_LIMITS.bytes || textEncoder.encode(output).byteLength > MARKDOWN_TABLE_LIMITS.bytes) {
      setActionError(true);
      return;
    }
    onApply({ type: "replace", markdown: output }, sourceContext);
  }

  const renderCell = useCallback((row: number, column: number, content: ReactNode) => {
    const currentDraft = draftRef.current;
    if (!currentDraft) return content;
    const actualRow = row === 0 ? 0 : row + rowOffsetRef.current;
    const cell = actualRow === 0 ? currentDraft.headers[column] : currentDraft.rows[actualRow - 1]?.[column];
    const label = row === 0
      ? (zh ? `第 ${column + 1} 列表头` : `Column ${column + 1} header`)
      : (zh ? `第 ${actualRow} 行第 ${column + 1} 列` : `Row ${actualRow}, column ${column + 1}`);
    const displayContent = cell && previewCellTooLarge(cell.value)
      ? <span className="text-secondary" title={zh ? "内容仍保留在下方 Markdown" : "Content remains in the Markdown editor below"}>…</span>
      : content;
    return <EditableTableCell
      value={cell?.value ?? ""}
      row={actualRow}
      column={column}
      disabled={rawInvalidRef.current}
      editing={editingCell?.row === actualRow && editingCell.column === column}
      previewPending={previewPendingRef.current}
      label={label}
      title={cellTitle(cell?.value ?? "", label, zh)}
      onChange={changeCell}
      onEditingChange={handleEditingChange}
      onVerticalNavigate={handleVerticalNavigate}
      onHorizontalNavigate={handleHorizontalNavigate}
    >{displayContent}</EditableTableCell>;
  }, [changeCell, editingCell, handleEditingChange, handleHorizontalNavigate, handleVerticalNavigate, zh]);

  return (
    <div className="fixed inset-0 z-[240] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="source-editor-table-tool-title" aria-describedby={!original ? "source-editor-table-unavailable" : undefined} data-testid="source-editor-table-tool">
      <button type="button" tabIndex={-1} data-dialog-backdrop className="absolute inset-0" onClick={onClose} aria-label={zh ? "关闭表格工具" : "Close table tool"} />
      <section ref={dialogRef} tabIndex={-1} className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl sm:max-w-3xl sm:rounded-xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ui px-4 py-2 sm:px-5">
          <h2 id="source-editor-table-tool-title" className="text-base font-semibold text-primary">{zh ? "表格工具" : "Table tool"}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-3 sm:px-5">
          {needsAnalysis ? <MarkdownTableSourceProbe source={source} onResult={acceptAnalysis} /> : null}
          {draft ? (
            <>
              {pages > 1 ? <div ref={pagerRef} role="group" aria-label={zh ? "表格行分页" : "Table row pages"} className="mb-1 flex flex-wrap items-center justify-end gap-x-2 text-xs text-secondary">
                <span className="whitespace-nowrap tabular-nums" aria-live="polite" aria-atomic="true">{rowOffset + 1}–{rowOffset + visibleRows.length} / {draft.rows.length}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" disabled={currentPage === 0} onClick={() => changePage(0)} className={PAGE_BUTTON} aria-label={zh ? "首批表格行" : "First table rows"} title={zh ? "首批表格行" : "First table rows"}><ChevronFirst className="h-4 w-4" /></button>
                  <button type="button" data-table-page="previous" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)} className={PAGE_BUTTON} aria-label={zh ? "上一页表格行" : "Previous table rows"} title={zh ? "上一页表格行" : "Previous table rows"}><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" data-table-page="next" disabled={currentPage >= pages - 1} onClick={() => changePage(currentPage + 1)} className={PAGE_BUTTON} aria-label={zh ? "下一页表格行" : "Next table rows"} title={zh ? "下一页表格行" : "Next table rows"}><ChevronRight className="h-4 w-4" /></button>
                  <button type="button" disabled={currentPage >= pages - 1} onClick={() => changePage(pages - 1)} className={PAGE_BUTTON} aria-label={zh ? "末批表格行" : "Last table rows"} title={zh ? "末批表格行" : "Last table rows"}><ChevronLast className="h-4 w-4" /></button>
                </div>
              </div> : null}
              <div ref={gridRef} className="group/table relative rounded-lg border border-ui bg-page" data-testid="source-editor-table-grid">
                {/* Edge controls belong to the visible preview, not the midpoint
                    of its potentially very wide/long scrolling table. Keep them
                    in the grid's focus scope, with room for the whole hit area. */}
                <div className="flex h-11 justify-center">
                  <button type="button" disabled={!canAddRow} onClick={() => addEdge("row", "before")} className={EDGE_BUTTON} aria-label={zh ? "在表格顶部增加一行" : "Add a row above the table"} data-testid="source-editor-table-add-row-before">{EDGE_MARK}</button>
                </div>
                <div className="relative px-11">
                  <div aria-busy={previewPending} className="max-h-[42dvh] overflow-auto" data-testid="source-editor-table-preview">
                    <div ref={previewRef} className="w-max min-w-full"><MarkdownTablePreview
                      text={renderedPreviewMarkdown}
                      interactionVersion={`${previewPending}:${rawInvalid}:${rowOffset}:${currentPage}:${editingCell?.row ?? ""}:${editingCell?.column ?? ""}`}
                      renderCell={renderCell}
                    /></div>
                  </div>
                  <button type="button" disabled={!canAddColumn} onClick={() => addEdge("column", "before")} className={`${EDGE_BUTTON} absolute left-0 top-1/2 -translate-y-1/2`} aria-label={zh ? "在表格左侧增加一列" : "Add a column to the left"} data-testid="source-editor-table-add-column-before">{EDGE_MARK}</button>
                  <button type="button" disabled={!canAddColumn} onClick={() => addEdge("column", "after")} className={`${EDGE_BUTTON} absolute right-0 top-1/2 -translate-y-1/2`} aria-label={zh ? "在表格右侧增加一列" : "Add a column to the right"} data-testid="source-editor-table-add-column-after">{EDGE_MARK}</button>
                </div>
                <div className="flex h-11 justify-center">
                  <button type="button" disabled={!canAddRow} onClick={() => addEdge("row", "after")} className={EDGE_BUTTON} aria-label={zh ? "在表格底部增加一行" : "Add a row below the table"} data-testid="source-editor-table-add-row-after">{EDGE_MARK}</button>
                </div>
              </div>
              {previewPending ? <p id="source-editor-table-preview-pending" role="status" className="mt-1 text-xs text-secondary">{zh ? "正在更新表格预览…" : "Updating table preview…"}</p> : null}
              {largePreviewCellCount ? <p role="status" className="mt-2 text-xs text-secondary" data-testid="source-editor-table-large-cell-notice">{zh ? `当前页有 ${largePreviewCellCount} 个单元格内容较长，预览已简化；下方 Markdown 和应用内容不变。` : `${largePreviewCellCount} ${largePreviewCellCount === 1 ? "cell is" : "cells are"} long on this page, so the preview is simplified; Markdown and Apply remain unchanged.`}</p> : null}
              {referenceContext.limited ? <p role="status" className="mt-2 text-xs text-secondary" data-testid="source-editor-table-reference-notice">{zh ? "引用预览可能不完整，请在源码预览中核对；原文不变。" : "Reference previews may be incomplete. Check the source preview; original definitions stay unchanged."}</p> : null}
              {previewShapeInvalid ? <p id="source-editor-table-preview-invalid" role="alert" className="mt-2 text-xs text-[var(--danger)]" data-testid="source-editor-table-preview-invalid">{zh ? "当前内容未渲染为表格，无法应用；请修正下方 Markdown。" : "The current Markdown did not render as a table and cannot be applied. Fix the Markdown below."}</p> : null}
            </>
          ) : <p id="source-editor-table-unavailable" role={checkingSource ? "status" : undefined} className="py-3 text-sm text-secondary">{
            checkingSource ? (zh ? "正在检查表格上下文…" : "Checking table context…")
              : needsAnalysis && !analysis?.complete ? (zh ? "HTML 上下文超出检查上限；请完整选中表格后重试。" : "HTML context exceeds the check limits. Select the complete table to try again.")
                : (zh ? "请完整选中表格后重试；代码或 HTML 示例也需明确选中。" : "Select the complete table to try again, including code or HTML examples.")
          }</p>}
          {original ? <label className="mt-3 block">
            <span className="mb-2 block text-sm font-medium text-primary">Markdown</span>
            <textarea
              value={markdown}
              onChange={event => changeMarkdown(event.target.value)}
              onFocus={() => setCellFocusTarget(null)}
              spellCheck={false}
              aria-invalid={rawInvalid || !draftValid}
              aria-describedby={rawInvalid ? "source-editor-table-input-error" : !draftValid ? "source-editor-table-draft-error" : undefined}
              className="min-h-40 w-full resize-y rounded-lg border border-ui bg-surface px-3 py-2 font-mono text-base leading-6 text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] disabled:opacity-50 sm:text-sm sm:leading-5"
              data-testid="source-editor-table-markdown"
            />
          </label> : null}
          {rawInvalid ? <p id="source-editor-table-input-error" role="alert" className="mt-2 text-xs text-[var(--danger)]">{zh ? "表格尚不完整或超出工具上限；上方保留最近的有效预览，请继续修改 Markdown。" : "The table is incomplete or exceeds tool limits. The last valid preview is retained; continue editing Markdown."}</p> : null}
          {!rawInvalid && draft && !draftValid ? <p id="source-editor-table-draft-error" role="alert" className="mt-2 text-xs text-[var(--danger)]">{zh ? "请检查单元格标记；不支持 HTML 表格结构。" : "Check cell markup; HTML table structures are not supported."}</p> : null}
          {actionError ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{zh ? "已达表格工具大小上限，本次操作未更改内容。" : "The table size limit was reached. This operation left the content unchanged."}</p> : null}
          {stale ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{zh ? "编辑器正文已变化。" : "The source editor changed."}<button type="button" onClick={onRefresh} className="ml-2 min-h-11 underline">{zh ? "重新预览" : "Refresh preview"}</button></p> : null}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-ui px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg px-4 text-sm font-medium text-secondary hover:bg-subtle">{!original && !checkingSource ? (zh ? "返回源码" : "Back to source") : (zh ? "取消" : "Cancel")}</button>
          {original ? <button type="button" disabled={!ready} aria-describedby={[previewPending ? "source-editor-table-preview-pending" : "", previewShapeInvalid ? "source-editor-table-preview-invalid" : ""].filter(Boolean).join(" ") || undefined} onClick={applyDraft} className="min-h-11 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50">{zh ? "应用" : "Apply"}</button> : null}
        </footer>
      </section>
    </div>
  );
}

const EditableTableCell = memo(function EditableTableCell({ value, row, column, disabled, editing, previewPending, label, title, onChange, onEditingChange, onVerticalNavigate, onHorizontalNavigate, children }: {
  value: string;
  row: number;
  column: number;
  disabled: boolean;
  editing: boolean;
  previewPending: boolean;
  label: string;
  title: string;
  onChange: (row: number, column: number, value: string) => boolean;
  onEditingChange: (row: number, column: number, editing: boolean, restoreCellFocus?: boolean) => void;
  onVerticalNavigate: (row: number, column: number, delta: -1 | 1) => boolean;
  onHorizontalNavigate: (row: number, column: number, delta: -1 | 1) => boolean;
  children: ReactNode;
}) {
  const [localValue, setLocalValue] = useState(value);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editing) setLocalValue(value);
  }, [editing, value]);
  useLayoutEffect(() => {
    if (editing && !disabled) inputRef.current?.focus({ preventScroll: true });
  }, [disabled, editing]);

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      event.stopPropagation();
      onEditingChange(row, column, false, !previewPending);
      if (previewPending) {
        buttonRef.current?.closest("[role='dialog']")
          ?.querySelector<HTMLTextAreaElement>("textarea[data-testid='source-editor-table-markdown']")?.focus();
      } else {
        buttonRef.current?.focus();
      }
      return;
    }
    if (!["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    // Shift+arrows select text in the active input. Only Shift+Enter is a
    // spreadsheet-style previous-row command; selection must not leave the cell.
    if (editing && event.shiftKey && event.key !== "Enter") return;
    if (editing && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const input = inputRef.current;
      if (!input || input.selectionStart !== input.selectionEnd
        || (event.key === "ArrowLeft" ? input.selectionStart !== 0 : input.selectionEnd !== value.length)) return;
    }
    if (!editing && event.key === "Enter") {
      event.preventDefault();
      setLocalValue(value);
      onEditingChange(row, column, true);
      return;
    }
    // Always consume Enter, even at the last cell: never submit the source form.
    event.preventDefault();
    // Existing inputs keep focus and accept typing, but a deferred preview may
    // still show the previous page or structure. Do not navigate into those cells.
    if (previewPending) return;
    if (event.key === "Enter" || event.key === "ArrowUp" || event.key === "ArrowDown") {
      const moved = onVerticalNavigate(
        row, column, event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? -1 : 1,
      );
      if (moved) {
        onEditingChange(row, column, false);
      }
      return;
    }
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (delta && onHorizontalNavigate(row, column, delta)) {
      onEditingChange(row, column, false);
    }
  }

  return (
    <div className="relative min-h-11 min-w-24">
      <button ref={buttonRef} type="button" disabled={disabled || previewPending} tabIndex={editing && !disabled ? -1 : 0} aria-hidden={editing && !disabled ? true : undefined} data-table-cell data-row-index={row} data-column-index={column} aria-label={label} title={title}
        style={{ textAlign: "inherit" }}
        onClick={() => { setLocalValue(value); onEditingChange(row, column, true); }} onKeyDown={keyDown}
        className={`min-h-11 w-full px-3 py-2 text-left text-sm text-primary hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] disabled:cursor-default ${editing && !disabled ? "pointer-events-none opacity-0" : ""}`}>
        {children || <span aria-hidden="true">&nbsp;</span>}
      </button>
      {editing && !disabled ? <input ref={inputRef} value={localValue} aria-label={label} data-testid="source-editor-table-cell-input"
        onChange={event => { const nextValue = event.target.value; if (onChange(row, column, nextValue)) setLocalValue(nextValue); }} onBlur={() => onEditingChange(row, column, false)} onKeyDown={keyDown}
        className="absolute inset-0 min-h-11 w-full bg-surface px-3 py-2 text-base text-primary outline-none ring-2 ring-inset ring-[var(--focus)] sm:text-sm" /> : null}
    </div>
  );
});
