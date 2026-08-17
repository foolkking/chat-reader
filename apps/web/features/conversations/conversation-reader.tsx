"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, FileOutput, Focus, ListTree, Merge, MessageSquareText, MoreHorizontal, Paperclip, Pencil, RefreshCw, Scissors, Search, Share2, X } from "lucide-react";
import {
  deleteMessage,
  getTask,
  mergeMessages,
  restoreDeletedMessage,
  saveReadingPositionKeepalive,
} from "../../lib/api";
import { remoteReaderDataSource, type ReaderDataSource, type ReaderTargetContext } from "../../lib/reader-data-source";
import type { AttachmentRead, BackgroundTaskRead, ConversationDetail, LoadedMessageWindow, MessageListItem, NavigateTarget, NavigationResult, ReadingPositionInput, ReaderUtilityPanel, RenderBlockRead, ScrollAnchorSnapshot, ScrollDirection, TocItem, TocRefreshInput } from "../../lib/types";
import { ExportPanel } from "../exporting/export-panel";
import { OfflineExportPanel } from "../exporting/offline-export-panel";
import { MobileSidebarTrigger, ProjectSidebar } from "../projects/project-sidebar";
import { SharePanel } from "../sharing/share-panel";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc, resolveActiveHeadingId } from "../toc/conversation-toc";
import { ResponsiveReaderFrame } from "../../components/responsive-reader-frame";
import { usePreferences, useTranslations } from "../../components/preferences-provider";
import { MessageItem } from "./message-item";
import { MessageInsertDialog } from "./message-insert-dialog";
import { captureScrollAnchor, estimateCharacterOffsetAtReadingLine, navigateMountedTarget, restoreScrollAnchor } from "./reader-navigation";
import { resolveTextAnchorRange } from "./text-anchor";
import {
  emptyLoadedWindow,
  INITIAL_WINDOW_TURNS,
  loadCompleteTurnWindow as loadTurnNeighborhood,
  mergeLoadedTurnWindow,
  replaceLoadedWindow,
  trimLoadedTurnWindow,
  type CompleteTurnWindow,
} from "./reader-window";
import { ReaderHeaderActionRail, type ReaderHeaderAction } from "../../components/reader-header-action-rail";
import { MobileReaderSheet } from "../../components/mobile-reader-sheet";
import { ReaderPanelShell } from "../../components/reader-panel-shell";
import { useMobileHeaderAutoHide } from "./use-mobile-header-auto-hide";
import { ConversationSearchPanel, type ConversationSearchPanelState, type SearchNavigationContext, type SearchNavigationTarget } from "../search/conversation-search-panel";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { AnnotationWorkspace } from "../annotations/annotation-workspace";
import { ConversationSplitWorkspace } from "../editing/conversation-split-workspace";
import { offlineAnnotationRepository, remoteAnnotationRepository } from "../../lib/annotation-repository";
import { ResizableDockPanel } from "../../components/resizable-pane";
import { ReaderUtilityDrawer } from "../../components/reader-utility-drawer";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { acquireReaderBlockLease, notifyReaderMessageLayoutChanged, notifyReaderWindowLayoutChanged, type ReaderBlockLease } from "./block-virtualization";
import { SourceEditorWorkspace, type SourceEditorTarget } from "../editing/source-editor-workspace";
import { normalizedMessageBlocks, sourceOffsetForBlock } from "../editing/message-source-position";
import { ConversationFilesPanel } from "../attachments/conversation-files-panel";
import { OfflineConversationFilesPanel } from "../attachments/offline-conversation-files-panel";
import { FloatingWorkspacePanel } from "../../components/floating-workspace-panel";
import { resolveActiveReadingTarget } from "./reader-active-position";
import { TocRefreshDialog } from "../toc/toc-refresh-dialog";

const ACTIVE_READING_OFFSET = 120;
const APP_TITLE = "chat-reader";

export function ConversationReader({
  conversationId,
  dataSource = remoteReaderDataSource,
  libraryMode = false,
  onOpenLibrary,
  onFocusModeChange,
}: {
  conversationId: string;
  dataSource?: ReaderDataSource;
  libraryMode?: boolean;
  onOpenLibrary?: () => void;
  onFocusModeChange?: (active: boolean) => void;
}) {
  const t = useTranslations();
  const { readerDensityMode, readerFontSizePx, readerWidthMode, resolvedLocale } = usePreferences();
  const dialog = useInteractionDialog();
  const searchParams = useSearchParams();
  const projectContextId = searchParams?.get("projectId") ?? undefined;
  const queryClient = useQueryClient();
  const targetMessageId = searchParams?.get("messageId") ?? null;
  const targetBlockIndex = numberOrNull(searchParams?.get("blockIndex") ?? null);
  const targetCharacterOffset = numberOrNull(searchParams?.get("characterOffset") ?? null);
  const [loadedWindow, setLoadedWindow] = useState<LoadedMessageWindow>(() => emptyLoadedWindow());
  const messages = loadedWindow.items;
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showShare, setShowShare] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchPanelState, setSearchPanelState] = useState<ConversationSearchPanelState>({ query: "", documentType: "message", role: "all", activeIndex: 0 });
  const [searchNavigation, setSearchNavigation] = useState<SearchNavigationContext | null>(null);
    const [searchHighlight, setSearchHighlight] = useState<{ targetId: string; quote: string; start?: number; end?: number; prefix?: string; suffix?: string } | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [tocRefreshOpen, setTocRefreshOpen] = useState(false);
  const [tocRefreshTask, setTocRefreshTask] = useState<{ task: BackgroundTaskRead; input: TocRefreshInput } | null>(null);
  const filesPreferenceReadyRef = useRef(false);
  const recordedRecentConversationRef = useRef<string | null>(null);
  const [splitWorkspaceOpen, setSplitWorkspaceOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(searchParams?.get("annotations") === "open");
  const [focusMode, setFocusMode] = useState(false);
  const [desktopActionsExpanded, setDesktopActionsExpanded] = useState(false);
  const [mobileActionsExpanded, setMobileActionsExpanded] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<ReaderUtilityPanel>(null);
  const [navigationTab, setNavigationTab] = useState<"dialogue" | "sections">("dialogue");
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const [mobileNavigation, setMobileNavigation] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  const [showOfflineGuide, setShowOfflineGuide] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [sourceEditorTarget, setSourceEditorTarget] = useState<SourceEditorTarget | null>(null);
  const [pendingSourceEditorTarget, setPendingSourceEditorTarget] = useState<SourceEditorTarget | null>(null);
  const [sourceEditorDirty, setSourceEditorDirty] = useState(false);
  const [sourceRequestedCursorOffset, setSourceRequestedCursorOffset] = useState<number | undefined>(undefined);
  const [pendingSourceAttachment, setPendingSourceAttachment] = useState<{ referenceUri: string; displayName: string; image: boolean; placement: "inline" | "after_message" } | null>(null);
  const [messageInsertTarget, setMessageInsertTarget] = useState<MessageListItem | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<{
    message: MessageListItem;
    conversationRevision: number;
    status: "deleted" | "restoring" | "restore_failed";
    error?: string;
  } | null>(null);
  const desktopUtilityOpenerRef = useRef<HTMLElement | null>(null);
  const desktopUtilityPanelRef = useRef<"search" | "share" | "export" | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("chat-reader:conversation-files-open");
    if (saved === "true") setShowFiles(true);
    filesPreferenceReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!filesPreferenceReadyRef.current) return;
    window.localStorage.setItem("chat-reader:conversation-files-open", String(showFiles));
  }, [showFiles]);

  useEffect(() => {
    const active = tocRefreshTask?.task;
    if (!active || !["queued", "processing", "cancelling"].includes(active.status)) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const task = await getTask(active.job_id);
        if (cancelled) return;
        setTocRefreshTask((current) => current?.task.job_id === task.job_id ? { ...current, task } : current);
        if (task.status === "committed") {
          if (tocRefreshTask.input.refreshDialogueIndex) {
            await queryClient.invalidateQueries({ queryKey: ["conversation-index"] });
          }
          if (tocRefreshTask.input.refreshSectionToc) {
            await queryClient.invalidateQueries({ queryKey: ["toc"] });
          }
          window.setTimeout(() => setTocRefreshTask((current) => current?.task.job_id === task.job_id ? null : current), 6000);
        }
      } catch {
        if (!cancelled) {
          setTocRefreshTask((current) => current ? { ...current, task: { ...current.task, status: "failed", error_message: resolvedLocale === "zh-CN" ? "无法获取目录更新状态。" : "Unable to read refresh status." } } : current);
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [queryClient, resolvedLocale, tocRefreshTask?.input.refreshDialogueIndex, tocRefreshTask?.input.refreshSectionToc, tocRefreshTask?.task.job_id, tocRefreshTask?.task.status]);
  const [targetHighlightId, setTargetHighlightId] = useState<string | null>(null);
  const [navigationStatus, setNavigationStatus] = useState<"idle" | "loading" | "failed" | "stale">("idle");
  const [pendingTargetMessageId, setPendingTargetMessageId] = useState<string | null>(targetMessageId);
  const [initialPaintReady, setInitialPaintReady] = useState(false);
  const isOffline = dataSource.mode === "offline";
  const canManageCanonical = dataSource.capabilities.canonicalManagement;
  const canBrowseAttachments = dataSource.capabilities.attachments !== "none";
  const annotationRepository = isOffline ? offlineAnnotationRepository : remoteAnnotationRepository;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadPreviousSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingPreviousRef = useRef(false);
  const loadingNextRef = useRef(false);
  const edgeTransitionRef = useRef<"previous" | "next" | null>(null);
  const [edgeLoading, setEdgeLoading] = useState<"previous" | "next" | null>(null);
  const [edgeError, setEdgeError] = useState<"previous" | "next" | null>(null);
  const loadedWindowRef = useRef<LoadedMessageWindow>(emptyLoadedWindow());
  const windowGenerationRef = useRef(0);
  const initialWindowAppliedRef = useRef(false);
  const scrollDirectionRef = useRef<ScrollDirection>(null);
  const scrollIntentSequenceRef = useRef(0);
  const loadPreviousActionRef = useRef<() => void>(() => undefined);
  const loadNextActionRef = useRef<() => void>(() => undefined);
  const previousSentinelVisibleRef = useRef(false);
  const nextSentinelVisibleRef = useRef(false);
  const navigationTokenRef = useRef(0);
  const previousTurnAnchorRef = useRef<string | null>(null);
  const nextTurnAnchorRef = useRef<string | null>(null);
  const focusAnchorRef = useRef<ReturnType<typeof captureScrollAnchor>>(null);
  const focusTransitionRef = useRef(0);
  const preferenceAnchorRef = useRef<ReturnType<typeof captureScrollAnchor>>(null);
  const preferenceStableAnchorRef = useRef<{
    anchor: NonNullable<ReturnType<typeof captureScrollAnchor>>;
    capturedAt: number;
  } | null>(null);
  const preferenceTransitionRef = useRef(0);
  const preferenceBlockLeaseRef = useRef<Promise<ReaderBlockLease | null> | null>(null);
  const preferenceCompensationFrameRef = useRef<number | null>(null);
  const annotationTransitionRef = useRef(0);
  const annotationBlockLeaseRef = useRef<Promise<ReaderBlockLease | null> | null>(null);
  const annotationCompensationFrameRef = useRef<number | null>(null);
  const sourceFollowFrameRef = useRef<number | null>(null);
  const sourceFollowOffsetRef = useRef<number | null>(null);
  const readerMainSectionRef = useRef<HTMLElement | null>(null);
  const sourceEditorBaseLeftRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const anchor = preferenceAnchorRef.current;
    if (anchor) compensateScrollAnchorFrame(scrollContainerRef.current, anchor);
  }, [readerDensityMode, readerFontSizePx, readerWidthMode]);

  useEffect(() => {
    const currentDefault = window.localStorage.getItem("chat-reader:reader-default-focus");
    const legacyDefault = window.localStorage.getItem("chat-reader:reader-focus-mode");
    const migratedDefault = currentDefault ?? legacyDefault ?? "false";
    if (currentDefault === null) window.localStorage.setItem("chat-reader:reader-default-focus", migratedDefault);
    if (legacyDefault !== null) window.localStorage.removeItem("chat-reader:reader-focus-mode");
    setFocusMode(migratedDefault === "true");
    const onPreferenceChange = (event: Event) => setFocusMode(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("chat-reader:reader-default-focus-change", onPreferenceChange);
    return () => window.removeEventListener("chat-reader:reader-default-focus-change", onPreferenceChange);
  }, []);

  useEffect(() => {
    const token = focusTransitionRef.current + 1;
    focusTransitionRef.current = token;
    onFocusModeChange?.(focusMode);
    if (focusMode) {
      setUtilityPanel(null);
      setShowShare(false);
      setShowExport(false);
      setShowSearch(false);
      setAnnotationsOpen(false);
      setDesktopActionsExpanded(false);
      setMobileActionsExpanded(false);
    }
    const anchor = focusAnchorRef.current;
    if (!anchor) return;
    let active = true;
    const tokenIsCurrent = () => active && focusTransitionRef.current === token;
    void restoreFocusTransitionAnchor({
      root: scrollContainerRef.current,
      anchor,
      tokenIsCurrent,
    });
    return () => {
      active = false;
    };
  }, [focusMode, onFocusModeChange]);

  useEffect(() => {
    const capturePreferenceAnchor = () => {
      preferenceTransitionRef.current += 1;
      const token = preferenceTransitionRef.current;
      const root = scrollContainerRef.current;
      const captured = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
      const stable = preferenceStableAnchorRef.current;
      const stableTarget = stable ? document.getElementById(stable.anchor.targetId) : null;
      const reuseStableAnchor = Boolean(
        root &&
        stable &&
        stableTarget?.isConnected &&
        root.contains(stableTarget) &&
        window.performance.now() - stable.capturedAt < 30_000 &&
        focusAnchorError(root, stable.anchor) <= 64
      );
      const anchor = reuseStableAnchor ? stable!.anchor : captured;
      if (anchor) {
        preferenceStableAnchorRef.current = {
          anchor,
          capturedAt: window.performance.now(),
        };
      }
      preferenceAnchorRef.current = anchor;
      if (root) root.dataset.readerLayoutCompensating = "true";
      if (preferenceCompensationFrameRef.current !== null) {
        window.cancelAnimationFrame(preferenceCompensationFrameRef.current);
        preferenceCompensationFrameRef.current = null;
      }
      void preferenceBlockLeaseRef.current?.then((lease) => lease?.release());
      const blockTarget = anchor ? parseBlockTargetId(anchor.targetId) : null;
      preferenceBlockLeaseRef.current = blockTarget
        ? acquireReaderBlockLease(
            blockTarget.messageId,
            blockTarget.blockIndex,
            () => preferenceTransitionRef.current === token,
            900,
          )
        : null;
      if (anchor) {
        const compensate = () => {
          if (preferenceTransitionRef.current !== token) return;
          compensateScrollAnchorFrame(scrollContainerRef.current, anchor);
          preferenceCompensationFrameRef.current = window.requestAnimationFrame(compensate);
        };
        preferenceCompensationFrameRef.current = window.requestAnimationFrame(compensate);
      }
    };
    const restorePreferenceAnchor = () => {
      const anchor = preferenceAnchorRef.current;
      const token = preferenceTransitionRef.current;
      if (!anchor) return;
      const blockLease = preferenceBlockLeaseRef.current;
      void settlePreferenceLayoutAnchor({
        root: scrollContainerRef.current,
        anchor,
        tokenIsCurrent: () => preferenceTransitionRef.current === token,
      }).finally(() => {
        void blockLease?.then((lease) => lease?.release());
        if (preferenceTransitionRef.current === token) {
          preferenceAnchorRef.current = null;
          preferenceBlockLeaseRef.current = null;
          if (preferenceCompensationFrameRef.current !== null) {
            window.cancelAnimationFrame(preferenceCompensationFrameRef.current);
            preferenceCompensationFrameRef.current = null;
          }
          delete scrollContainerRef.current?.dataset.readerLayoutCompensating;
        }
      });
    };
    window.addEventListener("chat-reader:reader-layout-will-change", capturePreferenceAnchor);
    window.addEventListener("chat-reader:reader-layout-did-change", restorePreferenceAnchor);
    return () => {
      preferenceTransitionRef.current += 1;
      void preferenceBlockLeaseRef.current?.then((lease) => lease?.release());
      preferenceBlockLeaseRef.current = null;
      if (preferenceCompensationFrameRef.current !== null) {
        window.cancelAnimationFrame(preferenceCompensationFrameRef.current);
        preferenceCompensationFrameRef.current = null;
      }
      delete scrollContainerRef.current?.dataset.readerLayoutCompensating;
      window.removeEventListener("chat-reader:reader-layout-will-change", capturePreferenceAnchor);
      window.removeEventListener("chat-reader:reader-layout-did-change", restorePreferenceAnchor);
    };
  }, []);
  const restoreAttemptedRef = useRef(false);
  const restoreInProgressRef = useRef(false);
  const readingRestoreTokenRef = useRef(0);
  const lastSavedSignatureRef = useRef("");
  const latestStablePositionRef = useRef<ReadingPositionInput | null>(null);
  const messagesRef = useRef<MessageListItem[]>([]);
  const userScrollIntentRef = useRef(false);
  const lastReaderUserIntentAtRef = useRef(0);
  const navigationInProgressRef = useRef(false);
  const pointerDraggingRef = useRef(false);
  const pointerDragMovedRef = useRef(false);
  const pointerScrollTopRef = useRef(0);
  const activeMessageIdRef = useRef<string | null>(null);
  const activeBlockIdRef = useRef<string | null>(null);

  const mobileHeaderVisible = useMobileHeaderAutoHide({
    scrollRootRef: scrollContainerRef,
    forcedVisible: mobileActionsExpanded || utilityPanel !== null,
    resetKey: `${conversationId}:${navigationStatus}`,
  });

  useEffect(() => {
    activeMessageIdRef.current = activeMessageId;
  }, [activeMessageId]);

  useEffect(() => {
    activeBlockIdRef.current = activeBlockId;
  }, [activeBlockId]);

  useEffect(() => {
    if (isOffline) return;
    setShowOfflineGuide(window.localStorage.getItem("chat-reader:offline-guide-dismissed") !== "true");
  }, [isOffline]);

  const conversationQuery = useQuery({
    queryKey: ["conversation", dataSource.mode, conversationId],
    queryFn: () => dataSource.getConversation(conversationId),
  });

  useEffect(() => {
    const conversation = conversationQuery.data;
    document.title = conversation ? formatConversationTitle(conversation) : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [conversationQuery.data]);

  useEffect(() => {
    if (!conversationQuery.data || recordedRecentConversationRef.current === conversationId) return;
    recordedRecentConversationRef.current = conversationId;
    void dataSource.recordRecent(conversationId, projectContextId ?? null).then((canonicalConversation) => {
      if (canonicalConversation) {
        queryClient.setQueryData<ConversationDetail>(["conversation", dataSource.mode, conversationId], (current) => (
          current
            ? {
                ...current,
                offline_revision: canonicalConversation.offline_revision,
                last_read_at: canonicalConversation.last_read_at,
                reading_progress: canonicalConversation.reading_progress,
              }
            : current
        ));
      }
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    }).catch(() => {
      if (recordedRecentConversationRef.current === conversationId) recordedRecentConversationRef.current = null;
    });
  }, [conversationId, conversationQuery.data, dataSource, projectContextId, queryClient]);

  const positionQuery = useQuery({
    queryKey: ["reading-position", dataSource.mode, conversationId],
    queryFn: () => dataSource.getReadingPosition(conversationId),
  });

  const savedPosition = targetMessageId ? null : positionQuery.data?.position ?? null;
  const initialAnchorMessageId = targetMessageId ?? savedPosition?.message_id ?? null;
  const canLoadInitialWindow = Boolean(targetMessageId) || positionQuery.isSuccess || positionQuery.isError;

  const windowQuery = useQuery({
    queryKey: ["reader-turn-window", dataSource.mode, conversationId, conversationQuery.data?.offline_revision ?? "initial", initialAnchorMessageId],
    queryFn: () => loadCompleteTurnWindow(
      dataSource,
      conversationId,
      initialAnchorMessageId ?? undefined,
      INITIAL_WINDOW_TURNS,
    ),
    enabled: canLoadInitialWindow && conversationQuery.isSuccess,
  });

  const markReaderScrollIntent = useCallback((direction: ScrollDirection = null) => {
    const root = scrollContainerRef.current;
    userScrollIntentRef.current = true;
    scrollIntentSequenceRef.current += 1;
    lastReaderUserIntentAtRef.current = Date.now();
    preferenceStableAnchorRef.current = null;
    setPendingTargetMessageId(null);
    if (direction) {
      scrollDirectionRef.current = direction;
      if (root) root.dataset.readerIntentDirection = direction;
    }
    if (restoreInProgressRef.current) {
      readingRestoreTokenRef.current += 1;
      restoreInProgressRef.current = false;
    }
    if (navigationInProgressRef.current) {
      navigationTokenRef.current += 1;
      navigationInProgressRef.current = false;
      setNavigationStatus("idle");
    }
  }, []);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;
    let lastTouchY: number | null = null;
    const markWheelIntent = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const direction = event.deltaY < 0 ? "up" : "down";
      markReaderScrollIntent(direction);
      if (direction === "up" && previousSentinelVisibleRef.current) loadPreviousActionRef.current();
      if (direction === "down" && nextSentinelVisibleRef.current) loadNextActionRef.current();
    };
    const markTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
      markReaderScrollIntent();
    };
    const markTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined || lastTouchY === null || Math.abs(currentY - lastTouchY) <= 1) return;
      markReaderScrollIntent(currentY < lastTouchY ? "down" : "up");
      lastTouchY = currentY;
    };
    const markPointerDown = () => {
      pointerDraggingRef.current = true;
      pointerDragMovedRef.current = false;
      pointerScrollTopRef.current = root.scrollTop;
      root.dataset.readerPointerDragging = "true";
      // A native scrollbar-thumb drag can jump tens of thousands of pixels in
      // one frame. Rebase every mounted virtual message before the pointer
      // starts moving so a coordinate left stale by earlier row measurement
      // cannot select rows outside the visible message.
      notifyReaderWindowLayoutChanged();
    };
    const markPointerUp = () => {
      const moved = pointerDragMovedRef.current;
      pointerDraggingRef.current = false;
      pointerDragMovedRef.current = false;
      delete root.dataset.readerPointerDragging;
      if (!moved || edgeTransitionRef.current || loadingPreviousRef.current || loadingNextRef.current) return;
      if (scrollDirectionRef.current === "up" && previousSentinelVisibleRef.current) {
        loadPreviousActionRef.current();
      } else if (scrollDirectionRef.current === "down" && nextSentinelVisibleRef.current) {
        loadNextActionRef.current();
      }
    };
    const markKeyboardIntent = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-testid='floating-source-workspace'], input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
      const key = event.key.toLowerCase();
      if (!["arrowup", "arrowdown", "pageup", "pagedown", "home", "end", " ", "j", "k"].includes(key)) return;
      markReaderScrollIntent(["arrowup", "pageup", "home", "k"].includes(key) ? "up" : "down");
    };
    root.addEventListener("wheel", markWheelIntent, { passive: true });
    root.addEventListener("touchstart", markTouchStart, { passive: true });
    root.addEventListener("touchmove", markTouchMove, { passive: true });
    root.addEventListener("pointerdown", markPointerDown, { passive: true });
    window.addEventListener("pointerup", markPointerUp, { passive: true });
    window.addEventListener("pointercancel", markPointerUp, { passive: true });
    window.addEventListener("keydown", markKeyboardIntent);
    return () => {
      root.removeEventListener("wheel", markWheelIntent);
      root.removeEventListener("touchstart", markTouchStart);
      root.removeEventListener("touchmove", markTouchMove);
      root.removeEventListener("pointerdown", markPointerDown);
      window.removeEventListener("pointerup", markPointerUp);
      window.removeEventListener("pointercancel", markPointerUp);
      window.removeEventListener("keydown", markKeyboardIntent);
      delete root.dataset.readerPointerDragging;
    };
  }, [initialPaintReady, markReaderScrollIntent]);

  const hasPrevious = loadedWindow.hasPrevious;
  const hasMore = loadedWindow.hasMore;
  const total = loadedWindow.total || windowQuery.data?.total || messages.length;

  useEffect(() => {
    windowGenerationRef.current += 1;
    navigationTokenRef.current += 1;
    const emptyWindow = emptyLoadedWindow(windowGenerationRef.current);
    loadedWindowRef.current = emptyWindow;
    setLoadedWindow(emptyWindow);
    initialWindowAppliedRef.current = false;
    loadingPreviousRef.current = false;
    loadingNextRef.current = false;
    edgeTransitionRef.current = null;
    setEdgeLoading(null);
    setEdgeError(null);
    previousTurnAnchorRef.current = null;
    nextTurnAnchorRef.current = null;
    setActiveMessageId(targetMessageId);
    setActiveBlockId(null);
    setNavigationStatus("idle");
    navigationInProgressRef.current = false;
    setSelectedMessageIds(new Set());
    if (sourceEditorTarget) {
      window.dispatchEvent(new Event("chat-reader:reader-layout-will-change"));
      window.requestAnimationFrame(() => window.dispatchEvent(new Event("chat-reader:reader-layout-did-change")));
    }
    sourceEditorBaseLeftRef.current = null;
    setSourceEditorTarget(null);
    setPendingSourceEditorTarget(null);
    setSourceEditorDirty(false);
    setPendingTargetMessageId(targetMessageId);
    userScrollIntentRef.current = false;
    scrollDirectionRef.current = null;
    scrollIntentSequenceRef.current += 1;
    setInitialPaintReady(false);
    restoreAttemptedRef.current = false;
    restoreInProgressRef.current = false;
    readingRestoreTokenRef.current += 1;
    lastSavedSignatureRef.current = "";
    preferenceStableAnchorRef.current = null;
  }, [conversationId, targetMessageId]);

  useEffect(() => {
    messagesRef.current = messages;
    pruneMessageState(messages.map((message) => message.id));
  }, [messages]);

  useEffect(() => {
    if (!targetMessageId && savedPosition?.message_id) {
      setActiveMessageId(savedPosition.message_id);
    }
  }, [savedPosition?.message_id, targetMessageId]);

  useEffect(() => {
    if (!conversationQuery.isSuccess || !windowQuery.isSuccess) return;
    const frame = window.requestAnimationFrame(() => setInitialPaintReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [conversationQuery.isSuccess, windowQuery.isSuccess]);

  useEffect(() => {
    if (!windowQuery.isSuccess || initialWindowAppliedRef.current) return;
    initialWindowAppliedRef.current = true;
    previousTurnAnchorRef.current = windowQuery.data.previousTurnAnchorMessageId ?? null;
    nextTurnAnchorRef.current = windowQuery.data.nextTurnAnchorMessageId ?? null;
    const next = replaceLoadedWindow(windowQuery.data, windowGenerationRef.current);
    loadedWindowRef.current = next;
    setLoadedWindow(next);
  }, [windowQuery.data, windowQuery.isSuccess]);

  const applyLoadedWindow = useCallback((next: LoadedMessageWindow) => {
    loadedWindowRef.current = next;
    setLoadedWindow(next);
  }, []);

  const loadPreviousWindow = useCallback(async () => {
    const root = scrollContainerRef.current;
    const current = loadedWindowRef.current;
    const previousAnchor = previousTurnAnchorRef.current;
    if (!root || navigationInProgressRef.current || edgeTransitionRef.current || loadingPreviousRef.current || !current.hasPrevious || !previousAnchor) return;
    loadingPreviousRef.current = true;
    edgeTransitionRef.current = "previous";
    setReaderEdgeStage(root, "previous:loading");
    setEdgeLoading("previous");
    setEdgeError(null);
    const generation = current.generation;
    let anchorLease: ReaderBlockLease | null = null;
    const transitionIsCurrent = () => (
      loadedWindowRef.current.generation === generation &&
      edgeTransitionRef.current === "previous" &&
      scrollDirectionRef.current !== "down"
    );
    try {
      const page = await loadCompleteTurnWindow(dataSource, conversationId, previousAnchor);
      if (!transitionIsCurrent()) {
        setReaderEdgeStage(root, `previous:cancelled:${edgeCancellationReason(loadedWindowRef.current, generation, edgeTransitionRef.current, scrollDirectionRef.current, "previous")}`);
        return;
      }
      const anchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
      if (anchor) {
        anchorLease = await acquireScrollAnchorLease(anchor, transitionIsCurrent);
        if (!anchorLease) {
          if (!transitionIsCurrent()) return;
          throw new Error("The previous-window reading anchor could not be pinned.");
        }
      }
      const currentIds = new Set(current.items.map((message) => message.id));
      const next = mergeLoadedTurnWindow(current, page);
      syncTurnAnchorRefs(next, previousTurnAnchorRef, nextTurnAnchorRef);
      setReaderEdgeStage(root, "previous:committing");
      applyLoadedWindow(next);
      const firstAddedMessageId = page.items.findLast((message) => !currentIds.has(message.id))?.id;
      if (firstAddedMessageId && !await waitForMountedMessage(firstAddedMessageId, transitionIsCurrent)) {
        setReaderEdgeStage(root, `previous:mount-cancelled:${edgeCancellationReason(loadedWindowRef.current, generation, edgeTransitionRef.current, scrollDirectionRef.current, "previous")}`);
        return;
      }
      setReaderEdgeStage(root, "previous:mounted");
      notifyReaderWindowLayoutChanged();
      const restored = anchor
        ? await restoreScrollAnchor({
          root,
          anchor,
          tokenIsCurrent: transitionIsCurrent,
        })
        : false;
      if (anchor && restored && transitionIsCurrent()) {
        const protectedMessageId = messageIdForScrollAnchor(anchor);
        const trimmed = trimLoadedTurnWindow(loadedWindowRef.current, "previous", protectedMessageId);
        if (trimmed !== loadedWindowRef.current) {
          setReaderEdgeStage(root, "previous:trimming");
          applyLoadedWindow(trimmed);
          syncTurnAnchorRefs(trimmed, previousTurnAnchorRef, nextTurnAnchorRef);
          if (protectedMessageId) await waitForMountedMessage(protectedMessageId, transitionIsCurrent);
          notifyReaderWindowLayoutChanged();
          await restoreScrollAnchor({ root, anchor, tokenIsCurrent: transitionIsCurrent });
        }
      }
      setReaderEdgeStage(root, "previous:settled");
    } catch {
      setReaderEdgeStage(root, "previous:failed");
      if (loadedWindowRef.current.generation === generation) setEdgeError("previous");
    } finally {
      anchorLease?.release();
      loadingPreviousRef.current = false;
      if (edgeTransitionRef.current === "previous") edgeTransitionRef.current = null;
      setEdgeLoading((currentLoading) => currentLoading === "previous" ? null : currentLoading);
    }
  }, [applyLoadedWindow, conversationId, dataSource]);

  const loadNextWindow = useCallback(async () => {
    const root = scrollContainerRef.current;
    const current = loadedWindowRef.current;
    const nextAnchor = nextTurnAnchorRef.current;
    if (!root || navigationInProgressRef.current || edgeTransitionRef.current || loadingNextRef.current || !current.hasMore || !nextAnchor) return;
    loadingNextRef.current = true;
    edgeTransitionRef.current = "next";
    setReaderEdgeStage(root, "next:loading");
    setEdgeLoading("next");
    setEdgeError(null);
    const generation = current.generation;
    let anchorLease: ReaderBlockLease | null = null;
    const transitionIsCurrent = () => (
      loadedWindowRef.current.generation === generation &&
      edgeTransitionRef.current === "next" &&
      scrollDirectionRef.current !== "up"
    );
    try {
      const page = await loadCompleteTurnWindow(dataSource, conversationId, nextAnchor);
      if (!transitionIsCurrent()) {
        setReaderEdgeStage(root, `next:cancelled:${edgeCancellationReason(loadedWindowRef.current, generation, edgeTransitionRef.current, scrollDirectionRef.current, "next")}`);
        return;
      }
      const anchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
      if (anchor) {
        anchorLease = await acquireScrollAnchorLease(anchor, transitionIsCurrent);
        if (!anchorLease) {
          if (!transitionIsCurrent()) return;
          throw new Error("The next-window reading anchor could not be pinned.");
        }
      }
      const currentIds = new Set(current.items.map((message) => message.id));
      const next = mergeLoadedTurnWindow(current, page);
      syncTurnAnchorRefs(next, previousTurnAnchorRef, nextTurnAnchorRef);
      setReaderEdgeStage(root, "next:committing");
      applyLoadedWindow(next);
      const firstAddedMessageId = page.items.find((message) => !currentIds.has(message.id))?.id;
      if (firstAddedMessageId && !await waitForMountedMessage(firstAddedMessageId, transitionIsCurrent)) {
        setReaderEdgeStage(root, `next:mount-cancelled:${edgeCancellationReason(loadedWindowRef.current, generation, edgeTransitionRef.current, scrollDirectionRef.current, "next")}`);
        return;
      }
      setReaderEdgeStage(root, "next:mounted");
      notifyReaderWindowLayoutChanged();
      const restored = anchor
        ? await restoreScrollAnchor({
          root,
          anchor,
          tokenIsCurrent: transitionIsCurrent,
        })
        : false;
      if (anchor && restored && transitionIsCurrent()) {
        const protectedMessageId = messageIdForScrollAnchor(anchor);
        const trimmed = trimLoadedTurnWindow(loadedWindowRef.current, "next", protectedMessageId);
        if (trimmed !== loadedWindowRef.current) {
          setReaderEdgeStage(root, "next:trimming");
          applyLoadedWindow(trimmed);
          syncTurnAnchorRefs(trimmed, previousTurnAnchorRef, nextTurnAnchorRef);
          if (protectedMessageId) await waitForMountedMessage(protectedMessageId, transitionIsCurrent);
          notifyReaderWindowLayoutChanged();
          await restoreScrollAnchor({ root, anchor, tokenIsCurrent: transitionIsCurrent });
        }
      }
      setReaderEdgeStage(root, "next:settled");
    } catch {
      setReaderEdgeStage(root, "next:failed");
      if (loadedWindowRef.current.generation === generation) setEdgeError("next");
    } finally {
      anchorLease?.release();
      loadingNextRef.current = false;
      if (edgeTransitionRef.current === "next") edgeTransitionRef.current = null;
      setEdgeLoading((currentLoading) => currentLoading === "next" ? null : currentLoading);
    }
  }, [applyLoadedWindow, conversationId, dataSource]);

  loadPreviousActionRef.current = () => { void loadPreviousWindow(); };
  loadNextActionRef.current = () => { void loadNextWindow(); };

  const navigateToTarget = useCallback(
    async (target: NavigateTarget): Promise<NavigationResult> => {
      const { messageId, blockIndex, characterOffset, endCharacterOffset, quote, prefix, suffix, alignmentOffset, allowMessageFallback } = target;
      const targetFirst = target.source === "annotation" || target.preferTocPipeline || characterOffset !== undefined;
      const resolvedAlignmentOffset = alignmentOffset ?? (targetFirst ? ACTIVE_READING_OFFSET : 12);
      const token = navigationTokenRef.current + 1;
      navigationTokenRef.current = token;
      navigationInProgressRef.current = true;
      if (targetFirst) {
        restoreAttemptedRef.current = true;
        readingRestoreTokenRef.current += 1;
      }
      setNavigationStatus("loading");
      const generation = windowGenerationRef.current + 1;
      windowGenerationRef.current = generation;
      applyLoadedWindow({ ...loadedWindowRef.current, generation });
      userScrollIntentRef.current = false;
      scrollDirectionRef.current = null;
      scrollIntentSequenceRef.current += 1;
      const blockId = blockIndex === undefined ? null : `block-${messageId}-${blockIndex}`;
      const messageIdDom = `message-${messageId}`;
      setActiveMessageId(messageId);
      setActiveBlockId(blockId);
      setTargetHighlightId(blockId ?? messageIdDom);
      setNavigationStage(scrollContainerRef.current, targetFirst ? "loading-target-context" : "loading-window");
      let blockLease: ReaderBlockLease | null = null;

      try {
        let targetPage: CompleteTurnWindow | null = null;
        let knownMessage: MessageListItem | undefined;

        if (targetFirst) {
          let targetContext: ReaderTargetContext;
          let completeWindow: CompleteTurnWindow;
          try {
            [targetContext, completeWindow] = await Promise.all([
              dataSource.getTargetContext(conversationId, target),
              loadCompleteTurnWindow(dataSource, conversationId, messageId),
            ]);
          } catch {
            if (navigationTokenRef.current === token) setNavigationStatus("failed");
            return { ok: false, targetId: blockId ?? messageIdDom, reason: "target-context-failed" };
          }
          if (navigationTokenRef.current !== token) {
            return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
          }
          targetPage = completeWindow;
          previousTurnAnchorRef.current = completeWindow.previousTurnAnchorMessageId;
          nextTurnAnchorRef.current = completeWindow.nextTurnAnchorMessageId;
          knownMessage = completeWindow.items.find((message) => message.id === messageId) ?? targetContext.targetMessage;
          setNavigationStage(scrollContainerRef.current, "target-context-ready");
          const sourceKey = readerCacheIdentity(dataSource, conversationQuery.data);
          for (const mode of ["rail", "sheet"] as const) {
            queryClient.setQueryData(["conversation-index", sourceKey, conversationId, messageId, mode], targetContext.dialogueIndex);
            queryClient.setQueryData(["toc", sourceKey, conversationId, messageId, mode], targetContext.toc);
          }
        } else if (!loadedWindowRef.current.items.some((message) => message.id === messageId)) {
          const page = await loadCompleteTurnWindow(dataSource, conversationId, messageId);
          if (navigationTokenRef.current !== token) {
            return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
          }
          targetPage = page;
          previousTurnAnchorRef.current = page.previousTurnAnchorMessageId;
          nextTurnAnchorRef.current = page.nextTurnAnchorMessageId;
        }

        knownMessage = knownMessage ?? targetPage?.items.find((message) => message.id === messageId) ??
          loadedWindowRef.current.items.find((message) => message.id === messageId);
        if (!knownMessage) {
          knownMessage = (await dataSource.getReaderTurn(conversationId, messageId)).items.find((message) => message.id === messageId);
        }
        if (!knownMessage) {
          setNavigationStatus("failed");
          return { ok: false, targetId: blockId ?? messageIdDom, reason: "target-not-mounted" };
        }

        if (navigationTokenRef.current !== token) {
          return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
        }

        if (targetPage) {
          initialWindowAppliedRef.current = true;
          const root = scrollContainerRef.current;
          if (root) {
            root.scrollTop = 0;
            root.dataset.previousScrollTop = "0";
          }
          applyLoadedWindow(replaceLoadedWindow(targetPage, generation));
          setNavigationStage(scrollContainerRef.current, "target-window-committed");
        }

        const resolvedTargetId = blockId ?? messageIdDom;
        if (blockIndex !== undefined) {
          blockLease = await acquireReaderBlockLease(
            messageId,
            blockIndex,
            () => navigationTokenRef.current === token,
          );
        }
        setNavigationStage(scrollContainerRef.current, `aligning:${resolvedTargetId}`);
        const mountedResult = await navigateMountedTarget({
          root: scrollContainerRef.current,
          targetId: resolvedTargetId,
          fallbackId: resolvedTargetId === blockId ? messageIdDom : undefined,
          tokenIsCurrent: () => navigationTokenRef.current === token,
          offset: resolvedAlignmentOffset,
          characterOffset: resolvedTargetId === blockId ? characterOffset : undefined,
          endCharacterOffset: resolvedTargetId === blockId ? endCharacterOffset : undefined,
          quote: resolvedTargetId === blockId ? quote : null,
          prefix: resolvedTargetId === blockId ? prefix : null,
          suffix: resolvedTargetId === blockId ? suffix : null,
          timeoutMs: 8000,
          allowFallback: allowMessageFallback ?? Boolean(quote || characterOffset !== undefined),
        });
        if (navigationTokenRef.current !== token) {
          return { ok: false, targetId: mountedResult.targetId, reason: "cancelled" };
        }
        const result: NavigationResult = mountedResult;
        setNavigationStage(scrollContainerRef.current, result.ok ? "resolved" : `failed:${result.reason ?? "unknown"}`);
        if (result.ok) {
          setNavigationStatus(result.fallback ? "stale" : "idle");
          setActiveMessageId(messageId);
          setActiveBlockId(blockId);
          const root = scrollContainerRef.current;
          const stableAnchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET) ?? {
            targetId: result.targetId,
            offset: resolvedAlignmentOffset,
          };
          await restoreScrollAnchor({
            root,
            anchor: stableAnchor,
            tokenIsCurrent: () => navigationTokenRef.current === token && !userScrollIntentRef.current,
            minimumMs: targetFirst ? 1400 : 700,
            settleMs: targetFirst ? 360 : 220,
            timeoutMs: targetFirst ? 5000 : 2800,
          });
          if (navigationTokenRef.current !== token) {
            return { ok: false, targetId: result.targetId, reason: "cancelled" };
          }
          setNavigationStage(root, result.fallback ? "settled:fallback" : "settled");
          if (target.source !== "search") {
            window.setTimeout(() => {
              if (navigationTokenRef.current === token) {
                setTargetHighlightId(null);
                setNavigationStatus("idle");
              }
            }, 2000);
          }
        } else {
          setNavigationStatus("failed");
        }
        return result;
      } catch {
        setNavigationStage(scrollContainerRef.current, "failed:load-failed");
        setNavigationStatus("failed");
        return { ok: false, targetId: blockId ?? messageIdDom, reason: "load-failed" };
      } finally {
        blockLease?.release();
        if (navigationTokenRef.current === token) {
          navigationInProgressRef.current = false;
        }
      }
    },
    [applyLoadedWindow, conversationId, conversationQuery.data, dataSource, queryClient],
  );

  const handleSearchNavigate = useCallback(async (
    target: SearchNavigationTarget,
    context: SearchNavigationContext,
  ): Promise<NavigationResult> => {
    const result = await navigateToTarget({
      messageId: target.messageId,
      blockIndex: target.blockIndex,
      characterOffset: target.characterOffset,
      endCharacterOffset: target.endCharacterOffset,
      quote: target.quote,
      prefix: target.prefix,
      suffix: target.suffix,
      source: "search",
    });
    if (result.ok) {
      setSearchNavigation(context);
      setSearchHighlight({ targetId: result.targetId, quote: target.quote ?? "", start: target.characterOffset, end: target.endCharacterOffset, prefix: target.prefix, suffix: target.suffix });
    }
    return result;
  }, [navigateToTarget]);

  const navigateSearchResult = useCallback(async (index: number) => {
    const context = searchNavigation;
    const target = context?.targets[index];
    if (!context || !target) return;
    const result = await navigateToTarget({
      messageId: target.messageId,
      blockIndex: target.blockIndex,
      characterOffset: target.characterOffset,
      endCharacterOffset: target.endCharacterOffset,
      quote: target.quote,
      prefix: target.prefix,
      suffix: target.suffix,
      source: "search",
    });
    if (result.ok) {
      setSearchNavigation({ ...context, index });
        setSearchHighlight({ targetId: result.targetId, quote: target.quote ?? "", start: target.characterOffset, end: target.endCharacterOffset, prefix: target.prefix, suffix: target.suffix });
    }
  }, [navigateToTarget, searchNavigation]);

  useEffect(() => applySearchHighlight(searchHighlight), [searchHighlight]);

  useEffect(() => {
    const handleReadingShortcut = (event: KeyboardEvent) => {
      if (utilityPanel !== null || isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const root = scrollContainerRef.current;
      if (!root) return;
      const page = Math.max(120, root.clientHeight * 0.88);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        root.scrollBy({ top: event.key === "ArrowDown" ? 56 : -56, behavior: "smooth" });
      } else if (event.key === " " || event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        const up = event.shiftKey || event.key === "PageUp";
        root.scrollBy({ top: up ? -page : page, behavior: "smooth" });
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        root.scrollTo({ top: event.key === "Home" ? 0 : root.scrollHeight, behavior: "smooth" });
      } else if (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k") {
        const current = messages.findIndex((message) => message.id === activeMessageId);
        const next = event.key.toLowerCase() === "j" ? current + 1 : current - 1;
        const target = messages[next];
        if (target) {
          event.preventDefault();
          void navigateToTarget({ messageId: target.id, source: "message-action" });
        }
      }
    };
    window.addEventListener("keydown", handleReadingShortcut);
    return () => window.removeEventListener("keydown", handleReadingShortcut);
  }, [activeMessageId, messages, navigateToTarget, utilityPanel]);

  const refreshActiveMessageFromLayout = useCallback(() => {
    const root = scrollContainerRef.current;
    const target = resolveActiveReadingTarget(root, ACTIVE_READING_OFFSET);
    if (!target?.messageId) return;
    const messageChanged = activeMessageIdRef.current !== target.messageId;
    const blockChanged = activeBlockIdRef.current !== target.blockId;
    if (!messageChanged && !blockChanged) return;
    activeMessageIdRef.current = target.messageId;
    activeBlockIdRef.current = target.blockId;
    startTransition(() => {
      if (messageChanged) setActiveMessageId(target.messageId);
      if (blockChanged) setActiveBlockId(target.blockId);
    });
  }, []);

  useEffect(() => {
    const messageId = pendingTargetMessageId ?? targetMessageId;
    if (!messageId) {
      return;
    }
    void navigateToTarget({
      messageId,
      blockIndex: targetBlockIndex ?? undefined,
      characterOffset: targetCharacterOffset ?? undefined,
      source: "search",
    }).finally(() => {
      restoreAttemptedRef.current = true;
      setPendingTargetMessageId(null);
    });
  }, [navigateToTarget, pendingTargetMessageId, targetBlockIndex, targetCharacterOffset, targetMessageId]);

  useEffect(() => {
    if (!targetMessageId && positionQuery.isError && windowQuery.isSuccess) {
      restoreAttemptedRef.current = true;
      return;
    }
    if (
      targetMessageId ||
      restoreAttemptedRef.current ||
      !positionQuery.isSuccess ||
      !windowQuery.isSuccess
    ) {
      return;
    }
    restoreAttemptedRef.current = true;
    const position = positionQuery.data.position;
    if (!position) {
      return;
    }
    restoreInProgressRef.current = true;
    const restoreToken = readingRestoreTokenRef.current + 1;
    readingRestoreTokenRef.current = restoreToken;
    const anchor = position.anchor_data ?? {};
    const headingBlockIndex = numberOrNull(anchor.heading_block_index);
    const anchorBlockId = typeof anchor.block_id === "string" ? anchor.block_id : null;
    const orderKey = typeof anchor.order_key === "string" ? anchor.order_key : null;
    const restoreMessage = loadedWindowRef.current.items.find((message) => message.id === position.message_id) ??
      loadedWindowRef.current.items.find((message) => orderKey !== null && message.order_key === orderKey);
    const restoreMessageId = restoreMessage?.id ?? position.message_id;
    if (!restoreMessageId) return;
    const blockIdIndex = findBlockIndexById(restoreMessage, anchorBlockId);
    const blockIndex = position.block_index;
    const isBlockRelative = anchor.position_mode === "block-relative-v1" || anchor.position_mode === "block-relative-v2";
    const blockOffset = numberOrNull(anchor.block_offset) ?? position.scroll_offset;
    const savedCharacterOffset = numberOrNull(anchor.character_offset);
    const scrollRatio = numberOrNull(anchor.scroll_ratio);
    const blockCandidates = [blockIdIndex, blockIndex, headingBlockIndex].filter(
      (value): value is number => value !== null,
    );
    const candidates: Array<number | undefined> = blockCandidates.filter(
      (value, index, values) => values.indexOf(value) === index,
    );
    candidates.push(undefined);
    void (async () => {
      for (const candidate of candidates) {
        if (readingRestoreTokenRef.current !== restoreToken) return;
        const useCharacterAnchor = candidate !== undefined && savedCharacterOffset !== null &&
          candidate === (blockIdIndex ?? blockIndex ?? headingBlockIndex);
        const alignmentOffset = candidate === undefined
          ? ACTIVE_READING_OFFSET
          : useCharacterAnchor
            ? ACTIVE_READING_OFFSET
            : ACTIVE_READING_OFFSET - (isBlockRelative ? blockOffset : 0);
        const result = await navigateToTarget({
          messageId: restoreMessageId,
          blockIndex: candidate,
          characterOffset: useCharacterAnchor ? savedCharacterOffset : undefined,
          alignmentOffset,
          source: "message-action",
        });
        if (readingRestoreTokenRef.current !== restoreToken) return;
        if (result.ok) {
          return;
        }
      }
      const root = scrollContainerRef.current;
      if (root && scrollRatio !== null) {
        root.scrollTop = Math.max(0, (root.scrollHeight - root.clientHeight) * Math.min(1, Math.max(0, scrollRatio)));
      }
    })().finally(() => {
      if (readingRestoreTokenRef.current === restoreToken) {
        restoreInProgressRef.current = false;
      }
    });
  }, [navigateToTarget, positionQuery.data, positionQuery.isError, positionQuery.isSuccess, targetMessageId, windowQuery.isSuccess]);

  useEffect(() => {
    const sentinel = loadPreviousSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || messages.length === 0 || !hasPrevious) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        previousSentinelVisibleRef.current = entries.some((entry) => entry.isIntersecting);
        if (
          userScrollIntentRef.current &&
          !pointerDraggingRef.current &&
          edgeTransitionRef.current === null &&
          !loadingPreviousRef.current &&
          !loadingNextRef.current &&
          scrollDirectionRef.current === "up" &&
          entries.some((entry) => entry.isIntersecting)
        ) void loadPreviousWindow();
      },
      { root, rootMargin: "45% 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => {
      previousSentinelVisibleRef.current = false;
      observer.disconnect();
    };
  }, [hasPrevious, loadPreviousWindow, messages.length]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasMore) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        nextSentinelVisibleRef.current = entries.some((entry) => entry.isIntersecting);
        if (
          userScrollIntentRef.current &&
          !pointerDraggingRef.current &&
          edgeTransitionRef.current === null &&
          !loadingPreviousRef.current &&
          !loadingNextRef.current &&
          scrollDirectionRef.current === "down" &&
          entries.some((entry) => entry.isIntersecting)
        ) void loadNextWindow();
      },
      { root, rootMargin: "45% 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => {
      nextSentinelVisibleRef.current = false;
      observer.disconnect();
    };
  }, [hasMore, loadNextWindow]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) {
      return undefined;
    }

    let sampleFrame = 0;
    let sampleTimer: number | null = null;
    let persistTimer: number | null = null;
    let lastSampleAt = 0;
    let lastScrollAt = 0;

    const runActiveSample = () => {
      sampleFrame = 0;
      lastSampleAt = window.performance.now();
      refreshActiveMessageFromLayout();
    };
    const scheduleActiveSample = (immediate = false) => {
      if (sampleFrame || sampleTimer !== null) return;
      const elapsed = window.performance.now() - lastSampleAt;
      const wait = immediate ? 0 : Math.max(0, 80 - elapsed);
      const queueFrame = () => {
        sampleTimer = null;
        sampleFrame = window.requestAnimationFrame(runActiveSample);
      };
      if (wait > 0) sampleTimer = window.setTimeout(queueFrame, wait);
      else queueFrame();
    };

    const persist = () => {
      if (
        !restoreAttemptedRef.current ||
        restoreInProgressRef.current ||
        navigationInProgressRef.current
      ) {
        return;
      }
      const payload = captureReadingPosition(root, messagesRef.current, loadedWindowRef.current.total);
      if (!payload) {
        return;
      }
      const signature = JSON.stringify(payload);
      if (signature === lastSavedSignatureRef.current) {
        return;
      }
      lastSavedSignatureRef.current = signature;
      latestStablePositionRef.current = payload;
      void dataSource.saveReadingPosition(conversationId, payload).catch(() => undefined);
    };
    const persistWhenIdle = () => {
      persistTimer = null;
      const remaining = 1000 - (window.performance.now() - lastScrollAt);
      if (remaining > 0) {
        persistTimer = window.setTimeout(persistWhenIdle, remaining);
        return;
      }
      persist();
    };
    const schedulePersist = () => {
      lastScrollAt = window.performance.now();
      if (persistTimer === null) persistTimer = window.setTimeout(persistWhenIdle, 1000);
    };
    const sendCachedPosition = () => {
      const payload = latestStablePositionRef.current;
      if (!payload) return;
      if (dataSource.mode === "remote") saveReadingPositionKeepalive(conversationId, payload);
      else void dataSource.saveReadingPosition(conversationId, payload).catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") sendCachedPosition();
    };
    const onPageHide = () => sendCachedPosition();
    const onScroll = () => {
      const current = root.scrollTop;
      const scrollDelta = Math.abs(current - pointerScrollTopRef.current);
      if (scrollDelta > Math.max(1200, root.clientHeight * 1.5)) {
        // Home/End, accessibility tooling and scrollbar track jumps do not
        // necessarily have a preceding pointer event. Rebase virtual message
        // coordinates after a viewport-scale jump without adding layout reads
        // to the ordinary wheel path.
        notifyReaderWindowLayoutChanged();
      }
      if (pointerDraggingRef.current && scrollDelta > 1) {
        pointerDragMovedRef.current = true;
        markReaderScrollIntent(current < pointerScrollTopRef.current ? "up" : "down");
      }
      pointerScrollTopRef.current = current;
      scheduleActiveSample();
      schedulePersist();
    };
    const onClick = () => scheduleActiveSample(true);

    pointerScrollTopRef.current = root.scrollTop;
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("click", onClick, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    scheduleActiveSample(true);
    return () => {
      if (sampleFrame) window.cancelAnimationFrame(sampleFrame);
      if (sampleTimer !== null) window.clearTimeout(sampleTimer);
      if (persistTimer !== null) window.clearTimeout(persistTimer);
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [conversationId, dataSource, initialPaintReady, markReaderScrollIntent, refreshActiveMessageFromLayout]);

  const conversation = conversationQuery.data;
  const loadingProgress = initialPaintReady
    ? 100
    : windowQuery.isSuccess
      ? messages.length > 0 || windowQuery.data?.total === 0 ? 90 : 70
      : conversationQuery.isSuccess
        ? 25
        : 10;
  const loadedLabel = useMemo(
    () => t("showMessages", { shown: messages.length, total }),
    [messages.length, t, total],
  );
  const selectedIds = useMemo(() => Array.from(selectedMessageIds), [selectedMessageIds]);
  const selectedOrderedIds = useMemo(
    () => messages.filter((message) => selectedMessageIds.has(message.id)).map((message) => message.id),
    [messages, selectedMessageIds],
  );
  const activeTocItems = useMemo(
    () => deriveActiveTocItems(messages.find((message) => message.id === activeMessageId)),
    [activeMessageId, messages],
  );
  const activeHeadingId = useMemo(
    () => resolveActiveHeadingId(activeTocItems, activeBlockId),
    [activeBlockId, activeTocItems],
  );
  const tocObserverKey = useMemo(
    () => `${activeMessageId ?? "none"}:${messages.length}`,
    [activeMessageId, messages.length],
  );
  function currentReaderLocation(): { conversationId: string; messageId?: string; blockIndex?: number; characterOffset?: number } {
    const root = scrollContainerRef.current;
    const position = root ? captureReadingPosition(root, messagesRef.current, total) : null;
    const messageId = position?.message_id ?? resolveActiveReadingTarget(root, ACTIVE_READING_OFFSET)?.messageId ?? activeMessageId ?? undefined;
    const activeBlockParts = activeBlockId?.split("-") ?? [];
    const activeBlockIndex = activeBlockParts.length ? numberOrNull(activeBlockParts[activeBlockParts.length - 1]) ?? undefined : undefined;
    const blockIndex = position?.block_index ?? activeBlockIndex;
    const offset =
      messageId && blockIndex !== undefined
        ? estimateCharacterOffsetAtReadingLine(root, messageId, blockIndex, ACTIVE_READING_OFFSET)
        : undefined;
    return { conversationId, messageId, blockIndex, characterOffset: offset };
  }

  function sourceTargetForMessage(message: MessageListItem, blockId?: string | null, characterOffset?: number): SourceEditorTarget {
    const text = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
    const baseOffset = sourceOffsetForBlock(text, normalizedMessageBlocks(message), blockId);
    return { message, cursorOffset: Math.min(text.length, Math.max(0, baseOffset + (characterOffset ?? 0))) };
  }

  function openSourceEditor(message?: MessageListItem, requestedBlockId?: string | null) {
    if (!canManageCanonical) return;
    if (sourceEditorTarget && (!message || sourceEditorTarget.message.id === message.id)) {
      document.querySelector<HTMLButtonElement>('[data-source-editor-close="true"]')?.click();
      return;
    }
    const location = currentReaderLocation();
    const nextMessage = message ?? messages.find((item) => item.id === location.messageId) ?? messages.find((item) => item.id === activeMessageId) ?? messages[0];
    if (!nextMessage) return;
    const blockId = requestedBlockId ?? (nextMessage.id === location.messageId && location.blockIndex !== undefined
      ? `block-${nextMessage.id}-${location.blockIndex}`
      : nextMessage.id === activeMessageId ? activeBlockId : null);
    const nextTarget = sourceTargetForMessage(nextMessage, blockId, nextMessage.id === location.messageId ? location.characterOffset : undefined);
    if (sourceEditorTarget && sourceEditorTarget.message.id !== nextMessage.id && sourceEditorDirty) {
      setPendingSourceEditorTarget(nextTarget);
      return;
    }
    if (!sourceEditorTarget) {
      window.dispatchEvent(new Event("chat-reader:reader-layout-will-change"));
      sourceEditorBaseLeftRef.current = readerMainSectionRef.current?.getBoundingClientRect().left ?? 0;
    }
    setSourceEditorTarget(nextTarget);
    setSourceRequestedCursorOffset(nextTarget.cursorOffset);
    setPendingSourceEditorTarget(null);
    setAnnotationsOpen(false);
    setUtilityPanel(null);
    setShowSearch(false);
    setShowShare(false);
    setShowExport(false);
    // The file workspace may remain open beside the source editor.
    setDesktopActionsExpanded(false);
    setMobileActionsExpanded(false);
  }

  const closeSourceEditorForWorkspace = useCallback(async (): Promise<boolean> => {
    if (!sourceEditorTarget) return true;
    if (sourceEditorDirty) {
      const discard = await dialog.confirm({
        title: resolvedLocale === "zh-CN" ? "\u653e\u5f03\u672a\u4fdd\u5b58\u7684 Markdown \u4fee\u6539\uff1f" : "Discard unsaved Markdown changes?",
        description: resolvedLocale === "zh-CN" ? "\u7ee7\u7eed\u5c06\u5173\u95ed\u6e90\u7801\u7f16\u8f91\u5668\u5e76\u653e\u5f03\u672c\u6b21\u4fee\u6539\u3002" : "Continuing closes the source editor and discards this edit.",
        confirmLabel: resolvedLocale === "zh-CN" ? "\u653e\u5f03\u5e76\u7ee7\u7eed" : "Discard and continue",
        danger: true,
      });
      if (!discard) return false;
    }
    window.dispatchEvent(new Event("chat-reader:reader-layout-will-change"));
    sourceEditorBaseLeftRef.current = null;
    setSourceEditorTarget(null);
    setPendingSourceEditorTarget(null);
    setSourceEditorDirty(false);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("chat-reader:reader-layout-did-change")));
    return true;
  }, [dialog, resolvedLocale, sourceEditorDirty, sourceEditorTarget]);

  const sourceEditorOpen = Boolean(sourceEditorTarget);
  useEffect(() => {
    if (!sourceEditorOpen) return undefined;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event("chat-reader:reader-layout-did-change"));
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [sourceEditorOpen]);

  async function applySourceMessageChange(nextMessage: MessageListItem) {
    const anchor = captureScrollAnchor(scrollContainerRef.current, ACTIVE_READING_OFFSET);
    await applyMessageChange(nextMessage);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (anchor) compensateScrollAnchorFrame(scrollContainerRef.current, anchor);
  }

  useEffect(() => {
    if (
      !sourceEditorTarget ||
      !activeMessageId ||
      !userScrollIntentRef.current ||
      Date.now() - lastReaderUserIntentAtRef.current > 1500 ||
      navigationInProgressRef.current ||
      restoreInProgressRef.current ||
      edgeTransitionRef.current !== null
    ) return;
    const activeMessage = messages.find((message) => message.id === activeMessageId);
    if (!activeMessage) return;
    const blockIndex = activeBlockId ? parseBlockTargetId(activeBlockId)?.blockIndex : undefined;
    const characterOffset = blockIndex === undefined
      ? undefined
      : estimateCharacterOffsetAtReadingLine(scrollContainerRef.current, activeMessage.id, blockIndex, ACTIVE_READING_OFFSET);
    const nextTarget = sourceTargetForMessage(activeMessage, activeBlockId, characterOffset);
    if (activeMessage.id === sourceEditorTarget.message.id) {
      if (sourceFollowOffsetRef.current !== null && Math.abs(sourceFollowOffsetRef.current - nextTarget.cursorOffset) < 24) return;
      sourceFollowOffsetRef.current = nextTarget.cursorOffset;
      if (sourceFollowFrameRef.current !== null) window.cancelAnimationFrame(sourceFollowFrameRef.current);
      sourceFollowFrameRef.current = window.requestAnimationFrame(() => {
        sourceFollowFrameRef.current = null;
        window.dispatchEvent(new CustomEvent("chat-reader:source-editor-locate", {
          detail: { messageId: activeMessage.id, cursorOffset: nextTarget.cursorOffset },
        }));
      });
      return;
    }
    if (sourceEditorDirty) {
      setPendingSourceEditorTarget(nextTarget);
      return;
    }
    setSourceEditorTarget(nextTarget);
    setSourceRequestedCursorOffset(nextTarget.cursorOffset);
    setPendingSourceEditorTarget(null);
  }, [activeBlockId, activeMessageId, messages, sourceEditorDirty, sourceEditorTarget]);

  useEffect(() => {
    if (sourceEditorDirty || !pendingSourceEditorTarget) return;
    setSourceEditorTarget(pendingSourceEditorTarget);
    setSourceRequestedCursorOffset(pendingSourceEditorTarget.cursorOffset);
    setPendingSourceEditorTarget(null);
  }, [pendingSourceEditorTarget, sourceEditorDirty]);

  useEffect(() => {
    const shell = readerMainSectionRef.current;
    if (!shell) return undefined;
    let resizeAnchor: ReturnType<typeof captureScrollAnchor> = null;
    let compensationFrame = 0;
    const applyOffset = (panelWidth?: number) => {
      if (!sourceEditorTarget || focusMode || window.innerWidth < 1024) {
        shell.style.removeProperty("margin-left");
        return;
      }
      const width = panelWidth ?? document.querySelector<HTMLElement>("[data-testid='floating-source-workspace']")?.getBoundingClientRect().width ?? Math.min(720, Math.max(560, window.innerWidth * 0.32));
      const baseLeft = sourceEditorBaseLeftRef.current ?? shell.getBoundingClientRect().left;
      shell.style.marginLeft = `${Math.max(0, width - baseLeft)}px`;
    };
    const compensateResize = () => {
      if (resizeAnchor) compensateScrollAnchorFrame(scrollContainerRef.current, resizeAnchor);
    };
    const onResizeStart = () => {
      resizeAnchor = captureScrollAnchor(scrollContainerRef.current, ACTIVE_READING_OFFSET);
    };
    const onWidth = (event: Event) => {
      applyOffset(Number((event as CustomEvent<number>).detail));
      compensateResize();
    };
    const onWidthCommitted = (event: Event) => {
      applyOffset(Number((event as CustomEvent<number>).detail));
      compensateResize();
      window.cancelAnimationFrame(compensationFrame);
      compensationFrame = window.requestAnimationFrame(() => {
        compensateResize();
        resizeAnchor = null;
      });
    };
    const onSidebar = () => applyOffset();
    window.addEventListener("chat-reader:source-editor-resize-start", onResizeStart);
    window.addEventListener("chat-reader:source-editor-width-change", onWidth);
    window.addEventListener("chat-reader:source-editor-width-committed", onWidthCommitted);
    window.addEventListener("chat-reader:reader-sidebar-layout-change", onSidebar);
    const frame = window.requestAnimationFrame(() => applyOffset());
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(compensationFrame);
      window.removeEventListener("chat-reader:source-editor-resize-start", onResizeStart);
      window.removeEventListener("chat-reader:source-editor-width-change", onWidth);
      window.removeEventListener("chat-reader:source-editor-width-committed", onWidthCommitted);
      window.removeEventListener("chat-reader:reader-sidebar-layout-change", onSidebar);
      shell.style.removeProperty("margin-left");
    };
  }, [focusMode, sourceEditorTarget]);

  async function refreshReader() {
    windowGenerationRef.current += 1;
    const emptyWindow = emptyLoadedWindow(windowGenerationRef.current);
    loadedWindowRef.current = emptyWindow;
    setLoadedWindow(emptyWindow);
    initialWindowAppliedRef.current = false;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reader-turn-window", dataSource.mode, conversationId] }),
      queryClient.invalidateQueries({ queryKey: ["toc", readerSourceKey, conversationId] }),
      queryClient.invalidateQueries({ queryKey: ["conversation", dataSource.mode, conversationId] }),
    ]);
  }

  async function applyMessageChange(nextMessage?: MessageListItem, conversationRevision?: number) {
    if (!nextMessage) {
      await refreshReader();
      return;
    }
    if (conversationRevision !== undefined) applyConversationRevision(conversationRevision);
    const replace = (item: MessageListItem) => item.id === nextMessage.id ? nextMessage : item;
    const current = loadedWindowRef.current;
    const nextWindow: LoadedMessageWindow = {
      ...current,
      items: current.items.map(replace),
      turns: current.turns.map((turn) => turn.items.some((item) => item.id === nextMessage.id)
        ? { ...turn, items: turn.items.map(replace) }
        : turn),
    };
    loadedWindowRef.current = nextWindow;
    setLoadedWindow(nextWindow);
    notifyReaderMessageLayoutChanged(nextMessage.id);
    void queryClient.invalidateQueries({ queryKey: ["toc", readerSourceKey, conversationId] });
  }

  function applyConversationRevision(revision: number) {
    queryClient.setQueryData<ConversationDetail>(["conversation", dataSource.mode, conversationId], (current) => (
      current ? { ...current, offline_revision: revision } : current
    ));
  }

  async function mergeSelectedMessages() {
    if (selectedIds.length < 2) return;
    if (!(await closeSourceEditorForWorkspace())) return;
    if (!(await dialog.confirm({ title: `Merge ${selectedIds.length} selected messages?`, description: "The selected adjacent messages will be merged into the first message.", confirmLabel: "Merge" }))) return;
    await mergeMessages({ messageIds: selectedIds });
    setSelectedMessageIds(new Set());
    await refreshReader();
  }

  async function deleteReaderMessage(message: MessageListItem) {
    if (!(await dialog.confirm({
      title: resolvedLocale === "zh-CN" ? "删除这条消息？" : "Delete this message?",
      description: resolvedLocale === "zh-CN" ? "消息会从当前阅读视图隐藏，可在短时间内撤销。历史版本和附件不会立即物理删除。" : "The message will be hidden from the reader. Its history and attachments are retained.",
      confirmLabel: resolvedLocale === "zh-CN" ? "删除消息" : "Delete message",
      danger: true,
    }))) return;
    try {
      const result = await deleteMessage(message.id, conversation?.offline_revision);
      applyConversationRevision(result.conversation_revision);
      setDeletedMessage({ message, conversationRevision: result.conversation_revision, status: "deleted" });
      await refreshReader();
      window.setTimeout(() => setDeletedMessage((current) => current?.message.id === message.id && current.status === "deleted" ? null : current), 8000);
    } catch (error) {
      setNavigationStatus("failed");
      window.dispatchEvent(new CustomEvent("chat-reader:toast", { detail: { message: error instanceof Error ? error.message : "Delete failed" } }));
    }
  }

  async function restoreReaderMessage() {
    if (!deletedMessage || deletedMessage.status === "restoring") return;
    const message = deletedMessage.message;
    setDeletedMessage((current) => current ? { ...current, status: "restoring", error: undefined } : current);
    try {
      const result = await restoreDeletedMessage(message.id, deletedMessage.conversationRevision);
      applyConversationRevision(result.conversation_revision);
      setDeletedMessage(null);
      await refreshReader();
    } catch {
      const messageText = resolvedLocale === "zh-CN"
        ? "\u64a4\u9500\u5931\u8d25\uff0c\u6d88\u606f\u5c1a\u672a\u6062\u590d\u3002"
        : "Undo failed. The message has not been restored.";
      setDeletedMessage((current) => current ? { ...current, status: "restore_failed", error: messageText } : current);
      window.dispatchEvent(new CustomEvent("chat-reader:toast", { detail: { message: messageText, tone: "error", persist: true } }));
    }
  }

  const openUtilityPanel = useCallback(async (panel: Exclude<ReaderUtilityPanel, null | "navigation">) => {
    if (window.innerWidth >= 768 && document.activeElement instanceof HTMLElement) {
      desktopUtilityOpenerRef.current = document.activeElement;
      desktopUtilityPanelRef.current = panel === "files" ? null : panel;
    }
    const alreadyOpen = panel === "search" ? showSearch : panel === "share" ? showShare : panel === "export" ? showExport : showFiles;
    if (alreadyOpen) {
      setShowSearch(false);
      setShowShare(false);
      setShowExport(false);
      setShowFiles(false);
      setUtilityPanel(null);
      return;
    }
    if (panel !== "files" && !(await closeSourceEditorForWorkspace())) return;
    setDesktopActionsExpanded(false);
    setMobileActionsExpanded(false);
    if (panel !== "files") setAnnotationsOpen(false);
    if (window.innerWidth < 768) {
      setShowShare(false);
      setShowExport(false);
      setShowSearch(false);
      setShowFiles(false);
      setUtilityPanel(panel);
      return;
    }
    setUtilityPanel(null);
    setShowShare(panel === "share");
    setShowExport(panel === "export");
    setShowSearch(panel === "search");
    setShowFiles(panel === "files");
  }, [closeSourceEditorForWorkspace, showExport, showFiles, showSearch, showShare]);

  const closeDesktopUtilityPanels = useCallback(() => {
    setShowShare(false);
    setShowExport(false);
    setShowSearch(false);
    setShowFiles(false);
  }, []);

  const restoreDesktopUtilityFocus = useCallback(() => {
    const opener = desktopUtilityOpenerRef.current;
    // Header actions are retained while their rail closes, but are then inside
    // an aria-hidden container. Do not restore focus into that hidden subtree.
    if (opener?.isConnected && !opener.closest("[aria-hidden='true']")) return opener;
    const panel = desktopUtilityPanelRef.current;
    const replacement = panel
      ? document.querySelector<HTMLElement>(`[data-reader-header-action="${panel}"]`)
      : null;
    return replacement?.isConnected && !replacement.closest("[aria-hidden='true']")
      ? replacement
      : document.querySelector<HTMLElement>("[data-reader-header-more-actions='true']");
  }, []);

  const restoreMobileUtilityFocus = useCallback(() => (
    document.querySelector<HTMLElement>("[data-reader-mobile-more-actions='true']")
  ), []);

  const setAnnotationsOpenPreservingAnchor = useCallback((nextOpen: boolean) => {
    if (nextOpen === annotationsOpen) return;
    const token = annotationTransitionRef.current + 1;
    annotationTransitionRef.current = token;
    const root = scrollContainerRef.current;
    const anchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
    if (!root || !anchor) {
      setAnnotationsOpen(nextOpen);
      return;
    }

    root.dataset.readerSurfaceCompensating = "true";
    if (annotationCompensationFrameRef.current !== null) {
      window.cancelAnimationFrame(annotationCompensationFrameRef.current);
    }
    void annotationBlockLeaseRef.current?.then((lease) => lease?.release());
    const blockTarget = parseBlockTargetId(anchor.targetId);
    const blockLease = blockTarget
      ? acquireReaderBlockLease(
          blockTarget.messageId,
          blockTarget.blockIndex,
          () => annotationTransitionRef.current === token,
          900,
        )
      : null;
    annotationBlockLeaseRef.current = blockLease;

    const compensate = () => {
      if (annotationTransitionRef.current !== token) return;
      compensateScrollAnchorFrame(scrollContainerRef.current, anchor);
      annotationCompensationFrameRef.current = window.requestAnimationFrame(compensate);
    };
    annotationCompensationFrameRef.current = window.requestAnimationFrame(compensate);
    setAnnotationsOpen(nextOpen);

    window.requestAnimationFrame(() => {
      void settlePreferenceLayoutAnchor({
        root: scrollContainerRef.current,
        anchor,
        tokenIsCurrent: () => annotationTransitionRef.current === token,
      }).finally(() => {
        void blockLease?.then((lease) => lease?.release());
        if (annotationTransitionRef.current !== token) return;
        annotationBlockLeaseRef.current = null;
        if (annotationCompensationFrameRef.current !== null) {
          window.cancelAnimationFrame(annotationCompensationFrameRef.current);
          annotationCompensationFrameRef.current = null;
        }
        delete scrollContainerRef.current?.dataset.readerSurfaceCompensating;
      });
    });
  }, [annotationsOpen]);

  const openAnnotationsWorkspace = useCallback(async () => {
    if (annotationsOpen) {
      setAnnotationsOpenPreservingAnchor(false);
      return;
    }
    if (!(await closeSourceEditorForWorkspace())) return;
    setUtilityPanel(null);
    setShowShare(false);
    setShowExport(false);
    setShowSearch(false);
    setAnnotationsOpenPreservingAnchor(true);
  }, [annotationsOpen, closeSourceEditorForWorkspace, setAnnotationsOpenPreservingAnchor]);

  const openSplitWorkspace = useCallback(async () => {
    if (!(await closeSourceEditorForWorkspace())) return;
    setSplitWorkspaceOpen(true);
  }, [closeSourceEditorForWorkspace]);

  useEffect(() => () => {
    annotationTransitionRef.current += 1;
    void annotationBlockLeaseRef.current?.then((lease) => lease?.release());
    if (annotationCompensationFrameRef.current !== null) {
      window.cancelAnimationFrame(annotationCompensationFrameRef.current);
    }
    delete scrollContainerRef.current?.dataset.readerSurfaceCompensating;
  }, []);

  const toggleFocusMode = useCallback(async () => {
    if (!(await closeSourceEditorForWorkspace())) return;
    focusAnchorRef.current = captureScrollAnchor(scrollContainerRef.current, ACTIVE_READING_OFFSET);
    restoreAttemptedRef.current = true;
    navigationTokenRef.current += 1;
    readingRestoreTokenRef.current += 1;
    navigationInProgressRef.current = false;
    restoreInProgressRef.current = false;
    setFocusMode((value) => !value);
  }, [closeSourceEditorForWorkspace]);

  useEffect(() => {
    const openSearch = () => { void openUtilityPanel("search"); };
    window.addEventListener("chat-reader:open-reader-search", openSearch);
    return () => window.removeEventListener("chat-reader:open-reader-search", openSearch);
  }, [openUtilityPanel]);

  useEffect(() => {
    const closeTopSurface = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (utilityPanel !== null) { setUtilityPanel(null); event.preventDefault(); return; }
      if (showFiles) { setShowFiles(false); event.preventDefault(); return; }
      if (mobileActionsExpanded || desktopActionsExpanded) { setMobileActionsExpanded(false); setDesktopActionsExpanded(false); event.preventDefault(); }
    };
    window.addEventListener("keydown", closeTopSurface);
    return () => window.removeEventListener("keydown", closeTopSurface);
  }, [desktopActionsExpanded, mobileActionsExpanded, showExport, showFiles, showSearch, showShare, utilityPanel]);

  async function openNavigation(tab: "dialogue" | "sections") {
    if (!(await closeSourceEditorForWorkspace())) return;
    setNavigationTab(tab);
    setMobileNavigation({ pending: false, error: null });
    setDesktopActionsExpanded(false);
    setMobileActionsExpanded(false);
    setUtilityPanel("navigation");
  }

  function insertConversationAttachment(attachment: AttachmentRead, placement: "inline" | "after_message") {
    const mime = attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type ?? attachment.declared_mime_type ?? "application/octet-stream";
    setPendingSourceAttachment({
      referenceUri: `cr-asset://${attachment.id}`,
      displayName: attachment.display_name,
      image: mime.startsWith("image/"),
      placement,
    });
    setUtilityPanel(null);
    if (!sourceEditorTarget) openSourceEditor();
  }

  function pruneMessageState(retainedIds: string[]) {
    const retained = new Set(retainedIds);
    setSelectedMessageIds((current) => {
      const next = new Set(Array.from(current).filter((messageId) => retained.has(messageId)));
      return next.size === current.size ? current : next;
    });
  }

  if (conversationQuery.isLoading) {
    return <ReaderLoadingShell progress={loadingProgress} embedded={libraryMode} />;
  }

  if (conversationQuery.isError) {
    return <ReaderState title={t("conversationUnavailable")} detail={conversationQuery.error.message} />;
  }

  if (!conversation) {
    return <ReaderState title={t("conversationUnavailable")} detail={t("noConversationPayload")} />;
  }
  const readerSourceKey = readerCacheIdentity(dataSource, conversation);

  const headerActions: ReaderHeaderAction[] = [
    ...(canManageCanonical ? [{
      id: "edit-source",
      label: resolvedLocale === "zh-CN" ? "\u7f16\u8f91 Markdown \u6e90\u7801" : "Edit Markdown source",
      icon: Pencil,
      onSelect: () => openSourceEditor(),
    } as ReaderHeaderAction] : []),
    {
      id: "search",
      label: t("search"),
      icon: Search,
      onSelect: () => { void openUtilityPanel("search"); },
    },
    {
      id: "annotations",
      label: t("annotations"),
      icon: MessageSquareText,
      onSelect: () => { void openAnnotationsWorkspace(); },
    },
    {
      id: "focus-mode",
      label: focusMode ? t("exitFocusMode") : t("focusMode"),
      icon: Focus,
      onSelect: () => { void toggleFocusMode(); },
    },
    ...(dataSource.capabilities.share ? [{
      id: "share",
      label: t("share"),
      icon: Share2,
      onSelect: () => { void openUtilityPanel("share"); },
    } as ReaderHeaderAction] : []),
    ...(dataSource.capabilities.export ? [{
      id: "export",
      label: t("export"),
      icon: FileOutput,
      onSelect: () => { void openUtilityPanel("export"); },
    } as ReaderHeaderAction] : []),
    ...(canBrowseAttachments ? [{
      id: "conversation-files",
      label: resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files",
      icon: Paperclip,
      onSelect: () => { void openUtilityPanel("files"); },
    } as ReaderHeaderAction] : []),
    ...(canManageCanonical ? [{
      id: "refresh-toc",
      label: resolvedLocale === "zh-CN" ? "更新目录" : "Refresh contents",
      icon: RefreshCw,
      onSelect: () => setTocRefreshOpen(true),
      disabled: Boolean(tocRefreshTask && ["queued", "processing", "cancelling"].includes(tocRefreshTask.task.status)),
      busy: Boolean(tocRefreshTask && ["queued", "processing"].includes(tocRefreshTask.task.status)),
    } as ReaderHeaderAction] : []),
    ...(canManageCanonical && selectedIds.length >= 2 ? [{
      id: "merge-selected",
      label: t("mergeSelected"),
      icon: Merge,
      onSelect: () => void mergeSelectedMessages(),
    }] : []),
    ...(canManageCanonical ? [{
      id: "split-conversation",
      label: t("splitToNewConversation"),
      icon: Scissors,
      onSelect: () => { void openSplitWorkspace(); },
    }] : []),
  ];
  const desktopPrimaryActionIds = new Set(["edit-source", "search", "annotations", "focus-mode"]);
  const desktopPrimaryActions = headerActions.filter((action) => desktopPrimaryActionIds.has(action.id));
  const desktopSecondaryActions = headerActions.filter((action) => !desktopPrimaryActionIds.has(action.id));
  const mobileHeaderActions: ReaderHeaderAction[] = headerActions.filter((action) => action.id !== "edit-source");

  const navigationTabs = (
    <div className="flex items-center gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-2 rounded-lg bg-subtle p-1">
        <button type="button" onClick={() => setNavigationTab("dialogue")} className={`min-h-10 rounded-md px-3 text-sm font-medium ${navigationTab === "dialogue" ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{t("dialogueTab")}</button>
        <button type="button" onClick={() => setNavigationTab("sections")} className={`min-h-10 rounded-md px-3 text-sm font-medium ${navigationTab === "sections" ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{t("sectionsTab")}</button>
      </div>
      <button type="button" onClick={() => setUtilityPanel(null)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")} title={t("close")}><X className="h-5 w-5" /></button>
    </div>
  );

  const navigationContent = navigationTab === "dialogue" ? (
    <ConversationIndex conversationId={conversationId} sourceKey={readerSourceKey} activeMessageId={activeMessageId} ready={canLoadInitialWindow} mode="sheet" loadPage={(options) => dataSource.getDialogueIndex(conversationId, options)} onNavigate={async (item) => {
      setMobileNavigation({ pending: true, error: null });
      const result = await navigateToTarget({ messageId: item.messageId, source: "dialogue-index" });
      setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
      if (result.ok) setUtilityPanel(null);
    }} />
  ) : (
    <ConversationToc conversationId={conversationId} sourceKey={readerSourceKey} activeMessageId={activeMessageId} activeItems={activeTocItems} activeHeadingId={activeHeadingId} observerKey={tocObserverKey} mode="sheet" loadPage={(options) => dataSource.getToc(conversationId, options)} onNavigate={async (item) => {
      setMobileNavigation({ pending: true, error: null });
      const result = await navigateToTarget({ messageId: item.message_id, blockIndex: item.block_index, source: "section-toc" });
      setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
      if (result.ok) setUtilityPanel(null);
    }} />
  );

  return (
    <main className={`flex overflow-hidden bg-page text-primary ${libraryMode ? "h-full w-full" : "h-screen w-screen"}`}>
      {!isOffline && !focusMode ? <ProjectSidebar
        currentProjectId={projectContextId}
        readerMode
        mobileOpenSignal={mobileSidebarOpenSignal}
        showMobileTrigger={false}
      /> : null}
      <section ref={readerMainSectionRef} data-reader-main-section="true" className="relative flex min-w-0 flex-1 flex-col">
        <header data-testid="mobile-reader-header" className={`absolute inset-x-0 top-0 z-40 border-b border-ui bg-surface/95 backdrop-blur transition-transform duration-100 ease-out md:relative md:z-20 md:translate-y-0 ${mobileHeaderVisible ? "translate-y-0" : "-translate-y-full"}`}>
          {loadingProgress < 100 ? (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-subtle">
              <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${loadingProgress}%` }} />
            </div>
          ) : null}
          <div className="hidden min-h-14 items-center justify-between gap-3 px-6 py-2 md:flex">
            {!focusMode ? <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold text-primary">
                  {conversation.display_title || conversation.title}
                </h1>
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-secondary">
                  <span>{loadedLabel}</span>
                </div>
            </div> : <div className="flex-1" />}
            {focusMode ? <button type="button" onClick={toggleFocusMode} className="inline-flex h-9 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-secondary hover:bg-subtle" aria-label={t("exitFocusMode")}><Focus className="h-4 w-4" />{t("exitFocusMode")}</button> : <div className="reader-header-auxiliary flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={() => void openNavigation("dialogue")} className="hidden h-9 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm text-secondary hover:bg-subtle md:inline-flex 2xl:hidden" aria-label={t("readerNavigation")}><ListTree className="h-4 w-4" />{t("readerNavigation")}</button>
              <div className="flex shrink-0 items-center gap-1" aria-label="Primary reader actions">
                {desktopPrimaryActions.map((action) => {
                  const Icon = action.icon;
                  return <button key={action.id} type="button" onClick={action.onSelect} disabled={action.disabled} aria-pressed={action.id === "edit-source" ? Boolean(sourceEditorTarget) : undefined} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ui hover:bg-subtle hover:text-primary focus:outline-none focus:ring-2 focus:ring-[var(--focus)] disabled:opacity-50 ${action.id === "edit-source" && sourceEditorTarget ? "bg-[var(--accent-soft)] text-accent" : "bg-surface text-secondary"}`} aria-label={action.label} title={action.label}><Icon className="h-[1.125rem] w-[1.125rem]" /></button>;
                })}
              </div>
              <ReaderHeaderActionRail
                expanded={desktopActionsExpanded}
                onExpandedChange={setDesktopActionsExpanded}
                actions={desktopSecondaryActions}
                triggerLabel={t("messageActions")}
                closeLabel={t("collapseActions")}
              />
            </div>}
          </div>
          {focusMode ? <div className="flex min-h-14 items-center justify-end px-[3vw] py-2 md:hidden"><button type="button" onClick={toggleFocusMode} className="inline-flex h-10 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-secondary" aria-label={t("exitFocusMode")}><Focus className="h-4 w-4" />{t("exitFocusMode")}</button></div> : <div className="flex min-h-14 items-center gap-2 px-[3vw] py-2 md:hidden">
            <MobileSidebarTrigger
              onOpen={() => isOffline ? onOpenLibrary?.() : setMobileSidebarOpenSignal((value) => value + 1)}
            />
            <div className={`min-w-0 flex-1 overflow-hidden transition-opacity duration-150 ${mobileActionsExpanded ? "pointer-events-none opacity-0" : "opacity-100"}`}>
              <h1 className="truncate text-[15px] font-semibold text-primary">{conversation.display_title || conversation.title}</h1>
              <p className="truncate text-xs text-secondary">{loadedLabel}</p>
            </div>
            {!mobileActionsExpanded ? (
              <button
                type="button"
                onClick={() => void openNavigation("dialogue")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ui bg-surface text-secondary"
                aria-label={t("readerNavigation")}
                title={t("readerNavigation")}
              >
                <ListTree className="h-5 w-5" />
              </button>
            ) : null}
            {canManageCanonical && !mobileActionsExpanded ? <button type="button" onClick={() => openSourceEditor()} aria-pressed={Boolean(sourceEditorTarget)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ui ${sourceEditorTarget ? "bg-[var(--accent-soft)] text-accent" : "bg-surface text-secondary"}`} aria-label={resolvedLocale === "zh-CN" ? "\u7f16\u8f91 Markdown \u6e90\u7801" : "Edit Markdown source"} title={resolvedLocale === "zh-CN" ? "\u7f16\u8f91 Markdown \u6e90\u7801" : "Edit Markdown source"}><Pencil className="h-5 w-5" /></button> : null}
            <button type="button" data-reader-more-actions="true" data-reader-mobile-more-actions="true" onClick={() => setMobileActionsExpanded(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--text)] text-[var(--surface)]" aria-label={t("more")} title={t("more")}><MoreHorizontal className="h-5 w-5" /></button>
          </div>}
          {!focusMode && navigationStatus === "loading" ? <div className="border-t border-ui bg-subtle px-[3vw] py-2 text-sm text-accent" role="status">{t("locating")}</div> : null}
          {!focusMode && navigationStatus === "stale" ? <div className="border-t border-ui bg-amber-50 px-[3vw] py-2 text-sm text-amber-800" role="status">{t("locateChanged")}</div> : null}
          {!focusMode && navigationStatus === "failed" ? <div className="border-t border-ui bg-[var(--danger-soft)] px-[3vw] py-2 text-sm text-[var(--danger)]" role="alert">{t("locateFailed")}</div> : null}
          {!focusMode && searchNavigation ? <div className="flex min-w-0 items-center gap-2 border-t border-ui bg-subtle px-[3vw] py-2 text-sm text-primary" role="status">
            <span className="min-w-0 flex-1 truncate font-medium">{searchNavigation.query}</span>
            <span className="shrink-0 text-xs text-secondary">{searchNavigation.index + 1} / {searchNavigation.targets.length}</span>
            <button type="button" onClick={() => void navigateSearchResult(Math.max(0, searchNavigation.index - 1))} disabled={searchNavigation.index === 0} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface disabled:opacity-40" aria-label={resolvedLocale === "zh-CN" ? "上一个匹配" : "Previous match"}><ChevronUp className="h-4 w-4" /></button>
            <button type="button" onClick={() => void navigateSearchResult(Math.min(searchNavigation.targets.length - 1, searchNavigation.index + 1))} disabled={searchNavigation.index >= searchNavigation.targets.length - 1} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface disabled:opacity-40" aria-label={resolvedLocale === "zh-CN" ? "下一个匹配" : "Next match"}><ChevronDown className="h-4 w-4" /></button>
            <button type="button" onClick={() => { setSearchNavigation(null); setSearchHighlight(null); void openUtilityPanel("search"); }} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium hover:bg-surface">{resolvedLocale === "zh-CN" ? "返回搜索" : "Return to search"}</button>
            <button type="button" onClick={() => { setSearchNavigation(null); setSearchHighlight(null); setTargetHighlightId(null); }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-surface" aria-label={t("close")}><X className="h-4 w-4" /></button>
          </div> : null}
          {showOfflineGuide && !isOffline && !focusMode ? <div className="reader-header-auxiliary relative flex flex-col gap-1 border-t border-ui bg-[var(--accent-soft)] px-[3vw] py-2 pr-12 text-xs text-primary md:flex-row md:items-center md:gap-2 md:pr-[3vw]"><div className="flex min-w-0 flex-1 items-start gap-2"><Download className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span className="min-w-0">{t("offlineGuide")}</span></div><button type="button" onClick={() => { window.location.href = buildReaderUrl("/library", currentReaderLocation()); }} className="ml-6 shrink-0 self-start font-semibold text-accent md:ml-0 md:self-auto">{t("prepareOffline")}</button><button type="button" onClick={() => { window.localStorage.setItem("chat-reader:offline-guide-dismissed", "true"); setShowOfflineGuide(false); }} className="absolute right-[3vw] top-2 flex h-7 w-7 shrink-0 items-center justify-center text-secondary md:static md:h-auto md:w-auto" aria-label={t("dismiss")}><X className="h-4 w-4" /></button></div> : null}
        </header>

        <div ref={scrollContainerRef} data-testid="reader-scroll-root" data-reader-scroll-root="true" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-14 [overflow-anchor:none] md:pt-0">
          <ResponsiveReaderFrame
            focusMode={focusMode}
            index={<ConversationIndex
                  conversationId={conversationId}
                  sourceKey={readerSourceKey}
                  activeMessageId={activeMessageId}
                  ready={canLoadInitialWindow}
                  loadPage={(options) => dataSource.getDialogueIndex(conversationId, options)}
                  onNavigate={(item) => {
                    void navigateToTarget({ messageId: item.messageId, source: "dialogue-index" });
                  }}
                />}
            content={<div className="reader-content-inner min-w-0">
              {windowQuery.isLoading && messages.length === 0 ? (
                <ReaderState title={t("loadingMessages")} detail={t("loadingInitialMessages")} />
              ) : null}

              {windowQuery.isError ? (
                <ReaderState title={t("loadFailed")} detail={windowQuery.error.message} />
              ) : null}

              {windowQuery.isSuccess && messages.length === 0 ? (
                <ReaderState title={t("noMessagesTitle")} detail={t("noConversationMessages")} />
              ) : null}

              {messages.length > 0 ? (
                <div className="space-y-6">
                  <div ref={loadPreviousSentinelRef} className={`flex items-center justify-center ${edgeLoading === "previous" || edgeError === "previous" ? "min-h-10" : "h-px"}`}>
                    {edgeLoading === "previous" ? <span className="inline-flex items-center gap-2 text-sm text-secondary"><Spinner dark />{t("loadingEarlier")}</span> : null}
                    {edgeError === "previous" ? <button type="button" onClick={() => void loadPreviousWindow()} className="rounded-lg border border-ui bg-surface px-3 py-1.5 text-sm text-secondary hover:bg-subtle">{t("retryEarlier")}</button> : null}
                  </div>
                  {messages.map((message) => {
                    return (
                    <MessageItem
                      key={message.id}
                      message={message}
                      onChanged={applyMessageChange}
                      readOnly={!canManageCanonical}
                      highlightTargetId={targetHighlightId}
                      editing={sourceEditorTarget?.message.id === message.id}
                      onEdit={canManageCanonical ? openSourceEditor : undefined}
                      onInsert={canManageCanonical ? setMessageInsertTarget : undefined}
                      onDelete={canManageCanonical ? deleteReaderMessage : undefined}
                      attachmentAccess={libraryMode ? { kind: "offline" } : { kind: "owner" }}
                      selected={selectedMessageIds.has(message.id)}
                      onSelectedChange={!canManageCanonical ? undefined : (selected) => {
                        setSelectedMessageIds((current) => {
                          const next = new Set(current);
                          if (selected) {
                            next.add(message.id);
                          } else {
                            next.delete(message.id);
                          }
                          return next;
                        });
                      }}
                      onBookmark={() => {
                        window.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", {
                          detail: { messageId: message.id, messageVersionId: message.current_version?.id },
                        }));
                        setAnnotationsOpenPreservingAnchor(true);
                      }}
                    />
                    );
                  })}
                  <div ref={loadMoreSentinelRef} className={`flex items-center justify-center ${edgeLoading === "next" || edgeError === "next" ? "min-h-10" : "h-px"}`}>
                    {edgeLoading === "next" ? (
                      <span className="inline-flex items-center gap-2 text-sm text-secondary">
                        <Spinner dark />
                        {t("loadingLater")}
                      </span>
                    ) : null}
                    {edgeError === "next" ? <button type="button" onClick={() => void loadNextWindow()} className="rounded-lg border border-ui bg-surface px-3 py-1.5 text-sm text-secondary hover:bg-subtle">{t("retryLater")}</button> : null}
                  </div>
                  {!hasMore ? <div aria-hidden="true" className="h-[calc(100vh-7rem)] min-h-72" /> : null}
                </div>
              ) : null}
            </div>}
            toc={<div className="h-full">
                <ConversationToc
                  conversationId={conversationId}
                  sourceKey={readerSourceKey}
                  activeMessageId={activeMessageId}
                  activeItems={activeTocItems}
                  activeHeadingId={activeHeadingId}
                  observerKey={tocObserverKey}
                  loadPage={(options) => dataSource.getToc(conversationId, options)}
                  onNavigate={(item) => {
                    void navigateToTarget({
                      messageId: item.message_id,
                      blockIndex: item.block_index,
                      source: "section-toc",
                    });
                  }}
                />
              </div>}
          />
        </div>
      </section>
      {sourceEditorTarget && !focusMode ? <SourceEditorWorkspace
        target={sourceEditorTarget}
        requestedCursorOffset={sourceRequestedCursorOffset}
        pendingAttachmentInsertion={pendingSourceAttachment}
        onAttachmentInsertionApplied={() => setPendingSourceAttachment(null)}
        pendingTarget={pendingSourceEditorTarget}
        onDirtyChange={setSourceEditorDirty}
        onTargetUpdated={(nextTarget) => {
          setSourceEditorTarget(nextTarget);
          setSourceRequestedCursorOffset(nextTarget.cursorOffset);
        }}
        onMessageChanged={applySourceMessageChange}
        onConversationRevision={applyConversationRevision}
        onClose={() => {
          window.dispatchEvent(new Event("chat-reader:reader-layout-will-change"));
          sourceEditorBaseLeftRef.current = null;
          setSourceEditorTarget(null);
          setPendingSourceEditorTarget(null);
          setSourceEditorDirty(false);
          window.requestAnimationFrame(() => window.dispatchEvent(new Event("chat-reader:reader-layout-did-change")));
        }}
        onLocate={async (messageId, blockIndex) => { await navigateToTarget({ messageId, blockIndex, source: "message-action" }); }}
        onDiscardAndSwitch={() => {
          if (!pendingSourceEditorTarget) return;
          setSourceEditorDirty(false);
          setSourceEditorTarget(pendingSourceEditorTarget);
          setSourceRequestedCursorOffset(pendingSourceEditorTarget.cursorOffset);
          setPendingSourceEditorTarget(null);
        }}
      /> : null}
      <MobileReaderSheet open={mobileActionsExpanded} onOpenChange={setMobileActionsExpanded} title={t("readerTools")} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("readerTools")}</h2><button type="button" onClick={() => setMobileActionsExpanded(false)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <div className="grid grid-cols-2 gap-2 py-3">
          {mobileHeaderActions.map((action) => { const Icon = action.icon; return <button key={action.id} type="button" disabled={action.disabled} onClick={() => { setMobileActionsExpanded(false); action.onSelect(); }} className="flex min-h-12 items-center gap-3 rounded-lg border border-ui bg-surface px-3 text-left text-sm text-primary disabled:opacity-50"><Icon className="h-4 w-4 shrink-0 text-accent" /><span className="min-w-0 line-clamp-2">{action.label}</span></button>; })}
        </div>
      </MobileReaderSheet>
      <MobileReaderSheet
        open={utilityPanel === "navigation" && !sourceEditorTarget}
        onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }}
        title={t("navigationTitle")}
        restoreFocus={restoreMobileUtilityFocus}
        header={navigationTabs}
        status={<>{mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}{mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}</>}
      >
        {navigationContent}
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "search" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={t("search")} restoreFocus={restoreMobileUtilityFocus} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("search")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <ConversationSearchPanel conversationId={conversation.id} dataSource={dataSource} sourceKey={readerSourceKey} initialState={searchPanelState} onStateChange={setSearchPanelState} onNavigate={handleSearchNavigate} onClose={() => setUtilityPanel(null)} showHeader={false} />
      </MobileReaderSheet>
      {utilityPanel === "navigation" && !sourceEditorTarget ? (
        <div className="fixed inset-0 z-50 hidden justify-end bg-black/25 md:flex 2xl:hidden">
          <button type="button" aria-label={t("close")} className="absolute inset-0" onClick={() => setUtilityPanel(null)} />
          <ResizableDockPanel storageKey="chat-reader:reader-navigation-width" defaultSize={448} minSize={320} maxSize={() => Math.min(720, window.innerWidth * 0.6)} side="left" className="relative z-10 border-l border-ui bg-page shadow-2xl">
            <section className="flex h-full w-full flex-col" aria-label={t("readerNavigation")}>
              <header className="shrink-0 border-b border-ui bg-surface p-4">{navigationTabs}</header>
              <div className="shrink-0 px-4 py-2" aria-live="polite">{mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}{mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}</div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">{navigationContent}</div>
            </section>
          </ResizableDockPanel>
        </div>
      ) : null}
      <MobileReaderSheet open={utilityPanel === "share" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={t("shareConversation")} restoreFocus={restoreMobileUtilityFocus} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("shareConversation")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <div className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto py-3"><SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} compact /></div>
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "export" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={t("export")} restoreFocus={restoreMobileUtilityFocus} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("export")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <div className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto py-3">{dataSource.mode === "offline" ? <OfflineExportPanel conversationId={conversation.id} /> : <ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} compact readingStartMessageId={activeMessageId} />}</div>
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "files" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files"} restoreFocus={restoreMobileUtilityFocus} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files"}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        {dataSource.capabilities.attachments === "manage" ? <ConversationFilesPanel conversationId={conversation.id} onLocate={async (messageId, blockIndex) => { setUtilityPanel(null); await navigateToTarget({ messageId, blockIndex, source: "message-action" }); }} onInsert={insertConversationAttachment} /> : <OfflineConversationFilesPanel conversationId={conversation.id} onLocate={async (messageId, blockIndex) => { setUtilityPanel(null); await navigateToTarget({ messageId, blockIndex, source: "message-action" }); }} />}
      </MobileReaderSheet>
      {!focusMode && (showShare || showExport || showSearch) ? (
        <ReaderUtilityDrawer active={!sourceEditorTarget} label={showSearch ? t("search") : showShare ? t("shareConversation") : t("export")} onClose={closeDesktopUtilityPanels} restoreFocus={restoreDesktopUtilityFocus}>
            <div className="flex h-full min-w-0 w-full overflow-hidden">
              {showSearch ? <ConversationSearchPanel conversationId={conversation.id} dataSource={dataSource} sourceKey={readerSourceKey} initialState={searchPanelState} onStateChange={setSearchPanelState} onNavigate={handleSearchNavigate} onClose={() => setShowSearch(false)} /> : <ReaderPanelShell title={showShare ? t("shareConversation") : t("export")} closeLabel={t("close")} onClose={() => { setShowShare(false); setShowExport(false); }}>
                {showShare ? <SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
                {showExport ? dataSource.mode === "offline" ? <OfflineExportPanel conversationId={conversation.id} /> : <ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} readingStartMessageId={activeMessageId} /> : null}
              </ReaderPanelShell>}
            </div>
        </ReaderUtilityDrawer>
      ) : null}
      {!focusMode && showFiles ? (
        <FloatingWorkspacePanel
          storageKey="chat-reader:conversation-files-workspace-floating-v2"
          placement="reader-floating"
          testId="conversation-files-workspace"
          title={resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files"}
          closeLabel={t("close")}
          resetLabel={resolvedLocale === "zh-CN" ? "重置文件窗口位置" : "Reset file window position"}
          onClose={() => setShowFiles(false)}
        >
          {dataSource.capabilities.attachments === "manage" ? <ConversationFilesPanel
              conversationId={conversation.id}
              onLocate={async (messageId, blockIndex) => { await navigateToTarget({ messageId, blockIndex, source: "message-action" }); }}
              onInsert={insertConversationAttachment}
            /> : <OfflineConversationFilesPanel conversationId={conversation.id} onLocate={async (messageId, blockIndex) => { await navigateToTarget({ messageId, blockIndex, source: "message-action" }); }} />}
        </FloatingWorkspacePanel>
      ) : null}
      <AnnotationWorkspace
        conversationId={conversation.id}
        messages={messages}
        activeMessageId={activeMessageId}
        initialAnnotationId={searchParams?.get("annotationId") ?? null}
        repository={annotationRepository}
        open={annotationsOpen && !focusMode && !sourceEditorTarget}
        onOpenChange={setAnnotationsOpenPreservingAnchor}
        onNavigate={navigateToTarget}
      />
      {canManageCanonical ? <ConversationSplitWorkspace
        open={splitWorkspaceOpen}
        conversationId={conversation.id}
        conversationTitle={conversation.display_title || conversation.title}
        selectedMessageIds={selectedOrderedIds}
        onClose={() => setSplitWorkspaceOpen(false)}
        onCompleted={async () => {
          setSelectedMessageIds(new Set());
          await queryClient.invalidateQueries({ queryKey: ["conversations"] });
        }}
      /> : null}
      {canManageCanonical ? <MessageInsertDialog
        key={messageInsertTarget?.id ?? "closed"}
        open={Boolean(messageInsertTarget)}
        conversationId={conversation.id}
        anchor={messageInsertTarget}
        revision={conversation.offline_revision}
        onClose={() => setMessageInsertTarget(null)}
        onSubmitted={async (result) => {
          setMessageInsertTarget(null);
          applyConversationRevision(result.conversation.offline_revision);
          await refreshReader();
        }}
      /> : null}
      {canManageCanonical ? <TocRefreshDialog
        open={tocRefreshOpen}
        conversationId={conversation.id}
        locale={resolvedLocale}
        onClose={() => setTocRefreshOpen(false)}
        onQueued={(task, input) => setTocRefreshTask({ task, input })}
      /> : null}
      {tocRefreshTask ? <div role={tocRefreshTask.task.status === "failed" ? "alert" : "status"} aria-live="polite" className="fixed bottom-4 left-1/2 z-[275] flex max-w-[min(92vw,34rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-ui bg-raised px-4 py-3 text-sm text-primary shadow-xl"><RefreshCw className={`h-4 w-4 shrink-0 text-accent ${["queued", "processing"].includes(tocRefreshTask.task.status) ? "animate-spin" : ""}`} /><span className="min-w-0 flex-1">{tocRefreshStatusText(tocRefreshTask.task, resolvedLocale)}</span>{tocRefreshTask.task.status === "failed" ? <button type="button" onClick={() => { setTocRefreshTask(null); setTocRefreshOpen(true); }} className="min-h-10 shrink-0 rounded-lg px-3 font-medium text-accent hover:bg-[var(--accent-soft)]">{resolvedLocale === "zh-CN" ? "重试" : "Retry"}</button> : null}{tocRefreshTask.task.status === "committed" ? <button type="button" onClick={() => setTocRefreshTask(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="h-4 w-4" /></button> : null}</div> : null}
      {deletedMessage ? <div role={deletedMessage.status === "restore_failed" ? "alert" : "status"} aria-live="assertive" className="fixed bottom-4 left-1/2 z-[280] flex max-w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-ui bg-raised px-4 py-3 text-sm text-primary shadow-xl"><span className="min-w-0 flex-1">{deletedMessage.status === "restore_failed" ? (deletedMessage.error ?? "撤销失败，消息尚未恢复。") : deletedMessage.status === "restoring" ? "正在恢复消息…" : "消息已删除"}</span>{deletedMessage.status !== "restoring" ? <button type="button" onClick={() => void restoreReaderMessage()} className="min-h-10 shrink-0 rounded-lg px-3 font-medium text-accent hover:bg-[var(--accent-soft)]">{deletedMessage.status === "restore_failed" ? "重试" : "撤销"}</button> : null}</div> : null}
    </main>
  );
}

function tocRefreshStatusText(task: BackgroundTaskRead, locale: "zh-CN" | "en-US"): string {
  const zh = locale === "zh-CN";
  if (task.status === "committed") {
    const headings = Number(task.result.heading_count ?? 0);
    return zh ? `目录更新完成${headings > 0 ? `，已生成 ${headings} 个章节` : ""}。` : `Contents refreshed${headings > 0 ? ` with ${headings} sections` : ""}.`;
  }
  if (task.status === "failed") return zh ? "目录更新失败，当前目录未被替换。" : "Contents refresh failed; the current contents were not replaced.";
  if (task.status === "queued") return zh ? "目录更新任务已排队。" : "Contents refresh is queued.";
  return zh ? `正在更新目录… ${task.progress}%` : `Refreshing contents… ${task.progress}%`;
}

function deriveActiveTocItems(message: MessageListItem | undefined): TocItem[] {
  if (!message) {
    return [];
  }
  const blocks = message.render_blocks ?? message.current_version?.blocks ?? [];
  return blocks
    .filter((block) => block.block_type === "heading")
    .map((block, index) => {
      const text = readHeadingText(block);
      const level = normalizeHeadingLevel(block.data.level);
      return {
        id: `local-${message.id}-${block.block_index}`,
        heading_index: index,
        level,
        text,
        slug: `message-${message.id}-heading-${block.block_index}`,
        message_id: message.id,
        message_order_key: message.order_key,
        block_index: block.block_index,
      };
    })
    .filter((item) => item.text.trim().length > 0);
}

function readHeadingText(block: RenderBlockRead): string {
  const text = block.data.title ?? block.data.text ?? block.plain_text ?? "";
  return typeof text === "string" ? text : "";
}

function normalizeHeadingLevel(value: unknown): number {
  const level = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(level)) {
    return Math.max(1, Math.min(6, level));
  }
  return 2;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

async function waitForMountedMessage(
  messageId: string,
  tokenIsCurrent: () => boolean,
  timeoutMs = 2000,
): Promise<boolean> {
  const targetId = `message-${messageId}`;
  const startedAt = window.performance.now();
  while (window.performance.now() - startedAt < timeoutMs) {
    if (!tokenIsCurrent()) return false;
    const target = document.getElementById(targetId);
    if (target?.isConnected) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      return tokenIsCurrent() && target.isConnected;
    }
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  return false;
}

async function loadCompleteTurnWindow(
  dataSource: ReaderDataSource,
  conversationId: string,
  anchorMessageId?: string,
  targetTurnCount?: number,
): Promise<CompleteTurnWindow> {
  return loadTurnNeighborhood(
    (anchor) => dataSource.getReaderTurn(conversationId, anchor),
    anchorMessageId,
    targetTurnCount,
  );
}

function syncTurnAnchorRefs(
  window: LoadedMessageWindow,
  previousRef: { current: string | null },
  nextRef: { current: string | null },
): void {
  previousRef.current = window.turns[0]?.previous_anchor_message_id ?? null;
  nextRef.current = window.turns.at(-1)?.next_anchor_message_id ?? null;
}

function messageIdForScrollAnchor(anchor: ScrollAnchorSnapshot): string | null {
  return document.getElementById(anchor.targetId)
    ?.closest<HTMLElement>("article[data-message-id]")
    ?.dataset.messageId ?? null;
}

async function acquireScrollAnchorLease(
  anchor: ScrollAnchorSnapshot,
  tokenIsCurrent: () => boolean,
): Promise<ReaderBlockLease | null> {
  const target = document.getElementById(anchor.targetId);
  const article = target?.closest<HTMLElement>("article[data-message-id]");
  const block = target?.closest<HTMLElement>("[data-block-index]");
  const messageId = article?.dataset.messageId;
  const blockIndex = block?.dataset.blockIndex === undefined
    ? Number.NaN
    : Number.parseInt(block.dataset.blockIndex, 10);
  if (!messageId || !Number.isFinite(blockIndex)) {
    return target && tokenIsCurrent()
      ? { targetId: anchor.targetId, release: () => undefined }
      : null;
  }
  return acquireReaderBlockLease(messageId, blockIndex, tokenIsCurrent);
}

function captureReadingPosition(
  root: HTMLElement,
  messages: MessageListItem[],
  totalMessages: number,
): ReadingPositionInput | null {
  const activeTarget = resolveActiveReadingTarget(root, ACTIVE_READING_OFFSET);
  const messageId = activeTarget?.messageId;
  if (!messageId) {
    return null;
  }
  const article = document.getElementById(`message-${messageId}`);
  if (!article) {
    return null;
  }
  const readingLine = root.getBoundingClientRect().top + ACTIVE_READING_OFFSET;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  let activeBlock = activeTarget?.blockId ? document.getElementById(activeTarget.blockId) : null;
  if (!activeBlock || !article.contains(activeBlock)) {
    activeBlock = null;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.top <= readingLine) {
        activeBlock = block;
      }
      if (rect.top <= readingLine && rect.bottom >= readingLine) {
        activeBlock = block;
        break;
      }
    }
  }
  const anchorElement = activeBlock ?? article;
  const activeBlockIndex = numberOrNull(activeBlock?.dataset.blockIndex);
  let headingBlockIndex: number | null = null;
  for (const block of blocks) {
    const blockIndex = numberOrNull(block.dataset.blockIndex);
    if (blockIndex === null || (activeBlockIndex !== null && blockIndex > activeBlockIndex)) {
      break;
    }
    if (block.dataset.blockType === "heading") {
      headingBlockIndex = blockIndex;
    }
  }
  const message = messages.find((item) => item.id === messageId);
  const ordinal = message?.ordinal ?? null;
  const blockOffset = Math.max(0, Math.round(readingLine - anchorElement.getBoundingClientRect().top));
  const scrollableHeight = Math.max(0, root.scrollHeight - root.clientHeight);
  const characterOffset = activeBlockIndex === null
    ? null
    : estimateCharacterOffsetAtReadingLine(root, messageId, activeBlockIndex, ACTIVE_READING_OFFSET) ?? null;
  return {
    message_id: messageId,
    block_index: activeBlockIndex,
    scroll_offset: blockOffset,
    anchor_data: {
      position_mode: "block-relative-v2",
      block_id: activeBlock?.dataset.blockId ?? null,
      version_id: message?.current_version?.id ?? null,
      order_key: message?.order_key ?? article.dataset.orderKey ?? "",
      scroll_ratio: scrollableHeight > 0 ? root.scrollTop / scrollableHeight : 0,
      block_offset: blockOffset,
      character_offset: characterOffset,
      ordinal,
      progress: ordinal && totalMessages > 0 ? Math.min(100, Math.max(0, (ordinal / totalMessages) * 100)) : null,
      heading_block_index: headingBlockIndex,
      current_version_id: message?.current_version?.id ?? null,
    },
  };
}

function findBlockIndexById(message: MessageListItem | undefined, blockId: string | null): number | null {
  if (!message || !blockId) return null;
  const blocks = message.render_blocks ?? message.current_version?.blocks ?? [];
  return blocks.find((block) => block.id === blockId)?.block_index ?? null;
}

async function restoreFocusTransitionAnchor({
  root,
  anchor,
  tokenIsCurrent,
}: {
  root: HTMLElement | null;
  anchor: ScrollAnchorSnapshot;
  tokenIsCurrent: () => boolean;
}): Promise<boolean> {
  if (!root) return false;
  const blockTarget = parseBlockTargetId(anchor.targetId);
  const deadline = window.performance.now() + 3600;
  let alignedPasses = 0;
  let blockLease: ReaderBlockLease | null = null;

  try {
    if (blockTarget) {
      blockLease = await acquireReaderBlockLease(
        blockTarget.messageId,
        blockTarget.blockIndex,
        tokenIsCurrent,
        Math.min(1600, Math.max(100, deadline - window.performance.now())),
      );
      if (!blockLease) return false;
    }
    while (tokenIsCurrent() && window.performance.now() < deadline) {
      await restoreScrollAnchor({
        root,
        anchor,
        tokenIsCurrent,
        minimumMs: 320,
        settleMs: 160,
        timeoutMs: 900,
      });
      if (!tokenIsCurrent()) return false;

      const aligned = await focusAnchorAlignedAcrossFrames(root, anchor, tokenIsCurrent);
      alignedPasses = aligned ? alignedPasses + 1 : 0;
      // Two independently measured restore passes prevent the first width-change
      // frame from ending the transition before virtual row sizes settle.
      if (alignedPasses >= 2) return true;
      await focusTransitionDelay(120);
    }
    return tokenIsCurrent() && focusAnchorError(root, anchor) <= 24;
  } finally {
    blockLease?.release();
  }
}

async function settlePreferenceLayoutAnchor({
  root,
  anchor,
  tokenIsCurrent,
}: {
  root: HTMLElement | null;
  anchor: ScrollAnchorSnapshot;
  tokenIsCurrent: () => boolean;
}): Promise<boolean> {
  if (!root) return false;
  const startedAt = window.performance.now();
  const deadline = startedAt + 2400;
  let stableFrames = 0;
  while (tokenIsCurrent() && window.performance.now() < deadline) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    compensateScrollAnchorFrame(root, anchor);
    stableFrames = focusAnchorError(root, anchor) <= 1 ? stableFrames + 1 : 0;
    // Width/font changes update the estimator first and commit TanStack's
    // rebuilt measurement cache on the following layout pass. Keep the
    // anchor lease through that second phase instead of declaring success on
    // the first three visually stable frames.
    if (window.performance.now() - startedAt >= 1000 && stableFrames >= 8) return true;
  }
  return tokenIsCurrent() && focusAnchorError(root, anchor) <= 24;
}

function parseBlockTargetId(targetId: string): { messageId: string; blockIndex: number } | null {
  const match = /^block-(.+)-(\d+)$/.exec(targetId);
  if (!match) return null;
  const blockIndex = Number(match[2]);
  return Number.isSafeInteger(blockIndex) ? { messageId: match[1], blockIndex } : null;
}

async function focusAnchorAlignedAcrossFrames(
  root: HTMLElement,
  anchor: ScrollAnchorSnapshot,
  tokenIsCurrent: () => boolean,
): Promise<boolean> {
  for (let frame = 0; frame < 3; frame += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (!tokenIsCurrent() || focusAnchorError(root, anchor) > 24) return false;
  }
  return true;
}

function focusAnchorError(root: HTMLElement, anchor: ScrollAnchorSnapshot): number {
  const target = document.getElementById(anchor.targetId);
  if (!target?.isConnected) return Number.POSITIVE_INFINITY;
  const expectedTop = root.getBoundingClientRect().top + anchor.offset;
  return Math.abs(target.getBoundingClientRect().top - expectedTop);
}

function compensateScrollAnchorFrame(root: HTMLElement | null, anchor: ScrollAnchorSnapshot): void {
  if (!root) return;
  const target = document.getElementById(anchor.targetId);
  if (!target?.isConnected) return;
  const expectedTop = root.getBoundingClientRect().top + anchor.offset;
  const delta = target.getBoundingClientRect().top - expectedTop;
  if (Math.abs(delta) > 0.5) root.scrollTop += delta;
}

function focusTransitionDelay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function formatConversationTitle(conversation: Pick<ConversationDetail, "title" | "display_title" | "project_name">): string {
  const title = (conversation.display_title || conversation.title || APP_TITLE).trim() || APP_TITLE;
  const project = conversation.project_name?.trim();
  return project ? `${project} / ${title}` : title;
}

function readerCacheIdentity(dataSource: ReaderDataSource, conversation?: Pick<ConversationDetail, "offline_revision" | "render_version">): string {
  return `${dataSource.mode}:${conversation?.offline_revision ?? "unknown"}:${conversation?.render_version ?? "unknown"}`;
}

function setNavigationStage(root: HTMLElement | null, stage: string): void {
  if (root) root.dataset.navigationStage = stage;
}

function setReaderEdgeStage(root: HTMLElement | null, stage: string): void {
  if (root) root.dataset.readerEdgeStage = stage;
}

function edgeCancellationReason(
  current: LoadedMessageWindow,
  generation: number,
  owner: "previous" | "next" | null,
  direction: ScrollDirection,
  expectedOwner: "previous" | "next",
): string {
  if (current.generation !== generation) return "generation";
  if (owner !== expectedOwner) return "ownership";
  if (expectedOwner === "previous" && direction === "down") return "direction";
  if (expectedOwner === "next" && direction === "up") return "direction";
  return "timeout";
}

function buildReaderUrl(basePath: string, location: { conversationId: string; messageId?: string; blockIndex?: number; characterOffset?: number }): string {
  const params = new URLSearchParams();
  if (basePath === "/library") params.set("conversationId", location.conversationId);
  if (location.messageId) params.set("messageId", location.messageId);
  if (location.blockIndex !== undefined) params.set("blockIndex", String(location.blockIndex));
  if (location.characterOffset !== undefined) params.set("characterOffset", String(location.characterOffset));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function applySearchHighlight(target: { targetId: string; quote: string; start?: number; end?: number; prefix?: string; suffix?: string } | null): () => void {
  const highlights = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } }).highlights;
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!target || !highlights || !HighlightConstructor || !target.quote) {
    highlights?.delete("chat-reader-search-match");
    return () => undefined;
  }
  let frame = 0;
  const apply = () => {
    const element = document.getElementById(target.targetId);
    const range = element ? resolveTextAnchorRange(element, {
      quote: target.quote,
      prefix: target.prefix,
      suffix: target.suffix,
      startOffset: target.start,
      endOffset: target.end,
    }) : null;
    if (range) highlights.set("chat-reader-search-match", new HighlightConstructor(range));
  };
  apply();
  frame = window.requestAnimationFrame(apply);
  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    highlights.delete("chat-reader-search-match");
  };
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`h-4 w-4 animate-spin rounded-full border-2 border-current/25 ${dark ? "border-t-current" : "border-t-[var(--accent)]"}`}
    />
  );
}

function ReaderState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ui bg-surface p-5">
      <h2 className="text-base font-semibold text-primary">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-secondary">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function ReaderLoadingShell({ progress, embedded = false }: { progress: number; embedded?: boolean }) {
  const t = useTranslations();
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  return (
    <main className={`flex overflow-hidden bg-page text-primary ${embedded ? "h-full w-full" : "h-screen w-screen"}`}>
      {!embedded ? <ProjectSidebar mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} /> : null}
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        {!embedded ? <MobilePageHeader title="Chat Reader" description={t("loadingMessages")} onOpenSidebar={() => setMobileSidebarOpenSignal((value) => value + 1)} className="md:hidden" /> : null}
        <div className="mx-auto w-full max-w-3xl animate-pulse space-y-10 px-3 py-12 sm:px-6 md:py-20">
          <div className="h-5 w-48 rounded bg-subtle" />
          <div className="ml-auto h-28 w-full rounded-2xl bg-subtle sm:w-2/3" />
          <div className="space-y-3">
            <div className="h-4 w-full rounded bg-subtle" />
            <div className="h-4 w-5/6 rounded bg-subtle" />
            <div className="h-4 w-3/4 rounded bg-subtle" />
          </div>
        </div>
      </section>
    </main>
  );
}
