"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, FileText, Grid3X3, Loader2 } from "lucide-react";
import type { AttachmentRead } from "../../lib/types";
import type { AttachmentViewerKind } from "./preview-adapter-registry";

type SupportedKind = Extract<AttachmentViewerKind, "document" | "spreadsheet" | "presentation" | "archive">;
type ArchiveEntry = {
  path: string;
  byteSize: number;
  directory: boolean;
  preview?: { kind: "text"; text: string } | { kind: "image"; mimeType: string; bytes: ArrayBuffer };
};
type ParseResult =
  | { kind: "document"; paragraphs: string[]; tables: string[][][] }
  | { kind: "spreadsheet"; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: "presentation"; slides: Array<{ title: string; lines: string[] }> }
  | { kind: "archive"; entries: ArchiveEntry[] };

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export function ComplexAttachmentViewer({ attachment, kind }: { attachment: AttachmentRead; kind: SupportedKind }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!attachment.content_url) {
      setError("附件内容不可用。");
      return;
    }
    if ((attachment.asset_object?.byte_size ?? 0) > MAX_SOURCE_BYTES) {
      setError("文件超过 32 MiB 浏览器预览上限，请下载原文件。");
      return;
    }
    const controller = new AbortController();
    const worker = new Worker(new URL("./complex-attachment-worker.ts", import.meta.url), { type: "module" });
    const requestId = crypto.randomUUID();
    setResult(null);
    setError(null);
    worker.onmessage = (event: MessageEvent<{ requestId: string; ok: boolean; result?: ParseResult; error?: string }>) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.ok && event.data.result) setResult(event.data.result);
      else setError(event.data.error ?? "无法生成预览，请下载原文件。");
      worker.terminate();
    };
    worker.onerror = () => {
      setError("预览组件加载失败，请下载原文件。");
      worker.terminate();
    };
    void fetch(withAttempt(attachment.content_url, attempt), {
      signal: controller.signal,
      cache: "no-store",
      headers: { Range: `bytes=0-${MAX_SOURCE_BYTES}` },
    }).then(async (response) => {
      if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error("文件超过 32 MiB 浏览器预览上限，请下载原文件。");
      worker.postMessage({ requestId, kind, filename: attachment.display_name, bytes }, [bytes]);
    }).catch((reason) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "附件读取失败，请下载原文件。");
      worker.terminate();
    });
    return () => {
      controller.abort();
      worker.terminate();
    };
  }, [attachment.asset_object?.byte_size, attachment.content_url, attachment.display_name, attempt, kind]);

  if (error) return <ComplexError message={error} downloadUrl={attachment.download_url} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!result) return <div className="flex h-full items-center justify-center gap-2 text-secondary"><Loader2 className="h-5 w-5 animate-spin" />正在浏览器中解析只读预览…</div>;
  if (result.kind === "document") return <DocumentView result={result} />;
  if (result.kind === "spreadsheet") return <SpreadsheetView result={result} />;
  if (result.kind === "presentation") return <PresentationView result={result} />;
  return <ArchiveView result={result} />;
}

function DocumentView({ result }: { result: Extract<ParseResult, { kind: "document" }> }) {
  return <div className="h-full overflow-y-auto overscroll-contain bg-page p-5" data-testid="document-viewer"><article className="mx-auto max-w-[860px] space-y-3 rounded-lg bg-surface p-6 shadow-sm">{result.paragraphs.length ? result.paragraphs.map((paragraph, index) => <p key={`${index}:${paragraph.slice(0, 24)}`} className="whitespace-pre-wrap break-words text-sm leading-7 text-primary">{paragraph}</p>) : <p className="text-secondary">文档没有可提取的段落文本。</p>}{result.tables.map((table, index) => <BoundedTable key={index} rows={table} />)}</article></div>;
}

function SpreadsheetView({ result }: { result: Extract<ParseResult, { kind: "spreadsheet" }> }) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet = result.sheets[sheetIndex];
  if (!sheet) return <EmptyComplex label="工作簿没有可读取的工作表。" />;
  return <div className="flex h-full min-h-0 flex-col bg-page" data-testid="spreadsheet-viewer"><div className="flex min-h-11 gap-1 overflow-x-auto border-b border-ui px-3 py-1">{result.sheets.map((candidate, index) => <button key={`${index}:${candidate.name}`} type="button" onClick={() => setSheetIndex(index)} aria-current={index === sheetIndex ? "page" : undefined} className={`min-h-9 shrink-0 rounded px-3 text-xs ${index === sheetIndex ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle"}`}>{candidate.name}</button>)}</div><div className="min-h-0 flex-1 overflow-auto"><GridTable rows={sheet.rows} /></div></div>;
}

function PresentationView({ result }: { result: Extract<ParseResult, { kind: "presentation" }> }) {
  const [index, setIndex] = useState(0);
  const slide = result.slides[index];
  if (!slide) return <EmptyComplex label="演示文稿没有可提取的静态幻灯片。" />;
  return <div className="flex h-full min-h-0 bg-subtle" data-testid="presentation-viewer"><aside className="hidden w-40 shrink-0 overflow-y-auto border-r border-ui bg-page p-2 md:block">{result.slides.map((candidate, slideIndex) => <button key={slideIndex} type="button" onClick={() => setIndex(slideIndex)} aria-current={slideIndex === index ? "page" : undefined} className={`mb-2 min-h-20 w-full rounded border p-2 text-left text-xs ${slideIndex === index ? "border-[var(--accent)]" : "border-ui"}`}><span className="line-clamp-3">{candidate.title}</span><span className="mt-1 block text-secondary">{slideIndex + 1}</span></button>)}</aside><div className="flex min-h-0 min-w-0 flex-1 flex-col"><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"><section className="flex aspect-[16/9] w-full max-w-5xl flex-col justify-center overflow-auto rounded bg-white p-[7%] text-slate-900 shadow"><h3 className="mb-5 text-2xl font-semibold">{slide.title}</h3>{slide.lines.slice(1).map((line, lineIndex) => <p key={lineIndex} className="mb-2 text-base leading-6">{line}</p>)}</section></div><div className="flex h-14 items-center justify-center gap-3 border-t border-ui bg-page"><button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-subtle disabled:opacity-40" aria-label="上一张幻灯片"><ChevronLeft className="h-5 w-5" /></button><span className="min-w-20 text-center text-sm text-secondary">{index + 1} / {result.slides.length}</span><button type="button" onClick={() => setIndex((value) => Math.min(result.slides.length - 1, value + 1))} disabled={index === result.slides.length - 1} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-subtle disabled:opacity-40" aria-label="下一张幻灯片"><ChevronRight className="h-5 w-5" /></button></div></div></div>;
}

function ArchiveView({ result }: { result: Extract<ParseResult, { kind: "archive" }> }) {
  const selectable = result.entries.filter((entry) => !entry.directory);
  const [selectedPath, setSelectedPath] = useState(selectable[0]?.path ?? "");
  const selected = result.entries.find((entry) => entry.path === selectedPath);
  return <div className="grid h-full min-h-0 grid-cols-[minmax(220px,34%),1fr] bg-page max-md:grid-cols-1" data-testid="archive-viewer"><aside className="min-h-0 overflow-y-auto border-r border-ui p-2 max-md:max-h-[38%] max-md:border-b max-md:border-r-0" aria-label="压缩包目录"><p className="px-2 py-2 text-xs text-secondary">{selectable.length} 个文件 · 只读目录</p>{result.entries.map((entry) => <button key={entry.path} type="button" disabled={entry.directory} onClick={() => setSelectedPath(entry.path)} className={`flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-xs ${selectedPath === entry.path ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle"}`} title={entry.path}><Archive className="h-4 w-4 shrink-0" /><span className="truncate">{entry.path}</span>{!entry.directory ? <span className="ml-auto shrink-0">{formatBytes(entry.byteSize)}</span> : null}</button>)}</aside><ArchivePreview entry={selected} /></div>;
}

function ArchivePreview({ entry }: { entry?: ArchiveEntry }) {
  const imageUrl = useMemo(() => entry?.preview?.kind === "image" ? URL.createObjectURL(new Blob([entry.preview.bytes], { type: entry.preview.mimeType })) : null, [entry]);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  if (!entry) return <EmptyComplex label="选择一个文件查看有限预览。" />;
  if (!entry.preview) return <EmptyComplex label="此条目不支持浏览器内预览；请下载原压缩包。" />;
  if (entry.preview.kind === "image" && imageUrl) return <div className="flex min-h-0 items-center justify-center overflow-auto bg-subtle p-4"><img src={imageUrl} alt={entry.path} className="max-h-full max-w-full object-contain" /></div>;
  return <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-primary">{entry.preview.kind === "text" ? entry.preview.text : ""}</pre>;
}

function BoundedTable({ rows }: { rows: string[][] }) {
  return <div className="my-4 overflow-x-auto rounded border border-ui"><table className="min-w-full border-collapse text-xs"><tbody>{rows.slice(0, 200).map((row, rowIndex) => <tr key={rowIndex}>{row.slice(0, 64).map((cell, cellIndex) => <td key={cellIndex} className="max-w-72 border border-ui px-2 py-1.5 align-top">{cell}</td>)}</tr>)}</tbody></table></div>;
}

function GridTable({ rows }: { rows: string[][] }) {
  const columns = Math.min(64, Math.max(1, ...rows.map((row) => row.length)));
  return <table className="min-w-max border-separate border-spacing-0 text-xs"><thead className="sticky top-0 z-10 bg-subtle"><tr><th className="sticky left-0 z-20 min-w-12 border-b border-r border-ui px-2 py-2">#</th>{Array.from({ length: columns }, (_, index) => <th key={index} className="min-w-28 border-b border-r border-ui px-2 py-2 text-left">{columnName(index)}</th>)}</tr></thead><tbody>{rows.slice(0, 2_000).map((row, rowIndex) => <tr key={rowIndex}><th className="sticky left-0 bg-subtle px-2 py-1.5 text-right font-normal text-secondary">{rowIndex + 1}</th>{Array.from({ length: columns }, (_, column) => <td key={column} className="max-w-80 border-b border-r border-ui px-2 py-1.5 align-top"><span className="line-clamp-3">{row[column] ?? ""}</span></td>)}</tr>)}</tbody></table>;
}

function ComplexError({ message, downloadUrl, onRetry }: { message: string; downloadUrl?: string | null; onRetry: () => void }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"><FileText className="h-10 w-10 text-secondary" /><p className="max-w-xl text-sm text-secondary">{message}</p><div className="flex gap-2"><button type="button" onClick={onRetry} className="min-h-11 rounded-md border border-ui px-4">重试</button>{downloadUrl ? <a href={downloadUrl} download className="inline-flex min-h-11 items-center rounded-md bg-[var(--text)] px-4 text-[var(--surface)]">下载原文件</a> : null}</div></div>;
}

function EmptyComplex({ label }: { label: string }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-secondary"><Grid3X3 className="h-9 w-9" /><p>{label}</p></div>;
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function withAttempt(url: string, attempt: number): string {
  if (!attempt) return url;
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("complex_viewer_retry", String(attempt));
  return parsed.toString();
}
