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

  if (!activeMessageId || visibleItems.length === 0) return <TocShell mode={mode} label={t("currentNoSections")} />;
  if (items === undefined && tocQuery.isLoading && activeItems.length === 0) return <TocShell mode={mode} label={t("sectionToc")} />;
  if (items === undefined && tocQuery.isError && activeItems.length === 0) return <TocShell mode={mode} label={t("connectionFailed")} />;

  const body = <TocButtonList items={visibleItems} activeHeadingId={activeHeadingId} activeRowRef={activeRowRef} onNavigate={onNavigate} />;
  if (mode === "sheet") return <section aria-label={t("sectionToc")} className="max-h-[60vh] overflow-y-auto">{body}</section>;
  return <aside aria-label={t("sectionToc")} className="w-full border-l border-ui pl-[clamp(0.75rem,1vw,1.25rem)]"><div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-semibold text-secondary">{t("sectionToc")}</h2><span className="text-[11px] text-secondary">{visibleItems.length}</span></div><div className="max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">{body}</div></aside>;
}

function TocButtonList({ items, activeHeadingId, activeRowRef, onNavigate }: { items: TocItem[]; activeHeadingId: string | null; activeRowRef: MutableRefObject<HTMLButtonElement | null>; onNavigate?: (item: TocItem) => void | Promise<void>; }) {
  return <nav className="space-y-0.5 border-l border-ui pl-2">{items.map((item) => { const active = blockDomId(item) === activeHeadingId; return <button key={item.id} ref={active ? activeRowRef : undefined} type="button" onClick={() => void onNavigate?.(item)} className={`flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${active ? "font-semibold text-amber-600" : item.level <= 2 ? "font-medium text-primary" : "text-secondary"}`} style={{ paddingLeft: `${Math.max(0, item.level - 1) * 10 + 4}px` }}><span className={`h-5 w-0.5 shrink-0 rounded-full ${active ? "bg-amber-500" : item.level <= 2 ? "bg-indigo-500" : "bg-indigo-200"}`} /><span className="min-w-0 flex-1 truncate">{item.text}</span></button>; })}</nav>;
}

function TocShell({ label, mode }: { label: string; mode: "panel" | "sheet" }) { return <aside className={mode === "sheet" ? "text-sm text-secondary" : "w-full border-l border-ui py-2 pl-4 text-sm text-secondary"}>{label}</aside>; }
function blockDomId(item: TocItem): string { return `block-${item.message_id}-${item.block_index}`; }
