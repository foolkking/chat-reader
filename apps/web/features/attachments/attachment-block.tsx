"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, ExternalLink, File, FileAudio, FileImage, FileText, FileVideo, Loader2, RotateCcw } from "lucide-react";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { normalizeVisibleCaption } from "./attachment-caption-policy";
import { useAttachmentAccess } from "./attachment-access";
import { ImageDisplayControls, useImageDisplay } from "./image-display-controls";
import {
  attachmentAssetIdentity,
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

export function embeddedAttachment(value: unknown, attachmentId: string): AttachmentRead | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  return candidate.id === attachmentId ? candidate as AttachmentRead : undefined;
}

export function AttachmentBlock(props: AttachmentBlockProps) {
  const { attachmentId, alt, caption } = props;
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const access = useAttachmentAccess();
  const viewer = useAttachmentViewer();
  const [runtime, setRuntime] = useState<AttachmentRuntimeRenderState>({ status: "idle" });
  const shareToken = access.kind === "share" ? access.token : undefined;
  const query = useQuery({
    queryKey: ["attachment", access.kind, access.kind === "admin" ? access.userId : shareToken ?? "owner", attachmentId],
    queryFn: () => access.kind === "offline" ? getOfflineAttachment(attachmentId) : getAttachment(attachmentId, shareToken, access.kind === "admin" ? access.userId : undefined),
    staleTime: 5 * 60 * 1000,
    enabled: !props.attachment,
    ...(access.kind === "offline" ? { networkMode: "always" as const } : {}),
  });
  const attachment = props.attachment ?? query.data;
  const attachmentIdentity = attachmentAssetIdentity(attachment);
  const onRuntimeChangeRef = useRef(props.onRuntimeChange);
  onRuntimeChangeRef.current = props.onRuntimeChange;
  const updateRuntime = useCallback((state: AttachmentRuntimeRenderState) => {
    setRuntime(state);
    onRuntimeChangeRef.current?.(state);
  }, []);

  useEffect(() => {
    const idle = { status: "idle" } as const;
    setRuntime(idle);
  }, [attachmentId, attachmentIdentity]);

  if (!props.attachment && query.isPending) return wrapStandalone(<LoadingRow label={caption || alt || (zh ? "附件" : "Attachment")} zh={zh} />, "file-list", props.grouped);
  if (!attachment) {
    return wrapStandalone(
      <UnavailableRow label={caption || alt || (zh ? "附件" : "Attachment")} zh={zh} onRetry={() => void query.refetch()} />,
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
    content = <InlineImage attachment={attachment} props={props} onOpen={openViewer} onRuntime={updateRuntime} zh={zh} />;
  } else if ((presentation === "reading" || presentation === "data") && plan.inline === "preview-panel" && ["markdown", "text", "code", "json", "table"].includes(plan.viewerKind ?? "")) {
    content = <InlineTextPreview attachment={attachment} kind={plan.viewerKind!} caption={caption} onOpen={openViewer} onRuntime={updateRuntime} presentation={presentation} locator={props} zh={zh} />;
  } else if (presentation === "audio-list" && plan.viewerKind === "audio" && attachment.content_url) {
    content = <InlineAudio attachment={attachment} onOpen={openViewer} onRuntime={updateRuntime} locator={props} zh={zh} />;
  } else if (presentation === "video" && plan.viewerKind === "video" && attachment.content_url) {
    content = <InlineVideo attachment={attachment} onOpen={openViewer} onRuntime={updateRuntime} locator={props} zh={zh} />;
  } else {
    content = <FileRow attachment={attachment} plan={plan} onOpen={openViewer} onRetry={() => updateRuntime({ status: "idle" })} locator={props} zh={zh} />;
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

function InlineImage({ attachment, props, onOpen, onRuntime, zh }: {
  attachment: AttachmentRead;
  props: AttachmentBlockProps;
  onOpen?: () => void;
  onRuntime: (state: AttachmentRuntimeRenderState) => void;
  zh: boolean;
}) {
  const { display } = useImageDisplay(attachment);
  const displayMode = normalizeImageDisplayMode(props.displayMode);
  const maxWidth = imageDisplayMaxWidth(displayMode);
  const visibleCaption = normalizeVisibleCaption(props.caption, attachment.display_name);
  return (
    <figure
      {...attachmentLocatorAttributes(attachment, props)}
      className="attachment-gallery-item"
      style={{ ...props.galleryItemStyle, ...(display ? { "--image-display-width": `${display.width}px` } as CSSProperties : {}) }}
      data-image-sized={display ? "true" : undefined}
      data-testid="attachment-block"
      data-attachment-mode="media"
      data-display-mode={displayMode}
    >
      <div className="attachment-gallery-media">
        <button type="button" onClick={onOpen} disabled={!onOpen} className="attachment-gallery-trigger" aria-label={`${zh ? "查看" : "View"} ${attachment.display_name}`}>
        <img
          src={attachment.content_url ?? undefined}
          alt={props.alt || attachment.display_name}
          loading="lazy"
          decoding="async"
          className="attachment-gallery-image"
          style={display ? { width: display.width, maxWidth: "100%", maxHeight: "none" } : { maxWidth }}
          onLoad={(event) => {
            const image = event.currentTarget;
            props.onImageRatio?.(image.naturalWidth / Math.max(1, image.naturalHeight), image.naturalWidth);
            onRuntime({ status: "ready", requestId: crypto.randomUUID() });
          }}
          onError={() => onRuntime({ status: "failed", requestId: crypto.randomUUID(), reason: "decode" })}
        />
        <span className="attachment-gallery-overlay" aria-hidden="true">
          <span className="truncate">{attachment.display_name}</span>
          <span>{zh ? "查看" : "View"}</span>
        </span>
        </button>
        <ImageDisplayControls attachment={attachment} zh={zh} />
      </div>
      {visibleCaption ? <figcaption className="attachment-gallery-caption">{visibleCaption}</figcaption> : null}
    </figure>
  );
}

function InlineTextPreview({ attachment, kind, caption, onOpen, onRuntime, presentation, locator, zh }: {
  attachment: AttachmentRead;
  kind: AttachmentViewerKind;
  caption?: string;
  onOpen?: () => void;
  onRuntime: (state: AttachmentRuntimeRenderState) => void;
  presentation: "reading" | "data";
  locator: AttachmentBlockProps;
  zh: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const attachmentIdentity = attachmentAssetIdentity(attachment);
  const visibleCaption = normalizeVisibleCaption(caption, attachment.display_name);
  useEffect(() => {
    setText(null);
    setExpanded(false);
    if (!attachment.content_url) return;
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    onRuntime({ status: "loading", requestId });
    void fetch(attachment.content_url, { headers: { Range: "bytes=0-131071" }, signal: controller.signal })
      .then((response) => { if (!response.ok && response.status !== 206) throw new Error("network"); return response.text(); })
      .then((value) => { setText(value); onRuntime({ status: "ready", requestId }); })
      .catch((error) => { if (error?.name !== "AbortError") onRuntime({ status: "failed", requestId, reason: "network" }); });
    return () => controller.abort();
  }, [attachment.content_url, attachmentIdentity, onRuntime]);
  const isLong = Boolean(text && text.split(/\r?\n/).length > (presentation === "data" ? 8 : 10));
  return (
    <figure {...attachmentLocatorAttributes(attachment, locator)} className={`attachment-preview attachment-preview--${presentation}`} data-testid="attachment-block" data-attachment-mode="preview-panel">
      <AttachmentMeta attachment={attachment} kind={kind} onOpen={onOpen} zh={zh} />
      <div className={`attachment-preview-body ${expanded ? "attachment-preview-body--expanded" : ""}`}>
        {text === null ? <div className="flex min-h-20 items-center justify-center text-secondary"><Loader2 className="h-4 w-4 animate-spin" /></div> : renderBoundedText(text, kind, attachment.display_name, attachment.id, expanded, zh)}
        {isLong && !expanded ? <div className="attachment-preview-fade" /> : null}
      </div>
      <footer className="attachment-preview-footer">
        <span className="min-w-0 truncate text-xs text-secondary">{visibleCaption ?? ""}</span>
        <span className="flex shrink-0 items-center gap-1">
          {isLong ? <button type="button" onClick={() => setExpanded((value) => !value)} className="attachment-inline-action">{expanded ? (zh ? "收起预览" : "Collapse preview") : (zh ? "展开预览" : "Expand preview")}</button> : null}
          {onOpen ? <button type="button" onClick={onOpen} className="attachment-inline-action">{presentation === "data" ? (zh ? "打开完整表格" : "Open full table") : (zh ? "打开完整预览" : "Open full preview")}</button> : null}
        </span>
      </footer>
    </figure>
  );
}

function InlineAudio({ attachment, onOpen, onRuntime, locator, zh }: MediaProps) {
  return (
    <div {...attachmentLocatorAttributes(attachment, locator)} className="attachment-audio-row" data-testid="attachment-block" data-attachment-mode="preview-panel">
      <div className="attachment-audio-heading">
        <button type="button" onClick={onOpen} disabled={!onOpen} className="min-w-0 truncate text-left text-sm font-medium text-primary disabled:cursor-default" title={attachment.display_name}>{attachment.display_name}</button>
        <span className="text-xs text-secondary">{attachmentMeta(attachment, zh)}</span>
      </div>
      <div className="attachment-audio-controls">
        <audio src={attachment.content_url ?? undefined} controls preload="metadata" className="h-11 min-w-0 flex-1" onCanPlay={() => onRuntime({ status: "ready", requestId: crypto.randomUUID() })} onError={() => onRuntime(mediaFailure(attachment, "audio"))} />
        <DownloadButton attachment={attachment} zh={zh} />
      </div>
    </div>
  );
}

function InlineVideo({ attachment, onOpen, onRuntime, locator, zh }: MediaProps) {
  return (
    <figure {...attachmentLocatorAttributes(attachment, locator)} className="attachment-video-preview" data-testid="attachment-block" data-attachment-mode="preview-panel">
      <header className="attachment-video-heading">
        <span className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</span>
        <DownloadButton attachment={attachment} zh={zh} />
      </header>
      <button type="button" onClick={onOpen} className="attachment-video-stage" aria-label={`${zh ? "播放" : "Play"} ${attachment.display_name}`}>
        <video src={attachment.content_url ?? undefined} preload="metadata" muted playsInline className="h-full w-full object-contain" onLoadedMetadata={() => onRuntime({ status: "ready", requestId: crypto.randomUUID() })} onError={() => onRuntime(mediaFailure(attachment, "video"))} />
        <span className="attachment-video-play">{zh ? "播放" : "Play"}</span>
      </button>
      <figcaption className="attachment-video-meta">{attachmentMeta(attachment, zh)}</figcaption>
    </figure>
  );
}

type MediaProps = { attachment: AttachmentRead; onOpen?: () => void; onRuntime: (state: AttachmentRuntimeRenderState) => void; locator: AttachmentBlockProps; zh: boolean };

function mediaFailure(attachment: AttachmentRead, kind: "audio" | "video"): AttachmentRuntimeRenderState {
  const mime = attachment.detected_mime_type || attachment.asset_object?.detected_mime_type || attachment.declared_mime_type || "";
  const element = document.createElement(kind);
  const unsupported = mime && element.canPlayType(mime) === "";
  return unsupported
    ? { status: "unsupported", requestId: crypto.randomUUID(), reason: "codec" }
    : { status: "failed", requestId: crypto.randomUUID(), reason: "decode" };
}

function FileRow({ attachment, plan, onOpen, onRetry, locator, zh }: {
  attachment: AttachmentRead;
  plan: ReturnType<typeof buildAttachmentRenderPlan>;
  onOpen?: () => void;
  onRetry: () => void;
  locator: AttachmentBlockProps;
  zh: boolean;
}) {
  const variant = plan.fileRowVariant ?? "normal";
  const message = variant === "empty" ? (zh ? "空文件 · 0 B" : "Empty file · 0 B")
    : variant === "missing" ? (zh ? "文件缺失，原对话引用的文件当前不可用" : "File missing; the referenced file is unavailable")
      : variant === "unsupported" ? (zh ? "当前浏览器无法直接预览此格式" : "This format cannot be previewed in this browser")
        : variant === "preview-failed" ? (zh ? "无法加载预览，文件仍然可以下载" : "Preview failed; the file is still available to download")
          : variant === "offline-unavailable" ? (zh ? "离线资源未缓存" : "Offline resource is not cached")
            : attachmentMeta(attachment, zh);
  return (
    <div {...attachmentLocatorAttributes(attachment, locator)} className="attachment-file-list-row" data-testid="attachment-block" data-attachment-mode="file-row" data-file-row-variant={variant}>
      <KindIcon kind={plan.capability.viewerKind} warning={variant !== "normal" && variant !== "empty"} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p><p className="mt-0.5 truncate text-xs text-secondary">{message}</p></div>
      {plan.actions.retry ? <button type="button" onClick={onRetry} className="attachment-icon-action" aria-label={zh ? "重试预览" : "Retry preview"} title={zh ? "重试预览" : "Retry preview"}><RotateCcw className="h-4 w-4" /></button> : null}
      {plan.actions.open && onOpen ? <button type="button" onClick={onOpen} className="attachment-icon-action" aria-label={`${zh ? "打开" : "Open"} ${attachment.display_name}`} title={zh ? "打开" : "Open"}><ExternalLink className="h-4 w-4" /></button> : null}
      {plan.actions.download ? <DownloadButton attachment={attachment} zh={zh} /> : null}
    </div>
  );
}

function attachmentLocatorAttributes(attachment: AttachmentRead, props: Pick<AttachmentBlockProps, "occurrenceKey">) {
  return {
    id: props.occurrenceKey ? `attachment-occurrence-${props.occurrenceKey}` : undefined,
    "data-attachment-id": attachment.id,
    "data-occurrence-key": props.occurrenceKey,
  };
}

function AttachmentMeta({ attachment, kind, onOpen, zh }: { attachment: AttachmentRead; kind: AttachmentViewerKind; onOpen?: () => void; zh: boolean }) {
  return <header className="attachment-preview-header"><KindIcon kind={kind} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p><p className="truncate text-xs text-secondary">{attachmentMeta(attachment, zh)}</p></div><span className="attachment-preview-actions">{onOpen ? <button type="button" onClick={onOpen} className="attachment-icon-action" aria-label={`${zh ? "打开" : "Open"} ${attachment.display_name}`} title={zh ? "打开" : "Open"}><ExternalLink className="h-4 w-4" /></button> : null}<DownloadButton attachment={attachment} zh={zh} /></span></header>;
}

function DownloadButton({ attachment, zh }: { attachment: AttachmentRead; zh: boolean }) {
  return attachment.download_url ? <a href={attachment.download_url} download className="attachment-icon-action" aria-label={`${zh ? "下载" : "Download"} ${attachment.display_name}`} title={zh ? "下载" : "Download"}><Download className="h-4 w-4" /></a> : null;
}

function KindIcon({ kind, warning = false }: { kind: AttachmentViewerKind | null; warning?: boolean }) {
  const className = "h-5 w-5";
  const icon = warning ? <AlertTriangle className={className} /> : kind === "image" ? <FileImage className={className} /> : kind === "audio" ? <FileAudio className={className} /> : kind === "video" ? <FileVideo className={className} /> : kind ? <FileText className={className} /> : <File className={className} />;
  return <span className="attachment-kind-icon">{icon}</span>;
}

function renderBoundedText(text: string, kind: AttachmentViewerKind, filename: string, scopeId: string, expanded = false, zh = true): ReactNode {
  if (!text) return <p className="text-sm text-secondary">{zh ? "空文件 · 0 B" : "Empty file · 0 B"}</p>;
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

function attachmentMeta(attachment: AttachmentRead, zh = true): string {
  const size = attachment.asset_object?.byte_size ?? 0;
  if (size === 0) return zh ? "空文件 · 0 B" : "Empty file · 0 B";
  const parts = [friendlyAttachmentType(attachment, zh), readableBytes(size)];
  if (["scanner_disabled", "unscanned"].includes(attachment.scan_status)) parts.push(zh ? "未扫描" : "Not scanned");
  return parts.join(" · ");
}

function LoadingRow({ label, zh }: { label: string; zh: boolean }) {
  return <div className="attachment-file-list-row" data-testid="attachment-block" data-attachment-mode="file-row"><Loader2 className="h-5 w-5 animate-spin text-secondary" /><span className="truncate text-sm text-secondary">{zh ? `正在加载 ${label}` : `Loading ${label}`}</span></div>;
}

function UnavailableRow({ label, onRetry, zh }: { label: string; onRetry: () => void; zh: boolean }) {
  return <div className="attachment-file-list-row" data-testid="attachment-block" data-attachment-mode="file-row"><AlertTriangle className="h-5 w-5 text-secondary" /><div className="min-w-0 flex-1"><p className="truncate text-sm text-primary">{label}</p><p className="text-xs text-secondary">{zh ? "附件信息加载失败" : "Attachment information failed to load"}</p></div><button type="button" onClick={onRetry} className="attachment-inline-action">{zh ? "重试" : "Retry"}</button></div>;
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
