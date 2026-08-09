"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, ExternalLink, File, FileAudio, FileImage, FileText, FileVideo, Loader2, RotateCcw } from "lucide-react";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { useAttachmentAccess } from "./attachment-access";
import {
  buildAttachmentRenderPlan,
  friendlyAttachmentType,
  imageDisplayMaxWidth,
  normalizeImageDisplayMode,
  resolveAttachmentCapability,
  type AttachmentRuntimeRenderState,
  type AttachmentViewerKind,
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
  });
  const attachment = query.data;

  useEffect(() => setRuntime({ status: "idle" }), [attachmentId]);

  if (query.isPending) return <LoadingRow label={caption || alt || "附件"} />;
  if (query.isError || !attachment) {
    return <UnavailableRow label={caption || alt || "附件"} onRetry={() => void query.refetch()} />;
  }

  const plan = buildAttachmentRenderPlan(attachment, runtime);
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

  if (plan.inline === "media" && plan.viewerKind === "image" && attachment.content_url) {
    return <InlineImage attachment={attachment} props={props} onOpen={openViewer} onRuntime={setRuntime} />;
  }
  if (plan.inline === "preview-panel" && ["markdown", "text", "code", "json", "table"].includes(plan.viewerKind ?? "")) {
    return <InlineTextPreview attachment={attachment} kind={plan.viewerKind!} caption={caption} onOpen={openViewer} onRuntime={setRuntime} />;
  }
  if (plan.inline === "preview-panel" && plan.viewerKind === "audio" && attachment.content_url) {
    return <InlineAudio attachment={attachment} onOpen={openViewer} onRuntime={setRuntime} />;
  }
  if (plan.inline === "preview-panel" && plan.viewerKind === "video" && attachment.content_url) {
    return <InlineVideo attachment={attachment} onOpen={openViewer} onRuntime={setRuntime} />;
  }
  return <FileRow attachment={attachment} plan={plan} onOpen={openViewer} onRetry={() => setRuntime({ status: "idle" })} />;
}

function InlineImage({ attachment, props, onOpen, onRuntime }: {
  attachment: AttachmentRead;
  props: AttachmentBlockProps;
  onOpen?: () => void;
  onRuntime: (state: AttachmentRuntimeRenderState) => void;
}) {
  const displayMode = normalizeImageDisplayMode(props.displayMode);
  const maxWidth = imageDisplayMaxWidth(displayMode);
  return (
    <figure className="m-0 mx-auto max-w-full" data-testid="attachment-block" data-attachment-mode="media" data-display-mode={displayMode}>
      <AttachmentMeta attachment={attachment} kind="image" onOpen={onOpen} />
      <button type="button" onClick={onOpen} disabled={!onOpen} className="block max-w-full overflow-hidden rounded-md bg-subtle text-left disabled:cursor-default" aria-label={`打开 ${attachment.display_name}`}>
        <img
          src={attachment.content_url ?? undefined}
          alt={props.alt || attachment.display_name}
          loading="lazy"
          decoding="async"
          className="h-auto max-h-[480px] max-w-full object-contain"
          style={{ width: "auto", maxWidth }}
          onLoad={() => onRuntime({ status: "ready", requestId: crypto.randomUUID() })}
          onError={() => onRuntime({ status: "failed", requestId: crypto.randomUUID(), reason: "decode" })}
        />
      </button>
      {props.caption ? <figcaption className="mt-1 max-w-[720px] text-xs text-secondary">{props.caption}</figcaption> : null}
    </figure>
  );
}

function InlineTextPreview({ attachment, kind, caption, onOpen, onRuntime }: {
  attachment: AttachmentRead;
  kind: AttachmentViewerKind;
  caption?: string;
  onOpen?: () => void;
  onRuntime: (state: AttachmentRuntimeRenderState) => void;
}) {
  const [text, setText] = useState<string | null>(null);
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
  return (
    <figure className="m-0 mx-auto max-w-[720px] overflow-hidden rounded-md border border-ui bg-surface" data-testid="attachment-block" data-attachment-mode="preview-panel">
      <AttachmentMeta attachment={attachment} kind={kind} onOpen={onOpen} />
      <div className="relative max-h-[260px] overflow-hidden p-3">
        {text === null ? <div className="flex min-h-20 items-center justify-center text-secondary"><Loader2 className="h-4 w-4 animate-spin" /></div> : renderBoundedText(text, kind, attachment.display_name)}
        {text && text.split(/\r?\n/).length > 10 ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[var(--surface)] to-transparent" /> : null}
      </div>
      <div className="flex items-center justify-between border-t border-ui px-3 py-1.5">
        {caption ? <span className="truncate text-xs text-secondary">{caption}</span> : <span />}
        {onOpen ? <button type="button" onClick={onOpen} className="min-h-10 rounded-md px-2 text-xs text-secondary hover:bg-subtle">打开完整预览</button> : null}
      </div>
    </figure>
  );
}

function InlineAudio({ attachment, onOpen, onRuntime }: MediaProps) {
  return (
    <figure className="m-0 mx-auto max-w-[720px] rounded-md border border-ui bg-surface" data-testid="attachment-block" data-attachment-mode="preview-panel">
      <AttachmentMeta attachment={attachment} kind="audio" onOpen={onOpen} />
      <div className="flex items-center gap-2 px-3 py-2">
        <audio src={attachment.content_url ?? undefined} controls preload="metadata" className="h-11 min-w-0 flex-1" onCanPlay={() => onRuntime({ status: "ready", requestId: crypto.randomUUID() })} onError={() => onRuntime(mediaFailure(attachment, "audio"))} />
        <DownloadButton attachment={attachment} />
      </div>
    </figure>
  );
}

function InlineVideo({ attachment, onOpen, onRuntime }: MediaProps) {
  return (
    <figure className="m-0 mx-auto max-w-[560px] rounded-md border border-ui bg-surface" data-testid="attachment-block" data-attachment-mode="preview-panel">
      <AttachmentMeta attachment={attachment} kind="video" onOpen={onOpen} />
      <button type="button" onClick={onOpen} className="relative flex aspect-video max-h-[315px] w-full items-center justify-center overflow-hidden bg-subtle" aria-label={`播放 ${attachment.display_name}`}>
        <video src={attachment.content_url ?? undefined} preload="metadata" muted playsInline className="h-full w-full object-contain" onLoadedMetadata={() => onRuntime({ status: "ready", requestId: crypto.randomUUID() })} onError={() => onRuntime(mediaFailure(attachment, "video"))} />
        <span className="absolute rounded-full bg-black/65 px-4 py-2 text-sm text-white">播放</span>
      </button>
      <div className="flex justify-end px-3 py-2"><DownloadButton attachment={attachment} /></div>
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
    <div className="mx-auto flex min-h-16 w-full max-w-[720px] items-center gap-3 rounded-md border border-ui bg-surface px-3 py-2" data-testid="attachment-block" data-attachment-mode="file-row" data-file-row-variant={variant}>
      <KindIcon kind={plan.capability.viewerKind} warning={variant !== "normal" && variant !== "empty"} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p><p className="mt-0.5 text-xs text-secondary">{message}</p></div>
      {plan.actions.retry ? <button type="button" onClick={onRetry} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="重试预览" title="重试预览"><RotateCcw className="h-4 w-4" /></button> : null}
      {plan.actions.open && onOpen ? <button type="button" onClick={onOpen} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={`打开 ${attachment.display_name}`} title="打开"><ExternalLink className="h-4 w-4" /></button> : null}
      {plan.actions.download ? <DownloadButton attachment={attachment} /> : null}
    </div>
  );
}

function AttachmentMeta({ attachment, kind, onOpen }: { attachment: AttachmentRead; kind: AttachmentViewerKind; onOpen?: () => void }) {
  return <header className="flex min-h-11 items-center gap-2 border-b border-ui px-3 py-1.5"><KindIcon kind={kind} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p><p className="truncate text-[11px] text-secondary">{attachmentMeta(attachment)}</p></div>{onOpen ? <button type="button" onClick={onOpen} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={`打开 ${attachment.display_name}`} title="打开"><ExternalLink className="h-4 w-4" /></button> : null}<DownloadButton attachment={attachment} /></header>;
}

function DownloadButton({ attachment }: { attachment: AttachmentRead }) {
  return attachment.download_url ? <a href={attachment.download_url} download className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={`下载 ${attachment.display_name}`} title="下载"><Download className="h-4 w-4" /></a> : null;
}

function KindIcon({ kind, warning = false }: { kind: AttachmentViewerKind | null; warning?: boolean }) {
  const className = "h-5 w-5";
  const icon = warning ? <AlertTriangle className={className} /> : kind === "image" ? <FileImage className={className} /> : kind === "audio" ? <FileAudio className={className} /> : kind === "video" ? <FileVideo className={className} /> : kind ? <FileText className={className} /> : <File className={className} />;
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-subtle text-secondary">{icon}</span>;
}

function renderBoundedText(text: string, kind: AttachmentViewerKind, filename: string): ReactNode {
  if (!text) return <p className="text-sm text-secondary">空文件 · 0 B</p>;
  if (kind === "markdown") return <MarkdownRenderer text={limitLines(text, 14)} isAssistant={false} />;
  if (kind === "table") return <DelimitedPreview text={text} delimiter={filename.toLowerCase().endsWith(".tsv") ? "\t" : ","} />;
  const lines = kind === "text" ? 10 : 14;
  return <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-primary">{limitLines(text, lines)}</pre>;
}

function DelimitedPreview({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = text.split(/\r?\n/).slice(0, 8).map((line) => line.split(delimiter).slice(0, 8));
  return <div className="overflow-x-auto"><table className="w-max min-w-full border-collapse text-xs"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-52 truncate border border-ui px-2 py-1.5" title={cell}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function limitLines(text: string, count: number) {
  const lines = text.split(/\r?\n/);
  return lines.length > count ? `${lines.slice(0, count).join("\n")}\n…` : text;
}

function toViewerItem(props: AttachmentBlockProps): AttachmentViewerItem {
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
  return <div className="mx-auto flex min-h-16 max-w-[720px] items-center gap-3 rounded-md border border-ui bg-surface px-3"><Loader2 className="h-5 w-5 animate-spin text-secondary" /><span className="truncate text-sm text-secondary">正在加载 {label}</span></div>;
}

function UnavailableRow({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div className="mx-auto flex min-h-16 max-w-[720px] items-center gap-3 rounded-md border border-ui bg-surface px-3"><AlertTriangle className="h-5 w-5 text-secondary" /><div className="min-w-0 flex-1"><p className="truncate text-sm text-primary">{label}</p><p className="text-xs text-secondary">附件信息加载失败</p></div><button type="button" onClick={onRetry} className="min-h-11 rounded-md px-3 text-sm text-secondary hover:bg-subtle">重试</button></div>;
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
