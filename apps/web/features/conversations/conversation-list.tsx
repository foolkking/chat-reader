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
  getConversation,
  getConversations,
  getProjects,
  mergeConversations,
  moveConversationToProject,
  unarchiveConversation,
  updateConversation,
  updateConversationOrder,
} from "../../lib/api";
import type { ConversationListItem, ProjectRead } from "../../lib/types";
import { stripLeadingTimestamp } from "./markdown-renderer";
import { ConversationActionMenu } from "./conversation-action-menu";
import { useConversationDeletion } from "./conversation-deletion-provider";
import { ConversationPlacementSurface, useConversationPlacement } from "./conversation-placement";
import { ConversationUndoNotice, createConversationUndo, type UndoAction } from "./conversation-undo";
import { MergeAdmissionNotice, MergeConversationsDialog } from "./merge-conversations-dialog";
import { ConversationSortMenu } from "../../components/sort-menu";
import { usePreferences } from "../../components/preferences-provider";
import { QuickStartGuide } from "../../components/quick-start-guide";
import { formatActivityTime, fullActivityTime } from "../../lib/activity-time";
import { useBatchExport } from "./use-batch-export";
import { SelectionModeButton, SelectionToolbar } from "../../components/selection-toolbar";
import { useLinearSelection } from "../../components/use-linear-selection";
import { runBatchSelection, type BatchSelectionProgress, type BatchSelectionResult } from "../../lib/batch-selection";
import { HoverPreviewLink } from "../../components/hover-preview-link";
import { BatchOperationFeedback } from "../../components/batch-operation-feedback";
import { BulkMoveReview } from "../../components/bulk-move-review";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import { useBatchResultCheck } from "./use-batch-result-check";
import { BatchTitleTrim, type BatchTitleTrimResult } from "./batch-title-trim";

type ConversationPage = { items: ConversationListItem[]; offset: number; hasMore: boolean };

function sameSortPriority(left: ConversationListItem, right: ConversationListItem): boolean {
  return left.is_global_pinned === right.is_global_pinned && left.global_pinned_at === right.global_pinned_at;
}

function reverseSortGroups(rows: ConversationListItem[]): ConversationListItem[] {
  if (!rows.length) return rows;
  const result: ConversationListItem[] = [];
  let start = 0;
  for (let index = 1; index <= rows.length; index += 1) {
    if (index < rows.length && sameSortPriority(rows[index], rows[start])) continue;
    result.push(...rows.slice(start, index).reverse());
    start = index;
  }
  return result;
}

export function ConversationList({
  onImportClick,
  mode = "active",
}: {
  onImportClick?: () => void;
  mode?: "active" | "archived";
}) {
  const queryClient = useQueryClient();
  const { conversationSortMode, conversationSortDirection, resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const batchExport = useBatchExport(resolvedLocale === "zh-CN");
  const batchCheck = useBatchResultCheck(zh, "conversation-list:" + mode);
  const deletion = useConversationDeletion();
  const deleteFlight = useRef(false);
  const batchStop = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const viewRef = useRef({ mode });
  if (viewRef.current.mode !== mode) viewRef.current = { mode };
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
      setSelectedConversationIds(new Set());
      setMergeOrderIds([]);
      setSelectionMode(false);
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, clearForIdentityChange);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, clearForIdentityChange);
  }, []);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [mergeTitle, setMergeTitle] = useState("Merged conversation");
  const [mergeOrderIds, setMergeOrderIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [batchNotice, setBatchNotice] = useState<ReactNode>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const mergeResultRef = useRef<HTMLDivElement>(null);
  const [batchProgress, setBatchProgress] = useState<BatchSelectionProgress | null>(null);
  const [titleTrimOpen, setTitleTrimOpen] = useState(false);
  const [titleTrimConversations, setTitleTrimConversations] = useState<ConversationListItem[]>([]);
  const sortBusy = useRef(false);
  const [sortError, setSortError] = useState(false);
  const [sortBoundaryNotice, setSortBoundaryNotice] = useState(false);
  const [activeSortId, setActiveSortId] = useState<string | null>(null);
  const [activeSortSize, setActiveSortSize] = useState<{ width: number; height: number } | null>(null);
  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pageSize = 100;
  const conversationsQuery = useInfiniteQuery({
    queryKey: ["conversations", "paged", mode, conversationSortMode, conversationSortDirection],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }): Promise<ConversationPage> => {
      const rows = await getConversations({
        statusScope: mode, scope: "all", sort: conversationSortMode,
        direction: conversationSortDirection, limit: pageSize + 1, offset: pageParam,
      }, signal);
      return { items: rows.slice(0, pageSize), offset: pageParam, hasMore: rows.length > pageSize };
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.offset + pageSize : undefined,
    // Do not show or mutate the old sort's rows under the new sort controls.
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
    enabled: mode === "active" && conversationsQuery.isSuccess && (conversationsQuery.data?.pages[0]?.items.length ?? 0) === 0,
    staleTime: 30_000,
  });
  const isArchivedMode = mode === "archived";
  const customOrderLimit = 500;
  const listUnavailable = conversationsQuery.isError && conversationsQuery.error instanceof ApiRequestError
    && [401, 403, 404].includes(conversationsQuery.error.status);
  const loadedConversations = [...new Map((conversationsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((row) => [row.id, row])).values()];
  const conversations = listUnavailable ? [] : loadedConversations.filter((conversation) => conversation.status === mode);
  const customOrderTooLarge = conversationSortMode === "custom"
    && (conversations.length > customOrderLimit || (conversations.length === customOrderLimit && conversationsQuery.hasNextPage));
  const placement = useConversationPlacement({ scope: "conversation-list:" + mode, unavailable: listUnavailable, onChanged: refreshLists });
  const selectedMergeConversations = mergeOrderIds
    .map((id) => conversations.find((conversation) => conversation.id === id))
    .filter((conversation): conversation is ConversationListItem => Boolean(conversation));
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
    batchStop.current?.abort();
    batchStop.current = null;
    setBatchProgress(null);
    setBatchNotice(null);
    setBulkBusy(null);
    setUndo(null);
  }, [mode]);

  useEffect(() => {
    setSelectedConversationIds(new Set());
    setMergeOrderIds([]);
    setSelectionMode(false);
    setSortError(false);
    setSortBoundaryNotice(false);
  }, [mode, conversationSortMode, conversationSortDirection]);

  useEffect(() => {
    const handleDeleteProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ deletedIds?: string[] }>).detail;
      const deletedIds = new Set(detail?.deletedIds ?? []);
      if (!deletedIds.size) return;
      queryClient.setQueriesData<ConversationListItem[] | InfiniteData<ConversationPage> | undefined>(
        { queryKey: ["conversations"] },
        (current) => Array.isArray(current)
          ? current.filter((conversation) => !deletedIds.has(conversation.id))
          : current ? { ...current, pages: current.pages.map((page) => ({ ...page, items: page.items.filter((conversation) => !deletedIds.has(conversation.id)) })) } : current,
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
    if (listUnavailable || conversationsQuery.isFetching || conversationsQuery.isError || conversationsQuery.hasNextPage
      || customOrderTooLarge || sortBusy.current || conversationSortMode !== "custom" || !event.over
      || event.active.id === event.over.id) return;
    const rows = conversations;
    const oldIndex = rows.findIndex((item) => item.id === event.active.id);
    const newIndex = rows.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (!sameSortPriority(rows[oldIndex], rows[newIndex])) {
      setSortBoundaryNotice(true);
      return;
    }
    sortBusy.current = true; setSortError(false); setSortBoundaryNotice(false);
    try {
      const reordered = arrayMove(rows, oldIndex, newIndex);
      // The API stores one canonical ascending rank, while the custom list may
      // be rendered descending. Reverse each equal-priority group so a reload
      // returns the same visible order. Pin status AND pinned timestamp take
      // precedence over manual rank on the server.
      const canonicalRows = conversationSortDirection === "desc"
        ? reverseSortGroups(reordered)
        : reordered;
      await updateConversationOrder(canonicalRows.map((item) => item.id));
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch { setSortError(true); }
    finally { sortBusy.current = false; }
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

  function withUndo(content: ReactNode) {
    return <div className="space-y-3">
      <ConversationPlacementSurface placement={placement} />
      {undo ? <ConversationUndoNotice key={undo.id} undo={undo} disabled={bulkBusy !== null || isMerging}
        onDone={() => setUndo((current) => current === undo ? null : current)} /> : null}
      <MergeConversationsDialog key="merge" open={mergeOpen} conversations={selectedMergeConversations}
        title={mergeTitle} busy={isMerging} recoveryDisabled={bulkBusy !== null}
        onTitleChange={setMergeTitle} onReorder={setMergeOrderIds}
        onOpen={() => setMergeOpen(true)} onClose={() => { if (!isMerging) setMergeOpen(false); }}
        resultFocus={() => mergeResultRef.current}
        onMerge={async (request, signal) => {
          setIsMerging(true);
          try {
            return await mergeConversations({ conversationIds: request.conversationIds, title: request.title,
              idempotencyKey: request.idempotencyKey }, signal);
          } finally { setIsMerging(false); }
        }}
        onAccepted={(task) => {
          setMergeOpen(false);
          setSelectedConversationIds(new Set());
          setMergeOrderIds([]);
          setMergeTitle("Merged conversation");
          setBatchNotice(<MergeAdmissionNotice task={task} zh={resolvedLocale === "zh-CN"} />);
        }} />
      <BatchTitleTrim
        open={titleTrimOpen}
        conversations={titleTrimConversations}
        busy={bulkBusy === "title-trim"}
        locale={resolvedLocale}
        onClose={() => { if (bulkBusy !== "title-trim") setTitleTrimOpen(false); }}
        onConfirm={async (changes) => {
          if (bulkBusy !== null || !isCurrentView()) {
            return { succeededIds: [], failedIds: [], unknownIds: changes.map((change) => change.id) };
          }
          setBulkBusy("title-trim");
          const succeededIds: string[] = [];
          const failedIds: string[] = [];
          const unknownIds: string[] = [];
          let stopped = false;
          try {
            for (let index = 0; index < changes.length; index += 1) {
              const change = changes[index];
              if (!isCurrentView()) {
                unknownIds.push(...changes.slice(index).map((item) => item.id));
                stopped = true;
                break;
              }
              let current: ConversationListItem;
              try {
                current = await getConversation(change.id, AbortSignal.timeout(15_000));
              } catch {
                unknownIds.push(...changes.slice(index).map((item) => item.id));
                stopped = true;
                break;
              }
              if (current.title !== change.originalTitle || current.display_title !== change.originalDisplayTitle) {
                unknownIds.push(...changes.slice(index).map((item) => item.id));
                stopped = true;
                break;
              }
              try {
                const saved = await updateConversation(change.id, {
                  title: change.nextTitle,
                  display_title: change.nextTitle,
                }, AbortSignal.timeout(15_000));
                if (saved.id !== change.id || saved.title !== change.nextTitle || saved.display_title !== change.nextTitle) {
                  unknownIds.push(...changes.slice(index).map((item) => item.id));
                  stopped = true;
                  break;
                }
                succeededIds.push(change.id);
              } catch (error) {
                if (error instanceof ApiRequestError && [400, 422].includes(error.status)) {
                  failedIds.push(change.id);
                } else {
                  unknownIds.push(...changes.slice(index).map((item) => item.id));
                  stopped = true;
                  break;
                }
              }
            }
            const remaining = [...failedIds, ...unknownIds];
            setSelectedConversationIds(new Set(remaining));
            setMergeOrderIds(remaining);
            setBatchNotice(resolvedLocale === "zh-CN"
              ? `标题修整完成 ${succeededIds.length} 项${failedIds.length ? `，明确失败 ${failedIds.length} 项` : ""}${unknownIds.length ? `，结果未确认 ${unknownIds.length} 项` : ""}${stopped ? "；已停止后续提交，请先核对未确认项。" : "。"}`
              : `Title cleanup completed ${succeededIds.length}${failedIds.length ? `, ${failedIds.length} definite failures` : ""}${unknownIds.length ? `, ${unknownIds.length} unconfirmed` : ""}${stopped ? "; later submissions were stopped—check unconfirmed items first." : "."}`);
            await refreshLists();
            setTitleTrimOpen(false);
            return { succeededIds, failedIds, unknownIds } satisfies BatchTitleTrimResult;
          } finally {
            if (isCurrentView()) setBulkBusy(null);
          }
        }}
      />
      {!listUnavailable && batchNotice ? <div ref={mergeResultRef} tabIndex={-1} className="rounded-md border border-ui bg-subtle px-3 py-2 text-xs text-secondary" role="status">{batchNotice}</div> : null}
      <BatchOperationFeedback progress={batchProgress} zh={zh} onStop={() => batchStop.current?.abort()} />
      {!listUnavailable ? batchCheck.surface : null}
      {content}
    </div>;
  }

  if (conversationsQuery.isLoading) {
    return withUndo(<StateBlock title={resolvedLocale === "zh-CN" ? "正在加载对话" : "Loading conversations"} detail={resolvedLocale === "zh-CN" ? "正在读取对话列表…" : "Fetching conversation list…"} loading />);
  }

  const retryConversations = <button type="button" onClick={() => void conversationsQuery.refetch()} disabled={conversationsQuery.isFetching}
    className="btn-secondary min-h-11 px-3 disabled:opacity-60">{zh ? "重试" : "Retry"}</button>;
  const readError = conversationsQuery.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-secondary">
    <span>{zh ? "对话更新失败，仍显示上次内容。" : "Could not update conversations. Previously loaded items are shown."}</span>
    {retryConversations}
  </div> : null;

  if (conversationsQuery.isError && conversations.length === 0) {
    return withUndo(
      <StateBlock
        title={resolvedLocale === "zh-CN" ? "对话加载失败" : "Failed to load conversations"}
        detail={listUnavailable
          ? (zh ? "当前账户无法访问此对话列表，请恢复访问后重试。" : "This conversation list is unavailable for your account. Restore access, then retry.")
          : (zh ? "暂时无法读取对话，请重试。" : "The conversation list is unavailable. Try again.")}
        error busy={conversationsQuery.isFetching} action={retryConversations}
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
    batchCheck.record(result);
    const remaining = [...result.failedIds, ...result.unconfirmedIds, ...result.notStartedIds];
    setSelectedConversationIds(new Set(remaining));
    setMergeOrderIds(remaining);
    setBatchNotice(resolvedLocale === "zh-CN"
      ? `已确认完成 ${result.succeededIds.length} 项，明确失败 ${result.failedIds.length} 项，结果未确认 ${result.unconfirmedIds.length} 项，未开始 ${result.notStartedIds.length} 项。未确认项请先刷新并核对当前状态，不要盲目重复提交。`
      : `${result.succeededIds.length} confirmed complete, ${result.failedIds.length} definite failures, ${result.unconfirmedIds.length} unconfirmed, ${result.notStartedIds.length} not started. Refresh and check current state before retrying unconfirmed items.`);
  }

  async function runBatch(ids: string[], operation: (id: string) => Promise<unknown>) {
    if (!isCurrentView() || listUnavailable || ids.some((id) => batchCheck.blockedIds.has(id)) || batchStop.current) return null;
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
  if (conversations.length === 0) {
    if (!isArchivedMode && globalExistenceQuery.isLoading) {
      return withUndo(
        <StateBlock
          title={resolvedLocale === "zh-CN" ? "正在加载对话" : "Loading conversations"}
          detail={zh ? "正在检查已保存的对话…" : "Checking saved conversations…"}
          loading
        />
      );
    }
    const shouldShowImportCta =
      !isArchivedMode
      && globalExistenceQuery.isSuccess
      && (globalExistenceQuery.data?.length ?? 0) === 0;
    const existenceFailed = !isArchivedMode && globalExistenceQuery.isError;
    return withUndo(
      <StateBlock
        title={
          isArchivedMode
            ? (resolvedLocale === "zh-CN" ? "暂无已归档对话" : "No archived conversations")
            : shouldShowImportCta
              ? (resolvedLocale === "zh-CN" ? "这里还没有对话" : "There are no conversations here yet")
              : (zh ? "暂无活动对话" : "No active conversations")
        }
        detail={
          isArchivedMode
            ? (resolvedLocale === "zh-CN" ? "归档的对话会保留在这里，恢复后回到原项目或对话记录。" : "Archived conversations return to their previous location when restored.")
            : shouldShowImportCta
              ? (resolvedLocale === "zh-CN" ? "导入对话，开始阅读。" : "Import a conversation to start reading.")
              : existenceFailed
                ? (zh ? "无法检查已保存的对话，请重试或查看归档。" : "Could not check saved conversations. Retry, or open the archive.")
                : (zh ? "已归档的对话仍会保留，可在归档中查看或恢复。" : "Archived conversations are kept in Archive, where they can be opened or restored.")
        }
        error={existenceFailed} busy={!isArchivedMode && globalExistenceQuery.isFetching}
        action={shouldShowImportCta ? (
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={onImportClick}
              className="rounded-lg bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--surface)] hover:opacity-90"
            >
              {resolvedLocale === "zh-CN" ? "导入对话" : "Import conversations"}
            </button>
            <QuickStartGuide onImport={onImportClick} />
          </div>
        ) : !isArchivedMode ? <div className="flex flex-wrap justify-center gap-2">
          {existenceFailed ? <button type="button" disabled={globalExistenceQuery.isFetching} onClick={() => void globalExistenceQuery.refetch()}
            className="btn-secondary min-h-11 px-3 disabled:opacity-60">{zh ? "重试" : "Retry"}</button> : null}
          <a href="/archived" className="btn-secondary inline-flex min-h-11 items-center px-3">{zh ? "查看归档" : "View archive"}</a>
        </div> : undefined}
      />
    );
  }

  return withUndo(
    <section className="space-y-3" aria-busy={conversationsQuery.isFetching}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-primary">
            {isArchivedMode ? (resolvedLocale === "zh-CN" ? "已归档对话" : "Archived conversations") : (resolvedLocale === "zh-CN" ? "对话记录" : "Conversation history")}
          </h2>
          {conversationsQuery.isFetching ? <span role="status" className="text-xs text-secondary">{resolvedLocale === "zh-CN" ? "正在更新" : "Updating"}</span> : null}
          <p className="text-sm text-secondary">{resolvedLocale === "zh-CN" ? `已加载 ${conversations.length} 个${conversationsQuery.hasNextPage ? "，仍有更多" : ""}` : `${conversations.length} loaded${conversationsQuery.hasNextPage ? ", more available" : ""}`}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ConversationSortMenu />
          <SelectionModeButton active={selectionMode} locale={resolvedLocale} onClick={selectionMode ? exitSelectionMode : () => setSelectionMode(true)} />
        </div>
      </div>
      {readError}
      {sortError ? <p role="alert" className="text-sm text-[var(--danger)]">{resolvedLocale === "zh-CN" ? "排序未保存，请检查当前列表范围后重试。" : "Order was not saved. Check the current list scope and retry."}</p> : null}
      {sortBoundaryNotice ? <p role="status" className="text-sm text-secondary">{zh ? "不能跨置顶优先级拖拽；置顶对话优先按置顶时间排序。可先取消置顶，再自定义排序。" : "Cannot drag across pin priorities; pinned conversations sort by pin time first. Unpin them before customizing their order."}</p> : null}
      {conversationSortMode === "custom" && conversationsQuery.hasNextPage && !customOrderTooLarge ? <p role="status" className="text-sm text-secondary">{resolvedLocale === "zh-CN" ? "自定义排序需要先加载全部对话，避免只对当前页面重排。" : "Load all conversations before custom drag ordering so a page cannot reorder only part of the list."}</p> : null}
      {customOrderTooLarge ? <p role="status" className="text-sm text-secondary">{resolvedLocale === "zh-CN" ? `当前范围超过 ${customOrderLimit} 个对话，已达到自定义排序的 API 上限，已停用拖拽。` : `This scope exceeds the ${customOrderLimit}-conversation custom-order API limit, so dragging is disabled.`}</p> : null}
      {batchExport.feedback}
      {selectionMode ? <SelectionToolbar
        loadedOnly={conversationsQuery.hasNextPage}
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
            selectedConversations={selectedMergeConversations}
            bulkBusy={bulkBusy}
            projects={(projectsQuery.data ?? []).filter((project) => !project.is_default && !project.is_archived)}
            exportOverLimit={batchExport.overLimit(selectedConversationIds.size)}
            unresolvedSelection={[...selectedConversationIds].some((id) => batchCheck.blockedIds.has(id))}
            onOpenMerge={() => setMergeOpen(true)}
            onOpenTitleTrim={() => {
              const snapshot = selectedMergeConversations.map((conversation) => ({ ...conversation }));
              setTitleTrimConversations(snapshot);
              setTitleTrimOpen(true);
            }}
            onMove={async (ids, projectId) => {
              if (bulkBusy !== null || batchStop.current || !isCurrentView()) return;
              setBulkBusy("move");
              try {
                const result = await runBatch(ids, (id) => moveConversationToProject(id, projectId));
                if (!result) return;
                applyBatchResult(result);
                await refreshLists();
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
            onArchive={async (ids) => {
              if (bulkBusy !== null || batchStop.current || !isCurrentView()) return;
              setBulkBusy("archive");
              try {
                const result = await runBatch(ids, archiveConversation);
                if (!result) return;
                applyBatchResult(result);
                if (result.succeededIds.length) setUndo(createConversationUndo(result.succeededIds, "active",
                  resolvedLocale === "zh-CN" ? `已归档 ${result.succeededIds.length} 个会话` : `${result.succeededIds.length} ${result.succeededIds.length === 1 ? "conversation" : "conversations"} archived`, refreshLists));
                await refreshLists();
              } finally {
                if (isCurrentView()) setBulkBusy(null);
              }
            }}
            onRestore={async (ids) => {
              if (bulkBusy !== null || batchStop.current || !isCurrentView()) return;
              setBulkBusy("restore");
              try {
                const result = await runBatch(ids, unarchiveConversation);
                if (!result) return;
                applyBatchResult(result);
                if (result.succeededIds.length) setUndo(createConversationUndo(result.succeededIds, "archived",
                  resolvedLocale === "zh-CN" ? `已恢复 ${result.succeededIds.length} 个会话` : `${result.succeededIds.length} ${result.succeededIds.length === 1 ? "conversation" : "conversations"} restored`, refreshLists));
                await refreshLists();
              } finally {
                if (isCurrentView()) setBulkBusy(null);
              }
            }}
            onDelete={async (ids) => {
              if (deleteFlight.current || bulkBusy !== null || batchStop.current || !isCurrentView()
                || ids.some((id) => batchCheck.blockedIds.has(id))) return;
              deleteFlight.current = true;
              // Freeze the visible order before confirmation, not after an
              // asynchronous list refresh or change of selection.
              const requested = new Set(ids);
              const orderedIds = conversations.map(item => item.id).filter(id => requested.has(id));
              setBulkBusy("delete");
              try {
                const task = await deletion.submit(orderedIds);
                if (!task || !isCurrentView()) return;
                applySelection([]);
                setSelectionMode(false);
                setBatchNotice(resolvedLocale === "zh-CN"
                  ? `已开始按顺序删除 ${orderedIds.length} 个对话；可在左侧任务区域查看进度并停止后续删除`
                  : `Deletion started for ${orderedIds.length} conversations in order. Track progress or stop pending items in the task area.`);
              } finally {
                deleteFlight.current = false;
                if (isCurrentView()) setBulkBusy(null);
              }
            }}
          />
      </SelectionToolbar> : null}
      <DndContext sensors={sortSensors} onDragStart={handleSortStart} onDragCancel={() => { setActiveSortId(null); setActiveSortSize(null); }} onDragEnd={(event) => { setActiveSortId(null); setActiveSortSize(null); void handleSortEnd(event); }}><SortableContext items={conversations.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="overflow-hidden rounded-xl border border-ui bg-surface">
        {conversations.map((conversation) => (
            <SortableConversationRow id={conversation.id} enabled={!selectionMode && conversationSortMode === "custom" && !customOrderTooLarge && !conversationsQuery.hasNextPage && !conversationsQuery.isFetching && !conversationsQuery.isError} key={conversation.id}><article
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
                {!selectionMode ? <ConversationActionMenu conversation={conversation} placement={placement} onChanged={refreshLists} onUndo={setUndo} /> : null}
              </div>
            </div>
          </article></SortableConversationRow>
        ))}
      </div></SortableContext>
      {conversationsQuery.hasNextPage ? <div className="flex justify-center pt-1"><button type="button" className="btn-secondary min-h-11 px-4" disabled={conversationsQuery.isFetching || bulkBusy !== null || isMerging} onClick={() => void conversationsQuery.fetchNextPage()}>{conversationsQuery.isFetchingNextPage ? (resolvedLocale === "zh-CN" ? "正在加载更多…" : "Loading more…") : conversationsQuery.isFetchNextPageError ? (zh ? "重试加载更多对话" : "Retry loading more conversations") : (resolvedLocale === "zh-CN" ? "加载更多对话" : "Load more conversations")}</button></div> : null}
      <DragOverlay adjustScale={false}>{activeSortId ? <div data-testid="conversation-list-drag-overlay" className="reader-drag-overlay px-4 py-3 text-sm font-semibold text-primary" style={activeSortSize ? { width: activeSortSize.width, height: activeSortSize.height } : undefined} aria-hidden="true"><p className="truncate">{conversations.find((item) => item.id === activeSortId)?.display_title || conversations.find((item) => item.id === activeSortId)?.title}</p><p className="mt-1 line-clamp-2 text-xs font-normal text-secondary">{conversations.find((item) => item.id === activeSortId)?.description_markdown || conversations.find((item) => item.id === activeSortId)?.first_user_message || ""}</p></div> : null}</DragOverlay></DndContext>
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
  return <div ref={sortable.setNodeRef} data-testid={`conversation-sortable-row-${id}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} data-state={sortable.isDragging ? "dragging" : "hover"} {...dragProps} className={`reader-interactive-row relative outline-none ${sortable.isDragging ? "cursor-grabbing" : "cursor-pointer"}`}>{children}</div>;
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
  bulkBusy,
  projects,
  onMove,
  onExport,
  onOpenMerge,
  onOpenTitleTrim,
  onArchive,
  onRestore,
  onDelete,
  exportOverLimit,
  unresolvedSelection,
}: {
  mode: "active" | "archived";
  selectedConversations: ConversationListItem[];
  bulkBusy: string | null;
  projects: ProjectRead[];
  onMove: (ids: string[], projectId: string | null) => Promise<void>;
  onExport: (conversations: ConversationListItem[]) => Promise<void>;
  onOpenMerge: () => void;
  onOpenTitleTrim: () => void;
  onArchive: (ids: string[]) => Promise<void>;
  onRestore: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  exportOverLimit: boolean;
  unresolvedSelection: boolean;
}) {
  const selectedIds = selectedConversations.map((conversation) => conversation.id);
  const isArchivedMode = mode === "archived";
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  return (
    <>
      <div className="selection-toolbar-action-group flex flex-wrap items-center gap-1.5">
        {mode === "active" ? <BulkMoveReview label="conversation" selectedIds={selectedIds} projects={projects} busy={bulkBusy !== null || unresolvedSelection} onMove={onMove} /> : null}
        <div className="flex flex-col">
          <button type="button" disabled={bulkBusy !== null || selectedIds.length === 0 || exportOverLimit || unresolvedSelection} onClick={() => void onExport(selectedConversations)} title={exportOverLimit ? (zh ? "单次最多导出 5000 个对话" : "A single export supports at most 5,000 conversations") : undefined} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-60">{bulkBusy === "export" ? (zh ? "正在导出" : "Exporting") : (zh ? "导出" : "Export")}</button>
          {exportOverLimit ? <span className="text-xs text-[var(--danger)]">{zh ? "单次最多 5000 项" : "Maximum 5,000 items"}</span> : null}
        </div>
        <button type="button" disabled={bulkBusy !== null || selectedIds.length === 0 || unresolvedSelection} onClick={onOpenTitleTrim} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-60">{zh ? "修整标题" : "Clean titles"}</button>
        {isArchivedMode ? (
          <button
            type="button"
            disabled={bulkBusy !== null || selectedIds.length === 0 || unresolvedSelection}
            onClick={() => void onRestore(selectedIds)}
            className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
          >
            {zh ? "恢复" : "Restore"}
          </button>
        ) : (
          <button
            type="button"
            disabled={bulkBusy !== null || selectedIds.length === 0 || unresolvedSelection}
            onClick={() => void onArchive(selectedIds)}
            className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60"
          >
            {zh ? "归档" : "Archive"}
          </button>
        )}
        {mode === "active" ? <button type="button" disabled={bulkBusy !== null || selectedIds.length < 2 || unresolvedSelection} onClick={onOpenMerge} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary disabled:opacity-40">{zh ? "合并对话" : "Merge"}</button> : null}
        <button type="button" disabled={bulkBusy !== null || selectedIds.length === 0 || unresolvedSelection} onClick={() => void onDelete(selectedIds)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40">{zh ? "删除所选" : "Delete selected"}</button>
      </div>
    </>
  );
}

function StateBlock({
  title,
  detail,
  action,
  loading = false,
  error = false,
  busy = false,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  loading?: boolean;
  error?: boolean;
  busy?: boolean;
}) {
  return (
    <section role={error ? "alert" : loading ? "status" : undefined} aria-busy={loading || busy}
      className="flex min-h-64 items-center justify-center rounded-xl border border-ui bg-surface p-8 text-center">
      <div>
        {loading ? <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-subtle" /> : null}
        <h2 className="text-base font-semibold text-primary">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{detail}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </section>
  );
}
