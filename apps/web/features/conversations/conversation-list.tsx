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
  getConversations,
  getProjects,
  mergeConversations,
  moveConversationToProject,
  restoreConversation,
  updateConversationOrder,
} from "../../lib/api";
import type { ConversationListItem, ProjectRead } from "../../lib/types";
import { stripLeadingTimestamp } from "./markdown-renderer";
import type { UndoAction } from "./conversation-action-menu";
import { MergeOrderList } from "./merge-order-list";
import { ConversationSortMenu } from "../../components/sort-menu";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime, fullActivityTime } from "../../lib/activity-time";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { downloadConversationBundle } from "../../lib/bulk-export";
import { SelectionToolbar } from "../../components/selection-toolbar";

export function ConversationList({
  onImportClick,
  mode = "active",
}: {
  onImportClick?: () => void;
  mode?: "active" | "archived";
}) {
  const queryClient = useQueryClient();
  const { conversationSortMode, conversationSortDirection, resolvedLocale } = usePreferences();
  const dialog = useInteractionDialog();
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [mergeTitle, setMergeTitle] = useState("Merged conversation");
  const [mergeOrderIds, setMergeOrderIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const conversationsQuery = useQuery({
    queryKey: ["conversations", mode, conversationSortMode, conversationSortDirection],
    queryFn: () => getConversations({
      includeArchived: mode === "archived",
      scope: "all",
      sort: conversationSortMode,
      direction: conversationSortDirection,
      limit: 5000,
    }),
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", "bulk-actions"],
    queryFn: () => getProjects(),
    enabled: selectionMode && mode === "active",
  });
  const globalExistenceQuery = useQuery({
    queryKey: ["conversations", "existence"],
    queryFn: () => getConversations({
      includeArchived: true,
      scope: "all",
      sort: "recent_read",
      direction: "desc",
      limit: 1,
    }),
    enabled: mode === "active",
    staleTime: 30_000,
  });
  const isArchivedMode = mode === "archived";

  function clearSelection() {
    setSelectedConversationIds(new Set());
    setMergeOrderIds([]);
  }

  function exitSelectionMode() {
    if (bulkBusy !== null || isMerging) return;
    clearSelection();
    setSelectionMode(false);
  }

  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || bulkBusy !== null || isMerging) return;
      setSelectedConversationIds(new Set());
      setMergeOrderIds([]);
      setSelectionMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bulkBusy, isMerging, selectionMode]);

  async function handleSortEnd(event: DragEndEvent) {
    if (conversationSortMode !== "custom" || !event.over || event.active.id === event.over.id) return;
    const rows = conversationsQuery.data ?? [];
    const oldIndex = rows.findIndex((item) => item.id === event.active.id);
    const newIndex = rows.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    await updateConversationOrder(arrayMove(rows, oldIndex, newIndex).map((item) => item.id));
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

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
    return <StateBlock title={resolvedLocale === "zh-CN" ? "正在加载对话" : "Loading conversations"} detail={resolvedLocale === "zh-CN" ? "正在读取对话列表…" : "Fetching conversation list…"} loading />;
  }

  if (conversationsQuery.isError) {
    return (
      <StateBlock
        title={resolvedLocale === "zh-CN" ? "对话加载失败" : "Failed to load conversations"}
        detail={conversationsQuery.error.message}
        action={
          <button
            type="button"
            onClick={() => void conversationsQuery.refetch()}
            className="rounded-md bg-[var(--text)] px-3 py-2 text-sm font-medium text-[var(--surface)]"
          >
            {resolvedLocale === "zh-CN" ? "重试" : "Retry"}
          </button>
        }
      />
    );
  }

  const conversations = (conversationsQuery.data ?? []).filter((conversation) =>
    isArchivedMode ? conversation.status === "archived" : conversation.status !== "archived",
  );

  function applySelection(ids: Iterable<string>) {
    const requested = new Set(ids);
    const orderedIds = conversations.filter((conversation) => requested.has(conversation.id)).map((conversation) => conversation.id);
    setSelectedConversationIds(new Set(orderedIds));
    setMergeOrderIds(orderedIds);
  }

  function toggleConversationSelection(conversationId: string, selected: boolean) {
    const next = new Set(selectedConversationIds);
    if (selected) next.add(conversationId);
    else next.delete(conversationId);
    applySelection(next);
  }
  if (conversations.length === 0) {
    if (!isArchivedMode && globalExistenceQuery.isLoading) {
      return (
        <StateBlock
          title={resolvedLocale === "zh-CN" ? "正在加载对话" : "Loading conversations"}
          detail={resolvedLocale === "zh-CN" ? "正在确认对话归属…" : "Checking conversation locations…"}
          loading
        />
      );
    }
    const shouldShowImportCta =
      !isArchivedMode
      && globalExistenceQuery.isSuccess
      && (globalExistenceQuery.data?.length ?? 0) === 0;
    return (
      <StateBlock
        title={
          isArchivedMode
            ? (resolvedLocale === "zh-CN" ? "暂无已归档对话" : "No archived conversations")
            : shouldShowImportCta
              ? (resolvedLocale === "zh-CN" ? "导入你的 ChatGPT 对话" : "Import your ChatGPT conversations")
              : (resolvedLocale === "zh-CN" ? "暂无未分类对话" : "No unfiled conversations")
        }
        detail={
          isArchivedMode
            ? (resolvedLocale === "zh-CN" ? "归档的对话会保留在这里，恢复后回到原项目或对话记录。" : "Archived conversations return to their previous location when restored.")
            : shouldShowImportCta
              ? (resolvedLocale === "zh-CN" ? "支持 .cr 快速归档、JSON、Markdown 和 CSV。数据保存在当前服务器。" : "Supports .cr archives, JSON, Markdown, and CSV. Data remains on this server.")
              : (resolvedLocale === "zh-CN" ? "现有对话已归入项目，可在左侧展开项目查看。" : "Existing conversations are filed in projects. Expand a project in the sidebar to view them.")
        }
        action={shouldShowImportCta ? (
          <button
            type="button"
            onClick={onImportClick}
            className="rounded-lg bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--surface)] hover:opacity-90"
          >
            {resolvedLocale === "zh-CN" ? "导入 ChatGPT 数据" : "Import ChatGPT data"}
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
          <h2 className="text-lg font-semibold text-primary">
            {isArchivedMode ? (resolvedLocale === "zh-CN" ? "已归档对话" : "Archived conversations") : (resolvedLocale === "zh-CN" ? "对话记录" : "Conversation history")}
          </h2>
          <p className="text-sm text-secondary">{resolvedLocale === "zh-CN" ? `共 ${conversations.length} 个` : `${conversations.length} total`}</p>
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
            projects={(projectsQuery.data ?? []).filter((project) => !project.is_default && !project.is_archived)}
            onReorder={setMergeOrderIds}
            onMove={async (ids, projectId) => {
              setBulkBusy("move");
              try {
                await Promise.all(ids.map((id) => moveConversationToProject(id, projectId)));
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
                await refreshLists();
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
            onMerge={async (ids, title) => {
              setIsMerging(true);
              try {
                await mergeConversations({
                  conversationIds: ids,
                  title: title.trim() || "Merged conversation",
                  idempotencyKey: crypto.randomUUID(),
                });
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
                setMergeTitle("Merged conversation");
                await queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
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
              if (!(await dialog.confirm({ title: resolvedLocale === "zh-CN" ? `删除 ${ids.length} 个对话？` : `Delete ${ids.length} conversations?`, description: resolvedLocale === "zh-CN" ? "此操作完成后可立即撤销。" : "You can undo immediately afterward.", confirmLabel: resolvedLocale === "zh-CN" ? "删除" : "Delete", danger: true }))) {
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
        ) : !selectionMode ? (
          <div className="flex items-center gap-2"><ConversationSortMenu /><button type="button" onClick={() => setSelectionMode(true)} className="min-h-9 rounded-lg px-3 text-sm text-secondary hover:bg-surface">{resolvedLocale === "zh-CN" ? "选择对话" : "Select conversations"}</button></div>
        ) : null}
      </div>
      {selectionMode ? <SelectionToolbar
        selectedCount={selectedConversationIds.size}
        totalCount={conversations.length}
        busy={bulkBusy !== null || isMerging}
        locale={resolvedLocale}
        onSelectAll={() => applySelection(conversations.map((conversation) => conversation.id))}
        onInvert={() => applySelection(conversations.filter((conversation) => !selectedConversationIds.has(conversation.id)).map((conversation) => conversation.id))}
        onClear={() => clearSelection()}
        onDone={exitSelectionMode}
      /> : null}
      <DndContext onDragEnd={(event) => void handleSortEnd(event)}><SortableContext items={conversations.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="overflow-hidden rounded-xl border border-ui bg-surface">
        {conversations.map((conversation) => (
          <SortableConversationRow id={conversation.id} enabled={conversationSortMode === "custom" && !selectionMode} key={conversation.id}><article
            className={`group border-b border-ui px-4 py-3 transition last:border-b-0 hover:bg-subtle ${selectedConversationIds.has(conversation.id) ? "bg-[var(--accent-soft)]" : ""}`}
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
              <div className="flex min-w-0 gap-3">
                {selectionMode ? <label className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ui bg-surface">
                  <input
                    type="checkbox"
                    checked={selectedConversationIds.has(conversation.id)}
                    onChange={(event) => toggleConversationSelection(conversation.id, event.target.checked)}
                    aria-label={`${resolvedLocale === "zh-CN" ? "选择" : "Select"} ${conversation.display_title || conversation.title}`}
                  />
                </label> : null}
                <div className="min-w-0">
                  {selectionMode ? <button type="button" className="block w-full text-left" onClick={() => toggleConversationSelection(conversation.id, !selectedConversationIds.has(conversation.id))}>
                    <h3 className="truncate text-base font-semibold text-primary">
                      {conversation.is_global_pinned ? (resolvedLocale === "zh-CN" ? "置顶 · " : "Pinned · ") : ""}
                      {conversation.display_title || conversation.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                      {conversation.description_markdown || previewConversationText(conversation.first_user_message, resolvedLocale)}
                    </p>
                  </button> : <>
                    <Link href={`/conversations/${conversation.id}`}>
                      <h3 className="truncate text-base font-semibold text-primary">
                        {conversation.is_global_pinned ? (resolvedLocale === "zh-CN" ? "置顶 · " : "Pinned · ") : ""}
                        {conversation.display_title || conversation.title}
                      </h3>
                    </Link>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                      {conversation.description_markdown || previewConversationText(conversation.first_user_message, resolvedLocale)}
                    </p>
                  </>}
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 md:justify-end md:text-right">
                <div className="min-w-0">
                  <p className="text-xs text-secondary" title={fullActivityTime(activityTimestamp(conversation, conversationSortMode), resolvedLocale)} aria-label={fullActivityTime(activityTimestamp(conversation, conversationSortMode), resolvedLocale)}>{formatActivityTime(activityTimestamp(conversation, conversationSortMode), resolvedLocale)}</p>
                  <p className="mt-1 text-sm text-secondary">{resolvedLocale === "zh-CN" ? `${conversation.message_count} 条消息` : `${conversation.message_count} messages`}</p>
                </div>
              </div>
            </div>
          </article></SortableConversationRow>
        ))}
      </div></SortableContext></DndContext>
    </section>
  );
}

function SortableConversationRow({ id, enabled, children }: { id: string; enabled: boolean; children: ReactNode }) {
  const sortable = useSortable({ id, disabled: !enabled });
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="relative"><button type="button" aria-label="Drag to reorder" title="Drag to reorder" className={`absolute left-1 top-1/2 z-10 flex h-8 w-7 -translate-y-1/2 touch-none items-center justify-center rounded-md text-secondary hover:bg-surface ${enabled ? "opacity-100" : "pointer-events-none opacity-0"}`} {...sortable.attributes} {...sortable.listeners}><GripVertical className="h-4 w-4" /></button>{children}</div>;
}

function previewConversationText(text: string | null | undefined, locale: "zh-CN" | "en-US"): string {
  const cleaned = stripLeadingTimestamp(text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || (locale === "zh-CN" ? "暂无消息预览。" : "No message preview.");
}

function activityTimestamp(conversation: ConversationListItem, mode: string): string | null {
  if (mode === "updated") return conversation.updated_at;
  if (mode === "created") return conversation.created_at;
  if (mode === "imported") return conversation.imported_at;
  return conversation.last_read_at;
}

function BulkActions({
  mode,
  selectedConversations,
  title,
  onTitleChange,
  isMerging,
  bulkBusy,
  projects,
  onReorder,
  onMove,
  onExport,
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
  projects: ProjectRead[];
  onReorder: (ids: string[]) => void;
  onMove: (ids: string[], projectId: string | null) => Promise<void>;
  onExport: (conversations: ConversationListItem[]) => Promise<void>;
  onMerge: (ids: string[], title: string) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onRestore: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const selectedIds = selectedConversations.map((conversation) => conversation.id);
  const isArchivedMode = mode === "archived";
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  return (
    <div className="w-full rounded-xl border border-ui bg-surface p-3 sm:max-w-xl">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-secondary">{zh ? `已选择 ${selectedIds.length} 个` : `${selectedIds.length} selected`}</span>
        {!isArchivedMode ? <select
          defaultValue=""
          disabled={bulkBusy !== null}
          onChange={(event) => { const value = event.target.value; if (value) void onMove(selectedIds, value === "__none" ? null : value); event.target.value = ""; }}
          className="min-h-9 rounded-lg border border-ui bg-surface px-2 text-sm text-primary"
          aria-label={zh ? "移动到项目" : "Move to project"}
        >
          <option value="" disabled>{zh ? "移动到项目" : "Move to project"}</option>
          <option value="__none">{zh ? "移出项目" : "Remove from project"}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select> : null}
        <button type="button" disabled={bulkBusy !== null} onClick={() => void onExport(selectedConversations)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-60">{bulkBusy === "export" ? (zh ? "正在导出" : "Exporting") : (zh ? "导出" : "Export")}</button>
        {isArchivedMode ? (
          <button
            type="button"
            disabled={bulkBusy !== null}
            onClick={() => void onRestore(selectedIds)}
            className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
          >
            {zh ? "恢复" : "Restore"}
          </button>
        ) : (
          <button
            type="button"
            disabled={bulkBusy !== null}
            onClick={() => void onArchive(selectedIds)}
            className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
          >
            {zh ? "归档" : "Archive"}
          </button>
        )}
        <button
          type="button"
          disabled={bulkBusy !== null}
          onClick={() => void onDelete(selectedIds)}
          className="min-h-9 rounded-lg border border-[var(--danger)] bg-surface px-3 text-sm font-medium text-[var(--danger)] disabled:cursor-wait disabled:opacity-60"
        >
          {zh ? "删除" : "Delete"}
        </button>
      </div>
      {!isArchivedMode && selectedIds.length >= 2 ? (
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
          <MergeOrderList conversations={selectedConversations} disabled={isMerging} onReorder={onReorder} />
          <button
            type="button"
            disabled={isMerging}
            onClick={() => void onMerge(selectedIds, title)}
            className="mt-3 min-h-10 w-full rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:cursor-wait disabled:opacity-70"
          >
            {isMerging ? (zh ? "正在合并…" : "Merging…") : (zh ? `按此顺序合并 ${selectedIds.length} 个对话` : `Merge ${selectedIds.length} in this order`)}
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
    <section className="flex min-h-64 items-center justify-center rounded-xl border border-ui bg-surface p-8 text-center">
      <div>
        {loading ? <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-subtle" /> : null}
        <h2 className="text-base font-semibold text-primary">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{detail}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </section>
  );
}
