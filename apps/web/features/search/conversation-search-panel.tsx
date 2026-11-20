"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, List, Search, SlidersHorizontal, X } from "lucide-react";
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
  continueAfterKey?: string;
};

export type SearchNavigationContext = {
  query: string;
  targets: SearchNavigationTarget[];
  index: number;
  occurrenceKeys?: string[];
  hasMore?: boolean;
};

type SearchOccurrence = {
  key: string;
  matchNumber?: number;
  item: SearchResultItem;
  target: SearchNavigationTarget;
  before: string;
  match: string;
  after: string;
};

const OCCURRENCES_PER_VIEW = 50;

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
  externalResultHref,
  onOpenExternal,
  compact = false,
  bodyOnly = false,
}: {
  conversationId: string;
  dataSource?: Pick<ReaderDataSource, "mode" | "searchConversation">;
  sourceKey?: string;
  onNavigate: (target: SearchNavigationTarget, context: SearchNavigationContext, isCurrent?: () => boolean) => Promise<NavigationResult>;
  onClose: () => void;
  showHeader?: boolean;
  active?: boolean;
  initialState?: ConversationSearchPanelState;
  onStateChange?: (state: ConversationSearchPanelState) => void;
  onPrepareRetry?: () => Promise<void>;
  externalResultHref?: (target: SearchNavigationTarget) => string | undefined;
  onOpenExternal?: (href: string) => void;
  compact?: boolean;
  bodyOnly?: boolean;
}) {
  const { resolvedLocale } = usePreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const revealSelection = useRef(Boolean(initialState?.activeOccurrenceKey));
  const continueAfter = useRef(initialState?.continueAfterKey);
  const pagingIntent = useRef(0);
  const autoActivate = useRef<{ key: string; scope: object } | null>(null);
  const allowHover = useRef(true);
  const inputId = `conversation-search-input-${sourceKey}-${conversationId}`;
  const [query, setQuery] = useState(initialState?.query ?? "");
  const [debounced, setDebounced] = useState(initialState?.query.trim() ?? "");
  const [activeIndex, setActiveIndex] = useState(initialState?.activeIndex ?? 0);
  const [activeOccurrenceKey, setActiveOccurrenceKey] = useState(initialState?.activeOccurrenceKey ?? null);
  const [documentType, setDocumentType] = useState(initialState?.documentType ?? "message");
  const [role, setRole] = useState(initialState?.role ?? "all");
  const [composing, setComposing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(!compact);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showDetails = !compact || detailsOpen;
  const [contentEpoch, setContentEpoch] = useState(0);
  const zh = resolvedLocale === "zh-CN";
  // Retire intent on the raw input, before the debounced query can catch up.
  const navigationScope = useMemo(() => ({ active: false, sequence: 0, pendingKey: null as string | null }),
    [active, composing, contentEpoch, conversationId, dataSource, documentType, query, role, sourceKey]);
  const [navigationFeedback, setNavigationFeedback] = useState<{
    scope: typeof navigationScope; pendingKey: string | null; failed: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    navigationScope.active = active && !composing;
    return () => {
      navigationScope.active = false;
      navigationScope.sequence++;
      navigationScope.pendingKey = null;
    };
  }, [active, composing, navigationScope]);
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

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query, composing]);
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
    initialPageParam: 0 as number | { offset: number; candidateOffset?: number; matchOffset?: number; matchDocumentId?: string },
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
        offset: typeof pageParam === "number" ? pageParam : pageParam.offset,
        ...(typeof pageParam === "number" ? {} : { candidateOffset: pageParam.candidateOffset }),
        ...(typeof pageParam === "number" ? {} : { matchOffset: pageParam.matchOffset, matchDocumentId: pageParam.matchDocumentId }),
        signal,
      });
      if (access !== null) assertOfflineAccess(access);
      return response;
    },
    getNextPageParam: (lastPage) => {
      const hasMore = lastPage.has_more ?? lastPage.offset + lastPage.items.length < lastPage.total;
      if (!hasMore || lastPage.items.length === 0) return undefined;
      if (lastPage.next_offset != null) return {
        offset: lastPage.next_offset, candidateOffset: lastPage.nextCandidateOffset,
        matchOffset: lastPage.next_match_offset ?? 0, matchDocumentId: lastPage.next_document_id ?? undefined,
      };
      if (lastPage.nextCandidateOffset !== undefined) return {
        offset: lastPage.offset + lastPage.items.length, candidateOffset: lastPage.nextCandidateOffset,
      };
      return lastPage.offset + lastPage.limit;
    },
    enabled: active && !composing && debounced.length > 0,
    networkMode: dataSource.mode === "offline" ? "always" : undefined,
    ...(bodyOnly ? { staleTime: 0, gcTime: 0, retry: false } : {}),
  });
  const currentResults = !composing && query.trim() === debounced;
  const occurrences = useMemo(
    () => (currentResults && !(bodyOnly && results.isError) ? results.data?.pages.flatMap((page) => page.items) ?? [] : []).flatMap((item) => toOccurrences(item)),
    [bodyOnly, currentResults, results.isError, results.data?.pages],
  );
  const hasMoreResults = results.hasNextPage;
  // A refresh may reorder documents or the matches within one document.
  // Never replace a deliberately selected occurrence with its old row number.
  const selectedIndex = activeOccurrenceKey === null
    ? (occurrences.length ? Math.max(0, Math.min(activeIndex, occurrences.length - 1)) : -1)
    : occurrences.findIndex((occurrence) => occurrence.key === activeOccurrenceKey);
  const visibleStart = Math.floor(Math.max(0, selectedIndex) / OCCURRENCES_PER_VIEW) * OCCURRENCES_PER_VIEW;
  const visibleEnd = Math.min(occurrences.length, visibleStart + OCCURRENCES_PER_VIEW);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!active || !revealSelection.current || !list || selectedIndex < 0) return;
    const row = list.querySelector<HTMLElement>(`[data-find-index="${selectedIndex}"]`);
    if (!row) return;
    // Scroll only the results pane. Element.scrollIntoView can move the
    // underlying Reader or the mobile sheet while the user is choosing a hit.
    const item = row.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += Math.min(item.top - bounds.top, item.bottom - bounds.bottom);
    revealSelection.current = false;
  }, [active, occurrences, selectedIndex]);
  useEffect(() => {
    onStateChange?.({ query, documentType, role, activeIndex: selectedIndex >= 0 ? selectedIndex : activeIndex, activeOccurrenceKey });
  }, [activeIndex, activeOccurrenceKey, documentType, onStateChange, query, role, selectedIndex]);
  const selectIndex = (index: number) => {
    const occurrence = occurrences[index];
    if (!occurrence) return;
    pagingIntent.current++;
    setActiveIndex(index); setActiveOccurrenceKey(occurrence.key);
  };
  const showFollowing = async (afterKey?: string, navigate = false) => {
    if (!currentResults || results.isFetchingNextPage || !hasMoreResults || !navigationScope.active) return;
    const intent = ++pagingIntent.current;
    const page = await results.fetchNextPage({ cancelRefetch: false });
    if (!page?.data || page.isError || !navigationScope.active || pagingIntent.current !== intent) return;
    const rows = page.data.pages.flatMap(p => p.items.flatMap(toOccurrences));
    const previous = afterKey ? rows.findIndex(row => row.key === afterKey) : -1;
    if (afterKey && previous < 0) return; // Content changed, never substitute a new row by its old index.
    const next = rows[previous + 1];
    if (!next) return;
    revealSelection.current = true;
    if (navigate) autoActivate.current = { key: next.key, scope: navigationScope };
    setActiveIndex(previous + 1); setActiveOccurrenceKey(next.key);
  };
  useEffect(() => {
    const key = continueAfter.current;
    if (!key || !active || !currentResults || !results.data || results.isFetching) return;
    continueAfter.current = undefined;
    if (key !== activeOccurrenceKey || selectedIndex < 0) return;
    if (selectedIndex + 1 < occurrences.length) {
      revealSelection.current = true; selectIndex(selectedIndex + 1);
    } else void showFollowing(key);
  });

  const activate = async (index: number) => {
    const occurrence = occurrences[index];
    if (!navigationScope.active || !occurrence || navigationScope.pendingKey === occurrence.key) return;
    const external = externalResultHref?.(occurrence.target);
    if (external) { onOpenExternal?.(external); return; }
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
      occurrenceKeys: occurrences.map((item) => item.key),
      hasMore: Boolean(hasMoreResults),
      index,
    };
    try {
      const result = await onNavigate(occurrence.target, context, isCurrent);
      if (!isCurrent()) return;
      if (result.ok) {
        setNavigationFeedback(null);
        // Switching to Files already closes/unmounts this mobile panel.
        // Calling onClose afterward would close the destination panel.
        if (!occurrence.target.attachmentId && !compact) close();
        if (compact) { setDetailsOpen(false); inputRef.current?.blur(); }
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

  useEffect(() => {
    const pending = autoActivate.current;
    if (!pending || pending.scope !== navigationScope || !navigationScope.active) return;
    const index = occurrences.findIndex(hit => hit.key === pending.key);
    if (index < 0) return;
    autoActivate.current = null;
    void activate(index);
  });
  const nextMatch = () => {
    if (activeOccurrenceKey === null) { void activate(0); return; }
    if (selectedIndex + 1 < occurrences.length) void activate(selectedIndex + 1);
    else if (hasMoreResults) void showFollowing(occurrences[selectedIndex]?.key, true);
  };
  const countLabel = currentResults && results.data && !results.isError
    ? `${selectedIndex >= 0 && activeOccurrenceKey !== null ? selectedIndex + 1 : 0} / ${occurrences.length}${hasMoreResults ? "+" : ""}` : "";

  return (
    <div data-testid="conversation-find" data-reader-find={compact ? "compact" : "panel"} className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-raised ${compact ? "max-h-[55dvh]" : "h-full flex-1"}`}>
      {showHeader ? <header className="flex items-center gap-2 border-b border-ui p-4"><Search className="h-4 w-4 text-secondary" /><h2 className="flex-1 text-base font-semibold text-primary">{zh ? "当前对话搜索" : "Search this conversation"}</h2><button type="button" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></header> : null}
      <div className={compact ? "border-b border-ui px-2 py-1" : "border-b border-ui p-4"}>
        <div className="flex items-center gap-1">
        <label className="sr-only" htmlFor={inputId}>{zh ? "搜索当前对话" : "Search this conversation"}</label>
        <input id={inputId} ref={inputRef} aria-describedby={showDetails && selectedIndex >= 0 ? `${inputId}-hit-${selectedIndex}` : undefined} value={query} onCompositionStart={() => { retireNavigation(); setComposing(true); }} onCompositionEnd={() => setComposing(false)} maxLength={500} onChange={(event) => { if (event.target.value !== query) retireNavigation(); setQuery(event.target.value); setActiveIndex(0); setActiveOccurrenceKey(null); }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown") {
            event.preventDefault(); allowHover.current = false; revealSelection.current = true;
            if (selectedIndex >= 0 && selectedIndex === occurrences.length - 1 && hasMoreResults) void showFollowing(occurrences[selectedIndex].key);
            else selectIndex(Math.max(0, Math.min(selectedIndex + 1, occurrences.length - 1)));
          }
          if (event.key === "ArrowUp") { event.preventDefault(); allowHover.current = false; revealSelection.current = true; selectIndex(Math.max(0, selectedIndex - 1)); }
          if (event.key === "Enter") { event.preventDefault(); void activate(selectedIndex); }
          if (event.key === "Escape") { event.preventDefault(); close(); }
        }} className="h-11 min-w-0 flex-1 rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" placeholder={zh ? "搜索当前对话" : "Search this conversation"} />
          {compact ? <>
            <button type="button" aria-label={zh ? "上一个匹配" : "Previous match"} disabled={!currentResults || selectedIndex <= 0 || Boolean(currentNavigation?.pendingKey)} className="h-11 w-11 shrink-0 rounded-md hover:bg-subtle disabled:opacity-40" onClick={() => void activate(selectedIndex - 1)}><ChevronUp className="mx-auto h-4 w-4" /></button>
            <button type="button" aria-label={zh ? "下一个匹配" : "Next match"} disabled={!currentResults || !occurrences.length || (activeOccurrenceKey !== null && selectedIndex === occurrences.length - 1 && !hasMoreResults) || Boolean(currentNavigation?.pendingKey) || results.isFetchingNextPage} className="h-11 w-11 shrink-0 rounded-md hover:bg-subtle disabled:opacity-40" onClick={nextMatch}><ChevronDown className="mx-auto h-4 w-4" /></button>
            <button type="button" aria-label={zh ? "关闭查找" : "Close find"} className="h-11 w-11 shrink-0 rounded-md hover:bg-subtle" onClick={close}><X className="mx-auto h-4 w-4" /></button>
          </> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs text-secondary">
          <span role="status" className="mr-auto">{query.trim() && (!currentResults || results.isFetching) ? (zh ? "正在查找…" : "Finding…") : countLabel ? `${countLabel} ${zh ? "处匹配" : "matches"}` : ""}</span>
          {compact ? <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 hover:bg-subtle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}><List className="h-4 w-4" />{zh ? "结果" : "Results"}</button> : null}
          <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 hover:bg-subtle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal className="h-4 w-4" />{zh ? "筛选" : "Filters"}{role !== "all" || documentType !== "message" ? ` · ${Number(role !== "all") + Number(documentType !== "message")}` : ""}</button>
        </div>
        {filtersOpen ? <div className="flex flex-wrap gap-2 py-1">
          <label className="text-xs text-secondary">{zh ? "角色" : "Role"}<select value={role} onChange={event => { retireNavigation(); setRole(event.target.value); setActiveIndex(0); setActiveOccurrenceKey(null); }} className="ml-1 min-h-11 rounded-md border border-ui bg-surface px-2 text-sm text-primary"><option value="all">{zh ? "全部" : "All"}</option><option value="user">{zh ? "我" : "You"}</option><option value="assistant">ChatGPT</option></select></label>
          <label className="text-xs text-secondary">{zh ? "内容" : "Content"}<select value={documentType} onChange={event => { retireNavigation(); setDocumentType(event.target.value); setActiveIndex(0); setActiveOccurrenceKey(null); }} className="ml-1 min-h-11 rounded-md border border-ui bg-surface px-2 text-sm text-primary">{!bodyOnly ? <option value="all">{zh ? "全部" : "All"}</option> : null}<option value="message">{zh ? "正文" : "Messages"}</option><option value="heading">{zh ? "章节" : "Sections"}</option><option value="code">{zh ? "代码" : "Code"}</option>{!bodyOnly ? <><option value="annotation">{zh ? "批注" : "Annotations"}</option><option value="attachment">{zh ? "附件" : "Attachments"}</option></> : null}</select></label>
        </div> : null}
        {compact && currentNavigation?.failed ? <p role="alert" className="py-2 text-xs text-[var(--danger)]">{zh ? "未能定位，阅读位置已保留。请重试或展开结果。" : "Could not locate this match. Your place is retained; retry or open results."}</p> : null}
        {compact && currentResults && results.isError ? <button type="button" className="min-h-11 text-sm text-[var(--danger)] underline" onClick={() => { setDetailsOpen(true); void results.refetch(); }}>{zh ? "查找失败，重试" : "Find failed. Retry"}</button> : null}
      </div>
      {showDetails && currentResults && !(bodyOnly && results.isError) && results.data ? <p className="px-4 py-2 text-xs text-secondary">{zh ? `已加载 ${new Set(results.data.pages.flatMap(page => page.items.map(item => item.document_id))).size} 条正文结果${hasMoreResults ? "，还有更多" : ""}` : `${new Set(results.data.pages.flatMap(page => page.items.map(item => item.document_id))).size} results loaded${hasMoreResults ? "; more available" : ""}`}{results.data.pages.some(page => page.items.some(item => item.matches_truncated)) ? (zh ? "；长消息每批前 100 处，可继续加载" : "; first 100 matches per batch in long messages; continue to load the rest") : ""}</p> : null}
      <div ref={listRef} hidden={!showDetails} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onPointerMove={event => {
        if (event.pointerType !== "mouse" || allowHover.current || (!event.movementX && !event.movementY)) return;
        allowHover.current = true;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-find-index]");
        if (row) selectIndex(Number(row.dataset.findIndex));
      }}>
        {currentNavigation?.pendingKey ? <p role="status" className="p-4 text-sm text-secondary">{zh ? "正在定位匹配…" : "Locating match…"}</p> : null}
        {currentNavigation?.failed ? <p role="alert" className="p-4 text-sm text-[var(--danger)]">{zh ? "暂时无法打开此匹配，请重试或选择其他结果。" : "Could not open this match. Try again or choose another result."}</p> : null}
        {!query.trim() ? <p className="p-4 text-sm text-secondary">{zh ? "输入关键词以搜索当前对话。" : "Enter a keyword to search this conversation."}</p> : null}
        {query.trim() && (!currentResults || results.isFetching) ? <p role="status" className="p-4 text-sm text-secondary">{zh ? "正在搜索..." : "Searching..."}</p> : null}
        {currentResults && !results.isError && !results.isFetching && debounced && occurrences.length === 0 ? <div className="p-4 text-sm text-secondary"><p className="font-medium text-primary">{zh ? `没有找到“${debounced}”` : `No results for “${debounced}”`}</p><p className="mt-2">{zh ? "尝试使用更短的关键词或更改角色筛选。" : "Try a shorter keyword or a different role filter."}</p></div> : null}
        {currentResults && results.isError ? <div role="alert" className="p-4 text-sm text-[var(--danger)]"><p>{zh ? "搜索暂不可用" : "Search unavailable"}</p><button type="button" disabled={results.isFetching} className="min-h-10 underline" onClick={() => {
          if (results.isFetching) return;
          if (onPrepareRetry) retryPreparation.current = { scope: searchScope, prepare: onPrepareRetry };
          void (results.isFetchNextPageError ? results.fetchNextPage() : results.refetch());
        }}>{zh ? "重试" : "Retry"}</button></div> : null}
        {currentResults && results.data && !results.isError && !results.isFetching && activeOccurrenceKey !== null && selectedIndex < 0 ? <p role="status" className="p-4 text-sm text-secondary">{zh ? "此前选中的匹配已不在当前结果中，请重新选择或修改搜索。" : "The selected match is no longer in these results. Choose a match or change the search."}</p> : null}
        {visibleStart > 0 ? <button type="button" className="btn-secondary m-2 min-h-11" onClick={() => {
          inputRef.current?.focus({ preventScroll: true }); allowHover.current = false; revealSelection.current = true; selectIndex(visibleStart - 1);
        }}>{zh ? "上一组匹配" : "Previous matches"}</button> : null}
        {occurrences.slice(visibleStart, visibleEnd).map((occurrence, offset) => {
          const index = visibleStart + offset;
          const href = externalResultHref?.(occurrence.target);
          const content = <>
          <span className="block text-xs font-medium text-secondary">{occurrence.item.document_type === "attachment"
            ? occurrence.item.attachment_display_name ?? documentTypeLabel("attachment", zh)
            : roleLabel(occurrence.item.role, zh)}</span>
          <span className="mt-1 block text-sm leading-6 text-primary [overflow-wrap:anywhere]">{occurrence.match
            ? <ContextSnippet before={occurrence.before} match={occurrence.match} after={occurrence.after} />
            : occurrence.item.snippet}</span>
          <span className="mt-1 block text-xs text-secondary">{documentTypeLabel(occurrence.item.document_type, zh)}</span>
          {href ? <span className="mt-1 block text-xs text-accent">{zh ? "在完整阅读页查看此结果" : "View this result in the full reader"}</span> : null}
          </>;
          const className = `block w-full border-b border-ui px-4 py-3 text-left ${selectedIndex === index ? "bg-subtle" : "hover:bg-subtle"}`;
          return href ? <a key={occurrence.key} id={`${inputId}-hit-${index}`} data-find-index={index} aria-current={selectedIndex === index || undefined} href={href} className={className} onMouseEnter={() => { if (allowHover.current) selectIndex(index); }}
            onClick={event => { if (onOpenExternal && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenExternal(href); } }}>{content}</a>
            : <button key={occurrence.key} id={`${inputId}-hit-${index}`} data-find-index={index} aria-current={selectedIndex === index || undefined} type="button" aria-busy={currentNavigation?.pendingKey === occurrence.key} onMouseEnter={() => { if (allowHover.current) selectIndex(index); }} onClick={() => void activate(index)} className={className}>{content}</button>;
        })}
        {visibleEnd < occurrences.length ? <button type="button" className="btn-secondary m-2 min-h-11" onClick={() => {
          inputRef.current?.focus({ preventScroll: true }); allowHover.current = false; revealSelection.current = true; selectIndex(visibleEnd);
        }}>{zh ? "下一组匹配" : "More matches"}</button> : currentResults && !results.isError && hasMoreResults ? <div className="p-4"><button type="button" className="btn-secondary min-h-11 w-full" disabled={results.isFetchingNextPage} onClick={() => {
          inputRef.current?.focus({ preventScroll: true }); allowHover.current = false; void showFollowing(occurrences.at(-1)?.key);
        }}>{results.isFetchingNextPage ? (zh ? "正在加载更多…" : "Loading more…") : (zh ? "加载更多结果" : "Load more results")}</button></div> : null}
      </div>
    </div>
  );
}

function toOccurrences(item: SearchResultItem): SearchOccurrence[] {
  // A reindex issues fresh SearchDocument IDs even for untouched messages.
  // Persist the destination, not that disposable index row. A new version or
  // changed range still invalidates the choice rather than opening a neighbor.
  const scope = [item.conversation_id, item.document_type];
  if (item.document_type === "attachment") {
    if (!item.attachment_id) return [];
    return [{
      key: JSON.stringify([...scope, item.attachment_id]),
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
      key: JSON.stringify([...scope, item.annotation_id, item.message_version_id ?? null]),
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
      key: JSON.stringify([...scope, item.message_id, item.message_version_id ?? null, "message-only",
        item.document_type === "message" ? null : item.render_block_id ?? item.block_index ?? item.document_id]),
      item,
      target: { messageId: item.message_id, messageVersionId: item.message_version_id },
      before: item.snippet,
      match: "",
      after: "",
    }];
  }
  return matches.map((match, index) => ({
    matchNumber: index + 1,
    key: JSON.stringify([...scope, item.message_id, item.message_version_id ?? null,
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
