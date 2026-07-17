"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getProjects, searchConversations } from "../../lib/api";
import type { SearchResultItem } from "../../lib/types";
import { ProjectSidebar } from "../projects/project-sidebar";
import { SearchBox } from "./search-box";
import { SearchResults } from "./search-results";

const SEARCH_PAGE_SIZE = 50;
const DOCUMENT_FILTERS = [
  { label: "全部", value: "all" },
  { label: "对话", value: "conversation" },
  { label: "消息", value: "message" },
  { label: "章节", value: "heading" },
];

export function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const documentType = searchParams.get("document_type") ?? "all";
  const role = searchParams.get("role") ?? "all";
  const projectId = searchParams.get("project_id") ?? "all";
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const searchQuery = useQuery({
    queryKey: ["search", query, documentType, role, projectId, offset],
    queryFn: () =>
      searchConversations({
        q: query,
        limit: SEARCH_PAGE_SIZE,
        offset,
        documentType: documentType === "all" ? undefined : documentType,
        role: role === "all" ? undefined : role,
        projectId: projectId === "all" ? undefined : projectId,
      }),
    enabled: query.trim().length > 0,
  });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => getProjects() });
  const total = searchQuery.data?.total ?? items.length;
  const hasMore = items.length < total;
  const isInitialSearchLoading = query.trim().length > 0 && searchQuery.isFetching && items.length === 0;
  const loadedLabel = useMemo(() => {
    if (!query.trim()) {
      return "";
    }
    if (isInitialSearchLoading) {
      return "正在搜索…";
    }
    return `${items.length} / ${total} 条结果`;
  }, [isInitialSearchLoading, items.length, query, total]);

  useEffect(() => {
    setOffset(0);
    setItems([]);
  }, [query, documentType, role, projectId]);

  useEffect(() => {
    if (!searchQuery.isSuccess) {
      return;
    }
    setItems((current) => {
      const next = offset === 0 ? [] : [...current];
      for (const item of searchQuery.data.items) {
        if (!next.some((existing) => existing.document_id === item.document_id)) {
          next.push(item);
        }
      }
      return next;
    });
  }, [offset, searchQuery.data, searchQuery.isSuccess]);

  function pushSearch(nextQuery: string, overrides: { documentType?: string; role?: string; projectId?: string } = {}) {
    const nextDocumentType = overrides.documentType ?? documentType;
    const nextRole = overrides.role ?? role;
    const nextProjectId = overrides.projectId ?? projectId;
    const params = new URLSearchParams();
    if (nextQuery) {
      params.set("q", nextQuery);
    }
    if (nextDocumentType !== "all") {
      params.set("document_type", nextDocumentType);
    }
    if (nextRole !== "all") params.set("role", nextRole);
    if (nextProjectId !== "all") params.set("project_id", nextProjectId);
    router.push(`/search${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-[#e5e5e5] bg-white/95 px-4 pl-16 backdrop-blur md:px-6 md:pl-6">
          <div>
            <h1 className="text-base font-semibold">搜索</h1>
            <p className="text-xs text-[#6b7280]">搜索对话标题、消息正文和章节</p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto max-w-4xl space-y-5 px-4 py-8 md:px-6">

          <SearchBox
            initialQuery={query}
            onSearch={(nextQuery) => {
              pushSearch(nextQuery);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {DOCUMENT_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => pushSearch(query, { documentType: filter.value })}
                  className={`min-h-10 rounded-full border px-3 text-sm font-medium ${
                    documentType === filter.value
                      ? "border-[#10a37f] bg-[#ecfdf5] text-[#047857]"
                      : "border-[#d1d5db] bg-white text-[#374151] hover:bg-[#f7f7f8]"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {loadedLabel ? <span className="text-sm text-[#6b7280]">{loadedLabel}</span> : null}
          </div>

          <div className="flex flex-wrap gap-2 border-b border-[#e5e7eb] pb-4">
            <span className="self-center text-xs font-medium text-[#6b7280]">角色</span>
            {[{ label: "全部", value: "all" }, { label: "用户", value: "user" }, { label: "ChatGPT", value: "assistant" }].map((item) => (
              <button key={item.value} type="button" onClick={() => pushSearch(query, { role: item.value })} className={`min-h-9 rounded-lg px-3 text-sm ${role === item.value ? "bg-[#111827] text-white" : "bg-white text-[#374151] hover:bg-[#ececeb]"}`}>{item.label}</button>
            ))}
            <details className="relative ml-auto">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-lg border border-[#d1d5db] bg-white px-3 text-sm marker:hidden">{projectId === "all" ? "全部项目" : projectsQuery.data?.find((project) => project.id === projectId)?.name ?? "项目"}</summary>
              <div className="absolute right-0 top-11 z-20 max-h-64 w-56 overflow-y-auto rounded-lg border border-[#e5e7eb] bg-white p-1 shadow-xl">
                <button type="button" onClick={() => pushSearch(query, { projectId: "all" })} className="block min-h-9 w-full rounded-md px-3 text-left text-sm hover:bg-[#f7f7f8]">全部项目</button>
                {projectsQuery.data?.filter((project) => !project.is_default).map((project) => <button key={project.id} type="button" onClick={() => pushSearch(query, { projectId: project.id })} className="block min-h-9 w-full truncate rounded-md px-3 text-left text-sm hover:bg-[#f7f7f8]">{project.name}</button>)}
              </div>
            </details>
          </div>

          {!query ? <StateBlock label="输入关键词以搜索标题、消息正文和章节。" /> : null}
          {isInitialSearchLoading ? <StateBlock label="正在搜索…" /> : null}
          {searchQuery.isError ? <StateBlock label={searchQuery.error.message} /> : null}
          {query && !isInitialSearchLoading && (searchQuery.isSuccess || items.length > 0) ? <SearchResults items={items} query={query} /> : null}
          {hasMore ? (
            <button
              type="button"
              onClick={() => setOffset(items.length)}
              disabled={searchQuery.isFetching}
              className="mx-auto block rounded-full border border-[#d1d5db] bg-white px-5 py-2 text-sm font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-60"
            >
              {searchQuery.isFetching ? "正在加载" : "加载更多结果"}
            </button>
          ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function StateBlock({ label }: { label: string }) {
  return <div className="border-l-2 border-[#d1d5db] py-2 pl-4 text-sm text-[#6b7280]">{label}</div>;
}
