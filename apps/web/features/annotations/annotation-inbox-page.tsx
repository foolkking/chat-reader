"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Highlighter, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { getAnnotationInbox } from "../../lib/api";
import type { AnnotationAnchorStatus, AnnotationInboxItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime } from "../../lib/activity-time";

const PAGE_SIZE = 50;
type StatusFilter = "all" | AnnotationAnchorStatus;

const statusLabels: Record<StatusFilter, { zh: string; en: string }> = {
  all: { zh: "全部状态", en: "All statuses" },
  valid: { zh: "有效", en: "Valid" },
  remapped: { zh: "已重定位", en: "Remapped" },
  orphaned: { zh: "已失联", en: "Orphaned" },
  needs_review: { zh: "需要复核", en: "Needs review" },
};

export function AnnotationInboxPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [status, setStatus] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const inbox = useQuery({
    queryKey: ["annotation-inbox", status, offset],
    queryFn: ({ signal }) => getAnnotationInbox({
      anchorStatus: status === "all" ? undefined : status,
      limit: PAGE_SIZE,
      offset,
      signal,
    }),
    staleTime: 15_000,
  });
  const items = inbox.data?.items ?? [];
  const statusOptions = useMemo(
    () => (Object.keys(statusLabels) as StatusFilter[]).map((value) => ({
      value,
      label: zh ? statusLabels[value].zh : statusLabels[value].en,
    })),
    [zh],
  );

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    setOffset(0);
  }

  return (
    <section className="space-y-4" aria-busy={inbox.isFetching}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs font-medium text-secondary">
          {zh ? "锚点状态" : "Anchor status"}
          <select
            value={status}
            onChange={(event) => changeStatus(event.currentTarget.value as StatusFilter)}
            className="mt-1 block min-h-10 rounded-lg border border-ui bg-surface px-3 text-sm text-primary"
            aria-label={zh ? "按锚点状态筛选" : "Filter by anchor status"}
          >
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {inbox.data ? <p className="text-xs text-secondary">{zh ? `共 ${inbox.data.total} 条` : `${inbox.data.total} total`}</p> : null}
      </div>

      {inbox.isPending ? <InboxState label={zh ? "正在读取批注…" : "Loading annotations…"} loading /> : null}
      {inbox.isError ? (
        <InboxState
          label={zh ? "批注收件箱加载失败。" : "Could not load the annotation inbox."}
          error
          retry={() => void inbox.refetch()}
          retryLabel={zh ? "重试" : "Retry"}
        />
      ) : null}
      {inbox.isSuccess && items.length === 0 ? (
        <div className="state-empty border border-ui bg-surface text-sm text-secondary">
          <Highlighter className="mx-auto mb-3 h-7 w-7 text-accent" aria-hidden="true" />
          <p>{zh ? "当前筛选下没有批注。" : "No annotations match this filter."}</p>
          {status !== "all" ? <button type="button" onClick={() => changeStatus("all")} className="mt-3 min-h-10 rounded-lg border border-ui px-3 text-sm font-medium text-primary hover:bg-subtle">{zh ? "显示全部" : "Show all"}</button> : null}
        </div>
      ) : null}
      {items.length ? <div className="space-y-3">{items.map((item) => <AnnotationInboxCard key={item.id} item={item} zh={zh} locale={resolvedLocale} />)}</div> : null}
      {inbox.data && (inbox.data.offset > 0 || inbox.data.has_more) ? (
        <nav className="flex items-center justify-between gap-3 border-t border-ui pt-3" aria-label={zh ? "批注分页" : "Annotation pagination"}>
          <button type="button" disabled={offset === 0 || inbox.isFetching} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} className="btn-secondary inline-flex min-h-10 items-center gap-1 px-3 text-sm disabled:opacity-50">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />{zh ? "上一页" : "Previous"}
          </button>
          <span className="text-xs text-secondary">{zh ? `第 ${Math.floor(offset / PAGE_SIZE) + 1} 页` : `Page ${Math.floor(offset / PAGE_SIZE) + 1}`}</span>
          <button type="button" disabled={!inbox.data.has_more || inbox.isFetching} onClick={() => setOffset((value) => value + PAGE_SIZE)} className="btn-secondary inline-flex min-h-10 items-center gap-1 px-3 text-sm disabled:opacity-50">
            {zh ? "下一页" : "Next"}<ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function AnnotationInboxCard({
  item,
  zh,
  locale,
}: {
  item: AnnotationInboxItem;
  zh: boolean;
  locale: "zh-CN" | "en-US";
}) {
  const href = annotationHref(item);
  const status = statusLabels[item.anchor_status];
  const title = item.conversation_title || (zh ? "未命名对话" : "Untitled conversation");
  const detail = item.quote?.trim() || item.comment_markdown.trim() || (zh ? "无批注正文" : "No annotation text");
  return (
    <article className="card-base min-w-0 p-4" data-testid={`annotation-inbox-item-${item.id}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent"><Highlighter className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          {href ? <Link href={href} className="line-clamp-2 text-sm font-semibold text-primary hover:text-accent">{title}</Link> : <h2 className="line-clamp-2 text-sm font-semibold text-primary">{title}</h2>}
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-secondary">{detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-secondary">
            <span className="rounded-full bg-subtle px-2 py-1">{zh ? status.zh : status.en}</span>
            <span>{formatActivityTime(item.updated_at, locale)}</span>
            {href ? <span>{zh ? "可定位到原文" : "Can open source"}</span> : <span>{zh ? "原文不可用" : "Source unavailable"}</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

function annotationHref(item: AnnotationInboxItem): string | null {
  if (!item.conversation_id) return null;
  const params = new URLSearchParams({ annotations: "open", annotationId: item.id });
  if (item.message_id) params.set("messageId", item.message_id);
  if (item.message_version_id) params.set("messageVersionId", item.message_version_id);
  if (item.start_block_index !== null) params.set("blockIndex", String(item.start_block_index));
  return `/conversations/${item.conversation_id}?${params.toString()}`;
}

function InboxState({
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
