"use client";

import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, Download, Grid2X2, Loader2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment, releaseOfflineAttachmentUrls } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { loadPdfJs } from "./pdfjs-runtime";
import { useDialogFocus } from "../../components/use-dialog-focus";
import type { AttachmentAccess } from "./attachment-access";
import {
  friendlyAttachmentType,
  resolveAttachmentCapability,
  resolveAttachmentDataState,
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
import { acquirePdfPage, createPdfRenderQueue, isViewerShortcut, parsePdfPageInput, pdfPageLayout, type PdfFitMode, type PdfPageSize, type PdfRenderQueue } from "./pdf-viewer-policy";

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
  const [mode, setMode] = useState<AttachmentViewerMode | null>(session.initialMode ?? null);
  const [maximized, setMaximized] = useState(false);
  const maximizedRef = useRef(false);
  const [mediaDimensions, setMediaDimensions] = useState<ViewerMediaDimensions>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [contentMetrics, setContentMetrics] = useState<ViewerContentMetrics | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const viewport = useViewerViewport();

  const attachmentQuery = useQuery({
    queryKey: ["attachment-viewer", access.kind, access.kind === "admin" ? access.userId : access.kind === "share" ? access.token : "owner", item?.attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(item!.attachmentId) : getAttachment(item!.attachmentId, access.kind === "share" ? access.token : undefined, access.kind === "admin" ? access.userId : undefined),
    enabled: Boolean(item),
    staleTime: access.kind === "offline" ? 0 : 5 * 60 * 1000,
    gcTime: access.kind === "offline" ? 0 : 5 * 60 * 1000,
  });
  const attachment = attachmentQuery.data;
  const offlineUnavailable = access.kind === "offline" && attachment?.resolution_status === "offline_unavailable";
  useEffect(() => () => {
    if (access.kind === "offline") releaseOfflineAttachmentUrls(attachment);
  }, [access.kind, attachment]);
  const viewerKind = attachment ? resolveAttachmentCapability(attachment).viewerKind : null;
  const effectiveMode = mode ?? defaultMode(viewerKind);
  const presentation = resolveViewerPresentation({ viewerKind, viewerMode: effectiveMode, itemCount: session.items.length, pdfPageCount, contentMetrics });
  const panelStyle = viewerPresentationStyle({ ...presentation, maximized, viewport, mediaDimensions, itemCount: session.items.length });
  const mobileFullscreen = isMobileViewerViewport(viewport);

  useDialogFocus({
    open: true,
    rootRef: dialogRef,
    initialFocusRef: closeRef,
    restoreFocus: () => {
      if (session.trigger?.isConnected) return session.trigger;
      const container = document.querySelector<HTMLElement>(`[data-attachment-id="${CSS.escape(item?.attachmentId ?? "")}"]`);
      return container?.querySelector<HTMLElement>("button:not([disabled]),a[href]") ?? null;
    },
    onClose: () => {
      if (maximizedRef.current) {
        setMaximized(false);
        return;
      }
      onClose();
    },
  });

  useEffect(() => {
    maximizedRef.current = maximized;
  }, [maximized]);

  useEffect(() => {
    setMediaDimensions(null);
    setPdfPageCount(null);
    setContentMetrics(null);
  }, [item?.attachmentId]);

  useLayoutEffect(() => {
    // Replacing the active renderer can remove its focused zoom/next control.
    // Recover only lost focus; never interrupt another control the reader chose.
    if (!document.activeElement || document.activeElement === document.body) {
      closeRef.current?.focus({ preventScroll: true });
    }
  }, [activeKey, attachment?.id]);

  useEffect(() => {
    acquireViewerScrollLock();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isViewerShortcut(event) || !dialogRef.current?.contains(event.target as Node)) return;
      if (event.key === "ArrowLeft" && session.items.length > 1) {
        event.preventDefault();
        setActiveIndex(-1);
      } else if (event.key === "ArrowRight" && session.items.length > 1) {
        event.preventDefault();
        setActiveIndex(1);
      } else if (event.key === "+" || event.key === "=") {
        const button = dialogRef.current.querySelector<HTMLButtonElement>('[data-viewer-zoom="in"]:not([disabled])');
        if (button) { event.preventDefault(); button.click(); }
      } else if (event.key === "-") {
        const button = dialogRef.current.querySelector<HTMLButtonElement>('[data-viewer-zoom="out"]:not([disabled])');
        if (button) { event.preventDefault(); button.click(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      releaseViewerScrollLock();
    };
  }, [session.items]);

  function setActiveIndex(delta: number) {
    setActiveKey((current) => {
      const currentIndex = Math.max(0, session.items.findIndex((candidate) => candidate.itemKey === current));
      const next = (currentIndex + delta + session.items.length) % session.items.length;
      return session.items[next]?.itemKey ?? current;
    });
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
          <button ref={closeRef} type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={onClose} aria-label="关闭附件查看器" title="关闭"><X className="h-5 w-5" /></button>
          <div className="min-w-32 flex-1">
            <h2 className="truncate text-sm font-semibold text-primary" title={attachment?.display_name}>{attachment?.display_name ?? "正在加载附件"}</h2>
            <p className="truncate text-xs text-secondary">{attachment ? `${friendlyAttachmentType(attachment)} · ${formatBytes(attachment.asset_object?.byte_size ?? 0)}${attachment.scan_status === "scanner_disabled" || attachment.scan_status === "unscanned" ? " · 未扫描" : ""}` : ""}{session.items.length > 1 ? ` · ${index + 1} / ${session.items.length}` : ""}</p>
          </div>
          <div ref={setToolbarHost} className="order-3 flex min-w-0 max-w-full basis-full flex-wrap items-center justify-start gap-1 sm:order-none sm:basis-auto">
            {viewerKind === "markdown" ? <><ModeButton active={effectiveMode === "markdown-rendered"} onClick={() => setMode("markdown-rendered")}>Rendered</ModeButton><ModeButton active={effectiveMode === "markdown-source"} onClick={() => setMode("markdown-source")}>Source</ModeButton></> : null}
            {viewerKind === "table" ? <><ModeButton active={effectiveMode === "table"} onClick={() => setMode("table")}>Table</ModeButton><ModeButton active={effectiveMode === "table-raw"} onClick={() => setMode("table-raw")}>Raw</ModeButton></> : null}
          </div>
          {!mobileFullscreen ? <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => setMaximized((value) => !value)} aria-label={maximized ? "退出最大化" : "最大化 Viewer"} title={maximized ? "退出最大化" : "最大化 Viewer"}>{maximized ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}</button> : null}
          {session.permissions.downloadOriginal && attachment?.download_url ? <a href={attachment.download_url} download className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={`下载 ${attachment.display_name}`} title="下载"><Download className="h-5 w-5" /></a> : null}
          {viewerKind === "image" && session.items.length > 1 ? <button type="button" className="hidden h-11 shrink-0 items-center gap-1 rounded-md px-3 text-sm text-secondary hover:bg-subtle sm:inline-flex" onClick={() => setMode("image-overview")} aria-label="查看全部图片" title="查看全部图片"><Grid2X2 className="h-4 w-4" />全部</button> : null}
        </header>
        <div className="min-h-0 overflow-hidden overscroll-contain" data-testid="attachment-viewer-content">
          {attachmentQuery.isPending ? <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div> : attachmentQuery.isError || !attachment ? <ViewerError message="附件无法加载" onRetry={() => void attachmentQuery.refetch()} downloadUrl={undefined} /> : offlineUnavailable ? <ViewerError message="离线资源未缓存。重新联网或更新离线副本后重试。" onRetry={() => void attachmentQuery.refetch()} downloadUrl={undefined} /> : <ViewerBody key={item.itemKey} attachment={attachment} kind={viewerKind} mode={effectiveMode} onModeChange={setMode} session={session} activeIndex={index} onSelect={(next) => { setActiveKey(session.items[next]?.itemKey ?? activeKey); setMode("image-focus"); }} onPrevious={() => setActiveIndex(-1)} onNext={() => setActiveIndex(1)} onMediaDimensions={setMediaDimensions} onPdfPageCount={setPdfPageCount} onComplexPresentationMetrics={setContentMetrics} toolbarHost={toolbarHost} />}
        </div>
        {viewerKind === "image" && session.items.length > 1 && effectiveMode !== "image-overview" ? <div className="flex min-h-16 gap-2 overflow-x-auto border-t border-ui bg-subtle p-2" role="list" aria-label="图片缩略图列表">{session.items.map((candidate, candidateIndex) => <ViewerThumbnail key={candidate.itemKey} item={candidate} access={access} active={candidate.itemKey === activeKey} label={`第 ${candidateIndex + 1} 张`} onClick={() => { setActiveKey(candidate.itemKey); setMode("image-focus"); }} />)}</div> : null}
      </section>
    </div>,
    document.body,
  );
}

function ViewerBody({ attachment: sourceAttachment, kind, mode, onModeChange, session, activeIndex, onSelect, onPrevious, onNext, onMediaDimensions, onPdfPageCount, onComplexPresentationMetrics, toolbarHost }: { attachment: AttachmentRead; kind: AttachmentViewerKind | null; mode: AttachmentViewerMode | null; onModeChange: (mode: AttachmentViewerMode) => void; session: AttachmentViewerSession; activeIndex: number; onSelect: (index: number) => void; onPrevious: () => void; onNext: () => void; onMediaDimensions: (dimensions: ViewerMediaDimensions) => void; onPdfPageCount: (count: number | null) => void; onComplexPresentationMetrics: (metrics: ViewerContentMetrics | null) => void; toolbarHost: HTMLDivElement | null }) {
  const dataState = resolveAttachmentDataState(sourceAttachment);
  const downloadUrl = session.permissions.downloadOriginal && dataState !== "missing" && sourceAttachment.resolution_status !== "offline_unavailable" ? sourceAttachment.download_url ?? undefined : undefined;
  // All renderer recovery actions obey the same session permission as the header.
  const attachment = useMemo(() => downloadUrl ? sourceAttachment : { ...sourceAttachment, download_url: null }, [sourceAttachment, downloadUrl]);
  if (dataState === "uploading" || dataState === "upload_failed") return <ViewerError message={dataState === "uploading" ? "附件尚未上传完成。" : "附件上传未完成，请返回编辑器重试上传。"} />;
  if (attachment.resolution_status === "offline_unavailable" || dataState === "missing" || !attachment.content_url) {
    return <ViewerError message="附件内容暂不可用。请关闭后重新打开；离线时可先更新本机副本。" downloadUrl={downloadUrl} />;
  }
  if (dataState === "empty") return <ViewerError message="这是空文件，没有可预览的内容。" downloadUrl={downloadUrl} />;
  if (!kind) return <ViewerError message={downloadUrl ? "此格式暂不支持浏览器内预览。可下载后使用相应应用打开。" : "此格式暂不支持浏览器内预览。"} downloadUrl={downloadUrl} />;
  if ((attachment.asset_object?.byte_size ?? 0) > 50 * 1024 * 1024) {
    return <ViewerError message="文件超过 50 MiB 浏览器预览上限。" downloadUrl={downloadUrl} />;
  }
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
  if (failed) return <ViewerError message="无法加载图片预览。" onRetry={() => { setFailed(false); setAttempt((value) => value + 1); }} downloadUrl={attachment.download_url ?? undefined} />;
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center bg-black p-4" data-testid="image-focus">
      <TransformWrapper key={attachment.id} initialScale={1} minScale={0.25} maxScale={8} centerOnInit doubleClick={{ mode: "toggle", step: 1 }} wheel={{ step: 0.12 }} panning={{ disabled: false }}>
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
  return <button type="button" onClick={() => onSelect(index)} className="mb-3 flex min-h-28 w-full break-inside-avoid items-center justify-center rounded-lg border border-ui bg-subtle p-2 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label={`查看第 ${index + 1} 张图片`}>{query.data ? <ViewerThumbnailImage attachment={query.data} alt={item.alt ?? query.data.display_name} fallbackLabel={`${index + 1}`} className="h-auto max-h-80 max-w-full object-contain" /> : query.isError ? <span className="text-sm text-secondary">第 {index + 1} 张 · 打开重试</span> : <Loader2 className="h-4 w-4 animate-spin text-secondary" />}</button>;
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
  const query = useQuery({
    queryKey: ["attachment-viewer-item", access.kind, access.kind === "admin" ? access.userId : access.kind === "share" ? access.token : "owner", attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(attachmentId) : getAttachment(attachmentId, access.kind === "share" ? access.token : undefined, access.kind === "admin" ? access.userId : undefined),
    staleTime: access.kind === "offline" ? 0 : 5 * 60 * 1000,
    gcTime: access.kind === "offline" ? 0 : 5 * 60 * 1000,
  });
  useEffect(() => () => {
    if (access.kind === "offline") releaseOfflineAttachmentUrls(query.data);
  }, [access.kind, query.data]);
  return query;
}

function TextualViewer({ attachment, mode, onModeChange: _onModeChange, markdown = false, code = false, table = false }: { attachment: AttachmentRead; mode: "rendered" | "source"; onModeChange: (mode: AttachmentViewerMode) => void; markdown?: boolean; code?: boolean; table?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setError(false);
    if (!attachment.content_url) { setError(true); return () => controller.abort(); }
    void readPreviewText(retryableUrl(attachment.content_url, attempt)!, controller.signal).then((value) => {
      if (!controller.signal.aborted) setText(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attachment.content_url, attempt]);
  if (error) return <ViewerError message="预览加载失败。请重试读取。" onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  if (text === null) return <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (markdown && mode === "rendered") return <div className="h-full overflow-y-auto overscroll-contain bg-page p-5"><div className="mx-auto max-w-[900px]"><MarkdownRenderer text={text} isAssistant={false} scopeId={`attachment-${attachment.id}`} /></div></div>;
  if (table && mode === "rendered") return <DelimitedTableViewer text={text} delimiter={attachment.display_name.toLowerCase().endsWith(".tsv") ? "\t" : ","} />;
  return <pre className={`h-full overflow-auto overscroll-contain whitespace-pre-wrap break-words bg-page p-5 text-sm text-primary ${code || !markdown ? "font-mono" : ""}`}>{text}</pre>;
}

function DelimitedTableViewer({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimitedRows(text, delimiter), [text, delimiter]);
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
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setError(false);
    if (!attachment.content_url) { setError(true); return () => controller.abort(); }
    void readPreviewText(retryableUrl(attachment.content_url, attempt)!, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setText(value); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attachment.content_url, attempt]);
  const formatted = useMemo(() => {
    if (text === null || raw) return null;
    if ((attachment.asset_object?.byte_size ?? 0) > 8 * 1024 * 1024 || text.length > 8 * 1024 * 1024) return { error: "文件较大，已显示原文。" };
    let value: unknown;
    try { value = JSON.parse(text); } catch { return { error: "内容不是有效的 JSON，已显示原文。" }; }
    if (!inspectJsonComplexity(value).valid) return { error: "JSON 结构超出格式化预览上限，已显示原文。" };
    const json = JSON.stringify(value, null, 2);
    return json.length > 8 * 1024 * 1024 ? { error: "格式化内容较大，已显示原文。" } : { text: json };
  }, [text, raw, attachment.asset_object?.byte_size]);
  if (error) return <ViewerError message="JSON 读取失败。请重试读取。" onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  if (text === null) return <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return <div className="flex h-full min-h-0 flex-col bg-page" data-testid="json-viewer">
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-ui px-3 py-1"><ModeButton active={!raw} onClick={() => setRaw(false)}>格式化</ModeButton><ModeButton active={raw} onClick={() => setRaw(true)}>Raw</ModeButton></div>
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-5">{formatted?.error ? <p className="mb-3 text-sm text-secondary">{formatted.error}</p> : null}<pre className="whitespace-pre-wrap break-words font-mono text-sm text-primary">{formatted?.text ?? text}</pre></div>
  </div>;
}

const TEXT_PREVIEW_LIMIT = 50 * 1024 * 1024;
const TEXT_RANGE_CHUNK = 8 * 1024 * 1024;

async function readPreviewText(url: string, signal: AbortSignal): Promise<string> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total: number | null = null;
  while (offset < TEXT_PREVIEW_LIMIT && (total === null || offset < total)) {
    const end = Math.min(TEXT_PREVIEW_LIMIT, offset + TEXT_RANGE_CHUNK) - 1;
    const response = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` }, signal, cache: "no-store" });
    if (!response.ok && response.status !== 206) throw new Error("preview");
    const range = response.headers.get("content-range")?.match(/\/(\d+)$/);
    if (range) {
      total = Number(range[1]);
      if (total > TEXT_PREVIEW_LIMIT) throw new Error("preview-limit");
    }
    const chunk = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200) {
      if (chunk.byteLength > TEXT_PREVIEW_LIMIT) throw new Error("preview-limit");
      chunks.push(chunk);
      break;
    }
    if (!chunk.byteLength) break;
    chunks.push(chunk);
    offset += chunk.byteLength;
    if (!range && chunk.byteLength < end - Math.max(0, offset - chunk.byteLength) + 1) break;
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
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

function PdfViewer({ attachment, toolbarHost, onPageCountChange }: { attachment: AttachmentRead; toolbarHost: HTMLDivElement | null; onPageCountChange: (count: number | null) => void }) {
  const [documentProxy, setDocumentProxy] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [pdfjsVersion, setPdfjsVersion] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fitMode, setFitMode] = useState<PdfFitMode>("page");
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [pageInputError, setPageInputError] = useState(false);
  const [scrollRequest, setScrollRequest] = useState({ page: 1 });
  const [thumbnailRail, setThumbnailRail] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const pageSizesRef = useRef(new Map<number, PdfPageSize>());
  const [, setGeometryRevision] = useState(0);
  const renderQueue = useMemo(() => createPdfRenderQueue(), [documentProxy]);
  const onPageSize = useCallback((pageNumber: number, size: PdfPageSize) => {
    const previous = pageSizesRef.current.get(pageNumber);
    if (previous?.width === size.width && previous.height === size.height) return;
    pageSizesRef.current.set(pageNumber, size);
    setGeometryRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    setDocumentProxy(null);
    setPdfjsVersion(null);
    setError(false);
    pageSizesRef.current.clear();
    if (!attachment.content_url) { setError(true); return; }
    const sourceUrl = retryableUrl(attachment.content_url, attempt)!;
    void loadPdfJs().then((pdfjs) => {
      if (!active) return null;
      setPdfjsVersion(pdfjs.version);
      task = pdfjs.getDocument({
        url: sourceUrl,
        ...(sourceUrl.startsWith("/api/") || /^https?:/i.test(sourceUrl)
          ? { disableStream: true, disableAutoFetch: true, rangeChunkSize: 64 * 1024 }
          : {}),
        useWasm: false,
      });
      return task.promise;
    }).then((pdf) => {
      if (!active || !pdf) return;
      setDocumentProxy(pdf);
      setCurrentPage(1);
      setPageDraft(null);
      setPageInputError(false);
      setScrollRequest({ page: 1 });
      setFitMode("page");
      setZoom(1);
      onPageCountChange(pdf.numPages);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; void task?.destroy().catch(() => undefined); };
  }, [attachment.content_url, attempt, onPageCountChange]);
  useEffect(() => () => onPageCountChange(null), [onPageCountChange]);
  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    const update = () => setViewportSize((current) => current.width === viewportElement.clientWidth && current.height === viewportElement.clientHeight ? current : { width: viewportElement.clientWidth, height: viewportElement.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [documentProxy, thumbnailRail]);
  if (error) return <ViewerError message="无法加载 PDF 预览。请重试读取。" onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  if (!documentProxy) return <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  let actualScale: number | null = null;
  const currentSize = pageSizesRef.current.get(currentPage);
  if (currentSize && viewportSize.width && viewportSize.height) {
    try { actualScale = pdfPageLayout(currentSize, viewportSize, fitMode, zoom).scale; } catch { /* The page supplies local recovery. */ }
  }
  const selectPage = (pageNumber: number) => {
    const nextPage = Math.min(documentProxy.numPages, Math.max(1, pageNumber));
    setCurrentPage(nextPage);
    setPageDraft(null);
    setPageInputError(false);
    setScrollRequest({ page: nextPage });
  };
  const changeFit = (next: PdfFitMode) => {
    setFitMode(next);
    setScrollRequest({ page: currentPage });
  };
  const changeZoom = (next: number) => {
    setZoom(Math.min(4, Math.max(0.25, next)));
    changeFit("custom");
  };
  const toolbar = toolbarHost ? createPortal(
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1" aria-label="PDF 查看工具">
      <div className="flex items-center gap-1">
        {documentProxy.numPages > 1 ? <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => setThumbnailRail((value) => !value)} aria-expanded={thumbnailRail} aria-label={thumbnailRail ? "收起页面缩略图" : "展开页面缩略图"} title={thumbnailRail ? "收起页面缩略图" : "展开页面缩略图"}>{thumbnailRail ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}</button> : null}
        <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle disabled:opacity-40" onClick={() => selectPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
        <form className="flex items-center gap-1" onSubmit={(event) => {
          event.preventDefault();
          const pageNumber = parsePdfPageInput(pageDraft ?? String(currentPage), documentProxy.numPages);
          if (pageNumber === null) { setPageInputError(true); return; }
          selectPage(pageNumber);
        }}>
          <input aria-label="PDF 页码" aria-describedby={pageInputError ? "pdf-page-error pdf-page-total" : "pdf-page-total"} aria-invalid={pageInputError} inputMode="numeric" enterKeyHint="go" autoComplete="off" value={pageDraft ?? String(currentPage)} onChange={(event) => { setPageDraft(event.target.value); setPageInputError(false); }} className="h-11 w-14 rounded-md border border-ui bg-surface px-2 text-center text-base tabular-nums text-primary" />
          <span id="pdf-page-total" className="text-xs tabular-nums text-secondary" aria-label={`共 ${documentProxy.numPages} 页`}>/ {documentProxy.numPages}</span>
          <button type="submit" className="min-h-11 rounded-md px-2 text-xs text-secondary hover:bg-subtle">跳转</button>
        </form>
        <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle disabled:opacity-40" onClick={() => selectPage(currentPage + 1)} disabled={currentPage >= documentProxy.numPages} aria-label="下一页" data-testid="pdf-next-page"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="flex items-center gap-1"><ModeButton active={fitMode === "page"} onClick={() => changeFit("page")}>Fit page</ModeButton><ModeButton active={fitMode === "width"} onClick={() => changeFit("width")}>Fit width</ModeButton></div>
      <div className="flex items-center gap-1">
        <button type="button" data-viewer-zoom="out" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle disabled:opacity-40" disabled={actualScale === null || actualScale <= 0.25} onClick={() => changeZoom((actualScale ?? zoom) - 0.1)} aria-label="缩小 PDF"><ZoomOut className="h-4 w-4" /></button>
        <button type="button" className="min-h-11 min-w-14 rounded-md px-2 text-xs tabular-nums text-secondary hover:bg-subtle" onClick={() => changeZoom(1)} aria-label="PDF 缩放 100%" title="恢复 100%" data-testid="pdf-zoom">{actualScale === null ? "—" : `${Math.round(actualScale * 100)}%`}</button>
        <button type="button" data-viewer-zoom="in" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle disabled:opacity-40" disabled={actualScale === null || actualScale >= 4} onClick={() => changeZoom((actualScale ?? zoom) + 0.1)} aria-label="放大 PDF"><ZoomIn className="h-4 w-4" /></button>
      </div>
      {pageInputError ? <p id="pdf-page-error" role="alert" className="basis-full text-sm text-secondary">请输入 1 到 {documentProxy.numPages} 之间的页码。</p> : null}
    </div>,
    toolbarHost,
  ) : null;
  return (
    <div className="flex h-full min-h-0 bg-subtle" data-testid="pdf-viewer" data-pdfjs-version={pdfjsVersion ?? undefined}>
      {toolbar}
      {thumbnailRail && documentProxy.numPages > 1 ? <PdfThumbnailRail documentProxy={documentProxy} currentPage={currentPage} onSelect={selectPage} renderQueue={renderQueue} /> : null}
      <div ref={viewportRef} tabIndex={0} aria-label="PDF 阅读区域" className={`min-h-0 min-w-0 flex-1 overscroll-contain ${fitMode === "page" ? "overflow-hidden" : "overflow-auto"}`} data-testid="pdf-viewer-pages" data-pdf-fit={fitMode}>
        {fitMode === "page" ? <div className="flex h-full min-h-0 items-center justify-center p-3"><PdfPage documentProxy={documentProxy} pageNumber={currentPage} fitMode="page" zoom={zoom} containerWidth={viewportSize.width} containerHeight={viewportSize.height} renderQueue={renderQueue} onPageSize={onPageSize} /></div> : <PdfPageList documentProxy={documentProxy} currentPage={currentPage} scrollRequest={scrollRequest} onVisiblePageChange={setCurrentPage} fitMode={fitMode} zoom={zoom} containerWidth={viewportSize.width} containerHeight={viewportSize.height} viewportRef={viewportRef} pageSizesRef={pageSizesRef} renderQueue={renderQueue} onPageSize={onPageSize} />}
      </div>
    </div>
  );
}

function PdfPageList({ documentProxy, currentPage, scrollRequest, onVisiblePageChange, fitMode, zoom, containerWidth, containerHeight, viewportRef, pageSizesRef, renderQueue, onPageSize }: { documentProxy: import("pdfjs-dist").PDFDocumentProxy; currentPage: number; scrollRequest: { page: number }; onVisiblePageChange: (page: number) => void; fitMode: PdfFitMode; zoom: number; containerWidth: number; containerHeight: number; viewportRef: RefObject<HTMLDivElement | null>; pageSizesRef: RefObject<Map<number, PdfPageSize>>; renderQueue: PdfRenderQueue; onPageSize: (page: number, size: PdfPageSize) => void }) {
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const estimateLayout = (index: number) => {
    try { return pdfPageLayout(pageSizesRef.current.get(index + 1) ?? { width: 612, height: 792 }, { width: containerWidth, height: containerHeight }, fitMode, zoom); }
    catch { return { width: Math.max(1, containerWidth - 32), height: 240 }; }
  };
  const virtualizer = useVirtualizer({
    count: documentProxy.numPages,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => estimateLayout(index).height,
    overscan: 1,
    gap: 16,
    paddingStart: 16,
    paddingEnd: 16,
    scrollPaddingStart: 16,
  });
  useLayoutEffect(() => {
    if (!containerWidth || !containerHeight) return;
    virtualizer.measure();
    virtualizer.scrollToIndex(currentPageRef.current - 1, { align: "start", behavior: "auto" });
  }, [containerWidth, containerHeight, fitMode, zoom, virtualizer]);
  useLayoutEffect(() => {
    virtualizer.scrollToIndex(scrollRequest.page - 1, { align: "start", behavior: "auto" });
  }, [scrollRequest, virtualizer]);
  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    const update = () => {
      // A short final page cannot align with the viewport top once scrolling
      // reaches its limit. Keep the end-of-document page number truthful.
      if (root.scrollTop > 0 && root.scrollHeight - root.clientHeight - root.scrollTop <= 2) {
        onVisiblePageChange(documentProxy.numPages);
        return;
      }
      const item = virtualizer.getVirtualItemForOffset(root.scrollTop + 16);
      if (item) onVisiblePageChange(item.index + 1);
    };
    root.addEventListener("scroll", update, { passive: true });
    return () => root.removeEventListener("scroll", update);
  }, [documentProxy.numPages, onVisiblePageChange, viewportRef, virtualizer]);
  const items = virtualizer.getVirtualItems();
  const width = Math.max(containerWidth, ...items.map((item) => estimateLayout(item.index).width + 32));
  return <div className="relative min-w-full" style={{ height: virtualizer.getTotalSize(), width }} data-testid="pdf-virtual-pages">
    {items.map((item) => <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} className="absolute left-0 top-0 flex w-full justify-center px-4" style={{ transform: `translateY(${item.start}px)` }}>
      <PdfPage documentProxy={documentProxy} pageNumber={item.index + 1} fitMode={fitMode} zoom={zoom} containerWidth={containerWidth} containerHeight={containerHeight} renderQueue={renderQueue} onPageSize={onPageSize} />
    </div>)}
  </div>;
}

function PdfPage({ documentProxy, pageNumber, fitMode, zoom, containerWidth, containerHeight, renderQueue, onPageSize }: { documentProxy: import("pdfjs-dist").PDFDocumentProxy; pageNumber: number; fitMode: PdfFitMode; zoom: number; containerWidth: number; containerHeight: number; renderQueue: PdfRenderQueue; onPageSize?: (page: number, size: PdfPageSize) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderingRef = useRef<Promise<void>>(Promise.resolve());
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState<PdfPageSize | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerWidth || !containerHeight) return;
    const controller = new AbortController();
    let lease: ReturnType<typeof acquirePdfPage> | null = null;
    let renderTask: import("pdfjs-dist").RenderTask | null = null;
    setError(false);
    setLoading(true);
    // A cancelled PDF.js task must settle before the same canvas is reused.
    const work = renderingRef.current.then(() => renderQueue.run(controller.signal, async () => {
      lease = acquirePdfPage(documentProxy, pageNumber);
      const page = await lease.promise;
      if (controller.signal.aborted) return;
      const base = page.getViewport({ scale: 1 });
      const layout = pdfPageLayout(base, { width: containerWidth, height: containerHeight }, fitMode, zoom, window.devicePixelRatio);
      onPageSize?.(pageNumber, { width: base.width, height: base.height });
      setSize({ width: layout.width, height: layout.height });
      canvas.width = layout.pixelWidth;
      canvas.height = layout.pixelHeight;
      canvas.style.width = `${layout.width}px`;
      canvas.style.height = `${layout.height}px`;
      renderTask = page.render({ canvas, viewport: page.getViewport({ scale: layout.scale }), transform: layout.ratio === 1 ? undefined : [layout.ratio, 0, 0, layout.ratio, 0, 0] });
      await renderTask.promise;
      if (!controller.signal.aborted) setLoading(false);
    })).catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false); } });
    renderingRef.current = work;
    return () => {
      controller.abort();
      renderTask?.cancel();
      void work.then(() => { canvas.width = 0; canvas.height = 0; lease?.release(); });
    };
  }, [containerHeight, containerWidth, documentProxy, fitMode, pageNumber, zoom, attempt, renderQueue, onPageSize]);
  let displaySize = size;
  if (!displaySize) {
    try { const estimate = pdfPageLayout({ width: 612, height: 792 }, { width: containerWidth, height: containerHeight }, fitMode, zoom); displaySize = { width: estimate.width, height: estimate.height }; }
    catch { displaySize = { width: Math.max(1, Math.min(320, containerWidth - 32)), height: Math.max(1, Math.min(240, containerHeight - 32)) }; }
  }
  return <div data-pdf-page={pageNumber} aria-busy={loading} className="relative flex shrink-0 items-center justify-center" style={displaySize}>
    <canvas ref={canvasRef} width={0} height={0} hidden={error || loading} className="bg-white shadow" aria-label={`PDF 第 ${pageNumber} 页`} />
    {error ? <div className="absolute inset-0 overflow-auto"><ViewerError message={`第 ${pageNumber} 页预览失败。`} onRetry={() => setAttempt((value) => value + 1)} /></div> : loading ? <span className="absolute text-sm text-secondary">正在加载第 {pageNumber} 页…</span> : null}
  </div>;
}

function PdfThumbnailRail({ documentProxy, currentPage, onSelect, renderQueue }: { documentProxy: import("pdfjs-dist").PDFDocumentProxy; currentPage: number; onSelect: (page: number) => void; renderQueue: PdfRenderQueue }) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const virtualizer = useVirtualizer({ count: documentProxy.numPages, getScrollElement: () => viewportRef.current, estimateSize: () => 144, gap: 8, paddingStart: 8, paddingEnd: 8, overscan: 1 });
  useEffect(() => { virtualizer.scrollToIndex(currentPage - 1, { align: "auto", behavior: "auto" }); }, [currentPage, virtualizer]);
  return <aside ref={viewportRef} className="w-28 shrink-0 overflow-y-auto overscroll-contain border-r border-ui bg-page" aria-label="PDF 页面缩略图">
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => <div key={item.key} className="absolute left-0 top-0 w-full px-2" style={{ height: item.size, transform: `translateY(${item.start}px)` }}><PdfThumbnail documentProxy={documentProxy} pageNumber={item.index + 1} active={currentPage === item.index + 1} onClick={() => onSelect(item.index + 1)} renderQueue={renderQueue} /></div>)}
    </div>
  </aside>;
}

function PdfThumbnail({ documentProxy, pageNumber, active, onClick, renderQueue }: { documentProxy: import("pdfjs-dist").PDFDocumentProxy; pageNumber: number; active: boolean; onClick: () => void; renderQueue: PdfRenderQueue }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderingRef = useRef<Promise<void>>(Promise.resolve());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    let lease: ReturnType<typeof acquirePdfPage> | null = null;
    let renderTask: import("pdfjs-dist").RenderTask | null = null;
    setFailed(false);
    const work = renderingRef.current.then(() => renderQueue.run(controller.signal, async () => {
      lease = acquirePdfPage(documentProxy, pageNumber);
      const page = await lease.promise;
      if (controller.signal.aborted) return;
      const base = page.getViewport({ scale: 1 });
      const layout = pdfPageLayout(base, { width: 114, height: 136 }, "page", 1);
      canvas.width = layout.pixelWidth;
      canvas.height = layout.pixelHeight;
      renderTask = page.render({ canvas, viewport: page.getViewport({ scale: layout.scale }) });
      await renderTask.promise;
    }, 1)).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    renderingRef.current = work;
    return () => { controller.abort(); renderTask?.cancel(); void work.then(() => { canvas.width = 0; canvas.height = 0; lease?.release(); }); };
  }, [documentProxy, pageNumber, renderQueue]);
  return <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} aria-label={`打开 PDF 第 ${pageNumber} 页`} className={`flex h-full w-full flex-col items-center justify-between gap-1 rounded-md border p-1 text-xs text-secondary ${active ? "border-[var(--accent)] font-semibold" : "border-ui"}`}><canvas ref={canvasRef} width={0} height={0} hidden={failed} className="max-w-full bg-white" />{failed ? <span>预览不可用</span> : null}<span>{pageNumber}</span></button>;
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

function ViewerError({ message, onRetry, downloadUrl }: { message: string; onRetry?: () => void; downloadUrl?: string }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-secondary"><p>{message}</p><div className="flex gap-2">{onRetry ? <button type="button" onClick={onRetry} className="min-h-11 rounded-md border border-ui px-4">重试</button> : null}{downloadUrl ? <a href={downloadUrl} download className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--text)] px-4 text-[var(--surface)]"><Download className="h-4 w-4" />下载</a> : null}</div></div>;
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-11 shrink-0 rounded-md px-3 text-xs ${active ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle"}`}>{children}</button>;
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
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
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
