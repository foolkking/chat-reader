"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { searchConversations } from "../../lib/api";
import type { SearchResultItem } from "../../lib/types";
import { ProjectSidebar } from "../projects/project-sidebar";
import { SearchBox } from "./search-box";
import { SearchResults } from "./search-results";

const SEARCH_PAGE_SIZE = 50;
const DOCUMENT_FILTERS = [
  { label: "All", value: "all" },
  { label: "Conversations", value: "conversation" },
  { label: "Messages", value: "message" },
  { label: "Headings", value: "heading" },
];

export function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const documentType = searchParams.get("document_type") ?? "all";
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const searchQuery = useQuery({
    queryKey: ["search", query, documentType, offset],
    queryFn: () =>
      searchConversations({
        q: query,
        limit: SEARCH_PAGE_SIZE,
        offset,
        documentType: documentType === "all" ? undefined : documentType,
      }),
    enabled: query.trim().length > 0,
  });
  const total = searchQuery.data?.total ?? items.length;
  const hasMore = items.length < total;
  const isInitialSearchLoading = query.trim().length > 0 && searchQuery.isFetching && items.length === 0;
  const loadedLabel = useMemo(() => {
    if (!query.trim()) {
      return "";
    }
    if (isInitialSearchLoading) {
      return "Searching...";
    }
    return `${items.length} / ${total} results`;
  }, [isInitialSearchLoading, items.length, query, total]);

  useEffect(() => {
    setOffset(0);
    setItems([]);
  }, [query, documentType]);

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

  function pushSearch(nextQuery: string, nextDocumentType = documentType) {
    const params = new URLSearchParams();
    if (nextQuery) {
      params.set("q", nextQuery);
    }
    if (nextDocumentType !== "all") {
      params.set("document_type", nextDocumentType);
    }
    router.push(`/search${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-[#e5e5e5] bg-white/95 px-4 pl-16 backdrop-blur md:px-6 md:pl-6">
          <div>
            <h1 className="text-base font-semibold">Search</h1>
            <p className="text-xs text-[#6b7280]">Find canonical conversations and messages</p>
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
                  onClick={() => pushSearch(query, filter.value)}
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

          {!query ? <StateBlock label="Enter a keyword to search conversations and messages." /> : null}
          {isInitialSearchLoading ? <StateBlock label="Searching..." /> : null}
          {searchQuery.isError ? <StateBlock label={searchQuery.error.message} /> : null}
          {query && !isInitialSearchLoading && (searchQuery.isSuccess || items.length > 0) ? <SearchResults items={items} /> : null}
          {hasMore ? (
            <button
              type="button"
              onClick={() => setOffset(items.length)}
              disabled={searchQuery.isFetching}
              className="mx-auto block rounded-full border border-[#d1d5db] bg-white px-5 py-2 text-sm font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-60"
            >
              {searchQuery.isFetching ? "Loading results" : "Load more results"}
            </button>
          ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 text-sm text-[#6b7280] shadow-sm">{label}</div>;
}
