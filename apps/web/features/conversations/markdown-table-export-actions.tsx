"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Table2 } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";
import {
  readMarkdownTableData,
  serializeTableData,
  type MarkdownTableNode,
} from "./markdown-table-export";
import { MarkdownTableScroll } from "./markdown-table";

export function ReaderMarkdownTable({
  children,
  node,
  ...attributes
}: React.HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  node?: MarkdownTableNode;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const table = useMemo(() => readMarkdownTableData(node), [node]);
  const [includeHeader, setIncludeHeader] = useState(true);
  const [protectFormulaCells, setProtectFormulaCells] = useState(true);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);
  const exportableTable = table && !("tooLarge" in table) ? table : null;
  const serialized = useMemo(() => exportableTable
    ? serializeTableData(exportableTable.rows, "tsv", { includeHeader, protectFormulaCells, hasHeader: exportableTable.hasHeader })
    : null, [includeHeader, protectFormulaCells, exportableTable]);

  useEffect(() => {
    if (manualCopyText !== null) {
      manualCopyRef.current?.focus();
      manualCopyRef.current?.select();
    }
  }, [manualCopyText]);

  async function copyTsv() {
    if (!serialized?.text) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(serialized.text);
      setManualCopyText(null);
      setStatus(zh ? "表格数据已复制。" : "Table data copied.");
    } catch {
      setManualCopyText(serialized.text);
      setStatus(zh ? "无法自动访问剪贴板。数据已选中，请手动复制。" : "Clipboard access was denied. The data is selected for manual copying.");
    }
  }

  function downloadCsv() {
    if (!exportableTable) return;
    const { text, protectedCellCount } = serializeTableData(exportableTable.rows, "csv", {
      includeHeader,
      protectFormulaCells,
      hasHeader: exportableTable.hasHeader,
    });
    const blob = new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reader-table.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setManualCopyText(null);
    setStatus(protectedCellCount
      ? (zh ? `CSV 已下载；${protectedCellCount} 个疑似公式单元格已按安全文本处理。` : `CSV downloaded; ${protectedCellCount} formula-like cells were made safe text.`)
      : (zh ? "CSV 已下载。" : "CSV downloaded."));
  }

  return (
    <div {...attributes} className="space-y-2">
      {exportableTable ? <div data-markdown-copy-ignore="true" className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-secondary"><Table2 className="h-3.5 w-3.5" aria-hidden="true" />{zh ? "表格数据" : "Table data"}</span>
        {exportableTable.hasHeader ? <label className="inline-flex min-h-9 items-center gap-1.5 text-secondary">
          <input type="checkbox" checked={includeHeader} onChange={(event) => setIncludeHeader(event.currentTarget.checked)} />
          {zh ? "包含表头" : "Include header"}
        </label> : null}
        <label className="inline-flex min-h-9 items-center gap-1.5 text-secondary" title={zh ? "对以 =、+、@ 或非数字 - 开头的单元格添加单引号，减少表格软件将其解释为公式的风险。" : "Prefixes cells beginning with =, +, @, or a non-numeric - with an apostrophe to reduce spreadsheet formula risk."}>
          <input type="checkbox" checked={protectFormulaCells} onChange={(event) => setProtectFormulaCells(event.currentTarget.checked)} />
          {zh ? "公式样文本按安全文本处理" : "Protect formula-like text"}
        </label>
        <button type="button" className="btn-secondary min-h-9 px-2.5 text-xs" onClick={() => void copyTsv()} disabled={!serialized?.text}>
          {zh ? "复制 TSV" : "Copy TSV"}
        </button>
        <button type="button" className="btn-secondary inline-flex min-h-9 items-center gap-1 px-2.5 text-xs" onClick={downloadCsv}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />{zh ? "下载 CSV" : "Download CSV"}
        </button>
        {serialized?.protectedCellCount ? <span className="text-secondary">
          {zh ? `${serialized.protectedCellCount} 个单元格会加单引号。` : `${serialized.protectedCellCount} cells will receive an apostrophe.`}
        </span> : null}
        {manualCopyText !== null ? <label className="w-full text-secondary">
          {zh ? "手动复制所选数据：" : "Manually copy the selected data:"}
          <textarea ref={manualCopyRef} readOnly value={manualCopyText} rows={Math.min(6, Math.max(2, manualCopyText.split("\n").length))} className="mt-1 w-full rounded-md border border-ui bg-surface p-2 font-mono text-xs text-primary" />
        </label> : null}
        <span role="status" aria-live="polite" className="sr-only">{status}</span>
      </div> : table && "tooLarge" in table ? <p data-markdown-copy-ignore="true" className="text-xs text-secondary">{zh ? "此表格超过 50,000 个单元格，暂不提供导出，以避免浏览器内存占用过高。" : "This table exceeds 50,000 cells; export is unavailable to avoid excessive browser memory use."}</p> : null}
      <MarkdownTableScroll>
        {children}
      </MarkdownTableScroll>
    </div>
  );
}
