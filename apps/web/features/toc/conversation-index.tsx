"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getConversationMessageWindow } from "../../lib/api";
import type { MessageListItem } from "../../lib/types";
import { stripLeadingTimestamp } from "../conversations/markdown-renderer";

const INDEX_PAGE_SIZE = 200;
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
  mode = "rail",
  onNavigate,
}: {
  conversationId: string;
  messages?: MessageListItem[];
  activeMessageId?: string | null;
  mode?: "rail" | "sheet";
  onNavigate?: (item: ConversationIndexItem) => void;
}) {
  const [showFilter, setShowFilter] = useState(false);
  const [rangeMode, setRangeMode] = useState<"all" | "around" | "custom">("all");
  const [hideBefore, setHideBefore] = useState("");
  const [hideAfter, setHideAfter] = useState("");
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const indexQuery = useQuery({
    queryKey: ["conversation-index", conversationId],
    queryFn: () => loadConversationIndex(conversationId),
    enabled: messages === undefined,
    staleTime: 60_000,
  });

  const items = useMemo(
    () => (messages ? buildIndexItems(messages) : indexQuery.data ?? []),
    [indexQuery.data, messages],
  );
  const activeOrdinal = items.find((item) => item.messageId === activeMessageId)?.ordinal ?? null;
  const visibleItems = useMemo(
    () => applyIndexFilter(items, rangeMode, hideBefore, hideAfter, activeOrdinal),
    [activeOrdinal, hideAfter, hideBefore, items, rangeMode],
  );

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeMessageId, visibleItems]);

  if (messages === undefined && indexQuery.isLoading) {
    return <IndexShell mode={mode} label="正在加载对话索引" />;
  }
  if (messages === undefined && indexQuery.isError) {
    return <IndexShell mode={mode} label={indexQuery.error.message} />;
  }
  if (items.length === 0) {
    return <IndexShell mode={mode} label="暂无对话" />;
  }

  const shellClass =
    mode === "sheet"
      ? "max-h-[65vh] overflow-y-auto"
      : "group w-8 overflow-visible rounded-2xl transition-all duration-200 hover:w-80 focus-within:w-80";
  const listClass =
    mode === "sheet"
      ? "max-h-[54vh] overflow-y-auto pr-1"
      : "max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden rounded-2xl border border-transparent py-2 transition-all duration-200 group-hover:border-[#e5e7eb] group-hover:bg-white group-hover:px-3 group-hover:shadow-sm group-focus-within:border-[#e5e7eb] group-focus-within:bg-white group-focus-within:px-3 group-focus-within:shadow-sm";

  return (
    <section className={shellClass} aria-label="对话索引">
      <div className="relative mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowFilter((current) => !current)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#d1d5db] bg-white text-xs font-semibold text-[#374151] shadow-sm hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f]"
          aria-label="筛选对话索引"
        >
          #
        </button>
        <div className={`${mode === "sheet" ? "block" : "hidden group-hover:block group-focus-within:block"} min-w-0`}>
          <h2 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">对话索引</h2>
          <p className="text-[11px] text-[#9ca3af]">
            {visibleItems.length} / {items.length} turns
          </p>
        </div>
        {showFilter ? (
          <IndexFilterPopover
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
        <div className="space-y-2">
          {visibleItems.map((item) => {
            const isActive = item.messageId === activeMessageId;
            return (
              <button
                key={item.messageId}
                ref={isActive ? activeRowRef : undefined}
                type="button"
                onClick={() => {
                  if (onNavigate) {
                    onNavigate(item);
                  } else {
                    document
                      .getElementById(`message-${item.messageId}`)
                      ?.scrollIntoView({ block: "start", behavior: "smooth" });
                  }
                }}
                className="flex min-h-6 w-full min-w-0 items-center gap-2 rounded-lg text-left text-sm text-[#374151] hover:text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10a37f]"
              >
                <span
                  className={`h-0.5 shrink-0 rounded-full transition-all ${
                    isActive ? "w-7 bg-[#f59e0b]" : `w-5 ${roleLineClass(item.role)}`
                  }`}
                />
                <span
                  className={`${mode === "sheet" ? "inline-flex" : "hidden group-hover:inline-flex group-focus-within:inline-flex"} h-5 min-w-8 shrink-0 items-center justify-center rounded-full bg-[#f7f7f8] px-1.5 text-[10px] font-semibold text-[#6b7280]`}
                >
                  {item.roleNumber}
                </span>
                <span
                  className={`${mode === "sheet" ? "block" : "hidden group-hover:block group-focus-within:block"} min-w-0 flex-1 truncate text-xs leading-6 ${
                    isActive ? "font-semibold text-[#b45309]" : "text-[#374151]"
                  }`}
                >
                  {item.preview || "No preview"}
                </span>
                <span
                  className={`${mode === "sheet" ? "block" : "hidden group-hover:block group-focus-within:block"} font-mono text-[10px] text-[#9ca3af]`}
                >
                  {item.orderKey}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </section>
  );
}

async function loadConversationIndex(conversationId: string): Promise<ConversationIndexItem[]> {
  const messages: MessageListItem[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await getConversationMessageWindow(conversationId, {
      includeBlocks: false,
      limit: INDEX_PAGE_SIZE,
      offset,
    });
    messages.push(...page.items);
    hasMore = page.has_more;
    offset += page.items.length;
    if (page.items.length === 0) {
      break;
    }
  }

  return buildIndexItems(messages);
}

function buildIndexItems(messages: MessageListItem[]): ConversationIndexItem[] {
  const counts = { assistant: 0, user: 0 };
  return messages.map((message, index) => toIndexItem(message, index, counts));
}

function toIndexItem(
  message: MessageListItem,
  fallbackOrdinal: number,
  counts: { assistant: number; user: number },
): ConversationIndexItem {
  const text = stripLeadingTimestamp(message.current_version?.display_text ?? message.current_version?.plain_text ?? "");
  const roleNumber = nextRoleNumber(message.role, counts);
  const parsedOrder = Number.parseInt(message.order_key, 10);
  return {
    messageId: message.id,
    role: message.role,
    roleNumber,
    orderKey: message.order_key,
    preview: text.replace(/\s+/g, " ").trim().slice(0, 96),
    turnIndex: message.turn_index ?? null,
    ordinal: Number.isFinite(parsedOrder) && parsedOrder > 0 ? parsedOrder - 1 : fallbackOrdinal,
  };
}

function nextRoleNumber(role: string, counts: { assistant: number; user: number }): string {
  if (role === "user") {
    counts.user += 1;
    return `U${counts.user}`;
  }
  if (role === "assistant") {
    counts.assistant += 1;
    return `A${counts.assistant}`;
  }
  return role.slice(0, 1).toUpperCase() || "?";
}

function applyIndexFilter(
  items: ConversationIndexItem[],
  mode: "all" | "around" | "custom",
  hideBefore: string,
  hideAfter: string,
  activeOrdinal: number | null,
): ConversationIndexItem[] {
  if (mode === "around" && activeOrdinal !== null) {
    return items.filter((item) => Math.abs(item.ordinal - activeOrdinal) <= AROUND_WINDOW);
  }
  if (mode !== "custom") {
    return items;
  }
  const before = numberOrNull(hideBefore);
  const after = numberOrNull(hideAfter);
  return items.filter((item) => {
    const ordinal = item.ordinal + 1;
    if (before !== null && ordinal <= before) {
      return false;
    }
    if (after !== null && ordinal >= after) {
      return false;
    }
    return true;
  });
}

function numberOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function roleLineClass(role: string): string {
  if (role === "user") {
    return "bg-[#10a37f]";
  }
  if (role === "assistant") {
    return "bg-[#4f46e5]";
  }
  return "bg-[#9ca3af]";
}

function IndexShell({ mode, label }: { mode: "rail" | "sheet"; label: string }) {
  const className = mode === "sheet" ? "text-sm text-[#6b7280]" : "w-8 py-2 text-xs text-[#9ca3af]";
  return <section className={className}>{label}</section>;
}

function IndexFilterPopover({
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
    <div className="absolute left-0 top-9 z-30 w-64 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-sm shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-[#111827]">索引范围</span>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-[#6b7280] hover:bg-[#f7f7f8]">
          关闭
        </button>
      </div>
      <div className="grid gap-2">
        {(["all", "around", "custom"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onRangeModeChange(mode)}
            className={`rounded-lg px-3 py-2 text-left text-sm ${
              rangeMode === mode ? "bg-[#ecfdf5] text-[#047857]" : "bg-[#f7f7f8] text-[#374151] hover:bg-[#f1f5f9]"
            }`}
          >
            {mode === "all" ? "显示全部" : mode === "around" ? "围绕当前" : "隐藏前后范围"}
          </button>
        ))}
        {rangeMode === "custom" ? (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="text-xs text-[#6b7280]">
              隐藏之前
              <input
                value={hideBefore}
                onChange={(event) => onHideBeforeChange(event.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-[#d1d5db] px-2 py-1 text-sm text-[#111827]"
                placeholder="20"
              />
            </label>
            <label className="text-xs text-[#6b7280]">
              隐藏之后
              <input
                value={hideAfter}
                onChange={(event) => onHideAfterChange(event.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-[#d1d5db] px-2 py-1 text-sm text-[#111827]"
                placeholder="300"
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
