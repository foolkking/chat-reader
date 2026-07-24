"use client";

import { useQuery } from "@tanstack/react-query";
import { ListTree, Pin, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "../../components/preferences-provider";
import { getConversationDialogueIndex } from "../../lib/api";
import type { DialogueIndexPanelState, DialogueIndexItem, DialogueIndexResponse, MessageListItem } from "../../lib/types";

const AROUND_WINDOW = 24;
const PREVIEW_OPEN_DELAY = 180;
const PREVIEW_CLOSE_DELAY = 220;

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
  const t = useTranslations();
  const [showFilter, setShowFilter] = useState(false);
  const [rangeMode, setRangeMode] = useState<"all" | "around" | "custom">("around");
  const [hideBefore, setHideBefore] = useState("");
  const [hideAfter, setHideAfter] = useState("");
  const [jumpOrdinal, setJumpOrdinal] = useState("");
  const [panelState, setPanelState] = useState<DialogueIndexPanelState>(mode === "sheet" ? "pinned" : "rail");
  const [remotePage, setRemotePage] = useState<DialogueIndexResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    setRemotePage(null);
    setRangeMode("around");
    setPanelState(mode === "sheet" ? "pinned" : "rail");
  }, [conversationId, mode]);
  useEffect(() => { if (indexQuery.data) setRemotePage(indexQuery.data); }, [indexQuery.data]);

  useEffect(() => () => {
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (mode === "sheet" || panelState !== "pinned") return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!sectionRef.current?.contains(event.target as Node)) closePanel();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closePanel(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mode, panelState]);

  const resolvedPage = remotePage ?? indexQuery.data ?? null;
  const items = useMemo(
    () => messages ? buildItemsFromMessages(messages) : (resolvedPage?.items ?? []).map(toIndexItem),
    [messages, resolvedPage?.items],
  );
  const activeOrdinal = items.find((item) => item.messageId === activeMessageId)?.ordinal ?? null;
  const visibleItems = useMemo(
    () => applyFilter(items, rangeMode, hideBefore, hideAfter, activeOrdinal),
    [activeOrdinal, hideAfter, hideBefore, items, rangeMode],
  );

  useEffect(() => {
    const list = listRef.current;
    const row = activeRowRef.current;
    if (!list || !row) return;
    const frame = window.requestAnimationFrame(() => {
      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const desiredTop = list.scrollTop + rowRect.top - listRect.top - list.clientHeight / 3;
      const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
      list.scrollTop = Math.max(0, Math.min(maxTop, desiredTop));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeMessageId, activeOrdinal, mode, panelState, rangeMode, remotePage?.offset, visibleItems.length]);

  if (messages === undefined && (!ready || indexQuery.isLoading) && !resolvedPage) return <IndexShell mode={mode} label={t("loadingIndex")} />;
  if (messages === undefined && indexQuery.isError && !resolvedPage) return <IndexShell mode={mode} label={t("indexFailed")} />;
  if (!items.length) return <IndexShell mode={mode} label={t("noMessages")} />;

  const showDetails = mode === "sheet" || panelState !== "rail";
  const rows = (
    <div className="space-y-1">
      {visibleItems.map((item) => {
        const active = item.messageId === activeMessageId;
        return (
          <button
            key={item.messageId}
            ref={active ? activeRowRef : undefined}
            type="button"
            onClick={async () => {
              await onNavigate?.(item);
              if (panelState === "preview") setPanelState("rail");
            }}
            title={`${item.roleNumber} · ${item.preview || item.orderKey}`}
            className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md text-left transition-colors hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${showDetails ? "px-2" : "justify-center"}`}
          >
            <span className={`h-0.5 shrink-0 rounded-full ${active ? "w-7 bg-amber-500" : `w-5 ${roleLineClass(item.role)}`}`} />
            {showDetails ? <><span className="inline-flex h-5 min-w-8 shrink-0 items-center justify-center rounded bg-subtle px-1 text-xs font-semibold text-secondary">{item.roleNumber}</span><span className={`min-w-0 flex-1 truncate text-sm leading-6 ${active ? "font-semibold text-amber-700" : "text-primary"}`}>{item.preview || t("noPreview")}</span></> : null}
          </button>
        );
      })}
      {mode === "sheet" && remotePage && (remotePage.has_previous || remotePage.has_more) ? (
        <div className="grid grid-cols-2 gap-2 pt-2">
          <PageButton disabled={!remotePage.has_previous || pageLoading} onClick={() => void loadIndexPage("previous")}>{t("previous")}</PageButton>
          <PageButton disabled={!remotePage.has_more || pageLoading} onClick={() => void loadIndexPage("next")}>{t("next")}</PageButton>
        </div>
      ) : null}
    </div>
  );

  if (mode === "sheet") {
    return (
      <section ref={sectionRef} className="flex min-h-0 flex-1 flex-col" aria-label={t("dialogueIndex")}>
        <JumpForm />
        <div ref={(node) => { listRef.current = node; }} className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto pr-1">{rows}</div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className={`dialogue-index ${showDetails ? "dialogue-index-panel" : "dialogue-index-rail"}`}
      aria-label={t("dialogueIndex")}
      data-state={panelState}
      onMouseEnter={schedulePreview}
      onMouseLeave={scheduleClose}
      onFocusCapture={() => { if (panelState === "rail") setPanelState("preview"); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && panelState === "preview" && !showFilter) scheduleClose();
      }}
    >
      {showDetails ? (
        <div className="flex h-full min-h-0 flex-col p-3">
          <div className="mb-3 flex items-center gap-2 border-b border-ui pb-3">
            <ListTree className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-primary">{t("dialogueIndex")}</h2>
              <p className="text-[13px] text-secondary">{t("showMessages", { shown: visibleItems.length, total: remotePage?.message_count ?? items.length })}</p>
            </div>
            <button type="button" onClick={() => setPanelState("pinned")} className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-subtle ${panelState === "pinned" ? "text-accent" : "text-secondary"}`} aria-label={t("pinIndex")} title={t("pinIndex")}><Pin className="h-4 w-4" /></button>
            <button type="button" onClick={closePanel} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={t("close")} title={t("close")}><X className="h-4 w-4" /></button>
          </div>
          <div className="relative mb-2">
            <button type="button" onClick={() => { setShowFilter((value) => !value); setPanelState("pinned"); }} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-secondary hover:bg-subtle"><SlidersHorizontal className="h-4 w-4" />{t("indexRange")}</button>
            {showFilter ? <FilterPopover rangeMode={rangeMode} hideBefore={hideBefore} hideAfter={hideAfter} onRangeModeChange={(value) => { setRangeMode(value); setPanelState("pinned"); }} onHideBeforeChange={setHideBefore} onHideAfterChange={setHideAfter} onClose={() => setShowFilter(false)} /> : null}
          </div>
          <nav ref={(node) => { listRef.current = node; }} className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">{rows}</nav>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col items-center rounded-xl bg-surface py-2 shadow-sm ring-1 ring-[var(--border)]">
          <button type="button" onClick={() => setPanelState("pinned")} className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary" aria-label={t("openIndex")} title={t("openIndex")}><ListTree className="h-4 w-4" /></button>
          <nav ref={(node) => { listRef.current = node; }} className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{rows}</nav>
        </div>
      )}
    </section>
  );

  function JumpForm() {
    return (
      <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void jumpToOrdinal(); }}>
        <input value={jumpOrdinal} onChange={(event) => setJumpOrdinal(event.target.value)} inputMode="numeric" min={1} max={remotePage?.total} placeholder={t("jumpToNumber")} className="min-w-0 flex-1 rounded-lg border border-ui bg-surface px-3 py-2 text-sm" />
        <button type="submit" disabled={pageLoading} className="rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{t("jump")}</button>
      </form>
    );
  }

  function schedulePreview() {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (panelState !== "rail") return;
    openTimerRef.current = window.setTimeout(() => setPanelState("preview"), PREVIEW_OPEN_DELAY);
  }

  function scheduleClose() {
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    if (panelState !== "preview" || showFilter) return;
    closeTimerRef.current = window.setTimeout(() => setPanelState("rail"), PREVIEW_CLOSE_DELAY);
  }

  function closePanel() {
    setShowFilter(false);
    setPanelState("rail");
  }

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
function IndexShell({ mode, label }: { mode: "rail" | "sheet"; label: string }) { return <section className={mode === "sheet" ? "text-sm text-secondary" : "w-11 rounded-xl bg-surface p-2 text-xs text-secondary shadow-sm ring-1 ring-[var(--border)]"}>{label}</section>; }

function FilterPopover({ rangeMode, hideBefore, hideAfter, onRangeModeChange, onHideBeforeChange, onHideAfterChange, onClose }: { rangeMode: "all" | "around" | "custom"; hideBefore: string; hideAfter: string; onRangeModeChange: (mode: "all" | "around" | "custom") => void; onHideBeforeChange: (value: string) => void; onHideAfterChange: (value: string) => void; onClose: () => void; }) {
  const t = useTranslations();
  return <div className="absolute left-0 top-10 z-[120] w-full rounded-lg border border-ui bg-raised p-3 text-sm shadow-xl"><div className="mb-2 flex items-center justify-between"><span className="font-medium text-primary">{t("indexRange")}</span><button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-secondary hover:bg-subtle">{t("close")}</button></div><div className="grid gap-1">{(["around", "all", "custom"] as const).map((itemMode) => <button key={itemMode} type="button" onClick={() => onRangeModeChange(itemMode)} className={`rounded-md px-3 py-2 text-left ${rangeMode === itemMode ? "bg-[var(--accent-soft)] text-accent" : "hover:bg-subtle"}`}>{itemMode === "around" ? t("aroundCurrent") : itemMode === "all" ? t("allIndex") : t("customRange")}</button>)}{rangeMode === "custom" ? <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-secondary">{t("hideBefore")}<input value={hideBefore} onChange={(event) => onHideBeforeChange(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-ui bg-surface px-2 py-1.5" /></label><label className="text-xs text-secondary">{t("hideAfter")}<input value={hideAfter} onChange={(event) => onHideAfterChange(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-ui bg-surface px-2 py-1.5" /></label></div> : null}</div></div>;
}
