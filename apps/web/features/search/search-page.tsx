"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { archiveConversation, getProjects, getUserFeatureEntries, searchConversations } from "../../lib/api";
import type { SearchResultItem, SavedSearchValue, ConversationTagValue } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { ProjectSidebar } from "../projects/project-sidebar";
import { SearchBox } from "./search-box";
import { orderSearchResults, SearchResults } from "./search-results";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { useWorkspaceShell } from "../../components/workspace-shell";
import { searchResultHref } from "./search-result-target";
import { SavedSearchesPanel } from "./saved-searches-panel";
import { runBatchSelection, type BatchSelectionResult } from "../../lib/batch-selection";
import { buildSearchReadingQueue, sanitizeSearchReturnHref, searchReadingQueueStorageKey, withSearchReadingQueue } from "./search-reading-queue";
import { getCurrentOfflineRuntimeUserId } from "../../lib/auth-client";
import { collectSearchPages } from "./search-pages";
import { activeSearchFilter } from "./search-filter-state";
import { authenticationGeneration } from "../../lib/offline-access";
import type { SearchReturnState, SearchDisclosure } from "./search-return-state";

const PAGE_SIZE = 50;

export function SearchPage() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  return <SearchWorkspace filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen} />;
}

function SearchWorkspace({ filtersOpen, setFiltersOpen }: { filtersOpen: boolean; setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const router = useRouter();
  const params = useSearchParams();
  const { resolvedLocale, projectSortMode = "custom", projectSortDirection = "asc" } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const workspace = useWorkspaceShell();
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const query = params?.get("q") ?? "";
  const sort = (params?.get("sort") ?? "relevance") as "relevance" | "content_updated" | "imported";
  const documentType = params?.get("document_type") ?? "all";
  const role = params?.get("role") ?? "all";
  const projectId = params?.get("project_id") ?? "all";
  const statusScope = params?.get("status_scope") ?? "active";
  const dateFrom = params?.get("date_from") ?? "";
  const dateTo = params?.get("date_to") ?? "";
  const tagId = params?.get("tag_id") ?? "";
  const [searchEpoch, setSearchEpoch] = useState(0);
  const searchEpochRef = useRef(0);
  const queryScope = JSON.stringify([query, sort, documentType, role, projectId, statusScope, dateFrom, dateTo, tagId]);
  const scope = JSON.stringify([queryScope, searchEpoch]);
  const queryClient = useQueryClient();
  const returnKey = ["search-return", authenticationGeneration(), getCurrentOfflineRuntimeUserId(), queryScope];
  const [returnState] = useState(() => queryClient.getQueryData<SearchReturnState>(returnKey));
  const returnScope = useRef(scope);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [disclosureState, setDisclosureState] = useState({ scope, values: returnState?.disclosures ?? {} as Record<string, SearchDisclosure> });
  const disclosures = disclosureState.scope === scope ? disclosureState.values : {};
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const restartSearch = (remainingIds: string[] = []) => {
    const next = ++searchEpochRef.current;
    setSearchEpoch(next);
    setConversationSelection({ scope: JSON.stringify([queryScope, next]), ids: remainingIds });
  };
  const tags = useQuery({ queryKey: ["user-feature-entries", "conversation-tag"], queryFn: ({ signal }) => getUserFeatureEntries<ConversationTagValue>("conversation-tag", signal) });
  const [paging, setPaging] = useState({ scope, offset: returnState?.offset ?? 0 });
  const offset = paging.scope === scope ? paging.offset : 0;
  const [collection, setCollection] = useState<{ scope: string; pages: Record<number, SearchResultItem[]> }>({ scope, pages: returnState?.pages ?? {} });
  const items = useMemo(() => collection.scope === scope ? collectSearchPages(collection.pages) : [], [collection, scope]);
  const [selection, setSelection] = useState<{ scope: string; documentId: string | null }>({ scope, documentId: returnState?.documentId ?? null });
  const [conversationSelection, setConversationSelection] = useState<{ scope: string; ids: string[] }>({ scope, ids: returnState?.selectedIds ?? [] });
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const orderedItems = orderSearchResults(items);
  const readingQueueCandidate = buildSearchReadingQueue(orderedItems, searchResultHref);
  const loadedConversationIds = new Set(items.map(item => item.conversation_id));
  const selectedConversationIds = new Set((conversationSelection.scope === scope ? conversationSelection.ids : [])
    .filter(id => loadedConversationIds.has(id)));
  const activeIndex = selection.scope === scope
    ? orderedItems.findIndex((item) => item.document_id === selection.documentId) : -1;
  const rememberResults = () => queryClient.setQueryData<SearchReturnState>(returnKey, {
    pages: collection.scope === scope ? collection.pages : {},
    offset, documentId: selection.scope === scope ? selection.documentId : null,
    selectedIds: [...selectedConversationIds], disclosures,
    scrollTop: scrollRef.current?.scrollTop ?? 0,
  });
  useLayoutEffect(() => {
    if (returnState && returnScope.current === scope && scrollRef.current) {
      scrollRef.current.scrollTop = returnState.scrollTop;
    }
    // Restore only the initial layout, never after a user's subsequent gesture.
  }, []);
  const invalidDates = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const activeFilters = Object.entries({ document_type: documentType, role, project_id: projectId, status_scope: statusScope, date_from: dateFrom, date_to: dateTo, tag_id: tagId }).filter(([key, value]) => activeSearchFilter(key, value));
  const filterCount = activeFilters.length;
  const result = useQuery({
    queryKey: ["search", query, sort, documentType, role, projectId, statusScope, dateFrom, dateTo, tagId, searchEpoch, offset],
    queryFn: ({ signal }) => searchConversations({
      signal,
      grouped: true, sort, q: query, tagId: tagId || undefined,
      limit: PAGE_SIZE,
      offset,
      documentType: documentType === "all" ? undefined : documentType,
      role: role === "all" ? undefined : role,
      projectId: projectId === "all" ? undefined : projectId,
      statusScope: statusScope as "active" | "archived" | "all",
      dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
    }),
    enabled: query.trim().length > 0 && !invalidDates,
  });
  const projects = useQuery({ queryKey: ["projects", projectSortMode, projectSortDirection], queryFn: () => getProjects({ sort: projectSortMode, direction: projectSortDirection }) });
  useEffect(() => {
    setSelection((current) => current.scope !== scope || (current.documentId !== null && !items.some((item) => item.document_id === current.documentId))
      ? { scope, documentId: null } : current);
    setConversationSelection((current) => current.scope === scope ? current : { scope, ids: [] });
  }, [items, scope]);
  useEffect(() => setBatchNotice(null), [queryScope]);
  useEffect(() => {
    if (!result.data) return;
    setCollection((current) => {
      const pages = offset === 0 || current.scope !== scope ? {} : { ...current.pages };
      // A refreshed page replaces its old members and snippets, not just new IDs.
      return { scope, pages: { ...pages, [offset]: result.data.items } };
    });
  }, [offset, result.data, scope]);
  const update = (changes: Record<string, string>) => {
    // Compose rapid edits from the synchronous URL, not a pending router render.
    // Next's native History integration keeps useSearchParams and Back in sync.
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value && (key === "q" || (key === "status_scope" ? value !== "active" : value !== "all"))) next.set(key, value);
      else next.delete(key);
    }
    window.history.pushState(null, "", `/search${next.size ? `?${next}` : ""}`);
  };
  const total = result.data?.total ?? items.length;
  const openSelected = () => {
    const item = orderedItems[activeIndex];
    if (!item) return;
    rememberResults();
    router.push(searchResultHref(item));
  };
  const startContinuousReading = () => {
    const queue = buildSearchReadingQueue(orderedItems, searchResultHref);
    if (!queue) return;
    const queueId = window.crypto.randomUUID();
    const href = withSearchReadingQueue(queue.hrefs[0], queueId, 0);
    if (!href) return;
    try {
      queue.returnHref = sanitizeSearchReturnHref(`${window.location.pathname}${window.location.search}`) ?? "/search";
      window.sessionStorage.setItem(searchReadingQueueStorageKey(queueId, getCurrentOfflineRuntimeUserId()), JSON.stringify(queue));
      rememberResults();
      router.push(href);
    } catch {
      setBatchNotice(zh
        ? "浏览器无法暂存本次阅读队列；搜索结果未更改。请稍后重试。"
        : "The browser could not keep this temporary reading queue. Search results were not changed; try again.");
    }
  };
  const clearFilters = () => update({ status_scope: "active", document_type: "all", role: "all", project_id: "all", date_from: "", date_to: "", tag_id: "" });
  const selectIndex = (index: number) => setSelection({ scope, documentId: orderedItems[index]?.document_id ?? null });
  const toggleConversationSelection = (conversationId: string, checked: boolean) => {
    setConversationSelection((current) => {
      const ids = new Set(current.scope === scope ? current.ids : []);
      if (checked) ids.add(conversationId);
      else ids.delete(conversationId);
      return { scope, ids: [...ids] };
    });
  };
  const applyBatchResult = (batch: BatchSelectionResult) => {
    const remaining = [...batch.failedIds, ...batch.unconfirmedIds, ...batch.notStartedIds];
    setConversationSelection({ scope, ids: remaining });
    setBatchNotice(zh
      ? `已确认归档 ${batch.succeededIds.length} 项，明确失败 ${batch.failedIds.length} 项，结果未确认 ${batch.unconfirmedIds.length} 项，未开始 ${batch.notStartedIds.length} 项。这里只处理你明确勾选且当前已加载的对话。`
      : `${batch.succeededIds.length} archived, ${batch.failedIds.length} definite failures, ${batch.unconfirmedIds.length} unconfirmed, ${batch.notStartedIds.length} not started. Only explicitly selected conversations from the loaded results were processed.`);
  };
  const archiveSelected = async () => {
    const ids = [...selectedConversationIds];
    if (!ids.length || batchBusy) return;
    setBatchBusy(true);
    setBatchNotice(null);
    try {
      const batch = await runBatchSelection(ids, archiveConversation, 4);
      if (currentScope.current !== scope) return;
      applyBatchResult(batch);
      restartSearch([...batch.failedIds, ...batch.unconfirmedIds, ...batch.notStartedIds]);
    } finally {
      setBatchBusy(false);
    }
  };
  const moveSelection = (delta: number) => {
    if (!orderedItems.length) return;
    const next = Math.max(0, Math.min(orderedItems.length - 1, activeIndex + delta));
    selectIndex(next);
    resultsRef.current?.querySelector<HTMLElement>(`[data-search-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const projectOptions: [string, string][] = (projects.data ?? []).filter((project) => !project.is_default).map((project) => [project.id, project.name]);
  const filterCaption = (key: string, value: string) => {
    if (key === "project_id") return `${zh ? "项目" : "Project"}: ${projectOptions.find(([id]) => id === value)?.[1] ?? (zh ? "当前项目" : "Current project")}`;
    if (key === "tag_id") return `${zh ? "标签" : "Tag"}: ${tags.data?.find(item => item.id === value)?.value.name ?? (zh ? "当前标签" : "Current tag")}`;
    const labels: Record<string, [string, string]> = {
      document_type: ["内容类型", "Content type"], role: ["角色", "Role"], status_scope: ["状态", "Status"], date_from: ["开始日期", "From"], date_to: ["结束日期", "To"],
      conversation: ["标题", "Title"], message: ["正文", "Message"], heading: ["章节", "Section"], code: ["代码", "Code"],
      annotation: ["批注", "Annotation"], attachment: ["附件", "Attachment"], notebook: ["笔记", "Notebook"], description: ["简介", "Description"],
      archived: ["已归档", "Archived"], all: ["含归档的全部状态", "All, including archived"], user: ["用户", "User"], assistant: ["助手", "Assistant"],
    };
    const label = (text: string) => labels[text]?.[zh ? 0 : 1] ?? text;
    return `${label(key)}: ${label(value)}`;
  };
  if (projectId !== "all" && !projectOptions.some(([id]) => id === projectId)) {
    // Keep a URL's applied scope representable while its name is unavailable.
    projectOptions.unshift([projectId, zh ? "当前项目" : "Current project"]);
  }
  const tagOptions: [string, string][] = (tags.data ?? []).map((item) => [item.id, item.value.name]);
  if (tagId && !tagOptions.some(([id]) => id === tagId)) tagOptions.unshift([tagId, zh ? "当前标签" : "Current tag"]);
  const content = (
      <section className="flex min-w-0 flex-1 flex-col">
         <MobilePageHeader title={zh ? "搜索" : "Search"} description={zh ? "搜索对话、正文、章节、代码、批注和附件" : "Search conversations, messages, sections, code, annotations, and attachments"} onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobileSidebarOpenSignal((value) => value + 1)} />
        <div ref={scrollRef} data-testid="search-scroll-root" className="min-h-0 flex-1 overflow-y-auto" onClickCapture={event => {
          const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
          if (link && new URL(link.href, location.href).pathname.startsWith("/conversations/")) rememberResults();
        }}><div className="mx-auto max-w-5xl space-y-5 px-[clamp(1rem,2vw,2rem)] py-8">
          <SearchBox initialQuery={query} onSearch={(value) => { if (value === query) restartSearch(); else update({ q: value }); }} hasResults={items.length > 0} onMoveSelection={moveSelection} onOpenSelection={openSelected} />
          <SavedSearchesPanel
            current={{ q: query, sort, document_type: documentType as SavedSearchValue["document_type"], role: role as "all" | "user" | "assistant", project_id: projectId === "all" ? null : projectId, status_scope: statusScope as "active" | "archived" | "all", date_from: dateFrom || null, date_to: dateTo || null, tag_id: tagId || null }}
            onApply={(saved) => {
              update({
                q: saved.q,
                sort: saved.sort ?? "relevance",
                document_type: saved.document_type, tag_id: saved.tag_id ?? "",
                role: saved.role,
                project_id: saved.project_id ?? "",
                status_scope: saved.status_scope,
                date_from: saved.date_from ?? "",
                date_to: saved.date_to ?? "",
              });
            }}
          />
          <div className="flex min-h-10 flex-wrap items-center gap-3">
            <button type="button" aria-expanded={filtersOpen} aria-controls="global-search-filters" onClick={() => setFiltersOpen((value) => !value)} className="min-h-10 rounded-lg border border-ui px-3 text-sm font-medium hover:bg-subtle">{zh ? "筛选" : "Filters"}{filterCount ? ` · ${filterCount}` : ""}</button>
            {filterCount ? <button type="button" onClick={clearFilters} className="min-h-10 text-sm text-accent">{zh ? "清除筛选" : "Clear filters"}</button> : null}
            <span role="status" className="ml-auto text-xs text-secondary">{query && !invalidDates && !result.isError ? (result.isFetching ? (zh ? "正在搜索…" : "Searching…") : (zh ? `${items.length} / ${total} 个对话` : `${items.length} / ${total} conversations`)) : ""}</span>
          </div>
          {query && items.length && (selectedConversationIds.size > 0 || readingQueueCandidate) ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ui bg-surface px-3 py-2 text-xs text-secondary">
              {selectedConversationIds.size > 0 ? <span>{zh ? `已选 ${selectedConversationIds.size} 个对话` : `${selectedConversationIds.size} selected`}</span> : null}
              {readingQueueCandidate ? <button type="button" onClick={startContinuousReading} className="min-h-9 rounded-md border border-ui bg-page px-3 font-medium text-primary hover:bg-subtle">
                {zh ? `连续阅读 · ${readingQueueCandidate.hrefs.length} 个已加载结果` : `Read ${readingQueueCandidate.hrefs.length} loaded results`}
              </button> : null}
              {selectedConversationIds.size > 0 ? <button type="button" disabled={batchBusy} onClick={() => void archiveSelected()} className="btn-secondary ml-auto inline-flex min-h-11 items-center px-3 text-xs disabled:opacity-50">
                {batchBusy ? (zh ? "正在归档…" : "Archiving…") : (zh ? "归档已选对话" : "Archive selected")}
              </button> : null}
            </div>
          ) : null}
          {batchNotice ? <p role="status" className="text-xs text-secondary">{batchNotice}</p> : null}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{zh ? "搜索范围：" : "Scope: "}{projectId === "all" ? (zh ? "全部对话" : "All conversations") : projects.data?.find(item => item.id === projectId)?.name ?? (zh ? "当前项目" : "Current project")}</span>
            <label>{zh ? "结果排序 " : "Results order "}<select value={sort} onChange={event => update({ sort: event.target.value })} className="min-h-11 rounded border border-ui bg-surface px-2"><option value="relevance">{zh ? "相关性" : "Relevance"}</option><option value="content_updated">{zh ? "内容更新" : "Content updated"}</option><option value="imported">{zh ? "导入时间" : "Imported"}</option></select></label>
            {activeFilters.map(([key, value]) => <button key={key} type="button" aria-label={`${zh ? "移除筛选" : "Remove filter"}: ${filterCaption(key, value)}`} className="btn-secondary min-h-11 px-2 text-xs" onClick={() => update({ [key]: key === "status_scope" ? "active" : "all" })}>{filterCaption(key, value)} ×</button>)}
          </div>
          <div id="global-search-filters" hidden={!filtersOpen} className={filtersOpen ? "grid gap-3 border-y border-ui py-4 sm:grid-cols-2 lg:grid-cols-4" : "hidden"}>
            <Filter label={zh ? "范围" : "Status"} value={statusScope} onChange={(value) => update({ status_scope: value })} options={[["active", zh ? "未归档" : "Active"], ["archived", zh ? "已归档" : "Archived"], ["all", zh ? "全部" : "All"]]} />
             <Filter label={zh ? "内容类型" : "Content type"} value={documentType} onChange={(value) => update({ document_type: value })} options={[["all", zh ? "全部" : "All"], ["conversation", zh ? "标题" : "Titles"], ["message", zh ? "消息正文" : "Messages"], ["heading", zh ? "章节" : "Sections"], ["code", zh ? "代码块" : "Code"], ["annotation", zh ? "批注" : "Annotations"], ["notebook", zh ? "笔记" : "Notebooks"], ["description", zh ? "简介" : "Descriptions"], ["attachment", zh ? "附件" : "Attachments"]]} />
            <Filter label={zh ? "角色" : "Role"} value={role} onChange={(value) => update({ role: value })} options={[["all", zh ? "全部" : "All"], ["user", zh ? "用户" : "User"], ["assistant", "ChatGPT"]]} />
            <div>
              <Filter label={zh ? "项目" : "Project"} value={projectId} onChange={(value) => update({ project_id: value })} options={[["all", zh ? "全部项目" : "All projects"], ...projectOptions]} />
              {projects.isLoading ? <p role="status" className="mt-1 text-xs text-secondary">{zh ? "正在加载项目…" : "Loading projects…"}</p> : null}
              {projects.isError ? <div role="alert" className="mt-1 text-xs text-[var(--danger)]">
                <p>{zh ? "项目加载失败，当前筛选已保留。" : "Could not load projects. Your filter is unchanged."}</p>
                <button type="button" disabled={projects.isFetching} onClick={() => void projects.refetch()} className="min-h-10 underline disabled:opacity-60">{zh ? "重试项目" : "Retry projects"}</button>
              </div> : null}
            </div>
            <div><Filter label={zh ? "标签" : "Tag"} value={tagId} onChange={value => update({ tag_id: value })} options={[["", zh ? "全部标签" : "All tags"], ...tagOptions]} />
              {tags.isError ? <div role="alert" className="text-xs text-[var(--danger)]"><p>{zh ? "标签读取失败，当前筛选已保留。" : "Tags could not be loaded. Your filter is retained."}</p><button type="button" disabled={tags.isFetching} onClick={() => void tags.refetch()} className="min-h-11 underline">{zh ? "重试标签" : "Retry tags"}</button></div> : null}
            </div>
            <label className="text-xs font-medium text-secondary">{zh ? "开始日期" : "From"}<input type="date" value={dateFrom} onChange={(event) => update({ date_from: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" /></label>
            <label className="text-xs font-medium text-secondary">{zh ? "结束日期" : "To"}<input type="date" value={dateTo} onChange={(event) => update({ date_to: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" /></label>

          </div>
          {!query ? <State text={zh ? "输入关键词开始搜索。" : "Enter a keyword to search."} /> : null}
          {invalidDates ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "开始日期不能晚于结束日期。" : "From must be on or before To."}<button type="button" onClick={() => setFiltersOpen(true)} className="ml-3 min-h-10 underline">{zh ? "修改日期" : "Edit dates"}</button></p> : null}
          {result.isError ? <div role="alert" className="border-l-2 border-[var(--danger)] pl-4 text-sm text-[var(--danger)]"><p>{zh ? "搜索失败，请重试。" : "Search failed. Try again."}{items.length ? (zh ? " 以下为之前加载的结果。" : " Previously loaded results are shown below.") : ""}</p><button type="button" disabled={result.isFetching} onClick={() => void result.refetch()} className="min-h-10 underline">{zh ? "重试" : "Retry"}</button></div> : null}
          {query && !invalidDates && !result.isError && !result.isFetching && items.length === 0 ? <State text={zh ? "没有找到结果。请清除筛选或修改关键词。" : "No results. Clear filters or try another query."} /> : null}
          <p id="search-selection-status" role="status" className="sr-only">{activeIndex >= 0 && orderedItems[activeIndex] ? `${activeIndex + 1} / ${items.length}: ${orderedItems[activeIndex].conversation_title}` : ""}</p>
          {projectId !== "all" && !result.isFetching && items.length === 0 ? <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => update({ project_id: "all" })}>{zh ? "扩大到全部对话" : "Search all conversations"}</button> : null}
          <div ref={resultsRef}>{items.length ? <SearchResults items={orderedItems} query={query} activeIndex={activeIndex} onActiveIndexChange={selectIndex} selectedConversationIds={selectedConversationIds} onConversationSelectionChange={toggleConversationSelection} disclosures={disclosures} onDisclosureChange={(key, value) => setDisclosureState(current => ({ scope, values: { ...(current.scope === scope ? current.values : {}), [key]: value } }))} /> : null}</div>
          {!result.isError && result.data && (result.data.has_more ?? result.data.offset + result.data.limit < total) ? <button type="button" onClick={() => setPaging({ scope, offset: result.data.offset + result.data.limit })} disabled={result.isFetching} className="mx-auto block min-h-11 rounded-lg border border-ui bg-surface px-5 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">{result.isFetching ? (zh ? "正在加载…" : "Loading…") : (zh ? "加载更多" : "Load more")}</button> : null}
        </div></div>
      </section>
  );
  if (workspace.embedded) return content;
  return <main className="flex h-screen w-screen overflow-hidden bg-page text-primary"><ProjectSidebar mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} />{content}</main>;
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label className="text-xs font-medium text-secondary">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

function State({ text }: { text: string }) { return <div className="border-l-2 border-ui py-2 pl-4 text-sm text-secondary">{text}</div>; }
