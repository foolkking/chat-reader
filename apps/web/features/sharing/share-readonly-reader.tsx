"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSharedConversation,
  getSharedDialogueIndex,
  getSharedMessageBlocks,
  getSharedMessageWindow,
  getSharedToc,
} from "../../lib/api";
import type { LoadedMessageWindow, MessageListItem, NavigationResult, PersistedSharePosition, RenderBlockRead, ScrollDirection } from "../../lib/types";
import { MessageItem } from "../conversations/message-item";
import { captureScrollAnchor, navigateMountedTarget, restoreScrollAnchor } from "../conversations/reader-navigation";
import { appendLoadedWindow, emptyLoadedWindow, prependLoadedWindow, replaceLoadedWindow } from "../conversations/reader-window";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";
import { ResponsiveReaderFrame } from "../../components/responsive-reader-frame";
import { useTranslations } from "../../components/preferences-provider";

const PAGE_SIZE = 30;
const BLOCK_PAGE_SIZE = 20;
const ACTIVE_READING_OFFSET = 96;
const ANCHOR_BEFORE = 12;

export function ShareReadonlyReader({ token }: { token: string }) {
  const t = useTranslations();
  const [showMobileIndex, setShowMobileIndex] = useState(false);
  const [showMobileToc, setShowMobileToc] = useState(false);
  const [loadedWindow, setLoadedWindow] = useState<LoadedMessageWindow>(() => emptyLoadedWindow());
  const messages = loadedWindow.items;
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [navigationTargetMessageId, setNavigationTargetMessageId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [targetHighlightId, setTargetHighlightId] = useState<string | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [blockCache, setBlockCache] = useState<Record<string, RenderBlockRead[]>>({});
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [savedPosition, setSavedPosition] = useState<PersistedSharePosition | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [positionReady, setPositionReady] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  const navigationTokenRef = useRef(0);
  const navigationLockUntilRef = useRef(0);
  const restoreAttemptedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<MessageListItem[]>([]);
  const loadedWindowRef = useRef<LoadedMessageWindow>(emptyLoadedWindow());
  const windowGenerationRef = useRef(0);
  const initialWindowAppliedRef = useRef(false);
  const loadingPreviousRef = useRef(false);
  const loadingNextRef = useRef(false);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const blockCacheRef = useRef<Record<string, RenderBlockRead[]>>({});
  const blockRequestsRef = useRef(new Map<string, Promise<RenderBlockRead[]>>());
  const userScrollIntentRef = useRef(false);
  const scrollDirectionRef = useRef<ScrollDirection>(null);
  const scrollIntentSequenceRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const loadPreviousActionRef = useRef<() => void>(() => undefined);
  const loadNextActionRef = useRef<() => void>(() => undefined);
  const [edgeLoading, setEdgeLoading] = useState<"previous" | "next" | null>(null);
  const [edgeError, setEdgeError] = useState<"previous" | "next" | null>(null);

  const shareQuery = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: () => getSharedConversation(token),
  });
  const initialWindowQuery = useQuery({
    queryKey: ["shared-message-window", token, savedPosition?.message_id ?? null],
    queryFn: () => getSharedMessageWindow(token, {
      limit: PAGE_SIZE,
      anchorMessageId: savedPosition?.message_id ?? undefined,
      anchorBefore: ANCHOR_BEFORE,
    }),
    enabled: shareQuery.isSuccess && storageReady,
  });
  const tocQuery = useQuery({
    queryKey: ["shared-toc", token, activeMessageId],
    queryFn: () => getSharedToc(token, { messageId: activeMessageId ?? undefined, limit: 200 }),
    enabled: Boolean(shareQuery.data?.capabilities.toc && activeMessageId),
    staleTime: 30_000,
  });

  const payload = shareQuery.data;
  const toc = tocQuery.data?.items ?? [];

  useEffect(() => {
    if (!payload) return;
    document.documentElement.dataset.theme = payload.share.theme;
    document.documentElement.lang = payload.share.locale;
    document.documentElement.style.colorScheme = payload.share.theme;
  }, [payload]);

  useEffect(() => {
    let cancelled = false;
    void sharePositionStorageKey(token).then((key) => {
      if (cancelled) return;
      setStorageKey(key);
      setSavedPosition(readSharePosition(key));
      setStorageReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    windowGenerationRef.current += 1;
    navigationTokenRef.current += 1;
    const emptyWindow = emptyLoadedWindow(windowGenerationRef.current);
    loadedWindowRef.current = emptyWindow;
    setLoadedWindow(emptyWindow);
    initialWindowAppliedRef.current = false;
    loadingPreviousRef.current = false;
    loadingNextRef.current = false;
    userScrollIntentRef.current = false;
    scrollDirectionRef.current = null;
    scrollIntentSequenceRef.current += 1;
    setEdgeLoading(null);
    setEdgeError(null);
  }, [token]);

  useEffect(() => {
    if (!shareQuery.isError || !storageKey) return;
    window.localStorage.removeItem(storageKey);
  }, [shareQuery.isError, storageKey]);

  useEffect(() => {
    if (!initialWindowQuery.data || initialWindowAppliedRef.current) return;
    initialWindowAppliedRef.current = true;
    const page = initialWindowQuery.data;
    const next = replaceLoadedWindow(page, windowGenerationRef.current);
    loadedWindowRef.current = next;
    setLoadedWindow(next);
    setActiveMessageId(savedPosition?.message_id ?? page.items[0]?.id ?? null);
  }, [initialWindowQuery.data, savedPosition?.message_id]);

  useEffect(() => {
    messagesRef.current = messages;
    const retained = new Set(messages.map((message) => message.id));
    setBlockCache((current) => {
      const entries = Object.entries(current).filter(([messageId]) => retained.has(messageId));
      if (entries.length === Object.keys(current).length) return current;
      const next = Object.fromEntries(entries);
      blockCacheRef.current = next;
      return next;
    });
    setExpandedMessageIds((current) => {
      const next = new Set(Array.from(current).filter((messageId) => retained.has(messageId)));
      return next.size === current.size ? current : next;
    });
  }, [messages]);

  const applyLoadedWindow = useCallback((next: LoadedMessageWindow) => {
    loadedWindowRef.current = next;
    setLoadedWindow(next);
  }, []);

  const ensureMessageBlocks = useCallback(async (messageId: string, start = 0, preserveReadingAnchor = false): Promise<RenderBlockRead[]> => {
    const cached = blockCacheRef.current[messageId] ?? [];
    if (cached.some((block) => block.block_index === start) || (start === 0 && cached.length > 0)) {
      return cached;
    }
    const requestKey = `${messageId}:${start}:${BLOCK_PAGE_SIZE}`;
    const existing = blockRequestsRef.current.get(requestKey);
    if (existing) return existing;
    const request = getSharedMessageBlocks(token, messageId, { start, limit: BLOCK_PAGE_SIZE })
      .then(async (blocks) => {
        if (!loadedWindowRef.current.items.some((message) => message.id === messageId)) return blocks;
        const anchor = preserveReadingAnchor ? captureScrollAnchor(null, ACTIVE_READING_OFFSET) : null;
        const intentSequence = scrollIntentSequenceRef.current;
        setBlockCache((current) => {
          const next = {
            ...current,
            [messageId]: mergeBlockWindows(current[messageId], blocks),
          };
          blockCacheRef.current = next;
          return next;
        });
        if (anchor) await restoreScrollAnchor({
          root: null,
          anchor,
          tokenIsCurrent: () => scrollIntentSequenceRef.current === intentSequence,
        });
        return blocks;
      })
      .finally(() => blockRequestsRef.current.delete(requestKey));
    blockRequestsRef.current.set(requestKey, request);
    return request;
  }, [token]);

  useEffect(() => {
    if (!activeMessageId || messages.length === 0) return;
    const activeIndex = messages.findIndex((message) => message.id === activeMessageId);
    if (activeIndex < 0) return;
    const nearby = messages
      .slice(activeIndex, activeIndex + 1)
      .filter((message) => message.is_heavy && !expandedMessageIds.has(message.id));
    if (nearby.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const message of nearby) {
        await ensureMessageBlocks(message.id);
        if (cancelled) return;
        setExpandedMessageIds((current) => new Set(current).add(message.id));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMessageId, ensureMessageBlocks, expandedMessageIds, messages]);

  const navigateToTarget = useCallback(async (
    messageId: string,
    blockIndex?: number,
    alignmentOffset = 80,
  ): Promise<NavigationResult> => {
    const navigationToken = navigationTokenRef.current + 1;
    navigationTokenRef.current = navigationToken;
    const generation = windowGenerationRef.current + 1;
    windowGenerationRef.current = generation;
    applyLoadedWindow({ ...loadedWindowRef.current, generation });
    userScrollIntentRef.current = false;
    scrollDirectionRef.current = null;
    scrollIntentSequenceRef.current += 1;
    navigationLockUntilRef.current = Date.now() + 5000;
    setNavigationTargetMessageId(messageId);
    const messageDomId = `message-${messageId}`;
    const blockDomId = blockIndex === undefined ? null : `block-${messageId}-${blockIndex}`;
    try {
      if (!document.getElementById(messageDomId)) {
        const page = await getSharedMessageWindow(token, {
          limit: PAGE_SIZE,
          anchorMessageId: messageId,
          anchorBefore: ANCHOR_BEFORE,
        });
        if (navigationTokenRef.current !== navigationToken) {
          return { ok: false, targetId: blockDomId ?? messageDomId, reason: "cancelled" };
        }
        initialWindowAppliedRef.current = true;
        applyLoadedWindow(replaceLoadedWindow(page, generation));
      }
      if (blockIndex !== undefined) {
        await ensureMessageBlocks(messageId, Math.max(0, blockIndex - 20));
        setExpandedMessageIds((current) => new Set(current).add(messageId));
      }
      const result = await navigateMountedTarget({
        root: null,
        targetId: blockDomId ?? messageDomId,
        tokenIsCurrent: () => navigationTokenRef.current === navigationToken,
        offset: alignmentOffset,
      });
      if (result.ok) {
        setActiveMessageId(messageId);
        setActiveBlockId(blockDomId);
        setTargetHighlightId(result.targetId);
        await restoreScrollAnchor({
          root: null,
          anchor: { targetId: result.targetId, offset: alignmentOffset },
          tokenIsCurrent: () => navigationTokenRef.current === navigationToken && !userScrollIntentRef.current,
        });
        window.setTimeout(() => {
          if (navigationTokenRef.current === navigationToken) {
            setTargetHighlightId(null);
            setActiveBlockId(null);
          }
        }, 2000);
      }
      return result;
    } catch {
      return { ok: false, targetId: blockDomId ?? messageDomId, reason: "load-failed" };
    }
  }, [applyLoadedWindow, ensureMessageBlocks, token]);

  useEffect(() => {
    if (restoreAttemptedRef.current || !initialWindowQuery.isSuccess) return;
    restoreAttemptedRef.current = true;
    if (!savedPosition?.message_id) {
      setPositionReady(true);
      return;
    }
    const candidates: Array<number | undefined> = [
      savedPosition.block_index ?? undefined,
      numberOrNull(savedPosition.anchor_data.heading_block_index) ?? undefined,
      undefined,
    ].filter((value, index, values) => values.indexOf(value) === index);
    void (async () => {
      for (const candidate of candidates) {
        const result = await navigateToTarget(
          savedPosition.message_id,
          candidate,
          candidate === undefined
            ? ACTIVE_READING_OFFSET
            : ACTIVE_READING_OFFSET - savedPosition.scroll_offset,
        );
        if (result.ok) return;
      }
    })().finally(() => setPositionReady(true));
  }, [initialWindowQuery.isSuccess, navigateToTarget, savedPosition]);

  const refreshActiveMessageFromLayout = useCallback((unlockNavigation = false) => {
    if (unlockNavigation) {
      navigationLockUntilRef.current = 0;
      setNavigationTargetMessageId(null);
    }
    if (!unlockNavigation && Date.now() < navigationLockUntilRef.current) return;
    const nextActiveId = resolveActiveMessageId();
    if (nextActiveId) {
      setActiveMessageId(nextActiveId);
      setActiveBlockId(null);
    }
  }, []);

  useEffect(() => {
    if (messages.length === 0) return undefined;
    let frame = 0;
    const scheduleRefresh = (unlockNavigation = false) => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshActiveMessageFromLayout(unlockNavigation);
      });
    };
    const onManualIntent = () => scheduleRefresh(true);
    const onScroll = () => {
      const current = window.scrollY;
      const delta = current - lastScrollTopRef.current;
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
        const edgeThreshold = window.innerHeight * 0.45;
        if (scrollDirectionRef.current === "up" && current <= edgeThreshold) {
          loadPreviousActionRef.current();
        }
        if (
          scrollDirectionRef.current === "down" &&
          document.documentElement.scrollHeight - window.innerHeight - current <= edgeThreshold
        ) {
          loadNextActionRef.current();
        }
      }
      lastScrollTopRef.current = current;
      scheduleRefresh(false);
    };
    const markScrollIntent = () => {
      userScrollIntentRef.current = true;
      scrollIntentSequenceRef.current += 1;
      onManualIntent();
    };
    const markKeyboardIntent = (event: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      markScrollIntent();
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) scrollDirectionRef.current = "up";
      if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) scrollDirectionRef.current = "down";
    };
    window.addEventListener("pointerdown", onManualIntent, { passive: true });
    window.addEventListener("wheel", markScrollIntent, { passive: true });
    window.addEventListener("touchstart", markScrollIntent, { passive: true });
    window.addEventListener("keydown", markKeyboardIntent);
    window.addEventListener("click", onManualIntent, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    scheduleRefresh(false);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onManualIntent);
      window.removeEventListener("wheel", markScrollIntent);
      window.removeEventListener("touchstart", markScrollIntent);
      window.removeEventListener("keydown", markKeyboardIntent);
      window.removeEventListener("click", onManualIntent);
      window.removeEventListener("scroll", onScroll);
    };
  }, [messages, refreshActiveMessageFromLayout]);

  useEffect(() => {
    const top = topSentinelRef.current;
    const bottom = bottomSentinelRef.current;
    if (!top || !bottom || messages.length === 0) return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !userScrollIntentRef.current) continue;
        if (entry.target === top && scrollDirectionRef.current === "up") void loadPreviousPage();
        if (entry.target === bottom && scrollDirectionRef.current === "down") void loadNextPage();
      }
    }, { rootMargin: "45% 0px", threshold: 0 });
    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [messages.length]);

  useEffect(() => {
    if (!storageKey || !positionReady) return undefined;
    const persist = () => {
      const position = captureSharePosition(messagesRef.current);
      if (position) window.localStorage.setItem(storageKey, JSON.stringify(position));
    };
    const schedule = () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        persist();
      }, 1000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", persist);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      persist();
      window.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", persist);
    };
  }, [positionReady, storageKey]);

  const indexLoader = useCallback(
    (options: { offset?: number; limit?: number; anchorMessageId?: string }) =>
      getSharedDialogueIndex(token, options),
    [token],
  );
  const tocObserverKey = useMemo(
    () => `${activeMessageId ?? "none"}:${Object.keys(blockCache).length}:${expandedMessageIds.size}`,
    [activeMessageId, blockCache, expandedMessageIds.size],
  );

  useEffect(() => {
    loadPreviousActionRef.current = () => void loadPreviousPage();
    loadNextActionRef.current = () => void loadNextPage();
  });

  if (shareQuery.isLoading || !storageReady) {
    return <ShareState title="正在加载分享" detail="正在获取只读会话信息。" />;
  }
  if (shareQuery.isError) return <ShareState title="分享不可用" detail={shareQuery.error.message} />;
  if (!payload) return <ShareState title="分享不可用" detail="服务未返回分享信息。" />;

  return (
    <main className="flex min-h-screen flex-col bg-page text-primary [--reader-sticky-top:5rem] [overflow-anchor:none]">
      <header className="sticky top-0 z-10 border-b border-[#e5e5e5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl flex-col justify-center px-4 sm:px-6">
          <p className="text-xs font-medium text-[#6b7280]">只读分享</p>
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-lg font-semibold text-[#111827]">
              {payload.share.title || payload.conversation.display_title || payload.conversation.title}
            </h1>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => setShowMobileIndex(true)} className="min-h-10 rounded-lg border border-ui bg-surface px-3 text-sm font-medium 2xl:hidden">{t("readerNavigation")}</button>
              {payload.capabilities.toc ? (
                <button type="button" onClick={() => setShowMobileToc(true)} className="hidden min-h-10 rounded-lg border border-ui bg-surface px-3 text-sm font-medium">{t("sectionToc")}</button>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <ResponsiveReaderFrame index={<ConversationIndex
            conversationId={payload.conversation.id}
            activeMessageId={navigationTargetMessageId ?? activeMessageId}
            ready={initialWindowQuery.isSuccess}
            loadPage={indexLoader}
            onNavigate={async (item) => {
              await navigateToTarget(item.messageId);
            }}
          />} content={<div className="reader-content-inner min-w-0 space-y-5">
          {payload.share.description ? <p className="text-sm leading-6 text-[#374151]">{payload.share.description}</p> : null}
          <div ref={topSentinelRef} className={`flex items-center justify-center ${edgeLoading === "previous" || edgeError === "previous" ? "min-h-10" : "h-px"}`}>
            {edgeLoading === "previous" ? <span className="text-sm text-secondary">{t("loadingEarlier")}</span> : null}
            {edgeError === "previous" ? <button type="button" onClick={() => void loadPreviousPage()} className="rounded-lg border border-ui bg-surface px-3 py-1.5 text-sm text-secondary hover:bg-subtle">{t("retryEarlier")}</button> : null}
          </div>
          {initialWindowQuery.isLoading ? <ShareState title="正在加载消息" detail="正在读取首个消息窗口。" /> : null}
          {messages.map((message) => {
            const cached = blockCache[message.id];
            const bounds = getBlockBounds(cached ?? []);
            return (
              <MessageItem
                key={message.id}
                message={message}
                readOnly
                highlightTargetId={targetHighlightId}
                expandHeavyBlocks={expandedMessageIds.has(message.id)}
                cachedBlocks={cached}
                onLoadBlocks={(messageId) => ensureMessageBlocks(messageId)}
                hasPreviousBlocks={Boolean(bounds && bounds.min > 0)}
                hasMoreBlocks={Boolean(bounds && bounds.max < message.block_count - 1)}
                onLoadPreviousBlocks={async () => {
                  if (!bounds) return;
                  await ensureMessageBlocks(message.id, Math.max(0, bounds.min - BLOCK_PAGE_SIZE), true);
                }}
                onLoadMoreBlocks={async () => {
                  if (!bounds) return;
                  await ensureMessageBlocks(message.id, bounds.max + 1);
                }}
              />
            );
          })}
          <div ref={bottomSentinelRef} className={`flex items-center justify-center ${edgeLoading === "next" || edgeError === "next" ? "min-h-10" : "h-px"}`}>
            {edgeLoading === "next" ? <span className="text-sm text-secondary">{t("loadingLater")}</span> : null}
            {edgeError === "next" ? <button type="button" onClick={() => void loadNextPage()} className="rounded-lg border border-ui bg-surface px-3 py-1.5 text-sm text-secondary hover:bg-subtle">{t("retryLater")}</button> : null}
          </div>
          <div aria-hidden="true" className="h-[calc(100vh-6rem)] min-h-72" />
        </div>} toc={<div className="h-full">
          <ConversationToc
            conversationId={payload.conversation.id}
            activeMessageId={navigationTargetMessageId ?? activeMessageId}
            activeBlockId={activeBlockId}
            observerKey={tocObserverKey}
            items={toc}
            onNavigate={async (item) => {
              await navigateToTarget(item.message_id, item.block_index);
            }}
          />
        </div>} />
      {showMobileIndex || showMobileToc ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-page 2xl:hidden md:bg-black/25">
          <button type="button" aria-label={t("close")} className="absolute inset-0 hidden md:block" onClick={() => { setShowMobileIndex(false); setShowMobileToc(false); }} />
          <section className="relative flex h-full w-full flex-col bg-page md:max-w-[28rem] md:border-l md:border-ui md:shadow-2xl" aria-label={t("readerNavigation")}>
            <header className="flex shrink-0 items-center gap-3 border-b border-ui bg-surface px-[3vw] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-4">
              <div className="grid min-w-0 flex-1 grid-cols-2 rounded-lg bg-subtle p-1">
                <button type="button" onClick={() => { setShowMobileIndex(true); setShowMobileToc(false); }} className={`min-h-10 rounded-md px-3 text-sm font-medium ${showMobileIndex ? "bg-surface shadow-sm" : "text-secondary"}`}>{t("dialogueTab")}</button>
                <button type="button" onClick={() => { setShowMobileIndex(false); setShowMobileToc(true); }} className={`min-h-10 rounded-md px-3 text-sm font-medium ${showMobileToc ? "bg-surface shadow-sm" : "text-secondary"}`}>{t("sectionsTab")}</button>
              </div>
              <button type="button" onClick={() => { setShowMobileIndex(false); setShowMobileToc(false); }} className="min-h-10 rounded-lg px-3 text-sm text-secondary hover:bg-subtle">{t("close")}</button>
            </header>
            <div className="shrink-0 px-4 py-2" aria-live="polite">{mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}{mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}</div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
              {showMobileIndex ? <ConversationIndex conversationId={payload.conversation.id} activeMessageId={navigationTargetMessageId ?? activeMessageId} ready={initialWindowQuery.isSuccess} mode="sheet" loadPage={indexLoader} onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget(item.messageId);
                setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
                if (result.ok) setShowMobileIndex(false);
              }} /> : <ConversationToc conversationId={payload.conversation.id} activeMessageId={navigationTargetMessageId ?? activeMessageId} activeBlockId={activeBlockId} observerKey={tocObserverKey} items={toc} mode="sheet" onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget(item.message_id, item.block_index);
                setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
                if (result.ok) setShowMobileToc(false);
              }} />}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );

  async function loadPreviousPage() {
    const current = loadedWindowRef.current;
    if (loadingPreviousRef.current || !current.hasPrevious) return;
    loadingPreviousRef.current = true;
    setEdgeLoading("previous");
    setEdgeError(null);
    const generation = current.generation;
    try {
      const offset = Math.max(0, current.startOffset - PAGE_SIZE);
      const page = await getSharedMessageWindow(token, { offset, limit: current.startOffset - offset });
      if (loadedWindowRef.current.generation !== generation) return;
      const anchor = captureScrollAnchor(null, ACTIVE_READING_OFFSET);
      const intentSequence = scrollIntentSequenceRef.current;
      applyLoadedWindow(prependLoadedWindow(loadedWindowRef.current, page));
      if (anchor) await restoreScrollAnchor({
        root: null,
        anchor,
        tokenIsCurrent: () => loadedWindowRef.current.generation === generation && scrollIntentSequenceRef.current === intentSequence,
      });
    } catch {
      if (loadedWindowRef.current.generation === generation) setEdgeError("previous");
    } finally {
      loadingPreviousRef.current = false;
      setEdgeLoading((currentLoading) => currentLoading === "previous" ? null : currentLoading);
    }
  }

  async function loadNextPage() {
    const current = loadedWindowRef.current;
    if (loadingNextRef.current || !current.hasMore) return;
    loadingNextRef.current = true;
    setEdgeLoading("next");
    setEdgeError(null);
    const generation = current.generation;
    try {
      const page = await getSharedMessageWindow(token, { offset: current.endOffset, limit: PAGE_SIZE });
      if (loadedWindowRef.current.generation !== generation) return;
      const anchor = captureScrollAnchor(null, ACTIVE_READING_OFFSET);
      const intentSequence = scrollIntentSequenceRef.current;
      const next = appendLoadedWindow(loadedWindowRef.current, page);
      const trimmedTop = next.startOffset > loadedWindowRef.current.startOffset;
      applyLoadedWindow(next);
      if (trimmedTop && anchor) await restoreScrollAnchor({
        root: null,
        anchor,
        tokenIsCurrent: () => loadedWindowRef.current.generation === generation && scrollIntentSequenceRef.current === intentSequence,
      });
    } catch {
      if (loadedWindowRef.current.generation === generation) setEdgeError("next");
    } finally {
      loadingNextRef.current = false;
      setEdgeLoading((currentLoading) => currentLoading === "next" ? null : currentLoading);
    }
  }

}

function ShareState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 text-[#111827]">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[#6b7280]">{detail}</p>
    </div>
  );
}

async function sharePositionStorageKey(token: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  return `chat-reader:share-position:${hash}`;
}

function readSharePosition(key: string): PersistedSharePosition | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as PersistedSharePosition : null;
  } catch {
    return null;
  }
}

function captureSharePosition(messages: MessageListItem[]): PersistedSharePosition | null {
  const messageId = resolveActiveMessageId();
  if (!messageId) return null;
  const article = document.getElementById(`message-${messageId}`);
  if (!article) return null;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  let activeBlock: HTMLElement | null = null;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.top <= ACTIVE_READING_OFFSET) activeBlock = block;
    if (rect.top <= ACTIVE_READING_OFFSET && rect.bottom >= ACTIVE_READING_OFFSET) {
      activeBlock = block;
      break;
    }
  }
  const activeBlockIndex = numberOrNull(activeBlock?.dataset.blockIndex);
  let headingBlockIndex: number | null = null;
  for (const block of blocks) {
    const index = numberOrNull(block.dataset.blockIndex);
    if (index === null || (activeBlockIndex !== null && index > activeBlockIndex)) break;
    if (block.dataset.blockType === "heading") headingBlockIndex = index;
  }
  const message = messages.find((item) => item.id === messageId);
  const anchor = activeBlock ?? article;
  return {
    message_id: messageId,
    block_index: activeBlockIndex,
    scroll_offset: Math.max(0, Math.round(ACTIVE_READING_OFFSET - anchor.getBoundingClientRect().top)),
    anchor_data: {
      position_mode: "block-relative-v1",
      order_key: message?.order_key ?? article.dataset.orderKey ?? "",
      ordinal: message?.ordinal ?? null,
      heading_block_index: headingBlockIndex,
      current_version_id: message?.current_version?.id ?? null,
    },
    saved_at: new Date().toISOString(),
  };
}

function resolveActiveMessageId(): string | null {
  const articles = Array.from(document.querySelectorAll<HTMLElement>("article[data-message-id]"));
  let nearest: { id: string; distance: number } | null = null;
  for (const article of articles) {
    const id = article.dataset.messageId;
    if (!id) continue;
    const rect = article.getBoundingClientRect();
    if (rect.top <= ACTIVE_READING_OFFSET && rect.bottom >= ACTIVE_READING_OFFSET) return id;
    const distance = Math.min(Math.abs(rect.top - ACTIVE_READING_OFFSET), Math.abs(rect.bottom - ACTIVE_READING_OFFSET));
    if (!nearest || distance < nearest.distance) nearest = { id, distance };
  }
  return nearest?.id ?? null;
}

function mergeBlockWindows(current: RenderBlockRead[] | undefined, incoming: RenderBlockRead[]): RenderBlockRead[] {
  const byIndex = new Map<number, RenderBlockRead>();
  for (const block of current ?? []) byIndex.set(block.block_index, block);
  for (const block of incoming) byIndex.set(block.block_index, block);
  return Array.from(byIndex.values()).sort((left, right) => left.block_index - right.block_index);
}

function getBlockBounds(blocks: RenderBlockRead[]): { min: number; max: number } | null {
  if (blocks.length === 0) return null;
  return {
    min: Math.min(...blocks.map((block) => block.block_index)),
    max: Math.max(...blocks.map((block) => block.block_index)),
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}
