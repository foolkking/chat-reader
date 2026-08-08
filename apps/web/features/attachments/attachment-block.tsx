"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Code2,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  X,
} from "lucide-react";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { useAttachmentAccess } from "./attachment-access";
import {
  attachmentExtension,
  buildComplexPreviewUrl,
  resolveAttachmentPreviewKind,
  type AttachmentPreviewKind,
} from "./preview-adapter-registry";

let attachmentPreviewScrollLockCount = 0;
let attachmentPreviewPreviousOverflow = "";
let attachmentPreviewScrollPosition: { x: number; y: number } | null = null;

function acquireAttachmentPreviewScrollLock() {
  if (attachmentPreviewScrollLockCount === 0) {
    attachmentPreviewPreviousOverflow = document.body.style.overflow;
    attachmentPreviewScrollPosition = { x: window.scrollX, y: window.scrollY };
    document.body.style.overflow = "hidden";
  }
  attachmentPreviewScrollLockCount += 1;
}

function releaseAttachmentPreviewScrollLock() {
  attachmentPreviewScrollLockCount = Math.max(0, attachmentPreviewScrollLockCount - 1);
  if (attachmentPreviewScrollLockCount !== 0) return;
  document.body.style.overflow = attachmentPreviewPreviousOverflow;
  const position = attachmentPreviewScrollPosition;
  attachmentPreviewScrollPosition = null;
  if (position) window.scrollTo({ left: position.x, top: position.y, behavior: "auto" });
}

export function AttachmentBlock({
  attachmentId,
  displayMode = "card",
  alt,
  caption,
}: {
  attachmentId: string;
  displayMode?: string;
  alt?: string;
  caption?: string;
}) {
  const access = useAttachmentAccess();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inlineFailure, setInlineFailure] = useState<"image" | "media" | null>(null);
  const shareToken = access.kind === "share" ? access.token : undefined;
  const query = useQuery({
    queryKey: ["attachment", access.kind, shareToken ?? "owner", attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(attachmentId) : getAttachment(attachmentId, shareToken),
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });
  const attachment = query.data;
  const mime = detectedMime(attachment);
  const previewKind = resolveAttachmentPreviewKind(mime, attachment?.display_name ?? caption ?? alt ?? "");
  const openPreview = () => setPreviewOpen(true);

  if (attachment && previewKind === "image" && attachment.content_url && inlineFailure !== "image") {
    return (
      <>
        <figure
          className="m-0 w-full max-w-[720px] overflow-hidden rounded-lg border border-ui bg-surface"
          data-testid="attachment-block"
          data-attachment-id={attachmentId}
          data-attachment-mode="inline-rich"
        >
          <AttachmentHeader attachment={attachment} previewKind={previewKind} onPreview={openPreview} />
          <button type="button" className="flex min-h-24 w-full items-center justify-center bg-subtle" onClick={openPreview} aria-label={`Preview ${attachment.display_name}`}>
            <img
              src={attachment.content_url}
              alt={alt || attachment.display_name}
              className="max-h-[480px] max-w-full object-contain"
              loading="lazy"
              decoding="async"
              onError={() => setInlineFailure("image")}
            />
          </button>
          {caption ? <figcaption className="border-t border-ui px-3 py-2 text-xs text-secondary">{caption}</figcaption> : null}
        </figure>
        {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
      </>
    );
  }

  if (attachment?.content_url && isTextualPreview(previewKind)) {
    return (
      <InlineTextAttachment
        attachment={attachment}
        alt={alt}
        caption={caption}
        previewKind={previewKind}
        onPreview={openPreview}
        previewOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    );
  }

  if (attachment?.content_url && previewKind === "audio" && inlineFailure !== "media") {
    return (
      <>
        <figure className="m-0 w-full max-w-[720px] overflow-hidden rounded-lg border border-ui bg-surface" data-testid="attachment-block" data-attachment-id={attachmentId} data-attachment-mode="inline-compact">
          <AttachmentHeader attachment={attachment} previewKind={previewKind} onPreview={openPreview} />
          <div className="px-3 py-2">
            <audio src={attachment.content_url} controls preload="metadata" className="h-11 w-full" onError={() => setInlineFailure("media")} />
          </div>
        </figure>
        {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
      </>
    );
  }

  if (attachment?.content_url && previewKind === "video" && inlineFailure !== "media") {
    return (
      <>
        <figure className="m-0 w-full max-w-[560px] overflow-hidden rounded-lg border border-ui bg-surface" data-testid="attachment-block" data-attachment-id={attachmentId} data-attachment-mode="inline-compact">
          <AttachmentHeader attachment={attachment} previewKind={previewKind} onPreview={openPreview} />
          <video
            src={attachment.content_url}
            controls
            preload="metadata"
            className="aspect-video max-h-[315px] w-full bg-black object-contain"
            onError={() => setInlineFailure("media")}
          />
        </figure>
        {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
      </>
    );
  }

  const fallbackReason = inlineFailure === "image"
    ? "预览失败，文件仍可下载"
    : inlineFailure === "media"
      ? "当前浏览器无法直接播放此格式"
      : undefined;
  return (
    <>
      <AttachmentFileCard
        attachment={attachment}
        loading={query.isPending}
        loadError={query.isError}
        previewKind={previewKind}
        fallbackReason={fallbackReason}
        displayMode={displayMode}
        caption={caption || alt}
        onPreview={attachment && canOpenPreview(previewKind, attachment) ? openPreview : undefined}
      />
      {previewOpen && attachment ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
    </>
  );
}

function AttachmentHeader({ attachment, previewKind, onPreview }: { attachment: AttachmentRead; previewKind: AttachmentPreviewKind; onPreview?: () => void }) {
  const byteSize = attachment.asset_object?.byte_size ?? 0;
  const isSvgImage = detectedMime(attachment).toLowerCase() === "image/svg+xml" || attachmentExtension(attachment.display_name) === "svg";
  return (
    <header className="flex min-h-12 items-center gap-2 border-b border-ui bg-subtle px-3 py-2">
      {isSvgImage
        ? <span className="shrink-0 text-[10px] font-semibold text-secondary" aria-hidden="true">SVG</span>
        : <AttachmentKindIcon kind={previewKind} className="h-4 w-4 shrink-0 text-secondary" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-primary" title={attachment.display_name}>{attachment.display_name}</p>
        <p className="truncate text-[11px] text-secondary">{attachmentMeta(attachment, byteSize)}</p>
      </div>
      {onPreview ? (
        <button type="button" onClick={onPreview} className={`inline-flex h-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-surface ${isSvgImage ? "px-2 text-xs" : "w-9"}`} aria-label={`Preview ${attachment.display_name}`} title="预览">
          {isSvgImage ? "查看" : <ExternalLink className="h-4 w-4" />}
        </button>
      ) : null}
      {attachment.download_url ? (
        <a href={attachment.download_url} className={`inline-flex h-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-surface ${isSvgImage ? "px-2 text-xs" : "w-9"}`} aria-label={`Download ${attachment.display_name}`} title="下载">
          {isSvgImage ? "下载" : <Download className="h-4 w-4" />}
        </a>
      ) : null}
    </header>
  );
}

function AttachmentFileCard({
  attachment,
  loading,
  loadError,
  previewKind,
  fallbackReason,
  displayMode,
  caption,
  onPreview,
}: {
  attachment?: AttachmentRead;
  loading: boolean;
  loadError: boolean;
  previewKind: AttachmentPreviewKind;
  fallbackReason?: string;
  displayMode: string;
  caption?: string;
  onPreview?: () => void;
}) {
  const name = attachment?.display_name || caption || "Attachment";
  const size = attachment?.asset_object?.byte_size ?? 0;
  const missing = attachment?.resolution_status === "missing" || (!attachment?.asset_object && Boolean(attachment));
  const status = fallbackReason ?? (missing ? "文件缺失" : attachment ? attachmentMeta(attachment, size) : loadError ? "附件不可用" : "正在加载附件");
  return (
    <div
      className="flex min-h-16 w-full max-w-[720px] items-center gap-3 rounded-lg border border-ui bg-surface px-3 py-2"
      data-testid="attachment-block"
      data-attachment-id={attachment?.id}
      data-attachment-mode={fallbackReason ? "fallback" : "file-card"}
      data-display-mode={displayMode}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle text-secondary">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : fallbackReason || missing ? <AlertTriangle className="h-5 w-5" /> : <AttachmentKindIcon kind={previewKind} className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-primary" title={name}>{name}</p>
        <p className={`mt-0.5 truncate text-xs ${fallbackReason || missing ? "text-[var(--danger)]" : "text-secondary"}`}>{status}</p>
      </div>
      {onPreview ? (
        <button type="button" onClick={onPreview} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={`Preview ${name}`} title="预览">
          <ExternalLink className="h-4 w-4" />
        </button>
      ) : null}
      {attachment?.download_url && !missing ? (
        <a href={attachment.download_url} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={`Download ${name}`} title="下载">
          <Download className="h-4 w-4" />
        </a>
      ) : null}
    </div>
  );
}

export function AttachmentPreviewDialog({ attachment, alt, onClose }: { attachment: AttachmentRead; alt?: string; onClose: () => void }) {
  const mime = detectedMime(attachment);
  const previewKind = resolveAttachmentPreviewKind(mime, attachment.display_name);
  const url = attachment.content_url;
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isText = isTextualPreview(previewKind);
  const immersive = previewKind === "image" || previewKind === "video";
  const compactAudio = previewKind === "audio";
  const panelClassName = immersive
    ? "flex h-[min(88dvh,56rem)] w-[min(94vw,88rem)] flex-col overflow-hidden rounded-lg border border-white/15 bg-black/90 shadow-2xl"
    : compactAudio
      ? "flex min-h-40 w-[min(92vw,48rem)] flex-col overflow-hidden rounded-lg border border-ui bg-page shadow-2xl"
      : previewKind === "pdf"
        ? "flex h-[min(88dvh,58rem)] w-[min(94vw,80rem)] flex-col overflow-hidden rounded-lg border border-ui bg-page shadow-2xl"
        : "flex h-[min(84dvh,52rem)] w-[min(92vw,72rem)] flex-col overflow-hidden rounded-lg border border-ui bg-page shadow-2xl";
  const complexPreviewUrl = useMemo(() => url ? buildComplexPreviewUrl(url, mime) : null, [mime, url]);
  useEffect(() => {
    if (!url || !isText) return;
    const controller = new AbortController();
    void fetch(url, { headers: { Range: "bytes=0-524287" }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("preview failed");
        return response.text();
      })
      .then(setText)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTextError(true);
      });
    return () => controller.abort();
  }, [isText, url]);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])", '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    acquireAttachmentPreviewScrollLock();
    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      releaseAttachmentPreviewScrollLock();
      if (previouslyFocused?.isConnected) window.requestAnimationFrame(() => previouslyFocused.focus());
    };
  }, []);

  const body = useMemo<ReactNode>(() => {
    if (!url) return <p className="p-6 text-sm text-secondary">无法预览此附件。</p>;
    if (previewKind === "image") return <DialogImage src={url} alt={alt || attachment.display_name} />;
    if (previewKind === "pdf") return <iframe src={url} title={attachment.display_name} className="h-full w-full border-0" />;
    if (previewKind === "audio") return <DialogMedia kind="audio" src={url} />;
    if (previewKind === "video") return <DialogMedia kind="video" src={url} />;
    if (previewKind === "complex" && complexPreviewUrl) return <iframe src={complexPreviewUrl} title={attachment.display_name} sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" className="h-full w-full border-0" />;
    if (previewKind === "markdown") return <div className="h-full w-full overflow-auto bg-page p-5"><MarkdownRenderer text={textError ? "预览加载失败。" : text ?? "正在加载预览..."} isAssistant={false} /></div>;
    if (previewKind === "table") return <div className="h-full w-full overflow-auto bg-page p-5">{textError ? <p className="text-sm text-[var(--danger)]">预览加载失败。</p> : text === null ? <p className="text-sm text-secondary">正在加载预览...</p> : <DelimitedTablePreview text={text} filename={attachment.display_name} expanded />}</div>;
    if (isText) return <pre className="max-h-[calc(100dvh-10rem)] w-full overflow-auto whitespace-pre-wrap break-words bg-page p-5 font-mono text-sm text-primary">{textError ? "预览加载失败。" : text ?? "正在加载预览..."}</pre>;
    return <p className="p-6 text-sm text-secondary">当前格式不支持直接预览，请下载文件。</p>;
  }, [alt, attachment.display_name, complexPreviewUrl, isText, previewKind, text, textError, url]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={dialogRef} tabIndex={-1} className={`fixed inset-0 z-[1000] flex items-center justify-center p-2 outline-none sm:p-5 ${immersive ? "bg-black/75" : "bg-black/50 backdrop-blur-[1px]"}`} role="dialog" aria-modal="true" aria-label={`Preview ${attachment.display_name}`} data-preview-kind={previewKind} onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <section className={panelClassName} data-testid="attachment-preview-panel">
        <header className={`flex min-h-14 items-center gap-3 border-b px-4 ${immersive ? "border-white/15 bg-black/80" : "border-ui bg-page"}`}>
          <div className="min-w-0 flex-1">
            <h2 className={`truncate text-sm font-semibold ${immersive ? "text-white" : "text-primary"}`}>{attachment.display_name}</h2>
            <p className={`truncate text-xs ${immersive ? "text-white/65" : "text-secondary"}`}>{attachmentMeta(attachment, attachment.asset_object?.byte_size ?? 0)}</p>
          </div>
          {attachment.download_url ? <a href={attachment.download_url} className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${immersive ? "text-white/75 hover:bg-white/10 hover:text-white" : "text-secondary hover:bg-subtle"}`} aria-label={`Download ${attachment.display_name}`} title="下载"><Download className="h-4 w-4" /></a> : null}
          <button ref={closeButtonRef} type="button" onClick={() => onCloseRef.current()} className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${immersive ? "text-white/75 hover:bg-white/10 hover:text-white" : "text-secondary hover:bg-subtle"}`} aria-label="Close preview"><X className="h-5 w-5" /></button>
        </header>
        <div className={`flex min-h-0 flex-1 items-center justify-center overflow-auto ${immersive ? "bg-black" : compactAudio ? "bg-page p-5" : "bg-subtle"}`} data-testid="attachment-preview-content">{body}</div>
      </section>
    </div>,
    document.body,
  );
}

function InlineTextAttachment({
  attachment,
  alt,
  caption,
  previewKind,
  onPreview,
  previewOpen,
  onClose,
}: {
  attachment: AttachmentRead;
  alt?: string;
  caption?: string;
  previewKind: AttachmentPreviewKind;
  onPreview: () => void;
  previewOpen: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!attachment.content_url) return;
    const controller = new AbortController();
    void fetch(attachment.content_url, { headers: { Range: "bytes=0-131071" }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("preview failed");
        return response.text();
      })
      .then(setText)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [attachment.content_url]);

  let content: ReactNode;
  if (failed) {
    content = <p className="p-4 text-sm text-[var(--danger)]">预览失败，文件仍可下载。</p>;
  } else if (text === null) {
    content = <p className="p-4 text-sm text-secondary">正在加载预览...</p>;
  } else if (text.length === 0) {
    content = <p className="p-4 text-sm text-secondary">空文件 · 0 B</p>;
  } else if (previewKind === "markdown") {
    content = <div className="max-h-[260px] overflow-hidden p-4"><MarkdownRenderer text={text} isAssistant={false} /></div>;
  } else if (previewKind === "table") {
    content = <div className="max-h-[240px] overflow-auto p-3"><DelimitedTablePreview text={text} filename={attachment.display_name} /></div>;
  } else {
    content = <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-primary">{limitPreviewLines(text, previewKind === "code" ? 16 : 12)}</pre>;
  }

  return (
    <>
      <figure className="m-0 w-full max-w-[720px] overflow-hidden rounded-lg border border-ui bg-surface" data-testid="attachment-block" data-attachment-id={attachment.id} data-attachment-mode="inline-compact">
        <AttachmentHeader attachment={attachment} previewKind={previewKind} onPreview={onPreview} />
        {content}
        {caption && caption !== attachment.display_name && caption !== alt ? <figcaption className="border-t border-ui px-3 py-2 text-xs text-secondary">{caption}</figcaption> : null}
      </figure>
      {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={onClose} /> : null}
    </>
  );
}

function DialogImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="p-6 text-sm text-[var(--danger)]">预览失败，文件仍可下载。</p>;
  return <img src={src} alt={alt} className="max-h-[calc(100dvh-10rem)] max-w-full object-contain" onError={() => setFailed(true)} />;
}

function DialogMedia({ kind, src }: { kind: "audio" | "video"; src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="p-6 text-sm text-[var(--danger)]">当前浏览器无法直接播放此格式，请下载文件。</p>;
  return kind === "audio"
    ? <audio src={src} controls preload="metadata" className="w-full max-w-3xl" onError={() => setFailed(true)} />
    : <video src={src} controls preload="metadata" className="max-h-[calc(100dvh-10rem)] max-w-full" onError={() => setFailed(true)} />;
}

function DelimitedTablePreview({ text, filename, expanded = false }: { text: string; filename: string; expanded?: boolean }) {
  const delimiter = attachmentExtension(filename) === "tsv" ? "\t" : ",";
  const rows = parseDelimitedRows(text, delimiter, expanded ? 200 : 8, expanded ? 40 : 8);
  if (rows.length === 0) return <p className="text-sm text-secondary">空文件 · 0 B</p>;
  const columnCount = Math.max(...rows.map((row) => row.length));
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-secondary">预览 {rows.length} 行 × {columnCount} 列</p>
      <div className="max-w-full overflow-auto rounded-lg border border-ui">
        <table className="w-max min-w-full border-collapse text-left text-xs">
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-64 truncate border-b border-r border-ui px-2 py-1.5 text-primary" title={cell}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function parseDelimitedRows(text: string, delimiter: string, maxRows: number, maxColumns: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length && rows.length < maxRows; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      if (row.length < maxColumns) row.push(value);
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (row.length < maxColumns) row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (rows.length < maxRows && (value || row.length)) {
    if (row.length < maxColumns) row.push(value);
    rows.push(row);
  }
  return rows;
}

function limitPreviewLines(text: string, maximum: number): string {
  const lines = text.split(/\r?\n/);
  return lines.length > maximum ? `${lines.slice(0, maximum).join("\n")}\n…` : text;
}

function isTextualPreview(kind: AttachmentPreviewKind): boolean {
  return kind === "text" || kind === "markdown" || kind === "table" || kind === "code";
}

function canOpenPreview(kind: AttachmentPreviewKind, attachment: AttachmentRead): boolean {
  if (!attachment.content_url) return false;
  return kind !== "download";
}

function detectedMime(attachment?: AttachmentRead): string {
  return attachment?.asset_object?.detected_mime_type ?? attachment?.detected_mime_type ?? attachment?.declared_mime_type ?? "application/octet-stream";
}

function attachmentMeta(attachment: AttachmentRead, byteSize: number): string {
  if (byteSize === 0) return "空文件 · 0 B";
  const parts = [friendlyTypeLabel(detectedMime(attachment), attachment.display_name), readableBytes(byteSize)];
  if (attachment.scan_status === "scanner_disabled" || attachment.scan_status === "unscanned") parts.push("未扫描");
  if (attachment.resolution_status === "missing") parts.push("文件缺失");
  return parts.join(" · ");
}

export function friendlyTypeLabel(mimeType: string, filename: string): string {
  const extension = attachmentExtension(filename);
  const named: Record<string, string> = {
    aac: "AAC 音频", avi: "AVI 视频", bmp: "BMP 图片", bz2: "BZ2 压缩包", csv: "CSV 表格", doc: "Word 文档", docx: "Word 文档",
    drawio: "Draw.io 图表", dxf: "DXF 图纸", epub: "EPUB 电子书", flac: "FLAC 音频", gif: "GIF 图片", gz: "GZIP 压缩包", html: "HTML 源码",
    ico: "ICO 图片", jpeg: "JPEG 图片", jpg: "JPEG 图片", json: "JSON 数据", m4a: "M4A 音频", markdown: "Markdown 文档", md: "Markdown 文档",
    mkv: "MKV 视频", mov: "MOV 视频", mp3: "MP3 音频", mp4: "MP4 视频", obj: "OBJ 3D 模型", odp: "ODP 演示文稿", ods: "ODS 表格",
    odt: "ODT 文档", ogg: "OGG 音频", pdf: "PDF 文档", png: "PNG 图片", ppt: "PowerPoint 演示文稿", pptx: "PowerPoint 演示文稿",
    rtf: "RTF 文档", sql: "SQL 源码", stl: "STL 3D 模型", svg: "SVG 图片", tar: "TAR 压缩包", tiff: "TIFF 图片", tif: "TIFF 图片",
    tsv: "TSV 表格", txt: "文本文件", vsdx: "Visio 图表", wav: "WAV 音频", webm: "WebM 视频", webp: "WebP 图片", xls: "Excel 表格",
    xlsx: "Excel 表格", xml: "XML 数据", xz: "XZ 压缩包", yaml: "YAML 数据", yml: "YAML 数据", zip: "ZIP 压缩包",
  };
  if (named[extension]) return named[extension];
  if (mimeType.startsWith("image/")) return "图片";
  if (mimeType.startsWith("audio/")) return "音频";
  if (mimeType.startsWith("video/")) return "视频";
  if (mimeType.startsWith("text/")) return "文本文件";
  return extension ? `${extension.toUpperCase()} 文件` : "文件";
}

function AttachmentKindIcon({ kind, className }: { kind: AttachmentPreviewKind; className?: string }) {
  if (kind === "image") return <FileImage className={className} />;
  if (kind === "audio") return <FileAudio className={className} />;
  if (kind === "video") return <FileVideo className={className} />;
  if (kind === "code" || kind === "table") return <Code2 className={className} />;
  if (kind === "markdown" || kind === "text" || kind === "pdf") return <FileText className={className} />;
  if (kind === "download") return <FileArchive className={className} />;
  return <File className={className} />;
}

export function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
