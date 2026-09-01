"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, type DragEndEvent, type DragStartEvent, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  archiveConversation,
  getConversations,
  getProjects,
  mergeConversations,
  moveConversationToProject,
  queueConversationBatchDelete,
  unarchiveConversation,
  updateConversationOrder,
} from "../../lib/api";
import type { BackgroundTaskRead, ConversationListItem, ProjectRead } from "../../lib/types";
import { stripLeadingTimestamp } from "./markdown-renderer";
import { ConversationActionMenu, type UndoAction } from "./conversation-action-menu";
import { MergeConversationsDialog } from "./merge-conversations-dialog";
import { ConversationSortMenu } from "../../components/sort-menu";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime, fullActivityTime } from "../../lib/activity-time";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { downloadConversationBundle } from "../../lib/bulk-export";
import { SelectionModeButton, SelectionToolbar } from "../../components/selection-toolbar";
import { useLinearSelection } from "../../components/use-linear-selection";
import { runBatchSelection, type BatchSelectionResult } from "../../lib/batch-selection";
import { HoverPreviewLink } from "../../components/hover-preview-link";

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
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [activeSortId, setActiveSortId] = useState<string | null>(null);
  const [activeSortSize, setActiveSortSize] = useState<{ width: number; height: number } | null>(null);
  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const conversationsQuery = useQuery({
    queryKey: ["conversations", mode, conversationSortMode, conversationSortDirection],
    queryFn: () => getConversations({
      statusScope: mode,
      scope: "all",
      sort: conversationSortMode,
      direction: conversationSortDirection,
      limit: 5000,
    }),
    // Keep the visible list stable while a sort change or mutation refreshes it.
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", "bulk-actions"],
    queryFn: () => getProjects({ sort: "custom", direction: "asc" }),
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
    // Only needed to distinguish the empty active state. Avoid an extra list
    // request when the primary query already returned conversations.
    enabled: mode === "active" && conversationsQuery.isSuccess && conversationsQuery.data.length === 0,
    staleTime: 30_000,
  });
  const isArchivedMode = mode === "archived";
  const conversations = (conversationsQuery.data ?? []).filter((conversation) => conversation.status === mode);
  const linearSelection = useLinearSelection({
    ids: conversations.map((conversation) => conversation.id),
    selectedIds: selectedConversationIds,
    onChange: applySelection,
    disabled: bulkBusy !== null || isMerging,
    selectionMode,
    onActivate: () => setSelectionMode(true),
    onExit: exitSelectionMode,
  });

  useEffect(() => {
    if (selectedConversationIds.size > 0) setSelectionMode(true);
  }, [selectedConversationIds.size]);

  useEffect(() => {
    const handleDeleteProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ deletedIds?: string[] }>).detail;
      const deletedIds = new Set(detail?.deletedIds ?? []);
      if (!deletedIds.size) return;
      queryClient.setQueriesData<ConversationListItem[] | undefined>(
        { queryKey: ["conversations"] },
        (current) => current?.filter((conversation) => !deletedIds.has(conversation.id)),
      );
    };
    window.addEventListener("chat-reader:conversation-delete-progress", handleDeleteProgress);
    return () => window.removeEventListener("chat-reader:conversation-delete-progress", handleDeleteProgress);
  }, [queryClient]);

  function clearSelection() {
    setSelectedConversationIds(new Set());
    setMergeOrderIds([]);
  }

  function exitSelectionMode() {
    if (bulkBusy !== null || isMerging) return;
    clearSelection();
    setSelectionMode(false);
  }

  async function handleSortEnd(event: DragEndEvent) {
    if (conversationSortMode !== "custom" || !event.over || event.active.id === event.over.id) return;
    const rows = conversationsQuery.data ?? [];
    const oldIndex = rows.findIndex((item) => item.id === event.active.id);
    const newIndex = rows.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    await updateConversationOrder(arrayMove(rows, oldIndex, newIndex).map((item) => item.id));
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  function handleSortStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveSortId(id);
    window.dispatchEvent(new Event("reader:dnd-start"));
    const initial = event.active.rect.current.initial
      ?? event.active.rect.current.translated
      ?? document.querySelector<HTMLElement>(`[data-testid="conversation-sortable-row-${id}"]`)?.getBoundingClientRect();
    setActiveSortSize(initial ? { width: initial.width, height: initial.height } : null);
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

  function applySelection(ids: Iterable<string>) {
    const requested = new Set(ids);
    const orderedIds = conversations.filter((conversation) => requested.has(conversation.id)).map((conversation) => conversation.id);
    setSelectedConversationIds(new Set(orderedIds));
    setMergeOrderIds(orderedIds);
  }

  function applyBatchResult(result: BatchSelectionResult) {
    applySelection(result.failedIds);
    setBatchNotice(resolvedLocale === "zh-CN"
      ? `已完成 ${result.succeededIds.length} 项，失败 ${result.failedIds.length} 项${result.failedIds.length ? "；失败项已保留选择" : ""}`
      : `${result.succeededIds.length} completed, ${result.failedIds.length} failed${result.failedIds.length ? "; failed items remain selected" : ""}`);
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
    <section className="space-y-3" aria-busy={conversationsQuery.isFetching}>
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
          {conversationsQuery.isFetching ? <span role="status" className="text-xs text-secondary">{resolvedLocale === "zh-CN" ? "正在更新" : "Updating"}</span> : null}
          <p className="text-sm text-secondary">{resolvedLocale === "zh-CN" ? `共 ${conversations.length} 个` : `${conversations.length} total`}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ConversationSortMenu />
          <SelectionModeButton active={selectionMode} locale={resolvedLocale} onClick={selectionMode ? exitSelectionMode : () => setSelectionMode(true)} />
        </div>
      </div>
      {batchNotice ? <p className="rounded-md border border-ui bg-subtle px-3 py-2 text-xs text-secondary" role="status">{batchNotice}</p> : null}
      {selectionMode ? <SelectionToolbar
        selectedCount={selectedConversationIds.size}
        totalCount={conversations.length}
        busy={bulkBusy !== null || isMerging}
        locale={resolvedLocale}
        onSelectAll={linearSelection.selectAll}
        onInvert={linearSelection.invert}
        onClear={clearSelection}
        onDone={exitSelectionMode}
      >
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
                const result = await runBatchSelection(ids, (id) => moveConversationToProject(id, projectId));
                applyBatchResult(result);
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
                const result = await runBatchSelection(ids, archiveConversation);
                applyBatchResult(result);
                setUndo({
                  label: `已归档 ${result.succeededIds.length} 个会话`,
                  action: async () => {
                    await runBatchSelection(result.succeededIds, unarchiveConversation);
                    await refreshLists();
                  },
                });
                await refreshLists();
              } finally {
                setBulkBusy(null);
              }
            }}
            onRestore={async (ids) => {
              setBulkBusy("restore");
              try {
                const result = await runBatchSelection(ids, unarchiveConversation);
                applyBatchResult(result);
                setUndo({
                  label: `已恢复 ${result.succeededIds.length} 个会话`,
                  action: async () => {
                    await runBatchSelection(result.succeededIds, archiveConversation);
                    await refreshLists();
                  },
                });
                await refreshLists();
              } finally {
                setBulkBusy(null);
              }
            }}
            onDelete={async (ids) => {
              if (!(await dialog.confirm({ title: resolvedLocale === "zh-CN" ? `永久删除 ${ids.length} 个对话？` : `Permanently delete ${ids.length} conversations?`, description: resolvedLocale === "zh-CN" ? "这些对话会在后台按列表顺序逐项删除，无法在系统内恢复；可在任务区域停止后续项目。" : "These conversations are deleted in order in the background and cannot be restored in the app. You can stop pending items in the task area.", confirmLabel: resolvedLocale === "zh-CN" ? "永久删除" : "Delete permanently", danger: true }))) {
                return;
              }
              setBulkBusy("delete");
              try {
                // Preserve the visual top-to-bottom order regardless of the
                // merge-order editor's temporary ordering. The server deletes
                // one item at a time in this order.
                const requested = new Set(ids);
                const orderedIds = conversations
                  .map((conversation) => conversation.id)
                  .filter((conversationId) => requested.has(conversationId));
                const task = await queueConversationBatchDelete(orderedIds);
                queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (current = []) => [
                  task,
                  ...current.filter((item) => item.job_id !== task.job_id),
                ]);
                applySelection([]);
                setSelectionMode(false);
                setBatchNotice(resolvedLocale === "zh-CN"
                  ? `已开始按顺序删除 ${orderedIds.length} 个对话；可在左侧任务区域查看进度并停止后续删除`
                  : `Deletion started for ${orderedIds.length} conversations in order. Track progress or stop pending items in the task area.`);
              } finally {
                setBulkBusy(null);
              }
            }}
          />
      </SelectionToolbar> : null}
      <DndContext sensors={sortSensors} onDragStart={handleSortStart} onDragCancel={() => { setActiveSortId(null); setActiveSortSize(null); }} onDragEnd={(event) => { setActiveSortId(null); setActiveSortSize(null); void handleSortEnd(event); }}><SortableContext items={conversations.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="overflow-hidden rounded-xl border border-ui bg-surface">
        {conversations.map((conversation) => (
          <SortableConversationRow id={conversation.id} enabled={conversationSortMode === "custom" && !selectionMode} key={conversation.id}><article
            {...linearSelection.itemHandlers(conversation.id)}
            data-state={selectedConversationIds.has(conversation.id) ? "selected" : undefined}
            aria-selected={selectionMode ? selectedConversationIds.has(conversation.id) : undefined}
            className="reader-interactive-row group border-b border-ui px-4 py-3 transition last:border-b-0"
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
              <div className="flex min-w-0 gap-3">
                <label className={`mt-1 h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ui bg-surface transition-opacity ${linearSelection.checkboxClass(conversation.id)}`}>
                  <input
                    type="checkbox"
                    checked={selectedConversationIds.has(conversation.id)}
                    onClick={(event) => { setSelectionMode(true); linearSelection.toggle(conversation.id, { selected: !selectedConversationIds.has(conversation.id), range: event.shiftKey }); }}
                    onChange={() => undefined}
                    aria-label={`${resolvedLocale === "zh-CN" ? "选择" : "Select"} ${conversation.display_title || conversation.title}`}
                  />
                </label>
                <div className="min-w-0">
                  {selectionMode ? <button type="button" className="block w-full text-left" onClick={() => toggleConversationSelection(conversation.id, !selectedConversationIds.has(conversation.id))}>
                    <h3 className="truncate text-base font-semibold text-primary">
                      {conversation.is_global_pinned ? (resolvedLocale === "zh-CN" ? "置顶 · " : "Pinned · ") : ""}
                      {conversation.display_title || conversation.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                      {conversation.description_markdown || previewConversationText(conversation.first_user_message, resolvedLocale)}
                    </p>
                  </button> : <HoverPreviewLink href={`/conversations/${conversation.id}`} title={conversation.display_title || conversation.title} description={conversation.description_markdown || previewConversationText(conversation.first_user_message, resolvedLocale)} className="block rounded-md text-left focus:outline-none focus:ring-2 focus:ring-[var(--focus)]">
                      <h3 className="truncate text-base font-semibold text-primary">
                        {conversation.is_global_pinned ? (resolvedLocale === "zh-CN" ? "置顶 · " : "Pinned · ") : ""}
                        {conversation.display_title || conversation.title}
                      </h3>
                    <p data-hover-preview-copy className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                      {conversation.description_markdown || previewConversationText(conversation.first_user_message, resolvedLocale)}
                    </p>
                    {typeof conversation.reading_progress === "number" ? <ReadingProgress value={conversation.reading_progress} locale={resolvedLocale} /> : null}
                  </HoverPreviewLink>}
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 md:justify-end md:text-right">
                <div className="min-w-0">
                  <p className="text-xs text-secondary" title={fullActivityTime(activityTimestamp(conversation, conversationSortMode), resolvedLocale)} aria-label={fullActivityTime(activityTimestamp(conversation, conversationSortMode), resolvedLocale)}>{formatActivityTime(activityTimestamp(conversation, conversationSortMode), resolvedLocale)}</p>
                  <p className="mt-1 text-sm text-secondary">{resolvedLocale === "zh-CN" ? `${conversation.message_count} 条消息` : `${conversation.message_count} messages`}</p>
                </div>
                {!selectionMode ? <ConversationActionMenu conversation={conversation} onChanged={refreshLists} onUndo={setUndo} /> : null}
              </div>
            </div>
          </article></SortableConversationRow>
        ))}
      </div></SortableContext><DragOverlay adjustScale={false}>{activeSortId ? <div data-testid="conversation-list-drag-overlay" className="reader-drag-overlay px-4 py-3 text-sm font-semibold text-primary" style={activeSortSize ? { width: activeSortSize.width, height: activeSortSize.height } : undefined} aria-hidden="true"><p className="truncate">{conversations.find((item) => item.id === activeSortId)?.display_title || conversations.find((item) => item.id === activeSortId)?.title}</p><p className="mt-1 line-clamp-2 text-xs font-normal text-secondary">{conversations.find((item) => item.id === activeSortId)?.description_markdown || conversations.find((item) => item.id === activeSortId)?.first_user_message || ""}</p></div> : null}</DragOverlay></DndContext>
    </section>
  );
}

function ReadingProgress({ value, locale }: { value: number; locale: "zh-CN" | "en-US" }) {
  const normalized = Math.max(0, Math.min(100, value));
  return <div className="mt-2 flex items-center gap-2"><div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label={locale === "zh-CN" ? "阅读进度" : "Reading progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalized)}><span className="block h-full rounded-full bg-accent" style={{ width: `${normalized}%` }} /></div><span className="text-[11px] text-secondary">{Math.round(normalized)}%</span></div>;
}

function SortableConversationRow({ id, enabled, children }: { id: string; enabled: boolean; children: ReactNode }) {
  const sortable = useSortable({ id, disabled: !enabled });
  const dragProps = enabled ? { ...sortable.attributes, ...sortable.listeners } : {};
  return <div ref={sortable.setNodeRef} data-testid={`conversation-sortable-row-${id}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} data-state={sortable.isDragging ? "dragging" : undefined} {...dragProps} className={`relative outline-none ${sortable.isDragging ? "reader-interactive-row cursor-grabbing" : "cursor-pointer"}`}>{children}</div>;
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
  const [mergeOpen, setMergeOpen] = useState(false);
  useEffect(() => {
    if (selectedIds.length < 2) setMergeOpen(false);
  }, [selectedIds.length]);
  return (
    <>
      <div className="selection-toolbar-action-group flex flex-wrap items-center gap-1.5">
        {mode === "active" ? <select
          defaultValue=""
          disabled={bulkBusy !== null || selectedIds.length === 0}
          onChange={(event) => { const value = event.target.value; if (value) void onMove(selectedIds, value === "__none" ? null : value); event.target.value = ""; }}
          className="min-h-9 max-w-full rounded-lg border border-ui bg-surface px-2 text-sm text-primary"
          aria-label={zh ? "移动到项目" : "Move to project"}
        >
          <option value="" disabled>{zh ? "移动到项目" : "Move to project"}</option>
          <option value="__none">{zh ? "移出项目" : "Remove from project"}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select> : null}
        <button type="button" disabled={bulkBusy !== null || selectedIds.length === 0} onClick={() => void onExport(selectedConversations)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-60">{bulkBusy === "export" ? (zh ? "正在导出" : "Exporting") : (zh ? "导出" : "Export")}</button>
        {isArchivedMode ? (
          <button
            type="button"
            disabled={bulkBusy !== null || selectedIds.length === 0}
            onClick={() => void onRestore(selectedIds)}
            className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
          >
            {zh ? "恢复" : "Restore"}
          </button>
        ) : (
          <button
            type="button"
            disabled={bulkBusy !== null || selectedIds.length === 0}
            onClick={() => void onArchive(selectedIds)}
            className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
          >
            {zh ? "归档" : "Archive"}
          </button>
        )}
        {mode === "active" ? <button type="button" disabled={bulkBusy !== null || selectedIds.length < 2} onClick={() => setMergeOpen(true)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-40">{zh ? "合并对话" : "Merge"}</button> : null}
        <button type="button" disabled={bulkBusy !== null || selectedIds.length === 0} onClick={() => void onDelete(selectedIds)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40">{zh ? "删除所选" : "Delete selected"}</button>
      </div>
      <MergeConversationsDialog open={mergeOpen} conversations={selectedConversations} title={title} busy={isMerging} onTitleChange={onTitleChange} onReorder={onReorder} onMerge={() => onMerge(selectedIds, title)} onClose={() => { if (!isMerging) setMergeOpen(false); }} />
    </>
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
