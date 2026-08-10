"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, FileOutput, Focus, ListTree, Merge, MessageSquareText, MoreHorizontal, Paperclip, Pencil, Scissors, Search, Share2, X } from "lucide-react";
import {
  deleteMessage,
  mergeMessages,
  restoreDeletedMessage,
  saveReadingPositionKeepalive,
} from "../../lib/api";
import { remoteReaderDataSource, type ReaderDataSource, type ReaderTargetContext } from "../../lib/reader-data-source";
import type { AttachmentRead, ConversationDetail, LoadedMessageWindow, MessageListItem, NavigateTarget, NavigationResult, ReadingPositionInput, ReaderUtilityPanel, RenderBlockRead, ScrollAnchorSnapshot, ScrollDirection, TocItem } from "../../lib/types";
import { ExportPanel } from "../exporting/export-panel";
import { MobileSidebarTrigger, ProjectSidebar } from "../projects/project-sidebar";
import { SharePanel } from "../sharing/share-panel";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";
import { ResponsiveReaderFrame } from "../../components/responsive-reader-frame";
import { usePreferences, useTranslations } from "../../components/preferences-provider";
import { MessageItem } from "./message-item";
import { MessageInsertDialog } from "./message-insert-dialog";
import { captureScrollAnchor, estimateCharacterOffsetAtReadingLine, navigateMountedTarget, resolveActiveBlockDomId, restoreScrollAnchor } from "./reader-navigation";
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
import { ConversationSearchPanel } from "../search/conversation-search-panel";
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
import { FloatingWorkspacePanel } from "../../components/floating-workspace-panel";

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
  const projectContextId = searchParams.get("projectId") ?? undefined;
  const queryClient = useQueryClient();
  const targetMessageId = searchParams.get("messageId");
  const targetBlockIndex = numberOrNull(searchParams.get("blockIndex"));
  const targetCharacterOffset = numberOrNull(searchParams.get("characterOffset"));
  const [loadedWindow, setLoadedWindow] = useState<LoadedMessageWindow>(() => emptyLoadedWindow());
  const messages = loadedWindow.items;
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showShare, setShowShare] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const filesPreferenceReadyRef = useRef(false);
  const [splitWorkspaceOpen, setSplitWorkspaceOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(searchParams.get("annotations") === "open");
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

  useEffect(() => {
    const saved = window.localStorage.getItem("chat-reader:conversation-files-open");
    if (saved === "true") setShowFiles(true);
    filesPreferenceReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!filesPreferenceReadyRef.current) return;
    window.localStorage.setItem("chat-reader:conversation-files-open", String(showFiles));
  }, [showFiles]);
  const [targetHighlightId, setTargetHighlightId] = useState<string | null>(null);
  const [navigationStatus, setNavigationStatus] = useState<"idle" | "loading" | "failed" | "stale">("idle");
  const [pendingTargetMessageId, setPendingTargetMessageId] = useState<string | null>(targetMessageId);
  const [initialPaintReady, setInitialPaintReady] = useState(false);
  const isOffline = dataSource.mode === "offline";
  const canManageCanonical = dataSource.capabilities.canonicalManagement;
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
  const navigationTokenRef = useRef(0);
  const previousTurnAnchorRef = useRef<string | null>(null);
  const nextTurnAnchorRef = useRef<string | null>(null);
  const focusAnchorRef = useRef<ReturnType<typeof captureScrollAnchor>>(null);
  const focusTransitionRef = useRef(0);
  const preferenceAnchorRef = useRef<ReturnType<typeof captureScrollAnchor>>(null);
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
      const anchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
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
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedSignatureRef = useRef("");
  const latestStablePositionRef = useRef<ReadingPositionInput | null>(null);
  const messagesRef = useRef<MessageListItem[]>([]);
  const userScrollIntentRef = useRef(false);
  const lastReaderUserIntentAtRef = useRef(0);
  const navigationInProgressRef = useRef(false);

  const mobileHeaderVisible = useMobileHeaderAutoHide({
    scrollRootRef: scrollContainerRef,
    forcedVisible: mobileActionsExpanded || utilityPanel !== null,
    resetKey: `${conversationId}:${navigationStatus}`,
  });

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
    void dataSource.recordRecent(conversationId, projectContextId ?? null).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    }).catch(() => undefined);
  }, [conversationId, dataSource, projectContextId, queryClient]);

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

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;
    let pointerDragging = false;
    let pointerScrollTop = root.scrollTop;
    let lastTouchY: number | null = null;
    const markScrollIntent = (direction: ScrollDirection = null) => {
      userScrollIntentRef.current = true;
      scrollIntentSequenceRef.current += 1;
      lastReaderUserIntentAtRef.current = Date.now();
      if (direction) {
        scrollDirectionRef.current = direction;
        root.dataset.readerIntentDirection = direction;
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
    };
    const handleScroll = () => {
      const current = root.scrollTop;
      if (pointerDragging && Math.abs(current - pointerScrollTop) > 1) {
        markScrollIntent(current < pointerScrollTop ? "up" : "down");
      }
      pointerScrollTop = current;
      if (
        userScrollIntentRef.current &&
        edgeTransitionRef.current === null &&
        !loadingPreviousRef.current &&
        !loadingNextRef.current &&
        scrollDirectionRef.current !== null
      ) {
        const edgeThreshold = root.clientHeight * 0.45;
        if (scrollDirectionRef.current === "up" && current <= edgeThreshold) {
          loadPreviousActionRef.current();
        }
        if (
          scrollDirectionRef.current === "down" &&
          root.scrollHeight - root.clientHeight - current <= edgeThreshold
        ) {
          loadNextActionRef.current();
        }
      }
    };
    const markWheelIntent = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      markScrollIntent(event.deltaY < 0 ? "up" : "down");
    };
    const markTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
      markScrollIntent();
    };
    const markTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined || lastTouchY === null || Math.abs(currentY - lastTouchY) <= 1) return;
      markScrollIntent(currentY < lastTouchY ? "down" : "up");
      lastTouchY = currentY;
    };
    const markPointerDown = () => {
      pointerDragging = true;
      pointerScrollTop = root.scrollTop;
    };
    const markPointerUp = () => {
      pointerDragging = false;
    };
    const markKeyboardIntent = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["arrowup", "arrowdown", "pageup", "pagedown", "home", "end", " ", "j", "k"].includes(key)) return;
      markScrollIntent(["arrowup", "pageup", "home", "k"].includes(key) ? "up" : "down");
    };
    root.addEventListener("scroll", handleScroll, { passive: true });
    root.addEventListener("wheel", markWheelIntent, { passive: true });
    root.addEventListener("touchstart", markTouchStart, { passive: true });
    root.addEventListener("touchmove", markTouchMove, { passive: true });
    root.addEventListener("pointerdown", markPointerDown, { passive: true });
    window.addEventListener("pointerup", markPointerUp, { passive: true });
    window.addEventListener("pointercancel", markPointerUp, { passive: true });
    window.addEventListener("keydown", markKeyboardIntent);
    return () => {
      root.removeEventListener("scroll", handleScroll);
      root.removeEventListener("wheel", markWheelIntent);
      root.removeEventListener("touchstart", markTouchStart);
      root.removeEventListener("touchmove", markTouchMove);
      root.removeEventListener("pointerdown", markPointerDown);
      window.removeEventListener("pointerup", markPointerUp);
      window.removeEventListener("pointercancel", markPointerUp);
      window.removeEventListener("keydown", markKeyboardIntent);
    };
  }, [initialPaintReady]);

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

  useEffect(() => {
    loadPreviousActionRef.current = () => void loadPreviousWindow();
    loadNextActionRef.current = () => void loadNextWindow();
  }, [loadNextWindow, loadPreviousWindow]);

  useEffect(() => {
    if (!activeMessageId || !userScrollIntentRef.current || edgeTransitionRef.current !== null) return;
    const activeTurnIndex = loadedWindow.turns.findIndex((turn) => (
      turn.items.some((message) => message.id === activeMessageId)
    ));
    if (activeTurnIndex < 0) return;
    if (scrollDirectionRef.current === "down" && activeTurnIndex === loadedWindow.turns.length - 1) {
      void loadNextWindow();
    }
    if (scrollDirectionRef.current === "up" && activeTurnIndex === 0) {
      void loadPreviousWindow();
    }
  }, [activeMessageId, loadNextWindow, loadPreviousWindow, loadedWindow.turns]);

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
          window.setTimeout(() => {
            if (navigationTokenRef.current === token) {
              setTargetHighlightId(null);
              setNavigationStatus("idle");
            }
          }, 2000);
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

  const refreshActiveMessageFromLayout = useCallback((unlockNavigation = false) => {
    if (unlockNavigation) {
      setPendingTargetMessageId(null);
    }
    const root = scrollContainerRef.current;
    const nextActiveId = resolveActiveMessageId(root);
    if (nextActiveId) {
      setActiveMessageId(nextActiveId);
      setActiveBlockId(resolveActiveBlockDomId(root, nextActiveId, ACTIVE_READING_OFFSET));
    }
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
        if (
          userScrollIntentRef.current &&
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
    return () => observer.disconnect();
  }, [hasPrevious, loadPreviousWindow, messages.length]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasMore) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          userScrollIntentRef.current &&
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
    return () => observer.disconnect();
  }, [hasMore, loadNextWindow]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || messages.length === 0) {
      return undefined;
    }
    let frame = 0;
    const scheduleRefresh = (unlockNavigation = false) => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshActiveMessageFromLayout(unlockNavigation);
      });
    };
    const onManualIntent = () => scheduleRefresh(true);
    const onScroll = () => scheduleRefresh(false);
    root.addEventListener("pointerdown", onManualIntent, { passive: true });
    root.addEventListener("wheel", onManualIntent, { passive: true });
    root.addEventListener("touchstart", onManualIntent, { passive: true });
    root.addEventListener("click", onManualIntent, { passive: true });
    root.addEventListener("scroll", onScroll, { passive: true });
    scheduleRefresh(false);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      root.removeEventListener("pointerdown", onManualIntent);
      root.removeEventListener("wheel", onManualIntent);
      root.removeEventListener("touchstart", onManualIntent);
      root.removeEventListener("click", onManualIntent);
      root.removeEventListener("scroll", onScroll);
    };
  }, [messages, refreshActiveMessageFromLayout]);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) {
      return undefined;
    }

    const persist = (keepalive = false) => {
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
      if (!keepalive && signature === lastSavedSignatureRef.current) {
        return;
      }
      lastSavedSignatureRef.current = signature;
      latestStablePositionRef.current = payload;
      if (keepalive) {
        if (dataSource.mode === "remote") saveReadingPositionKeepalive(conversationId, payload);
        else void dataSource.saveReadingPosition(conversationId, payload).catch(() => undefined);
      } else {
        void dataSource.saveReadingPosition(conversationId, payload).catch(() => undefined);
      }
    };

    const schedule = () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        persist(false);
      }, 1000);
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

    root.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      root.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [conversationId, dataSource, initialPaintReady]);

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
  const tocObserverKey = useMemo(
    () => `${activeMessageId ?? "none"}:${messages.length}`,
    [activeMessageId, messages.length],
  );
  function currentReaderLocation(): { conversationId: string; messageId?: string; blockIndex?: number; characterOffset?: number } {
    const root = scrollContainerRef.current;
    const position = root ? captureReadingPosition(root, messagesRef.current, total) : null;
    const messageId = position?.message_id ?? resolveActiveMessageId(root) ?? activeMessageId ?? undefined;
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
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "撤销失败，消息尚未恢复。";
      setDeletedMessage((current) => current ? { ...current, status: "restore_failed", error: messageText } : current);
      window.dispatchEvent(new CustomEvent("chat-reader:toast", { detail: { message: messageText, tone: "error", persist: true } }));
    }
  }

  const openUtilityPanel = useCallback(async (panel: Exclude<ReaderUtilityPanel, null | "navigation">) => {
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
      if (showSearch || showShare || showExport || showFiles) { setShowSearch(false); setShowShare(false); setShowExport(false); setShowFiles(false); event.preventDefault(); return; }
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
    ...(canManageCanonical ? [{
      id: "conversation-files",
      label: resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files",
      icon: Paperclip,
      onSelect: () => { void openUtilityPanel("files"); },
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
    <ConversationToc conversationId={conversationId} sourceKey={readerSourceKey} activeMessageId={activeMessageId} activeItems={activeTocItems} activeBlockId={activeBlockId} observerKey={tocObserverKey} mode="sheet" loadPage={(options) => dataSource.getToc(conversationId, options)} onNavigate={async (item) => {
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
            <button type="button" onClick={() => setMobileActionsExpanded(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--text)] text-[var(--surface)]" aria-label={t("more")} title={t("more")}><MoreHorizontal className="h-5 w-5" /></button>
          </div>}
          {!focusMode && navigationStatus === "loading" ? <div className="border-t border-ui bg-subtle px-[3vw] py-2 text-sm text-accent" role="status">{t("locating")}</div> : null}
          {!focusMode && navigationStatus === "stale" ? <div className="border-t border-ui bg-amber-50 px-[3vw] py-2 text-sm text-amber-800" role="status">{t("locateChanged")}</div> : null}
          {!focusMode && navigationStatus === "failed" ? <div className="border-t border-ui bg-[var(--danger-soft)] px-[3vw] py-2 text-sm text-[var(--danger)]" role="alert">{t("locateFailed")}</div> : null}
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
                  activeBlockId={activeBlockId}
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
        header={navigationTabs}
        status={<>{mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}{mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}</>}
      >
        {navigationContent}
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "search" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={t("search")} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("search")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <ConversationSearchPanel conversationId={conversation.id} dataSource={dataSource} sourceKey={readerSourceKey} onNavigate={({ messageId, blockIndex, characterOffset }) => navigateToTarget({ messageId, blockIndex, characterOffset, source: "search" })} onClose={() => setUtilityPanel(null)} showHeader={false} />
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
      <MobileReaderSheet open={utilityPanel === "share" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={t("shareConversation")} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("shareConversation")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <div className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto py-3"><SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} compact /></div>
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "export" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={t("export")} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("export")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <div className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto py-3"><ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} compact readingStartMessageId={activeMessageId} /></div>
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "files" && !sourceEditorTarget} onOpenChange={(open) => { if (!open && !sourceEditorTarget) setUtilityPanel(null); }} title={resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files"} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files"}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <ConversationFilesPanel conversationId={conversation.id} onLocate={async (messageId, blockIndex) => { setUtilityPanel(null); await navigateToTarget({ messageId, blockIndex, source: "message-action" }); }} onInsert={insertConversationAttachment} />
      </MobileReaderSheet>
      {!focusMode && (showShare || showExport || showSearch) ? (
        <ReaderUtilityDrawer active={!sourceEditorTarget} label={showSearch ? t("search") : showShare ? t("shareConversation") : t("export")} onClose={closeDesktopUtilityPanels}>
            <div className="flex h-full min-w-0 w-full overflow-hidden">
              {showSearch ? <ConversationSearchPanel conversationId={conversation.id} dataSource={dataSource} sourceKey={readerSourceKey} onNavigate={({ messageId, blockIndex, characterOffset }) => navigateToTarget({ messageId, blockIndex, characterOffset, source: "search" })} onClose={() => setShowSearch(false)} /> : <ReaderPanelShell title={showShare ? t("shareConversation") : t("export")} closeLabel={t("close")} onClose={() => { setShowShare(false); setShowExport(false); }}>
                {showShare ? <SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
                {showExport ? <ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} readingStartMessageId={activeMessageId} /> : null}
              </ReaderPanelShell>}
            </div>
        </ReaderUtilityDrawer>
      ) : null}
      {!focusMode && showFiles ? (
        <FloatingWorkspacePanel
          storageKey="chat-reader:conversation-files-workspace"
          placement="floating"
          testId="conversation-files-workspace"
          title={resolvedLocale === "zh-CN" ? "当前对话文件" : "Conversation files"}
          closeLabel={t("close")}
          resetLabel={resolvedLocale === "zh-CN" ? "重置文件窗口位置" : "Reset file window position"}
          onClose={() => setShowFiles(false)}
        >
          <ConversationFilesPanel
            conversationId={conversation.id}
            onLocate={async (messageId, blockIndex) => { await navigateToTarget({ messageId, blockIndex, source: "message-action" }); }}
            onInsert={insertConversationAttachment}
          />
        </FloatingWorkspacePanel>
      ) : null}
      <AnnotationWorkspace
        conversationId={conversation.id}
        messages={messages}
        activeMessageId={activeMessageId}
        initialAnnotationId={searchParams.get("annotationId")}
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
      {deletedMessage ? <div role={deletedMessage.status === "restore_failed" ? "alert" : "status"} aria-live="assertive" className="fixed bottom-4 left-1/2 z-[280] flex max-w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-ui bg-raised px-4 py-3 text-sm text-primary shadow-xl"><span className="min-w-0 flex-1">{deletedMessage.status === "restore_failed" ? (deletedMessage.error ?? "撤销失败，消息尚未恢复。") : deletedMessage.status === "restoring" ? "正在恢复消息…" : "消息已删除"}</span>{deletedMessage.status !== "restoring" ? <button type="button" onClick={() => void restoreReaderMessage()} className="min-h-10 shrink-0 rounded-lg px-3 font-medium text-accent hover:bg-[var(--accent-soft)]">{deletedMessage.status === "restore_failed" ? "重试" : "撤销"}</button> : null}</div> : null}
    </main>
  );
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

function resolveActiveMessageId(root: HTMLElement | null): string | null {
  const messages = Array.from(document.querySelectorAll<HTMLElement>("article[data-message-id]"));
  if (messages.length === 0) {
    return null;
  }
  const rootRect = root?.getBoundingClientRect();
  const viewportTop = rootRect?.top ?? 0;
  const readingLine = viewportTop + ACTIVE_READING_OFFSET;
  let nearest: { id: string; distance: number } | null = null;

  for (const message of messages) {
    const rect = message.getBoundingClientRect();
    const id = message.dataset.messageId;
    if (!id) {
      continue;
    }
    if (rect.top <= readingLine && rect.bottom >= readingLine) {
      return id;
    }
    const distance = Math.min(Math.abs(rect.top - readingLine), Math.abs(rect.bottom - readingLine));
    if (!nearest || distance < nearest.distance) {
      nearest = { id, distance };
    }
  }

  return nearest?.id ?? null;
}

function captureReadingPosition(
  root: HTMLElement,
  messages: MessageListItem[],
  totalMessages: number,
): ReadingPositionInput | null {
  const messageId = resolveActiveMessageId(root);
  if (!messageId) {
    return null;
  }
  const article = document.getElementById(`message-${messageId}`);
  if (!article) {
    return null;
  }
  const readingLine = root.getBoundingClientRect().top + ACTIVE_READING_OFFSET;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  let activeBlock: HTMLElement | null = null;
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
  const deadline = startedAt + 1200;
  let stableFrames = 0;
  while (tokenIsCurrent() && window.performance.now() < deadline) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    compensateScrollAnchorFrame(root, anchor);
    stableFrames = focusAnchorError(root, anchor) <= 1 ? stableFrames + 1 : 0;
    if (window.performance.now() - startedAt >= 240 && stableFrames >= 3) return true;
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
