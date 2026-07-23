"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  archiveConversation,
  deleteConversation,
  getProjectConversations,
  getProjects,
  mergeConversations,
  moveConversationToProject,
  removeConversationFromProject,
  recordRecentProject,
  restoreConversation,
  updateProjectConversationOrder,
} from "../../lib/api";
import type { ProjectConversationRead, ProjectRead } from "../../lib/types";
import type { UndoAction } from "../conversations/conversation-action-menu";
import { MergeOrderList } from "../conversations/merge-order-list";
import { stripLeadingTimestamp } from "../conversations/markdown-renderer";
import { ProjectSidebar } from "./project-sidebar";
import { ConversationSortMenu } from "../../components/sort-menu";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime, fullActivityTime } from "../../lib/activity-time";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { downloadConversationBundle } from "../../lib/bulk-export";

export function ProjectConversationList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { conversationSortMode, conversationSortDirection, projectSortMode, projectSortDirection, resolvedLocale } = usePreferences();
  const dialog = useInteractionDialog();
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [mergeTitle, setMergeTitle] = useState("Merged conversation");
  const [mergeOrderIds, setMergeOrderIds] = useState<string[]>([]);
  const projectsQuery = useQuery({
    queryKey: ["projects", projectSortMode, projectSortDirection],
    queryFn: () => getProjects({ sort: projectSortMode, direction: projectSortDirection }),
  });
  const conversationsQuery = useQuery({
    queryKey: ["project-conversations", projectId, conversationSortMode, conversationSortDirection],
    queryFn: () => getProjectConversations(projectId, { sort: conversationSortMode, direction: conversationSortDirection, limit: 200 }),
  });
  const project = projectsQuery.data?.find((item) => item.id === projectId);
  const zh = resolvedLocale === "zh-CN";

  async function handleSortEnd(event: DragEndEvent) {
    if (conversationSortMode !== "custom" || !event.over || event.active.id === event.over.id || !conversationsQuery.data) return;
    const oldIndex = conversationsQuery.data.findIndex((item) => item.id === event.active.id);
    const newIndex = conversationsQuery.data.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    await updateProjectConversationOrder(projectId, arrayMove(conversationsQuery.data, oldIndex, newIndex).map((item) => item.id));
    await queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] });
  }

  useEffect(() => {
    void recordRecentProject(projectId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    }).catch(() => undefined);
  }, [projectId, queryClient]);

  async function refreshProject() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
    ]);
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      <ProjectSidebar currentProjectId={projectId} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-ui bg-surface/95 px-4 pl-16 backdrop-blur md:px-6 md:pl-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{project?.name ?? (zh ? "项目" : "Project")}</h1>
            <p className="text-xs text-secondary">
              {zh ? `${project?.conversation_count ?? 0} 个对话 · ${project?.pinned_count ?? 0} 个置顶` : `${project?.conversation_count ?? 0} conversations · ${project?.pinned_count ?? 0} pinned`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <ConversationSortMenu />
            <button
              type="button"
              onClick={() => {
                setSelectionMode((value) => !value);
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
              }}
              className="min-h-10 rounded-lg px-3 text-sm font-medium text-secondary hover:bg-subtle"
            >
              {selectionMode ? (zh ? "退出选择" : "Done") : (zh ? "选择" : "Select")}
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
                projects={(projectsQuery.data ?? []).filter((item) => !item.is_default && !item.is_archived && item.id !== projectId)}
                onReorder={setMergeOrderIds}
                onMove={async (ids, targetProjectId) => {
                  setBulkBusy("move");
                  try {
                    await Promise.all(ids.map((id) => moveConversationToProject(id, targetProjectId)));
                    setSelectedConversationIds(new Set());
                    setMergeOrderIds([]);
                    await refreshProject();
                  } finally {
                    setBulkBusy(null);
                  }
                }}
                onExport={async (selected) => {
                  setBulkBusy("export");
                  try {
                    await downloadConversationBundle(selected);
                  } finally {
                    setBulkBusy(null);
                  }
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
                    await mergeConversations({
                      conversationIds: ids,
                      title: title.trim() || "Merged conversation",
                      projectId,
                      idempotencyKey: crypto.randomUUID(),
                    });
                    setSelectedConversationIds(new Set());
                    setMergeOrderIds([]);
                    setMergeTitle(`${project?.name ?? "Project"} merged`);
                    await queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
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
                  if (!(await dialog.confirm({ title: zh ? `删除 ${ids.length} 个对话？` : `Delete ${ids.length} conversations?`, description: zh ? "此操作完成后可立即撤销。" : "You can undo immediately afterward.", confirmLabel: zh ? "删除" : "Delete", danger: true }))) {
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

            {conversationsQuery.isLoading ? <StateBlock label={resolvedLocale === "zh-CN" ? "正在加载项目对话…" : "Loading project conversations…"} /> : null}
            {conversationsQuery.isError ? <StateBlock label={conversationsQuery.error.message} /> : null}
            {conversationsQuery.isSuccess && conversationsQuery.data.length === 0 ? (
              <StateBlock label={resolvedLocale === "zh-CN" ? "这个项目还没有对话" : "No conversations in this project"} />
            ) : null}

            {conversationsQuery.isSuccess && conversationsQuery.data.length > 0 ? (
              <DndContext onDragEnd={(event) => void handleSortEnd(event)}><SortableContext items={conversationsQuery.data.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="overflow-hidden rounded-xl border border-ui bg-surface">
                {conversationsQuery.data.map((conversation) => (
                  <SortableProjectConversationRow key={conversation.id} id={conversation.id} enabled={conversationSortMode === "custom"}><article className="border-b border-ui px-5 py-4 last:border-b-0 hover:bg-subtle">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_190px] md:items-start">
                      <div className="flex min-w-0 gap-3">
                        {selectionMode ? <label className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ui bg-surface">
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
                              setMergeOrderIds((current) => {
                                if (event.target.checked) {
                                  return current.includes(conversation.id) ? current : [...current, conversation.id];
                                }
                                return current.filter((id) => id !== conversation.id);
                              });
                            }}
                            aria-label={`Select ${conversation.display_title || conversation.title}`}
                          />
                        </label> : null}
                        <div className="min-w-0">
                          <Link href={`/conversations/${conversation.id}?projectId=${projectId}`}>
                            <h2 className="truncate text-base font-semibold text-primary">
                              {conversation.project_relation.is_pinned ? (resolvedLocale === "zh-CN" ? "置顶 · " : "Pinned · ") : ""}
                              {conversation.display_title || conversation.title}
                            </h2>
                          </Link>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                            {conversation.description_markdown || previewConversationText(conversation.first_user_message)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-3 md:justify-end md:text-right">
                        <div className="min-w-0">
                          <p className="text-xs text-secondary" title={fullActivityTime(projectConversationActivity(conversation, conversationSortMode), resolvedLocale)}>{formatActivityTime(projectConversationActivity(conversation, conversationSortMode), resolvedLocale)}</p>
                          <p className="text-sm text-secondary">{resolvedLocale === "zh-CN" ? `${conversation.message_count} 条消息` : `${conversation.message_count} messages`}</p>
                        </div>
                      </div>
                    </div>
                  </article></SortableProjectConversationRow>
                ))}
              </div></SortableContext></DndContext>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function SortableProjectConversationRow({ id, enabled, children }: { id: string; enabled: boolean; children: ReactNode }) {
  const sortable = useSortable({ id, disabled: !enabled });
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="relative"><button type="button" className={`absolute left-1 top-1/2 z-10 flex h-8 w-7 -translate-y-1/2 touch-none items-center justify-center rounded-md text-secondary hover:bg-surface ${enabled ? "opacity-100" : "pointer-events-none opacity-0"}`} aria-label="Drag to reorder" {...sortable.attributes} {...sortable.listeners}><GripVertical className="h-4 w-4" /></button>{children}</div>;
}

function projectConversationActivity(conversation: ProjectConversationRead, mode: string): string | null {
  if (mode === "updated") return conversation.updated_at;
  if (mode === "created") return conversation.created_at;
  if (mode === "imported") return conversation.imported_at;
  return conversation.last_read_at;
}

function ProjectBulkActions({
  selectedConversations,
  title,
  onTitleChange,
  busy,
  projects,
  onReorder,
  onMove,
  onExport,
  onRemove,
  onMerge,
  onArchive,
  onDelete,
}: {
  selectedConversations: ProjectConversationRead[];
  title: string;
  onTitleChange: (title: string) => void;
  busy: string | null;
  projects: ProjectRead[];
  onReorder: (ids: string[]) => void;
  onMove: (ids: string[], projectId: string | null) => Promise<void>;
  onExport: (conversations: ProjectConversationRead[]) => Promise<void>;
  onRemove: (ids: string[]) => Promise<void>;
  onMerge: (ids: string[], title: string) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const selectedIds = selectedConversations.map((conversation) => conversation.id);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  return (
    <div className="rounded-xl border border-ui bg-surface p-3">
      <div className="flex flex-wrap justify-end gap-2">
        <span className="mr-auto text-sm text-secondary">{zh ? `已选择 ${selectedIds.length} 个` : `${selectedIds.length} selected`}</span>
        <select
          defaultValue=""
          disabled={busy !== null}
          onChange={(event) => { const value = event.target.value; if (value) void onMove(selectedIds, value === "__none" ? null : value); event.target.value = ""; }}
          className="min-h-9 rounded-lg border border-ui bg-surface px-2 text-sm text-primary"
          aria-label={zh ? "移动到项目" : "Move to project"}
        >
          <option value="" disabled>{zh ? "移动到项目" : "Move to project"}</option>
          <option value="__none">{zh ? "移出项目" : "Remove from project"}</option>
          {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" disabled={busy !== null} onClick={() => void onExport(selectedConversations)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-60">{busy === "export" ? (zh ? "正在导出" : "Exporting") : (zh ? "导出" : "Export")}</button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onRemove(selectedIds)}
          className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
        >
          {zh ? "移出项目" : "Remove"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onArchive(selectedIds)}
          className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
        >
          {zh ? "归档" : "Archive"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onDelete(selectedIds)}
          className="min-h-9 rounded-lg border border-[var(--danger)] bg-surface px-3 text-sm font-medium text-[var(--danger)] disabled:cursor-wait disabled:opacity-60"
        >
          {zh ? "删除" : "Delete"}
        </button>
      </div>
      {selectedIds.length >= 2 ? (
        <div className="mt-3 rounded-xl bg-subtle p-3">
          <label className="text-xs font-semibold uppercase tracking-normal text-secondary">
            {zh ? "合并标题" : "Merge title"}
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-ui bg-surface px-3 py-2 text-sm font-normal normal-case text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]"
            />
          </label>
          <p className="mt-3 text-xs font-semibold uppercase tracking-normal text-secondary">{zh ? "合并顺序" : "Merge order"}</p>
          <MergeOrderList conversations={selectedConversations} disabled={busy !== null} onReorder={onReorder} />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onMerge(selectedIds, title)}
            className="mt-3 min-h-10 w-full rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:cursor-wait disabled:opacity-60"
          >
            {busy === "merge" ? (zh ? "正在合并…" : "Merging…") : (zh ? `按此顺序合并 ${selectedIds.length} 个对话` : `Merge ${selectedIds.length} in this order`)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UndoToast({ undo, onDone }: { undo: UndoAction; onDone: () => void }) {
  const { resolvedLocale } = usePreferences();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--callout-warning-border)] bg-[var(--callout-warning-bg)] px-4 py-3 text-sm text-[var(--callout-warning-text)]">
      <span>{undo.label}</span>
      <button
        type="button"
        onClick={async () => {
          await undo.action();
          onDone();
        }}
        className="min-h-9 rounded-lg bg-[var(--callout-warning-text)] px-3 text-sm font-medium text-[var(--surface)]"
      >
        {resolvedLocale === "zh-CN" ? "撤销" : "Undo"}
      </button>
    </div>
  );
}

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-xl border border-ui bg-surface p-5 text-sm text-secondary">{label}</div>;
}

function previewConversationText(text?: string | null): string {
  const cleaned = stripLeadingTimestamp(text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || "No first user message.";
}
