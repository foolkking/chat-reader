"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getConversationDialogueIndex } from "../../lib/api";
import type { DialogueIndexItem, DialogueIndexResponse, MessageListItem } from "../../lib/types";

const AROUND_WINDOW = 24;

export type ConversationIndexItem = {
  messageId: string;
  role: string;
  roleNumber: string;
  orderKey: string;
  preview: string;
  turnIndex: number | null;
  ordinal: number;
};

export function ConversationIndex({
  conversationId,
  messages,
  activeMessageId,
  ready = true,
  mode = "rail",
  loadPage,
  onNavigate,
}: {
  conversationId: string;
  messages?: MessageListItem[];
  activeMessageId?: string | null;
  ready?: boolean;
  mode?: "rail" | "sheet";
  loadPage?: (options: { offset?: number; limit?: number; anchorMessageId?: string }) => Promise<DialogueIndexResponse>;
  onNavigate?: (item: ConversationIndexItem) => void | Promise<void>;
}) {
  const [showFilter, setShowFilter] = useState(false);
  const [rangeMode, setRangeMode] = useState<"all" | "around" | "custom">("around");
  const [hideBefore, setHideBefore] = useState("");
  const [hideAfter, setHideAfter] = useState("");
  const [requestedAnchor, setRequestedAnchor] = useState<string | null>(activeMessageId ?? null);
  const [remotePage, setRemotePage] = useState<DialogueIndexResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  const indexQuery = useQuery({
    queryKey: ["conversation-index", conversationId, requestedAnchor],
    queryFn: () => (loadPage ?? ((options) => getConversationDialogueIndex(conversationId, options)))({
      anchorMessageId: requestedAnchor ?? undefined,
      limit: 80,
    }),
    enabled: messages === undefined && ready,
    staleTime: 60_000,
  });

  useEffect(() => {
    setRequestedAnchor(activeMessageId ?? null);
    setRemotePage(null);
  }, [conversationId]);

  useEffect(() => {
    if (indexQuery.data) setRemotePage(indexQuery.data);
  }, [indexQuery.data]);

  const items = useMemo(() => {
    if (messages) return buildItemsFromMessages(messages);
    return (remotePage?.items ?? []).map(toIndexItem);
  }, [messages, remotePage?.items]);

  useEffect(() => {
    if (messages !== undefined || !activeMessageId || items.some((item) => item.messageId === activeMessageId)) {
      return;
    }
    setRequestedAnchor(activeMessageId);
  }, [activeMessageId, items, messages]);

  const activeOrdinal = items.find((item) => item.messageId === activeMessageId)?.ordinal ?? null;
  const visibleItems = useMemo(
    () => applyFilter(items, rangeMode, hideBefore, hideAfter, activeOrdinal),
    [activeOrdinal, hideAfter, hideBefore, items, rangeMode],
  );

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeMessageId, visibleItems]);

  if (messages === undefined && (!ready || indexQuery.isLoading) && !remotePage) {
    return <IndexShell mode={mode} label="正在加载对话索引" />;
  }
  if (messages === undefined && indexQuery.isError && !remotePage) {
    return <IndexShell mode={mode} label="对话索引加载失败" />;
  }
  if (items.length === 0) return <IndexShell mode={mode} label="暂无对话消息" />;

  const shellClass = mode === "sheet"
    ? "max-h-[65vh] overflow-y-auto"
    : "group relative z-[100] w-8 overflow-visible transition-all duration-150 hover:w-80 focus-within:w-80";
  const listClass = mode === "sheet"
    ? "max-h-[54vh] overflow-y-auto pr-1"
    : "max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden rounded-lg border border-transparent py-2 transition-all group-hover:border-[#e5e7eb] group-hover:bg-white group-hover:px-3 group-hover:shadow-lg group-focus-within:border-[#e5e7eb] group-focus-within:bg-white group-focus-within:px-3";

  return (
    <section className={shellClass} aria-label="对话索引">
      <div className="relative mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowFilter((value) => !value)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#d1d5db] bg-white text-xs font-semibold text-[#374151] shadow-sm hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f]"
          aria-label="筛选对话索引"
          title="筛选对话索引"
        >
          #
        </button>
        <div className={`${mode === "sheet" ? "block" : "hidden group-hover:block group-focus-within:block"} min-w-0`}>
          <h2 className="text-xs font-semibold text-[#6b7280]">对话索引</h2>
          <p className="text-[11px] text-[#9ca3af]">
            显示 {visibleItems.length} / {remotePage?.message_count ?? items.length} 条消息
          </p>
        </div>
        {showFilter ? (
          <FilterPopover
            rangeMode={rangeMode}
            hideBefore={hideBefore}
            hideAfter={hideAfter}
            onRangeModeChange={setRangeMode}
            onHideBeforeChange={setHideBefore}
            onHideAfterChange={setHideAfter}
            onClose={() => setShowFilter(false)}
          />
        ) : null}
      </div>
      <nav className={listClass}>
        <div className="space-y-1">
          {visibleItems.map((item) => {
            const active = item.messageId === activeMessageId;
            return (
              <button
                key={item.messageId}
                ref={active ? activeRowRef : undefined}
                type="button"
                onClick={() => void onNavigate?.(item)}
                title={`${item.roleNumber} · ${item.preview || item.orderKey}`}
                className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md text-left hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f]"
              >
                <span className={`h-0.5 shrink-0 rounded-full ${active ? "w-7 bg-[#f59e0b]" : `w-5 ${roleLineClass(item.role)}`}`} />
                <span className={`${mode === "sheet" ? "inline-flex" : "hidden group-hover:inline-flex group-focus-within:inline-flex"} h-5 min-w-8 shrink-0 items-center justify-center rounded bg-[#f3f4f6] px-1 text-[10px] font-semibold text-[#6b7280]`}>
                  {item.roleNumber}
                </span>
                <span className={`${mode === "sheet" ? "block" : "hidden group-hover:block group-focus-within:block"} min-w-0 flex-1 truncate text-xs leading-6 ${active ? "font-semibold text-[#b45309]" : "text-[#374151]"}`}>
                  {item.preview || "无预览"}
                </span>
              </button>
            );
          })}
          {messages === undefined && remotePage && (remotePage.has_previous || remotePage.has_more) ? (
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                disabled={!remotePage.has_previous || pageLoading}
                onClick={() => void loadIndexPage("previous")}
                className="min-h-8 rounded-md border border-[#e5e7eb] px-2 text-xs text-[#6b7280] disabled:opacity-40"
              >
                上一段
              </button>
              <button
                type="button"
                disabled={!remotePage.has_more || pageLoading}
                onClick={() => void loadIndexPage("next")}
                className="min-h-8 rounded-md border border-[#e5e7eb] px-2 text-xs text-[#6b7280] disabled:opacity-40"
              >
                下一段
              </button>
            </div>
          ) : null}
        </div>
      </nav>
    </section>
  );

  async function loadIndexPage(direction: "previous" | "next") {
    if (!remotePage || pageLoading) return;
    const nextOffset = direction === "previous"
      ? Math.max(0, remotePage.offset - remotePage.limit)
      : remotePage.offset + remotePage.items.length;
    setPageLoading(true);
    try {
      const page = await (loadPage ?? ((options) => getConversationDialogueIndex(conversationId, options)))({
        offset: nextOffset,
        limit: remotePage.limit,
      });
      setRemotePage((current) => mergeIndexPages(current, page));
    } finally {
      setPageLoading(false);
    }
  }
}

function mergeIndexPages(current: DialogueIndexResponse | null, incoming: DialogueIndexResponse): DialogueIndexResponse {
  if (!current) return incoming;
  const byId = new Map(current.items.map((item) => [item.message_id, item]));
  for (const item of incoming.items) byId.set(item.message_id, item);
  const items = Array.from(byId.values()).sort((left, right) => left.ordinal - right.ordinal);
  const offset = Math.min(current.offset, incoming.offset);
  return {
    ...incoming,
    items,
    offset,
    has_previous: offset > 0,
    has_more: offset + items.length < incoming.total,
  };
}

function toIndexItem(item: DialogueIndexItem): ConversationIndexItem {
  return {
    messageId: item.message_id,
    role: item.role,
    roleNumber: roleLabel(item.role, item.role_number),
    orderKey: item.order_key,
    preview: item.preview,
    turnIndex: item.turn_index,
    ordinal: item.ordinal,
  };
}

function buildItemsFromMessages(messages: MessageListItem[]): ConversationIndexItem[] {
  const counts: Record<string, number> = {};
  return messages.map((message, index) => {
    counts[message.role] = (counts[message.role] ?? 0) + 1;
    return {
      messageId: message.id,
      role: message.role,
      roleNumber: roleLabel(message.role, counts[message.role]),
      orderKey: message.order_key,
      preview: message.content_preview ?? message.current_version?.display_text?.replace(/\s+/g, " ").slice(0, 160) ?? "",
      turnIndex: message.turn_index ?? null,
      ordinal: message.ordinal ?? index + 1,
    };
  });
}

function roleLabel(role: string, number: number): string {
  if (role === "user") return `U${number}`;
  if (role === "assistant") return `A${number}`;
  return `${role.slice(0, 1).toUpperCase() || "?"}${number}`;
}

function applyFilter(
  items: ConversationIndexItem[],
  mode: "all" | "around" | "custom",
  hideBefore: string,
  hideAfter: string,
  activeOrdinal: number | null,
): ConversationIndexItem[] {
  if (mode === "around") {
    const center = activeOrdinal ?? items[0]?.ordinal ?? 1;
    return items.filter((item) => Math.abs(item.ordinal - center) <= AROUND_WINDOW);
  }
  if (mode === "all") return items;
  const before = positiveNumber(hideBefore);
  const after = positiveNumber(hideAfter);
  return items.filter((item) => (before === null || item.ordinal > before) && (after === null || item.ordinal < after));
}

function positiveNumber(value: string): number | null {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function roleLineClass(role: string): string {
  if (role === "user") return "bg-[#10a37f]";
  if (role === "assistant") return "bg-[#4f46e5]";
  return "bg-[#9ca3af]";
}

function IndexShell({ mode, label }: { mode: "rail" | "sheet"; label: string }) {
  return <section className={mode === "sheet" ? "text-sm text-[#6b7280]" : "w-8 py-2 text-xs text-[#9ca3af]"}>{label}</section>;
}

function FilterPopover({
  rangeMode,
  hideBefore,
  hideAfter,
  onRangeModeChange,
  onHideBeforeChange,
  onHideAfterChange,
  onClose,
}: {
  rangeMode: "all" | "around" | "custom";
  hideBefore: string;
  hideAfter: string;
  onRangeModeChange: (mode: "all" | "around" | "custom") => void;
  onHideBeforeChange: (value: string) => void;
  onHideAfterChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute left-0 top-9 z-[120] w-64 rounded-lg border border-[#e5e7eb] bg-white p-3 text-sm shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-[#111827]">索引范围</span>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-[#6b7280] hover:bg-[#f7f7f8]">关闭</button>
      </div>
      <div className="grid gap-1">
        {(["around", "all", "custom"] as const).map((itemMode) => (
          <button
            key={itemMode}
            type="button"
            onClick={() => onRangeModeChange(itemMode)}
            className={`rounded-md px-3 py-2 text-left ${rangeMode === itemMode ? "bg-[#ecfdf5] text-[#047857]" : "hover:bg-[#f7f7f8]"}`}
          >
            {itemMode === "around" ? "围绕当前" : itemMode === "all" ? "显示已加载" : "自定义范围"}
          </button>
        ))}
        {rangeMode === "custom" ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-[#6b7280]">隐藏前 N 条<input value={hideBefore} onChange={(event) => onHideBeforeChange(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-[#d1d5db] px-2 py-1.5" /></label>
            <label className="text-xs text-[#6b7280]">隐藏后 N 条<input value={hideAfter} onChange={(event) => onHideAfterChange(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-[#d1d5db] px-2 py-1.5" /></label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
