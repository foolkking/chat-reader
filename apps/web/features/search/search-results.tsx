"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { SearchResultItem } from "../../lib/types";
import { findSearchTextMatches } from "../../lib/search-text-matches";
import { usePreferences } from "../../components/preferences-provider";
import { searchResultHref } from "./search-result-target";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchConversations } from "../../lib/api";

export function orderSearchResults(items: SearchResultItem[]) { return [...items]; }

export function SearchResults({
  items,
  query,
  activeIndex = -1,
  onActiveIndexChange,
  selectedConversationIds,
  onConversationSelectionChange,
}: {
  items: SearchResultItem[];
  query: string;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  selectedConversationIds?: ReadonlySet<string>;
  onConversationSelectionChange?: (conversationId: string, selected: boolean) => void;
}) {
  const { resolvedLocale } = usePreferences();
  return <div className="divide-y divide-ui overflow-hidden rounded-xl border border-ui bg-surface">{items.map((item, index) => {
    const canSelectConversation = Boolean(item.conversation_id && onConversationSelectionChange);
    const selected = Boolean(item.conversation_id && selectedConversationIds?.has(item.conversation_id));
    return <div key={item.document_id} onMouseMove={(event) => {
      // Pagination can insert/reorder a row beneath a stationary pointer.
      // Boundary events are not a new selection intent; actual movement is.
      if (event.movementX !== 0 || event.movementY !== 0) onActiveIndexChange?.(index);
    }} className={`flex flex-wrap gap-2 px-3 py-4 hover:bg-subtle sm:gap-3 sm:px-5 ${activeIndex === index ? "bg-subtle" : ""}`}>
      {canSelectConversation ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={resolvedLocale === "zh-CN" ? (selected ? "取消选择对话" : "选择对话") : (selected ? "Deselect conversation" : "Select conversation")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onConversationSelectionChange?.(item.conversation_id, !selected)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-accent hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? "border-accent bg-[var(--accent-soft)]" : "border-ui"}`}>{selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}</span>
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <Link href={`/conversations/${item.conversation_id}`} className="block min-h-11 content-center break-words text-base font-semibold text-primary [overflow-wrap:anywhere] focus:ring-2 focus:ring-[var(--focus)]">{item.conversation_title}</Link>
        <p className="text-xs text-secondary">{item.project_name ?? (resolvedLocale === "zh-CN" ? "未归类" : "Unclassified")}{item.conversation_status === "archived" ? (resolvedLocale === "zh-CN" ? " · 已归档" : " · Archived") : ""}</p>
        <Link href={searchResultHref(item)} data-search-index={index} aria-current={activeIndex === index ? "true" : undefined} className="mt-2 block min-h-11 break-words text-sm leading-6 text-secondary underline-offset-2 [overflow-wrap:anywhere] hover:underline"><span className="mr-2 text-xs text-accent">{documentLabel(item.document_type, resolvedLocale)}{item.role ? ` · ${roleLabel(item.role, resolvedLocale)}` : ""}{item.attachment_display_name ? ` · ${item.attachment_display_name}` : ""}</span><Highlight text={clean(item.snippet)} query={item.matches?.[0]?.quote || query} /></Link>
        {(item.hit_count ?? 1) > 1 ? <ConversationHits item={item} query={query} /> : null}
      </div>
      {item.document_type === "message" && item.occurrence_count > 1 ? <DuplicateLocations item={item} query={query} /> : null}
    </div>;
  })}</div>;
}

function ConversationHits({ item, query }: { item: SearchResultItem; query: string }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const result = useQuery({
    queryKey: ["conversation-search-hits", item.conversation_id, query, params.toString(), offset],
    queryFn: ({ signal }) => searchConversations({ q: query, termsMode: true, conversationId: item.conversation_id, limit: 10, offset, signal,
      documentType: params.get("document_type") === "all" ? undefined : params.get("document_type") ?? undefined,
      role: params.get("role") === "all" ? undefined : params.get("role") ?? undefined,
      projectId: params.get("project_id") === "all" ? undefined : params.get("project_id") ?? undefined,
      tagId: params.get("tag_id") ?? undefined,
      statusScope: (params.get("status_scope") ?? "active") as "active" | "archived" | "all",
      dateFrom: params.get("date_from") ? new Date(`${params.get("date_from")}T00:00:00`).toISOString() : undefined,
      dateTo: params.get("date_to") ? new Date(`${params.get("date_to")}T23:59:59.999`).toISOString() : undefined,
    }), enabled: open,
  });
  return <div><button type="button" className="min-h-11 text-sm text-accent" aria-expanded={open} onClick={() => setOpen(value => !value)}>{zh ? `另有 ${(item.hit_count ?? 1) - 1} 条命中` : `${(item.hit_count ?? 1) - 1} more hits`}</button>
    {open ? <div className="border-l border-ui pl-3">{result.isPending ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : result.isError ? <button className="min-h-11 text-accent" onClick={() => void result.refetch()}>{zh ? "重新读取命中" : "Retry hits"}</button> : result.data?.items.filter(row => row.document_id !== item.document_id).map(row => <Link className="block min-h-11 py-2 text-sm text-secondary hover:underline" href={searchResultHref(row)} key={row.document_id}><span className="mr-2 text-accent">{documentLabel(row.document_type, zh ? "zh-CN" : "en-US")}</span><Highlight text={clean(row.snippet)} query={row.matches?.[0]?.quote || query} /></Link>)}
      <div className="flex gap-3">{offset ? <button className="min-h-11 text-sm text-accent" onClick={() => setOffset(value => value - 10)}>{zh ? "上一页" : "Previous"}</button> : null}{result.data?.has_more ? <button className="min-h-11 text-sm text-accent" onClick={() => setOffset(value => value + 10)}>{zh ? "下一页" : "Next"}</button> : null}</div>
    </div> : null}</div>;
}

function DuplicateLocations({ item, query }: { item: SearchResultItem; query: string }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const result = useQuery({
    queryKey: ["duplicate-locations", item.document_id, query, offset, params.toString()],
    queryFn: ({ signal }) => searchConversations({
      q: query, duplicateOf: item.document_id, offset, limit: 10, signal,
      statusScope: (params.get("status_scope") ?? "active") as "active" | "archived" | "all",
      projectId: params.get("project_id") === "all" ? undefined : params.get("project_id") ?? undefined,
      tagId: params.get("tag_id") ?? undefined,
      role: params.get("role") === "all" ? undefined : params.get("role") ?? undefined,
      dateFrom: params.get("date_from") ? new Date(`${params.get("date_from")}T00:00:00`).toISOString() : undefined,
      dateTo: params.get("date_to") ? new Date(`${params.get("date_to")}T23:59:59.999`).toISOString() : undefined,
    }),
    enabled: open,
  });
  return <div className="w-full min-w-0 text-sm">
    <button className="min-h-10 text-accent" aria-expanded={open} onClick={() => setOpen(value => !value)}>{zh ? "查看其他出处" : "Other locations"}</button>
    {open ? <div className="space-y-2">{result.isPending ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : result.error ? <button className="min-h-10 text-accent" onClick={() => void result.refetch()}>{zh ? "读取失败，重试" : "Retry loading"}</button> : <ul>{result.data?.items.map(row => <li key={row.document_id}><Link className="block min-h-10 break-words text-accent underline" href={searchResultHref(row)}>{row.conversation_title}</Link></li>)}</ul>}
      <div className="flex gap-3">{offset > 0 ? <button className="min-h-10 text-accent" onClick={() => setOffset(value => value - 10)}>{zh ? "上一页" : "Previous"}</button> : null}{result.data?.has_more ? <button className="min-h-10 text-accent" onClick={() => setOffset(value => value + 10)}>{zh ? "下一页" : "Next"}</button> : null}</div>
    </div> : null}
  </div>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const match = query ? findSearchTextMatches(text, query, null, null, 1)[0] : undefined;
  if (!match) return <>{text}</>;
  const codePoints = Array.from(text);
  return <>{codePoints.slice(0, match.match_start).join("")}<mark className="rounded-sm bg-[var(--mark-bg)] px-0.5 text-[var(--mark-text)]">{match.quote}</mark>{codePoints.slice(match.match_end).join("")}</>;
}
function clean(value: string): string { return value.replace(/^\s*(?:user|assistant|prompt|response)\s+/i, "").replace(/(^|\s)>\s*/g, "$1").replace(/\s+/g, " ").trim(); }
function documentLabel(value: string, locale: "zh-CN" | "en-US"): string { const labels: Record<string, [string, string]> = { conversation: ["标题", "Title"], message: ["正文", "Message"], heading: ["章节", "Section"], code: ["代码", "Code"], annotation: ["批注", "Annotation"], notebook: ["笔记", "Notebook"], description: ["简介", "Description"], attachment: ["附件", "Attachment"] }; const label = labels[value]; return label ? label[locale === "zh-CN" ? 0 : 1] : value; }

function roleLabel(value: string, locale: "zh-CN" | "en-US"): string { return value === "user" ? (locale === "zh-CN" ? "用户" : "User") : value === "assistant" ? "ChatGPT" : value; }
