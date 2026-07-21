"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";

export function SearchBox({ initialQuery = "", onSearch, hasResults = false, onMoveSelection, onOpenSelection }: { initialQuery?: string; onSearch: (query: string) => void; hasResults?: boolean; onMoveSelection?: (delta: number) => void; onOpenSelection?: () => void }) {
  const { resolvedLocale } = usePreferences();
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("chat-reader:focus-global-search", focus);
    return () => window.removeEventListener("chat-reader:focus-global-search", focus);
  }, []);
  const zh = resolvedLocale === "zh-CN";
  return <form className="flex gap-2 rounded-xl border border-ui bg-surface p-2" onSubmit={(event) => { event.preventDefault(); if (hasResults && query.trim() === initialQuery.trim() && onOpenSelection) onOpenSelection(); else onSearch(query.trim()); }}><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-secondary" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); onMoveSelection?.(1); } else if (event.key === "ArrowUp") { event.preventDefault(); onMoveSelection?.(-1); } else if (event.key === "Escape") { inputRef.current?.blur(); } }} className="h-10 w-full rounded-lg border border-ui bg-page pl-9 pr-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" placeholder={zh ? "搜索标题和消息内容" : "Search titles and messages"} aria-label={zh ? "搜索" : "Search"} /></div><button type="submit" className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)]">{zh ? "搜索" : "Search"}</button></form>;
}
