"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { BookmarkCheck, BookmarkPlus, Clock3, ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiRequestError, deleteUserFeatureEntry, getConversation, saveUserFeatureEntry } from "../../lib/api";
import type { ReadingListValue, UserFeatureEntry } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime } from "../../lib/activity-time";
import { readingListQueryKey, useReadingListEntries } from "./reading-list-button";

export function ReadingListPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const entriesQuery = useReadingListEntries();
  const [visibleCount, setVisibleCount] = useState(20);
  const entries = useMemo(
    () => [...(entriesQuery.data ?? [])].sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, visibleCount),
    [entriesQuery.data, visibleCount],
  );

  if (entriesQuery.isLoading) return <StateLine label={zh ? "正在加载待读清单…" : "Loading your reading list…"} loading />;
  if (entriesQuery.isError) {
    return <StateLine label={zh ? "待读清单加载失败。" : "Could not load your reading list."} error retry={() => void entriesQuery.refetch()} retryLabel={zh ? "重试" : "Retry"} />;
  }
  if (entries.length === 0) {
    return (
      <div className="state-empty border border-ui bg-surface text-sm text-secondary">
        <BookmarkPlus className="mx-auto mb-3 h-7 w-7 text-accent" />
        <p>{zh ? "把需要稍后处理的对话加入待读清单。" : "Add conversations here when you want to return to them later."}</p>
        <Link href="/recent" className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-ui px-3 text-sm font-medium text-primary hover:bg-subtle">
          {zh ? "打开最近阅读" : "Open recent"}
        </Link>
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-busy={entriesQuery.isFetching}>
      {entriesQuery.isFetching ? <span className="sr-only" role="status">{zh ? "正在更新" : "Updating"}</span> : null}
      {entries.map((entry) => <ReadingListCard key={entry.id} entry={entry} zh={zh} locale={resolvedLocale} />)}
      {entriesQuery.data && entriesQuery.data.length > visibleCount ? (
        <button type="button" onClick={() => setVisibleCount((value) => value + 20)} className="btn-secondary min-h-11 px-4 text-sm">
          {zh ? `加载更多（已显示 ${entries.length} / ${entriesQuery.data.length}）` : `Load more (${entries.length} / ${entriesQuery.data.length})`}
        </button>
      ) : null}
    </section>
  );
}

function ReadingListCard({
  entry,
  zh,
  locale,
}: {
  entry: UserFeatureEntry<ReadingListValue>;
  zh: boolean;
  locale: "zh-CN" | "en-US";
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationQuery = useQuery({
    queryKey: ["conversation", "reading-list", entry.value.conversation_id],
    queryFn: () => getConversation(entry.value.conversation_id),
    staleTime: 30_000,
  });
  const conversation = conversationQuery.data;
  const isRead = entry.value.state === "read";

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveUserFeatureEntry<ReadingListValue>("reading-list", entry.id, {
        expected_revision: entry.revision,
        value: { ...entry.value, state: isRead ? "unread" : "read" },
      });
      await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
    } catch (cause) {
      setError(featureWriteError(cause, zh));
      await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteUserFeatureEntry("reading-list", entry.id, entry.revision);
      await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
    } catch (cause) {
      setError(featureWriteError(cause, zh));
      await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
    } finally {
      setBusy(false);
    }
  }

  const title = conversation ? (conversation.display_title || conversation.title) : (zh ? "对话不可用" : "Conversation unavailable");
  const href = conversation ? `/conversations/${conversation.id}` : undefined;
  return (
    <article className="card-base flex min-w-0 flex-col gap-3 p-4" data-testid={`reading-list-item-${entry.value.conversation_id}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isRead ? "bg-subtle text-secondary" : "bg-[var(--accent-soft)] text-accent"}`}>
          {isRead ? <BookmarkCheck className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          {href ? <Link href={href} className="line-clamp-2 text-sm font-semibold text-primary hover:text-accent">{title}</Link> : <h2 className="line-clamp-2 text-sm font-semibold text-primary">{title}</h2>}
          <p className="mt-1 flex items-center gap-1 text-xs text-secondary"><Clock3 className="h-3.5 w-3.5" />{formatActivityTime(entry.updated_at, locale)}</p>
        </div>
        {href ? <Link href={href} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary" aria-label={zh ? "打开对话" : "Open conversation"} title={zh ? "打开对话" : "Open conversation"}><ExternalLink className="h-4 w-4" /></Link> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void toggle()} disabled={busy} className="btn-secondary min-h-10 px-3 text-xs disabled:opacity-50">
          {isRead ? (zh ? "标为待读" : "Mark unread") : (zh ? "标为已读" : "Mark read")}
        </button>
        <button type="button" onClick={() => void remove()} disabled={busy} className="min-h-10 rounded-lg px-3 text-xs font-medium text-secondary hover:bg-subtle hover:text-primary disabled:opacity-50">
          {zh ? "移除" : "Remove"}
        </button>
        {conversationQuery.isError ? <span className="text-xs text-secondary">{zh ? "当前账户无法打开此对话。" : "This conversation is unavailable to the current account."}</span> : null}
        {conversationQuery.isFetching ? <span className="text-xs text-secondary">{zh ? "读取标题…" : "Loading title…"}</span> : null}
      </div>
      {error ? <p className="text-xs text-[var(--danger)]" role="alert">{error}</p> : null}
    </article>
  );
}

function featureWriteError(cause: unknown, zh: boolean): string {
  if (cause instanceof ApiRequestError && cause.status === 409) {
    return zh ? "清单已在其他窗口更新，已重新加载。" : "The list changed in another window and was reloaded.";
  }
  return zh ? "更新待读清单失败。" : "Could not update the reading list.";
}

function StateLine({ label, loading = false, error = false, retry, retryLabel, busy = false }: { label: string; loading?: boolean; error?: boolean; retry?: () => void; retryLabel?: string; busy?: boolean }) {
  return (
    <div className="state-empty border border-ui bg-surface text-sm text-secondary" role={error ? "alert" : loading ? "status" : undefined}>
      {label}
      {retry ? <button type="button" onClick={retry} disabled={busy} className="btn-secondary ml-3 min-h-10 px-3 py-1 text-xs disabled:opacity-60"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />{retryLabel}</button> : null}
    </div>
  );
}
