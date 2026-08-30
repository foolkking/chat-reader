"use client";

import { CheckSquare2, ListChecks, RefreshCcw, Square, X } from "lucide-react";
import { useEffect, useRef } from "react";

export function SelectionModeButton({
  active,
  locale,
  context = "conversation",
  onClick,
}: {
  active: boolean;
  locale: "zh-CN" | "en-US";
  context?: "conversation" | "project";
  onClick: () => void;
}) {
  const zh = locale === "zh-CN";
  const label = zh ? "批量操作" : `Manage ${context === "project" ? "projects" : "conversations"}`;
  const compactLabel = zh ? "批量" : "Batch";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary shadow-sm transition hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
    >
      <ListChecks className="h-4 w-4" />
      <span className="sm:hidden">{compactLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function SelectionToolbar({
  selectedCount,
  totalCount,
  busy = false,
  className = "",
  context = "conversation",
  locale,
  onSelectAll,
  onInvert,
  onClear,
  onDone,
  children,
}: {
  selectedCount: number;
  totalCount: number;
  busy?: boolean;
  className?: string;
  context?: "conversation" | "project";
  locale: "zh-CN" | "en-US";
  onSelectAll: () => void;
  onInvert: () => void;
  onClear: () => void;
  onDone: () => void;
  children?: React.ReactNode;
}) {
  const zh = locale === "zh-CN";
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const buttonClass = "selection-toolbar-button inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-secondary transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40";
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.innerWidth >= 768) return;
    const frame = window.requestAnimationFrame(() => {
      toolbarRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      data-testid="selection-toolbar"
      data-state="selection"
      aria-label={zh ? `${context === "project" ? "项目" : "对话"}批量选择工具` : `${context === "project" ? "Project" : "Conversation"} bulk selection tools`}
      className={`selection-toolbar sticky top-0 z-20 flex w-full flex-col gap-2.5 rounded-xl border border-ui bg-raised/95 p-3 shadow-lg backdrop-blur md:flex-row md:items-center md:gap-3 ${className}`}
    >
      <div className="selection-toolbar-summary flex w-full min-w-0 items-center gap-2 md:w-auto md:min-w-[14rem]">
        <span className="selection-toolbar-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-[var(--surface)]" aria-hidden="true">
          <ListChecks className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1" aria-live="polite">
          <span className="block text-xs font-semibold uppercase tracking-wide text-secondary">{zh ? "批量操作" : "Bulk actions"}</span>
          <span className="block truncate text-sm font-semibold text-primary">{zh ? `已选择 ${selectedCount} / ${totalCount}` : `${selectedCount} of ${totalCount} selected`}</span>
        </span>
        <button type="button" disabled={busy} onClick={onDone} className={`${buttonClass} text-primary`} title={zh ? "退出选择模式" : "Exit selection mode"}>
          <X className="h-4 w-4" /> {zh ? "完成" : "Done"}
        </button>
      </div>
      <div className="selection-toolbar-actions relative flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 md:justify-end">
        <div className="selection-toolbar-group flex shrink-0 items-center gap-1 rounded-lg border border-ui bg-surface p-0.5">
          <button type="button" disabled={busy || allSelected || totalCount === 0} onClick={onSelectAll} className={buttonClass} title={zh ? "选择当前列表中的全部项目" : "Select every item in this list"}>
            <CheckSquare2 className="h-4 w-4" /> {zh ? "全选" : "Select all"}
          </button>
          <button type="button" disabled={busy || totalCount === 0} onClick={onInvert} className={buttonClass} title={zh ? "反转当前列表中的选择" : "Invert the current selection"}>
            <RefreshCcw className="h-4 w-4" /> {zh ? "反选" : "Invert"}
          </button>
          <button type="button" disabled={busy || selectedCount === 0} onClick={onClear} className={buttonClass} title={zh ? "清空当前选择" : "Clear the current selection"}>
            <Square className="h-4 w-4" /> {zh ? "清空" : "Clear"}
          </button>
        </div>
        <span className="selection-toolbar-divider mx-0.5 h-6 w-px shrink-0 bg-[var(--border)]" aria-hidden="true" />
        <div className="selection-toolbar-group flex min-w-0 shrink-0 items-center gap-1">
          {children}
        </div>
      </div>
    </div>
  );
}
