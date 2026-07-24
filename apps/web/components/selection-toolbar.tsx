"use client";

import { CheckSquare2, RefreshCcw, Square, X } from "lucide-react";

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
}) {
  const zh = locale === "zh-CN";
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const buttonClass = "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-secondary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      role="toolbar"
      aria-label={zh ? `${context === "project" ? "项目" : "对话"}批量选择工具` : `${context === "project" ? "Project" : "Conversation"} bulk selection tools`}
      className={`sticky top-0 z-20 flex flex-wrap items-center gap-1.5 rounded-lg border border-ui bg-surface/95 p-2.5 shadow-sm backdrop-blur ${className}`}
    >
      <span className="mr-auto min-w-28 text-sm font-medium text-primary" aria-live="polite">
        {zh ? `已选 ${selectedCount} / ${totalCount} 个${context === "project" ? "项目" : "对话"}` : `${selectedCount} of ${totalCount} ${context === "project" ? "projects" : "conversations"} selected`}
      </span>
      <button type="button" disabled={busy || allSelected || totalCount === 0} onClick={onSelectAll} className={buttonClass} title={zh ? "选择当前列表中的全部对话" : "Select every conversation in this list"}>
        <CheckSquare2 className="h-4 w-4" /> {zh ? "全选" : "Select all"}
      </button>
      <button type="button" disabled={busy || totalCount === 0} onClick={onInvert} className={buttonClass} title={zh ? "反转当前列表中的选择" : "Invert the current selection"}>
        <RefreshCcw className="h-4 w-4" /> {zh ? "反选" : "Invert"}
      </button>
      <button type="button" disabled={busy || selectedCount === 0} onClick={onClear} className={buttonClass} title={zh ? "清空当前选择" : "Clear the current selection"}>
        <Square className="h-4 w-4" /> {zh ? "清空" : "Clear"}
      </button>
      <button type="button" disabled={busy} onClick={onDone} className={`${buttonClass} border-l border-ui pl-3 text-primary`} title={zh ? "退出选择模式" : "Exit selection mode"}>
        <X className="h-4 w-4" /> {zh ? "完成" : "Done"}
      </button>
    </div>
  );
}
