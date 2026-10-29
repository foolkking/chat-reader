"use client";

import { X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { ConversationListItem } from "../../lib/types";

export type BatchTitleTrimOperation = "trim" | "remove-prefix" | "add-prefix";

export type BatchTitleTrimChange = {
  id: string;
  originalTitle: string;
  originalDisplayTitle: string;
  nextTitle: string;
};

export type BatchTitleTrimResult = {
  succeededIds: string[];
  failedIds: string[];
  unknownIds: string[];
};

type PreviewRow = BatchTitleTrimChange & {
  unchanged: boolean;
  empty: boolean;
};

export function BatchTitleTrim({
  open,
  conversations,
  busy,
  locale,
  onClose,
  onConfirm,
}: {
  open: boolean;
  conversations: ConversationListItem[];
  busy: boolean;
  locale: "zh-CN" | "en-US";
  onClose: () => void;
  onConfirm: (changes: BatchTitleTrimChange[]) => Promise<BatchTitleTrimResult>;
}) {
  const zh = locale === "zh-CN";
  const titleId = useId();
  const operationId = useId();
  const prefixId = useId();
  const [operation, setOperation] = useState<BatchTitleTrimOperation>("trim");
  const [prefix, setPrefix] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const preview = useMemo<PreviewRow[]>(() => conversations.map((conversation) => {
    const originalTitle = conversation.title;
    const originalDisplayTitle = conversation.display_title;
    const source = originalDisplayTitle || originalTitle;
    const nextTitle = nextValue(source, operation, prefix);
    return {
      id: conversation.id,
      originalTitle,
      originalDisplayTitle,
      nextTitle,
      unchanged: nextTitle === source && originalTitle === nextTitle && originalDisplayTitle === nextTitle,
      empty: nextTitle.length === 0,
    };
  }), [conversations, operation, prefix]);

  if (!open) return null;

  const changed = preview.filter((row) => !row.unchanged);
  const empty = preview.filter((row) => row.empty);
  const hasInvalidPrefix = operation !== "trim" && prefix.length === 0;
  const canSubmit = !busy && !submitting && changed.length > 0 && empty.length === 0 && !hasInvalidPrefix;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(changed);
      onClose();
    } catch {
      setError(zh ? "批量标题修改未完成，草稿仍保留。请先核对结果后再关闭。" : "The batch title update did not complete. The preview is retained so you can check the result before closing.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div aria-hidden="true" className="absolute inset-0" onPointerDown={onClose} />
      <section className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl sm:max-w-3xl sm:rounded-xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ui px-5 py-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-primary">{zh ? "批量修整标题" : "Batch title cleanup"}</h2>
            <p className="mt-1 text-xs text-secondary">{zh ? `已冻结 ${conversations.length} 个所选对话；列表刷新不会扩大范围。` : `${conversations.length} selected conversations are frozen; refreshes will not expand the scope.`}</p>
          </div>
          <button type="button" disabled={busy || submitting} onClick={onClose} aria-label={zh ? "关闭" : "Close"} className="btn-ghost flex min-h-11 min-w-11 items-center justify-center disabled:opacity-50"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div>
              <label htmlFor={operationId} className="block text-sm font-medium text-primary">{zh ? "操作" : "Operation"}</label>
              <select id={operationId} value={operation} disabled={busy || submitting} onChange={(event) => { setOperation(event.target.value as BatchTitleTrimOperation); setError(null); }} className="mt-2 min-h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--focus)]">
                <option value="trim">{zh ? "去除首尾空白" : "Trim surrounding whitespace"}</option>
                <option value="remove-prefix">{zh ? "删除字面前缀" : "Remove literal prefix"}</option>
                <option value="add-prefix">{zh ? "添加字面前缀" : "Add literal prefix"}</option>
              </select>
            </div>
            {operation !== "trim" ? (
              <div>
                <label htmlFor={prefixId} className="block text-sm font-medium text-primary">{zh ? "字面前缀（不使用正则）" : "Literal prefix (no regular expressions)"}</label>
                <input id={prefixId} value={prefix} maxLength={80} disabled={busy || submitting} onChange={(event) => { setPrefix(event.target.value); setError(null); }} className="mt-2 min-h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--focus)]" />
                <p className="mt-1 text-xs text-secondary">{zh ? `${prefix.length}/80；删除仅匹配标题开头的完全相同文本。` : `${prefix.length}/80; removal only matches an exact prefix at the beginning.`}</p>
              </div>
            ) : <div className="rounded-lg border border-ui bg-subtle px-3 py-2 text-sm text-secondary">{zh ? "只做字面首尾空白修整，不会改写正文或自动起名。" : "Only literal surrounding whitespace is removed; no content rewrite or automatic naming is performed."}</div>}
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-secondary" aria-live="polite">
            <span>{zh ? `将修改 ${changed.length} 项` : `${changed.length} will change`}</span>
            <span>{zh ? `${preview.length - changed.length} 项不变` : `${preview.length - changed.length} unchanged`}</span>
            {empty.length ? <span className="font-medium text-[var(--danger)]">{zh ? `${empty.length} 项会变为空标题` : `${empty.length} would become empty`}</span> : null}
          </div>

          {hasInvalidPrefix ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "请输入非空字面前缀。" : "Enter a non-empty literal prefix."}</p> : null}
          {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="overflow-hidden rounded-lg border border-ui">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-ui bg-subtle px-3 py-2 text-xs font-medium text-secondary">
              <span>{zh ? "原标题" : "Original"}</span>
              <span>{zh ? "预览结果" : "Preview"}</span>
            </div>
            <ul className="max-h-[min(45vh,28rem)] divide-y divide-[var(--border)] overflow-y-auto">
              {preview.map((row) => (
                <li key={row.id} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-3 text-sm ${row.empty ? "bg-[var(--danger-soft)]" : ""}`}>
                  <span className="min-w-0 break-words text-secondary">{row.originalDisplayTitle || row.originalTitle || (zh ? "（空）" : "(empty)")}</span>
                  <span className={`min-w-0 break-words ${row.empty ? "font-medium text-[var(--danger)]" : "text-primary"}`}>{row.nextTitle || (zh ? "（空标题，禁止提交）" : "(empty title; cannot submit)")}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ui px-5 py-3">
          <button type="button" disabled={busy || submitting} onClick={onClose} className="btn-secondary min-h-11 px-4">{zh ? "取消" : "Cancel"}</button>
          <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="btn-primary min-h-11 px-4 disabled:opacity-50">{busy || submitting ? (zh ? "正在修改…" : "Updating…") : (zh ? "确认修改" : "Apply changes")}</button>
        </footer>
      </section>
    </div>
  );
}

function nextValue(source: string, operation: BatchTitleTrimOperation, prefix: string): string {
  if (operation === "trim") return source.trim();
  if (operation === "remove-prefix") return source.startsWith(prefix) ? source.slice(prefix.length).trimStart() : source;
  return `${prefix}${source}`;
}
