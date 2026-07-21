"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchConversations } from "../../lib/api";
import { usePreferences } from "../../components/preferences-provider";

export function SidebarSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const { resolvedLocale } = usePreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const labels = resolvedLocale === "zh-CN"
    ? { placeholder: "搜索标题和消息内容", all: "查看全部结果", empty: "没有匹配结果" }
    : { placeholder: "Search titles and messages", all: "View all results", empty: "No matching results" };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("chat-reader:focus-global-search", focus);
    return () => window.removeEventListener("chat-reader:focus-global-search", focus);
  }, []);
  const result = useQuery({
    queryKey: ["sidebar-search", debounced],
    queryFn: () => searchConversations({ q: debounced, limit: 8 }),
    enabled: debounced.length > 0,
    staleTime: 15_000,
  });
  const items = result.data?.items ?? [];
  const openResult = (index: number) => {
    const item = items[index];
    if (!item) return;
    const params = new URLSearchParams();
    if (item.message_id) params.set("messageId", item.message_id);
    if (item.block_index !== null) params.set("blockIndex", String(item.block_index));
    onNavigate?.();
    router.push(`/conversations/${item.conversation_id}${params.size ? `?${params}` : ""}`);
  };

  return (
    <div className="relative mb-3">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-secondary" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, items.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); }
          if (event.key === "Enter") {
            event.preventDefault();
            if (items.length) openResult(activeIndex);
            else router.push(`/search?q=${encodeURIComponent(query.trim())}`);
          }
          if (event.key === "Escape") { setQuery(""); inputRef.current?.blur(); }
        }}
        className="h-10 w-full rounded-lg border border-ui bg-surface pl-9 pr-9 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]"
        placeholder={labels.placeholder}
        aria-label={labels.placeholder}
      />
      {query ? <button type="button" onClick={() => { setQuery(""); inputRef.current?.focus(); }} className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="Clear"><X className="h-3.5 w-3.5" /></button> : null}
      {debounced ? (
        <div className="absolute inset-x-0 top-11 z-40 overflow-hidden rounded-lg border border-ui bg-raised shadow-xl">
          {items.map((item, index) => (
            <button key={item.document_id} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => openResult(index)} className={`block w-full px-3 py-2 text-left ${activeIndex === index ? "bg-subtle" : "hover:bg-subtle"}`}>
              <span className="block truncate text-sm font-medium text-primary">{item.conversation_title}</span>
              <span className="mt-0.5 block truncate text-xs text-secondary">{item.snippet}</span>
            </button>
          ))}
          {!result.isFetching && items.length === 0 ? <p className="px-3 py-3 text-sm text-secondary">{labels.empty}</p> : null}
          <button type="button" onClick={() => { onNavigate?.(); router.push(`/search?q=${encodeURIComponent(debounced)}`); }} className="flex min-h-10 w-full items-center justify-center border-t border-ui px-3 text-sm font-medium text-accent hover:bg-subtle">{labels.all}</button>
        </div>
      ) : null}
    </div>
  );
}
