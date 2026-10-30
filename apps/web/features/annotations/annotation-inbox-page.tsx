"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getAnnotationInboxSummary } from "../../lib/api";
import type { AnnotationInboxSummaryItem, AnnotationType } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { CollectionFilters, CollectionPagination, collectionControlClass, useCollectionScroll, useCollectionView } from "../../components/collection-view";
import { formatActivityTime } from "../../lib/activity-time";

const statuses = { "": ["全部状态", "All statuses"], attention: ["待复核", "Needs attention"], valid: ["有效", "Valid"], remapped: ["已重定位", "Remapped"], orphaned: ["已失联", "Orphaned"], needs_review: ["需要复核", "Needs review"] };
const types: Record<AnnotationType, [string, string]> = { highlight: ["高亮", "Highlight"], underline: ["下划线", "Underline"], strikethrough: ["删除线", "Strikethrough"], comment: ["评论", "Comment"], bookmark: ["书签", "Bookmark"] };

export function AnnotationInboxPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN", lang = zh ? 0 : 1;
  const { params, offset, scope, update, rootRef } = useCollectionView(50);
  const inbox = useQuery({ queryKey: ["annotation-inbox-summary", scope], queryFn: ({ signal }) => getAnnotationInboxSummary(params, signal), staleTime: 15_000 });
  const items = inbox.data?.items ?? [];
  useCollectionScroll(rootRef, scope, Boolean(inbox.data));
  const filtered = Boolean(params.get("q") || params.get("project_id") || params.get("conversation_id") || params.get("anchor_status") || params.get("annotation_type"));
  return <section ref={rootRef} className="space-y-4" aria-busy={inbox.isFetching}>
    <CollectionFilters q={params.get("q") ?? ""} projectId={params.get("project_id") ?? ""} zh={zh} update={update}>
      <label className="text-xs text-secondary">{zh ? "类型" : "Type"}<select className={`${collectionControlClass} mt-1 block`} value={params.get("annotation_type") ?? ""} onChange={event => update({ annotation_type: event.target.value })}>
        <option value="">{zh ? "全部类型" : "All types"}</option>{Object.entries(types).map(([value, labels]) => <option key={value} value={value}>{labels[lang]}</option>)}
      </select></label>
      <label className="text-xs text-secondary">{zh ? "锚点状态" : "Anchor status"}<select className={`${collectionControlClass} mt-1 block`} value={params.get("anchor_status") ?? ""} onChange={event => update({ anchor_status: event.target.value })}>{Object.entries(statuses).map(([value, labels]) => <option key={value} value={value}>{labels[lang]}</option>)}</select></label>
      <label className="text-xs text-secondary">{zh ? "排序" : "Sort"}<select className={`${collectionControlClass} mt-1 block`} value={params.get("sort") ?? "updated"} onChange={event => update({ sort: event.target.value })}><option value="updated">{zh ? "最近修改" : "Recently updated"}</option><option value="created">{zh ? "最近创建" : "Recently created"}</option></select></label>
    </CollectionFilters>
    <div className="flex flex-wrap items-center gap-3 text-xs text-secondary">
      {inbox.data ? <span>{zh ? `共 ${inbox.data.total} 条` : `${inbox.data.total} total`}</span> : null}
      <button className="min-h-11 text-accent" aria-pressed={params.get("anchor_status") === "attention"} onClick={() => update({ anchor_status: "attention" })}>{zh ? "查看待复核" : "Review anchor problems"}</button>
      {params.get("conversation_id") ? <button className="min-h-11 text-accent" onClick={() => update({ conversation_id: "" })}>{zh ? "取消当前对话筛选" : "Clear conversation filter"}</button> : null}
      {filtered ? <button className="min-h-11 text-accent" onClick={() => update({ q: "", project_id: "", conversation_id: "", annotation_type: "", anchor_status: "" })}>{zh ? "清除筛选" : "Clear filters"}</button> : null}
    </div>
    {inbox.isPending ? <p role="status" className="py-6 text-sm text-secondary">{zh ? "正在读取批注…" : "Loading annotations…"}</p> : null}
    {inbox.isError ? <div role="alert" className="text-sm text-[var(--danger)]">{zh ? "批注暂时读取失败，请重试；已有批注不会被删除。" : "Could not load annotations. Retry; existing annotations have not been deleted."}<button className="min-h-11 px-3 underline" onClick={() => void inbox.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
    {items.length ? <div className="divide-y divide-ui border-y border-ui">{items.map(item => <article key={item.id} className="min-w-0 py-4" data-testid={`annotation-inbox-item-${item.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="min-w-0 break-words text-sm font-semibold text-primary"><Link href={annotationHref(item)} className="hover:text-accent">{item.conversation_title || (zh ? "未命名对话" : "Untitled conversation")}</Link></h2><span className="text-xs text-secondary">{types[item.annotation_type][lang]} · {statuses[item.anchor_status][lang]}</span></div>
      {item.quote_preview ? <blockquote className="mt-3 whitespace-pre-wrap break-words border-l border-ui pl-3 text-sm text-secondary"><span className="sr-only">{zh ? "原文摘录：" : "Source quote: "}</span>{item.quote_preview}{item.quote_truncated ? "…" : ""}</blockquote> : null}
      {item.comment_preview ? <div className="mt-3 text-sm text-primary"><p className="mb-1 text-xs font-medium text-secondary">{zh ? "我的评论" : "My comment"}</p><p className="whitespace-pre-wrap break-words">{item.comment_preview}{item.comment_truncated ? "…" : ""}</p></div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-secondary"><span>{formatActivityTime(item.updated_at, resolvedLocale)}</span><Link className="inline-flex min-h-11 items-center font-medium text-accent" href={annotationHref(item)}>{item.anchor_status === "valid" || item.anchor_status === "remapped" ? (zh ? "定位原文与查看批注" : "Open source and annotation") : (zh ? "打开批注并检查" : "Open annotation for review")}</Link><button className="min-h-11 hover:text-accent" onClick={() => update({ conversation_id: item.conversation_id })}>{zh ? "只看此对话" : "Only this conversation"}</button></div>
    </article>)}</div> : inbox.isSuccess ? <div className="state-empty border-y border-ui text-sm text-secondary">{filtered ? (zh ? "没有符合筛选条件的批注，可清除筛选后重试。" : "No annotations match. Clear filters to see more.") : (zh ? "还没有批注。阅读时选择正文添加高亮、评论，或给消息添加书签。" : "No annotations yet. Select text while reading to highlight or comment, or bookmark a message.")}<Link className="mt-3 block text-accent" href="/recent">{zh ? "打开最近阅读" : "Open recent reading"}</Link></div> : null}
    {inbox.data ? <CollectionPagination offset={offset} limit={50} hasMore={inbox.data.has_more} busy={inbox.isFetching} zh={zh} update={update} /> : null}
  </section>;
}

function annotationHref(item: AnnotationInboxSummaryItem): string {
  const params = new URLSearchParams({ annotations: "open", annotationId: item.id });
  // An orphan can open its review workspace, not pretend to locate old coordinates.
  if (item.anchor_status === "valid" || item.anchor_status === "remapped") {
    if (item.message_id) params.set("messageId", item.message_id);
    if (item.message_version_id) params.set("messageVersionId", item.message_version_id);
    if (item.start_block_index !== null) params.set("blockIndex", String(item.start_block_index));
  }
  return `/conversations/${item.conversation_id}?${params}`;
}
