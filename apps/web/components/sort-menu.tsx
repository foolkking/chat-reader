"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePreferences } from "./preferences-provider";
import type { ConversationSortMode, ProjectSortMode, ScopedSort, SortDirection } from "../lib/types";
import { useScopedSort, type SortScope } from "./use-scoped-sort";
import { useInteractionDialog } from "./interaction-dialog-provider";

type SortOption<T extends string> = { value: T; zh: string; en: string };

const sharedSortLabels: Record<string, { zh: string; en: string }> = {
  recent_read: { zh: "最近阅读", en: "Recently read" },
  updated: { zh: "资料修改时间", en: "Metadata modified" },
  content_updated: { zh: "内容更新", en: "Content updated" },
  imported: { zh: "导入时间", en: "Imported" },
  created: { zh: "创建时间", en: "Created" },
  title: { zh: "标题", en: "Title" },
  custom: { zh: "手动顺序", en: "Manual order" },
};

const conversationOptions: SortOption<ConversationSortMode>[] = [
  { value: "content_updated", zh: "内容更新", en: "Content updated" },
  { value: "recent_read", zh: "最近阅读", en: "Recently read" },
  { value: "updated", zh: "资料修改时间（高级）", en: "Metadata modified (advanced)" },
  { value: "created", zh: "创建时间", en: "Created" },
  { value: "imported", zh: "导入时间", en: "Imported" },
  { value: "title", zh: "标题", en: "Title" },
  { value: "message_count", zh: "消息数量", en: "Message count" },
  { value: "custom", zh: "手动顺序", en: "Manual order" },
];
const projectOptions: SortOption<ProjectSortMode>[] = [
  { value: "recent_read", zh: "最近阅读", en: "Recently read" },
  { value: "updated", zh: "最近更新", en: "Recently updated" },
  { value: "created", zh: "创建时间", en: "Created" },
  { value: "title", zh: "标题", en: "Title" },
  { value: "conversation_count", zh: "对话数量", en: "Conversation count" },
  { value: "custom", zh: "手动顺序", en: "Manual order" },
];

export function ConversationSortMenu({ compact = false, sidebar = false, settingLabel, hideCustomDirection = false, scope = "all", displayedOrder }: { compact?: boolean; sidebar?: boolean; settingLabel?: string; hideCustomDirection?: boolean; scope?: SortScope; displayedOrder?: ScopedSort } = {}) {
  const preferences = usePreferences();
  const sorting = useScopedSort(scope);
  const { confirm } = useInteractionDialog();
  const zh = preferences.resolvedLocale === "zh-CN";
  const heldOrderIsStale = !!displayedOrder && (
    displayedOrder.mode !== sorting.conversationSortMode || displayedOrder.direction !== sorting.conversationSortDirection
  );
  const [error, setError] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setError(false);
    try { await action(); } catch { setError(true); }
  };
  return <div className={settingLabel ? "min-w-0" : "flex flex-wrap items-center gap-2"}>
    {scope.startsWith("project:") ? <span className="text-xs text-secondary">{sorting.inherited ? (zh ? "跟随项目默认" : "Following project default") : (zh ? "本项目独立设置" : "Project override")}</span> : null}
    <SortMenu disabled={!sorting.canChange || heldOrderIsStale} sidebar={sidebar} settingLabel={settingLabel} compact={compact} hideCustomDirection={hideCustomDirection} options={conversationOptions} mode={displayedOrder?.mode ?? sorting.conversationSortMode} direction={displayedOrder?.direction ?? sorting.conversationSortDirection} onChange={sorting.setSort} locale={preferences.resolvedLocale}
      actions={scope !== "project_default" ? <button type="button" role="menuitem" disabled={!sorting.canChange} className="min-h-11 w-full rounded-md px-3 text-left text-xs text-secondary hover:bg-subtle" onClick={() => void run(async () => {
        if (await confirm({ title: zh ? "按当前排序重建手动顺序？" : "Rebuild manual order from this sort?",
          description: zh ? "替换此范围已保存的手动位置，其他范围不变。" : "Replace saved manual positions in this scope only." })) await sorting.rebuild();
      })}>{zh ? "按当前排序重建手动顺序…" : "Rebuild manual order from current sort…"}</button> : null}
    />
    {scope.startsWith("project:") && !sorting.inherited ? <button type="button" disabled={!sorting.canChange} className="min-h-11 text-xs text-accent disabled:opacity-50" onClick={() => void run(sorting.inherit)}>{zh ? "恢复跟随" : "Use default"}</button> : null}
    {error ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "保存未确认，请刷新后核对；没有覆盖其他范围。" : "Save unconfirmed. Refresh to check; other scopes were not overwritten."}</p> : null}
  </div>;
}

export function ProjectSortMenu({ sidebar = false, settingLabel }: { sidebar?: boolean; settingLabel?: string } = {}) {
  const preferences = usePreferences();
  return <SortMenu kind="project" sidebar={sidebar} settingLabel={settingLabel} compact={sidebar} options={projectOptions} mode={preferences.projectSortMode} direction={preferences.projectSortDirection} onChange={preferences.setProjectSort} locale={preferences.resolvedLocale} />;
}

function SortMenu<T extends string>({ options, mode, direction, onChange, locale, compact = false, sidebar = false, settingLabel, hideCustomDirection = false, kind = "conversation", actions, disabled = false }: {
  sidebar?: boolean;
  settingLabel?: string;
  disabled?: boolean;
  actions?: ReactNode;
  kind?: "conversation" | "project";
  options: SortOption<T>[];
  mode: T;
  direction: SortDirection;
  onChange: (mode: T, direction: SortDirection) => Promise<void>;
  locale: "zh-CN" | "en-US";
  compact?: boolean;
  hideCustomDirection?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const change = async (nextMode: T, nextDirection: SortDirection) => {
    if (savingRef.current || disabled) return;
    savingRef.current = true;
    setSaving(true);
    setError(false);
    try { await onChange(nextMode, nextDirection); if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true }); setOpen(false); }
    catch { setError(true); }
    finally { savingRef.current = false; setSaving(false); }
  };
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) || panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      // The outside pointer owns the next focus target. Restoring the trigger
      // here would steal focus after the clicked input receives it.
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    const anchor = triggerRef.current, bounds = anchor?.closest("[data-sidebar-settings-scroll], [data-sidebar-navigation-scroll]"), panel = panelRef.current;
    if (!open || !sidebar || !anchor || !bounds || !panel) return;
    const search = bounds.querySelector("[data-sidebar-search-row]");
    const place = () => {
      const a = anchor.getBoundingClientRect(), b = bounds.getBoundingClientRect();
      if (!a.width || a.bottom <= b.top || a.top >= b.bottom) { setOpen(false); return; }
      // The search field is a primary outside-click/focus target. A long menu
      // can scroll inside the list lane; it must not cover search or the footer.
      const width = Math.min(192, bounds.clientWidth - 16);
      const floor = Math.min(window.innerHeight, b.bottom) - 8;
      const ceiling = Math.max(0, b.top, search?.getBoundingClientRect().bottom ?? 0) + 8;
      const below = floor - a.bottom - 4, above = a.top - ceiling - 4;
      const up = below < panel.scrollHeight && above > below;
      setPosition({ width, left: Math.max(b.left + 8, Math.min(a.right - width, b.left + bounds.clientWidth - 8 - width)),
        maxHeight: Math.max(0, up ? above : below), ...(up ? { bottom: window.innerHeight - a.top + 4 } : { top: a.bottom + 4 }) });
    };
    place();
    panel.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place); observer.observe(bounds); observer.observe(anchor); if (search) observer.observe(search);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, sidebar]);
  const selected = options.find((option) => option.value === mode) ?? options[0];
  const directionLabel = locale === "zh-CN" ? (direction === "desc" ? "降序" : "升序") : direction === "desc" ? "Descending" : "Ascending";
  const sharedLabel = sharedSortLabels[String(mode)];
  const label = mode === "message_count"
    ? (locale === "zh-CN" ? (direction === "desc" ? "最长对话" : "最短对话") : (direction === "desc" ? "Longest" : "Shortest"))
    : mode === "conversation_count"
      ? (locale === "zh-CN" ? (direction === "desc" ? "对话最多" : "对话最少") : (direction === "desc" ? "Most conversations" : "Fewest conversations"))
      : sharedLabel ? (locale === "zh-CN" ? sharedLabel.zh : sharedLabel.en) : locale === "zh-CN" ? selected.zh : selected.en;
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-testid="sort-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={settingLabel ? `${settingLabel}: ${label} · ${directionLabel}` : kind === "project" ? (locale === "zh-CN" ? "项目排序" : "Sort projects") : (locale === "zh-CN" ? "对话排序" : "Sort conversations")}
        title={`${label} · ${directionLabel}`}
        className={settingLabel ? "nav-sort-setting w-full rounded-md px-1 text-left hover:bg-subtle disabled:opacity-50" : sidebar ? "flex size-8 items-center justify-center rounded-md text-secondary hover:bg-surface hover:text-primary disabled:opacity-50 [@media(pointer:coarse)]:size-11" : `flex cursor-pointer items-center rounded-lg border border-ui bg-surface text-secondary hover:bg-subtle disabled:cursor-default disabled:opacity-50 ${compact ? "h-11 w-11 justify-center sm:h-7 sm:w-7" : "min-h-11 gap-2 px-3 text-sm sm:min-h-9"}`}
      >
        {settingLabel ? <>
          <span className="nav-sort-scope text-sm text-primary">{settingLabel}</span>
          <span className="nav-sort-value text-xs text-secondary">{label} <span aria-hidden="true">{direction === "desc" ? "↓" : "↑"}</span></span>
          <ChevronDown aria-hidden="true" className="nav-sort-chevron size-4 text-secondary" />
        </> : <><ArrowUpDown className="h-4 w-4 shrink-0" aria-hidden="true" />{compact ? null : <><span>{label}</span>{direction === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />}</>}</>}
      </button>
      {error ? <p role="alert" className="text-xs text-[var(--danger)]">{locale === "zh-CN" ? "保存未确认，请刷新后核对。" : "Save unconfirmed. Refresh to check."}</p> : null}
      {open ? renderPanel(<div ref={panelRef}
        data-testid="sort-menu-panel"
        role="menu"
        style={sidebar ? position : undefined}
        onKeyDown={event => {
          if (!sidebar) return;
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === "Tab") { triggerRef.current?.focus(); setOpen(false); return; }
          if (!["ArrowUp","ArrowDown","Home","End"].includes(event.key) || !items.length) return;
          event.preventDefault(); event.stopPropagation();
          items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (i + items.length + (event.key === "ArrowDown" ? 1 : -1)) % items.length]?.focus();
        }}
        className={sidebar ? "fixed z-[150] overflow-y-auto overscroll-contain rounded-lg border border-ui bg-raised p-1 shadow-md [&_button]:min-h-8 [@media(pointer:coarse)]:[&_button]:min-h-11" : "fixed inset-x-3 bottom-[calc(.75rem+env(safe-area-inset-bottom))] z-[150] max-h-[min(70dvh,32rem)] w-auto overflow-y-auto rounded-lg border border-ui bg-raised p-1 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-11 sm:w-52 sm:shadow-xl"}
      >
        {options.map((option) => (
          <button key={option.value} role={sidebar ? "menuitemradio" : "menuitem"} aria-checked={sidebar ? option.value === mode : undefined} type="button" disabled={saving || disabled} onClick={() => void change(option.value, option.value === "title" || option.value === "custom" ? "asc" : "desc")} className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-primary hover:bg-subtle disabled:opacity-50 sm:min-h-9">
            <span className="flex-1">{locale === "zh-CN" ? option.zh : option.en}</span>
            {option.value === mode ? <Check className="h-4 w-4 text-accent" /> : null}
          </button>
        ))}
        {!(hideCustomDirection && mode === "custom") ? <div className="mt-1 flex border-t border-ui pt-1">
          {(["desc", "asc"] as const).map((value) => (
            <button key={value} role={sidebar ? "menuitemradio" : "menuitem"} aria-checked={sidebar ? direction === value : undefined} type="button" disabled={saving || disabled} onClick={() => void change(mode, value)} className={`flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md text-xs disabled:opacity-50 sm:min-h-9 ${direction === value ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle"}`}>
              {value === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              {locale === "zh-CN" ? (value === "desc" ? "降序" : "升序") : value === "desc" ? "Descending" : "Ascending"}
            </button>
          ))}
        </div> : null}
        {actions ? <div className="mt-1 border-t border-ui pt-1">{actions}</div> : null}
      </div>) : null}
    </div>
  );
  function renderPanel(panel: ReactNode) { return sidebar ? createPortal(panel, document.body) : panel; }
}
