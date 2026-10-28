"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NavigationResult, SearchResultItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { remoteReaderDataSource, type ReaderDataSource } from "../../lib/reader-data-source";
import { assertOfflineAccess, captureOfflineAccess } from "../../lib/offline-access";
import { READER_SEARCH_CHANGED_EVENT, type ReaderSearchChange } from "../../lib/reader-search-cache";

export type SearchNavigationTarget = {
  messageId?: string;
  messageVersionId?: string | null;
  renderBlockId?: string | null;
  blockIndex?: number;
  characterOffset?: number;
  endCharacterOffset?: number;
  quote?: string;
  prefix?: string;
  suffix?: string;
  attachmentId?: string | null;
  annotationId?: string | null;
};

export type ConversationSearchPanelState = {
  query: string;
  documentType: string;
  role: string;
  activeIndex: number;
  activeOccurrenceKey?: string | null;
};

export type SearchNavigationContext = {
  query: string;
  targets: SearchNavigationTarget[];
  index: number;
};

type SearchOccurrence = {
  key: string;
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
  active = true,
  initialState,
  onStateChange,
  onPrepareRetry,
}: {
  conversationId: string;
  dataSource?: ReaderDataSource;
  sourceKey?: string;
  onNavigate: (target: SearchNavigationTarget, context: SearchNavigationContext, isCurrent?: () => boolean) => Promise<NavigationResult>;
  onClose: () => void;
  showHeader?: boolean;
  active?: boolean;
  initialState?: ConversationSearchPanelState;
  onStateChange?: (state: ConversationSearchPanelState) => void;
  onPrepareRetry?: () => Promise<void>;
}) {
  const { resolvedLocale } = usePreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialState?.query ?? "");
  const [debounced, setDebounced] = useState(initialState?.query.trim() ?? "");
  const [activeIndex, setActiveIndex] = useState(initialState?.activeIndex ?? 0);
  const [activeOccurrenceKey, setActiveOccurrenceKey] = useState(initialState?.activeOccurrenceKey ?? null);
  const [documentType, setDocumentType] = useState(initialState?.documentType ?? "message");
  const [role, setRole] = useState(initialState?.role ?? "all");
  const [contentEpoch, setContentEpoch] = useState(0);
  const zh = resolvedLocale === "zh-CN";
  // Retire intent on the raw input, before the debounced query can catch up.
  const navigationScope = useMemo(() => ({ active: false, sequence: 0, pendingKey: null as string | null }),
    [active, contentEpoch, conversationId, dataSource, documentType, query, role, sourceKey]);
  const [navigationFeedback, setNavigationFeedback] = useState<{
    scope: typeof navigationScope; pendingKey: string | null; failed: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    navigationScope.active = active;
    return () => {
      navigationScope.active = false;
      navigationScope.sequence++;
      navigationScope.pendingKey = null;
    };
  }, [active, navigationScope]);
  const retireNavigation = () => {
    navigationScope.active = false;
    navigationScope.sequence++;
    navigationScope.pendingKey = null;
  };
  const close = () => { retireNavigation(); onClose(); };
  const currentNavigation = active && navigationFeedback?.scope === navigationScope ? navigationFeedback : null;
  const searchScope = useMemo(() => ({}), [conversationId, dataSource, debounced, documentType, role, sourceKey]);
  const retryPreparation = useRef<{ scope: typeof searchScope; prepare: () => Promise<void> } | null>(null);
  if (retryPreparation.current && retryPreparation.current.scope !== searchScope) retryPreparation.current = null;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const onContentChanged = (event: Event) => {
      const detail = (event as CustomEvent<ReaderSearchChange>).detail;
      if (detail?.conversationId && detail.conversationId !== conversationId) return;
      if (detail?.mode && detail.mode !== dataSource.mode) return;
      navigationScope.active = false;
      navigationScope.sequence++;
      navigationScope.pendingKey = null;
      setContentEpoch((value) => value + 1);
    };
    window.addEventListener(READER_SEARCH_CHANGED_EVENT, onContentChanged);
    return () => window.removeEventListener(READER_SEARCH_CHANGED_EVENT, onContentChanged);
  }, [conversationId, dataSource.mode, navigationScope]);
  const results = useInfiniteQuery({
    queryKey: ["conversation-search", sourceKey, conversationId, debounced, documentType, role],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const access = dataSource.mode === "offline" ? captureOfflineAccess() : null;
      const preparation = retryPreparation.current;
      if (preparation?.scope === searchScope) {
        retryPreparation.current = null;
        await preparation.prepare();
      }
      if (access !== null) assertOfflineAccess(access);
      const response = await dataSource.searchConversation(conversationId, {
        query: debounced,
        documentType: documentType === "all" ? undefined : documentType,
        role: role === "all" ? undefined : role,
        limit: 50,
        offset: pageParam,
        signal,
      });
      if (access !== null) assertOfflineAccess(access);
      return response;
    },
    getNextPageParam: (lastPage) => {
      const hasMore = lastPage.has_more ?? lastPage.offset + lastPage.items.length < lastPage.total;
      if (!hasMore || lastPage.items.length === 0) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    enabled: debounced.length > 0,
    networkMode: dataSource.mode === "offline" ? "always" : undefined,
  });
  const currentResults = query.trim() === debounced;
  const occurrences = useMemo(
    () => (currentResults ? results.data?.pages.flatMap((page) => page.items) ?? [] : []).flatMap((item) => toOccurrences(item)),
    [currentResults, results.data?.pages],
  );
  const loadedDocumentCount = results.data?.pages.reduce((total, page) => total + page.items.length, 0) ?? 0;
  const lastResultPage = results.data?.pages.at(-1);
  const resultTotal = lastResultPage?.total ?? 0;
  const exactResultTotal = lastResultPage?.total_is_exact !== false;
  const hasMoreResults = results.hasNextPage;
  // A refresh may reorder documents or the matches within one document.
  // Never replace a deliberately selected occurrence with its old row number.
  const selectedIndex = activeOccurrenceKey === null
    ? (occurrences.length ? Math.max(0, Math.min(activeIndex, occurrences.length - 1)) : -1)
    : occurrences.findIndex((occurrence) => occurrence.key === activeOccurrenceKey);
  useEffect(() => {
    onStateChange?.({ query, documentType, role, activeIndex: selectedIndex >= 0 ? selectedIndex : activeIndex, activeOccurrenceKey });
  }, [activeIndex, activeOccurrenceKey, documentType, onStateChange, query, role, selectedIndex]);
  const selectIndex = (index: number) => {
    const occurrence = occurrences[index];
    if (!occurrence) return;
    setActiveIndex(index); setActiveOccurrenceKey(occurrence.key);
  };

  const activate = async (index: number) => {
    const occurrence = occurrences[index];
    if (!navigationScope.active || !occurrence || navigationScope.pendingKey === occurrence.key) return;
    const sequence = ++navigationScope.sequence;
    navigationScope.pendingKey = occurrence.key;
    const isCurrent = () => navigationScope.active && navigationScope.sequence === sequence;
    setNavigationFeedback({ scope: navigationScope, pendingKey: occurrence.key, failed: false });
    selectIndex(index);
    // Navigation may finish before another panel effect runs, especially on tap.
    onStateChange?.({ query, documentType, role, activeIndex: index, activeOccurrenceKey: occurrence.key });
    const context = {
      query: debounced,
      targets: occurrences.map((item) => item.target),
      index,
    };
    try {
      const result = await onNavigate(occurrence.target, context, isCurrent);
      if (!isCurrent()) return;
      if (result.ok) {
        setNavigationFeedback(null);
        // Switching to Files already closes/unmounts this mobile panel.
        // Calling onClose afterward would close the destination panel.
        if (!occurrence.target.attachmentId) close();
      }
      else if (result.reason !== "cancelled") {
        setNavigationFeedback({ scope: navigationScope, pendingKey: null, failed: true });
      }
    } catch {
      if (isCurrent()) setNavigationFeedback({ scope: navigationScope, pendingKey: null, failed: true });
    } finally {
      if (isCurrent()) {
        navigationScope.pendingKey = null;
        setNavigationFeedback((previous) => previous?.scope === navigationScope
          ? { ...previous, pendingKey: null } : previous);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-raised">
      {showHeader ? <header className="flex items-center gap-2 border-b border-ui p-4"><Search className="h-4 w-4 text-secondary" /><h2 className="flex-1 text-base font-semibold text-primary">{zh ? "当前对话搜索" : "Search this conversation"}</h2><button type="button" onClick={close} className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></header> : null}
      <div className="border-b border-ui p-4">
        <label className="sr-only" htmlFor="conversation-search-input">{zh ? "搜索当前对话" : "Search this conversation"}</label>
        <input id="conversation-search-input" ref={inputRef} value={query} onChange={(event) => { if (event.target.value !== query) retireNavigation(); setQuery(event.target.value); setActiveIndex(0); setActiveOccurrenceKey(null); }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown") { event.preventDefault(); selectIndex(Math.max(0, Math.min(selectedIndex + 1, occurrences.length - 1))); }
          if (event.key === "ArrowUp") { event.preventDefault(); selectIndex(Math.max(0, selectedIndex - 1)); }
          if (event.key === "Enter") { event.preventDefault(); void activate(selectedIndex); }
          if (event.key === "Escape") { event.preventDefault(); close(); }
        }} className="h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" placeholder={zh ? "搜索当前对话" : "Search this conversation"} />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="mr-auto text-xs text-secondary" role="status">{debounced && currentResults && results.data ? (zh
            ? `${exactResultTotal ? `已加载 ${loadedDocumentCount} / ${resultTotal} 条结果` : `已加载 ${loadedDocumentCount} 条结果${hasMoreResults ? "，仍有更多" : ""}`} · ${occurrences.length} 个定位项`
            : `${exactResultTotal ? `${loadedDocumentCount} of ${resultTotal} results loaded` : `${loadedDocumentCount} results loaded${hasMoreResults ? ", more available" : ""}`} · ${occurrences.length} locations`) : ""}</span>
          <label className="text-xs font-medium text-secondary">{zh ? "我 / ChatGPT" : "Role"}<select value={role} onChange={(event) => { if (event.target.value !== role) retireNavigation(); setRole(event.target.value); setActiveIndex(0); setActiveOccurrenceKey(null); }} className="ml-1 h-8 rounded-md border border-ui bg-surface px-2 text-sm text-primary"><option value="all">{zh ? "全部" : "All"}</option><option value="user">{zh ? "我" : "You"}</option><option value="assistant">ChatGPT</option></select></label>
         <label className="text-xs font-medium text-secondary">{zh ? "筛选" : "Filter"}<select value={documentType} onChange={(event) => { if (event.target.value !== documentType) retireNavigation(); setDocumentType(event.target.value); setActiveIndex(0); setActiveOccurrenceKey(null); }} className="ml-1 h-8 rounded-md border border-ui bg-surface px-2 text-sm text-primary"><option value="all">{zh ? "全部" : "All"}</option><option value="message">{zh ? "正文" : "Messages"}</option><option value="heading">{zh ? "章节" : "Sections"}</option><option value="code">{zh ? "代码" : "Code"}</option><option value="annotation">{zh ? "批注" : "Annotations"}</option><option value="attachment">{zh ? "附件" : "Attachments"}</option></select></label>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {currentNavigation?.pendingKey ? <p role="status" className="p-4 text-sm text-secondary">{zh ? "正在定位匹配…" : "Locating match…"}</p> : null}
        {currentNavigation?.failed ? <p role="alert" className="p-4 text-sm text-[var(--danger)]">{zh ? "暂时无法打开此匹配，请重试或选择其他结果。" : "Could not open this match. Try again or choose another result."}</p> : null}
        {!debounced ? <p className="p-4 text-sm text-secondary">{zh ? "输入关键词以搜索当前对话。" : "Enter a keyword to search this conversation."}</p> : null}
        {query.trim() && (!currentResults || results.isFetching) ? <p role="status" className="p-4 text-sm text-secondary">{zh ? "正在搜索..." : "Searching..."}</p> : null}
        {currentResults && !results.isError && !results.isFetching && debounced && occurrences.length === 0 ? <div className="p-4 text-sm text-secondary"><p className="font-medium text-primary">{zh ? `没有找到“${debounced}”` : `No results for “${debounced}”`}</p><p className="mt-2">{zh ? "尝试使用更短的关键词或更改角色筛选。" : "Try a shorter keyword or a different role filter."}</p></div> : null}
        {currentResults && results.isError ? <div role="alert" className="p-4 text-sm text-[var(--danger)]"><p>{zh ? "搜索暂不可用" : "Search unavailable"}</p><button type="button" disabled={results.isFetching} className="min-h-10 underline" onClick={() => {
          if (results.isFetching) return;
          if (onPrepareRetry) retryPreparation.current = { scope: searchScope, prepare: onPrepareRetry };
          void (results.isFetchNextPageError ? results.fetchNextPage() : results.refetch());
        }}>{zh ? "重试" : "Retry"}</button></div> : null}
        {currentResults && results.data && !results.isError && !results.isFetching && activeOccurrenceKey !== null && selectedIndex < 0 ? <p role="status" className="p-4 text-sm text-secondary">{zh ? "此前选中的匹配已不在当前结果中，请重新选择或修改搜索。" : "The selected match is no longer in these results. Choose a match or change the search."}</p> : null}
        {occurrences.map((occurrence, index) => <button key={`${occurrence.item.document_id}-${index}`} type="button" aria-busy={currentNavigation?.pendingKey === occurrence.key} onMouseEnter={() => selectIndex(index)} onClick={() => void activate(index)} className={`block w-full border-b border-ui px-4 py-3 text-left ${selectedIndex === index ? "bg-subtle" : "hover:bg-subtle"}`}>
          <span className="block text-xs font-medium text-secondary">{occurrence.item.document_type === "attachment"
            ? occurrence.item.attachment_display_name ?? documentTypeLabel("attachment", zh)
            : roleLabel(occurrence.item.role, zh)}</span>
          <span className="mt-1 block text-sm leading-6 text-primary">{occurrence.match
            ? <ContextSnippet before={occurrence.before} match={occurrence.match} after={occurrence.after} />
            : occurrence.item.snippet}</span>
          <span className="mt-1 block text-xs text-secondary">{documentTypeLabel(occurrence.item.document_type, zh)}{occurrence.item.occurrence_count > 1 ? ` · ${zh ? `第 ${index + 1} 个命中` : `Match ${index + 1}`}` : ""}{occurrence.item.matches_truncated ? ` · ${zh ? "匹配过多，仅显示前 100 个" : "More matches exist; showing the first 100"}` : ""}</span>
        </button>)}
        {currentResults && !results.isError && hasMoreResults ? <div className="p-4"><button type="button" className="btn-secondary min-h-11 w-full" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>{results.isFetchingNextPage ? (zh ? "正在加载更多…" : "Loading more…") : (zh ? "加载更多结果" : "Load more results")}</button></div> : null}
      </div>
    </div>
  );
}

function toOccurrences(item: SearchResultItem): SearchOccurrence[] {
  if (item.document_type === "attachment") {
    if (!item.attachment_id) return [];
    return [{
      key: JSON.stringify([item.document_id, item.attachment_id]),
      item,
      target: { attachmentId: item.attachment_id },
      before: "",
      match: "",
      after: "",
    }];
  }
  if (item.document_type === "annotation") {
    if (!item.annotation_id) return [];
    // Annotation text is a separate search surface; its saved anchor, not
    // comment/snippet text, owns the Reader position.
    return [{
      key: JSON.stringify([item.document_id, item.annotation_id, item.message_version_id ?? null]),
      item,
      target: {
        messageId: item.message_id ?? undefined,
        messageVersionId: item.message_version_id,
        blockIndex: item.block_index ?? undefined,
        characterOffset: item.character_offset ?? undefined,
        annotationId: item.annotation_id,
      },
      before: item.snippet,
      match: "",
      after: "",
    }];
  }
  if (!item.message_id) return [];
  const matches = item.matches?.length ? item.matches : null;
  if (!matches) {
    // Older/offline projections may not contain canonical block matches.
    // Keep the message searchable without inventing an offset from its snippet.
    return [{
      key: JSON.stringify([item.document_id, item.message_id, item.message_version_id ?? null, "message-only"]),
      item,
      target: { messageId: item.message_id, messageVersionId: item.message_version_id },
      before: item.snippet,
      match: "",
      after: "",
    }];
  }
  return matches.map((match) => ({
    key: JSON.stringify([item.document_id, item.message_id, item.message_version_id ?? null,
      match.render_block_id ?? item.render_block_id ?? null, match.block_index ?? item.block_index,
      match.match_start, match.match_end, match.quote]),
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
  const labels: Record<string, [string, string]> = { message: ["正文", "Message"], heading: ["章节", "Section"], code: ["代码", "Code"], annotation: ["批注", "Annotation"], attachment: ["附件", "Attachment"] };
  return labels[value]?.[zh ? 0 : 1] ?? value;
}

function roleLabel(value: string | null, zh: boolean) {
  return value === "user" ? (zh ? "我" : "You") : value === "assistant" ? "ChatGPT" : (zh ? "对话" : "Conversation");
}
