"use client";

import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Grid2X2, Loader2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import type { AttachmentAccess } from "./attachment-access";
import {
  friendlyAttachmentType,
  resolveAttachmentCapability,
  type AttachmentViewerKind,
  type AttachmentViewerMode,
} from "./preview-adapter-registry";
import {
  isMobileViewerViewport,
  resolveViewerPresentation,
  viewerPresentationStyle,
  type ViewerContentMetrics,
  type ViewerMediaDimensions,
  type ViewerViewport,
} from "./viewer-presentation";
import { parseDelimitedRows } from "./attachment-table-policy";

const ComplexAttachmentViewer = lazy(() => import("./complex-attachment-viewer").then((module) => ({ default: module.ComplexAttachmentViewer })));

export type AttachmentViewerItem = {
  itemKey: string;
  attachmentId: string;
  messageId?: string;
  messageVersionId?: string;
  occurrenceKey?: string;
  blockIndex?: number;
  displayOrder?: number;
  displayMode?: "auto" | "small" | "medium" | "large";
  alt?: string;
  caption?: string;
};

export type AttachmentViewerSession = {
  source: "reader" | "file-panel" | "search-result" | "share" | "offline";
  scope: "single" | "message-gallery" | "conversation-gallery";
  items: AttachmentViewerItem[];
  activeItemKey: string;
  /** Optional transient entry mode; used by the inline +N Gallery tile. */
  initialMode?: AttachmentViewerMode;
  access?: AttachmentAccess;
  permissions: {
    downloadOriginal: boolean;
    enumerateConversationImages: boolean;
    batchDownload: boolean;
  };
  trigger: HTMLElement | null;
  onLocate?: (item: AttachmentViewerItem) => void;
  onClosed?: () => void;
};

type ViewerContextValue = {
  open: (session: AttachmentViewerSession) => void;
  close: () => void;
};

const AttachmentViewerContext = createContext<ViewerContextValue>({ open: () => undefined, close: () => undefined });

export function AttachmentViewerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AttachmentViewerSession | null>(null);
  const open = useCallback((next: AttachmentViewerSession) => setSession({ ...next, items: next.items.length ? next.items : [{ itemKey: next.activeItemKey, attachmentId: next.activeItemKey }] }), []);
  const close = useCallback(() => {
    setSession((current) => {
      current?.onClosed?.();
      return null;
    });
  }, []);
  const value = useMemo(() => ({ open, close }), [close, open]);
  return (
    <AttachmentViewerContext.Provider value={value}>
      {children}
      {session ? <AttachmentViewerShell session={session} onClose={close} /> : null}
    </AttachmentViewerContext.Provider>
  );
}

let viewerScrollLockCount = 0;
let viewerPreviousOverflow = "";
let viewerScrollPosition: { x: number; y: number } | null = null;

function acquireViewerScrollLock() {
  if (viewerScrollLockCount === 0) {
    viewerPreviousOverflow = document.body.style.overflow;
    viewerScrollPosition = { x: window.scrollX, y: window.scrollY };
    document.body.style.overflow = "hidden";
  }
  viewerScrollLockCount += 1;
}

function releaseViewerScrollLock() {
  viewerScrollLockCount = Math.max(0, viewerScrollLockCount - 1);
  if (viewerScrollLockCount > 0) return;
  document.body.style.overflow = viewerPreviousOverflow;
  if (viewerScrollPosition) window.scrollTo({ ...viewerScrollPosition, behavior: "auto" });
  viewerScrollPosition = null;
}

export function useAttachmentViewer(): ViewerContextValue {
  return useContext(AttachmentViewerContext);
}

export function AttachmentViewerShell({ session, onClose }: { session: AttachmentViewerSession; onClose: () => void }) {
  const access = session.access ?? { kind: "owner" as const };
  const [activeKey, setActiveKey] = useState(session.activeItemKey);
  const item = session.items.find((candidate) => candidate.itemKey === activeKey) ?? session.items[0];
  const index = Math.max(0, session.items.findIndex((candidate) => candidate.itemKey === item?.itemKey));
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<AttachmentViewerMode | null>(session.initialMode ?? null);
  const [maximized, setMaximized] = useState(false);
  const maximizedRef = useRef(false);
  const [mediaDimensions, setMediaDimensions] = useState<ViewerMediaDimensions>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [contentMetrics, setContentMetrics] = useState<ViewerContentMetrics | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const viewport = useViewerViewport();

  const attachmentQuery = useQuery({
    queryKey: ["attachment-viewer", access.kind, access.kind === "share" ? access.token : "owner", item?.attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(item!.attachmentId) : getAttachment(item!.attachmentId, access.kind === "share" ? access.token : undefined),
    enabled: Boolean(item),
    staleTime: 5 * 60 * 1000,
  });
  const attachment = attachmentQuery.data;
  const viewerKind = attachment ? resolveAttachmentCapability(attachment).viewerKind : null;
  const effectiveMode = mode ?? defaultMode(viewerKind);
  const presentation = resolveViewerPresentation({ viewerKind, viewerMode: effectiveMode, itemCount: session.items.length, pdfPageCount, contentMetrics });
  const panelStyle = viewerPresentationStyle({ ...presentation, maximized, viewport, mediaDimensions, itemCount: session.items.length });
  const mobileFullscreen = isMobileViewerViewport(viewport);

  useEffect(() => {
    maximizedRef.current = maximized;
  }, [maximized]);

  useEffect(() => {
    setMediaDimensions(null);
    setPdfPageCount(null);
    setContentMetrics(null);
  }, [item?.attachmentId]);

  useEffect(() => {
    previousFocusRef.current = session.trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    acquireViewerScrollLock();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (maximizedRef.current) {
          setMaximized(false);
          return;
        }
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && session.items.length > 1) {
        event.preventDefault();
        setActiveIndex(-1);
      } else if (event.key === "ArrowRight" && session.items.length > 1) {
        event.preventDefault();
        setActiveIndex(1);
      } else if (event.key === "+" || event.key === "=") {
        document.querySelector<HTMLButtonElement>('[data-viewer-zoom="in"]')?.click();
      } else if (event.key === "-") {
        document.querySelector<HTMLButtonElement>('[data-viewer-zoom="out"]')?.click();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      releaseViewerScrollLock();
      window.requestAnimationFrame(() => previousFocusRef.current?.focus());
    };
  }, [onClose, session.items.length]);

  function setActiveIndex(delta: number) {
    const next = (index + delta + session.items.length) % session.items.length;
    setActiveKey(session.items[next]?.itemKey ?? activeKey);
    setMode(null);
  }

  if (!item || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={attachment?.display_name ?? "Attachment viewer"}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-0 outline-none sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      data-testid="attachment-viewer-shell"
    >
      <section
        className="grid min-h-0 grid-rows-[auto,minmax(0,1fr),auto] overflow-hidden bg-page shadow-2xl motion-safe:transition-[width,height] motion-safe:duration-200 sm:rounded-xl"
        data-testid="attachment-viewer-panel"
        data-viewer-presentation={presentation.presentation}
        data-viewer-size={presentation.size}
        data-viewer-maximized={maximized ? "true" : "false"}
        style={panelStyle}
      >
        <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-ui px-3 py-1 sm:px-4">
          <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={onClose} aria-label="关闭附件查看器" title="关闭"><X className="h-5 w-5" /></button>
          <div className="min-w-32 flex-1">
            <h2 className="truncate text-sm font-semibold text-primary" title={attachment?.display_name}>{attachment?.display_name ?? "正在加载附件"}</h2>
            <p className="truncate text-xs text-secondary">{attachment ? `${friendlyAttachmentType(attachment)} · ${formatBytes(attachment.asset_object?.byte_size ?? 0)}${attachment.scan_status === "scanner_disabled" || attachment.scan_status === "unscanned" ? " · 未扫描" : ""}` : ""}{session.items.length > 1 ? ` · ${index + 1} / ${session.items.length}` : ""}</p>
          </div>
          <div ref={setToolbarHost} className="order-3 flex min-w-0 basis-full items-center justify-center gap-1 overflow-x-auto sm:order-none sm:basis-auto">
            {viewerKind === "markdown" ? <><ModeButton active={effectiveMode === "markdown-rendered"} onClick={() => setMode("markdown-rendered")}>Rendered</ModeButton><ModeButton active={effectiveMode === "markdown-source"} onClick={() => setMode("markdown-source")}>Source</ModeButton></> : null}
            {viewerKind === "table" ? <><ModeButton active={effectiveMode === "table"} onClick={() => setMode("table")}>Table</ModeButton><ModeButton active={effectiveMode === "table-raw"} onClick={() => setMode("table-raw")}>Raw</ModeButton></> : null}
          </div>
          {!mobileFullscreen ? <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => setMaximized((value) => !value)} aria-label={maximized ? "退出最大化" : "最大化 Viewer"} title={maximized ? "退出最大化" : "最大化 Viewer"}>{maximized ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}</button> : null}
          {session.permissions.downloadOriginal && attachment?.download_url ? <a href={attachment.download_url} download className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={`下载 ${attachment.display_name}`} title="下载"><Download className="h-5 w-5" /></a> : null}
          {viewerKind === "image" && session.items.length > 1 ? <button type="button" className="hidden h-11 shrink-0 items-center gap-1 rounded-md px-3 text-sm text-secondary hover:bg-subtle sm:inline-flex" onClick={() => setMode("image-overview")} aria-label="查看全部图片" title="查看全部图片"><Grid2X2 className="h-4 w-4" />全部</button> : null}
        </header>
        <div className="min-h-0 overflow-hidden overscroll-contain" data-testid="attachment-viewer-content">
          {attachmentQuery.isPending ? <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div> : attachmentQuery.isError || !attachment ? <ViewerError message="附件无法加载" onRetry={() => void attachmentQuery.refetch()} downloadUrl={undefined} /> : <ViewerBody attachment={attachment} kind={viewerKind} mode={effectiveMode} onModeChange={setMode} session={session} activeIndex={index} onSelect={(next) => { setActiveKey(session.items[next]?.itemKey ?? activeKey); setMode("image-focus"); }} onPrevious={() => setActiveIndex(-1)} onNext={() => setActiveIndex(1)} onMediaDimensions={setMediaDimensions} onPdfPageCount={setPdfPageCount} onComplexPresentationMetrics={setContentMetrics} toolbarHost={toolbarHost} />}
        </div>
        {viewerKind === "image" && session.items.length > 1 && effectiveMode !== "image-overview" ? <div className="flex min-h-16 gap-2 overflow-x-auto border-t border-ui bg-subtle p-2" role="list" aria-label="图片缩略图列表">{session.items.map((candidate, candidateIndex) => <ViewerThumbnail key={candidate.itemKey} item={candidate} access={access} active={candidate.itemKey === activeKey} label={`第 ${candidateIndex + 1} 张`} onClick={() => { setActiveKey(candidate.itemKey); setMode("image-focus"); }} />)}</div> : null}
      </section>
    </div>,
    document.body,
  );
}

function ViewerBody({ attachment, kind, mode, onModeChange, session, activeIndex, onSelect, onPrevious, onNext, onMediaDimensions, onPdfPageCount, onComplexPresentationMetrics, toolbarHost }: { attachment: AttachmentRead; kind: AttachmentViewerKind | null; mode: AttachmentViewerMode | null; onModeChange: (mode: AttachmentViewerMode) => void; session: AttachmentViewerSession; activeIndex: number; onSelect: (index: number) => void; onPrevious: () => void; onNext: () => void; onMediaDimensions: (dimensions: ViewerMediaDimensions) => void; onPdfPageCount: (count: number | null) => void; onComplexPresentationMetrics: (metrics: ViewerContentMetrics | null) => void; toolbarHost: HTMLDivElement | null }) {
  if (kind === "image") return <ImageViewer attachment={attachment} session={session} activeIndex={activeIndex} mode={mode === "image-overview" ? "overview" : "focus"} onSelect={onSelect} onPrevious={onPrevious} onNext={onNext} onMediaDimensions={onMediaDimensions} />;
  if (kind === "markdown") return <TextualViewer attachment={attachment} mode={mode === "markdown-source" ? "source" : "rendered"} onModeChange={onModeChange} markdown />;
  if (kind === "code") return <TextualViewer attachment={attachment} mode="source" onModeChange={onModeChange} code />;
  if (kind === "json") return <JsonViewer attachment={attachment} />;
  if (kind === "table") return <TextualViewer attachment={attachment} mode={mode === "table-raw" ? "source" : "rendered"} onModeChange={onModeChange} table />;
  if (kind === "audio") return <MediaViewer attachment={attachment} audio onMediaDimensions={onMediaDimensions} />;
  if (kind === "video") return <MediaViewer attachment={attachment} onMediaDimensions={onMediaDimensions} />;
  if (kind === "pdf") return <PdfViewer attachment={attachment} toolbarHost={toolbarHost} onPageCountChange={onPdfPageCount} />;
  if (kind === "document" || kind === "spreadsheet" || kind === "presentation" || kind === "archive") {
    return <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-secondary"><Loader2 className="h-5 w-5 animate-spin" />正在加载预览组件…</div>}><ComplexAttachmentViewer attachment={attachment} kind={kind} onPresentationMetrics={onComplexPresentationMetrics} /></Suspense>;
  }
  return <TextualViewer attachment={attachment} mode="source" onModeChange={onModeChange} />;
}

function ImageViewer({ attachment, session, activeIndex, mode, onSelect, onPrevious, onNext, onMediaDimensions }: { attachment: AttachmentRead; session: AttachmentViewerSession; activeIndex: number; mode: "focus" | "overview"; onSelect: (index: number) => void; onPrevious: () => void; onNext: () => void; onMediaDimensions: (dimensions: ViewerMediaDimensions) => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    setAttempt(0);
  }, [attachment.id]);
  if (mode === "overview") return <div className="h-full overflow-y-auto overscroll-contain p-4" data-testid="image-overview"><div className="columns-2 gap-3 md:columns-3 lg:columns-4">{session.items.map((item, index) => <ViewerOverviewImage key={item.itemKey} item={item} access={session.access ?? { kind: "owner" }} index={index} onSelect={onSelect} />)}</div></div>;
  if (failed) return <ViewerError message="无法加载图片预览，原文件仍可下载。" onRetry={() => { setFailed(false); setAttempt((value) => value + 1); }} downloadUrl={attachment.download_url ?? undefined} />;
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center bg-black p-4" data-testid="image-focus">
      <TransformWrapper initialScale={1} minScale={0.25} maxScale={8} centerOnInit doubleClick={{ mode: "toggle", step: 1 }} wheel={{ step: 0.12 }} panning={{ disabled: false }}>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent wrapperClass="!h-full !w-full" contentClass="flex !h-full !w-full items-center justify-center">
              <img src={retryableUrl(attachment.content_url, attempt)} alt={session.items[activeIndex]?.alt ?? attachment.display_name} className="max-h-full max-w-full object-contain" onLoad={(event) => onMediaDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
            </TransformComponent>
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-lg bg-black/70 p-1 text-white"><button type="button" className="h-11 w-11 rounded-md" onClick={() => resetTransform()} aria-label="适应窗口" title="适应窗口"><RotateCcw className="mx-auto h-4 w-4" /></button><button type="button" data-viewer-zoom="out" className="h-11 w-11 rounded-md" onClick={() => zoomOut()} aria-label="缩小" title="缩小"><ZoomOut className="mx-auto h-4 w-4" /></button><button type="button" data-viewer-zoom="in" className="h-11 w-11 rounded-md" onClick={() => zoomIn()} aria-label="放大" title="放大"><ZoomIn className="mx-auto h-4 w-4" /></button></div>
          </>
        )}
      </TransformWrapper>
      {session.items.length > 1 ? <><button type="button" onClick={onPrevious} className="absolute left-2 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-black/60 text-2xl text-white" aria-label="上一张">‹</button><button type="button" onClick={onNext} className="absolute right-2 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-black/60 text-2xl text-white" aria-label="下一张">›</button></> : null}
    </div>
  );
}

function ViewerOverviewImage({ item, access, index, onSelect }: { item: AttachmentViewerItem; access: AttachmentAccess; index: number; onSelect: (index: number) => void }) {
  const query = useViewerAttachment(item.attachmentId, access);
  return <button type="button" onClick={() => onSelect(index)} className="mb-3 flex min-h-28 w-full break-inside-avoid items-center justify-center rounded-lg border border-ui bg-subtle p-2 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label={`查看第 ${index + 1} 张图片`}>{query.data ? <ViewerThumbnailImage attachment={query.data} alt={item.alt ?? query.data.display_name} fallbackLabel={`${index + 1}`} className="h-auto max-h-80 max-w-full object-contain" /> : <Loader2 className="h-4 w-4 animate-spin text-secondary" />}</button>;
}

function ViewerThumbnail({ item, access, active, label, onClick }: { item: AttachmentViewerItem; access: AttachmentAccess; active: boolean; label: string; onClick: () => void }) {
  const query = useViewerAttachment(item.attachmentId, access);
  return <button type="button" role="listitem" aria-current={active ? "true" : undefined} aria-label={label} onClick={onClick} className={`flex h-12 min-w-12 items-center justify-center rounded-md border p-1 ${active ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-ui"}`} title={query.data?.display_name ?? item.alt ?? label}>{query.data ? <ViewerThumbnailImage attachment={query.data} alt="" fallbackLabel={label.replace(/\D/g, "")} className="h-10 w-10 object-contain" /> : <span className="text-xs text-secondary">{label.replace(/\D/g, "")}</span>}</button>;
}

function ViewerThumbnailImage({ attachment, alt, fallbackLabel, className }: { attachment: AttachmentRead; alt: string; fallbackLabel: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const capability = resolveAttachmentCapability(attachment);
  const source = capability.rendererKey === "image" ? attachment.content_url : null;
  useEffect(() => setFailed(false), [attachment.id, source]);
  if (!source || failed) return <span className="flex h-10 min-w-10 items-center justify-center rounded bg-surface px-1 text-xs font-medium text-secondary">{fallbackLabel}</span>;
  return <img src={source} alt={alt} loading="lazy" decoding="async" className={className} onError={() => setFailed(true)} />;
}

function useViewerAttachment(attachmentId: string, access: AttachmentAccess) {
  return useQuery({
    queryKey: ["attachment-viewer-item", access.kind, access.kind === "share" ? access.token : "owner", attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(attachmentId) : getAttachment(attachmentId, access.kind === "share" ? access.token : undefined),
    staleTime: 5 * 60 * 1000,
  });
}

function TextualViewer({ attachment, mode, onModeChange: _onModeChange, markdown = false, code = false, table = false }: { attachment: AttachmentRead; mode: "rendered" | "source"; onModeChange: (mode: AttachmentViewerMode) => void; markdown?: boolean; code?: boolean; table?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!attachment.content_url) return () => controller.abort();
    setText(null);
    setError(false);
    void fetch(retryableUrl(attachment.content_url, attempt)!, { headers: { Range: "bytes=0-8388607" }, signal: controller.signal, cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("preview"); return response.text(); }).then(setText).catch((reason) => { if (reason?.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, [attachment.content_url, attempt]);
  if (error) return <ViewerError message="预览加载失败，原文件仍可下载。" onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  if (text === null) return <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (markdown && mode === "rendered") return <div className="h-full overflow-y-auto overscroll-contain bg-page p-5"><div className="mx-auto max-w-[900px]"><MarkdownRenderer text={text} isAssistant={false} /></div></div>;
  if (table && mode === "rendered") return <DelimitedTableViewer text={text} delimiter={attachment.display_name.toLowerCase().endsWith(".tsv") ? "\t" : ","} />;
  return <pre className={`h-full overflow-auto overscroll-contain whitespace-pre-wrap break-words bg-page p-5 text-sm text-primary ${code || !markdown ? "font-mono" : ""}`}>{text}</pre>;
}

function DelimitedTableViewer({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = parseDelimitedRows(text, delimiter);
  if (!rows.length) return <div className="flex h-full items-center justify-center p-6 text-sm text-secondary">空表格 · 没有可显示的行</div>;
  const columns = Math.max(...rows.map((row) => row.length));
  return (
    <div className="h-full overflow-auto overscroll-contain bg-page p-4" data-testid="attachment-table-viewer">
      <table className="min-w-max border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-subtle"><tr><th className="sticky left-0 border-b border-r border-ui px-2 py-2 text-right font-normal text-secondary">#</th>{Array.from({ length: columns }, (_, index) => <th key={index} className="border-b border-r border-ui px-3 py-2 text-left font-medium text-primary">{rows[0]?.[index] || `列 ${index + 1}`}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}><th className="sticky left-0 border-b border-r border-ui bg-page px-2 py-1.5 text-right font-normal text-secondary">{rowIndex + 1}</th>{Array.from({ length: columns }, (_, columnIndex) => <td key={columnIndex} className="max-w-80 border-b border-r border-ui px-3 py-1.5 align-top text-primary"><span className="line-clamp-3" title={row[columnIndex] ?? ""}>{row[columnIndex] ?? ""}</span></td>)}</tr>)}</tbody>
      </table>
      <p className="mt-3 text-xs text-secondary">已显示 {Math.max(0, rows.length - 1)} 行 · {columns} 列（有界预览）</p>
    </div>
  );
}


function JsonViewer({ attachment }: { attachment: AttachmentRead }) {
  const [text, setText] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => { if (!attachment.content_url) return; const controller = new AbortController(); void fetch(attachment.content_url, { headers: { Range: "bytes=0-8388607" }, signal: controller.signal }).then((response) => response.text()).then(setText).catch(() => setText("无法加载 JSON。")); return () => controller.abort(); }, [attachment.content_url]);
  if (text === null) return <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (raw || (attachment.asset_object?.byte_size ?? 0) > 8 * 1024 * 1024) return <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-page p-5 font-mono text-sm text-primary">{text}</pre>;
  try {
    const value = JSON.parse(text);
    const complexity = inspectJsonComplexity(value);
    if (!complexity.valid) throw new Error(complexity.reason);
    const json = JSON.stringify(value, null, 2);
    if (json.length > 8 * 1024 * 1024) throw new Error("large");
    return <div className="h-full overflow-auto bg-page p-5"><div className="mb-3 flex justify-end"><ModeButton active={!raw} onClick={() => setRaw(false)}>Tree</ModeButton><ModeButton active={raw} onClick={() => setRaw(true)}>Raw</ModeButton></div><pre className="whitespace-pre-wrap break-words font-mono text-sm text-primary">{json}</pre></div>;
  } catch {
    return <div className="flex h-full flex-col items-center justify-center gap-3 text-secondary"><p>JSON 结构过于复杂，已降级为 Raw。</p><button type="button" onClick={() => setRaw(true)} className="min-h-11 rounded-md border border-ui px-4">打开 Raw</button></div>;
  }
}

function inspectJsonComplexity(root: unknown): { valid: true } | { valid: false; reason: string } {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > 50_000) return { valid: false, reason: "node-limit" };
    if (current.depth > 64) return { valid: false, reason: "depth-limit" };
    if (typeof current.value === "string" && Array.from(current.value).length > 4096) continue;
    if (!current.value || typeof current.value !== "object") continue;
    const entries = Array.isArray(current.value) ? current.value.map((value, index) => [String(index), value] as const) : Object.entries(current.value);
    if (entries.length > 2_000) return { valid: false, reason: "children-limit" };
    for (const [key, value] of entries) {
      if (Array.from(key).length > 256) return { valid: false, reason: "key-limit" };
      stack.push({ value, depth: current.depth + 1 });
    }
  }
  return { valid: true };
}

type PdfFitMode = "page" | "width" | "custom";

function PdfViewer({ attachment, toolbarHost, onPageCountChange }: { attachment: AttachmentRead; toolbarHost: HTMLDivElement | null; onPageCountChange: (count: number | null) => void }) {
  const [documentProxy, setDocumentProxy] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fitMode, setFitMode] = useState<PdfFitMode>("page");
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [thumbnailRail, setThumbnailRail] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!attachment.content_url) return;
    let active = true;
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    setDocumentProxy(null);
    setError(false);
    void import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
      task = pdfjs.getDocument({ url: retryableUrl(attachment.content_url, attempt)!, isEvalSupported: false });
      return task.promise;
    }).then((pdf) => {
      if (!active) return;
      setDocumentProxy(pdf);
      setCurrentPage(1);
      setFitMode("page");
      setZoom(1);
      onPageCountChange(pdf.numPages);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; void task?.destroy(); };
  }, [attachment.content_url, attempt, onPageCountChange]);
  useEffect(() => () => onPageCountChange(null), [onPageCountChange]);
  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    const update = () => setViewportSize({ width: viewportElement.clientWidth, height: viewportElement.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [documentProxy, thumbnailRail]);
  if (error) return <ViewerError message="无法加载 PDF 预览，原文件仍可下载。" onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  if (!documentProxy) return <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const selectPage = (pageNumber: number) => {
    const nextPage = Math.min(documentProxy.numPages, Math.max(1, pageNumber));
    setCurrentPage(nextPage);
    if (fitMode === "page") return;
    window.requestAnimationFrame(() => {
      const root = viewportRef.current;
      const target = root?.querySelector<HTMLElement>(`[data-pdf-page="${nextPage}"]`);
      if (root && target) root.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: "smooth" });
    });
  };
  const toolbar = toolbarHost ? createPortal(
    <div className="flex min-w-max items-center gap-1" aria-label="PDF 查看工具">
      {documentProxy.numPages > 1 ? <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => setThumbnailRail((value) => !value)} aria-label={thumbnailRail ? "收起页面缩略图" : "展开页面缩略图"} title={thumbnailRail ? "收起页面缩略图" : "展开页面缩略图"}>{thumbnailRail ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}</button> : null}
      <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle disabled:opacity-40" onClick={() => selectPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
      <span className="min-w-14 text-center text-xs text-secondary" aria-label={`第 ${currentPage} 页，共 ${documentProxy.numPages} 页`}>{currentPage} / {documentProxy.numPages}</span>
      <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle disabled:opacity-40" onClick={() => selectPage(currentPage + 1)} disabled={currentPage >= documentProxy.numPages} aria-label="下一页"><ChevronRight className="h-4 w-4" /></button>
      <ModeButton active={fitMode === "page"} onClick={() => setFitMode("page")}>Fit page</ModeButton>
      <ModeButton active={fitMode === "width"} onClick={() => setFitMode("width")}>Fit width</ModeButton>
      <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => { setFitMode("custom"); setZoom((value) => Math.max(0.25, value - 0.1)); }} aria-label="缩小 PDF"><ZoomOut className="h-4 w-4" /></button>
      <button type="button" className="min-h-10 min-w-14 rounded-md px-2 text-xs text-secondary hover:bg-subtle" onClick={() => { setFitMode("custom"); setZoom(1); }} aria-label="PDF 缩放 100%">{Math.round(zoom * 100)}%</button>
      <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => { setFitMode("custom"); setZoom((value) => Math.min(4, value + 0.1)); }} aria-label="放大 PDF"><ZoomIn className="h-4 w-4" /></button>
    </div>,
    toolbarHost,
  ) : null;
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (fitMode === "page") return;
    const root = event.currentTarget;
    const rootTop = root.getBoundingClientRect().top;
    let nearestPage = currentPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-page]"))) {
      const distance = Math.abs(node.getBoundingClientRect().top - rootTop - 12);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = Number(node.dataset.pdfPage ?? currentPage);
      }
    }
    if (nearestPage !== currentPage) setCurrentPage(nearestPage);
  };
  return (
    <div className="flex h-full min-h-0 bg-subtle" data-testid="pdf-viewer">
      {toolbar}
      {thumbnailRail && documentProxy.numPages > 1 ? <aside className="w-28 shrink-0 overflow-y-auto border-r border-ui bg-page p-2" aria-label="PDF 页面缩略图">{Array.from({ length: documentProxy.numPages }, (_, index) => <PdfThumbnail key={index + 1} documentProxy={documentProxy} pageNumber={index + 1} active={currentPage === index + 1} onClick={() => { setCurrentPage(index + 1); setFitMode("page"); }} />)}</aside> : null}
      <div ref={viewportRef} className={`min-h-0 min-w-0 flex-1 overscroll-contain ${fitMode === "page" ? "overflow-hidden" : "overflow-auto"}`} onScroll={handleScroll} data-testid="pdf-viewer-pages" data-pdf-fit={fitMode}>
        {fitMode === "page" ? <div className="flex h-full min-h-0 items-center justify-center p-3"><PdfPage documentProxy={documentProxy} pageNumber={currentPage} fitMode="page" zoom={zoom} containerWidth={viewportSize.width} containerHeight={viewportSize.height} /></div> : <div className="mx-auto flex w-max min-w-full flex-col items-center gap-4 p-4">{Array.from({ length: documentProxy.numPages }, (_, index) => <PdfPage key={index + 1} documentProxy={documentProxy} pageNumber={index + 1} fitMode={fitMode} zoom={zoom} containerWidth={viewportSize.width} containerHeight={viewportSize.height} lazy={index > 1} />)}</div>}
      </div>
    </div>
  );
}

function PdfPage({ documentProxy, pageNumber, fitMode, zoom, containerWidth, containerHeight, lazy = false }: { documentProxy: import("pdfjs-dist").PDFDocumentProxy; pageNumber: number; fitMode: PdfFitMode; zoom: number; containerWidth: number; containerHeight: number; lazy?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(!lazy);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || visible) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "800px 0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: import("pdfjs-dist").RenderTask | null = null;
    void documentProxy.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(160, containerWidth - 32);
      const availableHeight = Math.max(160, containerHeight - 32);
      const scale = fitMode === "page" ? Math.min(availableWidth / base.width, availableHeight / base.height) : fitMode === "width" ? availableWidth / base.width : zoom;
      const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      renderTask = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      return renderTask.promise;
    }).catch(() => undefined);
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [containerHeight, containerWidth, documentProxy, fitMode, pageNumber, visible, zoom]);
  return <div ref={hostRef} data-pdf-page={pageNumber} className="flex shrink-0 items-center justify-center">{visible ? <canvas ref={canvasRef} className="bg-white shadow" aria-label={`PDF 第 ${pageNumber} 页`} /> : <div className="h-[28rem] w-[20rem] animate-pulse bg-surface" />}</div>;
}

function PdfThumbnail({ documentProxy, pageNumber, active, onClick }: { documentProxy: import("pdfjs-dist").PDFDocumentProxy; pageNumber: number; active: boolean; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    let renderTask: import("pdfjs-dist").RenderTask | null = null;
    void documentProxy.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 82 / base.width });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return;
      renderTask = page.render({ canvasContext: context, viewport });
      return renderTask.promise;
    }).catch(() => undefined);
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [documentProxy, pageNumber]);
  return <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} aria-label={`打开 PDF 第 ${pageNumber} 页`} className={`mb-2 flex min-h-24 w-full flex-col items-center gap-1 rounded-md border p-1 text-xs ${active ? "border-[var(--accent)]" : "border-ui"}`}><canvas ref={canvasRef} className="max-w-full bg-white" /><span>{pageNumber}</span></button>;
}

function MediaViewer({ attachment, audio = false, onMediaDimensions }: { attachment: AttachmentRead; audio?: boolean; onMediaDimensions: (dimensions: ViewerMediaDimensions) => void }) {
  const [failure, setFailure] = useState<"unsupported" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setFailure(null), [attachment.id, attempt]);
  const handleError = (element: HTMLMediaElement) => {
    const mime = attachment.detected_mime_type || attachment.asset_object?.detected_mime_type || attachment.declared_mime_type || "";
    setFailure(mime && element.canPlayType(mime) === "" ? "unsupported" : "failed");
  };
  if (failure) return <ViewerError message={failure === "unsupported" ? "当前浏览器不支持直接播放此格式。" : "媒体预览加载失败，原文件仍可下载。"} onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  return <div className={`flex h-full items-center justify-center p-4 ${audio ? "bg-page" : "bg-black"}`}>{audio ? <audio src={retryableUrl(attachment.content_url, attempt)} controls preload="metadata" className="w-full max-w-[680px]" onError={(event) => handleError(event.currentTarget)} /> : <video src={retryableUrl(attachment.content_url, attempt)} controls preload="metadata" playsInline className="max-h-full max-w-full object-contain" onLoadedMetadata={(event) => onMediaDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} onError={(event) => handleError(event.currentTarget)} />}</div>;
}

function ViewerError({ message, onRetry, downloadUrl }: { message: string; onRetry: () => void; downloadUrl?: string }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-secondary"><p>{message}</p><div className="flex gap-2"><button type="button" onClick={onRetry} className="min-h-11 rounded-md border border-ui px-4">重试</button>{downloadUrl ? <a href={downloadUrl} download className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--text)] px-4 text-[var(--surface)]"><Download className="h-4 w-4" />下载</a> : null}</div></div>;
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`min-h-10 rounded-md px-3 text-xs ${active ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle"}`}>{children}</button>;
}

function defaultMode(kind: AttachmentViewerKind | null): AttachmentViewerMode | null {
  if (kind === "image") return "image-focus";
  if (kind === "markdown") return "markdown-rendered";
  if (kind === "json") return "json-tree";
  if (kind === "table") return "table";
  if (kind === "code") return "code";
  if (kind === "text") return "text";
  if (kind === "pdf") return "pdf";
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  if (kind === "document") return "document";
  if (kind === "spreadsheet") return "spreadsheet";
  if (kind === "presentation") return "presentation";
  if (kind === "archive") return "archive";
  return null;
}

function useViewerViewport(): ViewerViewport {
  const [viewport, setViewport] = useState<ViewerViewport>(() => typeof window === "undefined" ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setViewport({ width: window.innerWidth, height: window.innerHeight }));
    };
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return viewport;
}

function retryableUrl(url: string | null | undefined, attempt: number): string | undefined {
  if (!url) return undefined;
  if (attempt === 0) return url;
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("viewer_retry", String(attempt));
  return parsed.toString();
}

export function AttachmentPreviewDialog({ attachment, alt, onClose }: { attachment: AttachmentRead; alt?: string; onClose: () => void }) {
  const viewer = useAttachmentViewer();
  useEffect(() => {
    const item: AttachmentViewerItem = { itemKey: `single:${attachment.id}`, attachmentId: attachment.id, alt, displayMode: "auto" };
    viewer.open({
      source: "file-panel",
      scope: "single",
      items: [item],
      activeItemKey: item.itemKey,
      permissions: { downloadOriginal: true, enumerateConversationImages: true, batchDownload: true },
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      onClosed: onClose,
    });
    return () => viewer.close();
  }, [attachment.id, alt, onClose, viewer]);
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
