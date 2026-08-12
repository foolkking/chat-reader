"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, ExternalLink, File, FileAudio, FileImage, FileText, FileVideo, Loader2, RotateCcw } from "lucide-react";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { normalizeVisibleCaption } from "./attachment-caption-policy";
import { useAttachmentAccess } from "./attachment-access";
import {
  buildAttachmentRenderPlan,
  friendlyAttachmentType,
  imageDisplayMaxWidth,
  normalizeImageDisplayMode,
  resolveAttachmentCapability,
  resolveInlinePresentation,
  type AttachmentRuntimeRenderState,
  type AttachmentViewerKind,
  type InlinePresentation,
} from "./preview-adapter-registry";
import {
  AttachmentPreviewDialog,
  useAttachmentViewer,
  type AttachmentViewerItem,
} from "./attachment-viewer";

export type AttachmentBlockProps = {
  attachmentId: string;
  displayMode?: string;
  alt?: string;
  caption?: string;
  messageId?: string;
  messageVersionId?: string;
  occurrenceKey?: string;
  blockIndex?: number;
  displayOrder?: number;
  galleryItems?: AttachmentViewerItem[];
  attachment?: AttachmentRead;
  inlinePresentation?: InlinePresentation;
  grouped?: boolean;
  galleryItemStyle?: CSSProperties;
  onImageRatio?: (ratio: number, naturalWidth: number) => void;
  onRuntimeChange?: (state: AttachmentRuntimeRenderState) => void;
  runtimeState?: AttachmentRuntimeRenderState;
};

export function AttachmentBlock(props: AttachmentBlockProps) {
  const { attachmentId, alt, caption } = props;
  const access = useAttachmentAccess();
  const viewer = useAttachmentViewer();
  const [runtime, setRuntime] = useState<AttachmentRuntimeRenderState>({ status: "idle" });
  const shareToken = access.kind === "share" ? access.token : undefined;
  const query = useQuery({
    queryKey: ["attachment", access.kind, shareToken ?? "owner", attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(attachmentId) : getAttachment(attachmentId, shareToken),
    staleTime: 5 * 60 * 1000,
    enabled: !props.attachment,
  });
  const attachment = props.attachment ?? query.data;
  const onRuntimeChangeRef = useRef(props.onRuntimeChange);
  onRuntimeChangeRef.current = props.onRuntimeChange;
  const updateRuntime = useCallback((state: AttachmentRuntimeRenderState) => {
    setRuntime(state);
    onRuntimeChangeRef.current?.(state);
  }, []);

  useEffect(() => {
    const idle = { status: "idle" } as const;
    setRuntime(idle);
  }, [attachmentId]);

  if (!props.attachment && query.isPending) return wrapStandalone(<LoadingRow label={caption || alt || "附件"} />, "file-list", props.grouped);
  if (!attachment) {
    return wrapStandalone(
      <UnavailableRow label={caption || alt || "附件"} onRetry={() => void query.refetch()} />,
      "file-list",
      props.grouped,
    );
  }

  const plan = buildAttachmentRenderPlan(attachment, props.runtimeState ?? runtime);
  const presentation = props.inlinePresentation ?? resolveInlinePresentation(plan);
  const item = toViewerItem(props);
  const openViewer = plan.actions.open ? () => viewer.open({
    source: access.kind === "share" ? "share" : access.kind === "offline" ? "offline" : "reader",
    scope: props.galleryItems && props.galleryItems.length > 1 ? "message-gallery" : "single",
    items: props.galleryItems?.length ? props.galleryItems : [item],
    activeItemKey: item.itemKey,
    access,
    permissions: {
      downloadOriginal: true,
      enumerateConversationImages: access.kind === "owner",
      batchDownload: access.kind === "owner",
    },
    trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  }) : undefined;

  let content: ReactNode;
  if (presentation === "gallery" && plan.inline === "media" && plan.viewerKind === "image" && attachment.content_url) {
    content = <InlineImage attachment={attachment} props={props} onOpen={openViewer} onRuntime={updateRuntime} />;
  } else if ((presentation === "reading" || presentation === "data") && plan.inline === "preview-panel" && ["markdown", "text", "code", "json", "table"].includes(plan.viewerKind ?? "")) {
    content = <InlineTextPreview attachment={attachment} kind={plan.viewerKind!} caption={caption} onOpen={openViewer} onRuntime={updateRuntime} presentation={presentation} />;
  } else if (presentation === "audio-list" && plan.viewerKind === "audio" && attachment.content_url) {
    content = <InlineAudio attachment={attachment} onOpen={openViewer} onRuntime={updateRuntime} />;
  } else if (presentation === "video" && plan.viewerKind === "video" && attachment.content_url) {
    content = <InlineVideo attachment={attachment} onOpen={openViewer} onRuntime={updateRuntime} />;
  } else {
    content = <FileRow attachment={attachment} plan={plan} onOpen={openViewer} onRetry={() => updateRuntime({ status: "idle" })} />;
  }
  return wrapStandalone(content, presentation, props.grouped);
}

function wrapStandalone(content: ReactNode, presentation: InlinePresentation, grouped?: boolean) {
  if (grouped) return content;
  const needsSurface = presentation === "audio-list" || presentation === "file-list";
  return (
    <div className={`attachment-lane attachment-lane--${presentation}`} data-inline-presentation={presentation}>
      {needsSurface ? <div className={`attachment-group-surface attachment-${presentation}`}>{content}</div> : content}
    </div>
  );
}

function InlineImage({ attachment, props, onOpen, onRuntime }: {
  attachment: AttachmentRead;
  props: AttachmentBlockProps;
  onOpen?: () => void;
  onRuntime: (state: AttachmentRuntimeRenderState) => void;
}) {
  const displayMode = normalizeImageDisplayMode(props.displayMode);
  const maxWidth = imageDisplayMaxWidth(displayMode);
  const visibleCaption = normalizeVisibleCaption(props.caption, attachment.display_name);
  return (
    <figure
      className="attachment-gallery-item"
      style={props.galleryItemStyle}
      data-testid="attachment-block"
      data-attachment-id={attachment.id}
      data-attachment-mode="media"
      data-display-mode={displayMode}
    >
      <button type="button" onClick={onOpen} disabled={!onOpen} className="attachment-gallery-trigger" aria-label={`查看 ${attachment.display_name}`}>
        <img
          src={attachment.content_url ?? undefined}
          alt={props.alt || attachment.display_name}
          loading="lazy"
          decoding="async"
          className="attachment-gallery-image"
          style={{ maxWidth }}
          onLoad={(event) => {
            const image = event.currentTarget;
            props.onImageRatio?.(image.naturalWidth / Math.max(1, image.naturalHeight), image.naturalWidth);
            onRuntime({ status: "ready", requestId: crypto.randomUUID() });
          }}
          onError={() => onRuntime({ status: "failed", requestId: crypto.randomUUID(), reason: "decode" })}
        />
        <span className="attachment-gallery-overlay" aria-hidden="true">
          <span className="truncate">{attachment.display_name}</span>
          <span>查看</span>
        </span>
      </button>
      {visibleCaption ? <figcaption className="attachment-gallery-caption">{visibleCaption}</figcaption> : null}
    </figure>
  );
}

function InlineTextPreview({ attachment, kind, caption, onOpen, onRuntime, presentation }: {
  attachment: AttachmentRead;
  kind: AttachmentViewerKind;
  caption?: string;
  onOpen?: () => void;
  onRuntime: (state: AttachmentRuntimeRenderState) => void;
  presentation: "reading" | "data";
}) {
  const [text, setText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const visibleCaption = normalizeVisibleCaption(caption, attachment.display_name);
  useEffect(() => {
    if (!attachment.content_url) return;
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    onRuntime({ status: "loading", requestId });
    void fetch(attachment.content_url, { headers: { Range: "bytes=0-131071" }, signal: controller.signal })
      .then((response) => { if (!response.ok && response.status !== 206) throw new Error("network"); return response.text(); })
      .then((value) => { setText(value); onRuntime({ status: "ready", requestId }); })
      .catch((error) => { if (error?.name !== "AbortError") onRuntime({ status: "failed", requestId, reason: "network" }); });
    return () => controller.abort();
  }, [attachment.content_url, onRuntime]);
  const isLong = Boolean(text && text.split(/\r?\n/).length > (presentation === "data" ? 8 : 10));
  return (
    <figure className={`attachment-preview attachment-preview--${presentation}`} data-testid="attachment-block" data-attachment-id={attachment.id} data-attachment-mode="preview-panel">
      <AttachmentMeta attachment={attachment} kind={kind} onOpen={onOpen} />
      <div className={`attachment-preview-body ${expanded ? "attachment-preview-body--expanded" : ""}`}>
        {text === null ? <div className="flex min-h-20 items-center justify-center text-secondary"><Loader2 className="h-4 w-4 animate-spin" /></div> : renderBoundedText(text, kind, attachment.display_name, attachment.id, expanded)}
        {isLong && !expanded ? <div className="attachment-preview-fade" /> : null}
      </div>
      <footer className="attachment-preview-footer">
        <span className="min-w-0 truncate text-xs text-secondary">{visibleCaption ?? ""}</span>
        <span className="flex shrink-0 items-center gap-1">
          {isLong ? <button type="button" onClick={() => setExpanded((value) => !value)} className="attachment-inline-action">{expanded ? "收起预览" : "展开预览"}</button> : null}
          {onOpen ? <button type="button" onClick={onOpen} className="attachment-inline-action">{presentation === "data" ? "打开完整表格" : "打开完整预览"}</button> : null}
        </span>
      </footer>
    </figure>
  );
}

function InlineAudio({ attachment, onOpen, onRuntime }: MediaProps) {
  return (
    <div className="attachment-audio-row" data-testid="attachment-block" data-attachment-id={attachment.id} data-attachment-mode="preview-panel">
      <div className="attachment-audio-heading">
        <button type="button" onClick={onOpen} disabled={!onOpen} className="min-w-0 truncate text-left text-sm font-medium text-primary disabled:cursor-default" title={attachment.display_name}>{attachment.display_name}</button>
        <span className="text-xs text-secondary">{attachmentMeta(attachment)}</span>
      </div>
      <div className="attachment-audio-controls">
        <audio src={attachment.content_url ?? undefined} controls preload="metadata" className="h-11 min-w-0 flex-1" onCanPlay={() => onRuntime({ status: "ready", requestId: crypto.randomUUID() })} onError={() => onRuntime(mediaFailure(attachment, "audio"))} />
        <DownloadButton attachment={attachment} />
      </div>
    </div>
  );
}

function InlineVideo({ attachment, onOpen, onRuntime }: MediaProps) {
  return (
    <figure className="attachment-video-preview" data-testid="attachment-block" data-attachment-id={attachment.id} data-attachment-mode="preview-panel">
      <header className="attachment-video-heading">
        <span className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</span>
        <DownloadButton attachment={attachment} />
      </header>
      <button type="button" onClick={onOpen} className="attachment-video-stage" aria-label={`播放 ${attachment.display_name}`}>
        <video src={attachment.content_url ?? undefined} preload="metadata" muted playsInline className="h-full w-full object-contain" onLoadedMetadata={() => onRuntime({ status: "ready", requestId: crypto.randomUUID() })} onError={() => onRuntime(mediaFailure(attachment, "video"))} />
        <span className="attachment-video-play">播放</span>
      </button>
      <figcaption className="attachment-video-meta">{attachmentMeta(attachment)}</figcaption>
    </figure>
  );
}

type MediaProps = { attachment: AttachmentRead; onOpen?: () => void; onRuntime: (state: AttachmentRuntimeRenderState) => void };

function mediaFailure(attachment: AttachmentRead, kind: "audio" | "video"): AttachmentRuntimeRenderState {
  const mime = attachment.detected_mime_type || attachment.asset_object?.detected_mime_type || attachment.declared_mime_type || "";
  const element = document.createElement(kind);
  const unsupported = mime && element.canPlayType(mime) === "";
  return unsupported
    ? { status: "unsupported", requestId: crypto.randomUUID(), reason: "codec" }
    : { status: "failed", requestId: crypto.randomUUID(), reason: "decode" };
}

function FileRow({ attachment, plan, onOpen, onRetry }: {
  attachment: AttachmentRead;
  plan: ReturnType<typeof buildAttachmentRenderPlan>;
  onOpen?: () => void;
  onRetry: () => void;
}) {
  const variant = plan.fileRowVariant ?? "normal";
  const message = variant === "empty" ? "空文件 · 0 B"
    : variant === "missing" ? "文件缺失，原对话引用的文件当前不可用"
      : variant === "unsupported" ? "当前浏览器无法直接预览此格式"
        : variant === "preview-failed" ? "无法加载预览，文件仍然可以下载"
          : variant === "offline-unavailable" ? "离线资源未缓存"
            : attachmentMeta(attachment);
  return (
    <div className="attachment-file-list-row" data-testid="attachment-block" data-attachment-id={attachment.id} data-attachment-mode="file-row" data-file-row-variant={variant}>
      <KindIcon kind={plan.capability.viewerKind} warning={variant !== "normal" && variant !== "empty"} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p><p className="mt-0.5 truncate text-xs text-secondary">{message}</p></div>
      {plan.actions.retry ? <button type="button" onClick={onRetry} className="attachment-icon-action" aria-label="重试预览" title="重试预览"><RotateCcw className="h-4 w-4" /></button> : null}
      {plan.actions.open && onOpen ? <button type="button" onClick={onOpen} className="attachment-icon-action" aria-label={`打开 ${attachment.display_name}`} title="打开"><ExternalLink className="h-4 w-4" /></button> : null}
      {plan.actions.download ? <DownloadButton attachment={attachment} /> : null}
    </div>
  );
}

function AttachmentMeta({ attachment, kind, onOpen }: { attachment: AttachmentRead; kind: AttachmentViewerKind; onOpen?: () => void }) {
  return <header className="attachment-preview-header"><KindIcon kind={kind} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p><p className="truncate text-xs text-secondary">{attachmentMeta(attachment)}</p></div><span className="attachment-preview-actions">{onOpen ? <button type="button" onClick={onOpen} className="attachment-icon-action" aria-label={`打开 ${attachment.display_name}`} title="打开"><ExternalLink className="h-4 w-4" /></button> : null}<DownloadButton attachment={attachment} /></span></header>;
}

function DownloadButton({ attachment }: { attachment: AttachmentRead }) {
  return attachment.download_url ? <a href={attachment.download_url} download className="attachment-icon-action" aria-label={`下载 ${attachment.display_name}`} title="下载"><Download className="h-4 w-4" /></a> : null;
}

function KindIcon({ kind, warning = false }: { kind: AttachmentViewerKind | null; warning?: boolean }) {
  const className = "h-5 w-5";
  const icon = warning ? <AlertTriangle className={className} /> : kind === "image" ? <FileImage className={className} /> : kind === "audio" ? <FileAudio className={className} /> : kind === "video" ? <FileVideo className={className} /> : kind ? <FileText className={className} /> : <File className={className} />;
  return <span className="attachment-kind-icon">{icon}</span>;
}

function renderBoundedText(text: string, kind: AttachmentViewerKind, filename: string, scopeId: string, expanded = false): ReactNode {
  if (!text) return <p className="text-sm text-secondary">空文件 · 0 B</p>;
  if (kind === "markdown") return <MarkdownRenderer text={limitLines(text, expanded ? 28 : 14)} isAssistant={false} scopeId={`attachment-${scopeId}`} />;
  if (kind === "table") return <DelimitedPreview text={text} delimiter={filename.toLowerCase().endsWith(".tsv") ? "\t" : ","} />;
  const lines = expanded ? 28 : kind === "text" ? 10 : 14;
  return <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-primary">{limitLines(text, lines)}</pre>;
}

function DelimitedPreview({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = text.split(/\r?\n/).slice(0, 8).map((line) => line.split(delimiter).slice(0, 8));
  return <div className="max-w-full overflow-x-auto"><table className="w-max min-w-full border-collapse text-xs"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-52 truncate border border-ui px-2 py-1.5" title={cell}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function limitLines(text: string, count: number) {
  const lines = text.split(/\r?\n/);
  return lines.length > count ? `${lines.slice(0, count).join("\n")}\n…` : text;
}

export function toViewerItem(props: AttachmentBlockProps): AttachmentViewerItem {
  const identity = props.messageVersionId && props.occurrenceKey ? `${props.messageVersionId}:${props.occurrenceKey}` : `single:${props.attachmentId}`;
  return { itemKey: identity, attachmentId: props.attachmentId, messageId: props.messageId, messageVersionId: props.messageVersionId, occurrenceKey: props.occurrenceKey, blockIndex: props.blockIndex, displayOrder: props.displayOrder, displayMode: normalizeImageDisplayMode(props.displayMode), alt: props.alt, caption: props.caption };
}

function attachmentMeta(attachment: AttachmentRead): string {
  const size = attachment.asset_object?.byte_size ?? 0;
  if (size === 0) return "空文件 · 0 B";
  const parts = [friendlyAttachmentType(attachment), readableBytes(size)];
  if (["scanner_disabled", "unscanned"].includes(attachment.scan_status)) parts.push("未扫描");
  return parts.join(" · ");
}

function LoadingRow({ label }: { label: string }) {
  return <div className="attachment-file-list-row" data-testid="attachment-block" data-attachment-mode="file-row"><Loader2 className="h-5 w-5 animate-spin text-secondary" /><span className="truncate text-sm text-secondary">正在加载 {label}</span></div>;
}

function UnavailableRow({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div className="attachment-file-list-row" data-testid="attachment-block" data-attachment-mode="file-row"><AlertTriangle className="h-5 w-5 text-secondary" /><div className="min-w-0 flex-1"><p className="truncate text-sm text-primary">{label}</p><p className="text-xs text-secondary">附件信息加载失败</p></div><button type="button" onClick={onRetry} className="attachment-inline-action">重试</button></div>;
}

export { AttachmentPreviewDialog };
export function friendlyTypeLabel(mimeType: string, filename: string): string {
  return resolveAttachmentCapability({ detected_mime_type: mimeType, declared_mime_type: mimeType, display_name: filename, original_filename: filename, asset_object: null }).friendlyType;
}
export function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
