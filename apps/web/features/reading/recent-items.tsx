"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import { getRecentItems } from "../../lib/api";
import type { RecentItemRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime } from "../../lib/activity-time";

export function RecentItems({ compact = false, showHeading = true }: { compact?: boolean; showHeading?: boolean }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const recentQuery = useQuery({
    queryKey: ["recent-items"],
    queryFn: getRecentItems,
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

  if (recentQuery.isLoading) return <StateLine label={zh ? "正在加载最近内容…" : "Loading recent items…"} loading />;
  if (recentQuery.isError) return <StateLine label={recentQuery.error.message} retryLabel={zh ? "重试" : "Retry"} retry={() => void recentQuery.refetch()} />;
  const items = (recentQuery.data ?? []).slice(0, compact ? 3 : undefined);
  if (items.length === 0) return compact ? null : <StateLine label={zh ? "打开一个对话后，最近阅读会显示在这里。" : "Open a conversation to start your recent list."} />;

  return (
    <section className="space-y-3" aria-labelledby={showHeading ? "recent-heading" : undefined} aria-label={!showHeading ? (zh ? "继续阅读" : "Continue reading") : undefined}>
      {showHeading ? <div className="flex items-center justify-between">
        {recentQuery.isFetching ? <span role="status" className="sr-only">{zh ? "正在更新" : "Updating"}</span> : null}
        <div><h1 id="recent-heading" className={compact ? "text-sm font-semibold" : "text-xl font-semibold"}>{zh ? "继续阅读" : "Continue reading"}</h1>{!compact ? <p className="mt-1 text-sm text-secondary">{zh ? "回到上次离开的消息和位置。" : "Return to the message and position where you left off."}</p> : null}</div>
        {compact ? <Link href="/recent" className="text-xs font-medium text-accent">{zh ? "查看全部" : "View all"}</Link> : null}
      </div> : null}
      <div className={compact ? "flex snap-x gap-3 overflow-x-auto pb-2" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
        {items.map((item) => <RecentCard key={item.id} item={item} compact={compact} zh={zh} locale={resolvedLocale} />)}
      </div>
    </section>
  );
}

function RecentCard({ item, compact, zh, locale }: { item: RecentItemRead; compact: boolean; zh: boolean; locale: "zh-CN" | "en-US" }) {
  const progress = numericContext(item.context, "progress");
  return <Link href={recentHref(item)} className={`${compact ? "w-[78vw] max-w-[18rem] shrink-0 snap-start" : "min-w-0"} card-base group flex min-h-32 flex-col p-4 focus-visible:outline-none`}>
    <div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent"><Clock3 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><h2 className="line-clamp-2 text-sm font-semibold text-primary">{item.conversation.display_title || item.conversation.title}</h2><p className="mt-1 text-xs text-secondary">{formatActivityTime(item.last_opened_at, locale)}</p><div className="mt-2 flex flex-wrap gap-1">{item.conversation.project_name ? <span className="badge-accent">{item.conversation.project_name}</span> : null}{item.last_message_id ? <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-secondary">{zh ? "上次阅读位置" : "Last reading position"}</span> : null}</div></div></div>
    <div className="mt-auto pt-4">{progress !== null ? <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span className="block h-full rounded-full bg-accent" style={{ width: `${progress}%` }} /></div> : null}<span className="flex items-center justify-end gap-1 text-xs font-medium text-accent">{zh ? "继续" : "Continue"}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span></div>
  </Link>;
}

function recentHref(item: RecentItemRead): string {
  const params = new URLSearchParams();
  if (item.last_message_id) params.set("messageId", item.last_message_id);
  const block = numericContext(item.context, "block_index");
  const offset = numericContext(item.context, "character_offset");
  if (block !== null) params.set("blockIndex", String(Math.trunc(block)));
  if (offset !== null) params.set("characterOffset", String(Math.trunc(offset)));
  return `/conversations/${item.conversation_id}${params.size ? `?${params}` : ""}`;
}

function numericContext(context: Record<string, unknown>, key: string): number | null {
  const value = context[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return key === "progress" ? Math.max(0, Math.min(100, value)) : value;
}

function StateLine({ label, loading = false, retry, retryLabel = "Retry" }: { label: string; loading?: boolean; retry?: () => void; retryLabel?: string }) {
  return <div className="state-empty border border-ui bg-surface text-sm text-secondary" role={loading ? "status" : undefined}>{label}{retry ? <button type="button" onClick={retry} className="btn-secondary ml-3 px-3 py-1 text-xs">{retryLabel}</button> : null}</div>;
}
