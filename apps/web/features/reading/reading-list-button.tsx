"use client";

import { Star, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiRequestError, getUserFeatureEntries } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { ReadingListValue, UserFeatureEntry } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { useFeatureEntryRecovery } from "../../components/feature-entry-recovery";

export const readingListQueryKey = ["user-feature-entries", "reading-list"] as const;

// Intent: keep a long-reading session in place while the reader saves a
// favorite or checks an uncertain result. Existing paper/graphite surfaces,
// semantic star color, quiet border depth, app typography and 4px spacing.
export function ReadingListButton({
  conversationId,
  compact = false,
}: {
  conversationId: string;
  compact?: boolean;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const statusId = useId();
  const mounted = useRef(false);
  const generation = authenticationGeneration();
  const scope = `${generation}:${conversationId}`;
  // A -> B -> A is a new visit, not ownership of A's old async operation.
  const scopeOwner = useMemo(() => ({ scope }), [scope]);
  const scopeOwnerRef = useRef(scopeOwner);
  scopeOwnerRef.current = scopeOwner;
  const [openScope, setOpenScope] = useState<typeof scopeOwner | null>(null);
  const [error, setError] = useState<{ scope: typeof scopeOwner; message: string } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const noticeEpoch = useRef(0);
  const panelOwnedFocus = useRef(false);
  const entriesQuery = useQuery({
    queryKey: readingListQueryKey,
    queryFn: ({ signal }) => getUserFeatureEntries<ReadingListValue>("reading-list", signal),
    staleTime: 15_000,
  });
  const entry = (entriesQuery.data ?? []).find((candidate) => candidate.value.conversation_id === conversationId);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: readingListQueryKey }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["reading-list-summary"] }).catch(() => {});
  };
  const saved = (value: UserFeatureEntry<ReadingListValue>) => {
    queryClient.setQueryData<UserFeatureEntry<ReadingListValue>[]>(readingListQueryKey,
      (rows = []) => [value, ...rows.filter((row) => row.id !== value.id)]);
    refresh();
  };
  const removed = (value: UserFeatureEntry<ReadingListValue>) => {
    queryClient.setQueryData<UserFeatureEntry<ReadingListValue>[]>(readingListQueryKey,
      (rows = []) => rows.filter((row) => row.id !== value.id));
    refresh();
  };
  const recovery = useFeatureEntryRecovery<ReadingListValue>("reading-list", zh, saved, removed, () => refresh());
  const busy = recovery.phase === "writing" || recovery.phase === "checking";
  const noticeOpen = openScope === scopeOwner;
  const currentError = error?.scope === scopeOwner ? error.message : null;
  const active = () => mounted.current && generation === authenticationGeneration() && scopeOwnerRef.current === scopeOwner;
  const focusToggle = () => {
    // The desktop/mobile copies coexist; never return focus to a hidden copy.
    if (toggleRef.current?.getClientRects().length) toggleRef.current.focus({ preventScroll: true });
  };
  const closeNotice = (returnFocus = false) => {
    noticeEpoch.current += 1;
    panelOwnedFocus.current = false;
    setOpenScope(null);
    if (returnFocus) focusToggle();
  };
  const failureMessage = (cause: unknown) => cause instanceof ApiRequestError && cause.status >= 400 && cause.status < 500 && ![408, 409, 429].includes(cause.status)
    ? (zh ? "收藏请求被拒绝，请检查权限或收藏数量后重试。" : "The favorite request was rejected. Check access or the favorites limit before retrying.")
    : (zh ? "收藏结果尚未确认，先读取核对，不会重复提交。" : "Favorite status is unconfirmed. Check it without repeating the write.");
  const label = recovery.blocked
    ? (zh ? "核对收藏状态" : "Check favorite status")
    : entriesQuery.isError
      ? (zh ? "无法读取收藏状态，重试" : "Favorite status unavailable. Retry")
      : !entriesQuery.isSuccess
        ? (zh ? "正在读取收藏状态" : "Loading favorite status")
        : entry
          ? (zh ? "取消收藏" : "Remove from favorites")
          : (zh ? "收藏对话" : "Add to favorites");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!noticeOpen) return;
    // A body portal is not next in the header's tab order. Hand off focus only
    // while the opener still owns it; a late response must not steal it back.
    if (document.activeElement === toggleRef.current) panelRef.current?.focus({ preventScroll: true });
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panelRef.current?.contains(event.target)) {
        panelOwnedFocus.current = false;
        noticeEpoch.current += 1;
        setOpenScope(null);
      }
    };
    const closeKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      noticeEpoch.current += 1;
      panelOwnedFocus.current = false;
      setOpenScope(null);
      if (toggleRef.current?.getClientRects().length) toggleRef.current.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside);
    window.addEventListener("keydown", closeKey);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside);
      window.removeEventListener("keydown", closeKey);
    };
  }, [noticeOpen]);
  useEffect(() => {
    // React may replace an action after its async handler has returned.
    if (noticeOpen && panelOwnedFocus.current && document.activeElement === document.body) {
      panelRef.current?.focus({ preventScroll: true });
    }
  }, [noticeOpen, recovery.phase]);

  async function toggle() {
    if (busy) return;
    if (recovery.blocked || entriesQuery.isError) {
      setOpenScope(scopeOwner);
      return;
    }
    if (!entriesQuery.isSuccess) return;
    setError(null);
    closeNotice();
    try {
      if (entry) await recovery.remove(entry);
      else {
        const now = new Date().toISOString();
        await recovery.save({
          id: crypto.randomUUID(), collection: "reading-list", revision: 0,
          value: { conversation_id: conversationId, state: "unread" },
          created_at: now, updated_at: now,
        });
      }
    } catch (cause) {
      if (!active()) return;
      setError({ scope: scopeOwner, message: failureMessage(cause) });
      setOpenScope(scopeOwner);
    }
  }

  async function recover(action: "check" | "retry" | "reload") {
    const epoch = noticeEpoch.current;
    const hadFocus = Boolean(panelRef.current?.contains(document.activeElement));
    const ownsNotice = () => active() && noticeEpoch.current === epoch;
    const ownsFocus = () => hadFocus && (document.activeElement === document.body || Boolean(panelRef.current?.contains(document.activeElement)));
    try {
      if (action === "check") {
        await recovery.checkCurrentState();
        // Checking may replace the focused button with a different action.
        if (ownsNotice() && ownsFocus() && document.activeElement === document.body) panelRef.current?.focus({ preventScroll: true });
        return;
      }
      if (action === "retry") await recovery.retryOriginalCreate();
      else if (!(await entriesQuery.refetch()).isSuccess) return;
      if (!ownsNotice()) return;
      setError(null);
      closeNotice(ownsFocus());
    } catch (cause) {
      if (!ownsNotice()) return;
      setError({ scope: scopeOwner, message: failureMessage(cause) });
      if (ownsFocus() && document.activeElement === document.body) panelRef.current?.focus({ preventScroll: true });
    }
  }

  return (
    <span ref={root} className="relative inline-flex shrink-0 items-center" data-testid="reading-list-control">
      <button
        ref={toggleRef}
        type="button"
        onClick={() => void toggle()}
        disabled={entriesQuery.isPending && !recovery.blocked}
        aria-disabled={busy || undefined}
        aria-pressed={entriesQuery.isSuccess && !recovery.blocked ? Boolean(entry) : undefined}
        aria-busy={busy || entriesQuery.isPending}
        aria-label={label}
        title={label}
        aria-controls={noticeOpen ? statusId : undefined}
        aria-expanded={noticeOpen}
        className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-ui bg-surface text-xs font-medium text-secondary hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:opacity-50 ${compact ? "w-11 px-0" : "px-2.5"}`}
        data-testid="reading-list-toggle"
      >
        <Star aria-hidden="true" className={`h-[1.125rem] w-[1.125rem] ${entry ? "fill-[var(--color-semantic-favorite)] text-[var(--color-semantic-favorite)]" : ""}`} />
        {compact ? <span className="sr-only">{label}</span> : <span>{recovery.blocked ? (zh ? "待核对" : "Check status") : entry ? (zh ? "已收藏" : "Favorited") : (zh ? "收藏" : "Favorite")}</span>}
      </button>
      {noticeOpen ? createPortal(
        <div ref={panelRef} id={statusId} tabIndex={-1} onFocusCapture={() => { panelOwnedFocus.current = true; }} data-reader-auxiliary role="region" aria-label={zh ? "收藏状态与恢复操作" : "Favorite status and recovery"} className="reader-favorite-status fixed left-1/2 top-20 z-[80] max-h-[70dvh] w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-lg border border-ui bg-raised p-3 text-xs text-secondary shadow-md outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]">
          <div className="flex items-start justify-between gap-2">
            <p role="status" className="py-2">{recovery.phase === "matches"
              ? (zh ? "已核对，当前收藏状态与原操作一致。" : "Checked. Favorite status matches the original action.")
              : recovery.phase === "different" || recovery.phase === "absent"
                ? (zh ? "已核对，当前状态与原操作不同；可以采用当前状态。" : "Checked. The current state differs. You can keep the current state.")
                : recovery.phase === "read_failed"
                  ? (zh ? "读取核对失败，原请求仍保留，请重试读取。" : "The check failed. The original request is retained. Retry the read.")
                  : recovery.blocked
                    ? (zh ? "收藏结果待核对；关闭提示也不会再次提交。" : "Favorite status needs checking. Closing this notice does not repeat the write.")
                    : currentError ?? (zh ? "收藏状态读取失败，请重试读取。" : "Could not load favorite status. Retry the read.")}</p>
            <button type="button" aria-label={zh ? "关闭收藏提示" : "Close favorite notice"} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-subtle" onClick={() => closeNotice(true)}><X aria-hidden="true" className="h-4 w-4" /></button>
          </div>
          {recovery.pendingEntry && recovery.pendingEntry.value.conversation_id !== conversationId ? <p>{zh ? "待核对的是另一个对话的原收藏操作，不会改动当前对话。" : "The pending action belongs to another conversation. It does not change this conversation."}</p> : null}
          {recovery.blocked ? (
            ["matches", "different", "absent"].includes(recovery.phase ?? "") ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-11 underline" onClick={() => { recovery.acceptCheckedState(); setError(null); closeNotice(true); }}>{zh ? "采用已核对状态" : "Keep checked state"}</button>
                {recovery.canRetryOriginalCreate && recovery.pendingEntry?.value.conversation_id === conversationId ? <button type="button" className="min-h-11 underline" onClick={() => void recover("retry")}>{zh ? "按原请求重试" : "Retry original request"}</button> : null}
              </div>
            ) : <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => void recover("check")}>{busy ? (zh ? "正在核对…" : "Checking…") : (zh ? "只读核对" : "Check current state")}</button>
          ) : <button type="button" className="min-h-11 underline" disabled={entriesQuery.isFetching} onClick={() => void recover("reload")}>{zh ? "重新读取" : "Reload status"}</button>}
        </div>, document.body,
      ) : null}
    </span>
  );
}

export function useReadingListEntries() {
  return useQuery<UserFeatureEntry<ReadingListValue>[]>({
    queryKey: readingListQueryKey,
    queryFn: ({ signal }) => getUserFeatureEntries<ReadingListValue>("reading-list", signal),
    staleTime: 15_000,
  });
}
