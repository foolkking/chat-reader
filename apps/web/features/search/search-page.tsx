"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { searchConversations } from "../../lib/api";
import { ProjectSidebar } from "../projects/project-sidebar";
import { SearchBox } from "./search-box";
import { SearchResults } from "./search-results";

export function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const searchQuery = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchConversations({ q: query }),
    enabled: query.trim().length > 0,
  });

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
              if (nextQuery) {
                router.push(`/search?q=${encodeURIComponent(nextQuery)}`);
              }
            }}
          />

          {!query ? <StateBlock label="Enter a keyword to search conversations and messages." /> : null}
          {searchQuery.isLoading ? <StateBlock label="Searching" /> : null}
          {searchQuery.isError ? <StateBlock label={searchQuery.error.message} /> : null}
          {searchQuery.isSuccess ? <SearchResults items={searchQuery.data.items} /> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 text-sm text-[#6b7280] shadow-sm">{label}</div>;
}
