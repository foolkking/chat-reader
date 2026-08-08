"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Grid2X2, Loader2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
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
  const [mode, setMode] = useState<AttachmentViewerMode | null>(null);

  const attachmentQuery = useQuery({
    queryKey: ["attachment-viewer", access.kind, access.kind === "share" ? access.token : "owner", item?.attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(item!.attachmentId) : getAttachment(item!.attachmentId, access.kind === "share" ? access.token : undefined),
    enabled: Boolean(item),
    staleTime: 5 * 60 * 1000,
  });
  const attachment = attachmentQuery.data;
  const viewerKind = attachment ? resolveAttachmentCapability(attachment).viewerKind : null;
  const effectiveMode = mode ?? defaultMode(viewerKind);

  useEffect(() => {
    previousFocusRef.current = session.trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    acquireViewerScrollLock();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
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
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-2 outline-none sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      data-testid="attachment-viewer-shell"
    >
      <section className="grid h-[100dvh] w-full min-h-0 grid-rows-[auto,minmax(0,1fr),auto] overflow-hidden bg-page shadow-2xl sm:h-[94vh] sm:w-[96vw] sm:rounded-xl" data-testid="attachment-viewer-panel">
        <header className="flex min-h-14 items-center gap-2 border-b border-ui px-3 sm:px-4">
          <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={onClose} aria-label="关闭附件查看器" title="关闭"><X className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-primary" title={attachment?.display_name}>{attachment?.display_name ?? "正在加载附件"}</h2>
            <p className="truncate text-xs text-secondary">{attachment ? `${friendlyAttachmentType(attachment)} · ${formatBytes(attachment.asset_object?.byte_size ?? 0)}${attachment.scan_status === "scanner_disabled" || attachment.scan_status === "unscanned" ? " · 未扫描" : ""}` : ""}{session.items.length > 1 ? ` · ${index + 1} / ${session.items.length}` : ""}</p>
          </div>
          {viewerKind === "markdown" ? <div className="hidden items-center gap-1 sm:flex"><ModeButton active={effectiveMode === "markdown-rendered"} onClick={() => setMode("markdown-rendered")}>Rendered</ModeButton><ModeButton active={effectiveMode === "markdown-source"} onClick={() => setMode("markdown-source")}>Source</ModeButton></div> : null}
          {session.permissions.downloadOriginal && attachment?.download_url ? <a href={attachment.download_url} download className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={`下载 ${attachment.display_name}`} title="下载"><Download className="h-5 w-5" /></a> : null}
          {viewerKind === "image" && session.items.length > 1 ? <button type="button" className="hidden h-11 shrink-0 items-center gap-1 rounded-md px-3 text-sm text-secondary hover:bg-subtle sm:inline-flex" onClick={() => setMode("image-overview")} aria-label="查看全部图片" title="查看全部图片"><Grid2X2 className="h-4 w-4" />全部</button> : null}
        </header>
        <div className="min-h-0 overflow-hidden overscroll-contain" data-testid="attachment-viewer-content">
          {attachmentQuery.isPending ? <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div> : attachmentQuery.isError || !attachment ? <ViewerError message="附件无法加载" onRetry={() => void attachmentQuery.refetch()} downloadUrl={undefined} /> : <ViewerBody attachment={attachment} kind={viewerKind} mode={effectiveMode} onModeChange={setMode} session={session} activeIndex={index} onSelect={(next) => { setActiveKey(session.items[next]?.itemKey ?? activeKey); setMode("image-focus"); }} onPrevious={() => setActiveIndex(-1)} onNext={() => setActiveIndex(1)} />}
        </div>
        {viewerKind === "image" && session.items.length > 1 && effectiveMode !== "image-overview" ? <div className="flex min-h-16 gap-2 overflow-x-auto border-t border-ui bg-subtle p-2" role="list" aria-label="图片缩略图列表">{session.items.map((candidate, candidateIndex) => <ViewerThumbnail key={candidate.itemKey} item={candidate} access={access} active={candidate.itemKey === activeKey} label={`第 ${candidateIndex + 1} 张`} onClick={() => { setActiveKey(candidate.itemKey); setMode("image-focus"); }} />)}</div> : null}
      </section>
    </div>,
    document.body,
  );
}

function ViewerBody({ attachment, kind, mode, onModeChange, session, activeIndex, onSelect, onPrevious, onNext }: { attachment: AttachmentRead; kind: AttachmentViewerKind | null; mode: AttachmentViewerMode | null; onModeChange: (mode: AttachmentViewerMode) => void; session: AttachmentViewerSession; activeIndex: number; onSelect: (index: number) => void; onPrevious: () => void; onNext: () => void }) {
  if (kind === "image") return <ImageViewer attachment={attachment} session={session} activeIndex={activeIndex} mode={mode === "image-overview" ? "overview" : "focus"} onSelect={onSelect} onPrevious={onPrevious} onNext={onNext} />;
  if (kind === "markdown") return <TextualViewer attachment={attachment} mode={mode === "markdown-source" ? "source" : "rendered"} onModeChange={onModeChange} markdown />;
  if (kind === "code") return <TextualViewer attachment={attachment} mode="source" onModeChange={onModeChange} code />;
  if (kind === "json") return <JsonViewer attachment={attachment} />;
  if (kind === "table") return <TextualViewer attachment={attachment} mode="source" onModeChange={onModeChange} table />;
  if (kind === "audio") return <MediaViewer attachment={attachment} audio />;
  if (kind === "video") return <MediaViewer attachment={attachment} />;
  if (kind === "pdf") return <PdfViewer attachment={attachment} />;
  return <TextualViewer attachment={attachment} mode="source" onModeChange={onModeChange} />;
}

function ImageViewer({ attachment, session, activeIndex, mode, onSelect, onPrevious, onNext }: { attachment: AttachmentRead; session: AttachmentViewerSession; activeIndex: number; mode: "focus" | "overview"; onSelect: (index: number) => void; onPrevious: () => void; onNext: () => void }) {
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
              <img src={retryableUrl(attachment.content_url, attempt)} alt={session.items[activeIndex]?.alt ?? attachment.display_name} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
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
  return <button type="button" onClick={() => onSelect(index)} className="mb-3 flex min-h-28 w-full break-inside-avoid items-center justify-center rounded-lg border border-ui bg-subtle p-2 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label={`查看第 ${index + 1} 张图片`}>{query.data?.content_url ? <img src={query.data.content_url} alt={item.alt ?? query.data.display_name} loading="lazy" decoding="async" className="h-auto max-h-80 max-w-full object-contain" /> : <Loader2 className="h-4 w-4 animate-spin text-secondary" />}</button>;
}

function ViewerThumbnail({ item, access, active, label, onClick }: { item: AttachmentViewerItem; access: AttachmentAccess; active: boolean; label: string; onClick: () => void }) {
  const query = useViewerAttachment(item.attachmentId, access);
  return <button type="button" role="listitem" aria-current={active ? "true" : undefined} aria-label={label} onClick={onClick} className={`flex h-12 min-w-12 items-center justify-center rounded-md border p-1 ${active ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-ui"}`} title={query.data?.display_name ?? item.alt ?? label}>{query.data?.content_url ? <img src={query.data.content_url} alt="" loading="lazy" className="h-10 w-10 object-contain" /> : <span className="text-xs text-secondary">{label.replace(/\D/g, "")}</span>}</button>;
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
  if (table && mode === "rendered") return <pre className="h-full overflow-auto whitespace-pre p-5 font-mono text-sm text-primary">{text}</pre>;
  return <pre className={`h-full overflow-auto overscroll-contain whitespace-pre-wrap break-words bg-page p-5 text-sm text-primary ${code || !markdown ? "font-mono" : ""}`}>{text}</pre>;
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

function PdfViewer({ attachment }: { attachment: AttachmentRead }) {
  const [documentProxy, setDocumentProxy] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
    }).then((pdf) => { if (active) setDocumentProxy(pdf); }).catch(() => { if (active) setError(true); });
    return () => { active = false; void task?.destroy(); };
  }, [attachment.content_url, attempt]);
  if (error) return <ViewerError message="无法加载 PDF 预览，原文件仍可下载。" onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  if (!documentProxy) return <div className="flex h-full items-center justify-center text-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return <div className="h-full overflow-y-auto overscroll-contain bg-subtle px-2 py-4" data-testid="pdf-viewer-pages"><div className="mx-auto flex max-w-[960px] flex-col gap-4">{Array.from({ length: documentProxy.numPages }, (_, index) => <PdfPage key={index + 1} documentProxy={documentProxy} pageNumber={index + 1} />)}</div></div>;
}

function PdfPage({ documentProxy, pageNumber }: { documentProxy: import("pdfjs-dist").PDFDocumentProxy; pageNumber: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
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
      const targetWidth = Math.min(900, hostRef.current?.clientWidth ?? 900);
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      renderTask = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      return renderTask.promise;
    }).catch(() => undefined);
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [documentProxy, pageNumber, visible]);
  return <div ref={hostRef} className="flex min-h-[28rem] flex-col items-center gap-2"><p className="text-xs text-secondary">第 {pageNumber} 页</p>{visible ? <canvas ref={canvasRef} className="max-w-full bg-white shadow" /> : <div className="h-[28rem] w-full max-w-[900px] animate-pulse bg-surface" />}</div>;
}

function MediaViewer({ attachment, audio = false }: { attachment: AttachmentRead; audio?: boolean }) {
  const [failure, setFailure] = useState<"unsupported" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setFailure(null), [attachment.id, attempt]);
  const handleError = (element: HTMLMediaElement) => {
    const mime = attachment.detected_mime_type || attachment.asset_object?.detected_mime_type || attachment.declared_mime_type || "";
    setFailure(mime && element.canPlayType(mime) === "" ? "unsupported" : "failed");
  };
  if (failure) return <ViewerError message={failure === "unsupported" ? "当前浏览器不支持直接播放此格式。" : "媒体预览加载失败，原文件仍可下载。"} onRetry={() => setAttempt((value) => value + 1)} downloadUrl={attachment.download_url ?? undefined} />;
  return <div className="flex h-full items-center justify-center bg-black p-4">{audio ? <audio src={retryableUrl(attachment.content_url, attempt)} controls preload="metadata" className="w-full max-w-3xl" onError={(event) => handleError(event.currentTarget)} /> : <video src={retryableUrl(attachment.content_url, attempt)} controls preload="metadata" playsInline className="max-h-full max-w-full object-contain" onError={(event) => handleError(event.currentTarget)} />}</div>;
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
  return null;
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
