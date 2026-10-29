"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search } from "lucide-react";
import { FormEvent, useState } from "react";
import { getAttachmentDirectory } from "../../lib/api";
import type { AttachmentDirectoryItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime } from "../../lib/activity-time";
import { formatBytes } from "./attachment-viewer";

const PAGE_SIZE = 50;
type UsedScope = "all" | "used" | "unused";

export function AttachmentDirectoryPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [used, setUsed] = useState<UsedScope>("all");
  const [offset, setOffset] = useState(0);
  const result = useQuery({
    queryKey: ["attachment-directory", query, mimeType, used, offset],
    queryFn: ({ signal }) => getAttachmentDirectory({
      q: query,
      mimeType,
      used,
      limit: PAGE_SIZE,
      offset,
      signal,
    }),
    staleTime: 15_000,
  });

  function submitQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(draftQuery.trim());
    setOffset(0);
  }

  function changeUsed(value: UsedScope) {
    setUsed(value);
    setOffset(0);
  }

  function changeMime(value: string) {
    setMimeType(value);
    setOffset(0);
  }

  return (
    <section className="space-y-4" aria-busy={result.isFetching}>
      <form onSubmit={submitQuery} className="grid gap-3 rounded-lg border border-ui bg-surface p-3 md:grid-cols-[minmax(0,1fr)_10rem_12rem_auto] md:items-end">
        <label className="text-xs font-medium text-secondary">
          {zh ? "文件名" : "Filename"}
          <span className="mt-1 flex min-h-10 items-center gap-2 rounded-lg border border-ui bg-page px-3">
            <Search className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
            <input value={draftQuery} onChange={(event) => setDraftQuery(event.currentTarget.value)} className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none" placeholder={zh ? "搜索显示名或原文件名" : "Search display or original name"} aria-label={zh ? "搜索文件名" : "Search filenames"} />
          </span>
        </label>
        <label className="text-xs font-medium text-secondary">
          {zh ? "使用状态" : "Usage"}
          <select value={used} onChange={(event) => changeUsed(event.currentTarget.value as UsedScope)} className="mt-1 block min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" aria-label={zh ? "按使用状态筛选" : "Filter by usage"}>
            <option value="all">{zh ? "全部文件" : "All files"}</option>
            <option value="used">{zh ? "当前已使用" : "Currently used"}</option>
            <option value="unused">{zh ? "当前未使用" : "Currently unused"}</option>
          </select>
        </label>
        <label className="text-xs font-medium text-secondary">
          MIME
          <input value={mimeType} onChange={(event) => changeMime(event.currentTarget.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" placeholder="image/png" aria-label="MIME type" />
        </label>
        <button type="submit" className="btn-primary inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm"><Search className="h-4 w-4" aria-hidden="true" />{zh ? "搜索" : "Search"}</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
        <p>{result.data ? (zh ? `共 ${result.data.total} 个文件` : `${result.data.total} files`) : (zh ? "文件目录" : "File directory")}</p>
        <p>{zh ? "仅展示当前账号可见且未删除的附件" : "Only visible, non-deleted attachments are shown"}</p>
      </div>

      {result.isPending ? <DirectoryState label={zh ? "正在读取文件目录…" : "Loading file directory…"} loading /> : null}
      {result.isError ? (
        <DirectoryState
          label={zh ? "文件目录加载失败。" : "Could not load the file directory."}
          error
          retry={() => void result.refetch()}
          retryLabel={zh ? "重试" : "Retry"}
        />
      ) : null}
      {result.isSuccess && result.data.items.length === 0 ? (
        <div className="state-empty border border-ui bg-surface text-sm text-secondary">
          <FileText className="mx-auto mb-3 h-7 w-7 text-accent" aria-hidden="true" />
          <p>{zh ? "当前筛选下没有文件。" : "No files match this filter."}</p>
        </div>
      ) : null}
      {result.data?.items.length ? (
        <div className="space-y-2">
          {result.data.items.map((item) => <AttachmentDirectoryCard key={item.id} item={item} zh={zh} locale={resolvedLocale} />)}
        </div>
      ) : null}
      {result.data && (result.data.offset > 0 || result.data.has_more) ? (
        <nav className="flex items-center justify-between gap-3 border-t border-ui pt-3" aria-label={zh ? "文件目录分页" : "File directory pagination"}>
          <button type="button" disabled={offset === 0 || result.isFetching} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} className="btn-secondary inline-flex min-h-10 items-center gap-1 px-3 text-sm disabled:opacity-50">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />{zh ? "上一页" : "Previous"}
          </button>
          <span className="text-xs text-secondary">{zh ? `第 ${Math.floor(offset / PAGE_SIZE) + 1} 页` : `Page ${Math.floor(offset / PAGE_SIZE) + 1}`}</span>
          <button type="button" disabled={!result.data.has_more || result.isFetching} onClick={() => setOffset((value) => value + PAGE_SIZE)} className="btn-secondary inline-flex min-h-10 items-center gap-1 px-3 text-sm disabled:opacity-50">
            {zh ? "下一页" : "Next"}<ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function AttachmentDirectoryCard({
  item,
  zh,
  locale,
}: {
  item: AttachmentDirectoryItem;
  zh: boolean;
  locale: "zh-CN" | "en-US";
}) {
  const size = item.asset_object?.byte_size ?? 0;
  const mime = item.detected_mime_type ?? item.declared_mime_type ?? item.asset_object?.detected_mime_type ?? (zh ? "未知类型" : "Unknown type");
  const conversationTitle = item.conversation_display_title || item.conversation_title || (zh ? "未命名对话" : "Untitled conversation");
  const conversationHref = `/conversations/${item.conversation_id}?files=open&attachmentId=${encodeURIComponent(item.id)}`;
  return (
    <article className="card-base flex min-w-0 flex-wrap items-start gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent"><FileText className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <Link href={conversationHref} className="line-clamp-2 text-sm font-semibold text-primary hover:text-accent">{item.display_name || item.original_filename}</Link>
        <p className="mt-1 truncate text-xs text-secondary" title={item.original_filename}>{item.original_filename}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
          <span>{mime}</span>
          <span>{formatBytes(size)}</span>
          <span>{item.is_used ? (zh ? "当前使用中" : "Currently used") : (zh ? "当前未使用" : "Currently unused")}</span>
          <span>{zh ? `${item.current_occurrence_count ?? 0} 个当前引用` : `${item.current_occurrence_count ?? 0} current references`}</span>
          <Link href={conversationHref} className="max-w-full truncate text-accent hover:underline" title={conversationTitle}>{conversationTitle}</Link>
          {item.project_name ? <span>{item.project_name}</span> : null}
          <span>{formatActivityTime(item.created_at, locale)}</span>
        </div>
      </div>
      {item.download_url ? <a href={item.download_url} download className="btn-secondary inline-flex min-h-10 shrink-0 items-center gap-2 px-3 text-xs"><Download className="h-4 w-4" aria-hidden="true" />{zh ? "下载" : "Download"}</a> : null}
    </article>
  );
}

function DirectoryState({
  label,
  loading = false,
  error = false,
  retry,
  retryLabel,
}: {
  label: string;
  loading?: boolean;
  error?: boolean;
  retry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="state-empty border border-ui bg-surface text-sm text-secondary" role={error ? "alert" : loading ? "status" : undefined}>
      {label}
      {retry ? <button type="button" onClick={retry} className="btn-secondary ml-3 inline-flex min-h-10 items-center gap-1 px-3 py-1 text-xs"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{retryLabel}</button> : null}
    </div>
  );
}
