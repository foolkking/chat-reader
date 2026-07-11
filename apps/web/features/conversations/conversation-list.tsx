"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  archiveConversation,
  deleteConversation,
  getConversations,
  mergeConversations,
  restoreConversation,
} from "../../lib/api";
import type { ConversationListItem } from "../../lib/types";
import { stripLeadingTimestamp } from "./markdown-renderer";
import { ConversationActionMenu, type UndoAction } from "./conversation-action-menu";

export function ConversationList({
  onImportClick,
  mode = "active",
}: {
  onImportClick?: () => void;
  mode?: "active" | "archived";
}) {
  const queryClient = useQueryClient();
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [menuCloseSignal, setMenuCloseSignal] = useState(0);
  const [mergeTitle, setMergeTitle] = useState("Merged conversation");
  const [mergeOrderIds, setMergeOrderIds] = useState<string[]>([]);
  const conversationsQuery = useQuery({
    queryKey: ["conversations", mode],
    queryFn: () => getConversations({ includeArchived: mode === "archived" }),
  });
  const isArchivedMode = mode === "archived";

  async function refreshLists() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations", "active"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations", "archived"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  }

  if (conversationsQuery.isLoading) {
    return <StateBlock title="Loading conversations" detail="Fetching canonical conversation list." loading />;
  }

  if (conversationsQuery.isError) {
    return (
      <StateBlock
        title="Conversation API unavailable"
        detail={conversationsQuery.error.message}
        action={
          <button
            type="button"
            onClick={() => void conversationsQuery.refetch()}
            className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white"
          >
            Retry
          </button>
        }
      />
    );
  }

  const conversations = (conversationsQuery.data ?? []).filter((conversation) =>
    isArchivedMode ? conversation.status === "archived" : conversation.status !== "archived",
  );
  if (conversations.length === 0) {
    return (
      <StateBlock
        title={isArchivedMode ? "No archived conversations" : "No conversations yet"}
        detail={
          isArchivedMode
            ? "Archived conversations will appear here. Restore one to return it to All Conversations."
            : "Import a ChatGPT export to start building your local reading archive."
        }
        action={!isArchivedMode ? (
          <button
            type="button"
            onClick={onImportClick}
            className="rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white hover:bg-black"
          >
            Import conversations
          </button>
        ) : undefined}
      />
    );
  }

  return (
    <section className="space-y-3">
      {undo ? (
        <UndoToast
          undo={undo}
          onDone={() => {
            setUndo(null);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#111827]">
            {isArchivedMode ? "Archived conversations" : "Conversation history"}
          </h2>
          <p className="text-sm text-[#6b7280]">{conversations.length} shown</p>
        </div>
        {selectedConversationIds.size > 0 ? (
          <BulkActions
            mode={mode}
            selectedConversations={mergeOrderIds
              .map((id) => conversations.find((conversation) => conversation.id === id))
              .filter((conversation): conversation is ConversationListItem => Boolean(conversation))}
            title={mergeTitle}
            onTitleChange={setMergeTitle}
            isMerging={isMerging}
            bulkBusy={bulkBusy}
            onMove={(id, direction) => {
              setMergeOrderIds((current) => moveId(current, id, direction));
            }}
            onMerge={async (ids, title) => {
              setIsMerging(true);
              try {
                await mergeConversations({ conversationIds: ids, title: title.trim() || "Merged conversation" });
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
                setMergeTitle("Merged conversation");
                await refreshLists();
              } finally {
                setIsMerging(false);
              }
            }}
            onArchive={async (ids) => {
              setBulkBusy("archive");
              try {
                await Promise.all(ids.map((id) => archiveConversation(id)));
                setUndo({
                  label: `已归档 ${ids.length} 个会话`,
                  action: async () => {
                    await Promise.all(ids.map((id) => restoreConversation(id)));
                    await refreshLists();
                  },
                });
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
                await refreshLists();
              } finally {
                setBulkBusy(null);
              }
            }}
            onRestore={async (ids) => {
              setBulkBusy("restore");
              try {
                await Promise.all(ids.map((id) => restoreConversation(id)));
                setUndo({
                  label: `已恢复 ${ids.length} 个会话`,
                  action: async () => {
                    await Promise.all(ids.map((id) => archiveConversation(id)));
                    await refreshLists();
                  },
                });
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
                await refreshLists();
              } finally {
                setBulkBusy(null);
              }
            }}
            onDelete={async (ids) => {
              if (!window.confirm(`Delete ${ids.length} selected conversations?`)) {
                return;
              }
              setBulkBusy("delete");
              try {
                await Promise.all(ids.map((id) => deleteConversation(id)));
                setUndo({
                  label: `已删除 ${ids.length} 个会话`,
                  action: async () => {
                    await Promise.all(ids.map((id) => restoreConversation(id)));
                    await refreshLists();
                  },
                });
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
                await refreshLists();
              } finally {
                setBulkBusy(null);
              }
            }}
          />
        ) : (
          <span className="text-sm text-[#6b7280]">
            {isArchivedMode ? "Select conversations to restore or delete" : "Select 2+ to merge"}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
        {conversations.map((conversation) => (
          <article
            key={conversation.id}
            className="group border-b border-[#ececec] px-4 py-3 transition last:border-b-0 hover:bg-[#fbfbfb]"
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
              <div className="flex min-w-0 gap-3">
                <label className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#d1d5db] bg-white">
                  <input
                    type="checkbox"
                    checked={selectedConversationIds.has(conversation.id)}
                    onChange={(event) => {
                      setMenuCloseSignal((signal) => signal + 1);
                      setSelectedConversationIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(conversation.id);
                        } else {
                          next.delete(conversation.id);
                        }
                        return next;
                      });
                      setMergeOrderIds((current) => {
                        if (event.target.checked) {
                          return current.includes(conversation.id) ? current : [...current, conversation.id];
                        }
                        return current.filter((id) => id !== conversation.id);
                      });
                    }}
                    aria-label={`Select ${conversation.display_title || conversation.title}`}
                  />
                </label>
                <div className="min-w-0">
                  <Link href={`/conversations/${conversation.id}`}>
                    <h3 className="truncate text-base font-semibold text-slate-950">
                      {conversation.is_global_pinned ? "Pinned / " : ""}
                      {conversation.display_title || conversation.title}
                    </h3>
                  </Link>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#4b5563]">
                    {previewConversationText(conversation.first_user_message)}
                  </p>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 md:justify-end md:text-right">
                <div className="min-w-0 md:order-2">
                  <p className="inline-flex rounded-full bg-[#f7f7f8] px-2 py-1 text-xs font-medium text-[#4b5563]">
                    {conversation.source_profile}
                  </p>
                  <p className="mt-1 text-sm text-[#6b7280]">{conversation.message_count} messages</p>
                </div>
                <div className="md:order-1">
                  <ConversationActionMenu
                    conversation={conversation}
                    closeSignal={menuCloseSignal}
                    onUndo={setUndo}
                    onChanged={refreshLists}
                  />
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function previewConversationText(text?: string | null): string {
  const cleaned = stripLeadingTimestamp(text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || "No first user message.";
}

function BulkActions({
  mode,
  selectedConversations,
  title,
  onTitleChange,
  isMerging,
  bulkBusy,
  onMove,
  onMerge,
  onArchive,
  onRestore,
  onDelete,
}: {
  mode: "active" | "archived";
  selectedConversations: ConversationListItem[];
  title: string;
  onTitleChange: (title: string) => void;
  isMerging: boolean;
  bulkBusy: string | null;
  onMove: (id: string, direction: -1 | 1) => void;
  onMerge: (ids: string[], title: string) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onRestore: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const selectedIds = selectedConversations.map((conversation) => conversation.id);
  const isArchivedMode = mode === "archived";
  return (
    <div className="w-full rounded-2xl border border-[#e5e5e5] bg-white p-3 shadow-sm sm:max-w-xl">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-[#6b7280]">{selectedIds.length} selected</span>
        {isArchivedMode ? (
          <button
            type="button"
            disabled={bulkBusy !== null}
            onClick={() => void onRestore(selectedIds)}
            className="min-h-9 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:cursor-wait disabled:opacity-60"
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            disabled={bulkBusy !== null}
            onClick={() => void onArchive(selectedIds)}
            className="min-h-9 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:cursor-wait disabled:opacity-60"
          >
            Archive
          </button>
        )}
        <button
          type="button"
          disabled={bulkBusy !== null}
          onClick={() => void onDelete(selectedIds)}
          className="min-h-9 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 disabled:cursor-wait disabled:opacity-60"
        >
          Delete
        </button>
      </div>
      {!isArchivedMode && selectedIds.length >= 2 ? (
        <div className="mt-3 rounded-xl bg-[#f7f7f8] p-3">
          <label className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">
            Merge title
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-sm font-normal normal-case text-[#111827] outline-none focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/10"
            />
          </label>
          <p className="mt-3 text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Merge order</p>
          <div className="mt-2 space-y-1">
            {selectedConversations.map((conversation, index) => (
              <div key={conversation.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-white px-2 py-1.5">
                <span className="text-xs font-semibold text-[#6b7280]">{index + 1}</span>
                <span className="truncate text-sm text-[#111827]">{conversation.display_title || conversation.title}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    disabled={index === 0 || isMerging}
                    onClick={() => onMove(conversation.id, -1)}
                    className="h-7 rounded-md border border-[#d1d5db] px-2 text-xs disabled:opacity-40"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={index === selectedConversations.length - 1 || isMerging}
                    onClick={() => onMove(conversation.id, 1)}
                    className="h-7 rounded-md border border-[#d1d5db] px-2 text-xs disabled:opacity-40"
                  >
                    Down
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={isMerging}
            onClick={() => void onMerge(selectedIds, title)}
            className="mt-3 min-h-10 w-full rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-70"
          >
            {isMerging ? "Merging" : `Merge ${selectedIds.length} in this order`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function moveId(ids: string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) {
    return ids;
  }
  const next = [...ids];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function UndoToast({ undo, onDone }: { undo: UndoAction; onDone: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span>{undo.label}</span>
      <button
        type="button"
        onClick={async () => {
          await undo.action();
          onDone();
        }}
        className="min-h-9 rounded-lg bg-amber-900 px-3 text-sm font-medium text-white"
      >
        撤销
      </button>
    </div>
  );
}

function StateBlock({
  title,
  detail,
  action,
  loading = false,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <section className="flex min-h-64 items-center justify-center rounded-2xl border border-[#e5e5e5] bg-white p-8 text-center shadow-sm">
      <div>
        {loading ? <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-[#ececec]" /> : null}
        <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#6b7280]">{detail}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </section>
  );
}
