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
import { ConversationActionMenu, type UndoAction } from "./conversation-action-menu";

export function ConversationList({ onImportClick }: { onImportClick?: () => void }) {
  const queryClient = useQueryClient();
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: getConversations,
  });

  async function refreshLists() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
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

  const conversations = conversationsQuery.data ?? [];
  if (conversations.length === 0) {
    return (
      <StateBlock
        title="No conversations yet"
        detail="Import a ChatGPT export to start building your local reading archive."
        action={
          <button
            type="button"
            onClick={onImportClick}
            className="rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white hover:bg-black"
          >
            Import conversations
          </button>
        }
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
          <h2 className="text-lg font-semibold text-[#111827]">Conversation history</h2>
          <p className="text-sm text-[#6b7280]">{conversations.length} shown</p>
        </div>
        {selectedConversationIds.size > 0 ? (
          <BulkActions
            selectedIds={Array.from(selectedConversationIds)}
            isMerging={isMerging}
            bulkBusy={bulkBusy}
            onMerge={async (ids) => {
              const title = window.prompt("Merged conversation title", "Merged conversation");
              if (title === null) {
                return;
              }
              setIsMerging(true);
              try {
                await mergeConversations({ conversationIds: ids, title: title.trim() || "Merged conversation" });
                setSelectedConversationIds(new Set());
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
                await refreshLists();
              } finally {
                setBulkBusy(null);
              }
            }}
          />
        ) : (
          <span className="text-sm text-[#6b7280]">Select 2+ to merge</span>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl bg-white/70">
        {conversations.map((conversation) => (
          <article
            key={conversation.id}
            className="group flex flex-col gap-3 border-b border-[#ececec] px-4 py-3 transition last:border-b-0 hover:bg-white"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <label className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#d1d5db] bg-white">
                  <input
                    type="checkbox"
                    checked={selectedConversationIds.has(conversation.id)}
                    onChange={(event) => {
                      setSelectedConversationIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(conversation.id);
                        } else {
                          next.delete(conversation.id);
                        }
                        return next;
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
                    {conversation.first_user_message ?? "No first user message."}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-2 text-left sm:text-right">
                <ConversationActionMenu conversation={conversation} onUndo={setUndo} onChanged={refreshLists} />
                <div>
                  <p className="inline-flex rounded-full bg-[#f7f7f8] px-2 py-1 text-xs font-medium text-[#4b5563]">
                    {conversation.source_profile}
                  </p>
                  <p className="mt-1 text-sm text-[#6b7280]">{conversation.message_count} messages</p>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BulkActions({
  selectedIds,
  isMerging,
  bulkBusy,
  onMerge,
  onArchive,
  onDelete,
}: {
  selectedIds: string[];
  isMerging: boolean;
  bulkBusy: string | null;
  onMerge: (ids: string[]) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {selectedIds.length >= 2 ? (
        <button
          type="button"
          disabled={isMerging}
          onClick={() => void onMerge(selectedIds)}
          className="min-h-10 rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-70"
        >
          {isMerging ? "Merging" : `Merge ${selectedIds.length}`}
        </button>
      ) : null}
      <button
        type="button"
        disabled={bulkBusy !== null}
        onClick={() => void onArchive(selectedIds)}
        className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:cursor-wait disabled:opacity-60"
      >
        Archive
      </button>
      <button
        type="button"
        disabled={bulkBusy !== null}
        onClick={() => void onDelete(selectedIds)}
        className="min-h-10 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 disabled:cursor-wait disabled:opacity-60"
      >
        Delete
      </button>
    </div>
  );
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
