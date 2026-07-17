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
import type { MessageListItem, NavigationResult, PersistedSharePosition, RenderBlockRead } from "../../lib/types";
import { MessageItem } from "../conversations/message-item";
import { navigateMountedTarget } from "../conversations/reader-navigation";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";

const PAGE_SIZE = 30;
const ACTIVE_READING_OFFSET = 96;

export function ShareReadonlyReader({ token }: { token: string }) {
  const [showMobileIndex, setShowMobileIndex] = useState(false);
  const [showMobileToc, setShowMobileToc] = useState(false);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
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
  const minOffsetRef = useRef(0);
  const maxOffsetRef = useRef(0);
  const totalRef = useRef(0);
  const loadingPreviousRef = useRef(false);
  const loadingNextRef = useRef(false);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);

  const shareQuery = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: () => getSharedConversation(token),
  });
  const initialWindowQuery = useQuery({
    queryKey: ["shared-message-window", token, savedPosition?.message_id ?? null],
    queryFn: () => getSharedMessageWindow(token, {
      limit: PAGE_SIZE,
      anchorMessageId: savedPosition?.message_id ?? undefined,
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
    if (!shareQuery.isError || !storageKey) return;
    window.localStorage.removeItem(storageKey);
  }, [shareQuery.isError, storageKey]);

  useEffect(() => {
    if (!initialWindowQuery.data) return;
    const page = initialWindowQuery.data;
    minOffsetRef.current = page.offset;
    maxOffsetRef.current = page.offset + page.items.length;
    totalRef.current = page.total;
    setMessages(page.items);
    setActiveMessageId(savedPosition?.message_id ?? page.items[0]?.id ?? null);
  }, [initialWindowQuery.data, savedPosition?.message_id]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const mergeWindow = useCallback((page: { items: MessageListItem[]; offset: number; total: number }) => {
    minOffsetRef.current = Math.min(minOffsetRef.current, page.offset);
    maxOffsetRef.current = Math.max(maxOffsetRef.current, page.offset + page.items.length);
    totalRef.current = page.total;
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of page.items) byId.set(message.id, message);
      return Array.from(byId.values()).sort((left, right) => left.order_key.localeCompare(right.order_key));
    });
  }, []);

  const ensureMessageBlocks = useCallback(async (messageId: string, start = 0): Promise<RenderBlockRead[]> => {
    const cached = blockCache[messageId] ?? [];
    if (cached.some((block) => block.block_index === start) || (start === 0 && cached.length > 0)) {
      return cached;
    }
    const blocks = await getSharedMessageBlocks(token, messageId, { start, limit: 200 });
    setBlockCache((current) => ({
      ...current,
      [messageId]: mergeBlockWindows(current[messageId], blocks),
    }));
    return blocks;
  }, [blockCache, token]);

  const navigateToTarget = useCallback(async (
    messageId: string,
    blockIndex?: number,
    alignmentOffset = 80,
  ): Promise<NavigationResult> => {
    const navigationToken = navigationTokenRef.current + 1;
    navigationTokenRef.current = navigationToken;
    navigationLockUntilRef.current = Date.now() + 5000;
    setNavigationTargetMessageId(messageId);
    const messageDomId = `message-${messageId}`;
    const blockDomId = blockIndex === undefined ? null : `block-${messageId}-${blockIndex}`;
    try {
      if (!document.getElementById(messageDomId)) {
        const page = await getSharedMessageWindow(token, {
          limit: PAGE_SIZE,
          anchorMessageId: messageId,
        });
        if (navigationTokenRef.current !== navigationToken) {
          return { ok: false, targetId: blockDomId ?? messageDomId, reason: "cancelled" };
        }
        mergeWindow(page);
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
  }, [ensureMessageBlocks, mergeWindow, token]);

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
    const onScroll = () => scheduleRefresh(false);
    window.addEventListener("pointerdown", onManualIntent, { passive: true });
    window.addEventListener("wheel", onManualIntent, { passive: true });
    window.addEventListener("touchstart", onManualIntent, { passive: true });
    window.addEventListener("click", onManualIntent, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    scheduleRefresh(false);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onManualIntent);
      window.removeEventListener("wheel", onManualIntent);
      window.removeEventListener("touchstart", onManualIntent);
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
        if (!entry.isIntersecting) continue;
        if (entry.target === top) void loadPreviousPage();
        if (entry.target === bottom) void loadNextPage();
      }
    }, { rootMargin: "600px 0px", threshold: 0 });
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

  if (shareQuery.isLoading || !storageReady) {
    return <ShareState title="正在加载分享" detail="正在获取只读会话信息。" />;
  }
  if (shareQuery.isError) return <ShareState title="分享不可用" detail={shareQuery.error.message} />;
  if (!payload) return <ShareState title="分享不可用" detail="服务未返回分享信息。" />;

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f7f8] text-[#111827]">
      <header className="sticky top-0 z-10 border-b border-[#e5e5e5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl flex-col justify-center px-4 sm:px-6">
          <p className="text-xs font-medium text-[#6b7280]">只读分享</p>
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-lg font-semibold text-[#111827]">
              {payload.share.title || payload.conversation.display_title || payload.conversation.title}
            </h1>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => setShowMobileIndex(true)} className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium xl:hidden">索引</button>
              {payload.capabilities.toc ? (
                <button type="button" onClick={() => setShowMobileToc(true)} className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium xl:hidden">目录</button>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <section className="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-6 px-3 py-5 sm:px-6 sm:py-6 xl:grid-cols-[300px_minmax(0,820px)_260px] xl:items-start xl:justify-center">
        <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto xl:block">
          <ConversationIndex
            conversationId={payload.conversation.id}
            activeMessageId={navigationTargetMessageId ?? activeMessageId}
            ready={initialWindowQuery.isSuccess}
            mode="sheet"
            loadPage={indexLoader}
            onNavigate={async (item) => {
              await navigateToTarget(item.messageId);
            }}
          />
        </aside>
        <div className="mx-auto w-full max-w-[820px] min-w-0 space-y-5">
          {payload.share.description ? <p className="text-sm leading-6 text-[#374151]">{payload.share.description}</p> : null}
          <div ref={topSentinelRef} className="h-px" aria-hidden="true" />
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
                  await ensureMessageBlocks(message.id, Math.max(0, bounds.min - 200));
                }}
                onLoadMoreBlocks={async () => {
                  if (!bounds) return;
                  await ensureMessageBlocks(message.id, bounds.max + 1);
                }}
              />
            );
          })}
          <div ref={bottomSentinelRef} className="h-px" aria-hidden="true" />
          <div aria-hidden="true" className="h-[calc(100vh-6rem)] min-h-72" />
        </div>
        <div className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto xl:block">
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
        </div>
      </section>
      {showMobileIndex ? (
        <MobileSheet title="对话索引" navigation={mobileNavigation} onClose={() => setShowMobileIndex(false)}>
          <ConversationIndex
            conversationId={payload.conversation.id}
            activeMessageId={navigationTargetMessageId ?? activeMessageId}
            ready={initialWindowQuery.isSuccess}
            mode="sheet"
            loadPage={indexLoader}
            onNavigate={async (item) => {
              setMobileNavigation({ pending: true, error: null });
              const result = await navigateToTarget(item.messageId);
              setMobileNavigation({ pending: false, error: result.ok ? null : "未能定位，请重试。" });
              if (result.ok) setShowMobileIndex(false);
            }}
          />
        </MobileSheet>
      ) : null}
      {showMobileToc ? (
        <MobileSheet title="章节目录" navigation={mobileNavigation} onClose={() => setShowMobileToc(false)}>
          <ConversationToc
            conversationId={payload.conversation.id}
            activeMessageId={navigationTargetMessageId ?? activeMessageId}
            activeBlockId={activeBlockId}
            observerKey={tocObserverKey}
            items={toc}
            mode="sheet"
            onNavigate={async (item) => {
              setMobileNavigation({ pending: true, error: null });
              const result = await navigateToTarget(item.message_id, item.block_index);
              setMobileNavigation({ pending: false, error: result.ok ? null : "未能定位，请重试。" });
              if (result.ok) setShowMobileToc(false);
            }}
          />
        </MobileSheet>
      ) : null}
    </main>
  );

  async function loadPreviousPage() {
    if (loadingPreviousRef.current || minOffsetRef.current <= 0) return;
    loadingPreviousRef.current = true;
    const beforeHeight = document.documentElement.scrollHeight;
    try {
      const offset = Math.max(0, minOffsetRef.current - PAGE_SIZE);
      const page = await getSharedMessageWindow(token, { offset, limit: minOffsetRef.current - offset });
      mergeWindow(page);
      window.requestAnimationFrame(() => {
        window.scrollBy({ top: document.documentElement.scrollHeight - beforeHeight, behavior: "auto" });
      });
    } finally {
      loadingPreviousRef.current = false;
    }
  }

  async function loadNextPage() {
    if (loadingNextRef.current || maxOffsetRef.current >= totalRef.current) return;
    loadingNextRef.current = true;
    try {
      mergeWindow(await getSharedMessageWindow(token, { offset: maxOffsetRef.current, limit: PAGE_SIZE }));
    } finally {
      loadingNextRef.current = false;
    }
  }
}

function MobileSheet({
  title,
  navigation,
  onClose,
  children,
}: {
  title: string;
  navigation: { pending: boolean; error: string | null };
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[76vh] overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#111827]">{title}</h2>
            {navigation.pending ? <p className="text-xs text-[#10a37f]">定位中…</p> : null}
            {navigation.error ? <p className="text-xs text-[#b91c1c]">{navigation.error}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg px-3 text-sm text-[#6b7280] hover:bg-[#f7f7f8]">关闭</button>
        </div>
        {children}
      </div>
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
