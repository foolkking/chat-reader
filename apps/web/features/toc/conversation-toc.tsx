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
  onNavigate?: (item: TocItem) => void;
}) {
  const [observedHeadingId, setObservedHeadingId] = useState<string | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const tocQuery = useQuery({
    queryKey: ["toc", conversationId],
    queryFn: () => getConversationToc(conversationId),
    enabled: items === undefined,
  });

  const allItems = items ?? tocQuery.data?.items ?? [];
  const visibleItems = useMemo(() => {
    if (!activeMessageId) {
      return [];
    }
    const apiActiveItems = allItems.filter((item) => item.message_id === activeMessageId);
    if (apiActiveItems.length > 0) {
      return apiActiveItems;
    }
    return activeItems.filter((item) => item.message_id === activeMessageId);
  }, [activeItems, activeMessageId, allItems]);
  const activeHeadingId = activeBlockId ?? observedHeadingId;

  useEffect(() => {
    if (visibleItems.length === 0) {
      setObservedHeadingId(null);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
        const first = visible[0];
        if (first?.target.id) {
          setObservedHeadingId(first.target.id);
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.2, 0.8] },
    );

    for (const item of visibleItems) {
      const target = document.getElementById(blockDomId(item));
      if (target) {
        observer.observe(target);
      }
    }
    return () => observer.disconnect();
  }, [observerKey, visibleItems]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeHeadingId, visibleItems]);

  if (items === undefined && tocQuery.isLoading) {
    return <TocShell mode={mode} label="正在加载章节目录" />;
  }
  if (items === undefined && tocQuery.isError) {
    return <TocShell mode={mode} label={tocQuery.error.message} />;
  }
  if (allItems.length === 0 && activeItems.length === 0) {
    return <TocShell mode={mode} label="暂无章节标题" />;
  }
  if (visibleItems.length === 0) {
    return <TocShell mode={mode} label="当前对话无章节" />;
  }

  if (mode === "sheet") {
    return (
      <section aria-label="章节目录" className="max-h-[60vh] overflow-y-auto">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-normal text-[#6b7280]">章节目录</h2>
        <TocButtonList
          items={visibleItems}
          activeHeadingId={activeHeadingId}
          activeRowRef={activeRowRef}
          onNavigate={onNavigate}
        />
      </section>
    );
  }

  return (
    <aside aria-label="章节目录" className="w-64 rounded-2xl border border-[#e5e7eb] bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">章节目录</h2>
        <span className="text-[11px] text-[#9ca3af]">{visibleItems.length}</span>
      </div>
      <div className="max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
        <TocButtonList
          items={visibleItems}
          activeHeadingId={activeHeadingId}
          activeRowRef={activeRowRef}
          onNavigate={onNavigate}
        />
      </div>
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
  onNavigate?: (item: TocItem) => void;
}) {
  return (
    <nav className="space-y-1 border-l border-[#e5e7eb] pl-2">
      {items.map((item) => {
        const isActive = blockDomId(item) === activeHeadingId;
        return (
          <button
            key={item.id}
            ref={isActive ? activeRowRef : undefined}
            type="button"
            onClick={() => {
              if (onNavigate) {
                onNavigate(item);
              } else {
                scrollToTocTarget(item);
              }
            }}
            className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg px-1 text-left text-sm text-[#374151] hover:bg-[#f7f7f8] hover:text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10a37f]"
            style={{ paddingLeft: `${Math.max(0, item.level - 1) * 10 + 4}px` }}
          >
            <span
              className={`h-5 w-0.5 shrink-0 rounded-full ${
                isActive ? "bg-[#f59e0b]" : item.level <= 2 ? "bg-[#4f46e5]" : "bg-[#c7d2fe]"
              }`}
            />
            <span
              className={`min-w-0 truncate text-xs leading-6 ${
                isActive ? "font-semibold text-[#b45309]" : item.level <= 2 ? "font-medium text-[#374151]" : "text-[#6b7280]"
              }`}
            >
              {item.text}
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-[#9ca3af]">H{item.level}</span>
          </button>
        );
      })}
    </nav>
  );
}

function TocShell({ label, mode }: { label: string; mode: "panel" | "sheet" }) {
  const className =
    mode === "sheet"
      ? "text-sm text-[#6b7280]"
      : "w-64 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-sm text-[#6b7280] shadow-sm";
  return <aside className={className} aria-label="章节目录">{label}</aside>;
}

function blockDomId(item: TocItem): string {
  return `block-${item.message_id}-${item.block_index}`;
}

function scrollToTocTarget(item: TocItem) {
  const block = document.getElementById(blockDomId(item));
  const message = document.getElementById(`message-${item.message_id}`);
  (block ?? message)?.scrollIntoView({ block: "start", behavior: "smooth" });
}
