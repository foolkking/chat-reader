"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, File, FileText, Image as ImageIcon, Loader2, X } from "lucide-react";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { useAttachmentAccess } from "./attachment-access";
import { buildComplexPreviewUrl, resolveAttachmentPreviewKind } from "./preview-adapter-registry";

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
  displayMode: _displayMode = "card",
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
  const shareToken = access.kind === "share" ? access.token : undefined;
  const query = useQuery({
    queryKey: ["attachment", access.kind, shareToken ?? "owner", attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(attachmentId) : getAttachment(attachmentId, shareToken),
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });
  const attachment = query.data;
  const mime = attachment?.asset_object?.detected_mime_type ?? attachment?.declared_mime_type ?? "application/octet-stream";
  const previewKind = resolveAttachmentPreviewKind(mime);
  const isImage = previewKind === "image";

  if (isImage && attachment?.content_url) {
    return (
      <>
        <figure className="m-0 max-w-full" data-testid="attachment-block" data-attachment-id={attachmentId}>
          <button type="button" className="block max-w-full overflow-hidden rounded-lg border border-ui bg-subtle" onClick={() => setPreviewOpen(true)}>
            <img src={attachment.content_url} alt={alt || attachment.display_name} className="max-h-[32rem] max-w-full object-contain" loading="lazy" decoding="async" />
          </button>
          {caption ? <figcaption className="mt-2 text-sm text-secondary">{caption}</figcaption> : null}
        </figure>
        {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
      </>
    );
  }

  if (attachment?.content_url && previewKind === "text") {
    return <InlineTextAttachment attachment={attachment} alt={alt} caption={caption} onPreview={() => setPreviewOpen(true)} previewOpen={previewOpen} onClose={() => setPreviewOpen(false)} />;
  }

  if (attachment?.content_url && previewKind === "audio") {
    return (
      <>
        <figure className="m-0 w-full rounded-lg border border-ui bg-surface p-3" data-testid="attachment-block" data-attachment-id={attachmentId}>
          <figcaption className="mb-2 text-sm font-medium text-primary">{caption || attachment.display_name}</figcaption>
          <audio src={attachment.content_url} controls preload="metadata" className="w-full" />
        </figure>
        {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
      </>
    );
  }

  if (attachment?.content_url && previewKind === "video") {
    return (
      <>
        <figure className="m-0 max-w-full rounded-lg border border-ui bg-black p-2" data-testid="attachment-block" data-attachment-id={attachmentId}>
          <video src={attachment.content_url} controls preload="metadata" className="max-h-[32rem] w-full object-contain" />
          {caption ? <figcaption className="px-1 pt-2 text-sm text-white/75">{caption}</figcaption> : null}
        </figure>
        {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
      </>
    );
  }

  return (
    <>
      <div className="flex min-h-20 w-full items-center gap-3 rounded-lg border border-ui bg-surface p-3" data-testid="attachment-block" data-attachment-id={attachmentId}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-subtle text-secondary">
          {query.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : isImage ? <ImageIcon className="h-5 w-5" /> : previewKind === "text" ? <FileText className="h-5 w-5" /> : <File className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary">{attachment?.display_name || caption || alt || "Attachment"}</p>
          <p className="mt-1 text-xs text-secondary">{attachment ? `${readableBytes(attachment.asset_object?.byte_size ?? 0)} · ${mime}` : query.isError ? "Attachment unavailable" : "Loading attachment"}</p>
        </div>
        {attachment?.content_url ? (
          <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label="Preview attachment" title="Preview attachment">
            <ExternalLink className="h-4 w-4" />
          </button>
        ) : null}
        {attachment?.download_url ? (
          <a href={attachment.download_url} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label="Download attachment" title="Download attachment">
            <Download className="h-4 w-4" />
          </a>
        ) : null}
      </div>
      {previewOpen && attachment ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={() => setPreviewOpen(false)} /> : null}
    </>
  );
}

export function AttachmentPreviewDialog({ attachment, alt, onClose }: { attachment: AttachmentRead; alt?: string; onClose: () => void }) {
  const mime = attachment.asset_object?.detected_mime_type ?? attachment.declared_mime_type ?? "application/octet-stream";
  const previewKind = resolveAttachmentPreviewKind(mime);
  const url = attachment.content_url;
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isText = previewKind === "text";
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
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
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
  const body = useMemo(() => {
    if (!url) return <p className="p-6 text-sm text-secondary">Preview is unavailable.</p>;
    if (previewKind === "image") {
      return <img src={url} alt={alt || attachment.display_name} className="max-h-[calc(100dvh-10rem)] max-w-full object-contain" />;
    }
    if (previewKind === "pdf") return <iframe src={url} title={attachment.display_name} className="h-[calc(100dvh-9rem)] w-full border-0" />;
    if (previewKind === "audio") return <audio src={url} controls className="w-full" />;
    if (previewKind === "video") return <video src={url} controls className="max-h-[calc(100dvh-10rem)] max-w-full" />;
    if (previewKind === "complex" && complexPreviewUrl) return <iframe src={complexPreviewUrl} title={attachment.display_name} sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" className="h-[calc(100dvh-9rem)] w-full border-0" />;
    if (isText) return <pre className="max-h-[calc(100dvh-10rem)] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm text-primary">{textError ? "Preview could not be loaded." : text ?? "Loading preview..."}</pre>;
    return <p className="p-6 text-sm text-secondary">This file type is available for download.</p>;
  }, [alt, attachment.display_name, complexPreviewUrl, isText, previewKind, text, textError, url]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-0 outline-none sm:p-3" role="dialog" aria-modal="true" aria-label={`Preview ${attachment.display_name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <section className="flex h-full w-full flex-col overflow-hidden border-ui bg-page shadow-2xl sm:h-[calc(100dvh-1.5rem)] sm:w-[min(96vw,88rem)] sm:rounded-lg sm:border">
        <header className="flex min-h-14 items-center gap-3 border-b border-ui px-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{attachment.display_name}</h2>
          {attachment.download_url ? <a href={attachment.download_url} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label="Download attachment"><Download className="h-4 w-4" /></a> : null}
          <button ref={closeButtonRef} type="button" onClick={() => onCloseRef.current()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label="Close preview"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-subtle" data-testid="attachment-preview-content">{body}</div>
      </section>
    </div>,
    document.body,
  );
}

function InlineTextAttachment({
  attachment,
  alt,
  caption,
  onPreview,
  previewOpen,
  onClose,
}: {
  attachment: AttachmentRead;
  alt?: string;
  caption?: string;
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

  return (
    <>
      <figure className="m-0 w-full overflow-hidden rounded-lg border border-ui bg-surface" data-testid="attachment-block" data-attachment-id={attachment.id}>
        <button type="button" onClick={onPreview} className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-ui bg-subtle px-3 text-left text-xs text-secondary hover:text-primary">
          <span className="truncate">{caption || alt || attachment.display_name}</span>
          <ExternalLink className="h-4 w-4 shrink-0" />
        </button>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-primary">
          {failed ? "Preview could not be loaded." : text ?? "Loading preview..."}
        </pre>
      </figure>
      {previewOpen ? <AttachmentPreviewDialog attachment={attachment} alt={alt} onClose={onClose} /> : null}
    </>
  );
}

export function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
