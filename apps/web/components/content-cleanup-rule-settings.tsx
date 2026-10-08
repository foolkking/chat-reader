"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState, useLayoutEffect } from "react";
import { getCleanupRules } from "../lib/api";
import type { CleanupRuleRead } from "../lib/types";
import { CleanupExceptionList } from "./cleanup-exceptions";
import { CleanupRuleEditor } from "./cleanup-rule-editor";
import { GlobalCleanupScan } from "./global-cleanup-scan";
import { CleanupRuleRow } from "./cleanup-rule-row";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

export function ContentCleanupRuleSettings({ embedded = false, onBack, onDirtyChange, onOpenTasks }: {
  embedded?: boolean; onBack?: () => void; onDirtyChange?: (dirty: boolean) => void; onOpenTasks?: () => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const rules = useQuery({ queryKey: ["content-cleanup-rules"], queryFn: getCleanupRules, staleTime: 0, retry: false });
  const [editor, setEditor] = useState<CleanupRuleRead | "new" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const newRuleRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<{ id: string | null } | null>(null);
  const removed = (id: string, name: string, focus: boolean, wasRemoved: boolean) => {
    if (focus) {
      const rows = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-rule-id]") ?? []);
      const index = rows.findIndex(item => item.dataset.ruleId === id);
      returnFocus.current = { id: rows[index + 1]?.dataset.ruleId ?? rows[index - 1]?.dataset.ruleId ?? null };
    }
    setFeedback(wasRemoved ? (zh ? `已移除“${name}”，已有审查和正文保留。` : `“${name}” removed. Existing reviews and content are kept.`)
      : (zh ? `“${name}”已不可用，列表已更新。` : `“${name}” is no longer available. The list has been updated.`));
  };
  const finishEditor = (saved: boolean) => {
    const id = editor && editor !== "new" ? editor.id : null;
    returnFocus.current = { id };
    setEditor(null); setDirty(false);
    if (saved) setFeedback(zh ? "个人规则已保存，后续扫描使用此版本。" : "Personal rule saved. Future scans use this version.");
  };
  useLayoutEffect(() => {
    if (editor || !returnFocus.current) return;
    const { id } = returnFocus.current;
    returnFocus.current = null;
    const trigger = id ? rootRef.current?.querySelector<HTMLButtonElement>(`[data-rule-id="${id}"] button`) : newRuleRef.current;
    (trigger ?? newRuleRef.current)?.focus();
  }, [editor, rules.data]);
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const back = async () => {
    if (dirty && !await confirm({ title: zh ? "放弃未保存的规则？" : "Discard unsaved rule?", confirmLabel: zh ? "放弃草稿" : "Discard draft" })) return;
    setDirty(false); onDirtyChange?.(false); onBack?.();
  };
  return <section ref={rootRef} aria-label={zh ? "噪声规则库" : "Noise rule library"} className={embedded ? "min-h-0 space-y-4" : "space-y-4 rounded-xl border border-ui bg-surface p-4"}>
    <header className="space-y-3 border-b border-ui pb-4">
      {!embedded ? <h3 className="text-base font-semibold">{zh ? "噪声规则库" : "Noise rule library"}</h3> : null}

      <div className="flex flex-wrap items-start gap-2">{onBack ? <button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => void back()}>{zh ? "返回清理审查" : "Back to cleanup review"}</button> : null}{!editor ? <><button ref={newRuleRef} type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => setEditor("new")}>{zh ? "学习文本规则" : "Learn a text rule"}</button><GlobalCleanupScan onOpenTasks={onOpenTasks ?? (() => window.dispatchEvent(new Event("chat-reader:open-task-center")))} /></> : null}</div>
    </header>
    {editor ? <CleanupRuleEditor key={editor === "new" ? "new" : editor.id} rule={editor === "new" ? undefined : editor} onDirtyChange={setDirty} onDone={finishEditor} /> : <>
      {rules.isLoading ? <p role="status">{zh ? "正在读取规则…" : "Loading rules…"}</p> : null}
      {feedback ? <p role="status" className="text-xs leading-5 text-secondary">{feedback}</p> : null}
      {rules.error ? <div role="alert"><p className="text-xs text-[var(--danger)]">{zh ? "规则读取失败；下方是上次结果，请重试后操作。" : "Rules could not load. Any rows below are from the previous read; retry before changing them."}</p><button type="button" disabled={rules.isFetching} className="btn-secondary min-h-11 px-3" onClick={() => void rules.refetch()}>{zh ? "重试读取规则" : "Retry loading rules"}</button></div> : null}
      {[false, true].map((builtin) => <section key={String(builtin)} className="space-y-2"><h3 className="text-sm font-semibold">{builtin ? (zh ? "内置规则" : "Built-in rules") : (zh ? "我的规则" : "My rules")}</h3><div className="divide-y divide-[var(--border)] border-y border-ui">{rules.data?.filter((rule) => (rule.kind === "BUILTIN") === builtin).map((rule) => <CleanupRuleRow key={rule.id} rule={rule} unavailable={rules.isError} onRemoved={removed} onEdit={() => { setFeedback(""); setEditor(rule); }} />)}{!rules.isLoading && !rules.error && !rules.data?.some((rule) => (rule.kind === "BUILTIN") === builtin) ? <p className="py-4 text-xs text-secondary">{zh ? "尚无规则。" : "No rules yet."}</p> : null}</div></section>)}
      <CleanupExceptionList />
    </>}
  </section>;
}
