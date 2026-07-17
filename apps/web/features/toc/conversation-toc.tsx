"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { getConversationToc } from "../../lib/api";
import type { TocItem } from "../../lib/types";

export function ConversationToc({
  conversationId,
  activeMessageId,
  activeItems = [],
  observerKey,
  activeBlockId,
  items,
  mode = "panel",
  onNavigate,
}: {
  conversationId: string;
  activeMessageId?: string | null;
  activeItems?: TocItem[];
  observerKey?: string;
  activeBlockId?: string | null;
  items?: TocItem[];
  mode?: "panel" | "sheet";
  onNavigate?: (item: TocItem) => void | Promise<void>;
}) {
  const [observedHeadingId, setObservedHeadingId] = useState<string | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const tocQuery = useQuery({
    queryKey: ["toc", conversationId, activeMessageId],
    queryFn: () => getConversationToc(conversationId, { messageId: activeMessageId ?? undefined, limit: 200 }),
    enabled: items === undefined && Boolean(activeMessageId),
    staleTime: 30_000,
  });

  const visibleItems = useMemo(() => {
    if (!activeMessageId) return [];
    const apiItems = items ?? tocQuery.data?.items ?? [];
    const currentApiItems = apiItems.filter((item) => item.message_id === activeMessageId);
    return currentApiItems.length > 0
      ? currentApiItems
      : activeItems.filter((item) => item.message_id === activeMessageId);
  }, [activeItems, activeMessageId, items, tocQuery.data?.items]);
  const activeHeadingId = activeBlockId ?? observedHeadingId;

  useEffect(() => {
    if (visibleItems.length === 0) {
      setObservedHeadingId(null);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))[0];
        if (first?.target.id) setObservedHeadingId(first.target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.2, 0.8] },
    );
    for (const item of visibleItems) {
      const target = document.getElementById(blockDomId(item));
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [observerKey, visibleItems]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeHeadingId, visibleItems]);

  if (!activeMessageId) return <TocShell mode={mode} label="滚动到一条消息后显示章节" />;
  if (items === undefined && tocQuery.isLoading && activeItems.length === 0) return <TocShell mode={mode} label="正在加载章节目录" />;
  if (items === undefined && tocQuery.isError && activeItems.length === 0) return <TocShell mode={mode} label="章节目录加载失败" />;
  if (visibleItems.length === 0) return <TocShell mode={mode} label="当前消息无章节" />;

  const body = (
    <TocButtonList
      items={visibleItems}
      activeHeadingId={activeHeadingId}
      activeRowRef={activeRowRef}
      onNavigate={onNavigate}
    />
  );
  if (mode === "sheet") {
    return <section aria-label="章节目录" className="max-h-[60vh] overflow-y-auto">{body}</section>;
  }
  return (
    <aside aria-label="章节目录" className="w-64 border-l border-[#e5e7eb] pl-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-[#6b7280]">章节目录</h2>
        <span className="text-[11px] text-[#9ca3af]">{visibleItems.length}</span>
      </div>
      <div className="max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">{body}</div>
    </aside>
  );
}

function TocButtonList({
  items,
  activeHeadingId,
  activeRowRef,
  onNavigate,
}: {
  items: TocItem[];
  activeHeadingId: string | null;
  activeRowRef: MutableRefObject<HTMLButtonElement | null>;
  onNavigate?: (item: TocItem) => void | Promise<void>;
}) {
  return (
    <nav className="space-y-0.5 border-l border-[#e5e7eb] pl-2">
      {items.map((item) => {
        const active = blockDomId(item) === activeHeadingId;
        return (
          <button
            key={item.id}
            ref={active ? activeRowRef : undefined}
            type="button"
            onClick={() => void onNavigate?.(item)}
            className={`flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f] ${active ? "font-semibold text-[#b45309]" : item.level <= 2 ? "font-medium text-[#374151]" : "text-[#6b7280]"}`}
            style={{ paddingLeft: `${Math.max(0, item.level - 1) * 10 + 4}px` }}
          >
            <span className={`h-5 w-0.5 shrink-0 rounded-full ${active ? "bg-[#f59e0b]" : item.level <= 2 ? "bg-[#4f46e5]" : "bg-[#c7d2fe]"}`} />
            <span className="min-w-0 flex-1 truncate">{item.text}</span>
          </button>
        );
      })}
    </nav>
  );
}

function TocShell({ label, mode }: { label: string; mode: "panel" | "sheet" }) {
  return <aside className={mode === "sheet" ? "text-sm text-[#6b7280]" : "w-64 border-l border-[#e5e7eb] py-2 pl-4 text-sm text-[#6b7280]"}>{label}</aside>;
}

function blockDomId(item: TocItem): string {
  return `block-${item.message_id}-${item.block_index}`;
}
