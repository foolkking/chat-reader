"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Eye, File, Image as ImageIcon, LocateFixed, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { useAttachmentSearchActivation, useAttachmentSearchTarget } from "./use-attachment-search-target";

type OfflineFilter = "all" | "used" | "unused" | "unavailable";

export function OfflineConversationFilesPanel({
  conversationId,
  initialAttachmentId,
  searchReplayKey = 0,
  onLocate,
}: {
  conversationId: string;
  initialAttachmentId?: string | null;
  searchReplayKey?: number;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const viewer = useAttachmentViewer();
  const [filter, setFilter] = useState<OfflineFilter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const searchActivation = useAttachmentSearchActivation(conversationId, initialAttachmentId, searchReplayKey);
  useEffect(() => {
    if (!initialAttachmentId) return;
    setSearch("");
    setFilter("all");
  }, [conversationId, initialAttachmentId, searchReplayKey]);
  const filesQuery = useQuery({
    queryKey: ["offline-conversation-attachments", conversationId],
    queryFn: () => listOfflineConversationAttachments(conversationId),
    staleTime: 10_000,
    networkMode: "always",
  });
  const files = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (filesQuery.data ?? []).filter((attachment) => {
      const unavailable = attachment.resolution_status !== "resolved";
      if (filter === "used" && !attachment.is_used) return false;
      if (filter === "unused" && attachment.is_used) return false;
      if (filter === "unavailable" && !unavailable) return false;
      return !query || attachment.display_name.toLocaleLowerCase().includes(query)
        || friendlyAttachmentType(attachment, zh).toLocaleLowerCase().includes(query);
    });
  }, [filesQuery.data, filter, search, zh]);

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
      if (!attachment.download_url) {
        setError(zh ? "此文件未缓存，无法在离线状态下下载。" : "This file was not cached and cannot be downloaded offline.");
        return;
      }
      const link = document.createElement("a");
      link.href = attachment.download_url;
      link.download = attachment.display_name;
      link.click();
    } catch {
      setError(offlineAttachmentDownloadError(zh));
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
        {initialAttachmentId && filesQuery.isSuccess && !filesQuery.isFetching && !filesQuery.data.some((item) => item.id === initialAttachmentId) ? <p role="status" className="mb-3 text-sm text-secondary">{zh ? "离线包中没有此搜索结果对应的文件记录，请重新搜索或更新离线副本。" : "This file is not in the offline package. Search again or update the offline copy."}</p> : null}
        {filesQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--danger)]">
            <p>{zh ? "无法读取离线文件列表。" : "Unable to read offline files."}</p>
            <button
              type="button"
              disabled={filesQuery.isFetching}
              onClick={() => void filesQuery.refetch()}
              className="min-h-10 underline disabled:opacity-60"
            >
              {filesQuery.isFetching ? (zh ? "正在重试…" : "Retrying…") : (zh ? "重试" : "Retry")}
            </button>
          </div>
        ) : null}
        {files.length ? <div className="overflow-hidden rounded-lg border border-ui bg-surface">{files.map((attachment, index) => (
          <OfflineFileRow
            key={attachment.id}
            attachment={attachment}
            searchTarget={attachment.id === initialAttachmentId ? searchActivation : null}
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

function OfflineFileRow({ attachment, searchTarget, zh, divided, onOpen, onDownload, onLocate }: {
  attachment: AttachmentRead;
  searchTarget?: { focused: boolean } | null;
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
  const [referenceCount, setReferenceCount] = useState(3);
  const referencesOpen = referenceCount > 3;
  const visibleOccurrences = occurrences.slice(0, referenceCount);
  const searchTargetRef = useAttachmentSearchTarget(searchTarget ?? null);
  return (
    <article ref={searchTargetRef} tabIndex={-1} className={`flex min-h-16 items-center gap-3 px-3 py-2 ${divided ? "border-t border-ui" : ""}`} data-attachment-id={attachment.id} data-resolution-status={attachment.resolution_status} data-search-target={searchTarget ? "true" : undefined} data-dialog-initial-focus={searchTarget ? "true" : undefined}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-subtle text-secondary">{image ? <ImageIcon className="h-4 w-4" /> : <File className="h-4 w-4" />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-primary" title={attachment.display_name}>{attachment.display_name}</p>
        <p className="truncate text-[11px] text-secondary">{friendlyAttachmentType(attachment, zh)} · {formatBytes(attachment.asset_object?.byte_size ?? 0)} · {available ? (zh ? "已缓存" : "Cached") : attachment.resolution_status === "missing" ? (zh ? "文件缺失" : "Missing") : (zh ? "离线不可用" : "Unavailable offline")}</p>
        {occurrences.length ? <div className="mt-1 flex flex-wrap gap-1" aria-label={zh ? "正文引用" : "Message references"}>{visibleOccurrences.map((occurrence, index) => (
          <button key={`${occurrence.message_version_id}:${occurrence.occurrence_key}`} type="button" onClick={() => void onLocate(attachmentOccurrenceTarget(attachment, occurrence))} className="inline-flex min-h-11 items-center gap-1 rounded px-1.5 text-[11px] text-secondary hover:bg-subtle hover:text-primary">
            <LocateFixed className="h-3 w-3" />{zh ? `引用 ${index + 1}` : `Reference ${index + 1}`}
          </button>
        ))}{occurrences.length > referenceCount ? <button type="button" aria-expanded={referencesOpen} onClick={() => setReferenceCount((value) => value + 50)} className="inline-flex min-h-11 items-center rounded px-1.5 text-[11px] font-medium text-accent hover:bg-subtle">{zh ? `查看更多引用（还有 ${occurrences.length - visibleOccurrences.length} 处）` : `More references (${occurrences.length - visibleOccurrences.length} remaining)`}</button> : null}{referencesOpen ? <button type="button" onClick={() => setReferenceCount(3)} className="inline-flex min-h-11 items-center rounded px-1.5 text-[11px] text-secondary underline">{zh ? "收起引用" : "Show fewer"}</button> : null}</div> : null}
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

function offlineAttachmentDownloadError(zh: boolean): string {
  return zh
    ? "离线文件暂不可用，请重新打开文件列表后重试。"
    : "This offline file is temporarily unavailable. Reopen the file list and try again.";
}
