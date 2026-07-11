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
import { ConversationActionMenu, type UndoAction } from "../conversations/conversation-action-menu";
import { ProjectSidebar } from "./project-sidebar";

export function ProjectConversationList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
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
                selectedIds={Array.from(selectedConversationIds)}
                busy={bulkBusy}
                onRemove={async (ids) => {
                  setBulkBusy("remove");
                  try {
                    await Promise.all(ids.map((id) => removeConversationFromProject(projectId, id)));
                    setSelectedConversationIds(new Set());
                    await refreshProject();
                  } finally {
                    setBulkBusy(null);
                  }
                }}
                onMerge={async (ids) => {
                  const title = window.prompt("Merged conversation title", `${project?.name ?? "Project"} merged`);
                  if (title === null) {
                    return;
                  }
                  setBulkBusy("merge");
                  try {
                    await mergeConversations({ conversationIds: ids, title: title.trim() || "Merged conversation", projectId });
                    setSelectedConversationIds(new Set());
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
                  <article key={conversation.id} className="space-y-3 border-b border-[#f0f0f0] px-5 py-4 last:border-b-0 hover:bg-[#f7f7f8]">
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
                            <h2 className="truncate text-base font-semibold text-[#111827]">
                              {conversation.project_relation.is_pinned ? "Pinned / " : ""}
                              {conversation.display_title || conversation.title}
                            </h2>
                          </Link>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#6b7280]">
                            {conversation.first_user_message ?? "No first user message."}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        <ConversationActionMenu
                          conversation={conversation}
                          projectId={projectId}
                          projectPinned={conversation.project_relation.is_pinned}
                          onUndo={setUndo}
                          onChanged={refreshProject}
                        />
                        <div className="text-right">
                          <p className="text-sm text-[#6b7280]">{conversation.message_count} messages</p>
                          <button
                            type="button"
                            onClick={() => removeMutation.mutate(conversation.id)}
                            className="mt-2 rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-white"
                          >
                            Remove
                          </button>
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
  selectedIds,
  busy,
  onRemove,
  onMerge,
  onArchive,
  onDelete,
}: {
  selectedIds: string[];
  busy: string | null;
  onRemove: (ids: string[]) => Promise<void>;
  onMerge: (ids: string[]) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 rounded-2xl border border-[#e5e5e5] bg-white p-3">
      <span className="mr-auto text-sm text-[#6b7280]">{selectedIds.length} selected</span>
      {selectedIds.length >= 2 ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onMerge(selectedIds)}
          className="min-h-10 rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          Merge
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void onRemove(selectedIds)}
        className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:cursor-wait disabled:opacity-60"
      >
        Remove
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void onArchive(selectedIds)}
        className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] disabled:cursor-wait disabled:opacity-60"
      >
        Archive
      </button>
      <button
        type="button"
        disabled={busy !== null}
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

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 text-sm text-[#6b7280] shadow-sm">{label}</div>;
}
