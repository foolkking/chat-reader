"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslations } from "../../components/preferences-provider";
import { getConversationToc } from "../../lib/api";
import type { TocItem } from "../../lib/types";

export function ConversationToc({ conversationId, activeMessageId, activeItems = [], observerKey, activeBlockId, items, mode = "panel", onNavigate }: { conversationId: string; activeMessageId?: string | null; activeItems?: TocItem[]; observerKey?: string; activeBlockId?: string | null; items?: TocItem[]; mode?: "panel" | "sheet"; onNavigate?: (item: TocItem) => void | Promise<void>; }) {
  const t = useTranslations();
  const [observedHeadingId, setObservedHeadingId] = useState<string | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const tocQuery = useQuery({ queryKey: ["toc", conversationId, activeMessageId], queryFn: () => getConversationToc(conversationId, { messageId: activeMessageId ?? undefined, limit: 200 }), enabled: items === undefined && Boolean(activeMessageId), staleTime: 30_000 });
  const visibleItems = useMemo(() => { if (!activeMessageId) return []; const apiItems = items ?? tocQuery.data?.items ?? []; const currentApiItems = apiItems.filter((item) => item.message_id === activeMessageId); return currentApiItems.length ? currentApiItems : activeItems.filter((item) => item.message_id === activeMessageId); }, [activeItems, activeMessageId, items, tocQuery.data?.items]);
  const activeHeadingId = activeBlockId ?? observedHeadingId;

  useEffect(() => {
    if (!visibleItems.length) { setObservedHeadingId(null); return; }
    const observer = new IntersectionObserver((entries) => { const first = entries.filter((entry) => entry.isIntersecting).sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))[0]; if (first?.target.id) setObservedHeadingId(first.target.id); }, { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.2, 0.8] });
    for (const item of visibleItems) { const target = document.getElementById(blockDomId(item)); if (target) observer.observe(target); }
    return () => observer.disconnect();
  }, [observerKey, visibleItems]);
  useEffect(() => { activeRowRef.current?.scrollIntoView({ block: "nearest" }); }, [activeHeadingId, visibleItems]);

  if (items === undefined && tocQuery.isLoading && activeItems.length === 0) return <TocShell mode={mode} label={t("sectionToc")} />;
  if (items === undefined && tocQuery.isError && activeItems.length === 0) return <TocShell mode={mode} label={t("connectionFailed")} />;
  if (!activeMessageId || visibleItems.length === 0) return <TocShell mode={mode} label={t("currentNoSections")} />;

  const body = <TocButtonList items={visibleItems} activeHeadingId={activeHeadingId} activeRowRef={activeRowRef} onNavigate={onNavigate} />;
  return <TocFrame mode={mode} title={t("sectionToc")} count={visibleItems.length}>{body}</TocFrame>;
}

function TocButtonList({ items, activeHeadingId, activeRowRef, onNavigate }: { items: TocItem[]; activeHeadingId: string | null; activeRowRef: MutableRefObject<HTMLButtonElement | null>; onNavigate?: (item: TocItem) => void | Promise<void>; }) {
  return <nav className="space-y-0.5">{items.map((item) => { const active = blockDomId(item) === activeHeadingId; return <button key={item.id} ref={active ? activeRowRef : undefined} type="button" onClick={() => void onNavigate?.(item)} className={`flex min-h-9 w-full min-w-0 items-start gap-2 rounded-md px-1 py-1.5 text-left text-sm leading-5 hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${active ? "font-semibold text-amber-600" : item.level <= 2 ? "font-medium text-primary" : "text-secondary"}`} style={{ paddingLeft: `${Math.max(0, item.level - 1) * 8 + 4}px` }}><span className={`mt-0.5 h-5 w-0.5 shrink-0 rounded-full ${active ? "bg-amber-500" : item.level <= 2 ? "bg-indigo-500" : "bg-indigo-200"}`} /><span className="line-clamp-2 min-w-0 flex-1">{item.text}</span></button>; })}</nav>;
}

function TocFrame({ mode, title, count, children }: { mode: "panel" | "sheet"; title: string; count?: number; children: React.ReactNode }) {
  return <aside aria-label={title} className={`flex min-h-0 w-full flex-col overflow-hidden bg-raised ${mode === "panel" ? "h-full rounded-xl border border-ui shadow-lg" : "max-h-[60vh]"}`}><div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-ui bg-raised px-3 py-3"><h2 className="text-[15px] font-semibold text-primary">{title}</h2>{count !== undefined ? <span className="text-[13px] text-secondary">{count}</span> : null}</div><div className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2 text-[14px] leading-6">{children}</div></aside>;
}

function TocShell({ label, mode }: { label: string; mode: "panel" | "sheet" }) {
  const t = useTranslations();
  return <TocFrame mode={mode} title={t("sectionToc")}><p className="px-1 py-2 text-sm leading-6 text-secondary">{label}</p></TocFrame>;
}
function blockDomId(item: TocItem): string { return `block-${item.message_id}-${item.block_index}`; }
