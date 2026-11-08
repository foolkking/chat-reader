"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { getConversations, searchConversations } from "../../lib/api";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { usePreferences } from "../../components/preferences-provider";
import { searchResultHref } from "../search/search-result-target";
import { togetherTarget } from "./together-session";
import Link from "next/link";

export type TogetherChoice = { conversationId: string; title: string; href: string };
export function TogetherChooser({ open, onClose, onChoose, openedIds = [], notice, onOpenExternal }: {
  open: boolean; onClose: () => void; onChoose: (choice: TogetherChoice) => void; openedIds?: string[];
  notice?: string; onOpenExternal?: (href: string) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN", id = useId();
  const root = useRef<HTMLElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(""), [term, setTerm] = useState(""), [page, setPage] = useState(0);
  useDialogFocus({ open, rootRef: root, initialFocusRef: input, onClose });
  useEffect(() => { const timer = setTimeout(() => { setTerm(query.trim()); setPage(0); }, 250); return () => clearTimeout(timer); }, [query]);
  const results = useQuery({
    queryKey: ["search", "together-picker", term, page], enabled: open,
    queryFn: async ({ signal }) => {
      if (term) {
        const result = await searchConversations({ q: term, limit: 20, offset: page * 20, signal, statusScope: "all" });
        return { hasMore: (page + 1) * 20 < result.total, items: result.items.map(item => ({
          conversationId: item.conversation_id, title: item.conversation_title, href: searchResultHref(item),
          snippet: item.snippet, key: item.document_id,
        })) };
      }
      const items = await getConversations({ limit: 21, offset: page * 20, statusScope: "all", sort: "recent_read" }, signal);
      return { hasMore: items.length > 20, items: items.slice(0, 20).map(item => ({
        conversationId: item.id, title: item.display_title || item.title, href: `/conversations/${item.id}`, snippet: "", key: item.id,
      })) };
    },
  });
  const current = term === query.trim();
  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof results.data>["items"]>();
    if (current && !results.isError) for (const item of results.data?.items ?? []) map.set(item.conversationId, [...(map.get(item.conversationId) ?? []), item]);
    return [...map.values()];
  }, [results.data, results.isError, current]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[185] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[10svh]" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={root} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="flex max-h-[80svh] w-full max-w-xl flex-col rounded-xl border border-ui bg-raised shadow-2xl">
      <header className="flex items-center gap-2 border-b border-ui px-4 py-2"><h2 id={`${id}-title`} className="flex-1 text-sm font-semibold">{zh ? "打开另一个对话一起阅读" : "Open another conversation to read together"}</h2><button type="button" className="h-11 w-11" aria-label={zh ? "关闭" : "Close"} onClick={onClose}><X className="mx-auto h-5 w-5" /></button></header>
      <div className="flex items-center gap-2 px-4 py-2"><Search className="h-4 w-4 text-secondary" /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} maxLength={200}
        placeholder={zh ? "搜索你要一起阅读的对话或正文…" : "Find a conversation or passage to read alongside…"} aria-label={zh ? "搜索一起阅读的对话" : "Search conversations to read together"} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" /></div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-ui p-2">
        {notice ? <p role="status" className="px-3 py-2 text-sm text-secondary">{notice}</p> : null}
        {!query.trim() ? <p className="px-3 py-2 text-xs text-secondary">{zh ? "最近阅读" : "Recently read"}</p> : null}
        {!current || results.isFetching ? <p role="status" className="p-3 text-sm text-secondary">{zh ? "正在查找…" : "Finding conversations…"}</p> : null}
        {current && results.isError ? <div role="alert" className="p-3 text-sm text-secondary">{zh ? "暂时无法读取。" : "Could not load results."}<button type="button" className="min-h-11 px-2 underline" onClick={() => void results.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
        {groups.map(group => <div key={group[0].conversationId} className="border-b border-ui py-1 last:border-0">
          <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-medium hover:bg-subtle" onClick={() => onChoose({ ...group[0], href: `/conversations/${group[0].conversationId}` })}>
            <span className="min-w-0 truncate">{group[0].title}</span><span className="shrink-0 text-xs font-normal text-secondary">{openedIds.includes(group[0].conversationId) ? (zh ? "切换到此对话" : "Switch to tab") : (zh ? "继续阅读" : "Resume")}</span>
          </button>
          {group.filter(item => item.snippet).map(item => togetherTarget(item.href)
            ? <button type="button" key={item.key} className="min-h-11 w-full rounded-md px-3 py-2 text-left text-xs leading-5 text-secondary hover:bg-subtle" onClick={() => onChoose(item)}><span className="line-clamp-3">{item.snippet}</span></button>
            : <Link key={item.key} href={item.href} onClick={event => {
              if (onOpenExternal && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenExternal(item.href); }
            }} className="block min-h-11 rounded-md px-3 py-2 text-xs leading-5 text-secondary hover:bg-subtle"><span className="line-clamp-3">{item.snippet}</span><span className="text-accent">{zh ? "在完整阅读页查看此结果" : "View this result in the full reader"}</span></Link>)}
        </div>)}
        {current && results.isSuccess && !results.isFetching && !groups.length ? <p className="p-3 text-sm text-secondary">{zh ? "没有匹配对话，试试正文中的关键词。" : "No matching conversations. Try a phrase from the content."}</p> : null}
      </div>
      <footer className="flex items-center justify-between border-t border-ui px-3 py-2 text-xs text-secondary"><button type="button" disabled={!page || results.isFetching} className="min-h-11 px-3 disabled:opacity-40" onClick={() => setPage(value => value - 1)}>{zh ? "上一页" : "Previous"}</button><span>{page + 1}</span><button type="button" disabled={!results.data?.hasMore || results.isFetching || !current} className="min-h-11 px-3 disabled:opacity-40" onClick={() => setPage(value => value + 1)}>{zh ? "下一页" : "Next"}</button></footer>
    </section>
  </div>;
}
