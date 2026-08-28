"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NavigationResult, SearchResultItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { remoteReaderDataSource, type ReaderDataSource } from "../../lib/reader-data-source";

export type SearchNavigationTarget = {
  messageId: string;
  messageVersionId?: string | null;
  renderBlockId?: string | null;
  blockIndex?: number;
  characterOffset?: number;
  endCharacterOffset?: number;
  quote?: string;
  prefix?: string;
  suffix?: string;
};

export type ConversationSearchPanelState = {
  query: string;
  documentType: string;
  role: string;
  activeIndex: number;
};

export type SearchNavigationContext = {
  query: string;
  targets: SearchNavigationTarget[];
  index: number;
};

type SearchOccurrence = {
  item: SearchResultItem;
  target: SearchNavigationTarget;
  before: string;
  match: string;
  after: string;
};

export function ConversationSearchPanel({
  conversationId,
  dataSource = remoteReaderDataSource,
  sourceKey = "remote",
  onNavigate,
  onClose,
  showHeader = true,
  initialState,
  onStateChange,
}: {
  conversationId: string;
  dataSource?: ReaderDataSource;
  sourceKey?: string;
  onNavigate: (target: SearchNavigationTarget, context: SearchNavigationContext) => Promise<NavigationResult>;
  onClose: () => void;
  showHeader?: boolean;
  initialState?: ConversationSearchPanelState;
  onStateChange?: (state: ConversationSearchPanelState) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialState?.query ?? "");
  const [debounced, setDebounced] = useState(initialState?.query.trim() ?? "");
  const [activeIndex, setActiveIndex] = useState(initialState?.activeIndex ?? 0);
  const [documentType, setDocumentType] = useState(initialState?.documentType ?? "message");
  const [role, setRole] = useState(initialState?.role ?? "all");
  const zh = resolvedLocale === "zh-CN";

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    onStateChange?.({ query, documentType, role, activeIndex });
  }, [activeIndex, documentType, onStateChange, query, role]);

  const results = useQuery({
    queryKey: ["conversation-search", sourceKey, conversationId, debounced, documentType, role],
    queryFn: () => dataSource.searchConversation(conversationId, {
      query: debounced,
      documentType: documentType === "all" ? undefined : documentType,
      role: role === "all" ? undefined : role,
      limit: 50,
    }),
    enabled: debounced.length > 0,
  });
  const occurrences = useMemo(
    () => (results.data?.items ?? []).flatMap((item) => toOccurrences(item)),
    [results.data?.items],
  );
  const selectedIndex = Math.min(activeIndex, Math.max(0, occurrences.length - 1));

  const activate = async (index: number) => {
    const occurrence = occurrences[index];
    if (!occurrence) return;
    const context = {
      query: debounced,
      targets: occurrences.map((item) => item.target),
      index,
    };
    const result = await onNavigate(occurrence.target, context);
    if (result.ok) onClose();
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-raised">
      {showHeader ? <header className="flex items-center gap-2 border-b border-ui p-4"><Search className="h-4 w-4 text-secondary" /><h2 className="flex-1 text-base font-semibold text-primary">{zh ? "当前对话搜索" : "Search this conversation"}</h2><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></header> : null}
      <div className="border-b border-ui p-4">
        <label className="sr-only" htmlFor="conversation-search-input">{zh ? "搜索当前对话" : "Search this conversation"}</label>
        <input id="conversation-search-input" ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, occurrences.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); }
          if (event.key === "Enter") { event.preventDefault(); void activate(selectedIndex); }
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }} className="h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" placeholder={zh ? "搜索当前对话" : "Search this conversation"} />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="mr-auto text-xs text-secondary" role="status">{debounced && !results.isFetching ? (zh ? `${occurrences.length} 个结果` : `${occurrences.length} results`) : ""}</span>
          <label className="text-xs font-medium text-secondary">{zh ? "我 / ChatGPT" : "Role"}<select value={role} onChange={(event) => { setRole(event.target.value); setActiveIndex(0); }} className="ml-1 h-8 rounded-md border border-ui bg-surface px-2 text-sm text-primary"><option value="all">{zh ? "全部" : "All"}</option><option value="user">{zh ? "我" : "You"}</option><option value="assistant">ChatGPT</option></select></label>
          <label className="text-xs font-medium text-secondary">{zh ? "筛选" : "Filter"}<select value={documentType} onChange={(event) => { setDocumentType(event.target.value); setActiveIndex(0); }} className="ml-1 h-8 rounded-md border border-ui bg-surface px-2 text-sm text-primary"><option value="all">{zh ? "全部" : "All"}</option><option value="message">{zh ? "正文" : "Messages"}</option><option value="heading">{zh ? "章节" : "Sections"}</option><option value="code">{zh ? "代码" : "Code"}</option><option value="annotation">{zh ? "批注" : "Annotations"}</option></select></label>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!debounced ? <p className="p-4 text-sm text-secondary">{zh ? "输入关键词以搜索当前对话。" : "Enter a keyword to search this conversation."}</p> : null}
        {results.isFetching ? <p role="status" className="p-4 text-sm text-secondary">{zh ? "正在搜索..." : "Searching..."}</p> : null}
        {!results.isFetching && debounced && occurrences.length === 0 ? <div className="p-4 text-sm text-secondary"><p className="font-medium text-primary">{zh ? `没有找到“${debounced}”` : `No results for “${debounced}”`}</p><p className="mt-2">{zh ? "尝试使用更短的关键词或更改角色筛选。" : "Try a shorter keyword or a different role filter."}</p></div> : null}
        {occurrences.map((occurrence, index) => <button key={`${occurrence.item.document_id}-${index}`} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => void activate(index)} className={`block w-full border-b border-ui px-4 py-3 text-left ${selectedIndex === index ? "bg-subtle" : "hover:bg-subtle"}`}>
          <span className="block text-xs font-medium text-secondary">{roleLabel(occurrence.item.role, zh)}</span>
          <span className="mt-1 block text-sm leading-6 text-primary"><ContextSnippet before={occurrence.before} match={occurrence.match} after={occurrence.after} /></span>
          <span className="mt-1 block text-xs text-secondary">{documentTypeLabel(occurrence.item.document_type, zh)}{occurrence.item.occurrence_count > 1 ? ` · ${zh ? `第 ${index + 1} 个命中` : `Match ${index + 1}`}` : ""}</span>
        </button>)}
      </div>
    </div>
  );
}

function toOccurrences(item: SearchResultItem): SearchOccurrence[] {
  if (!item.message_id) return [];
  const matches = item.matches?.length ? item.matches : [{ block_index: item.block_index, match_start: item.character_offset ?? 0, match_end: (item.character_offset ?? 0) + item.snippet.length, quote: item.snippet, context_before: "", context_after: "" }];
  return matches.map((match) => ({
    item,
    target: {
      messageId: item.message_id as string,
      messageVersionId: item.message_version_id,
      renderBlockId: match.render_block_id ?? item.render_block_id,
      blockIndex: match.block_index ?? item.block_index ?? undefined,
      characterOffset: match.match_start,
      endCharacterOffset: match.match_end,
      quote: match.quote,
      prefix: match.context_before,
      suffix: match.context_after,
    },
    before: match.context_before,
    match: match.quote,
    after: match.context_after,
  }));
}

function ContextSnippet({ before, match, after }: { before: string; match: string; after: string }) {
  return <>{before ? `...${before}` : ""}<mark className="rounded-sm bg-[var(--accent-soft)] px-0.5 text-primary underline decoration-current">{match}</mark>{after}{after ? "..." : ""}</>;
}

function documentTypeLabel(value: string, zh: boolean) {
  const labels: Record<string, [string, string]> = { message: ["正文", "Message"], heading: ["章节", "Section"], code: ["代码", "Code"], annotation: ["批注", "Annotation"] };
  return labels[value]?.[zh ? 0 : 1] ?? value;
}

function roleLabel(value: string | null, zh: boolean) {
  return value === "user" ? (zh ? "我" : "You") : value === "assistant" ? "ChatGPT" : (zh ? "对话" : "Conversation");
}
