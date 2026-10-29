"use client";

import { BookmarkCheck, BookmarkPlus, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiRequestError, deleteUserFeatureEntry, getUserFeatureEntries, saveUserFeatureEntry } from "../../lib/api";
import type { ReadingListValue, UserFeatureEntry } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";

export const readingListQueryKey = ["user-feature-entries", "reading-list"] as const;

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entriesQuery = useQuery({
    queryKey: readingListQueryKey,
    queryFn: ({ signal }) => getUserFeatureEntries<ReadingListValue>("reading-list", signal),
    staleTime: 15_000,
  });
  const entry = (entriesQuery.data ?? []).find((candidate) => candidate.value.conversation_id === conversationId);
  const isRead = entry?.value.state === "read";
  const label = entry
    ? (isRead ? (zh ? "标记为待读" : "Mark unread") : (zh ? "标记为已读" : "Mark read"))
    : (zh ? "加入待读清单" : "Add to reading list");

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextValue: ReadingListValue = {
        conversation_id: conversationId,
        state: !entry || isRead ? "unread" : "read",
      };
      await saveUserFeatureEntry(
        "reading-list",
        entry?.id ?? crypto.randomUUID(),
        { expected_revision: entry?.revision ?? 0, value: nextValue },
      );
      await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setError(zh ? "清单已在其他窗口更新，已重新加载。" : "The list changed in another window and was reloaded.");
        await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
      } else {
        setError(zh ? "更新待读清单失败。" : "Could not update the reading list.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteUserFeatureEntry("reading-list", entry.id, entry.revision);
      await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setError(zh ? "清单已在其他窗口更新，已重新加载。" : "The list changed in another window and was reloaded.");
        await queryClient.invalidateQueries({ queryKey: readingListQueryKey });
      } else {
        setError(zh ? "移出待读清单失败。" : "Could not remove this item from the reading list.");
      }
    } finally {
      setBusy(false);
    }
  }

  const Icon = entry ? BookmarkCheck : BookmarkPlus;
  return (
    <span className="inline-flex shrink-0 items-center gap-1" data-testid="reading-list-control">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy || !entriesQuery.isSuccess}
        aria-pressed={Boolean(entry)}
        aria-busy={busy}
        aria-label={label}
        title={label}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-ui bg-surface text-xs font-medium text-secondary hover:bg-subtle hover:text-primary disabled:opacity-50 ${compact ? "w-11 px-0" : "px-2.5"}`}
        data-testid="reading-list-toggle"
      >
        <Icon className="h-4 w-4" />
        {compact ? <span className="sr-only">{label}</span> : <span>{entry ? (isRead ? (zh ? "已读" : "Read") : (zh ? "待读" : "Unread")) : (zh ? "待读" : "Read later")}</span>}
      </button>
      {entriesQuery.isError ? (
        <button type="button" onClick={() => void entriesQuery.refetch()} className="min-h-11 rounded-lg px-2 text-xs text-accent">
          {zh ? "重试清单" : "Retry list"}
        </button>
      ) : null}
      {entry ? (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          aria-label={zh ? "移出待读清单" : "Remove from reading list"}
          title={zh ? "移出待读清单" : "Remove from reading list"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary disabled:opacity-50"
          data-testid="reading-list-remove"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
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
