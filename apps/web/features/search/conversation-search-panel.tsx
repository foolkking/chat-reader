"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchConversations } from "../../lib/api";
import type { NavigationResult } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";

export function ConversationSearchPanel({ conversationId, onNavigate, onClose, showHeader = true }: {
  conversationId: string;
  onNavigate: (target: { messageId: string; blockIndex?: number }) => Promise<NavigationResult>;
  onClose: () => void;
  showHeader?: boolean;
}) {
  const { resolvedLocale } = usePreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [documentType, setDocumentType] = useState("all");
  const [role, setRole] = useState("all");
  const zh = resolvedLocale === "zh-CN";
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: ["conversation-search", conversationId, debounced, documentType, role],
    queryFn: () => searchConversations({
      q: debounced,
      conversationId,
      documentType: documentType === "all" ? undefined : documentType,
      role: role === "all" ? undefined : role,
      limit: 50,
    }),
    enabled: debounced.length > 0,
  });
  const items = results.data?.items ?? [];
  const activate = async (index: number) => {
    const item = items[index];
    if (!item?.message_id) return;
    await onNavigate({ messageId: item.message_id, blockIndex: item.block_index ?? undefined });
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-raised">
      {showHeader ? <header className="flex items-center gap-2 border-b border-ui p-4">
        <Search className="h-4 w-4 text-secondary" />
        <h2 className="flex-1 text-base font-semibold text-primary">{zh ? "当前对话搜索" : "Search this conversation"}</h2>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
      </header> : null}
      <div className="border-b border-ui p-4">
        <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, items.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); }
          if (event.key === "Enter") { event.preventDefault(); void activate(activeIndex); }
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }} className="h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" placeholder={zh ? "搜索标题、正文、章节或代码" : "Search text, sections, or code"} />
        <div className="mt-3 flex flex-wrap gap-2">
          {[{ value: "all", zh: "全部", en: "All" }, { value: "message", zh: "正文", en: "Messages" }, { value: "heading", zh: "章节", en: "Sections" }, { value: "code", zh: "代码", en: "Code" }].map((item) => <button key={item.value} type="button" onClick={() => setDocumentType(item.value)} className={`min-h-8 rounded-md px-2.5 text-xs ${documentType === item.value ? "bg-accent text-white" : "bg-subtle text-secondary"}`}>{zh ? item.zh : item.en}</button>)}
          <span className="mx-1 h-8 w-px bg-[var(--border)]" />
          {[{ value: "all", zh: "全部角色", en: "All roles" }, { value: "user", zh: "用户", en: "User" }, { value: "assistant", zh: "ChatGPT", en: "ChatGPT" }].map((item) => <button key={item.value} type="button" onClick={() => setRole(item.value)} className={`min-h-8 rounded-md px-2.5 text-xs ${role === item.value ? "bg-accent text-white" : "bg-subtle text-secondary"}`}>{zh ? item.zh : item.en}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!debounced ? <p className="p-3 text-sm text-secondary">{zh ? "输入关键词搜索当前对话。" : "Enter a keyword to search this conversation."}</p> : null}
        {results.isFetching ? <p role="status" className="p-3 text-sm text-secondary">{zh ? "正在搜索…" : "Searching…"}</p> : null}
        {!results.isFetching && debounced && items.length === 0 ? <p className="p-3 text-sm text-secondary">{zh ? "没有找到结果。" : "No results found."}</p> : null}
        {items.map((item, index) => <button key={item.document_id} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => void activate(index)} className={`block w-full rounded-lg px-3 py-3 text-left ${activeIndex === index ? "bg-subtle" : "hover:bg-subtle"}`}><span className="line-clamp-3 text-sm leading-6 text-primary">{item.snippet}</span><span className="mt-1 block text-xs text-secondary">{item.document_type}{item.role ? ` · ${item.role}` : ""}</span></button>)}
      </div>
    </div>
  );
}
