"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Eye, File, Image as ImageIcon, LocateFixed, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import {
  getOfflineAttachment,
  listOfflineConversationAttachments,
  releaseOfflineAttachmentUrls,
} from "../../lib/offline-db";
import type { AttachmentRead, NavigateTarget } from "../../lib/types";
import { buildAttachmentRenderPlan, friendlyAttachmentType } from "./preview-adapter-registry";
import { formatBytes, useAttachmentViewer } from "./attachment-viewer";
import { attachmentOccurrenceTarget } from "./attachment-location";

type OfflineFilter = "all" | "used" | "unused" | "unavailable";

export function OfflineConversationFilesPanel({
  conversationId,
  onLocate,
}: {
  conversationId: string;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const viewer = useAttachmentViewer();
  const [filter, setFilter] = useState<OfflineFilter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const filesQuery = useQuery({
    queryKey: ["offline-conversation-attachments", conversationId],
    queryFn: () => listOfflineConversationAttachments(conversationId),
    staleTime: 10_000,
  });
  const files = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (filesQuery.data ?? []).filter((attachment) => {
      const unavailable = attachment.resolution_status !== "resolved";
      if (filter === "used" && !attachment.is_used) return false;
      if (filter === "unused" && attachment.is_used) return false;
      if (filter === "unavailable" && !unavailable) return false;
      return !query || attachment.display_name.toLocaleLowerCase().includes(query)
        || friendlyAttachmentType(attachment).toLocaleLowerCase().includes(query);
    });
  }, [filesQuery.data, filter, search]);

  function openAttachment(attachment: AttachmentRead, trigger: HTMLElement) {
    if (attachment.resolution_status !== "resolved") return;
    viewer.open({
      source: "offline",
      scope: "single",
      items: [{ itemKey: `offline:${attachment.id}`, attachmentId: attachment.id, displayMode: "auto" }],
      activeItemKey: `offline:${attachment.id}`,
      access: { kind: "offline" },
      permissions: { downloadOriginal: true, enumerateConversationImages: false, batchDownload: false },
      trigger,
    });
  }

  async function downloadAttachment(attachmentId: string) {
    setError(null);
    let attachment: AttachmentRead | null = null;
    try {
      attachment = await getOfflineAttachment(attachmentId);
      if (!attachment.download_url) throw new Error(zh ? "离线状态下此文件不可用。" : "This file is unavailable offline.");
      const link = document.createElement("a");
      link.href = attachment.download_url;
      link.download = attachment.display_name;
      link.click();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (zh ? "无法下载离线文件。" : "Unable to download the offline file."));
    } finally {
      const completed = attachment;
      window.setTimeout(() => releaseOfflineAttachmentUrls(completed), 1_000);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-page" aria-label={zh ? "当前对话文件" : "Conversation files"} data-testid="offline-conversation-files-panel">
      <div className="shrink-0 space-y-2 border-b border-ui p-3">
        <div>
          <p className="text-sm font-semibold text-primary">{zh ? "当前对话文件" : "Conversation files"} · {filesQuery.data?.length ?? 0}</p>
          <p className="mt-1 text-[11px] leading-4 text-secondary">{zh ? "离线模式仅支持查看已缓存文件和定位正文引用。" : "Offline mode can view cached files and locate message references only."}</p>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={zh ? "搜索文件" : "Search files"} className="min-h-9 w-full rounded-md border border-ui bg-surface pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]" />
        </label>
        <div className="flex items-center gap-1 overflow-x-auto" role="group" aria-label={zh ? "文件筛选" : "File filters"}>
          {(["all", "used", "unused", "unavailable"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-8 shrink-0 rounded px-2 text-xs ${filter === value ? "bg-[var(--text)] text-[var(--surface)]" : "text-secondary hover:bg-subtle"}`}>
              {offlineFilterLabel(value, zh)}
            </button>
          ))}
        </div>
        {error ? <p role="alert" className="rounded bg-[var(--danger-soft)] p-2 text-xs text-[var(--danger)]">{error}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {filesQuery.isLoading ? <p className="text-sm text-secondary">{zh ? "正在加载文件…" : "Loading files…"}</p> : null}
        {filesQuery.isError ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "无法读取离线文件列表。" : "Unable to read offline files."}</p> : null}
        {files.length ? <div className="overflow-hidden rounded-lg border border-ui bg-surface">{files.map((attachment, index) => (
          <OfflineFileRow
            key={attachment.id}
            attachment={attachment}
            zh={zh}
            divided={index > 0}
            onOpen={openAttachment}
            onDownload={() => void downloadAttachment(attachment.id)}
            onLocate={onLocate}
          />
        ))}</div> : null}
        {!filesQuery.isLoading && !filesQuery.isError && !files.length ? <p className="py-8 text-center text-sm text-secondary">{search || filter !== "all" ? (zh ? "没有符合条件的文件。" : "No matching files.") : (zh ? "当前离线包没有附件记录。" : "This offline package has no attachment records.")}</p> : null}
      </div>
    </section>
  );
}

function OfflineFileRow({ attachment, zh, divided, onOpen, onDownload, onLocate }: {
  attachment: AttachmentRead;
  zh: boolean;
  divided: boolean;
  onOpen: (attachment: AttachmentRead, trigger: HTMLElement) => void;
  onDownload: () => void;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
}) {
  const plan = buildAttachmentRenderPlan(attachment);
  const available = attachment.resolution_status === "resolved";
  const image = (attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type ?? "").startsWith("image/");
  const occurrences = attachment.occurrences ?? [];
  return (
    <article className={`flex min-h-16 items-center gap-3 px-3 py-2 ${divided ? "border-t border-ui" : ""}`} data-attachment-id={attachment.id} data-resolution-status={attachment.resolution_status}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-subtle text-secondary">{image ? <ImageIcon className="h-4 w-4" /> : <File className="h-4 w-4" />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p>
        <p className="truncate text-[11px] text-secondary">{friendlyAttachmentType(attachment)} · {formatBytes(attachment.asset_object?.byte_size ?? 0)} · {available ? (zh ? "已缓存" : "Cached") : attachment.resolution_status === "missing" ? (zh ? "文件缺失" : "Missing") : (zh ? "离线不可用" : "Unavailable offline")}</p>
        {occurrences.length ? <div className="mt-1 flex flex-wrap gap-1">{occurrences.slice(0, 3).map((occurrence, index) => (
          <button key={`${occurrence.message_version_id}:${occurrence.occurrence_key}`} type="button" onClick={() => void onLocate(attachmentOccurrenceTarget(attachment, occurrence))} className="inline-flex min-h-7 items-center gap-1 rounded px-1.5 text-[11px] text-secondary hover:bg-subtle hover:text-primary">
            <LocateFixed className="h-3 w-3" />{zh ? `引用 ${index + 1}` : `Reference ${index + 1}`}
          </button>
        ))}{occurrences.length > 3 ? <span className="px-1.5 py-1 text-[11px] text-secondary">+{occurrences.length - 3}</span> : null}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {available && plan.actions.open ? <button type="button" onClick={(event) => onOpen(attachment, event.currentTarget)} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? `查看 ${attachment.display_name}` : `View ${attachment.display_name}`} title={zh ? "查看" : "View"}><Eye className="h-4 w-4" /></button> : null}
        {available ? <button type="button" onClick={onDownload} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? `下载 ${attachment.display_name}` : `Download ${attachment.display_name}`} title={zh ? "下载" : "Download"}><Download className="h-4 w-4" /></button> : null}
      </div>
    </article>
  );
}

function offlineFilterLabel(filter: OfflineFilter, zh: boolean): string {
  if (filter === "used") return zh ? "已引用" : "Referenced";
  if (filter === "unused") return zh ? "未引用" : "Unreferenced";
  if (filter === "unavailable") return zh ? "离线不可用" : "Unavailable";
  return zh ? "全部" : "All";
}
