"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import { useRef } from "react";
import { usePreferences } from "./preferences-provider";
import type { ConversationSortMode, ProjectSortMode, SortDirection } from "../lib/types";

type SortOption<T extends string> = { value: T; zh: string; en: string };

const conversationOptions: SortOption<ConversationSortMode>[] = [
  { value: "recent_read", zh: "最近阅读", en: "Recently read" },
  { value: "updated", zh: "最近更新", en: "Recently updated" },
  { value: "created", zh: "创建时间", en: "Created" },
  { value: "imported", zh: "最近导入", en: "Recently imported" },
  { value: "title", zh: "标题", en: "Title" },
  { value: "message_count", zh: "消息数量", en: "Message count" },
  { value: "custom", zh: "自定义", en: "Custom" },
];
const projectOptions: SortOption<ProjectSortMode>[] = [
  { value: "recent_read", zh: "最近阅读", en: "Recently read" },
  { value: "updated", zh: "最近更新", en: "Recently updated" },
  { value: "created", zh: "创建时间", en: "Created" },
  { value: "title", zh: "标题", en: "Title" },
  { value: "conversation_count", zh: "对话数量", en: "Conversation count" },
  { value: "custom", zh: "自定义", en: "Custom" },
];

export function ConversationSortMenu() {
  const preferences = usePreferences();
  return <SortMenu options={conversationOptions} mode={preferences.conversationSortMode} direction={preferences.conversationSortDirection} onChange={preferences.setConversationSort} locale={preferences.resolvedLocale} />;
}

export function ProjectSortMenu() {
  const preferences = usePreferences();
  return <SortMenu options={projectOptions} mode={preferences.projectSortMode} direction={preferences.projectSortDirection} onChange={preferences.setProjectSort} locale={preferences.resolvedLocale} />;
}

function SortMenu<T extends string>({ options, mode, direction, onChange, locale }: {
  options: SortOption<T>[];
  mode: T;
  direction: SortDirection;
  onChange: (mode: T, direction: SortDirection) => Promise<void>;
  locale: "zh-CN" | "en-US";
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = options.find((option) => option.value === mode) ?? options[0];
  const label = mode === "message_count"
    ? (locale === "zh-CN" ? (direction === "desc" ? "最长对话" : "最短对话") : (direction === "desc" ? "Longest" : "Shortest"))
    : mode === "conversation_count"
      ? (locale === "zh-CN" ? (direction === "desc" ? "对话最多" : "对话最少") : (direction === "desc" ? "Most conversations" : "Fewest conversations"))
      : locale === "zh-CN" ? selected.zh : selected.en;
  return (
    <details ref={detailsRef} className="relative">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm text-secondary hover:bg-subtle marker:hidden">
        <ArrowUpDown className="h-4 w-4" /><span>{label}</span>
      </summary>
      <div className="absolute right-0 top-11 z-50 w-52 rounded-lg border border-ui bg-raised p-1 shadow-xl">
        {options.map((option) => (
          <button key={option.value} type="button" onClick={() => { detailsRef.current?.removeAttribute("open"); void onChange(option.value, direction); }} className="flex min-h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-primary hover:bg-subtle">
            <span className="flex-1">{locale === "zh-CN" ? option.zh : option.en}</span>
            {option.value === mode ? <Check className="h-4 w-4 text-accent" /> : null}
          </button>
        ))}
        <div className="mt-1 flex border-t border-ui pt-1">
          {(["desc", "asc"] as const).map((value) => (
            <button key={value} type="button" onClick={() => { detailsRef.current?.removeAttribute("open"); void onChange(mode, value); }} className={`flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md text-xs ${direction === value ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle"}`}>
              {value === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              {locale === "zh-CN" ? (value === "desc" ? "降序" : "升序") : value === "desc" ? "Descending" : "Ascending"}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
