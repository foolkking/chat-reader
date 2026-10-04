"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getProjects, searchConversations } from "../../lib/api";
import type { SearchResultItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { ProjectSidebar } from "../projects/project-sidebar";
import { SearchBox } from "./search-box";
import { orderSearchResults, SearchResults } from "./search-results";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { useWorkspaceShell } from "../../components/workspace-shell";

const PAGE_SIZE = 50;

export function SearchPage() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  return <SearchWorkspace filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen} />;
}

function SearchWorkspace({ filtersOpen, setFiltersOpen }: { filtersOpen: boolean; setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const router = useRouter();
  const params = useSearchParams();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const workspace = useWorkspaceShell();
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const query = params?.get("q") ?? "";
  const documentType = params?.get("document_type") ?? "all";
  const role = params?.get("role") ?? "all";
  const projectId = params?.get("project_id") ?? "all";
  const statusScope = params?.get("status_scope") ?? "active";
  const dateFrom = params?.get("date_from") ?? "";
  const dateTo = params?.get("date_to") ?? "";
  const scope = JSON.stringify([query, documentType, role, projectId, statusScope, dateFrom, dateTo]);
  const [paging, setPaging] = useState({ scope, offset: 0 });
  const offset = paging.scope === scope ? paging.offset : 0;
  const [collection, setCollection] = useState<{ scope: string; items: SearchResultItem[] }>({ scope, items: [] });
  const items = collection.scope === scope ? collection.items : [];
  const [activeIndex, setActiveIndex] = useState(-1);
  const resultsRef = useRef<HTMLDivElement>(null);
  const orderedItems = orderSearchResults(items);
  const invalidDates = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const filterCount = [statusScope !== "active", documentType !== "all", role !== "all", projectId !== "all", Boolean(dateFrom), Boolean(dateTo)].filter(Boolean).length;
  const result = useQuery({
    queryKey: ["search", query, documentType, role, projectId, statusScope, dateFrom, dateTo, offset],
    queryFn: () => searchConversations({
      q: query,
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
  const projects = useQuery({ queryKey: ["projects", "search-filter"], queryFn: () => getProjects({ sort: "custom", direction: "asc" }) });
  useEffect(() => { setActiveIndex(-1); }, [scope]);
  useEffect(() => {
    if (!result.data) return;
    setCollection((current) => {
      const next = offset === 0 || current.scope !== scope ? [] : [...current.items];
      for (const item of result.data.items) if (!next.some((existing) => existing.document_id === item.document_id)) next.push(item);
      return { scope, items: next };
    });
  }, [offset, result.data, scope]);
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [key, value] of Object.entries(changes)) {
      if (value && (key === "q" || (key === "status_scope" ? value !== "active" : value !== "all"))) next.set(key, value);
      else next.delete(key);
    }
    router.push(`/search${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const total = result.data?.total ?? items.length;
  const openSelected = () => {
    const item = orderedItems[activeIndex];
    if (!item) return;
    const target = new URLSearchParams();
    if (item.message_id) target.set("messageId", item.message_id);
    if (item.block_index !== null) target.set("blockIndex", String(item.block_index));
    if (item.character_offset != null) target.set("characterOffset", String(item.character_offset));
    if (item.document_type === "annotation") {
      target.set("annotations", "open");
      if (item.annotation_id) target.set("annotationId", item.annotation_id);
    }
    router.push(`/conversations/${item.conversation_id}${target.size ? `?${target}` : ""}`);
  };
  const clearFilters = () => update({ status_scope: "active", document_type: "all", role: "all", project_id: "all", date_from: "", date_to: "" });
  const moveSelection = (delta: number) => {
    if (!orderedItems.length) return;
    const next = Math.max(0, Math.min(orderedItems.length - 1, activeIndex + delta));
    setActiveIndex(next);
    resultsRef.current?.querySelector<HTMLElement>(`[data-search-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const content = (
      <section className="flex min-w-0 flex-1 flex-col">
        <MobilePageHeader title={zh ? "搜索" : "Search"} description={zh ? "搜索对话、正文、章节、代码和批注" : "Search conversations, messages, sections, code, and annotations"} onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobileSidebarOpenSignal((value) => value + 1)} />
        <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-5xl space-y-5 px-[clamp(1rem,2vw,2rem)] py-8">
          <SearchBox initialQuery={query} onSearch={(value) => { if (value === query) void result.refetch(); else update({ q: value }); }} hasResults={items.length > 0} onMoveSelection={moveSelection} onOpenSelection={openSelected} />
          <div className="flex min-h-10 flex-wrap items-center gap-3">
            <button type="button" aria-expanded={filtersOpen} aria-controls="global-search-filters" onClick={() => setFiltersOpen((value) => !value)} className="min-h-10 rounded-lg border border-ui px-3 text-sm font-medium hover:bg-subtle">{zh ? "筛选" : "Filters"}{filterCount ? ` · ${filterCount}` : ""}</button>
            {filterCount ? <button type="button" onClick={clearFilters} className="min-h-10 text-sm text-accent">{zh ? "清除筛选" : "Clear filters"}</button> : null}
            <span role="status" className="ml-auto text-xs text-secondary">{query && !invalidDates && !result.isError ? (result.isFetching ? (zh ? "正在搜索…" : "Searching…") : (zh ? `${items.length} / ${total} 条结果` : `${items.length} / ${total} results`)) : ""}</span>
          </div>
          <div id="global-search-filters" hidden={!filtersOpen} className={filtersOpen ? "grid gap-3 border-y border-ui py-4 sm:grid-cols-2 lg:grid-cols-4" : "hidden"}>
            <Filter label={zh ? "范围" : "Status"} value={statusScope} onChange={(value) => update({ status_scope: value })} options={[["active", zh ? "未归档" : "Active"], ["archived", zh ? "已归档" : "Archived"], ["all", zh ? "全部" : "All"]]} />
            <Filter label={zh ? "内容类型" : "Content type"} value={documentType} onChange={(value) => update({ document_type: value })} options={[["all", zh ? "全部" : "All"], ["conversation", zh ? "标题" : "Titles"], ["message", zh ? "消息正文" : "Messages"], ["heading", zh ? "章节" : "Sections"], ["code", zh ? "代码块" : "Code"], ["annotation", zh ? "批注" : "Annotations"]]} />
            <Filter label={zh ? "角色" : "Role"} value={role} onChange={(value) => update({ role: value })} options={[["all", zh ? "全部" : "All"], ["user", zh ? "用户" : "User"], ["assistant", "ChatGPT"]]} />
            <Filter label={zh ? "项目" : "Project"} value={projectId} onChange={(value) => update({ project_id: value })} options={[["all", zh ? "全部项目" : "All projects"], ...(projects.data ?? []).filter((project) => !project.is_default).map((project) => [project.id, project.name] as [string, string])]} />
            <label className="text-xs font-medium text-secondary">{zh ? "开始日期" : "From"}<input type="date" value={dateFrom} onChange={(event) => update({ date_from: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" /></label>
            <label className="text-xs font-medium text-secondary">{zh ? "结束日期" : "To"}<input type="date" value={dateTo} onChange={(event) => update({ date_to: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" /></label>

          </div>
          {!query ? <State text={zh ? "输入关键词开始搜索。" : "Enter a keyword to search."} /> : null}
          {invalidDates ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "开始日期不能晚于结束日期。" : "From must be on or before To."}<button type="button" onClick={() => setFiltersOpen(true)} className="ml-3 min-h-10 underline">{zh ? "修改日期" : "Edit dates"}</button></p> : null}
          {result.isError ? <div role="alert" className="border-l-2 border-[var(--danger)] pl-4 text-sm text-[var(--danger)]"><p>{zh ? "搜索失败，请重试。" : "Search failed. Try again."}{items.length ? (zh ? " 以下为之前加载的结果。" : " Previously loaded results are shown below.") : ""}</p><button type="button" disabled={result.isFetching} onClick={() => void result.refetch()} className="min-h-10 underline">{zh ? "重试" : "Retry"}</button></div> : null}
          {query && !invalidDates && !result.isError && !result.isFetching && items.length === 0 ? <State text={zh ? "没有找到结果。请清除筛选或修改关键词。" : "No results. Clear filters or try another query."} /> : null}
          <p id="search-selection-status" role="status" className="sr-only">{activeIndex >= 0 && orderedItems[activeIndex] ? `${activeIndex + 1} / ${items.length}: ${orderedItems[activeIndex].conversation_title}` : ""}</p>
          <div ref={resultsRef}>{items.length ? <SearchResults items={orderedItems} query={query} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} /> : null}</div>
          {!result.isError && items.length < total ? <button type="button" onClick={() => setPaging({ scope, offset: items.length })} disabled={result.isFetching} className="mx-auto block min-h-10 rounded-lg border border-ui bg-surface px-5 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">{result.isFetching ? (zh ? "正在加载…" : "Loading…") : (zh ? "加载更多" : "Load more")}</button> : null}
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
