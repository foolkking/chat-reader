"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Layers3, ListTree, Merge, MessageSquareText, Scissors, Search, Share2, X } from "lucide-react";
import {
  mergeMessages,
  saveReadingPositionKeepalive,
  splitConversation,
} from "../../lib/api";
import { remoteReaderDataSource, type ReaderDataSource } from "../../lib/reader-data-source";
import type { LoadedMessageWindow, MessageListItem, MessageWindowResponse, NavigateTarget, NavigationResult, NeighborhoodExpansionState, ReadingPositionInput, ReaderUtilityPanel, RenderBlockRead, ScrollDirection, TocItem } from "../../lib/types";
import { ExportPanel } from "../exporting/export-panel";
import { ProjectSidebar } from "../projects/project-sidebar";
import { SharePanel } from "../sharing/share-panel";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";
import { ResponsiveReaderFrame } from "../../components/responsive-reader-frame";
import { useTranslations } from "../../components/preferences-provider";
import { MessageItem } from "./message-item";
import { captureScrollAnchor, navigateMountedTarget, restoreScrollAnchor } from "./reader-navigation";
import { appendLoadedWindow, emptyLoadedWindow, prependLoadedWindow, replaceLoadedWindow } from "./reader-window";
import { hasCompleteBlockSet, resolveNeighborhoodRange } from "./neighborhood-expansion";
import { ReaderHeaderActionRail, type ReaderHeaderAction } from "../../components/reader-header-action-rail";
import { MobileReaderSheet } from "../../components/mobile-reader-sheet";
import { ReaderPanelShell } from "../../components/reader-panel-shell";
import { useMobileHeaderAutoHide } from "./use-mobile-header-auto-hide";
import { ConversationSearchPanel } from "../search/conversation-search-panel";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { AnnotationWorkspace } from "../annotations/annotation-workspace";
import { offlineAnnotationRepository, remoteAnnotationRepository } from "../../lib/annotation-repository";
import { ResizableDockPanel } from "../../components/resizable-pane";

const PAGE_SIZE = 30;
const BLOCK_PAGE_SIZE = 20;
const ACTIVE_READING_OFFSET = 120;
const ANCHOR_BEFORE = 12;

export function ConversationReader({
  conversationId,
  dataSource = remoteReaderDataSource,
  libraryMode = false,
  onOpenLibrary,
}: {
  conversationId: string;
  dataSource?: ReaderDataSource;
  libraryMode?: boolean;
  onOpenLibrary?: () => void;
}) {
  const t = useTranslations();
  const dialog = useInteractionDialog();
  const searchParams = useSearchParams();
  const projectContextId = searchParams.get("projectId") ?? undefined;
  const queryClient = useQueryClient();
  const targetMessageId = searchParams.get("messageId");
  const targetBlockIndex = numberOrNull(searchParams.get("blockIndex"));
  const [loadedWindow, setLoadedWindow] = useState<LoadedMessageWindow>(() => emptyLoadedWindow());
  const messages = loadedWindow.items;
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showShare, setShowShare] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(searchParams.get("annotations") === "open");
  const [desktopActionsExpanded, setDesktopActionsExpanded] = useState(false);
  const [mobileActionsExpanded, setMobileActionsExpanded] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<ReaderUtilityPanel>(null);
  const [navigationTab, setNavigationTab] = useState<"dialogue" | "sections">("dialogue");
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const [mobileNavigation, setMobileNavigation] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [targetHighlightId, setTargetHighlightId] = useState<string | null>(null);
  const [pendingTargetMessageId, setPendingTargetMessageId] = useState<string | null>(targetMessageId);
  const [expandedHeavyMessageIds, setExpandedHeavyMessageIds] = useState<Set<string>>(new Set());
  const [blockCache, setBlockCache] = useState<Record<string, RenderBlockRead[]>>({});
  const [neighborhoodExpansion, setNeighborhoodExpansion] = useState<NeighborhoodExpansionState>({
    active: false,
    current: 0,
    total: 0,
    error: null,
  });
  const [initialPaintReady, setInitialPaintReady] = useState(false);
  const annotationRepository = libraryMode ? offlineAnnotationRepository : remoteAnnotationRepository;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadPreviousSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingPreviousRef = useRef(false);
  const loadingNextRef = useRef(false);
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
  const navigationLockUntilRef = useRef(0);
  const restoreAttemptedRef = useRef(false);
  const restoreInProgressRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedSignatureRef = useRef("");
  const messagesRef = useRef<MessageListItem[]>([]);
  const blockCacheRef = useRef<Record<string, RenderBlockRead[]>>({});
  const blockRequestsRef = useRef(new Map<string, Promise<RenderBlockRead[]>>());
  const userScrollIntentRef = useRef(false);
  const neighborhoodExpansionRef = useRef({ active: false, generation: 0 });

  const mobileHeaderVisible = useMobileHeaderAutoHide({
    scrollRootRef: scrollContainerRef,
    forcedVisible: mobileActionsExpanded || utilityPanel !== null,
    resetKey: conversationId,
  });

  const conversationQuery = useQuery({
    queryKey: ["conversation", dataSource.mode, conversationId],
    queryFn: () => dataSource.getConversation(conversationId),
  });

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
    queryKey: ["message-window", conversationId, "initial", initialAnchorMessageId],
    queryFn: () =>
      dataSource.getMessageWindow(conversationId, {
        includeBlocks: false,
        limit: PAGE_SIZE,
        offset: 0,
        anchorMessageId: initialAnchorMessageId ?? undefined,
        anchorBefore: ANCHOR_BEFORE,
        contentMode: "preview",
      }),
    enabled: canLoadInitialWindow,
  });

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;
    const handleScroll = () => {
      const current = root.scrollTop;
      const delta = current - (root.dataset.previousScrollTop ? Number(root.dataset.previousScrollTop) : current);
      root.dataset.previousScrollTop = String(current);
      if (
        Math.abs(delta) > 1 &&
        !userScrollIntentRef.current &&
        Date.now() >= navigationLockUntilRef.current
      ) {
        userScrollIntentRef.current = true;
        scrollIntentSequenceRef.current += 1;
      }
      if (userScrollIntentRef.current && Math.abs(delta) > 1) {
        scrollDirectionRef.current = delta < 0 ? "up" : "down";
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
    const markScrollIntent = () => {
      userScrollIntentRef.current = true;
      scrollIntentSequenceRef.current += 1;
    };
    const markKeyboardIntent = (event: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      markScrollIntent();
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) scrollDirectionRef.current = "up";
      if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) scrollDirectionRef.current = "down";
    };
    root.addEventListener("scroll", handleScroll, { passive: true });
    root.addEventListener("wheel", markScrollIntent, { passive: true });
    root.addEventListener("touchstart", markScrollIntent, { passive: true });
    window.addEventListener("keydown", markKeyboardIntent);
    return () => {
      root.removeEventListener("scroll", handleScroll);
      root.removeEventListener("wheel", markScrollIntent);
      root.removeEventListener("touchstart", markScrollIntent);
      window.removeEventListener("keydown", markKeyboardIntent);
    };
  }, []);

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
    setEdgeLoading(null);
    setEdgeError(null);
    setActiveMessageId(targetMessageId);
    setActiveBlockId(null);
    setSelectedMessageIds(new Set());
    setPendingTargetMessageId(targetMessageId);
    setExpandedHeavyMessageIds(new Set());
    setBlockCache({});
    blockCacheRef.current = {};
    blockRequestsRef.current.clear();
    userScrollIntentRef.current = false;
    scrollDirectionRef.current = null;
    scrollIntentSequenceRef.current += 1;
    neighborhoodExpansionRef.current = { active: false, generation: neighborhoodExpansionRef.current.generation + 1 };
    setNeighborhoodExpansion({ active: false, current: 0, total: 0, error: null });
    setInitialPaintReady(false);
    restoreAttemptedRef.current = false;
    restoreInProgressRef.current = false;
    lastSavedSignatureRef.current = "";
  }, [conversationId, targetMessageId]);

  useEffect(() => {
    messagesRef.current = messages;
    pruneMessageState(messages.map((message) => message.id));
  }, [messages]);

  useEffect(() => {
    if (!activeMessageId || messages.length === 0) return;
    const activeIndex = messages.findIndex((message) => message.id === activeMessageId);
    if (activeIndex < 0) return;
    const nearby = messages
      .slice(activeIndex, activeIndex + 1)
      .filter((message) => message.is_heavy && !expandedHeavyMessageIds.has(message.id));
    if (nearby.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const message of nearby) {
        await ensureMessageBlocks(message);
        if (cancelled) return;
        setExpandedHeavyMessageIds((current) => new Set(current).add(message.id));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMessageId, expandedHeavyMessageIds, messages]);

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
    if (!root || neighborhoodExpansionRef.current.active || loadingPreviousRef.current || !current.hasPrevious) return;
    loadingPreviousRef.current = true;
    setEdgeLoading("previous");
    setEdgeError(null);
    const generation = current.generation;
    try {
      const previousOffset = Math.max(0, current.startOffset - PAGE_SIZE);
      const page = await dataSource.getMessageWindow(conversationId, {
        includeBlocks: false,
        limit: current.startOffset - previousOffset,
        offset: previousOffset,
        contentMode: "preview",
      });
      if (loadedWindowRef.current.generation !== generation) return;
      const anchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
      const intentSequence = scrollIntentSequenceRef.current;
      const next = prependLoadedWindow(loadedWindowRef.current, page);
      applyLoadedWindow(next);
      if (anchor) {
        await restoreScrollAnchor({
          root,
          anchor,
          tokenIsCurrent: () => (
            loadedWindowRef.current.generation === generation &&
            scrollIntentSequenceRef.current === intentSequence
          ),
        });
      }
    } catch {
      if (loadedWindowRef.current.generation === generation) setEdgeError("previous");
    } finally {
      loadingPreviousRef.current = false;
      setEdgeLoading((currentLoading) => currentLoading === "previous" ? null : currentLoading);
    }
  }, [applyLoadedWindow, conversationId]);

  const loadNextWindow = useCallback(async () => {
    const root = scrollContainerRef.current;
    const current = loadedWindowRef.current;
    if (!root || neighborhoodExpansionRef.current.active || loadingNextRef.current || !current.hasMore) return;
    loadingNextRef.current = true;
    setEdgeLoading("next");
    setEdgeError(null);
    const generation = current.generation;
    try {
      const page = await dataSource.getMessageWindow(conversationId, {
        includeBlocks: false,
        limit: PAGE_SIZE,
        offset: current.endOffset,
        contentMode: "preview",
      });
      if (loadedWindowRef.current.generation !== generation) return;
      const anchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
      const intentSequence = scrollIntentSequenceRef.current;
      const next = appendLoadedWindow(loadedWindowRef.current, page);
      const trimmedTop = next.startOffset > loadedWindowRef.current.startOffset;
      applyLoadedWindow(next);
      if (trimmedTop && anchor) {
        await restoreScrollAnchor({
          root,
          anchor,
          tokenIsCurrent: () => (
            loadedWindowRef.current.generation === generation &&
            scrollIntentSequenceRef.current === intentSequence
          ),
        });
      }
    } catch {
      if (loadedWindowRef.current.generation === generation) setEdgeError("next");
    } finally {
      loadingNextRef.current = false;
      setEdgeLoading((currentLoading) => currentLoading === "next" ? null : currentLoading);
    }
  }, [applyLoadedWindow, conversationId]);

  useEffect(() => {
    loadPreviousActionRef.current = () => void loadPreviousWindow();
    loadNextActionRef.current = () => void loadNextWindow();
  }, [loadNextWindow, loadPreviousWindow]);

  const navigateToTarget = useCallback(
    async ({ messageId, blockIndex, characterOffset, alignmentOffset }: NavigateTarget): Promise<NavigationResult> => {
      neighborhoodExpansionRef.current = {
        active: false,
        generation: neighborhoodExpansionRef.current.generation + 1,
      };
      setNeighborhoodExpansion((current) => current.active ? { ...current, active: false } : current);
      const token = navigationTokenRef.current + 1;
      navigationTokenRef.current = token;
      const generation = windowGenerationRef.current + 1;
      windowGenerationRef.current = generation;
      applyLoadedWindow({ ...loadedWindowRef.current, generation });
      userScrollIntentRef.current = false;
      scrollDirectionRef.current = null;
      scrollIntentSequenceRef.current += 1;
      navigationLockUntilRef.current = Date.now() + 5000;
      const blockId = blockIndex === undefined ? null : `block-${messageId}-${blockIndex}`;
      const messageIdDom = `message-${messageId}`;
      setActiveMessageId(messageId);
      setActiveBlockId(blockId);
      setTargetHighlightId(blockId ?? messageIdDom);

      try {
        let targetPage: MessageWindowResponse | null = null;
        if (!document.getElementById(messageIdDom)) {
          const page = await dataSource.getMessageWindow(conversationId, {
            includeBlocks: false,
            limit: PAGE_SIZE,
            anchorMessageId: messageId,
            anchorBefore: ANCHOR_BEFORE,
            contentMode: "preview",
          });
          if (navigationTokenRef.current !== token) {
            return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
          }
          targetPage = page;
          initialWindowAppliedRef.current = true;
          applyLoadedWindow(replaceLoadedWindow(page, generation));
        }

        if (blockIndex !== undefined) {
          const knownMessage =
            targetPage?.items.find((message) => message.id === messageId) ??
            loadedWindowRef.current.items.find((message) => message.id === messageId) ??
            (await dataSource.getMessageWindow(conversationId, {
              includeBlocks: false,
              limit: 1,
              anchorMessageId: messageId,
              anchorBefore: 0,
              contentMode: "preview",
            })).items.find((message) => message.id === messageId);
          const cachedBlocks = blockCacheRef.current[messageId] ?? [];
          const contextStart = Math.max(0, blockIndex - 20);
          const contextEnd = Math.min(Math.max((knownMessage?.block_count ?? 1) - 1, 0), blockIndex + 20);
          const cachedBounds = getBlockBounds(cachedBlocks);
          const needsTargetWindow =
            !cachedBlocks.some((block) => block.block_index === blockIndex) ||
            cachedBounds === null ||
            cachedBounds.min > contextStart ||
            cachedBounds.max < contextEnd;
          if (knownMessage && !messageHasInlineBlock(knownMessage, blockIndex) && needsTargetWindow) {
            await loadBlockPage(messageId, contextStart, Math.max(BLOCK_PAGE_SIZE, contextEnd - contextStart + 1));
            if (navigationTokenRef.current !== token) {
              return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
            }
          }
          setExpandedHeavyMessageIds((current) => new Set(current).add(messageId));
        }

        const result = await navigateMountedTarget({
          root: scrollContainerRef.current,
          targetId: blockId ?? messageIdDom,
          fallbackId: blockId ? messageIdDom : undefined,
          tokenIsCurrent: () => navigationTokenRef.current === token,
          offset: alignmentOffset ?? 12,
          characterOffset: blockId ? characterOffset : undefined,
        });
        if (result.ok) {
          setActiveMessageId(messageId);
          setActiveBlockId(blockId);
          if (characterOffset === undefined) {
            await restoreScrollAnchor({
              root: scrollContainerRef.current,
              anchor: { targetId: result.targetId, offset: alignmentOffset ?? 12 },
              tokenIsCurrent: () => navigationTokenRef.current === token && !userScrollIntentRef.current,
            });
          }
          window.setTimeout(() => {
            if (navigationTokenRef.current === token) {
              setTargetHighlightId(null);
              setActiveBlockId(null);
            }
          }, 2000);
        }
        return result;
      } catch {
        return { ok: false, targetId: blockId ?? messageIdDom, reason: "load-failed" };
      }
    },
    [applyLoadedWindow, conversationId],
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
      navigationLockUntilRef.current = 0;
      setPendingTargetMessageId(null);
    }
    if (!unlockNavigation && Date.now() < navigationLockUntilRef.current) {
      return;
    }
    const nextActiveId = resolveActiveMessageId(scrollContainerRef.current);
    if (nextActiveId) {
      setActiveMessageId(nextActiveId);
      setActiveBlockId(null);
    }
  }, []);

  useEffect(() => {
    const messageId = pendingTargetMessageId ?? targetMessageId;
    if (!messageId) {
      return;
    }
    void navigateToTarget({ messageId, blockIndex: targetBlockIndex ?? undefined, source: "search" }).finally(() => {
      restoreAttemptedRef.current = true;
      setPendingTargetMessageId(null);
    });
  }, [navigateToTarget, pendingTargetMessageId, targetBlockIndex, targetMessageId]);

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
    if (!position?.message_id) {
      return;
    }
    restoreInProgressRef.current = true;
    const anchor = position.anchor_data ?? {};
    const headingBlockIndex = numberOrNull(anchor.heading_block_index);
    const blockIndex = position.block_index;
    const isBlockRelative = anchor.position_mode === "block-relative-v1";
    const candidates: Array<number | undefined> = [
      blockIndex ?? undefined,
      headingBlockIndex ?? undefined,
      undefined,
    ].filter(
      (value, index, values) => values.indexOf(value) === index,
    );
    void (async () => {
      for (const candidate of candidates) {
        const alignmentOffset = candidate === undefined
          ? ACTIVE_READING_OFFSET
          : ACTIVE_READING_OFFSET - (isBlockRelative ? position.scroll_offset : 0);
        const result = await navigateToTarget({
          messageId: position.message_id as string,
          blockIndex: candidate,
          alignmentOffset,
          source: "message-action",
        });
        if (result.ok) {
          return;
        }
      }
    })().finally(() => {
      restoreInProgressRef.current = false;
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
      setActiveMessageId(null);
      return undefined;
    }

    let bestId = messages[0]?.id ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < navigationLockUntilRef.current) {
          return;
        }
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
        const first = visible[0]?.target;
        if (first instanceof HTMLElement) {
          bestId = first.dataset.messageId ?? bestId;
          setActiveMessageId(bestId);
        }
      },
      { root, rootMargin: "-110px 0px -55% 0px", threshold: [0, 0.25, 0.75] },
    );

    for (const message of messages) {
      const target = document.getElementById(`message-${message.id}`);
      if (target) {
        observer.observe(target);
      }
    }

    if (!activeMessageId && bestId) {
      setActiveMessageId(bestId);
    }
    return () => observer.disconnect();
  }, [messages]);

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
      if (!restoreAttemptedRef.current || restoreInProgressRef.current) {
        return;
      }
      const payload = captureReadingPosition(root, messagesRef.current);
      if (!payload) {
        return;
      }
      const signature = JSON.stringify(payload);
      if (!keepalive && signature === lastSavedSignatureRef.current) {
        return;
      }
      lastSavedSignatureRef.current = signature;
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
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persist(true);
      }
    };
    const onPageHide = () => persist(true);

    root.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persist(true);
      root.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [conversationId, initialPaintReady]);

  const conversation = conversationQuery.data;
  const loadingProgress = initialPaintReady
    ? 100
    : windowQuery.isSuccess
      ? messages.length > 0 || windowQuery.data?.total === 0 ? 90 : 70
      : conversationQuery.isSuccess
        ? 25
        : 10;
  const loadedLabel = useMemo(() => `${messages.length} / ${total} 条消息`, [messages.length, total]);
  const selectedIds = useMemo(() => Array.from(selectedMessageIds), [selectedMessageIds]);
  const selectedOrderedIds = useMemo(
    () => messages.filter((message) => selectedMessageIds.has(message.id)).map((message) => message.id),
    [messages, selectedMessageIds],
  );
  const activeTocItems = useMemo(
    () => deriveActiveTocItems(messages.find((message) => message.id === activeMessageId), blockCache),
    [activeMessageId, blockCache, messages],
  );
  const tocObserverKey = useMemo(
    () => `${activeMessageId ?? "none"}:${messages.length}:${Object.keys(blockCache).length}:${expandedHeavyMessageIds.size}`,
    [activeMessageId, blockCache, expandedHeavyMessageIds.size, messages.length],
  );

  async function refreshReader() {
    windowGenerationRef.current += 1;
    const emptyWindow = emptyLoadedWindow(windowGenerationRef.current);
    loadedWindowRef.current = emptyWindow;
    setLoadedWindow(emptyWindow);
    initialWindowAppliedRef.current = false;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["message-window", conversationId] }),
      queryClient.invalidateQueries({ queryKey: ["toc", conversationId] }),
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] }),
    ]);
  }

  async function splitSelectedConversationRange() {
    if (selectedOrderedIds.length === 0) {
      return;
    }
    const title = await dialog.prompt({
      title: "New conversation title",
      label: "Conversation title",
      initialValue: `${conversation?.display_title || conversation?.title || "Conversation"} excerpt`,
      confirmLabel: "Create",
    });
    if (title === null) {
      return;
    }
    await splitConversation(conversationId, {
      startMessageId: selectedOrderedIds[0],
      endMessageId: selectedOrderedIds[selectedOrderedIds.length - 1],
      title,
    });
    setSelectedMessageIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  async function mergeSelectedMessages() {
    if (selectedIds.length < 2) return;
    if (!(await dialog.confirm({ title: `Merge ${selectedIds.length} selected messages?`, description: "The selected adjacent messages will be merged into the first message.", confirmLabel: "Merge" }))) return;
    await mergeMessages({ messageIds: selectedIds });
    setSelectedMessageIds(new Set());
    await refreshReader();
  }

  const openUtilityPanel = useCallback((panel: Exclude<ReaderUtilityPanel, null | "navigation">) => {
    setDesktopActionsExpanded(false);
    setMobileActionsExpanded(false);
    if (window.innerWidth < 768) {
      setShowShare(false);
      setShowExport(false);
      setShowSearch(false);
      setUtilityPanel(panel);
      return;
    }
    setUtilityPanel(null);
    setShowShare(panel === "share");
    setShowExport(panel === "export");
    setShowSearch(panel === "search");
  }, []);

  useEffect(() => {
    const openSearch = () => openUtilityPanel("search");
    window.addEventListener("chat-reader:open-reader-search", openSearch);
    return () => window.removeEventListener("chat-reader:open-reader-search", openSearch);
  }, [openUtilityPanel]);

  useEffect(() => {
    const closeTopSurface = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (utilityPanel !== null) { setUtilityPanel(null); event.preventDefault(); return; }
      if (showSearch || showShare || showExport) { setShowSearch(false); setShowShare(false); setShowExport(false); event.preventDefault(); return; }
      if (mobileActionsExpanded || desktopActionsExpanded) { setMobileActionsExpanded(false); setDesktopActionsExpanded(false); event.preventDefault(); }
    };
    window.addEventListener("keydown", closeTopSurface);
    return () => window.removeEventListener("keydown", closeTopSurface);
  }, [desktopActionsExpanded, mobileActionsExpanded, showExport, showSearch, showShare, utilityPanel]);

  function openNavigation(tab: "dialogue" | "sections") {
    setNavigationTab(tab);
    setMobileNavigation({ pending: false, error: null });
    setDesktopActionsExpanded(false);
    setMobileActionsExpanded(false);
    setUtilityPanel("navigation");
  }

  async function expandNeighborhood() {
    const currentMessageId = resolveActiveMessageId(scrollContainerRef.current) ?? activeMessageId;
    const root = scrollContainerRef.current;
    if (neighborhoodExpansionRef.current.active) {
      neighborhoodExpansionRef.current = {
        active: false,
        generation: neighborhoodExpansionRef.current.generation + 1,
      };
      setNeighborhoodExpansion((current) => ({ ...current, active: false }));
      return;
    }
    if (!currentMessageId || !root) return;

    const expansionGeneration = neighborhoodExpansionRef.current.generation + 1;
    neighborhoodExpansionRef.current = { active: true, generation: expansionGeneration };
    navigationTokenRef.current += 1;
    setNeighborhoodExpansion({ active: true, current: 0, total: 0, error: null });
    setEdgeLoading(null);
    setEdgeError(null);

    try {
      const indexPage = await dataSource.getDialogueIndex(conversationId, {
        anchorMessageId: currentMessageId,
        limit: 200,
      });
      if (!isCurrentExpansion(expansionGeneration)) return;
      const range = resolveNeighborhoodRange(indexPage.items, currentMessageId);
      if (!range) throw new Error("The active conversation turn could not be located.");

      const messagePage = await loadCompleteMessageRange(dataSource, conversationId, range.offset, range.limit);
      if (!isCurrentExpansion(expansionGeneration)) return;
      const preparedCache: Record<string, RenderBlockRead[]> = {};
      let completed = 0;
      setNeighborhoodExpansion({
        active: true,
        current: 0,
        total: messagePage.items.length,
        error: null,
      });

      await runWithConcurrency(messagePage.items, 2, async (message) => {
        const cached = blockCacheRef.current[message.id];
        if (hasCompleteBlockSet(cached, message.block_count)) {
          preparedCache[message.id] = cached ?? [];
        } else {
          const blocks: RenderBlockRead[] = [];
          for (let start = 0; start < message.block_count; start += 200) {
            const page = await dataSource.getMessageBlocks(message.id, {
              start,
              limit: Math.min(200, message.block_count - start),
            });
            if (page.length === 0 && start < message.block_count) {
              throw new Error(`Blocks for message ${message.id} are incomplete.`);
            }
            blocks.push(...page);
          }
          preparedCache[message.id] = mergeBlockWindows([], blocks);
        }
        completed += 1;
        if (isCurrentExpansion(expansionGeneration)) {
          setNeighborhoodExpansion({
            active: true,
            current: completed,
            total: messagePage.items.length,
            error: null,
          });
        }
      });
      if (!isCurrentExpansion(expansionGeneration)) return;

      const anchor = captureScrollAnchor(root, ACTIVE_READING_OFFSET);
      const nextGeneration = windowGenerationRef.current + 1;
      windowGenerationRef.current = nextGeneration;
      initialWindowAppliedRef.current = true;
      const nextWindow = replaceLoadedWindow(messagePage, nextGeneration);
      const expandedIds = new Set(
        messagePage.items.filter((message) => message.block_count > 0).map((message) => message.id),
      );
      blockCacheRef.current = preparedCache;
      applyLoadedWindow(nextWindow);
      setBlockCache(preparedCache);
      setExpandedHeavyMessageIds(expandedIds);

      if (anchor) {
        await restoreScrollAnchor({
          root,
          anchor,
          tokenIsCurrent: () => isCurrentExpansion(expansionGeneration),
          minimumMs: 2500,
          settleMs: 600,
          timeoutMs: 8000,
        });
      }
      if (!isCurrentExpansion(expansionGeneration)) return;
      setNeighborhoodExpansion({
        active: false,
        current: messagePage.items.length,
        total: messagePage.items.length,
        error: null,
      });
    } catch (error) {
      if (!isCurrentExpansion(expansionGeneration)) return;
      setNeighborhoodExpansion((current) => ({
        ...current,
        active: false,
        error: error instanceof Error ? error.message : t("connectionFailed"),
      }));
    } finally {
      if (neighborhoodExpansionRef.current.generation === expansionGeneration) {
        neighborhoodExpansionRef.current.active = false;
      }
    }
  }

  function isCurrentExpansion(generation: number) {
    return neighborhoodExpansionRef.current.active && neighborhoodExpansionRef.current.generation === generation;
  }

  async function ensureMessageBlocks(message: MessageListItem): Promise<RenderBlockRead[]> {
    if (blockCacheRef.current[message.id]?.length) {
      return blockCacheRef.current[message.id];
    }
    const inlineBlocks = message.render_blocks?.length
      ? message.render_blocks
      : message.current_version?.blocks;
    if (inlineBlocks && inlineBlocks.length > 0) {
      return [];
    }
    return loadBlockPage(message.id, 0, BLOCK_PAGE_SIZE);
  }

  async function loadBlockPage(
    messageId: string,
    start: number,
    limit = BLOCK_PAGE_SIZE,
    preserveReadingAnchor = false,
  ): Promise<RenderBlockRead[]> {
    const requestKey = `${messageId}:${start}:${limit}`;
    const existing = blockRequestsRef.current.get(requestKey);
    if (existing) return existing;
    const request = dataSource.getMessageBlocks(messageId, { start, limit })
      .then(async (blocks) => {
        if (!loadedWindowRef.current.items.some((message) => message.id === messageId)) return blocks;
        const root = scrollContainerRef.current;
        const anchor = preserveReadingAnchor && root
          ? captureScrollAnchor(root, ACTIVE_READING_OFFSET)
          : null;
        const intentSequence = scrollIntentSequenceRef.current;
        setBlockCache((current) => {
          const next = {
            ...current,
            [messageId]: mergeBlockWindows(current[messageId], blocks),
          };
          blockCacheRef.current = next;
          return next;
        });
        if (anchor && root) {
          await restoreScrollAnchor({
            root,
            anchor,
            tokenIsCurrent: () => scrollIntentSequenceRef.current === intentSequence,
          });
        }
        return blocks;
      })
      .finally(() => blockRequestsRef.current.delete(requestKey));
    blockRequestsRef.current.set(requestKey, request);
    return request;
  }

  function pruneMessageState(retainedIds: string[]) {
    const retained = new Set(retainedIds);
    setBlockCache((current) => {
      const entries = Object.entries(current).filter(([messageId]) => retained.has(messageId));
      if (entries.length === Object.keys(current).length) return current;
      const next = Object.fromEntries(entries);
      blockCacheRef.current = next;
      return next;
    });
    setExpandedHeavyMessageIds((current) => {
      const next = new Set(Array.from(current).filter((messageId) => retained.has(messageId)));
      return next.size === current.size ? current : next;
    });
    setSelectedMessageIds((current) => {
      const next = new Set(Array.from(current).filter((messageId) => retained.has(messageId)));
      return next.size === current.size ? current : next;
    });
  }

  async function loadAdjacentMessageBlocks(
    message: MessageListItem,
    direction: "previous" | "next",
  ): Promise<void> {
    const cached = blockCacheRef.current[message.id] ?? [];
    const bounds = getBlockBounds(cached);
    if (!bounds) {
      await ensureMessageBlocks(message);
      return;
    }
    const start = direction === "previous" ? Math.max(0, bounds.min - BLOCK_PAGE_SIZE) : bounds.max + 1;
    const limit = direction === "previous" ? bounds.min - start : BLOCK_PAGE_SIZE;
    if (limit <= 0 || start >= message.block_count) {
      return;
    }
    await loadBlockPage(message.id, start, limit, direction === "previous");
  }

  if (conversationQuery.isLoading) {
    return <ReaderLoadingShell progress={loadingProgress} />;
  }

  if (conversationQuery.isError) {
    return <ReaderState title={t("conversationUnavailable")} detail={conversationQuery.error.message} />;
  }

  if (!conversation) {
    return <ReaderState title={t("conversationUnavailable")} detail={t("noConversationPayload")} />;
  }

  const headerActions: ReaderHeaderAction[] = [
    {
      id: "search",
      label: t("search"),
      icon: Search,
      onSelect: () => libraryMode ? onOpenLibrary?.() : openUtilityPanel("search"),
    },
    {
      id: "expand-nearby",
      label: neighborhoodExpansion.active
        ? t("expandingNearby", { current: neighborhoodExpansion.current, total: neighborhoodExpansion.total })
        : t("expandNearbyHint"),
      icon: Layers3,
      busy: neighborhoodExpansion.active,
      onSelect: () => void expandNeighborhood(),
      closeOnSelect: !neighborhoodExpansion.active,
    },
    {
      id: "annotations",
      label: "批注",
      icon: MessageSquareText,
      onSelect: () => setAnnotationsOpen(true),
    },
    ...(!libraryMode ? [{
      id: "share",
      label: t("share"),
      icon: Share2,
      onSelect: () => openUtilityPanel("share"),
    } as ReaderHeaderAction] : []),
    ...(!libraryMode ? [{
      id: "export",
      label: t("export"),
      icon: Download,
      onSelect: () => openUtilityPanel("export"),
    } as ReaderHeaderAction] : []),
    ...(!libraryMode && selectedIds.length >= 2 ? [{
      id: "merge-selected",
      label: t("mergeSelected"),
      icon: Merge,
      onSelect: () => void mergeSelectedMessages(),
    }] : []),
    ...(!libraryMode && selectedOrderedIds.length > 0 ? [{
      id: "split-selected",
      label: t("splitToNewConversation"),
      icon: Scissors,
      onSelect: () => void splitSelectedConversationRange(),
    }] : []),
  ];

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
    <ConversationIndex conversationId={conversationId} activeMessageId={activeMessageId} ready={canLoadInitialWindow} mode="sheet" loadPage={(options) => dataSource.getDialogueIndex(conversationId, options)} onNavigate={async (item) => {
      setMobileNavigation({ pending: true, error: null });
      const result = await navigateToTarget({ messageId: item.messageId, source: "dialogue-index" });
      setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
      if (result.ok) setUtilityPanel(null);
    }} />
  ) : (
    <ConversationToc conversationId={conversationId} activeMessageId={activeMessageId} activeItems={activeTocItems} activeBlockId={activeBlockId} observerKey={tocObserverKey} mode="sheet" loadPage={(options) => dataSource.getToc(conversationId, options)} onNavigate={async (item) => {
      setMobileNavigation({ pending: true, error: null });
      const result = await navigateToTarget({ messageId: item.message_id, blockIndex: item.block_index, source: "section-toc" });
      setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
      if (result.ok) setUtilityPanel(null);
    }} />
  );

  return (
    <main className={`flex overflow-hidden bg-page text-primary ${libraryMode ? "h-full w-full" : "h-screen w-screen"}`}>
      {!libraryMode ? <ProjectSidebar
        currentProjectId={projectContextId}
        readerMode
        mobileOpenSignal={mobileSidebarOpenSignal}
        showMobileTrigger={false}
      /> : null}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className={`absolute inset-x-0 top-0 z-40 border-b border-ui bg-surface/95 backdrop-blur transition-transform duration-200 md:relative md:z-20 md:translate-y-0 ${mobileHeaderVisible ? "translate-y-0" : "-translate-y-full"}`}>
          {loadingProgress < 100 ? (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-subtle">
              <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${loadingProgress}%` }} />
            </div>
          ) : null}
          <div className="hidden min-h-14 items-center justify-between gap-3 px-6 py-2 md:flex">
            <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold text-primary">
                  {conversation.display_title || conversation.title}
                </h1>
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-secondary">
                  <span>{loadedLabel}</span>
                </div>
            </div>
            <button type="button" onClick={() => openNavigation("dialogue")} className="hidden h-9 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm text-secondary hover:bg-subtle md:inline-flex 2xl:hidden" aria-label={t("readerNavigation")}><ListTree className="h-4 w-4" />{t("readerNavigation")}</button>
            <ReaderHeaderActionRail
              expanded={desktopActionsExpanded}
              onExpandedChange={setDesktopActionsExpanded}
              actions={headerActions}
              triggerLabel={t("messageActions")}
              closeLabel={t("collapseActions")}
            />
          </div>
          <div className="flex min-h-14 items-center gap-2 px-[3vw] py-2 md:hidden">
            <button
              type="button"
              onClick={() => libraryMode ? onOpenLibrary?.() : setMobileSidebarOpenSignal((value) => value + 1)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
              aria-label={t("openSidebar")}
              title={t("openSidebar")}
            >
              CR
            </button>
            <div className={`min-w-0 flex-1 overflow-hidden transition-opacity duration-150 ${mobileActionsExpanded ? "pointer-events-none opacity-0" : "opacity-100"}`}>
              <h1 className="truncate text-[15px] font-semibold text-primary">{conversation.display_title || conversation.title}</h1>
              <p className="truncate text-xs text-secondary">{loadedLabel}</p>
            </div>
            {!mobileActionsExpanded ? (
              <button
                type="button"
                onClick={() => openNavigation("dialogue")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ui bg-surface text-secondary"
                aria-label={t("readerNavigation")}
                title={t("readerNavigation")}
              >
                <ListTree className="h-5 w-5" />
              </button>
            ) : null}
            <ReaderHeaderActionRail
              expanded={mobileActionsExpanded}
              onExpandedChange={setMobileActionsExpanded}
              actions={headerActions.slice(0, 4)}
              triggerLabel={t("more")}
              closeLabel={t("collapseActions")}
              compact
              fixedTrigger
            />
          </div>
          {neighborhoodExpansion.active ? <div className="border-t border-ui bg-subtle px-[3vw] py-2 text-sm text-secondary" role="status">{t("expandingNearby", { current: neighborhoodExpansion.current, total: neighborhoodExpansion.total })}</div> : null}
          {neighborhoodExpansion.error ? <div className="border-t border-ui bg-[var(--danger-soft)] px-[3vw] py-2 text-sm text-[var(--danger)]" role="alert">{t("expandNearbyFailed")}: {neighborhoodExpansion.error} <button type="button" onClick={() => void expandNeighborhood()} className="ml-2 font-semibold underline">{t("retry")}</button></div> : null}
        </header>

        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-14 [overflow-anchor:none] md:pt-0">
          <ResponsiveReaderFrame
            index={<ConversationIndex
                  conversationId={conversationId}
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
                    const cachedMessageBlocks = blockCache[message.id];
                    const cachedBounds = getBlockBounds(cachedMessageBlocks ?? []);
                    return (
                    <MessageItem
                      key={message.id}
                      message={message}
                      onChanged={refreshReader}
                      readOnly={libraryMode}
                      highlightTargetId={targetHighlightId}
                      selected={selectedMessageIds.has(message.id)}
                      onSelectedChange={libraryMode ? undefined : (selected) => {
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
                      expandHeavyBlocks={expandedHeavyMessageIds.has(message.id)}
                      cachedBlocks={cachedMessageBlocks}
                      hasPreviousBlocks={Boolean(cachedBounds && cachedBounds.min > 0)}
                      hasMoreBlocks={Boolean(cachedBounds && cachedBounds.max < message.block_count - 1)}
                      onLoadBlocks={async () => {
                        const blocks = await ensureMessageBlocks(message);
                        setExpandedHeavyMessageIds((current) => new Set(current).add(message.id));
                        return blocks;
                      }}
                      onLoadPreviousBlocks={() => loadAdjacentMessageBlocks(message, "previous")}
                      onLoadMoreBlocks={() => loadAdjacentMessageBlocks(message, "next")}
                      onBookmark={() => {
                        window.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", {
                          detail: { messageId: message.id, messageVersionId: message.current_version?.id },
                        }));
                        setAnnotationsOpen(true);
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
                  <div aria-hidden="true" className="h-[calc(100vh-7rem)] min-h-72" />
                </div>
              ) : null}
            </div>}
            toc={<div className="h-full">
                <ConversationToc
                  conversationId={conversationId}
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
      <MobileReaderSheet
        open={utilityPanel === "navigation"}
        onOpenChange={(open) => { if (!open) setUtilityPanel(null); }}
        title={t("navigationTitle")}
        header={navigationTabs}
        status={<>{mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}{mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}</>}
      >
        {navigationContent}
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "search"} onOpenChange={(open) => { if (!open) setUtilityPanel(null); }} title={t("search")} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("search")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <ConversationSearchPanel conversationId={conversation.id} onNavigate={({ messageId, blockIndex }) => navigateToTarget({ messageId, blockIndex, source: "search" })} onClose={() => setUtilityPanel(null)} showHeader={false} />
      </MobileReaderSheet>
      {utilityPanel === "navigation" ? (
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
      <MobileReaderSheet open={utilityPanel === "share"} onOpenChange={(open) => { if (!open) setUtilityPanel(null); }} title={t("shareConversation")} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("shareConversation")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <div className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto py-3"><SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} /></div>
      </MobileReaderSheet>
      <MobileReaderSheet open={utilityPanel === "export"} onOpenChange={(open) => { if (!open) setUtilityPanel(null); }} title={t("export")} header={<div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t("export")}</h2><button type="button" onClick={() => setUtilityPanel(null)} className="h-10 w-10 rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="mx-auto h-5 w-5" /></button></div>}>
        <div className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto py-3"><ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} /></div>
      </MobileReaderSheet>
      {showShare || showExport || showSearch ? (
        <div className="fixed inset-0 z-40 hidden justify-end bg-black/15 md:flex">
          <button type="button" aria-label={t("close")} className="absolute inset-0" onClick={() => { setShowShare(false); setShowExport(false); setShowSearch(false); }} />
          <ResizableDockPanel storageKey="chat-reader:reader-utility-panel-width" defaultSize={480} minSize={384} maxSize={() => Math.min(860, window.innerWidth * 0.6)} side="left" className="relative z-10 border-l border-ui bg-raised shadow-2xl">
            <div className="flex h-full w-full">
              {showSearch ? <ConversationSearchPanel conversationId={conversation.id} onNavigate={({ messageId, blockIndex }) => navigateToTarget({ messageId, blockIndex, source: "search" })} onClose={() => setShowSearch(false)} /> : <ReaderPanelShell title={showShare ? t("shareConversation") : t("export")} closeLabel={t("close")} onClose={() => { setShowShare(false); setShowExport(false); }}>
                {showShare ? <SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
                {showExport ? <ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
              </ReaderPanelShell>}
            </div>
          </ResizableDockPanel>
        </div>
      ) : null}
      <AnnotationWorkspace
        conversationId={conversation.id}
        messages={messages}
        activeMessageId={activeMessageId}
        repository={annotationRepository}
        open={annotationsOpen}
        onOpenChange={setAnnotationsOpen}
        onNavigate={navigateToTarget}
      />
    </main>
  );
}

function deriveActiveTocItems(
  message: MessageListItem | undefined,
  blockCache: Record<string, RenderBlockRead[]>,
): TocItem[] {
  if (!message) {
    return [];
  }
  const blocks = blockCache[message.id] ?? message.render_blocks ?? message.current_version?.blocks ?? [];
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

function messageHasInlineBlock(message: MessageListItem, blockIndex: number): boolean {
  return Boolean(
    message.render_blocks?.some((block) => block.block_index === blockIndex) ||
      message.current_version?.blocks?.some((block) => block.block_index === blockIndex),
  );
}

function getBlockBounds(blocks: RenderBlockRead[]): { min: number; max: number } | null {
  if (blocks.length === 0) {
    return null;
  }
  let min = blocks[0].block_index;
  let max = blocks[0].block_index;
  for (const block of blocks) {
    min = Math.min(min, block.block_index);
    max = Math.max(max, block.block_index);
  }
  return { min, max };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

function mergeBlockWindows(
  current: RenderBlockRead[] | undefined,
  incoming: RenderBlockRead[],
): RenderBlockRead[] {
  const byIndex = new Map<number, RenderBlockRead>();
  for (const block of current ?? []) {
    byIndex.set(block.block_index, block);
  }
  for (const block of incoming) {
    byIndex.set(block.block_index, block);
  }
  return Array.from(byIndex.values()).sort((left, right) => left.block_index - right.block_index);
}

async function loadCompleteMessageRange(
  dataSource: ReaderDataSource,
  conversationId: string,
  offset: number,
  limit: number,
): Promise<MessageWindowResponse> {
  const items: MessageListItem[] = [];
  let cursor = offset;
  let remaining = limit;
  let total = 0;
  while (remaining > 0) {
    const page = await dataSource.getMessageWindow(conversationId, {
      includeBlocks: false,
      offset: cursor,
      limit: Math.min(200, remaining),
      contentMode: "preview",
    });
    total = page.total;
    items.push(...page.items);
    if (page.items.length === 0) break;
    cursor += page.items.length;
    remaining -= page.items.length;
  }
  return {
    items,
    offset,
    limit: items.length,
    total,
    has_previous: offset > 0,
    has_more: offset + items.length < total,
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
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
  return {
    message_id: messageId,
    block_index: activeBlockIndex,
    scroll_offset: Math.max(0, Math.round(readingLine - anchorElement.getBoundingClientRect().top)),
    anchor_data: {
      position_mode: "block-relative-v1",
      order_key: message?.order_key ?? article.dataset.orderKey ?? "",
      ordinal: message?.ordinal ?? null,
      heading_block_index: headingBlockIndex,
      current_version_id: message?.current_version?.id ?? null,
    },
  };
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

function ReaderLoadingShell({ progress }: { progress: number }) {
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      <ProjectSidebar />
      <section className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="mx-auto max-w-3xl animate-pulse space-y-10 px-3 py-20 sm:px-6">
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
