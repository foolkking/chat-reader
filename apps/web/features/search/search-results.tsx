"use client";

import Link from "next/link";
import type { SearchResultItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";

export function SearchResults({ items, query, activeIndex = -1, onActiveIndexChange }: { items: SearchResultItem[]; query: string; activeIndex?: number; onActiveIndexChange?: (index: number) => void }) {
  const { resolvedLocale } = usePreferences();
  return <div className="overflow-hidden rounded-xl border border-ui bg-surface">{items.map((item, index) => {
    const params = new URLSearchParams();
    if (item.message_id) params.set("messageId", item.message_id);
    if (item.block_index !== null) params.set("blockIndex", String(item.block_index));
    return <Link key={item.document_id} onMouseEnter={() => onActiveIndexChange?.(index)} href={`/conversations/${item.conversation_id}${params.size ? `?${params}` : ""}`} className={`block border-b border-ui px-5 py-4 last:border-0 hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--focus)] ${activeIndex === index ? "bg-subtle" : ""}`}><div className="flex gap-4"><div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold text-primary">{item.conversation_title}</h2><p className="mt-1 text-sm leading-6 text-secondary"><Highlight text={clean(item.snippet)} query={query} /></p>{item.occurrence_count > 1 ? <p className="mt-1 text-xs text-secondary">{resolvedLocale === "zh-CN" ? `同时存在于 ${item.occurrence_count} 个对话` : `Also found in ${item.occurrence_count} conversations`}</p> : null}</div><div className="shrink-0 text-xs text-secondary">{documentLabel(item.document_type, resolvedLocale)}{item.role ? ` · ${roleLabel(item.role, resolvedLocale)}` : ""}</div></div></Link>;
  })}</div>;
}

function Highlight({ text, query }: { text: string; query: string }) { const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()); return index < 0 || !query ? <>{text}</> : <>{text.slice(0, index)}<mark className="rounded-sm bg-[var(--mark-bg)] px-0.5 text-[var(--mark-text)]">{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>; }
function clean(value: string): string { return value.replace(/^\s*(?:user|assistant|prompt|response)\s+/i, "").replace(/(^|\s)>\s*/g, "$1").replace(/\s+/g, " ").trim(); }
function documentLabel(value: string, locale: "zh-CN" | "en-US"): string { const labels: Record<string, [string, string]> = { conversation: ["标题", "Title"], message: ["正文", "Message"], heading: ["章节", "Section"], code: ["代码", "Code"] }; const label = labels[value]; return label ? label[locale === "zh-CN" ? 0 : 1] : value; }
function roleLabel(value: string, locale: "zh-CN" | "en-US"): string { return value === "user" ? (locale === "zh-CN" ? "用户" : "User") : value === "assistant" ? "ChatGPT" : value; }
