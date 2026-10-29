"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CopyCheck, RefreshCw } from "lucide-react";
import { getDuplicateReviews } from "../../lib/api";
import type { DuplicateReviewConversation } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime } from "../../lib/activity-time";
import { useState } from "react";

const PAGE_SIZE = 25;
type StatusScope = "active" | "archived" | "all";

const statusLabels: Record<StatusScope, { zh: string; en: string }> = {
  active: { zh: "仅活动", en: "Active only" },
  archived: { zh: "仅归档", en: "Archived only" },
  all: { zh: "全部状态", en: "All statuses" },
};

export function DuplicateReviewPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [statusScope, setStatusScope] = useState<StatusScope>("active");
  const [offset, setOffset] = useState(0);
  const result = useQuery({
    queryKey: ["duplicate-review", statusScope, offset],
    queryFn: ({ signal }) => getDuplicateReviews({ statusScope, limit: PAGE_SIZE, offset, signal }),
    staleTime: 15_000,
  });

  function changeScope(value: StatusScope) {
    setStatusScope(value);
    setOffset(0);
  }

  return (
    <section className="space-y-4" aria-busy={result.isFetching}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs font-medium text-secondary">
          {zh ? "状态范围" : "Status scope"}
          <select
            value={statusScope}
            onChange={(event) => changeScope(event.currentTarget.value as StatusScope)}
            className="mt-1 block min-h-10 rounded-lg border border-ui bg-surface px-3 text-sm text-primary"
            aria-label={zh ? "按状态筛选重复项" : "Filter duplicate groups by status"}
          >
            {(Object.keys(statusLabels) as StatusScope[]).map((value) => (
              <option key={value} value={value}>{zh ? statusLabels[value].zh : statusLabels[value].en}</option>
            ))}
          </select>
        </label>
        {result.data ? (
          <p className="text-xs text-secondary">
            {zh ? `${result.data.total_groups} 组 · ${result.data.total_conversations} 个对话` : `${result.data.total_groups} groups · ${result.data.total_conversations} conversations`}
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-primary">
        <strong>{zh ? "仅供复核" : "Review only"}</strong>
        <span className="ml-2">{zh ? "这里按完全相同的 canonical 内容哈希分组，不会自动删除、合并或改变任何对话。" : "Groups use exact canonical content hashes. Nothing is automatically deleted, merged, or changed."}</span>
      </div>

      {result.isPending ? <ReviewState label={zh ? "正在读取重复项…" : "Loading duplicate groups…"} loading /> : null}
      {result.isError ? (
        <ReviewState
          label={zh ? "重复项审查加载失败。" : "Could not load duplicate groups."}
          error
          retry={() => void result.refetch()}
          retryLabel={zh ? "重试" : "Retry"}
        />
      ) : null}
      {result.isSuccess && result.data.groups.length === 0 ? (
        <div className="state-empty border border-ui bg-surface text-sm text-secondary">
          <CopyCheck className="mx-auto mb-3 h-7 w-7 text-accent" aria-hidden="true" />
          <p>{zh ? "当前范围没有完全重复的对话。" : "No exact duplicate conversations in this scope."}</p>
        </div>
      ) : null}
      {result.data?.groups.length ? (
        <div className="space-y-3">
          {result.data.groups.map((group) => (
            <article key={group.content_hash} className="card-base min-w-0 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-primary">
                  {zh ? `完全重复 · ${group.count} 个版本` : `Exact duplicate · ${group.count} copies`}
                </h2>
                <code className="max-w-full truncate rounded bg-subtle px-2 py-1 text-[11px] text-secondary" title={group.content_hash}>
                  {group.content_hash.slice(0, 16)}…
                </code>
              </div>
              <div className="mt-3 divide-y divide-[var(--border)]">
                {group.conversations.map((conversation) => (
                  <DuplicateConversationRow key={conversation.id} conversation={conversation} zh={zh} locale={resolvedLocale} />
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {result.data && (result.data.offset > 0 || result.data.has_more) ? (
        <nav className="flex items-center justify-between gap-3 border-t border-ui pt-3" aria-label={zh ? "重复项分页" : "Duplicate review pagination"}>
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

function DuplicateConversationRow({
  conversation,
  zh,
  locale,
}: {
  conversation: DuplicateReviewConversation;
  zh: boolean;
  locale: "zh-CN" | "en-US";
}) {
  const title = conversation.display_title || conversation.title || (zh ? "未命名对话" : "Untitled conversation");
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3 first:pt-3 last:pb-0">
      <div className="min-w-0 flex-1">
        <Link href={`/conversations/${conversation.id}`} className="line-clamp-2 text-sm font-medium text-primary hover:text-accent">{title}</Link>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
          <span>{conversation.status}</span>
          <span>{zh ? `${conversation.message_count} 条消息 · ${conversation.turn_count} 轮` : `${conversation.message_count} messages · ${conversation.turn_count} turns`}</span>
          {conversation.project_name ? <span>{conversation.project_name}</span> : null}
          <span>{formatActivityTime(conversation.updated_at ?? conversation.imported_at, locale)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 text-xs text-secondary">
        <span className="rounded-full bg-subtle px-2 py-1">{zh ? `${conversation.attachment_count} 个文件` : `${conversation.attachment_count} files`}</span>
        <span className="rounded-full bg-subtle px-2 py-1">{zh ? `${conversation.annotation_count} 条批注` : `${conversation.annotation_count} notes`}</span>
      </div>
    </div>
  );
}

function ReviewState({
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
