"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, X } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { readMarkdownTableData, serializeTableData, type MarkdownTableNode } from "./markdown-table-export";
import { MarkdownTableScroll } from "./markdown-table";

/** Exact input of this rendered segment, not HTML or projected source offsets.
 * Used only after an explicit choice when a table cannot be safely serialized. */
export const MarkdownTableSourceContext = createContext<string | null>(null);

type Action = "copy" | "download";
type TableScope = { node: MarkdownTableNode | undefined; source: string | null };
type Recovery = { scope: TableScope; kind: "limit" | "unavailable" | "clipboard" | "download"; text?: string };

export function ReaderMarkdownTable({
  children, node, className = "", ...attributes
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode; node?: MarkdownTableNode }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const source = useContext(MarkdownTableSourceContext);
  const scope = useMemo(() => ({ node, source }), [node, source]);
  const [result, setResult] = useState<{ scope: TableScope; action: Action } | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [busyScope, setBusyScope] = useState<TableScope | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  const current = useRef(scope);
  current.current = scope;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const view = recovery?.scope === scope ? recovery : null;
  const confirmed = result?.scope === scope ? result.action : null;
  const isBusy = busyScope === scope;

  useEffect(() => () => { request.current += 1; busy.current = false; }, [scope]);
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(value => value === result ? null : value), 3000);
    return () => window.clearTimeout(timer);
  }, [result]);
  useDialogFocus({
    open: Boolean(view), rootRef: dialogRef, onClose: () => setRecovery(null),
    initialFocusRef: view?.kind === "clipboard" ? manualRef : undefined,
  });
  useEffect(() => { if (view?.kind === "clipboard") manualRef.current?.select(); }, [view]);

  async function copy(text: string) {
    if (busy.current) return;
    busy.current = true;
    const token = ++request.current;
    setBusyScope(scope);
    setResult(null);
    try {
      await navigator.clipboard.writeText(text);
      if (request.current !== token || current.current !== scope) return;
      setRecovery(null);
      setResult({ scope, action: "copy" });
    } catch {
      if (request.current === token && current.current === scope) setRecovery({ scope, kind: "clipboard", text });
    } finally {
      if (request.current === token) { busy.current = false; setBusyScope(null); }
    }
  }

  function download(text: string, markdown = false) {
    setResult(null);
    try {
      const blob = new Blob(markdown ? [text] : ["\uFEFF", text], {
        type: markdown ? "text/markdown;charset=utf-8" : "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = markdown ? "reader-source.md" : "reader-table.csv";
        anchor.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setRecovery(null);
      // The browser has been asked to download; the app cannot prove disk save.
      setResult({ scope, action: "download" });
    } catch { setRecovery({ scope, kind: "download" }); }
  }

  function exportTable(action: Action) {
    if (busy.current) return;
    setResult(null);
    // No AST text walk or TSV/CSV allocation during reading, hover or rendering.
    try {
      const data = readMarkdownTableData(node);
      if (!data || "tooLarge" in data) {
        setRecovery({ scope, kind: data ? "limit" : "unavailable" });
        return;
      }
      const { text } = serializeTableData(data.rows, action === "copy" ? "tsv" : "csv", { hasHeader: data.hasHeader });
      if (action === "copy") void copy(text);
      else download(text);
    } catch {
      setRecovery({ scope, kind: "unavailable" });
    }
  }

  const copyLabel = zh ? "复制表格（TSV）" : "Copy table (TSV)";
  const downloadLabel = zh ? "下载表格（CSV）" : "Download table (CSV)";
  const status = confirmed === "copy" ? (zh ? "内容已复制" : "Content copied")
    : confirmed === "download" ? (zh ? "已请求浏览器下载" : "Browser download requested") : "";
  const protection = zh ? "包含表头；公式样文本按安全文本导出。" : "Includes headers; formula-like cells export as safe text.";

  return (
    <div {...attributes} className={`reader-table-export flex max-w-full items-start gap-1 ${className}`}>
      <div className="min-w-0 flex-1"><MarkdownTableScroll>{children}</MarkdownTableScroll></div>
      <div data-markdown-copy-ignore="true" className="reader-table-actions flex w-11 shrink-0 flex-col" role="group" aria-label={zh ? "表格操作" : "Table actions"}>
        <button type="button" className="reader-table-action" aria-label={copyLabel}
          title={confirmed === "copy" ? status : `${copyLabel} · ${protection}`}
          onClick={() => exportTable("copy")} aria-disabled={isBusy || undefined} aria-busy={isBusy || undefined}>
          {confirmed === "copy" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        </button>
        <button type="button" className="reader-table-action" aria-label={downloadLabel}
          title={confirmed === "download" ? status : `${downloadLabel} · ${protection}`}
          onClick={() => exportTable("download")} aria-disabled={isBusy || undefined}>
          {confirmed === "download" ? <Check aria-hidden="true" size={16} /> : <Download aria-hidden="true" size={16} />}
        </button>
        <span role="status" className="sr-only">{status}</span>
      </div>
      {view ? createPortal(
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
          data-markdown-copy-ignore="true" className="fixed inset-0 z-[400] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-4">
          <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={() => setRecovery(null)} />
          <section className="relative max-h-[85svh] w-full overflow-y-auto rounded-t-2xl border border-ui bg-raised p-5 sm:max-w-lg sm:rounded-xl">
            <div className="flex items-center gap-3">
              <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold text-primary">{zh ? "表格导出" : "Table export"}</h2>
              <button type="button" className="reader-table-action shrink-0" aria-label={zh ? "关闭" : "Close"} onClick={() => setRecovery(null)}><X size={18} aria-hidden="true" /></button>
            </div>
            <p className="mt-2 text-sm text-secondary">
              {view.kind === "limit" ? (zh ? "此表格超过 50,000 个单元格，未转换或截断数据。可以改为复制或下载这段原始 Markdown，其中包含完整表格及同段其他内容。" : "This table exceeds 50,000 cells. No data was converted or truncated. Copy or download this original Markdown segment instead, including its complete table and any surrounding content.")
                : view.kind === "clipboard" ? (zh ? "剪贴板不可用，内容已选中，请手动复制；也可以下载原始 Markdown。" : "Clipboard access is unavailable. The content is selected for manual copying; you can also download the original Markdown.")
                  : view.kind === "download" ? (zh ? "未能发起下载。可以关闭后重试下载图标，或复制这段原始 Markdown。" : "The download could not be started. Close to retry the download icon, or copy this original Markdown segment.")
                    : (zh ? "无法生成此表格的数据文件。可以保留原始 Markdown，不猜测或丢弃单元格内容。" : "A data file cannot be generated for this table. Use the original Markdown rather than guessing or dropping cell content.")}
            </p>
            {view.kind === "clipboard" ? <label className="mt-4 block text-sm text-primary">
              {zh ? "手动复制内容" : "Content for manual copy"}
              <textarea ref={manualRef} readOnly value={view.text ?? ""} rows={6} className="mt-2 w-full rounded-md border border-ui bg-surface p-3 font-mono text-xs text-primary" />
            </label> : null}
            {source !== null ? <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={isBusy} onClick={() => void copy(source)}>
                {zh ? "复制原始 Markdown" : "Copy original Markdown"}
              </button>
              <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={isBusy} onClick={() => download(source, true)}>
                {zh ? "下载原始 Markdown" : "Download original Markdown"}
              </button>
            </div> : <p className="mt-4 text-sm text-secondary">{zh ? "此预览没有提供原始 Markdown，请回到正文使用消息的复制或导出操作。" : "This preview does not provide its source. Return to the message's copy or export actions."}</p>}
          </section>
        </div>, document.body,
      ) : null}
    </div>
  );
}
