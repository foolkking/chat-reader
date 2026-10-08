"use client";

import { useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { archiveConversation, getConversation, unarchiveConversation } from "../../lib/api";
import { runBatchSelection } from "../../lib/batch-selection";

export type UndoAction = {
  id: string;
  label: string;
  conversationIds: string[];
  targetStatus: "active" | "archived";
  onChanged: () => Promise<void> | void;
};

export function createConversationUndo(
  conversationIds: string[],
  targetStatus: UndoAction["targetStatus"],
  label: string,
  onChanged: UndoAction["onChanged"],
): UndoAction {
  return { id: crypto.randomUUID(), conversationIds, targetStatus, label, onChanged };
}

// Keep this owner mounted even when the surrounding list becomes empty/errors.
// Callers key it by action identity; old completion must not dismiss a newer undo.
export function ConversationUndoNotice({ undo, onDone, disabled = false }: {
  undo: UndoAction;
  onDone: () => void;
  disabled?: boolean;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [remainingIds, setRemainingIds] = useState(undo.conversationIds);
  const [mode, setMode] = useState<"undo" | "check" | "retry">("undo");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const completed = undo.conversationIds.length - remainingIds.length;

  async function run() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    try {
      let confirmedIds: string[];
      let nextMode: "check" | "retry";
      if (mode === "check") {
        const notApplied = new Set<string>();
        const result = await runBatchSelection(remainingIds, async (id) => {
          const conversation = await getConversation(id);
          if (conversation.status !== undo.targetStatus) notApplied.add(id);
        });
        confirmedIds = result.succeededIds.filter((id) => !notApplied.has(id));
        nextMode = result.failedIds.length ? "check" : "retry";
      } else {
        const operation = undo.targetStatus === "active" ? unarchiveConversation : archiveConversation;
        const result = await runBatchSelection(remainingIds, async (id) => {
          const conversation = await operation(id);
          if (conversation.status !== undo.targetStatus) throw new Error("Unconfirmed conversation status");
        });
        confirmedIds = result.succeededIds;
        // Any lost/error response could conceal a committed write. The next
        // explicit action only reads, and never replays a confirmed success.
        nextMode = "check";
      }
      const confirmed = new Set(confirmedIds);
      const remaining = remainingIds.filter((id) => !confirmed.has(id));
      setRemainingIds(remaining);
      setMode(nextMode);
      if (!remaining.length) onDone();
      // A failed/slow list refresh is not a failed undo. The list owns its read
      // error; acknowledge confirmed writes before starting that refresh.
      void Promise.resolve().then(undo.onChanged).catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const label = busy
    ? mode === "check" ? (zh ? "正在检查…" : "Checking…") : (zh ? "正在撤销…" : "Undoing…")
    : mode === "check" ? (zh ? "检查结果" : "Check result")
      : mode === "retry" ? (zh ? "重试撤销" : "Retry undo") : (zh ? "撤销" : "Undo");
  return (
    <div aria-label={zh ? "撤销对话操作" : "Undo conversation action"} aria-busy={busy}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--callout-warning-border)] bg-[var(--callout-warning-bg)] px-4 py-3 text-sm text-[var(--callout-warning-text)]">
      <div className="min-w-0 flex-1" role={mode === "undo" ? "status" : "alert"}>
        <p>{undo.label}</p>
        {mode !== "undo" ? <p className="mt-1">
          {mode === "check"
            ? (zh ? `已撤销 ${completed} 项；${remainingIds.length} 项结果未确认，请先检查。` : `${completed} undone; ${remainingIds.length} results need checking.`)
            : (zh ? `已撤销 ${completed} 项；${remainingIds.length} 项尚未完成，可以重试。` : `${completed} undone; ${remainingIds.length} remain. Retry those items.`)}
        </p> : null}
      </div>
      <button type="button" onClick={() => void run()} disabled={busy || disabled}
        className="min-h-11 shrink-0 rounded-lg bg-[var(--callout-warning-text)] px-3 text-sm font-medium text-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-wait disabled:opacity-60">
        {label}
      </button>
    </div>
  );
}
