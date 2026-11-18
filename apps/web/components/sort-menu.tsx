"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePreferences } from "./preferences-provider";
import type { ConversationSortMode, ProjectSortMode, SortDirection } from "../lib/types";
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

export function ConversationSortMenu({ compact = false, hideCustomDirection = false, scope = "all" }: { compact?: boolean; hideCustomDirection?: boolean; scope?: SortScope } = {}) {
  const preferences = usePreferences();
  const sorting = useScopedSort(scope);
  const { confirm } = useInteractionDialog();
  const zh = preferences.resolvedLocale === "zh-CN";
  const [error, setError] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setError(false);
    try { await action(); } catch { setError(true); }
  };
  return <div className="flex flex-wrap items-center gap-2">
    {scope.startsWith("project:") ? <span className="text-xs text-secondary">{sorting.inherited ? (zh ? "跟随项目默认" : "Following project default") : (zh ? "本项目独立设置" : "Project override")}</span> : null}
    <SortMenu disabled={!sorting.canChange} compact={compact} hideCustomDirection={hideCustomDirection} options={conversationOptions} mode={sorting.conversationSortMode} direction={sorting.conversationSortDirection} onChange={sorting.setSort} locale={preferences.resolvedLocale}
      actions={scope !== "project_default" ? <button type="button" role="menuitem" disabled={!sorting.canChange} className="min-h-11 w-full rounded-md px-3 text-left text-xs text-secondary hover:bg-subtle" onClick={() => void run(async () => {
        if (await confirm({ title: zh ? "按当前排序重建手动顺序？" : "Rebuild manual order from this sort?",
          description: zh ? "替换此范围已保存的手动位置，其他范围不变。" : "Replace saved manual positions in this scope only." })) await sorting.rebuild();
      })}>{zh ? "按当前排序重建手动顺序…" : "Rebuild manual order from current sort…"}</button> : null}
    />
    {scope.startsWith("project:") && !sorting.inherited ? <button type="button" disabled={!sorting.canChange} className="min-h-11 text-xs text-accent disabled:opacity-50" onClick={() => void run(sorting.inherit)}>{zh ? "恢复跟随" : "Use default"}</button> : null}
    {error ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "保存未确认，请刷新后核对；没有覆盖其他范围。" : "Save unconfirmed. Refresh to check; other scopes were not overwritten."}</p> : null}
  </div>;
}

export function ProjectSortMenu() {
  const preferences = usePreferences();
  return <SortMenu kind="project" options={projectOptions} mode={preferences.projectSortMode} direction={preferences.projectSortDirection} onChange={preferences.setProjectSort} locale={preferences.resolvedLocale} />;
}

function SortMenu<T extends string>({ options, mode, direction, onChange, locale, compact = false, hideCustomDirection = false, kind = "conversation", actions, disabled = false }: {
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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const change = async (nextMode: T, nextDirection: SortDirection) => {
    if (savingRef.current || disabled) return;
    savingRef.current = true;
    setSaving(true);
    setError(false);
    try { await onChange(nextMode, nextDirection); setOpen(false); }
    catch { setError(true); }
    finally { savingRef.current = false; setSaving(false); }
  };
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
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
  const selected = options.find((option) => option.value === mode) ?? options[0];
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
        aria-label={kind === "project" ? (locale === "zh-CN" ? "项目排序" : "Sort projects") : (locale === "zh-CN" ? "对话排序" : "Sort conversations")}
        title={`${label} · ${locale === "zh-CN" ? (direction === "desc" ? "降序" : "升序") : direction === "desc" ? "Descending" : "Ascending"}`}
        className={`flex cursor-pointer items-center rounded-lg border border-ui bg-surface text-secondary hover:bg-subtle disabled:cursor-default disabled:opacity-50 ${compact ? "h-11 w-11 justify-center sm:h-7 sm:w-7" : "min-h-11 gap-2 px-3 text-sm sm:min-h-9"}`}
      >
        <ArrowUpDown className="h-4 w-4 shrink-0" aria-hidden="true" />{compact ? null : <><span>{label}</span>{direction === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />}</>}
      </button>
      {error ? <p role="alert" className="text-xs text-[var(--danger)]">{locale === "zh-CN" ? "保存未确认，请刷新后核对。" : "Save unconfirmed. Refresh to check."}</p> : null}
      {open ? <div
        data-testid="sort-menu-panel"
        role="menu"
        className="fixed inset-x-3 bottom-[calc(.75rem+env(safe-area-inset-bottom))] z-[150] max-h-[min(70dvh,32rem)] w-auto overflow-y-auto rounded-lg border border-ui bg-raised p-1 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-11 sm:w-52 sm:shadow-xl"
      >
        {options.map((option) => (
          <button key={option.value} role="menuitem" type="button" disabled={saving || disabled} onClick={() => void change(option.value, option.value === "title" || option.value === "custom" ? "asc" : "desc")} className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-primary hover:bg-subtle disabled:opacity-50 sm:min-h-9">
            <span className="flex-1">{locale === "zh-CN" ? option.zh : option.en}</span>
            {option.value === mode ? <Check className="h-4 w-4 text-accent" /> : null}
          </button>
        ))}
        {!(hideCustomDirection && mode === "custom") ? <div className="mt-1 flex border-t border-ui pt-1">
          {(["desc", "asc"] as const).map((value) => (
            <button key={value} role="menuitem" type="button" disabled={saving || disabled} onClick={() => void change(mode, value)} className={`flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md text-xs disabled:opacity-50 sm:min-h-9 ${direction === value ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle"}`}>
              {value === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              {locale === "zh-CN" ? (value === "desc" ? "降序" : "升序") : value === "desc" ? "Descending" : "Ascending"}
            </button>
          ))}
        </div> : null}
        {actions ? <div className="mt-1 border-t border-ui pt-1">{actions}</div> : null}
      </div> : null}
    </div>
  );
}
