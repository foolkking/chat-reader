"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, MoreHorizontal } from "lucide-react";
import {
  getConversation,
  getConversationMessageWindow,
  getReadingPosition,
  getMessageBlocks,
  mergeMessages,
  saveReadingPosition,
  saveReadingPositionKeepalive,
  splitConversation,
} from "../../lib/api";
import type { MessageListItem, NavigateTarget, NavigationResult, ReadingPositionInput, RenderBlockRead, TocItem } from "../../lib/types";
import { ExportButton } from "../exporting/export-button";
import { ExportPanel } from "../exporting/export-panel";
import { ProjectSidebar } from "../projects/project-sidebar";
import { PinButton } from "../reading/pin-button";
import { ShareButton } from "../sharing/share-button";
import { SharePanel } from "../sharing/share-panel";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";
import { ResponsiveReaderFrame } from "../../components/responsive-reader-frame";
import { useTranslations } from "../../components/preferences-provider";
import { MessageItem } from "./message-item";
import { navigateMountedTarget } from "./reader-navigation";

const PAGE_SIZE = 30;
const BLOCK_PAGE_SIZE = 20;
const ACTIVE_READING_OFFSET = 120;

export function ConversationReader({ conversationId }: { conversationId: string }) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const projectContextId = searchParams.get("projectId") ?? undefined;
  const queryClient = useQueryClient();
  const targetMessageId = searchParams.get("messageId");
  const [offset, setOffset] = useState(0);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showShare, setShowShare] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [mobileHeaderVisible, setMobileHeaderVisible] = useState(true);
  const lastMobileScrollTopRef = useRef(0);
  const [showMobileIndex, setShowMobileIndex] = useState(false);
  const [showMobileToc, setShowMobileToc] = useState(false);
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
  const [expandAllHeavyBlocks, setExpandAllHeavyBlocks] = useState(false);
  const [expandProgress, setExpandProgress] = useState({ current: 0, total: 0, active: false });
  const [initialPaintReady, setInitialPaintReady] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadPreviousSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const nextOffsetRef = useRef(0);
  const minOffsetRef = useRef(0);
  const loadingPreviousRef = useRef(false);
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

  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation(conversationId),
  });

  const positionQuery = useQuery({
    queryKey: ["reading-position", conversationId],
    queryFn: () => getReadingPosition(conversationId),
  });

  const savedPosition = targetMessageId ? null : positionQuery.data?.position ?? null;
  const initialAnchorMessageId = targetMessageId ?? savedPosition?.message_id ?? null;
  const canLoadInitialWindow = Boolean(targetMessageId) || positionQuery.isSuccess || positionQuery.isError;

  const windowQuery = useQuery({
    queryKey: ["message-window", conversationId, offset, offset === 0 ? initialAnchorMessageId : null],
    queryFn: () =>
      getConversationMessageWindow(conversationId, {
        includeBlocks: false,
        limit: PAGE_SIZE,
        offset,
        anchorMessageId: offset === 0 ? initialAnchorMessageId ?? undefined : undefined,
        contentMode: "preview",
      }),
    enabled: canLoadInitialWindow,
  });

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;
    const handleScroll = () => {
      if (window.innerWidth >= 768 || showMobileIndex || showMobileToc || showMobileActions) {
        setMobileHeaderVisible(true);
        lastMobileScrollTopRef.current = root.scrollTop;
        return;
      }
      const current = root.scrollTop;
      const delta = current - lastMobileScrollTopRef.current;
      if (current < 24 || delta < -8) setMobileHeaderVisible(true);
      else if (delta > 10 && current > 72) setMobileHeaderVisible(false);
      lastMobileScrollTopRef.current = current;
    };
    const markScrollIntent = () => {
      userScrollIntentRef.current = true;
    };
    root.addEventListener("scroll", handleScroll, { passive: true });
    root.addEventListener("wheel", markScrollIntent, { passive: true });
    root.addEventListener("touchstart", markScrollIntent, { passive: true });
    root.addEventListener("pointerdown", markScrollIntent, { passive: true });
    return () => {
      root.removeEventListener("scroll", handleScroll);
      root.removeEventListener("wheel", markScrollIntent);
      root.removeEventListener("touchstart", markScrollIntent);
      root.removeEventListener("pointerdown", markScrollIntent);
    };
  }, [showMobileActions, showMobileIndex, showMobileToc]);

  const hasMore = Boolean(windowQuery.data?.has_more);
  const total = windowQuery.data?.total ?? messages.length;

  useEffect(() => {
    setOffset(0);
    nextOffsetRef.current = 0;
    minOffsetRef.current = 0;
    loadingPreviousRef.current = false;
    setMessages([]);
    setActiveMessageId(targetMessageId);
    setActiveBlockId(null);
    setSelectedMessageIds(new Set());
    setPendingTargetMessageId(targetMessageId);
    setExpandedHeavyMessageIds(new Set());
    setBlockCache({});
    blockCacheRef.current = {};
    blockRequestsRef.current.clear();
    userScrollIntentRef.current = false;
    setExpandAllHeavyBlocks(false);
    setExpandProgress({ current: 0, total: 0, active: false });
    setInitialPaintReady(false);
    restoreAttemptedRef.current = false;
    restoreInProgressRef.current = false;
    lastSavedSignatureRef.current = "";
  }, [conversationId, targetMessageId]);

  useEffect(() => {
    messagesRef.current = messages;
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
    if (!windowQuery.isSuccess) {
      return;
    }
    nextOffsetRef.current = Math.max(
      nextOffsetRef.current,
      windowQuery.data.offset + windowQuery.data.items.length,
    );
    minOffsetRef.current = messages.length === 0
      ? windowQuery.data.offset
      : Math.min(minOffsetRef.current, windowQuery.data.offset);
    setMessages((current) => {
      const next = offset === 0 ? [] : [...current];
      for (const message of windowQuery.data.items) {
        if (!next.some((item) => item.id === message.id)) {
          next.push(message);
        }
      }
      return next.sort((left, right) => left.order_key.localeCompare(right.order_key));
    });
  }, [offset, windowQuery.data, windowQuery.isSuccess]);

  const mergeWindowItems = useCallback((page: { items: MessageListItem[]; offset: number }) => {
    minOffsetRef.current = Math.min(minOffsetRef.current, page.offset);
    nextOffsetRef.current = Math.max(nextOffsetRef.current, page.offset + page.items.length);
    setMessages((current) => {
      const next = [...current];
      for (const message of page.items) {
        if (!next.some((item) => item.id === message.id)) {
          next.push(message);
        }
      }
      return next.sort((left, right) => left.order_key.localeCompare(right.order_key));
    });
  }, []);

  const loadPreviousWindow = useCallback(async () => {
    const root = scrollContainerRef.current;
    if (!root || loadingPreviousRef.current || minOffsetRef.current <= 0) return;
    loadingPreviousRef.current = true;
    const beforeHeight = root.scrollHeight;
    try {
      const previousOffset = Math.max(0, minOffsetRef.current - PAGE_SIZE);
      const page = await getConversationMessageWindow(conversationId, {
        includeBlocks: false,
        limit: minOffsetRef.current - previousOffset,
        offset: previousOffset,
        contentMode: "preview",
      });
      mergeWindowItems(page);
      window.requestAnimationFrame(() => {
        root.scrollTop += root.scrollHeight - beforeHeight;
      });
    } finally {
      loadingPreviousRef.current = false;
    }
  }, [conversationId, mergeWindowItems]);

  const navigateToTarget = useCallback(
    async ({ messageId, blockIndex, alignmentOffset }: NavigateTarget): Promise<NavigationResult> => {
      const token = navigationTokenRef.current + 1;
      navigationTokenRef.current = token;
      navigationLockUntilRef.current = Date.now() + 5000;
      const blockId = blockIndex === undefined ? null : `block-${messageId}-${blockIndex}`;
      const messageIdDom = `message-${messageId}`;
      setActiveMessageId(messageId);
      setActiveBlockId(blockId);
      setTargetHighlightId(blockId ?? messageIdDom);

      try {
        if (!getTargetElement(messageId, blockIndex)) {
          const page = await getConversationMessageWindow(conversationId, {
            includeBlocks: false,
            limit: PAGE_SIZE,
            anchorMessageId: messageId,
            contentMode: "preview",
          });
          if (navigationTokenRef.current !== token) {
            return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
          }
          mergeWindowItems(page);
        }

        if (blockIndex !== undefined) {
          const knownMessage =
            messages.find((message) => message.id === messageId) ??
            (await getConversationMessageWindow(conversationId, {
              includeBlocks: false,
              limit: 1,
              anchorMessageId: messageId,
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
          if (knownMessage && !messageHasInlineBlocks(knownMessage) && needsTargetWindow) {
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
          fallbackId: undefined,
          tokenIsCurrent: () => navigationTokenRef.current === token,
          offset: alignmentOffset ?? 12,
        });
        if (result.ok) {
          setActiveMessageId(messageId);
          setActiveBlockId(blockId);
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
    [blockCache, conversationId, mergeWindowItems, messages],
  );

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
    void navigateToTarget({ messageId, source: "search" }).finally(() => {
      restoreAttemptedRef.current = true;
      setPendingTargetMessageId(null);
    });
  }, [navigateToTarget, pendingTargetMessageId, targetMessageId]);

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
    if (!sentinel || !root || messages.length === 0 || minOffsetRef.current <= 0) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (userScrollIntentRef.current && entries.some((entry) => entry.isIntersecting)) void loadPreviousWindow();
      },
      { root, rootMargin: "600px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadPreviousWindow, messages.length]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasMore) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (userScrollIntentRef.current && entries.some((entry) => entry.isIntersecting) && !windowQuery.isFetching) {
          setOffset(nextOffsetRef.current);
        }
      },
      { root, rootMargin: "600px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, windowQuery.isFetching]);

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
        saveReadingPositionKeepalive(conversationId, payload);
      } else {
        void saveReadingPosition(conversationId, payload).catch(() => undefined);
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
    setMessages([]);
    setOffset(0);
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
    const title = window.prompt("New conversation title", `${conversation?.display_title || conversation?.title || "Conversation"} excerpt`);
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

  async function expandLoadedHeavyMessages() {
    const heavyMessages = messages.filter(
      (message) => message.is_heavy && !expandedHeavyMessageIds.has(message.id),
    );
    if (heavyMessages.length === 0) {
      setExpandAllHeavyBlocks(true);
      return;
    }
    setExpandAllHeavyBlocks(true);
    setExpandProgress({ current: 0, total: heavyMessages.length, active: true });
    let completed = 0;
    for (let index = 0; index < heavyMessages.length; index += 2) {
      const batch = heavyMessages.slice(index, index + 2);
      await Promise.all(batch.map((message) => ensureMessageBlocks(message)));
      setExpandedHeavyMessageIds((current) => {
        const next = new Set(current);
        for (const message of batch) {
          next.add(message.id);
        }
        return next;
      });
      completed += batch.length;
      setExpandProgress({ current: completed, total: heavyMessages.length, active: true });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    setExpandProgress((current) => ({ ...current, active: false }));
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

  async function loadBlockPage(messageId: string, start: number, limit = BLOCK_PAGE_SIZE): Promise<RenderBlockRead[]> {
    const requestKey = `${messageId}:${start}:${limit}`;
    const existing = blockRequestsRef.current.get(requestKey);
    if (existing) return existing;
    const request = getMessageBlocks(messageId, { start, limit })
      .then((blocks) => {
        setBlockCache((current) => {
          const next = {
            ...current,
            [messageId]: mergeBlockWindows(current[messageId], blocks),
          };
          blockCacheRef.current = next;
          return next;
        });
        return blocks;
      })
      .finally(() => blockRequestsRef.current.delete(requestKey));
    blockRequestsRef.current.set(requestKey, request);
    return request;
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
    await loadBlockPage(message.id, start, limit);
  }

  if (conversationQuery.isLoading) {
    return <ReaderLoadingShell progress={loadingProgress} />;
  }

  if (conversationQuery.isError) {
    return <ReaderState title="Conversation unavailable" detail={conversationQuery.error.message} />;
  }

  if (!conversation) {
    return <ReaderState title="Conversation unavailable" detail="The API returned no conversation payload." />;
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      <ProjectSidebar currentProjectId={projectContextId} readerMode />
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className={`absolute inset-x-0 top-0 z-40 border-b border-ui bg-surface/95 backdrop-blur transition-transform duration-200 md:relative md:z-20 md:translate-y-0 ${mobileHeaderVisible ? "translate-y-0" : "-translate-y-full"}`}>
          {loadingProgress < 100 ? (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#e5e7eb]">
              <div className="h-full bg-[#10a37f] transition-[width] duration-300" style={{ width: `${loadingProgress}%` }} />
            </div>
          ) : null}
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 pl-16 md:px-6 md:pl-6">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-primary">
                {conversation.display_title || conversation.title}
              </h1>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-secondary">
                <span>{loadedLabel}</span>
              </div>
            </div>
            <button type="button" onClick={() => setShowMobileIndex(true)} className="hidden h-9 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm text-secondary hover:bg-subtle md:inline-flex 2xl:hidden" aria-label={t("readerNavigation")}><ListTree className="h-4 w-4" />{t("readerNavigation")}</button>
            <button
              type="button"
              aria-label={t("messageActions")}
              onClick={() => setShowMobileActions((current) => !current)}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle md:inline-flex"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            <div className="flex shrink-0 gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setShowMobileIndex(true)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-ui bg-surface text-secondary"
                aria-label={t("readerNavigation")}
                title={t("readerNavigation")}
              >
                <ListTree className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setShowMobileActions((current) => !current)}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--text)] text-[var(--surface)]"
                aria-label={t("more")}
                title={t("more")}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>
          </div>
          {showMobileActions ? (
            <div className="absolute right-3 top-14 z-40 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-[#e5e7eb] bg-white p-3 shadow-xl">
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void expandLoadedHeavyMessages()}
                    disabled={expandProgress.active}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#d1d5db] bg-white px-3 text-xs font-medium text-[#374151] disabled:cursor-wait disabled:opacity-70"
                  >
                    {expandProgress.active ? <Spinner /> : null}
                    {expandProgress.active
                      ? `${expandProgress.current} / ${expandProgress.total}`
                      : "展开已加载内容"}
                  </button>
                  <PinButton scope="global" conversationId={conversation.id} isPinned={conversation.is_global_pinned} />
                  <ShareButton isOpen={showShare} onToggle={() => setShowShare((current) => !current)} />
                  <ExportButton isOpen={showExport} onToggle={() => setShowExport((current) => !current)} />
                  {selectedIds.length >= 2 ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Merge ${selectedIds.length} selected messages?`)) {
                          return;
                        }
                        await mergeMessages({ messageIds: selectedIds });
                        setSelectedMessageIds(new Set());
                        await refreshReader();
                      }}
                      className="inline-flex min-h-10 items-center rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151]"
                    >
                      合并所选
                    </button>
                  ) : null}
                  {selectedOrderedIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void splitSelectedConversationRange()}
                      className="inline-flex min-h-10 items-center rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151]"
                    >
                      拆分为新会话
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </header>

        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-14 md:pt-0">
          <ResponsiveReaderFrame
            index={<ConversationIndex
                  conversationId={conversationId}
                  activeMessageId={activeMessageId}
                  ready={canLoadInitialWindow}
                  onNavigate={(item) => {
                    void navigateToTarget({ messageId: item.messageId, source: "dialogue-index" });
                  }}
                />}
            content={<div className="reader-content-inner min-w-0">
              {windowQuery.isLoading && messages.length === 0 ? (
                <ReaderState title="正在加载消息" detail="正在获取首屏对话内容。" />
              ) : null}

              {windowQuery.isError ? (
                <ReaderState title="消息加载失败" detail={windowQuery.error.message} />
              ) : null}

              {windowQuery.isSuccess && messages.length === 0 ? (
                <ReaderState title="暂无消息" detail="这个对话还没有可阅读的消息。" />
              ) : null}

              {messages.length > 0 ? (
                <div className="space-y-6">
                  <div ref={loadPreviousSentinelRef} className="h-px" aria-hidden="true" />
                  {messages.map((message) => {
                    const cachedMessageBlocks = blockCache[message.id];
                    const cachedBounds = getBlockBounds(cachedMessageBlocks ?? []);
                    return (
                    <MessageItem
                      key={message.id}
                      message={message}
                      onChanged={refreshReader}
                      highlightTargetId={targetHighlightId}
                      selected={selectedMessageIds.has(message.id)}
                      onSelectedChange={(selected) => {
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
                      expandHeavyBlocks={expandAllHeavyBlocks || expandedHeavyMessageIds.has(message.id)}
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
                    />
                    );
                  })}
                  <div ref={loadMoreSentinelRef} className="flex min-h-12 items-center justify-center">
                    {hasMore && windowQuery.isFetching ? (
                      <span className="inline-flex items-center gap-2 text-sm text-[#6b7280]">
                        <Spinner dark />
                        正在加载更多消息
                      </span>
                    ) : null}
                  </div>
                  <div aria-hidden="true" className="h-[calc(100vh-7rem)] min-h-72" />
                </div>
              ) : null}
            </div>}
            toc={<div className="sticky top-[4vh]">
                <ConversationToc
                  conversationId={conversationId}
                  activeMessageId={activeMessageId}
                  activeItems={activeTocItems}
                  activeBlockId={activeBlockId}
                  observerKey={tocObserverKey}
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
      {showMobileIndex || showMobileToc ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-page 2xl:hidden md:bg-black/25">
          <button type="button" aria-label={t("close")} className="absolute inset-0 hidden md:block" onClick={() => { setShowMobileIndex(false); setShowMobileToc(false); }} />
          <section className="relative flex h-full w-full flex-col bg-page md:max-w-[28rem] md:border-l md:border-ui md:shadow-2xl" aria-label={t("readerNavigation")}>
          <header className="flex shrink-0 items-center gap-3 border-b border-ui bg-surface px-[3vw] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-4">
            <div className="grid min-w-0 flex-1 grid-cols-2 rounded-lg bg-subtle p-1">
              <button type="button" onClick={() => { setShowMobileIndex(true); setShowMobileToc(false); }} className={`min-h-10 rounded-md px-3 text-sm font-medium ${showMobileIndex ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{t("dialogueTab")}</button>
              <button type="button" onClick={() => { setShowMobileIndex(false); setShowMobileToc(true); }} className={`min-h-10 rounded-md px-3 text-sm font-medium ${showMobileToc ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{t("sectionsTab")}</button>
            </div>
            <button type="button" onClick={() => { setShowMobileIndex(false); setShowMobileToc(false); }} className="min-h-10 rounded-lg px-3 text-sm text-secondary hover:bg-subtle">{t("close")}</button>
          </header>
          <div className="shrink-0 px-[3vw] py-2" aria-live="polite">
            {mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}
            {mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-[3vw] pb-[max(1rem,env(safe-area-inset-bottom))]">
            {showMobileIndex ? (
              <ConversationIndex conversationId={conversationId} activeMessageId={activeMessageId} ready={canLoadInitialWindow} mode="sheet" onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget({ messageId: item.messageId, source: "dialogue-index" });
                setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
                if (result.ok) setShowMobileIndex(false);
              }} />
            ) : (
              <ConversationToc conversationId={conversationId} activeMessageId={activeMessageId} activeItems={activeTocItems} activeBlockId={activeBlockId} observerKey={tocObserverKey} mode="sheet" onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget({ messageId: item.message_id, blockIndex: item.block_index, source: "section-toc" });
                setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
                if (result.ok) setShowMobileToc(false);
              }} />
            )}
          </div>
          </section>
        </div>
      ) : null}
      {showShare || showExport ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/10">
          <button type="button" aria-label="关闭面板" className="absolute inset-0" onClick={() => { setShowShare(false); setShowExport(false); }} />
          <div
            className={`relative z-10 grid h-full w-full gap-4 overflow-y-auto border-l border-[#e5e5e5] bg-white p-5 pt-14 shadow-2xl ${
              showShare && showExport ? "max-w-[760px] lg:grid-cols-2" : "max-w-[440px]"
            }`}
          >
            <button type="button" aria-label="关闭" onClick={() => { setShowShare(false); setShowExport(false); }} className="absolute right-4 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-xl text-[#6b7280] hover:bg-[#f3f4f6]">×</button>
            {showShare ? <SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
            {showExport ? <ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
          </div>
        </div>
      ) : null}
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

function messageHasInlineBlocks(message: MessageListItem): boolean {
  return Boolean(
    (message.render_blocks && message.render_blocks.length > 0) ||
      (message.current_version?.blocks && message.current_version.blocks.length > 0),
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

function getTargetElement(messageId: string, blockIndex?: number): HTMLElement | null {
  if (blockIndex !== undefined) {
    return document.getElementById(`block-${messageId}-${blockIndex}`);
  }
  return document.getElementById(`message-${messageId}`);
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
      className={`h-4 w-4 animate-spin rounded-full border-2 ${
        dark ? "border-[#d1d5db] border-t-[#374151]" : "border-[#d1d5db] border-t-[#10a37f]"
      }`}
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
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function ReaderLoadingShell({ progress }: { progress: number }) {
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar />
      <section className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-[#e5e7eb]">
          <div className="h-full bg-[#10a37f] transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="mx-auto max-w-3xl animate-pulse space-y-10 px-3 py-20 sm:px-6">
          <div className="h-5 w-48 rounded bg-[#e5e7eb]" />
          <div className="ml-auto h-28 w-full rounded-2xl bg-[#ececeb] sm:w-2/3" />
          <div className="space-y-3">
            <div className="h-4 w-full rounded bg-[#e5e7eb]" />
            <div className="h-4 w-5/6 rounded bg-[#e5e7eb]" />
            <div className="h-4 w-3/4 rounded bg-[#e5e7eb]" />
          </div>
        </div>
      </section>
    </main>
  );
}
