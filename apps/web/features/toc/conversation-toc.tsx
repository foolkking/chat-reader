"use client";

import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslations } from "../../components/preferences-provider";
import { usePreferences } from "../../components/preferences-provider";
import { PanelRightOpen, PinOff } from "lucide-react";
import { getConversationToc } from "../../lib/api";
import type { TocItem } from "../../lib/types";
import { markdownHeadingLabel } from "../conversations/markdown-renderer";

export function ConversationToc({ conversationId, sourceKey = "remote", activeMessageId, activeItems = [], activeBlockId, activeHeadingId: suppliedActiveHeadingId, items, mode = "panel", loadPage, onNavigate }: { conversationId: string; sourceKey?: string; activeMessageId?: string | null; activeItems?: TocItem[]; observerKey?: string; activeBlockId?: string | null; activeHeadingId?: string | null; items?: TocItem[]; mode?: "panel" | "sheet"; loadPage?: (options: { messageId?: string; offset?: number; limit?: number; maxLevel?: number }) => Promise<{ items: TocItem[] }>; onNavigate?: (item: TocItem) => void | Promise<void>; }) {
  const t = useTranslations();
  const { sectionTocMode, setSectionTocMode } = usePreferences();
  const [cachedItems, setCachedItems] = useState<Record<string, TocItem[]>>({});
  const [lastActiveMessageId, setLastActiveMessageId] = useState<string | null>(activeMessageId ?? null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);
  const stableNavigate = useCallback((item: TocItem) => onNavigateRef.current?.(item), []);
  const collapse = useCallback(() => { void setSectionTocMode("rail"); }, [setSectionTocMode]);
  const expand = useCallback(() => { void setSectionTocMode("visible"); }, [setSectionTocMode]);
  useEffect(() => {
    setCachedItems({});
    setLastActiveMessageId(activeMessageId ?? null);
  }, [conversationId, sourceKey]);
  useEffect(() => { if (activeMessageId) setLastActiveMessageId(activeMessageId); }, [activeMessageId]);
  const effectiveMessageId = activeMessageId ?? lastActiveMessageId;
  const tocQuery = useQuery({ queryKey: ["toc", sourceKey, conversationId, effectiveMessageId, mode], queryFn: () => (loadPage ?? ((options) => getConversationToc(conversationId, options)))({ messageId: effectiveMessageId ?? undefined, limit: 200 }), enabled: items === undefined && Boolean(effectiveMessageId), staleTime: 30_000, placeholderData: (previous) => previous });
  useEffect(() => {
    if (!effectiveMessageId || !tocQuery.data) return;
    const matching = tocQuery.data.items.filter((item) => item.message_id === effectiveMessageId);
    // An empty canonical response is meaningful after a manual TOC rebuild:
    // replace the previous entry as well so removed headings cannot survive in
    // the local fallback cache.
    setCachedItems((current) => ({ ...current, [effectiveMessageId]: matching }));
  }, [effectiveMessageId, tocQuery.data]);
  const visibleItems = useMemo(() => {
    if (!effectiveMessageId) return [];
    const cached = cachedItems[effectiveMessageId] ?? [];
    const apiItems = items ?? tocQuery.data?.items ?? cached;
    const currentApiItems = apiItems.filter((item) => item.message_id === effectiveMessageId);
    if (currentApiItems.length) return currentApiItems;
    const currentCachedItems = cached.filter((item) => item.message_id === effectiveMessageId);
    return currentCachedItems.length ? currentCachedItems : activeItems.filter((item) => item.message_id === effectiveMessageId);
  }, [activeItems, cachedItems, effectiveMessageId, items, tocQuery.data?.items]);
  const activeHeadingId = suppliedActiveHeadingId ?? resolveActiveHeadingId(visibleItems, activeBlockId);

  useEffect(() => {
    const row = activeRowRef.current;
    const container = scrollContainerRef.current;
    if (!row || !container || container.clientHeight === 0) return;
    const frame = window.requestAnimationFrame(() => {
      const rowRect = row.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const rowTop = rowRect.top - containerRect.top + container.scrollTop;
      const rowHeight = Math.max(1, rowRect.height);
      const centeredTop = rowTop - Math.max(0, (container.clientHeight - rowHeight) / 2);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, centeredTop));
      if (Math.abs(container.scrollTop - nextTop) > 1) container.scrollTop = nextTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeHeadingId, visibleItems]);

  if (mode === "panel" && sectionTocMode === "rail") return <TocRail items={visibleItems} activeHeadingId={activeHeadingId} onExpand={expand} onNavigate={stableNavigate} />;
  if (items === undefined && tocQuery.isFetching && visibleItems.length === 0) return <TocShell mode={mode} label={t("sectionToc")} onCollapse={mode === "panel" ? collapse : undefined} />;
  if (items === undefined && tocQuery.isError && visibleItems.length === 0) return <TocShell mode={mode} label={t("connectionFailed")} onCollapse={mode === "panel" ? collapse : undefined} />;
  if (!effectiveMessageId || visibleItems.length === 0) return <TocShell mode={mode} label={t("currentNoSections")} onCollapse={mode === "panel" ? collapse : undefined} />;

  const body = <TocButtonList items={visibleItems} activeHeadingId={activeHeadingId} activeRowRef={activeRowRef} onNavigate={stableNavigate} />;
  return <TocFrame mode={mode} title={t("sectionToc")} count={visibleItems.length} scrollContainerRef={scrollContainerRef} onCollapse={mode === "panel" ? collapse : undefined}>{body}</TocFrame>;
}

const TocRail = memo(function TocRail({ items, activeHeadingId, onExpand, onNavigate }: { items: TocItem[]; activeHeadingId: string | null; onExpand: () => void; onNavigate?: (item: TocItem) => void | Promise<void> }) {
  return <aside className="flex h-full w-full flex-col items-center border-l border-ui bg-raised py-2" aria-label="章节刻度"><button type="button" onClick={onExpand} className="flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="展开章节目录" title="展开章节目录"><PanelRightOpen className="h-4 w-4" /></button><div className="my-2 h-px w-5 bg-[var(--border)]" /><nav className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 overflow-hidden">{items.slice(0, 80).map((item) => { const active = blockDomId(item) === activeHeadingId; const label = markdownHeadingLabel(item.text) || item.text; return <button key={item.id} type="button" onClick={() => void onNavigate?.(item)} className={`block rounded-full transition-[width,height,background-color] ${active ? "h-2.5 w-5 bg-amber-500" : item.level <= 2 ? "h-1.5 w-4 bg-indigo-500" : "h-1 w-2.5 bg-indigo-200"}`} aria-label={label} title={label} />; })}</nav></aside>;
});

const TocButtonList = memo(function TocButtonList({ items, activeHeadingId, activeRowRef, onNavigate }: { items: TocItem[]; activeHeadingId: string | null; activeRowRef: MutableRefObject<HTMLButtonElement | null>; onNavigate?: (item: TocItem) => void | Promise<void>; }) {
  return <nav className="space-y-0.5">{items.map((item) => { const blockId = blockDomId(item); const active = blockId === activeHeadingId; const label = markdownHeadingLabel(item.text) || item.text; return <button key={item.id} ref={active ? activeRowRef : undefined} type="button" data-toc-block-id={blockId} data-toc-active={active ? "true" : undefined} onClick={() => void onNavigate?.(item)} aria-label={label} title={label} className={`flex min-h-9 w-full min-w-0 items-start gap-2 rounded-md px-1 py-1.5 text-left text-sm leading-5 hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${active ? "font-semibold text-amber-600" : item.level <= 2 ? "font-medium text-primary" : "text-secondary"}`} style={{ paddingLeft: `${Math.max(0, item.level - 1) * 8 + 4}px` }}><span className={`mt-0.5 h-5 w-0.5 shrink-0 rounded-full ${active ? "bg-amber-500" : item.level <= 2 ? "bg-indigo-500" : "bg-indigo-200"}`} /><span className="line-clamp-2 min-w-0 flex-1">{label}</span></button>; })}</nav>;
});

function TocFrame({ mode, title, count, children, onCollapse, scrollContainerRef }: { mode: "panel" | "sheet"; title: string; count?: number; children: React.ReactNode; onCollapse?: () => void; scrollContainerRef?: MutableRefObject<HTMLDivElement | null> }) {
  return <aside aria-label={title} className={`flex min-h-0 w-full flex-col overflow-hidden bg-raised ${mode === "panel" ? "h-full rounded-md border border-ui shadow-lg" : "max-h-[60vh]"}`}><div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-ui bg-raised px-3 py-3"><h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-primary">{title}</h2>{count !== undefined ? <span className="text-[13px] text-secondary">{count}</span> : null}{onCollapse ? <button type="button" onClick={onCollapse} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="收起章节目录" title="收起章节目录"><PinOff className="h-4 w-4" /></button> : null}</div><div ref={scrollContainerRef} data-section-toc-scroll="true" className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2 text-[14px] leading-6">{children}</div></aside>;
}

function TocShell({ label, mode, onCollapse }: { label: string; mode: "panel" | "sheet"; onCollapse?: () => void }) {
  const t = useTranslations();
  return <TocFrame mode={mode} title={t("sectionToc")} onCollapse={onCollapse}><p className="px-1 py-2 text-sm leading-6 text-secondary">{label}</p></TocFrame>;
}
function blockDomId(item: TocItem): string { return `block-${item.message_id}-${item.block_index}`; }

export function resolveActiveHeadingId(items: TocItem[], activeBlockId?: string | null): string | null {
  if (!activeBlockId) return null;
  const exact = items.find((item) => blockDomId(item) === activeBlockId);
  if (exact) return activeBlockId;
  const blockIndex = Number.parseInt(activeBlockId.split("-").at(-1) ?? "", 10);
  if (!Number.isFinite(blockIndex)) return null;
  const nearest = items.reduce<TocItem | null>((current, item) => (
    item.block_index <= blockIndex && (!current || item.block_index > current.block_index)
      ? item
      : current
  ), null);
  return nearest ? blockDomId(nearest) : null;
}
