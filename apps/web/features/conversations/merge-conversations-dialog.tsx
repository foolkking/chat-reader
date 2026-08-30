"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { usePreferences } from "../../components/preferences-provider";
import { MergeOrderList } from "./merge-order-list";

type MergeConversation = { id: string; title: string; display_title: string };

export function MergeConversationsDialog({ open, conversations, title, busy, onTitleChange, onReorder, onMerge, onClose }: {
  open: boolean;
  conversations: MergeConversation[];
  title: string;
  busy: boolean;
  onTitleChange: (title: string) => void;
  onReorder: (ids: string[]) => void;
  onMerge: () => Promise<void>;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";

  useDialogFocus({ open, rootRef, initialFocusRef: titleRef, onClose: () => { if (!busy) onClose(); } });
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="merge-conversations-title" className="fixed inset-0 z-[270] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-[2vw]">
      <button type="button" data-dialog-backdrop aria-label={zh ? "关闭" : "Close"} className="absolute inset-0" disabled={busy} onPointerDown={onClose} />
      <section className="relative flex max-h-[min(86dvh,44rem)] w-full flex-col overflow-hidden rounded-t-xl border border-ui bg-raised shadow-2xl sm:max-w-xl sm:rounded-xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-ui px-5 py-4">
          <div className="min-w-0 flex-1"><h2 id="merge-conversations-title" className="text-base font-semibold text-primary">{zh ? "合并对话" : "Merge conversations"}</h2><p className="mt-1 text-sm text-secondary">{zh ? `确认 ${conversations.length} 个对话的标题与合并顺序。` : `Confirm the title and order for ${conversations.length} conversations.`}</p></div>
          <button type="button" disabled={busy} onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:opacity-40" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="text-sm font-medium text-primary">{zh ? "合并标题" : "Merge title"}<input ref={titleRef} value={title} onChange={(event) => { onTitleChange(event.target.value); setError(null); }} className="mt-2 block h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          <p className="mt-5 text-sm font-medium text-primary">{zh ? "合并顺序" : "Merge order"}</p>
          <p className="mt-1 text-xs text-secondary">{zh ? "从上到下组成新对话。拖动整行可调整顺序。" : "The new conversation follows this top-to-bottom order. Drag a row to reorder."}</p>
          <MergeOrderList conversations={conversations} disabled={busy} onReorder={onReorder} />
          {error ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-ui bg-surface px-5 py-4">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-40">{zh ? "取消" : "Cancel"}</button>
          <button type="button" disabled={busy || conversations.length < 2} onClick={async () => { setError(null); try { await onMerge(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }} className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:cursor-wait disabled:opacity-60">{busy ? (zh ? "正在合并…" : "Merging…") : (zh ? `合并 ${conversations.length} 个对话` : `Merge ${conversations.length} conversations`)}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
