"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getProjects, searchConversations } from "../../lib/api";
import type { SearchResultItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { ProjectSidebar } from "../projects/project-sidebar";
import { SearchBox } from "./search-box";
import { SearchResults } from "./search-results";

const PAGE_SIZE = 50;

export function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const query = params.get("q") ?? "";
  const documentType = params.get("document_type") ?? "all";
  const role = params.get("role") ?? "all";
  const projectId = params.get("project_id") ?? "all";
  const statusScope = params.get("status_scope") ?? "active";
  const dateFrom = params.get("date_from") ?? "";
  const dateTo = params.get("date_to") ?? "";
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
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
    enabled: query.trim().length > 0,
  });
  const projects = useQuery({ queryKey: ["projects", "search-filter"], queryFn: () => getProjects() });
  useEffect(() => { setOffset(0); setItems([]); setActiveIndex(0); }, [query, documentType, role, projectId, statusScope, dateFrom, dateTo]);
  useEffect(() => {
    if (!result.data) return;
    setItems((current) => {
      const next = offset === 0 ? [] : [...current];
      for (const item of result.data.items) if (!next.some((existing) => existing.document_id === item.document_id)) next.push(item);
      return next;
    });
  }, [offset, result.data]);
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
    }
    router.push(`/search${next.size ? `?${next}` : ""}`);
  };
  const total = result.data?.total ?? items.length;
  const openSelected = () => {
    const item = items[activeIndex];
    if (!item) return;
    const target = new URLSearchParams();
    if (item.message_id) target.set("messageId", item.message_id);
    if (item.block_index !== null) target.set("blockIndex", String(item.block_index));
    router.push(`/conversations/${item.conversation_id}${target.size ? `?${target}` : ""}`);
  };
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      <ProjectSidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center border-b border-ui bg-surface px-4 pl-16 md:px-[2vw] md:pl-[2vw]"><div><h1 className="text-base font-semibold">{zh ? "搜索" : "Search"}</h1><p className="text-xs text-secondary">{zh ? "搜索对话标题、消息正文、章节和代码" : "Search titles, messages, sections, and code"}</p></div></header>
        <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-5xl space-y-5 px-[clamp(1rem,2vw,2rem)] py-8">
          <SearchBox initialQuery={query} onSearch={(value) => update({ q: value })} hasResults={items.length > 0} onMoveSelection={(delta) => setActiveIndex((value) => Math.max(0, Math.min(items.length - 1, value + delta)))} onOpenSelection={openSelected} />
          <div className="grid gap-3 rounded-xl border border-ui bg-surface p-4 md:grid-cols-2 lg:grid-cols-4">
            <Filter label={zh ? "范围" : "Status"} value={statusScope} onChange={(value) => update({ status_scope: value })} options={[["active", zh ? "未归档" : "Active"], ["archived", zh ? "已归档" : "Archived"], ["all", zh ? "全部" : "All"]]} />
            <Filter label={zh ? "内容类型" : "Content type"} value={documentType} onChange={(value) => update({ document_type: value })} options={[["all", zh ? "全部" : "All"], ["conversation", zh ? "标题" : "Titles"], ["message", zh ? "消息正文" : "Messages"], ["heading", zh ? "章节" : "Sections"], ["code", zh ? "代码块" : "Code"]]} />
            <Filter label={zh ? "角色" : "Role"} value={role} onChange={(value) => update({ role: value })} options={[["all", zh ? "全部" : "All"], ["user", zh ? "用户" : "User"], ["assistant", "ChatGPT"]]} />
            <Filter label={zh ? "项目" : "Project"} value={projectId} onChange={(value) => update({ project_id: value })} options={[["all", zh ? "全部项目" : "All projects"], ...(projects.data ?? []).filter((project) => !project.is_default).map((project) => [project.id, project.name] as [string, string])]} />
            <label className="text-xs font-medium text-secondary">{zh ? "开始日期" : "From"}<input type="date" value={dateFrom} onChange={(event) => update({ date_from: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" /></label>
            <label className="text-xs font-medium text-secondary">{zh ? "结束日期" : "To"}<input type="date" value={dateTo} onChange={(event) => update({ date_to: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary" /></label>
            <div className="flex items-end text-sm text-secondary">{query ? (result.isFetching && items.length === 0 ? (zh ? "正在搜索…" : "Searching…") : (zh ? `${items.length} / ${total} 条结果` : `${items.length} / ${total} results`)) : ""}</div>
          </div>
          {!query ? <State text={zh ? "输入关键词开始搜索。" : "Enter a keyword to search."} /> : null}
          {result.isError ? <State text={zh ? "搜索失败，请重试。" : "Search failed. Try again."} /> : null}
          {query && !result.isFetching && items.length === 0 ? <State text={zh ? "没有找到结果。请清除筛选或修改关键词。" : "No results. Clear filters or try another query."} /> : null}
          {items.length ? <SearchResults items={items} query={query} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} /> : null}
          {items.length < total ? <button type="button" onClick={() => setOffset(items.length)} disabled={result.isFetching} className="mx-auto block min-h-10 rounded-lg border border-ui bg-surface px-5 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">{result.isFetching ? (zh ? "正在加载…" : "Loading…") : (zh ? "加载更多" : "Load more")}</button> : null}
        </div></div>
      </section>
    </main>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label className="text-xs font-medium text-secondary">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

function State({ text }: { text: string }) { return <div className="border-l-2 border-ui py-2 pl-4 text-sm text-secondary">{text}</div>; }
