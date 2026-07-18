"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getConversationDialogueIndex } from "../../lib/api";
import type { DialogueIndexItem, DialogueIndexResponse, MessageListItem } from "../../lib/types";
import { useTranslations } from "../../components/preferences-provider";

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
  onExpandedChange,
}: {
  conversationId: string;
  messages?: MessageListItem[];
  activeMessageId?: string | null;
  ready?: boolean;
  mode?: "rail" | "sheet";
  loadPage?: (options: { offset?: number; limit?: number; anchorMessageId?: string }) => Promise<DialogueIndexResponse>;
  onNavigate?: (item: ConversationIndexItem) => void | Promise<void>;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const t = useTranslations();
  const [showFilter, setShowFilter] = useState(false);
  const [rangeMode, setRangeMode] = useState<"all" | "around" | "custom">("around");
  const [hideBefore, setHideBefore] = useState("");
  const [hideAfter, setHideAfter] = useState("");
  const [jumpOrdinal, setJumpOrdinal] = useState("");
  const [expanded, setExpanded] = useState(mode === "sheet");
  const [remotePage, setRemotePage] = useState<DialogueIndexResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const loader = loadPage ?? ((options) => getConversationDialogueIndex(conversationId, options));
  const desktopFullIndex = mode === "rail" && rangeMode !== "around";

  const indexQuery = useQuery({
    queryKey: ["conversation-index", conversationId, desktopFullIndex ? "all" : activeMessageId ?? "start", mode],
    queryFn: () => loader({
      anchorMessageId: desktopFullIndex ? undefined : activeMessageId ?? undefined,
      offset: desktopFullIndex ? 0 : undefined,
      limit: desktopFullIndex ? 5000 : 80,
    }),
    enabled: messages === undefined && ready,
    staleTime: 60_000,
  });

  useEffect(() => { if (indexQuery.data) setRemotePage(indexQuery.data); }, [indexQuery.data]);
  useEffect(() => { setRemotePage(null); setRangeMode("around"); }, [conversationId]);

  const items = useMemo(() => messages ? buildItemsFromMessages(messages) : (remotePage?.items ?? []).map(toIndexItem), [messages, remotePage?.items]);
  const activeOrdinal = items.find((item) => item.messageId === activeMessageId)?.ordinal ?? null;
  const visibleItems = useMemo(() => applyFilter(items, rangeMode, hideBefore, hideAfter, activeOrdinal), [activeOrdinal, hideAfter, hideBefore, items, rangeMode]);

  useEffect(() => { activeRowRef.current?.scrollIntoView({ block: "nearest" }); }, [activeMessageId, visibleItems]);
  useEffect(() => { onExpandedChange?.(expanded || mode === "sheet"); }, [expanded, mode, onExpandedChange]);

  if (messages === undefined && (!ready || indexQuery.isLoading) && !remotePage) return <IndexShell mode={mode} label={t("loadingIndex")} />;
  if (messages === undefined && indexQuery.isError && !remotePage) return <IndexShell mode={mode} label={t("indexFailed")} />;
  if (!items.length) return <IndexShell mode={mode} label={t("noMessages")} />;

  const showDetails = mode === "sheet" || expanded;
  return (
    <section
      className={mode === "sheet" ? "max-h-[65vh] overflow-y-auto" : "h-full min-w-0"}
      aria-label={t("dialogueIndex")}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => { if (!showFilter) setExpanded(false); }}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !showFilter) setExpanded(false); }}
    >
      <div className="relative mb-2 flex items-center gap-2">
        <button type="button" onClick={() => { setShowFilter((value) => !value); setExpanded(true); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ui bg-surface text-xs font-semibold text-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" aria-label={t("indexRange")} title={t("indexRange")}>#</button>
        {showDetails ? <div className="min-w-0"><h2 className="text-xs font-semibold text-secondary">{t("dialogueIndex")}</h2><p className="text-[11px] text-secondary">{t("showMessages", { shown: visibleItems.length, total: remotePage?.message_count ?? items.length })}</p></div> : null}
        {showFilter ? <FilterPopover rangeMode={rangeMode} hideBefore={hideBefore} hideAfter={hideAfter} onRangeModeChange={setRangeMode} onHideBeforeChange={setHideBefore} onHideAfterChange={setHideAfter} onClose={() => setShowFilter(false)} /> : null}
      </div>
      {mode === "sheet" ? (
        <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void jumpToOrdinal(); }}>
          <input value={jumpOrdinal} onChange={(event) => setJumpOrdinal(event.target.value)} inputMode="numeric" min={1} max={remotePage?.total} placeholder={t("jumpToNumber")} className="min-w-0 flex-1 rounded-lg border border-ui bg-surface px-3 py-2 text-sm" />
          <button type="submit" disabled={pageLoading} className="rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)]">{t("jump")}</button>
        </form>
      ) : null}
      <nav className={`${mode === "sheet" ? "max-h-[54vh]" : "max-h-[calc(100vh-8rem)]"} overflow-y-auto overflow-x-hidden pr-1`}>
        <div className="space-y-1">
          {visibleItems.map((item) => {
            const active = item.messageId === activeMessageId;
            return <button key={item.messageId} ref={active ? activeRowRef : undefined} type="button" onClick={() => void onNavigate?.(item)} title={`${item.roleNumber} · ${item.preview || item.orderKey}`} className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md text-left hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]">
              <span className={`h-0.5 shrink-0 rounded-full ${active ? "w-7 bg-amber-500" : `w-5 ${roleLineClass(item.role)}`}`} />
              {showDetails ? <><span className="inline-flex h-5 min-w-8 shrink-0 items-center justify-center rounded bg-subtle px-1 text-[10px] font-semibold text-secondary">{item.roleNumber}</span><span className={`min-w-0 flex-1 truncate text-xs leading-6 ${active ? "font-semibold text-amber-700" : "text-primary"}`}>{item.preview || t("noPreview")}</span></> : null}
            </button>;
          })}
          {mode === "sheet" && remotePage && (remotePage.has_previous || remotePage.has_more) ? <div className="grid grid-cols-2 gap-2 pt-2"><PageButton disabled={!remotePage.has_previous || pageLoading} onClick={() => void loadIndexPage("previous")}>{t("previous")}</PageButton><PageButton disabled={!remotePage.has_more || pageLoading} onClick={() => void loadIndexPage("next")}>{t("next")}</PageButton></div> : null}
        </div>
      </nav>
    </section>
  );

  async function jumpToOrdinal() {
    const ordinal = Number.parseInt(jumpOrdinal, 10);
    if (!Number.isFinite(ordinal) || ordinal < 1 || (remotePage && ordinal > remotePage.total)) return;
    setPageLoading(true);
    try {
      const page = await loader({ offset: Math.max(0, ordinal - 40), limit: 80 });
      setRemotePage(page);
      const target = page.items.find((item) => item.ordinal === ordinal);
      if (target) await onNavigate?.(toIndexItem(target));
    } finally { setPageLoading(false); }
  }

  async function loadIndexPage(direction: "previous" | "next") {
    if (!remotePage || pageLoading) return;
    const nextOffset = direction === "previous" ? Math.max(0, remotePage.offset - remotePage.limit) : remotePage.offset + remotePage.items.length;
    setPageLoading(true);
    try { setRemotePage(await loader({ offset: nextOffset, limit: remotePage.limit })); } finally { setPageLoading(false); }
  }
}

function PageButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" disabled={disabled} onClick={onClick} className="min-h-9 rounded-md border border-ui px-2 text-xs text-secondary disabled:opacity-40">{children}</button>; }
function toIndexItem(item: DialogueIndexItem): ConversationIndexItem { return { messageId: item.message_id, role: item.role, roleNumber: roleLabel(item.role, item.role_number), orderKey: item.order_key, preview: item.preview, turnIndex: item.turn_index, ordinal: item.ordinal }; }
function buildItemsFromMessages(messages: MessageListItem[]): ConversationIndexItem[] { const counts: Record<string, number> = {}; return messages.map((message, index) => { counts[message.role] = (counts[message.role] ?? 0) + 1; return { messageId: message.id, role: message.role, roleNumber: roleLabel(message.role, counts[message.role]), orderKey: message.order_key, preview: message.content_preview ?? message.current_version?.display_text?.replace(/\s+/g, " ").slice(0, 160) ?? "", turnIndex: message.turn_index ?? null, ordinal: message.ordinal ?? index + 1 }; }); }
function roleLabel(role: string, number: number): string { return role === "user" ? `U${number}` : role === "assistant" ? `A${number}` : `${role.slice(0, 1).toUpperCase() || "?"}${number}`; }
function applyFilter(items: ConversationIndexItem[], mode: "all" | "around" | "custom", beforeValue: string, afterValue: string, activeOrdinal: number | null) { if (mode === "around") { const center = activeOrdinal ?? items[0]?.ordinal ?? 1; return items.filter((item) => Math.abs(item.ordinal - center) <= AROUND_WINDOW); } if (mode === "all") return items; const before = positiveNumber(beforeValue); const after = positiveNumber(afterValue); return items.filter((item) => (before === null || item.ordinal > before) && (after === null || item.ordinal < after)); }
function positiveNumber(value: string): number | null { const number = Number.parseInt(value, 10); return Number.isFinite(number) && number > 0 ? number : null; }
function roleLineClass(role: string): string { return role === "user" ? "bg-emerald-600" : role === "assistant" ? "bg-indigo-600" : "bg-gray-400"; }
function IndexShell({ mode, label }: { mode: "rail" | "sheet"; label: string }) { return <section className={mode === "sheet" ? "text-sm text-secondary" : "w-8 py-2 text-xs text-secondary"}>{label}</section>; }

function FilterPopover({ rangeMode, hideBefore, hideAfter, onRangeModeChange, onHideBeforeChange, onHideAfterChange, onClose }: { rangeMode: "all" | "around" | "custom"; hideBefore: string; hideAfter: string; onRangeModeChange: (mode: "all" | "around" | "custom") => void; onHideBeforeChange: (value: string) => void; onHideAfterChange: (value: string) => void; onClose: () => void; }) {
  const t = useTranslations();
  return <div className="absolute left-0 top-10 z-[120] w-64 rounded-lg border border-ui bg-raised p-3 text-sm shadow-xl"><div className="mb-2 flex items-center justify-between"><span className="font-medium text-primary">{t("indexRange")}</span><button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-secondary hover:bg-subtle">{t("close")}</button></div><div className="grid gap-1">{(["around", "all", "custom"] as const).map((itemMode) => <button key={itemMode} type="button" onClick={() => onRangeModeChange(itemMode)} className={`rounded-md px-3 py-2 text-left ${rangeMode === itemMode ? "bg-[var(--accent-soft)] text-accent" : "hover:bg-subtle"}`}>{itemMode === "around" ? t("aroundCurrent") : itemMode === "all" ? t("allIndex") : t("customRange")}</button>)}{rangeMode === "custom" ? <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-secondary">{t("hideBefore")}<input value={hideBefore} onChange={(event) => onHideBeforeChange(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-ui bg-surface px-2 py-1.5" /></label><label className="text-xs text-secondary">{t("hideAfter")}<input value={hideAfter} onChange={(event) => onHideAfterChange(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-ui bg-surface px-2 py-1.5" /></label></div> : null}</div></div>;
}
