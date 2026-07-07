"use client";

import { useState } from "react";

export function SearchBox({
  initialQuery = "",
  onSearch,
}: {
  initialQuery?: string;
  onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-[#e5e5e5] bg-white p-3 shadow-sm sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(query.trim());
      }}
    >
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-[#d1d5db] bg-[#f7f7f8] px-3 py-2 text-sm outline-none focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/20"
        placeholder="Search conversations"
      />
      <button
        type="submit"
        className="rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white hover:bg-black focus:outline-none focus:ring-2 focus:ring-[#10a37f]/30"
      >
        Search
      </button>
    </form>
  );
}
