"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  archiveConversation,
  deleteConversation,
  getProjectConversations,
  getProjects,
  mergeConversations,
  removeConversationFromProject,
  restoreConversation,
  updateProject,
} from "../../lib/api";
import type { ProjectConversationRead } from "../../lib/types";
import { ConversationActionMenu, type UndoAction } from "../conversations/conversation-action-menu";
import { stripLeadingTimestamp } from "../conversations/markdown-renderer";
import { ProjectSidebar } from "./project-sidebar";

export function ProjectConversationList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [menuCloseSignal, setMenuCloseSignal] = useState(0);
  const [mergeTitle, setMergeTitle] = useState("Merged conversation");
  const [mergeOrderIds, setMergeOrderIds] = useState<string[]>([]);
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const conversationsQuery = useQuery({
    queryKey: ["project-conversations", projectId],
    queryFn: () => getProjectConversations(projectId),
  });
  const removeMutation = useMutation({
    mutationFn: (conversationId: string) => removeConversationFromProject(projectId, conversationId),
    onSuccess: () => {
      void refreshProject();
    },
  });

  const project = projectsQuery.data?.find((item) => item.id === projectId);

  async function refreshProject() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
    ]);
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar currentProjectId={projectId} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-[#e5e5e5] bg-white/95 px-4 pl-16 backdrop-blur md:px-6 md:pl-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{project?.name ?? "Project"}</h1>
            <p className="text-xs text-[#6b7280]">
              {project?.conversation_count ?? 0} conversations / {project?.pinned_count ?? 0} pinned
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!project) {
                  return;
                }
                const name = window.prompt("Rename project", project.name);
                if (name === null || !name.trim()) {
                  return;
                }
                await updateProject(project.id, { name: name.trim() });
                await refreshProject();
              }}
              className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] hover:bg-[#f7f7f8]"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={!project || project.is_default}
              onClick={async () => {
                if (!project || !window.confirm(`Archive project ${project.name}?`)) {
                  return;
                }
                await updateProject(project.id, { is_archived: true });
                await refreshProject();
              }}
              className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-6">
            {undo ? (
              <UndoToast
                undo={undo}
                onDone={() => {
                  setUndo(null);
                }}
              />
            ) : null}

            {selectedConversationIds.size > 0 ? (
              <ProjectBulkActions
                selectedConversations={mergeOrderIds
                  .map((id) => conversationsQuery.data?.find((conversation) => conversation.id === id))
                  .filter((conversation): conversation is ProjectConversationRead => Boolean(conversation))}
                title={mergeTitle}
                onTitleChange={setMergeTitle}
                busy={bulkBusy}
                onMove={(id, direction) => {
                  setMergeOrderIds((current) => moveId(current, id, direction));
                }}
                onRemove={async (ids) => {
                  setBulkBusy("remove");
                  try {
                    await Promise.all(ids.map((id) => removeConversationFromProject(projectId, id)));
                    setSelectedConversationIds(new Set());
                    setMergeOrderIds([]);
                    await refreshProject();
                  } finally {
                    setBulkBusy(null);
                  }
                }}
                onMerge={async (ids, title) => {
                  setBulkBusy("merge");
                  try {
                    await mergeConversations({ conversationIds: ids, title: title.trim() || "Merged conversation", projectId });
                    setSelectedConversationIds(new Set());
                    setMergeOrderIds([]);
                    setMergeTitle(`${project?.name ?? "Project"} merged`);
                    await refreshProject();
                  } finally {
                    setBulkBusy(null);
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
                        await refreshProject();
                      },
                    });
                    setSelectedConversationIds(new Set());
                    setMergeOrderIds([]);
                    await refreshProject();
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
                        await refreshProject();
                      },
                    });
                    setSelectedConversationIds(new Set());
                    setMergeOrderIds([]);
                    await refreshProject();
                  } finally {
                    setBulkBusy(null);
                  }
                }}
              />
            ) : null}

            {conversationsQuery.isLoading ? <StateBlock label="Loading project conversations" /> : null}
            {conversationsQuery.isError ? <StateBlock label={conversationsQuery.error.message} /> : null}
            {conversationsQuery.isSuccess && conversationsQuery.data.length === 0 ? (
              <StateBlock label="No conversations in this project" />
            ) : null}

            {conversationsQuery.isSuccess && conversationsQuery.data.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
                {conversationsQuery.data.map((conversation) => (
                  <article key={conversation.id} className="border-b border-[#f0f0f0] px-5 py-4 last:border-b-0 hover:bg-[#fbfbfb]">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_190px] md:items-start">
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
                            <h2 className="truncate text-base font-semibold text-[#111827]">
                              {conversation.project_relation.is_pinned ? "Pinned / " : ""}
                              {conversation.display_title || conversation.title}
                            </h2>
                          </Link>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#6b7280]">
                            {previewConversationText(conversation.first_user_message)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-3 md:justify-end md:text-right">
                        <div className="min-w-0 md:order-2">
                          <p className="text-sm text-[#6b7280]">{conversation.message_count} messages</p>
                          <button
                            type="button"
                            onClick={() => removeMutation.mutate(conversation.id)}
                            className="mt-2 rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-white"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="md:order-1">
                          <ConversationActionMenu
                            conversation={conversation}
                            projectId={projectId}
                            projectPinned={conversation.project_relation.is_pinned}
                            closeSignal={menuCloseSignal}
                            onUndo={setUndo}
                            onChanged={refreshProject}
                          />
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function ProjectBulkActions({
  selectedConversations,
  title,
  onTitleChange,
  busy,
  onMove,
  onRemove,
  onMerge,
  onArchive,
  onDelete,
}: {
  selectedConversations: ProjectConversationRead[];
  title: string;
  onTitleChange: (title: string) => void;
  busy: string | null;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (ids: string[]) => Promise<void>;
  onMerge: (ids: string[], title: string) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const selectedIds = selectedConversations.map((conversation) => conversation.id);
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-3 shadow-sm">
      <div className="flex flex-wrap justify-end gap-2">
        <span className="mr-auto text-sm text-[#6b7280]">{selectedIds.length} selected</span>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onRemove(selectedIds)}
          className="min-h-9 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:cursor-wait disabled:opacity-60"
        >
          Remove
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onArchive(selectedIds)}
          className="min-h-9 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:cursor-wait disabled:opacity-60"
        >
          Archive
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onDelete(selectedIds)}
          className="min-h-9 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 disabled:cursor-wait disabled:opacity-60"
        >
          Delete
        </button>
      </div>
      {selectedIds.length >= 2 ? (
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
                    disabled={index === 0 || busy !== null}
                    onClick={() => onMove(conversation.id, -1)}
                    className="h-7 rounded-md border border-[#d1d5db] px-2 text-xs disabled:opacity-40"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={index === selectedConversations.length - 1 || busy !== null}
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
            disabled={busy !== null}
            onClick={() => void onMerge(selectedIds, title)}
            className="mt-3 min-h-10 w-full rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
          >
            {busy === "merge" ? "Merging" : `Merge ${selectedIds.length} in this order`}
          </button>
        </div>
      ) : null}
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

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 text-sm text-[#6b7280] shadow-sm">{label}</div>;
}

function previewConversationText(text?: string | null): string {
  const cleaned = stripLeadingTimestamp(text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || "No first user message.";
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
