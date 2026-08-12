"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { queueTocRefresh } from "../../lib/api";
import type { BackgroundTaskRead, TocRefreshInput } from "../../lib/types";

export function TocRefreshDialog({
  open,
  conversationId,
  locale,
  onClose,
  onQueued,
}: {
  open: boolean;
  conversationId: string;
  locale: "zh-CN" | "en-US";
  onClose: () => void;
  onQueued: (task: BackgroundTaskRead, input: TocRefreshInput) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [dialogue, setDialogue] = useState(true);
  const [sections, setSections] = useState(true);
  const [scope, setScope] = useState<TocRefreshInput["sectionScope"]>("current_conversation");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zh = locale === "zh-CN";

  useEffect(() => {
    if (!open) return;
    setDialogue(true);
    setSections(true);
    setScope("current_conversation");
    setSubmitting(false);
    setError(null);
  }, [open]);

  useDialogFocus({
    open,
    rootRef,
    onClose,
    initialFocusRef: firstInputRef,
    restoreFocus: () => Array.from(document.querySelectorAll<HTMLElement>("[data-reader-more-actions='true']")).find((item) => item.offsetParent !== null) ?? null,
  });
  if (!open) return null;

  async function submit() {
    if (!dialogue && !sections) return;
    const input: TocRefreshInput = {
      refreshDialogueIndex: dialogue,
      refreshSectionToc: sections,
      sectionScope: scope,
    };
    setSubmitting(true);
    setError(null);
    try {
      const task = await queueTocRefresh(conversationId, input);
      onQueued(task, input);
      onClose();
    } catch {
      setError(zh ? "目录更新任务创建失败，请重试。" : "The TOC refresh task could not be created. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[270] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-[2vw]" role="dialog" aria-modal="true" aria-labelledby="toc-refresh-title">
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={onClose} />
      <form className="relative w-full rounded-t-2xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-lg sm:rounded-xl" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent"><RefreshCw className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="toc-refresh-title" className="text-base font-semibold text-primary">{zh ? "更新目录" : "Refresh contents"}</h2>
            <p className="mt-1 text-sm leading-6 text-secondary">{zh ? "内容变化后，可重新获取对话目录并重建章节目录。" : "Refresh the dialogue index and rebuild section contents after content changes."}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"} title={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </div>

        <fieldset className="mt-5 space-y-2">
          <legend className="mb-2 text-sm font-medium text-primary">{zh ? "选择更新内容" : "Choose what to refresh"}</legend>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-ui bg-surface px-3 text-sm text-primary">
            <input ref={firstInputRef} type="checkbox" checked={dialogue} onChange={(event) => setDialogue(event.target.checked)} className="h-4 w-4" />
            <span><span className="font-medium">{zh ? "对话目录" : "Dialogue index"}</span><span className="ml-2 text-secondary">{zh ? "重新获取当前对话的消息索引" : "Reload this conversation's message index"}</span></span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-ui bg-surface px-3 text-sm text-primary">
            <input type="checkbox" checked={sections} onChange={(event) => setSections(event.target.checked)} className="h-4 w-4" />
            <span><span className="font-medium">{zh ? "章节目录" : "Section contents"}</span><span className="ml-2 text-secondary">{zh ? "从当前版本标题重建" : "Rebuild from current-version headings"}</span></span>
          </label>
        </fieldset>

        <fieldset disabled={!sections} className="mt-4 rounded-lg bg-subtle p-3 disabled:opacity-45">
          <legend className="px-1 text-sm font-medium text-primary">{zh ? "章节目录范围" : "Section scope"}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="flex min-h-11 items-center gap-2 rounded-md bg-surface px-3 text-sm"><input type="radio" name="section-scope" checked={scope === "current_conversation"} onChange={() => setScope("current_conversation")} />{zh ? "当前对话（默认）" : "Current conversation (default)"}</label>
            <label className="flex min-h-11 items-center gap-2 rounded-md bg-surface px-3 text-sm"><input type="radio" name="section-scope" checked={scope === "all_conversations"} onChange={() => setScope("all_conversations")} />{zh ? "全部对话" : "All conversations"}</label>
          </div>
          {scope === "all_conversations" && sections ? <p className="mt-2 text-xs leading-5 text-secondary">{zh ? "将依次重建所有未删除对话的章节目录，可能需要一些时间。" : "All non-deleted conversations will be rebuilt in sequence. This may take some time."}</p> : null}
        </fieldset>

        {!dialogue && !sections ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{zh ? "请至少选择一项。" : "Select at least one item."}</p> : null}
        {error ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle">{zh ? "取消" : "Cancel"}</button>
          <button type="submit" disabled={submitting || (!dialogue && !sections)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"><RefreshCw className={`h-4 w-4 ${submitting ? "animate-spin" : ""}`} />{submitting ? (zh ? "正在提交…" : "Submitting…") : (zh ? "开始更新" : "Start refresh")}</button>
        </div>
      </form>
    </div>
  );
}
