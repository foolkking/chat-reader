"use client";

import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, type DragEndEvent, type DragStartEvent, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ApiRequestError,
  archiveConversation,
  getProjectConversations,
  getProjects,
  mergeConversations,
  moveConversationToProject,
  removeConversationFromProject,
  recordRecentProject,
  updateProjectConversationOrder,
} from "../../lib/api";
import type { ConversationCreateResponse, ProjectConversationRead, ProjectRead } from "../../lib/types";
import { ConversationActionMenu } from "../conversations/conversation-action-menu";
import { useConversationDeletion } from "../conversations/conversation-deletion-provider";
import { ConversationPlacementSurface, useConversationPlacement } from "../conversations/conversation-placement";
import { ConversationUndoNotice, createConversationUndo, type UndoAction } from "../conversations/conversation-undo";
import { MergeAdmissionNotice, MergeConversationsDialog } from "../conversations/merge-conversations-dialog";
import { stripLeadingTimestamp } from "../conversations/markdown-renderer";
import { ProjectSymbol } from "./project-symbol";
import { ProjectSidebar } from "./project-sidebar";
import { ConversationSortMenu } from "../../components/sort-menu";
import { usePreferences } from "../../components/preferences-provider";
import { formatActivityTime, fullActivityTime } from "../../lib/activity-time";
import { useBatchExport } from "../conversations/use-batch-export";
import { SelectionModeButton, SelectionToolbar } from "../../components/selection-toolbar";
import { useLinearSelection } from "../../components/use-linear-selection";
import { runBatchSelection, type BatchSelectionProgress, type BatchSelectionResult } from "../../lib/batch-selection";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { useWorkspaceShell } from "../../components/workspace-shell";
import { HoverPreviewLink } from "../../components/hover-preview-link";
import { BatchOperationFeedback } from "../../components/batch-operation-feedback";
import { BulkMoveReview } from "../../components/bulk-move-review";
import { flattenPages, type ListPage } from "../../lib/list-pagination";
import { useRouter } from "next/navigation";
import { NewConversationDialog } from "../conversations/new-conversation-dialog";
import { useImportDialog } from "../../components/import-dialog-provider";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import { useBatchResultCheck } from "../conversations/use-batch-result-check";

export function ProjectConversationList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { openImportDialog } = useImportDialog();
  const { conversationSortMode, conversationSortDirection, resolvedLocale } = usePreferences();
  const batchExport = useBatchExport(resolvedLocale === "zh-CN");
  const batchCheck = useBatchResultCheck(resolvedLocale === "zh-CN", "project:" + projectId);
  const deletion = useConversationDeletion();
  const deleteFlight = useRef(false);
  const batchStop = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const viewRef = useRef({ projectId });
  if (viewRef.current.projectId !== projectId) viewRef.current = { projectId };
  const currentView = viewRef.current;
  const viewGeneration = authenticationGeneration();
  function isCurrentView() {
    return mounted.current && viewRef.current === currentView && viewGeneration === authenticationGeneration();
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; batchStop.current?.abort(); }; }, []);
  useEffect(() => {
    const clearForIdentityChange = () => {
      batchStop.current?.abort();
      batchStop.current = null;
      setBatchProgress(null);
      setBatchNotice(null);
      setBulkBusy(null);
      setUndo(null);
      setNewConversationOpen(false);
      setSelectedConversationIds(new Set());
      setMergeOrderIds([]);
      setSelectionMode(false);
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, clearForIdentityChange);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, clearForIdentityChange);
  }, []);
  const workspace = useWorkspaceShell();
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [mergeTitle, setMergeTitle] = useState("Merged conversation");
  const [mergeOrderIds, setMergeOrderIds] = useState<string[]>([]);
  const [batchNotice, setBatchNotice] = useState<ReactNode>(null);
  const [batchProgress, setBatchProgress] = useState<BatchSelectionProgress | null>(null);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [mergeOpenScope, setMergeOpenScope] = useState<string | null>(null);
  const mergeResultRef = useRef<HTMLDivElement>(null);
  const sortBusy = useRef(false);
  const sortScope = useRef<{ projectId: string; mode: string; direction: string; updatedAt: number; generation: number } | null>(null);
  const sortView = useRef({ projectId, mode: conversationSortMode, direction: conversationSortDirection, generation: 0 });
  if (sortView.current.projectId !== projectId || sortView.current.mode !== conversationSortMode
    || sortView.current.direction !== conversationSortDirection) {
    sortView.current = {
      projectId, mode: conversationSortMode, direction: conversationSortDirection,
      generation: sortView.current.generation + 1,
    };
  }
  const [sortError, setSortError] = useState(false);
  const [activeSortId, setActiveSortId] = useState<string | null>(null);
  const [activeSortSize, setActiveSortSize] = useState<{ width: number; height: number } | null>(null);
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectsQuery = useQuery({
    queryKey: ["projects", "custom", "asc"],
    queryFn: () => getProjects({ sort: "custom", direction: "asc" }),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
  const pageSize = 100;
  const conversationsQuery = useInfiniteQuery({
    queryKey: ["project-conversations", projectId, conversationSortMode, conversationSortDirection],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }): Promise<ListPage<ProjectConversationRead>> => {
      const rows = await getProjectConversations(projectId, {
        sort: conversationSortMode, direction: conversationSortDirection,
        limit: pageSize + 1, offset: pageParam, signal,
      });
      return { items: rows.slice(0, pageSize), offset: pageParam, hasMore: rows.length > pageSize };
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.offset + pageSize : undefined,
    staleTime: 10_000,
  });
  const projectUnavailable = conversationsQuery.isError
    && conversationsQuery.error instanceof ApiRequestError
    && [401, 403, 404].includes(conversationsQuery.error.status)
    || projectsQuery.isError && projectsQuery.error instanceof ApiRequestError
      && [401, 403, 404].includes(projectsQuery.error.status);
  const project = projectUnavailable ? undefined : projectsQuery.data?.find((item) => item.id === projectId);
  const zh = resolvedLocale === "zh-CN";
  const conversations = projectUnavailable ? [] : flattenPages(conversationsQuery.data?.pages);
  const canAddToProject = Boolean(project && !project.is_archived && !projectsQuery.isError && !projectsQuery.isLoading);
  const customOrderUnavailable = conversationSortMode === "custom"
    && (!project || projectsQuery.isLoading || projectsQuery.isError || project.conversation_count > 500
      || conversationsQuery.hasNextPage
      || conversations.length !== project.conversation_count);
  const placement = useConversationPlacement({ scope: "project-list:" + projectId, unavailable: projectUnavailable, onChanged: refreshProject });
  const selectedMergeConversations = mergeOrderIds
    .map((id) => conversations.find((conversation) => conversation.id === id))
    .filter((conversation): conversation is ProjectConversationRead => Boolean(conversation));
  const linearSelection = useLinearSelection({
    ids: conversations.map((conversation) => conversation.id),
    selectedIds: selectedConversationIds,
    onChange: applySelection,
    disabled: bulkBusy !== null,
    selectionMode,
    onActivate: () => setSelectionMode(true),
    onExit: exitSelectionMode,
  });

  function clearSelection() {
    setSelectedConversationIds(new Set());
    setMergeOrderIds([]);
  }

  function exitSelectionMode() {
    if (bulkBusy !== null) return;
    clearSelection();
    setSelectionMode(false);
  }

  function applySelection(ids: Iterable<string>) {
    const requested = new Set(ids);
    const orderedIds = conversations.filter((conversation) => requested.has(conversation.id)).map((conversation) => conversation.id);
    setSelectedConversationIds(new Set(orderedIds));
    setMergeOrderIds(orderedIds);
  }

  function applyBatchResult(result: BatchSelectionResult) {
    batchCheck.record(result);
    const remaining = [...result.failedIds, ...result.unconfirmedIds, ...result.notStartedIds];
    setSelectedConversationIds(new Set(remaining));
    setMergeOrderIds(remaining);
    setBatchNotice(zh
      ? `已确认完成 ${result.succeededIds.length} 项，明确失败 ${result.failedIds.length} 项，结果未确认 ${result.unconfirmedIds.length} 项，未开始 ${result.notStartedIds.length} 项。未确认项请先刷新并核对当前状态，不要盲目重复提交。`
      : `${result.succeededIds.length} confirmed complete, ${result.failedIds.length} definite failures, ${result.unconfirmedIds.length} unconfirmed, ${result.notStartedIds.length} not started. Refresh and check current state before retrying unconfirmed items.`);
  }

  async function runBatch(ids: string[], operation: (id: string) => Promise<unknown>) {
    if (!isCurrentView() || projectUnavailable || ids.some((id) => batchCheck.blockedIds.has(id)) || batchStop.current) return null;
    const controller = new AbortController();
    const generation = authenticationGeneration();
    const abortOnIdentityChange = () => controller.abort();
    batchStop.current = controller;
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, abortOnIdentityChange);
    setBatchProgress({ total: ids.length, succeeded: 0, failed: 0, unconfirmed: 0, inFlight: 0, notStarted: ids.length });
    try {
      const result = await runBatchSelection(ids, operation, 4, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (isCurrentView() && generation === authenticationGeneration()) setBatchProgress(progress);
          else controller.abort();
        },
      });
      return isCurrentView() && generation === authenticationGeneration() ? result : null;
    } finally {
      window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, abortOnIdentityChange);
      if (batchStop.current === controller) batchStop.current = null;
      if (isCurrentView() && generation === authenticationGeneration()) setBatchProgress(null);
    }
  }

  function toggleConversationSelection(conversationId: string, selected: boolean) {
    const next = new Set(selectedConversationIds);
    if (selected) next.add(conversationId);
    else next.delete(conversationId);
    applySelection(next);
  }

  async function handleSortEnd(event: DragEndEvent) {
    const origin = sortScope.current;
    sortScope.current = null;
    if (projectUnavailable || customOrderUnavailable || conversationsQuery.isFetching || conversationsQuery.isError
      || !origin || origin.projectId !== projectId || origin.mode !== conversationSortMode
      || origin.direction !== conversationSortDirection || origin.generation !== sortView.current.generation
      || origin.updatedAt !== conversationsQuery.dataUpdatedAt || sortBusy.current
      || conversationSortMode !== "custom" || !event.over || event.active.id === event.over.id) return;
    const oldIndex = conversations.findIndex((item) => item.id === event.active.id);
    const newIndex = conversations.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    sortBusy.current = true; setSortError(false);
    const currentGeneration = sortView.current.generation;
    try {
      await updateProjectConversationOrder(projectId, arrayMove(conversations, oldIndex, newIndex).map((item) => item.id));
      await queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] });
    } catch {
      if (sortView.current.generation === currentGeneration && sortView.current.projectId === projectId) setSortError(true);
    }
    finally { sortBusy.current = false; }
  }

  function handleSortStart(event: DragStartEvent) {
    sortScope.current = null;
    if (projectUnavailable || customOrderUnavailable || conversationsQuery.isFetching || conversationsQuery.isError
      || conversationSortMode !== "custom") {
      setSortError(true);
      void conversationsQuery.refetch();
      return;
    }
    sortScope.current = {
      projectId, mode: conversationSortMode, direction: conversationSortDirection,
      updatedAt: conversationsQuery.dataUpdatedAt, generation: sortView.current.generation,
    };
    const id = String(event.active.id);
    setActiveSortId(id);
    window.dispatchEvent(new Event("reader:dnd-start"));
    const initial = event.active.rect.current.initial
      ?? event.active.rect.current.translated
      ?? document.querySelector<HTMLElement>(`[data-testid="project-conversation-sortable-row-${id}"]`)?.getBoundingClientRect();
    setActiveSortSize(initial ? { width: initial.width, height: initial.height } : null);
  }

  useEffect(() => {
    void recordRecentProject(projectId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    }).catch(() => undefined);
  }, [projectId, queryClient]);

  useEffect(() => {
    batchStop.current?.abort();
    batchStop.current = null;
    setBulkBusy(null);
    setBatchProgress(null);
    setBatchNotice(null);
    setUndo(null);
    setNewConversationOpen(false);
    sortScope.current = null;
    setSortError(false);
    setSelectedConversationIds(new Set());
    setMergeOrderIds([]);
    setSelectionMode(false);
    setMergeOpenScope(null);
  }, [projectId]);

  useEffect(() => {
    if (selectedConversationIds.size > 0) setSelectionMode(true);
  }, [selectedConversationIds.size]);

  useEffect(() => {
    const handleDeleteProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ deletedIds?: string[] }>).detail;
      const deletedIds = new Set(detail?.deletedIds ?? []);
      if (!deletedIds.size) return;
      queryClient.setQueryData<InfiniteData<ListPage<ProjectConversationRead>> | undefined>(
        ["project-conversations", projectId, conversationSortMode, conversationSortDirection],
        (current) => current ? { ...current, pages: current.pages.map((page) => ({ ...page, items: page.items.filter((conversation) => !deletedIds.has(conversation.id)) })) } : current,
      );
    };
    window.addEventListener("chat-reader:conversation-delete-progress", handleDeleteProgress);
    return () => window.removeEventListener("chat-reader:conversation-delete-progress", handleDeleteProgress);
  }, [conversationSortDirection, conversationSortMode, projectId, queryClient]);

  async function refreshProject() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
    ]);
  }

  const content = (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobilePageHeader
          title={project?.name ?? (zh ? "项目" : "Project")}
          description={zh ? `${project?.conversation_count ?? 0} 个对话 · ${project?.pinned_count ?? 0} 个置顶` : `${project?.conversation_count ?? 0} conversations · ${project?.pinned_count ?? 0} pinned`}
          onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobileSidebarOpenSignal((value) => value + 1)}
          className="md:px-6"
          actions={
            <div className="flex items-center gap-2 md:hidden">
              <ConversationSortMenu compact hideCustomDirection />
              <SelectionModeButton active={selectionMode} locale={resolvedLocale} onClick={selectionMode ? exitSelectionMode : () => setSelectionMode(true)} />
            </div>
          }
        />

        <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden" aria-busy={conversationsQuery.isFetching || projectsQuery.isFetching}>
          <div data-project-drop-target={projectId} className="pointer-events-none absolute inset-0 z-20" />
          <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-10">
            <header className="hidden items-end justify-between gap-6 border-b border-ui pb-6 md:flex">
              {conversationsQuery.isFetching || projectsQuery.isFetching ? <span role="status" className="sr-only">{zh ? "正在更新" : "Updating"}</span> : null}
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">{zh ? "项目工作区" : "Project workspace"}</p>
                <h1 className="mt-2 flex items-center gap-2 truncate text-2xl font-semibold text-primary"><ProjectSymbol project={project} className="h-6 w-6 shrink-0" />{project?.name ?? (zh ? "项目" : "Project")}</h1>
                <p className="mt-2 text-sm text-secondary">{zh ? `${project?.conversation_count ?? 0} 个对话，${project?.pinned_count ?? 0} 个置顶` : `${project?.conversation_count ?? 0} conversations · ${project?.pinned_count ?? 0} pinned`}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ConversationSortMenu hideCustomDirection />
                <SelectionModeButton active={selectionMode} locale={resolvedLocale} onClick={selectionMode ? exitSelectionMode : () => setSelectionMode(true)} />
              </div>
            </header>
            {undo ? (
              <ConversationUndoNotice
                key={undo.id}
                undo={undo}
                disabled={bulkBusy !== null}
                onDone={() => setUndo((current) => current === undo ? null : current)}
              />
            ) : null}
            {sortError ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "排序结果未确认，请先刷新并核对当前顺序。" : "The order result is unconfirmed. Refresh and check the current order before trying again."}</p> : null}
            {!projectUnavailable ? <MergeConversationsDialog key={projectId} open={mergeOpenScope === projectId}
              conversations={selectedMergeConversations} title={mergeTitle} busy={bulkBusy === "merge"}
              recoveryDisabled={bulkBusy !== null} projectId={projectId}
              onTitleChange={setMergeTitle} onReorder={setMergeOrderIds}
              onOpen={() => setMergeOpenScope(projectId)} onClose={() => { if (bulkBusy !== "merge") setMergeOpenScope(null); }}
              resultFocus={() => mergeResultRef.current}
              onMerge={async (request, signal) => {
                setBulkBusy("merge");
                try {
                  return await mergeConversations({ conversationIds: request.conversationIds, title: request.title,
                    projectId, idempotencyKey: request.idempotencyKey }, signal);
                } finally { setBulkBusy(null); }
              }}
              onAccepted={(task) => {
                setMergeOpenScope(null);
                setSelectedConversationIds(new Set());
                setMergeOrderIds([]);
                setMergeTitle(`${project?.name ?? "Project"} merged`);
                setBatchNotice(<MergeAdmissionNotice task={task} zh={zh} />);
              }} /> : null}
            {!projectUnavailable && batchNotice ? <div ref={mergeResultRef} tabIndex={-1} className="rounded-md border border-ui bg-subtle px-3 py-2 text-xs text-secondary" role="status">{batchNotice}</div> : null}
            <BatchOperationFeedback progress={batchProgress} zh={zh} onStop={() => batchStop.current?.abort()} />
            {!projectUnavailable ? batchCheck.surface : null}
            <ConversationPlacementSurface placement={placement} />
            <NewConversationDialog
              key={projectId}
              open={newConversationOpen && canAddToProject}
              projects={projectsQuery.data ?? []}
              initialProjectId={projectId}
              onClose={() => setNewConversationOpen(false)}
              onCreated={(result: ConversationCreateResponse) => {
                if (!isCurrentView()) return;
                setNewConversationOpen(false);
                void refreshProject();
                queryClient.setQueryData(["conversation", "remote", result.conversation.id], result.conversation);
                router.push(`/conversations/${result.conversation.id}?projectId=${projectId}`);
              }}
            />

            {batchExport.feedback}
            {selectionMode && !projectUnavailable ? <SelectionToolbar
              selectedCount={selectedConversationIds.size}
              totalCount={conversations.length}
              loadedOnly={conversationsQuery.hasNextPage}
              busy={bulkBusy !== null}
              locale={resolvedLocale}
              onSelectAll={linearSelection.selectAll}
              onInvert={linearSelection.invert}
              onClear={clearSelection}
              onDone={exitSelectionMode}
            >
              <ProjectBulkActions
                selectedConversations={selectedMergeConversations}
                busy={bulkBusy}
                projects={(projectsQuery.data ?? []).filter((item) => !item.is_default && !item.is_archived && item.id !== projectId)}
                exportOverLimit={batchExport.overLimit(selectedConversationIds.size)}
                unresolvedSelection={[...selectedConversationIds].some((id) => batchCheck.blockedIds.has(id))}
                onOpenMerge={() => setMergeOpenScope(projectId)}
                onMove={async (ids, targetProjectId) => {
                  if (bulkBusy !== null || batchStop.current || !isCurrentView()) return;
                  setBulkBusy("move");
                  try {
                    const result = await runBatch(ids, (id) => moveConversationToProject(id, targetProjectId));
                    if (!result) return;
                    applyBatchResult(result);
                    await refreshProject();
                  } finally {
                    if (isCurrentView()) setBulkBusy(null);
                  }
                }}
                onExport={async (selected) => {
                  if (bulkBusy !== null || batchStop.current || !isCurrentView()) return;
                  setBulkBusy("export");
                  try {
                    await batchExport.submit(selected);
                  } finally {
                    if (isCurrentView()) setBulkBusy(null);
                  }
                }}
                onRemove={async (ids) => {
                  if (bulkBusy !== null || batchStop.current || !isCurrentView()) return;
                  setBulkBusy("remove");
                  try {
                    const result = await runBatch(ids, (id) => removeConversationFromProject(projectId, id));
                    if (!result) return;
                    applyBatchResult(result);
                    await refreshProject();
                  } finally {
                    if (isCurrentView()) setBulkBusy(null);
                  }
                }}
                onArchive={async (ids) => {
                  if (bulkBusy !== null || batchStop.current || !isCurrentView()) return;
                  setBulkBusy("archive");
                  try {
                    const result = await runBatch(ids, archiveConversation);
                    if (!result) return;
                    applyBatchResult(result);
                    if (result.succeededIds.length) setUndo(createConversationUndo(result.succeededIds, "active",
                      zh ? `已归档 ${result.succeededIds.length} 个会话` : `${result.succeededIds.length} ${result.succeededIds.length === 1 ? "conversation" : "conversations"} archived`, refreshProject));
                    await refreshProject();
                  } finally {
                    if (isCurrentView()) setBulkBusy(null);
                  }
                }}
                onDelete={async (ids) => {
                  if (deleteFlight.current || bulkBusy !== null || batchStop.current || !isCurrentView()
                    || ids.some((id) => batchCheck.blockedIds.has(id))) return;
                  deleteFlight.current = true;
                  const requested = new Set(ids);
                  const orderedIds = conversations.map(item => item.id).filter(id => requested.has(id));
                  setBulkBusy("delete");
                  try {
                    const task = await deletion.submit(orderedIds);
                    if (!task || !isCurrentView()) return;
                    clearSelection();
                    setSelectionMode(false);
                    setBatchNotice(zh
                      ? `已开始按顺序删除 ${orderedIds.length} 个对话；可在任务区域查看进度并停止后续删除`
                      : `Deletion started for ${orderedIds.length} conversations in order. Track progress or stop pending items in the task area.`);
                  } finally {
                    deleteFlight.current = false;
                    if (isCurrentView()) setBulkBusy(null);
                  }
                }}
              />
            </SelectionToolbar> : null}

            {conversationsQuery.isLoading ? <StateBlock label={resolvedLocale === "zh-CN" ? "正在加载项目对话…" : "Loading project conversations…"} /> : null}
            {conversationsQuery.isError ? <StateBlock error
              label={projectUnavailable
                ? (zh ? "项目不存在或当前账户无法访问。" : "This project is unavailable or your account cannot access it.")
                : conversations.length
                  ? (zh ? "项目对话更新失败，仍显示上次内容。" : "Could not update project conversations. Previously loaded items are shown.")
                  : (zh ? "项目对话加载失败，请重试。" : "Could not load project conversations. Try again.")}
              retry={() => void conversationsQuery.refetch()} retryLabel={zh ? "重试" : "Retry"} busy={conversationsQuery.isFetching} /> : null}
            {projectsQuery.isError && !conversationsQuery.isError ? <StateBlock error
              label={projectUnavailable
                ? (zh ? "项目不存在或当前账户无法访问。" : "This project is unavailable or your account cannot access it.")
                : (zh ? "无法读取项目信息；已加载的项目对话仍保留。重试前不能添加内容。" : "Project details could not be read. Loaded conversations are retained; retry before adding content.")}
              retry={() => void projectsQuery.refetch()} retryLabel={zh ? "重试项目" : "Retry project"} busy={projectsQuery.isFetching} /> : null}
            {conversationsQuery.isSuccess && conversations.length === 0 && project ? (
              <div className="rounded-xl border border-ui bg-surface p-6">
                <h2 className="text-base font-semibold text-primary">{zh ? "这个项目还没有对话" : "No conversations in this project"}</h2>
                <p className="mt-1 text-sm text-secondary">{canAddToProject
                  ? (zh ? "直接新建一段对话，或把已有记录导入这个项目。" : "Create a conversation here, or import existing records into this project.")
                  : (zh ? "请先恢复项目或重试项目信息，再添加内容。" : "Restore this project or retry its details before adding content.")}</p>
                {canAddToProject ? <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setNewConversationOpen(true)} className="min-h-11 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)]">{zh ? "新建对话" : "New conversation"}</button>
                  <button type="button" onClick={() => openImportDialog({ projectId })} className="min-h-11 rounded-lg border border-ui bg-raised px-4 text-sm font-medium text-primary">{zh ? "导入对话" : "Import conversations"}</button>
                </div> : null}
              </div>
            ) : null}
            {conversationSortMode === "custom" && customOrderUnavailable && conversations.length > 0 ? <p role="status" className="text-sm text-secondary">
              {zh ? ((project?.conversation_count ?? conversations.length) > 500
                ? "当前项目超过 500 个对话，自定义排序接口不支持该规模；请改用其他排序方式。"
                : "自定义排序前需加载全部项目对话；加载完成后才能拖动重排。")
                : ((project?.conversation_count ?? conversations.length) > 500
                  ? "This project exceeds the 500-item custom-order limit. Choose another sort mode."
                  : "Load every project conversation before custom drag ordering is enabled.")}
            </p> : null}
            {conversations.length > 0 ? <p className="text-sm text-secondary">{zh
              ? `已加载 ${conversations.length} 个对话${conversationsQuery.hasNextPage ? "，仍有更多" : ""}`
              : `${conversations.length} conversations loaded${conversationsQuery.hasNextPage ? ", more available" : ""}`}</p> : null}

            {conversations.length > 0 ? (
              <DndContext sensors={sortSensors} onDragStart={handleSortStart} onDragCancel={() => { sortScope.current = null; setActiveSortId(null); setActiveSortSize(null); }} onDragEnd={(event) => { setActiveSortId(null); setActiveSortSize(null); void handleSortEnd(event); }}><SortableContext items={conversations.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="overflow-hidden rounded-xl border border-ui bg-surface shadow-[var(--shadow-subtle)]">
                {conversations.map((conversation) => (
                  <SortableProjectConversationRow key={conversation.id} id={conversation.id} enabled={conversationSortMode === "custom" && !customOrderUnavailable && !selectionMode && !conversationsQuery.isFetching && !conversationsQuery.isError}><article {...linearSelection.itemHandlers(conversation.id)} data-state={selectedConversationIds.has(conversation.id) ? "selected" : undefined} aria-selected={selectionMode ? selectedConversationIds.has(conversation.id) : undefined} className="reader-interactive-row group border-b border-ui px-5 py-4 last:border-b-0">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_190px] md:items-start">
                      <div className="flex min-w-0 gap-3">
                        <label className={`mt-1 h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ui bg-surface transition-opacity ${linearSelection.checkboxClass(conversation.id)}`}>
                          <input
                            type="checkbox"
                            checked={selectedConversationIds.has(conversation.id)}
                            onClick={(event) => linearSelection.toggle(conversation.id, { selected: !selectedConversationIds.has(conversation.id), range: event.shiftKey })}
                            onChange={() => undefined}
                            aria-label={`${zh ? "选择" : "Select"} ${conversation.display_title || conversation.title}`}
                          />
                        </label>
                        <div className="min-w-0">
                          {selectionMode ? <button type="button" className="block w-full text-left" onClick={() => toggleConversationSelection(conversation.id, !selectedConversationIds.has(conversation.id))}>
                            <h2 className="truncate text-base font-semibold text-primary">
                              {conversation.project_relation.is_pinned ? (resolvedLocale === "zh-CN" ? "置顶 · " : "Pinned · ") : ""}
                              {conversation.display_title || conversation.title}
                            </h2>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                              {conversation.description_markdown || previewConversationText(conversation.first_user_message)}
                            </p>
                          </button> : <HoverPreviewLink href={`/conversations/${conversation.id}?projectId=${projectId}`} title={conversation.display_title || conversation.title} description={conversation.description_markdown || previewConversationText(conversation.first_user_message)} className="block rounded-md text-left focus:outline-none focus:ring-2 focus:ring-[var(--focus)]">
                              <h2 className="truncate text-base font-semibold text-primary">
                                {conversation.project_relation.is_pinned ? (resolvedLocale === "zh-CN" ? "置顶 · " : "Pinned · ") : ""}
                                {conversation.display_title || conversation.title}
                              </h2>
                            <p data-hover-preview-copy className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                              {conversation.description_markdown || previewConversationText(conversation.first_user_message)}
                            </p>
                            {typeof conversation.reading_progress === "number" ? <ReadingProgress value={conversation.reading_progress} zh={zh} /> : null}
                          </HoverPreviewLink>}
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-3 md:justify-end md:text-right">
                        <div className="min-w-0">
                          <p className="text-xs text-secondary" title={fullActivityTime(projectConversationActivity(conversation, conversationSortMode), resolvedLocale)}>{formatActivityTime(projectConversationActivity(conversation, conversationSortMode), resolvedLocale)}</p>
                          <p className="text-sm text-secondary">{resolvedLocale === "zh-CN" ? `${conversation.message_count} 条消息` : `${conversation.message_count} messages`}</p>
                        </div>
                        {!selectionMode ? <ConversationActionMenu conversation={conversation} placement={placement} projectId={projectId} projectPinned={conversation.project_relation.is_pinned} onChanged={refreshProject} onUndo={setUndo} /> : null}
                      </div>
                    </div>
                  </article></SortableProjectConversationRow>
                ))}
              </div></SortableContext><DragOverlay adjustScale={false}>{activeSortId ? <div data-testid="project-conversation-drag-overlay" className="reader-drag-overlay px-4 py-3 text-sm font-semibold text-primary" style={activeSortSize ? { width: activeSortSize.width, height: activeSortSize.height } : undefined} aria-hidden="true"><p className="truncate">{conversations.find((item) => item.id === activeSortId)?.display_title || conversations.find((item) => item.id === activeSortId)?.title}</p><p className="mt-1 line-clamp-2 text-xs font-normal text-secondary">{conversations.find((item) => item.id === activeSortId)?.description_markdown || conversations.find((item) => item.id === activeSortId)?.first_user_message || ""}</p></div> : null}</DragOverlay></DndContext>
            ) : null}
            {conversationsQuery.hasNextPage ? <div className="flex justify-center"><button type="button" disabled={conversationsQuery.isFetching || bulkBusy !== null} onClick={() => void conversationsQuery.fetchNextPage()} className="btn-secondary min-h-11 px-4">{conversationsQuery.isFetchingNextPage ? (zh ? "正在加载更多…" : "Loading more…") : conversationsQuery.isFetchNextPageError ? (zh ? "重试加载更多" : "Retry loading more") : (zh ? "加载更多对话" : "Load more conversations")}</button></div> : null}
          </div>
        </div>
      </section>
  );
  if (workspace.embedded) return content;
  return <main className="flex h-screen w-screen overflow-hidden bg-page text-primary"><ProjectSidebar currentProjectId={projectId} currentProjectDropTargetId={projectId} mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} />{content}</main>;
}

function ReadingProgress({ value, zh }: { value: number; zh: boolean }) {
  const normalized = Math.max(0, Math.min(100, value));
  return <div className="mt-2 flex items-center gap-2"><div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label={zh ? "阅读进度" : "Reading progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalized)}><span className="block h-full rounded-full bg-accent" style={{ width: `${normalized}%` }} /></div><span className="text-[11px] text-secondary">{Math.round(normalized)}%</span></div>;
}

function SortableProjectConversationRow({ id, enabled, children }: { id: string; enabled: boolean; children: ReactNode }) {
  const sortable = useSortable({ id, disabled: !enabled });
  const dragProps = enabled ? { ...sortable.attributes, ...sortable.listeners } : {};
  return <div ref={sortable.setNodeRef} data-testid={`project-conversation-sortable-row-${id}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} data-state={sortable.isDragging ? "dragging" : "hover"} {...dragProps} className={`reader-interactive-row relative outline-none ${sortable.isDragging ? "cursor-grabbing" : "cursor-pointer"}`}>{children}</div>;
}

function projectConversationActivity(conversation: ProjectConversationRead, mode: string): string | null {
  if (mode === "updated") return conversation.updated_at;
  if (mode === "created") return conversation.created_at;
  if (mode === "imported") return conversation.imported_at;
  return conversation.last_read_at;
}

function ProjectBulkActions({
  selectedConversations,
  busy,
  projects,
  onMove,
  onExport,
  onRemove,
  onOpenMerge,
  onArchive,
  onDelete,
  exportOverLimit,
  unresolvedSelection,
}: {
  selectedConversations: ProjectConversationRead[];
  busy: string | null;
  projects: ProjectRead[];
  onMove: (ids: string[], projectId: string | null) => Promise<void>;
  onExport: (conversations: ProjectConversationRead[]) => Promise<void>;
  onRemove: (ids: string[]) => Promise<void>;
  onOpenMerge: () => void;
  onArchive: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  exportOverLimit: boolean;
  unresolvedSelection: boolean;
}) {
  const selectedIds = selectedConversations.map((conversation) => conversation.id);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  return (
    <>
      <div className="selection-toolbar-action-group flex flex-wrap justify-end gap-1.5">
        <BulkMoveReview label="project-conversation" selectedIds={selectedIds} projects={projects} busy={busy !== null || unresolvedSelection} onMove={onMove} />
        <div className="flex flex-col">
          <button type="button" disabled={busy !== null || selectedIds.length === 0 || exportOverLimit || unresolvedSelection} onClick={() => void onExport(selectedConversations)} title={exportOverLimit ? (zh ? "单次最多导出 5000 个对话" : "A single export supports at most 5,000 conversations") : undefined} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-60">{busy === "export" ? (zh ? "正在导出" : "Exporting") : (zh ? "导出" : "Export")}</button>
          {exportOverLimit ? <span className="text-xs text-[var(--danger)]">{zh ? "单次最多 5000 项" : "Maximum 5,000 items"}</span> : null}
        </div>
        <button
          type="button"
          disabled={busy !== null || selectedIds.length === 0 || unresolvedSelection}
          onClick={() => void onRemove(selectedIds)}
          className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
        >
          {zh ? "移出项目" : "Remove"}
        </button>
        <button
          type="button"
          disabled={busy !== null || selectedIds.length === 0 || unresolvedSelection}
          onClick={() => void onArchive(selectedIds)}
          className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
        >
          {zh ? "归档" : "Archive"}
        </button>
        <button type="button" disabled={busy !== null || selectedIds.length < 2 || unresolvedSelection} onClick={onOpenMerge} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-40">{zh ? "合并对话" : "Merge"}</button>
        <button type="button" disabled={busy !== null || selectedIds.length === 0 || unresolvedSelection} onClick={() => void onDelete(selectedIds)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40">{zh ? "删除所选" : "Delete selected"}</button>
      </div>
    </>
  );
}

function StateBlock({ label, error = false, retry, retryLabel = "Retry", busy = false }: { label: string; error?: boolean; retry?: () => void; retryLabel?: string; busy?: boolean }) {
  return <div className="rounded-xl border border-ui bg-surface p-5 text-sm text-secondary" role={error ? "alert" : undefined}>{label}{retry ? <button type="button" onClick={retry} disabled={busy} className="btn-secondary ml-3 min-h-11 px-3 py-1 text-xs disabled:opacity-60">{retryLabel}</button> : null}</div>;
}

function previewConversationText(text?: string | null): string {
  const cleaned = stripLeadingTimestamp(text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || "No first user message.";
}
