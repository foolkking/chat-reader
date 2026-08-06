"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NavigationResult } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { remoteReaderDataSource, type ReaderDataSource } from "../../lib/reader-data-source";

export function ConversationSearchPanel({ conversationId, dataSource = remoteReaderDataSource, sourceKey = "remote", onNavigate, onClose, showHeader = true }: {
  conversationId: string;
  dataSource?: ReaderDataSource;
  sourceKey?: string;
  onNavigate: (target: { messageId: string; blockIndex?: number; characterOffset?: number }) => Promise<NavigationResult>;
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
    queryKey: ["conversation-search", sourceKey, conversationId, debounced, documentType, role],
    queryFn: () => dataSource.searchConversation(conversationId, {
      query: debounced,
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
    const result = await onNavigate({ messageId: item.message_id, blockIndex: item.block_index ?? undefined, characterOffset: item.character_offset ?? undefined });
    if (result.ok) onClose();
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-raised">
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
        }} className="h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none placeholder:text-secondary focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" placeholder={zh ? "搜索当前对话正文或批注" : "Search this conversation and its annotations"} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs font-medium text-secondary">{zh ? "内容类型" : "Content type"}<select value={documentType} onChange={(event) => { setDocumentType(event.target.value); setActiveIndex(0); }} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-ui bg-surface px-2 text-sm text-primary"><option value="all">{zh ? "全部内容" : "All content"}</option><option value="message">{zh ? "正文" : "Messages"}</option><option value="heading">{zh ? "章节" : "Sections"}</option><option value="code">{zh ? "代码" : "Code"}</option><option value="annotation">{zh ? "批注" : "Annotations"}</option></select></label>
          <label className="min-w-0 text-xs font-medium text-secondary">{zh ? "角色" : "Role"}<select value={role} onChange={(event) => { setRole(event.target.value); setActiveIndex(0); }} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-ui bg-surface px-2 text-sm text-primary"><option value="all">{zh ? "全部角色" : "All roles"}</option><option value="user">{zh ? "用户" : "User"}</option><option value="assistant">ChatGPT</option></select></label>
        </div>
        {debounced && !results.isFetching ? <p className="mt-3 text-xs text-secondary" role="status">{zh ? `共 ${results.data?.total ?? 0} 个结果` : `${results.data?.total ?? 0} results`}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!debounced ? <p className="p-3 text-sm text-secondary">{zh ? "输入关键词搜索当前对话。" : "Enter a keyword to search this conversation."}</p> : null}
        {results.isFetching ? <p role="status" className="p-3 text-sm text-secondary">{zh ? "正在搜索…" : "Searching…"}</p> : null}
        {!results.isFetching && debounced && items.length === 0 ? <p className="p-3 text-sm text-secondary">{zh ? "没有找到结果。" : "No results found."}</p> : null}
        {items.map((item, index) => <button key={item.document_id} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => void activate(index)} className={`block w-full rounded-lg px-3 py-3 text-left ${activeIndex === index ? "bg-subtle" : "hover:bg-subtle"}`}><span className="line-clamp-3 text-sm leading-6 text-primary"><HighlightedSnippet text={item.snippet} query={debounced} /></span><span className="mt-1 block text-xs text-secondary">{documentTypeLabel(item.document_type, zh)}{item.annotation_type ? ` · ${annotationTypeLabel(item.annotation_type, zh)}` : item.role ? ` · ${roleLabel(item.role, zh)}` : ""}{item.annotation_color ? ` · ${colorLabel(item.annotation_color, zh)}` : ""}{item.occurrence_count > 1 ? ` · ${zh ? `命中 ${item.occurrence_count} 次` : `${item.occurrence_count} matches`}` : ""}</span></button>)}
      </div>
    </div>
  );
}

function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`(${escaped})`, "gi");
  return <>{text.split(expression).map((part, index) => part.toLocaleLowerCase() === query.toLocaleLowerCase() ? <mark key={index} className="rounded-sm bg-[var(--accent-soft)] px-0.5 text-primary">{part}</mark> : <span key={index}>{part}</span>)}</>;
}

function documentTypeLabel(value: string, zh: boolean) {
  const labels: Record<string, [string, string]> = { message: ["正文", "Message"], heading: ["章节", "Section"], code: ["代码", "Code"], annotation: ["批注", "Annotation"] };
  return labels[value]?.[zh ? 0 : 1] ?? value;
}

function annotationTypeLabel(value: string, zh: boolean) {
  const labels: Record<string, [string, string]> = { highlight: ["高亮", "Highlight"], underline: ["下划线", "Underline"], strikethrough: ["删除线", "Strikethrough"], comment: ["评论", "Comment"], bookmark: ["书签", "Bookmark"] };
  return labels[value]?.[zh ? 0 : 1] ?? value;
}

function roleLabel(value: string, zh: boolean) {
  return value === "user" ? (zh ? "用户" : "User") : value === "assistant" ? "ChatGPT" : value;
}

function colorLabel(value: string, zh: boolean) {
  if (!zh) return value;
  return ({ yellow: "黄色", green: "绿色", blue: "蓝色", pink: "粉色" } as Record<string, string>)[value] ?? value;
}
