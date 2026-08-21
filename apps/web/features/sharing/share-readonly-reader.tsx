"use client";

import { useQuery } from "@tanstack/react-query";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiRequestError,
  getSharedConversation,
  getSharedDialogueIndex,
  getSharedReaderTurn,
  getSharedToc,
  unlockSharedConversation,
} from "../../lib/api";
import type { LoadedMessageWindow, MessageListItem, NavigationResult, PersistedSharePosition, ScrollAnchorSnapshot, ScrollDirection } from "../../lib/types";
import { MessageItem } from "../conversations/message-item";
import { captureScrollAnchor, estimateCharacterOffsetAtReadingLine, navigateMountedTarget, restoreScrollAnchor } from "../conversations/reader-navigation";
import {
  emptyLoadedWindow,
  INITIAL_WINDOW_TURNS,
  loadCompleteTurnWindow,
  mergeLoadedTurnWindow,
  replaceLoadedWindow,
  trimLoadedTurnWindow,
  type CompleteTurnWindow,
} from "../conversations/reader-window";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc, resolveActiveHeadingId } from "../toc/conversation-toc";
import { ResponsiveReaderFrame } from "../../components/responsive-reader-frame";
import { useTranslations } from "../../components/preferences-provider";
import { MobileReaderSheet } from "../../components/mobile-reader-sheet";
import { X } from "lucide-react";
import { acquireReaderBlockLease, notifyReaderWindowLayoutChanged, type ReaderBlockLease } from "../conversations/block-virtualization";
import { resolveActiveReadingTarget } from "../conversations/reader-active-position";
import { ReaderMarkdownCopyBoundary } from "../conversations/reader-markdown-copy";

const ACTIVE_READING_OFFSET = 96;

export function ShareReadonlyReader({ token }: { token: string }) {
  const t = useTranslations();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationTab, setNavigationTab] = useState<"dialogue" | "sections">("dialogue");
  const [loadedWindow, setLoadedWindow] = useState<LoadedMessageWindow>(() => emptyLoadedWindow());
  const messages = loadedWindow.items;
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [navigationTargetMessageId, setNavigationTargetMessageId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [targetHighlightId, setTargetHighlightId] = useState<string | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [savedPosition, setSavedPosition] = useState<PersistedSharePosition | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [positionReady, setPositionReady] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [mobileNavigation, setMobileNavigation] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  const navigationTokenRef = useRef(0);
  const restoreAttemptedRef = useRef(false);
  const latestStablePositionRef = useRef<PersistedSharePosition | null>(null);
  const messagesRef = useRef<MessageListItem[]>([]);
  const loadedWindowRef = useRef<LoadedMessageWindow>(emptyLoadedWindow());
  const windowGenerationRef = useRef(0);
  const initialWindowAppliedRef = useRef(false);
  const loadingPreviousRef = useRef(false);
  const loadingNextRef = useRef(false);
  const edgeTransitionRef = useRef<"previous" | "next" | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const userScrollIntentRef = useRef(false);
  const scrollDirectionRef = useRef<ScrollDirection>(null);
  const scrollIntentSequenceRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const loadPreviousActionRef = useRef<() => void>(() => undefined);
  const loadNextActionRef = useRef<() => void>(() => undefined);
  const previousSentinelVisibleRef = useRef(false);
  const nextSentinelVisibleRef = useRef(false);
  const activeMessageIdRef = useRef<string | null>(null);
  const activeBlockIdRef = useRef<string | null>(null);
  const [edgeLoading, setEdgeLoading] = useState<"previous" | "next" | null>(null);
  const [edgeError, setEdgeError] = useState<"previous" | "next" | null>(null);
  const previousTurnAnchorRef = useRef<string | null>(null);
  const nextTurnAnchorRef = useRef<string | null>(null);

  useEffect(() => {
    activeMessageIdRef.current = activeMessageId;
  }, [activeMessageId]);

  useEffect(() => {
    activeBlockIdRef.current = activeBlockId;
  }, [activeBlockId]);

  const shareQuery = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: () => getSharedConversation(token),
  });
  const initialWindowQuery = useQuery({
    queryKey: ["shared-reader-turn-window", token, savedPosition?.message_id ?? null],
    queryFn: () => loadSharedCompleteTurnWindow(
      token,
      savedPosition?.message_id ?? undefined,
      INITIAL_WINDOW_TURNS,
    ),
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
  const activeHeadingId = useMemo(
    () => resolveActiveHeadingId(toc, activeBlockId),
    [activeBlockId, toc],
  );

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
    edgeTransitionRef.current = null;
    userScrollIntentRef.current = false;
    scrollDirectionRef.current = null;
    scrollIntentSequenceRef.current += 1;
    setEdgeLoading(null);
    setEdgeError(null);
    previousTurnAnchorRef.current = null;
    nextTurnAnchorRef.current = null;
  }, [token]);

  useEffect(() => {
    if (!shareQuery.isError || !storageKey) return;
    window.localStorage.removeItem(storageKey);
  }, [shareQuery.isError, storageKey]);

  useEffect(() => {
    if (!initialWindowQuery.data || initialWindowAppliedRef.current) return;
    initialWindowAppliedRef.current = true;
    const page = initialWindowQuery.data;
    previousTurnAnchorRef.current = page.previousTurnAnchorMessageId;
    nextTurnAnchorRef.current = page.nextTurnAnchorMessageId;
    const next = replaceLoadedWindow(page, windowGenerationRef.current);
    loadedWindowRef.current = next;
    setLoadedWindow(next);
    setActiveMessageId(savedPosition?.message_id ?? page.items[0]?.id ?? null);
  }, [initialWindowQuery.data, savedPosition?.message_id]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const applyLoadedWindow = useCallback((next: LoadedMessageWindow) => {
    loadedWindowRef.current = next;
    setLoadedWindow(next);
  }, []);

  const navigateToTarget = useCallback(async (
    messageId: string,
    blockIndex?: number,
    alignmentOffset = 80,
    characterOffset?: number,
  ): Promise<NavigationResult> => {
    const navigationToken = navigationTokenRef.current + 1;
    navigationTokenRef.current = navigationToken;
    const generation = windowGenerationRef.current + 1;
    windowGenerationRef.current = generation;
    applyLoadedWindow({ ...loadedWindowRef.current, generation });
    userScrollIntentRef.current = false;
    scrollDirectionRef.current = null;
    scrollIntentSequenceRef.current += 1;
    setNavigationTargetMessageId(messageId);
    const messageDomId = `message-${messageId}`;
    const blockDomId = blockIndex === undefined ? null : `block-${messageId}-${blockIndex}`;
    let blockLease: ReaderBlockLease | null = null;
    try {
      if (!loadedWindowRef.current.items.some((message) => message.id === messageId)) {
        const page = await loadSharedCompleteTurnWindow(token, messageId);
        if (navigationTokenRef.current !== navigationToken) {
          return { ok: false, targetId: blockDomId ?? messageDomId, reason: "cancelled" };
        }
        initialWindowAppliedRef.current = true;
        previousTurnAnchorRef.current = page.previousTurnAnchorMessageId;
        nextTurnAnchorRef.current = page.nextTurnAnchorMessageId;
        applyLoadedWindow(replaceLoadedWindow(page, generation));
      }
      if (blockIndex !== undefined) {
        blockLease = await acquireReaderBlockLease(
          messageId,
          blockIndex,
          () => navigationTokenRef.current === navigationToken,
        );
      }
      const result = await navigateMountedTarget({
        root: null,
        targetId: blockDomId ?? messageDomId,
        tokenIsCurrent: () => navigationTokenRef.current === navigationToken,
        offset: alignmentOffset,
        characterOffset,
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
    } finally {
      blockLease?.release();
    }
  }, [applyLoadedWindow, token]);

  useEffect(() => {
    if (restoreAttemptedRef.current || !initialWindowQuery.isSuccess) return;
    restoreAttemptedRef.current = true;
    if (!savedPosition?.message_id) {
      setPositionReady(true);
      return;
    }
    const candidates: Array<number | undefined> = [
      findBlockIndexById(
        loadedWindowRef.current.items.find((message) => message.id === savedPosition.message_id),
        typeof savedPosition.anchor_data.block_id === "string" ? savedPosition.anchor_data.block_id : null,
      ) ?? undefined,
      savedPosition.block_index ?? undefined,
      numberOrNull(savedPosition.anchor_data.heading_block_index) ?? undefined,
      undefined,
    ].filter((value, index, values) => values.indexOf(value) === index);
    const savedCharacterOffset = numberOrNull(savedPosition.anchor_data.character_offset);
    const exactBlockIndex = candidates.find((candidate) => candidate !== undefined);
    void (async () => {
      for (const candidate of candidates) {
        const useCharacterAnchor = candidate !== undefined && candidate === exactBlockIndex && savedCharacterOffset !== null;
        const result = await navigateToTarget(
          savedPosition.message_id,
          candidate,
          useCharacterAnchor
            ? ACTIVE_READING_OFFSET
            : candidate === undefined
            ? ACTIVE_READING_OFFSET
            : ACTIVE_READING_OFFSET - (numberOrNull(savedPosition.anchor_data.block_offset) ?? savedPosition.scroll_offset),
          useCharacterAnchor ? savedCharacterOffset : undefined,
        );
        if (result.ok) return;
      }
    })().finally(() => setPositionReady(true));
  }, [initialWindowQuery.isSuccess, navigateToTarget, savedPosition]);

  const refreshActiveMessageFromLayout = useCallback((unlockNavigation = false) => {
    if (unlockNavigation) {
      setNavigationTargetMessageId(null);
    }
    const target = resolveActiveReadingTarget(null, ACTIVE_READING_OFFSET);
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

  loadPreviousActionRef.current = () => { void loadPreviousPage(); };
  loadNextActionRef.current = () => { void loadNextPage(); };

  useEffect(() => {
    if (messages.length === 0) return undefined;
    let frame = 0;
    let sampleTimer: number | null = null;
    let persistTimer: number | null = null;
    let lastSampleAt = 0;
    let lastScrollAt = 0;
    let pendingUnlock = false;
    const scheduleRefresh = (unlockNavigation = false) => {
      pendingUnlock ||= unlockNavigation;
      if (frame || sampleTimer !== null) return;
      const wait = Math.max(0, 80 - (window.performance.now() - lastSampleAt));
      const queueFrame = () => {
        sampleTimer = null;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          lastSampleAt = window.performance.now();
          const shouldUnlock = pendingUnlock;
          pendingUnlock = false;
          refreshActiveMessageFromLayout(shouldUnlock);
        });
      };
      if (wait > 0) sampleTimer = window.setTimeout(queueFrame, wait);
      else queueFrame();
    };
    const onManualIntent = () => scheduleRefresh(true);
    const onScroll = () => {
      const current = window.scrollY;
      const delta = current - lastScrollTopRef.current;
      if (userScrollIntentRef.current && edgeTransitionRef.current === null && Math.abs(delta) > 1) {
        scrollDirectionRef.current = delta < 0 ? "up" : "down";
      }
      lastScrollTopRef.current = current;
      scheduleRefresh(false);
      lastScrollAt = window.performance.now();
      if (persistTimer === null && storageKey && positionReady) {
        persistTimer = window.setTimeout(persistWhenIdle, 1000);
      }
    };
    const persist = () => {
      if (!storageKey || !positionReady) return;
      const position = captureSharePosition(messagesRef.current);
      if (!position) return;
      latestStablePositionRef.current = position;
      window.localStorage.setItem(storageKey, JSON.stringify(position));
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
    const persistCached = () => {
      if (!storageKey) return;
      const position = latestStablePositionRef.current;
      if (position) window.localStorage.setItem(storageKey, JSON.stringify(position));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persistCached();
    };
    const markScrollIntent = () => {
      userScrollIntentRef.current = true;
      scrollIntentSequenceRef.current += 1;
      navigationTokenRef.current += 1;
      onManualIntent();
    };
    const markWheelIntent = (event: WheelEvent) => {
      markScrollIntent();
      if (event.deltaY < 0) {
        scrollDirectionRef.current = "up";
        if (previousSentinelVisibleRef.current) loadPreviousActionRef.current();
      } else if (event.deltaY > 0) {
        scrollDirectionRef.current = "down";
        if (nextSentinelVisibleRef.current) loadNextActionRef.current();
      }
    };
    const markKeyboardIntent = (event: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      markScrollIntent();
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) scrollDirectionRef.current = "up";
      if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) scrollDirectionRef.current = "down";
    };
    window.addEventListener("pointerdown", markScrollIntent, { passive: true });
    window.addEventListener("wheel", markWheelIntent, { passive: true });
    window.addEventListener("touchstart", markScrollIntent, { passive: true });
    window.addEventListener("keydown", markKeyboardIntent);
    window.addEventListener("click", onManualIntent, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", persistCached);
    scheduleRefresh(false);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (sampleTimer !== null) window.clearTimeout(sampleTimer);
      if (persistTimer !== null) window.clearTimeout(persistTimer);
      window.removeEventListener("pointerdown", markScrollIntent);
      window.removeEventListener("wheel", markWheelIntent);
      window.removeEventListener("touchstart", markScrollIntent);
      window.removeEventListener("keydown", markKeyboardIntent);
      window.removeEventListener("click", onManualIntent);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", persistCached);
    };
  }, [messages.length, positionReady, refreshActiveMessageFromLayout, storageKey]);

  useEffect(() => {
    const top = topSentinelRef.current;
    const bottom = bottomSentinelRef.current;
    if (!top || !bottom || messages.length === 0) return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === top) previousSentinelVisibleRef.current = entry.isIntersecting;
        if (entry.target === bottom) nextSentinelVisibleRef.current = entry.isIntersecting;
        if (!entry.isIntersecting || !userScrollIntentRef.current) continue;
        if (entry.target === top && scrollDirectionRef.current === "up") void loadPreviousPage();
        if (entry.target === bottom && scrollDirectionRef.current === "down") void loadNextPage();
      }
    }, { rootMargin: "45% 0px", threshold: 0 });
    observer.observe(top);
    observer.observe(bottom);
    return () => {
      previousSentinelVisibleRef.current = false;
      nextSentinelVisibleRef.current = false;
      observer.disconnect();
    };
  }, [messages.length]);

  const indexLoader = useCallback(
    (options: { offset?: number; limit?: number; anchorMessageId?: string }) =>
      getSharedDialogueIndex(token, options),
    [token],
  );
  const tocObserverKey = useMemo(
    () => `${activeMessageId ?? "none"}:${messages.length}`,
    [activeMessageId, messages.length],
  );

  if (shareQuery.isLoading || !storageReady) {
    return <ShareState title="正在加载分享" detail="正在获取只读会话信息。" />;
  }
  if (shareQuery.isError) {
    if (shareQuery.error instanceof ApiRequestError && shareQuery.error.status === 401) {
      return <SharePasswordGate
        password={unlockPassword}
        onPasswordChange={setUnlockPassword}
        busy={unlockBusy}
        error={unlockError}
        onSubmit={async () => {
          setUnlockBusy(true);
          setUnlockError(null);
          try {
            await unlockSharedConversation(token, unlockPassword);
            await shareQuery.refetch();
          } catch (error) {
            setUnlockError(error instanceof Error ? error.message : "Unable to unlock this share.");
          } finally {
            setUnlockBusy(false);
          }
        }}
      />;
    }
    return <ShareState title="分享不可用" detail={shareQuery.error.message} />;
  }
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
              <button type="button" onClick={() => { setNavigationTab("dialogue"); setNavigationOpen(true); }} className="min-h-10 rounded-lg border border-ui bg-surface px-3 text-sm font-medium 2xl:hidden">{t("readerNavigation")}</button>
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
          />} content={<ReaderMarkdownCopyBoundary className="reader-content-inner min-w-0 space-y-5">
          {payload.share.description ? <p className="text-sm leading-6 text-[#374151]">{payload.share.description}</p> : null}
          <div ref={topSentinelRef} className={`flex items-center justify-center ${edgeLoading === "previous" || edgeError === "previous" ? "min-h-10" : "h-px"}`}>
            {edgeLoading === "previous" ? <span className="text-sm text-secondary">{t("loadingEarlier")}</span> : null}
            {edgeError === "previous" ? <button type="button" onClick={() => void loadPreviousPage()} className="rounded-lg border border-ui bg-surface px-3 py-1.5 text-sm text-secondary hover:bg-subtle">{t("retryEarlier")}</button> : null}
          </div>
          {initialWindowQuery.isLoading ? <ShareState title="正在加载消息" detail="正在读取首个消息窗口。" /> : null}
          {messages.map((message) => {
            return (
              <MessageItem
                key={message.id}
                message={message}
                readOnly
                highlightTargetId={targetHighlightId}
                scrollRootMode="window"
                attachmentAccess={{ kind: "share", token }}
              />
            );
          })}
          <div ref={bottomSentinelRef} className={`flex items-center justify-center ${edgeLoading === "next" || edgeError === "next" ? "min-h-10" : "h-px"}`}>
            {edgeLoading === "next" ? <span className="text-sm text-secondary">{t("loadingLater")}</span> : null}
            {edgeError === "next" ? <button type="button" onClick={() => void loadNextPage()} className="rounded-lg border border-ui bg-surface px-3 py-1.5 text-sm text-secondary hover:bg-subtle">{t("retryLater")}</button> : null}
          </div>
          {!loadedWindow.hasMore ? <div aria-hidden="true" className="h-[calc(100vh-6rem)] min-h-72" /> : null}
        </ReaderMarkdownCopyBoundary>} toc={<div className="h-full">
          <ConversationToc
            conversationId={payload.conversation.id}
            activeMessageId={navigationTargetMessageId ?? activeMessageId}
            activeHeadingId={activeHeadingId}
            observerKey={tocObserverKey}
            items={toc}
            onNavigate={async (item) => {
              await navigateToTarget(item.message_id, item.block_index);
            }}
          />
        </div>} />
      <MobileReaderSheet
        open={navigationOpen}
        onOpenChange={setNavigationOpen}
        title={t("navigationTitle")}
        header={<NavigationTabs tab={navigationTab} onTabChange={setNavigationTab} onClose={() => setNavigationOpen(false)} />}
        status={<>{mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}{mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}</>}
      >
        {navigationTab === "dialogue" ? <ConversationIndex conversationId={payload.conversation.id} activeMessageId={navigationTargetMessageId ?? activeMessageId} ready={initialWindowQuery.isSuccess} mode="sheet" loadPage={indexLoader} onNavigate={async (item) => {
          setMobileNavigation({ pending: true, error: null });
          const result = await navigateToTarget(item.messageId);
          setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
          if (result.ok) setNavigationOpen(false);
        }} /> : <ConversationToc conversationId={payload.conversation.id} activeMessageId={navigationTargetMessageId ?? activeMessageId} activeHeadingId={activeHeadingId} observerKey={tocObserverKey} items={toc} mode="sheet" onNavigate={async (item) => {
          setMobileNavigation({ pending: true, error: null });
          const result = await navigateToTarget(item.message_id, item.block_index);
          setMobileNavigation({ pending: false, error: result.ok ? null : t("locateFailed") });
          if (result.ok) setNavigationOpen(false);
        }} />}
      </MobileReaderSheet>
      {navigationOpen ? (
        <div className="fixed inset-0 z-50 hidden justify-end bg-black/25 md:flex 2xl:hidden">
          <button type="button" className="absolute inset-0" aria-label={t("close")} onClick={() => setNavigationOpen(false)} />
          <section className="relative flex h-full w-[min(28rem,42vw)] flex-col border-l border-ui bg-page shadow-2xl">
            <header className="border-b border-ui p-4"><NavigationTabs tab={navigationTab} onTabChange={setNavigationTab} onClose={() => setNavigationOpen(false)} /></header>
            <div className="px-4 py-2" aria-live="polite">{mobileNavigation.pending ? <p className="text-sm text-accent">{t("locating")}</p> : null}{mobileNavigation.error ? <p className="text-sm text-[var(--danger)]">{mobileNavigation.error}</p> : null}</div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">{navigationTab === "dialogue" ? <ConversationIndex conversationId={payload.conversation.id} activeMessageId={navigationTargetMessageId ?? activeMessageId} ready={initialWindowQuery.isSuccess} mode="sheet" loadPage={indexLoader} onNavigate={async (item) => { const result = await navigateToTarget(item.messageId); if (result.ok) setNavigationOpen(false); }} /> : <ConversationToc conversationId={payload.conversation.id} activeMessageId={navigationTargetMessageId ?? activeMessageId} activeHeadingId={activeHeadingId} observerKey={tocObserverKey} items={toc} mode="sheet" onNavigate={async (item) => { const result = await navigateToTarget(item.message_id, item.block_index); if (result.ok) setNavigationOpen(false); }} />}</div>
          </section>
        </div>
      ) : null}
    </main>
  );

  async function loadPreviousPage() {
    const current = loadedWindowRef.current;
    const previousAnchor = previousTurnAnchorRef.current;
    if (loadingPreviousRef.current || loadingNextRef.current || !current.hasPrevious || !previousAnchor) return;
    loadingPreviousRef.current = true;
    edgeTransitionRef.current = "previous";
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
      const page = await loadSharedCompleteTurnWindow(token, previousAnchor);
      if (!transitionIsCurrent()) return;
      const anchor = captureScrollAnchor(null, ACTIVE_READING_OFFSET);
      if (anchor) {
        anchorLease = await acquireShareScrollAnchorLease(anchor, transitionIsCurrent);
        if (!anchorLease) {
          if (!transitionIsCurrent()) return;
          throw new Error("The previous-window reading anchor could not be pinned.");
        }
      }
      const merged = mergeLoadedTurnWindow(current, page);
      syncShareTurnAnchors(merged, previousTurnAnchorRef, nextTurnAnchorRef);
      applyLoadedWindow(merged);
      notifyReaderWindowLayoutChanged();
      const restored = anchor
        ? await restoreScrollAnchor({ root: null, anchor, tokenIsCurrent: transitionIsCurrent })
        : false;
      if (anchor && restored && transitionIsCurrent()) {
        const protectedMessageId = messageIdForShareAnchor(anchor);
        const trimmed = trimLoadedTurnWindow(loadedWindowRef.current, "previous", protectedMessageId);
        if (trimmed !== loadedWindowRef.current) {
          applyLoadedWindow(trimmed);
          syncShareTurnAnchors(trimmed, previousTurnAnchorRef, nextTurnAnchorRef);
          notifyReaderWindowLayoutChanged();
          await restoreScrollAnchor({ root: null, anchor, tokenIsCurrent: transitionIsCurrent });
        }
      }
    } catch {
      if (loadedWindowRef.current.generation === generation) setEdgeError("previous");
    } finally {
      anchorLease?.release();
      loadingPreviousRef.current = false;
      if (edgeTransitionRef.current === "previous") edgeTransitionRef.current = null;
      setEdgeLoading((currentLoading) => currentLoading === "previous" ? null : currentLoading);
    }
  }

  async function loadNextPage() {
    const current = loadedWindowRef.current;
    const nextAnchor = nextTurnAnchorRef.current;
    if (loadingNextRef.current || loadingPreviousRef.current || !current.hasMore || !nextAnchor) return;
    loadingNextRef.current = true;
    edgeTransitionRef.current = "next";
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
      const page = await loadSharedCompleteTurnWindow(token, nextAnchor);
      if (!transitionIsCurrent()) return;
      const anchor = captureScrollAnchor(null, ACTIVE_READING_OFFSET);
      if (anchor) {
        anchorLease = await acquireShareScrollAnchorLease(anchor, transitionIsCurrent);
        if (!anchorLease) {
          if (!transitionIsCurrent()) return;
          throw new Error("The next-window reading anchor could not be pinned.");
        }
      }
      const next = mergeLoadedTurnWindow(current, page);
      syncShareTurnAnchors(next, previousTurnAnchorRef, nextTurnAnchorRef);
      applyLoadedWindow(next);
      notifyReaderWindowLayoutChanged();
      const restored = anchor
        ? await restoreScrollAnchor({ root: null, anchor, tokenIsCurrent: transitionIsCurrent })
        : false;
      if (anchor && restored && transitionIsCurrent()) {
        const protectedMessageId = messageIdForShareAnchor(anchor);
        const trimmed = trimLoadedTurnWindow(loadedWindowRef.current, "next", protectedMessageId);
        if (trimmed !== loadedWindowRef.current) {
          applyLoadedWindow(trimmed);
          syncShareTurnAnchors(trimmed, previousTurnAnchorRef, nextTurnAnchorRef);
          notifyReaderWindowLayoutChanged();
          await restoreScrollAnchor({ root: null, anchor, tokenIsCurrent: transitionIsCurrent });
        }
      }
    } catch {
      if (loadedWindowRef.current.generation === generation) setEdgeError("next");
    } finally {
      anchorLease?.release();
      loadingNextRef.current = false;
      if (edgeTransitionRef.current === "next") edgeTransitionRef.current = null;
      setEdgeLoading((currentLoading) => currentLoading === "next" ? null : currentLoading);
    }
  }

}

async function loadSharedCompleteTurnWindow(
  token: string,
  anchorMessageId?: string,
  targetTurnCount?: number,
): Promise<CompleteTurnWindow> {
  return loadCompleteTurnWindow(
    (anchor) => getSharedReaderTurn(token, anchor),
    anchorMessageId,
    targetTurnCount,
  );
}

function syncShareTurnAnchors(
  window: LoadedMessageWindow,
  previousRef: { current: string | null },
  nextRef: { current: string | null },
): void {
  previousRef.current = window.turns[0]?.previous_anchor_message_id ?? null;
  nextRef.current = window.turns.at(-1)?.next_anchor_message_id ?? null;
}

function messageIdForShareAnchor(anchor: ScrollAnchorSnapshot): string | null {
  return document.getElementById(anchor.targetId)
    ?.closest<HTMLElement>("article[data-message-id]")
    ?.dataset.messageId ?? null;
}

async function acquireShareScrollAnchorLease(
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

function NavigationTabs({
  tab,
  onTabChange,
  onClose,
}: {
  tab: "dialogue" | "sections";
  onTabChange: (tab: "dialogue" | "sections") => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex items-center gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-2 rounded-lg bg-subtle p-1">
        <button type="button" onClick={() => onTabChange("dialogue")} className={`min-h-10 rounded-md px-3 text-sm font-medium ${tab === "dialogue" ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{t("dialogueTab")}</button>
        <button type="button" onClick={() => onTabChange("sections")} className={`min-h-10 rounded-md px-3 text-sm font-medium ${tab === "sections" ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{t("sectionsTab")}</button>
      </div>
      <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="h-5 w-5" /></button>
    </div>
  );
}

function ShareState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 text-[#111827]">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[#6b7280]">{detail}</p>
    </div>
  );
}

function SharePasswordGate({
  password,
  onPasswordChange,
  busy,
  error,
  onSubmit,
}: {
  password: string;
  onPasswordChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => Promise<void>;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 text-primary">
      <form className="w-full max-w-sm rounded-xl border border-ui bg-surface p-6 shadow-sm" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>
        <h1 className="text-lg font-semibold">This share is password protected</h1>
        <label className="mt-5 block text-sm text-secondary" htmlFor="share-password">Password</label>
        <input id="share-password" data-dialog-initial-focus autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => onPasswordChange(event.target.value)} className="mt-1 block w-full rounded-lg border border-ui bg-surface px-3 py-2 text-primary outline-none focus:ring-2 focus:ring-[var(--focus)]" />
        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        <button type="submit" disabled={busy || !password} className="mt-5 min-h-10 w-full rounded-lg bg-[var(--text)] px-3 py-2 text-sm font-medium text-[var(--surface)] disabled:cursor-wait disabled:opacity-50">{busy ? "Checking..." : "View shared content"}</button>
      </form>
    </main>
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
  const activeTarget = resolveActiveReadingTarget(null, ACTIVE_READING_OFFSET);
  const messageId = activeTarget?.messageId;
  if (!messageId) return null;
  const article = document.getElementById(`message-${messageId}`);
  if (!article) return null;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  let activeBlock = activeTarget?.blockId ? document.getElementById(activeTarget.blockId) : null;
  if (!activeBlock || !article.contains(activeBlock)) {
    activeBlock = null;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.top <= ACTIVE_READING_OFFSET) activeBlock = block;
      if (rect.top <= ACTIVE_READING_OFFSET && rect.bottom >= ACTIVE_READING_OFFSET) {
        activeBlock = block;
        break;
      }
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
  const blockOffset = Math.max(0, Math.round(ACTIVE_READING_OFFSET - anchor.getBoundingClientRect().top));
  const scrollableHeight = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const characterOffset = activeBlockIndex === null
    ? null
    : estimateCharacterOffsetAtReadingLine(null, messageId, activeBlockIndex, ACTIVE_READING_OFFSET) ?? null;
  return {
    message_id: messageId,
    block_index: activeBlockIndex,
    scroll_offset: blockOffset,
    anchor_data: {
      position_mode: "block-relative-v2",
      block_id: activeBlock?.dataset.blockId ?? null,
      version_id: message?.current_version?.id ?? null,
      order_key: message?.order_key ?? article.dataset.orderKey ?? "",
      scroll_ratio: scrollableHeight > 0 ? window.scrollY / scrollableHeight : 0,
      block_offset: blockOffset,
      character_offset: characterOffset,
      ordinal: message?.ordinal ?? null,
      heading_block_index: headingBlockIndex,
      current_version_id: message?.current_version?.id ?? null,
    },
    saved_at: new Date().toISOString(),
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function findBlockIndexById(message: MessageListItem | undefined, blockId: string | null): number | null {
  if (!message || !blockId) return null;
  const blocks = message.render_blocks ?? message.current_version?.blocks ?? [];
  return blocks.find((block) => block.id === blockId)?.block_index ?? null;
}
