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
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ProjectSidebar />
        <section className="space-y-5">
          <header>
            <p className="text-sm font-medium uppercase tracking-normal text-slate-500">Search</p>
            <h1 className="mt-1 text-3xl font-semibold">Keyword search</h1>
          </header>

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
        </section>
      </div>
    </main>
  );
}

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">{label}</div>;
}
