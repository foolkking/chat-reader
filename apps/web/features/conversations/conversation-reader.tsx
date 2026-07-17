"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getConversation,
  getConversationMessageWindow,
  getMessageBlocks,
  mergeMessages,
  splitConversation,
} from "../../lib/api";
import type { MessageListItem, NavigateTarget, NavigationResult, RenderBlockRead, TocItem } from "../../lib/types";
import { ExportButton } from "../exporting/export-button";
import { ExportPanel } from "../exporting/export-panel";
import { ProjectSidebar } from "../projects/project-sidebar";
import { PinButton } from "../reading/pin-button";
import { ReadingPositionClient } from "../reading/reading-position-client";
import { ShareButton } from "../sharing/share-button";
import { SharePanel } from "../sharing/share-panel";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";
import { MessageItem } from "./message-item";
import { navigateMountedTarget } from "./reader-navigation";

const PAGE_SIZE = 30;

export function ConversationReader({ conversationId }: { conversationId: string }) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const targetMessageId = searchParams.get("messageId");
  const [offset, setOffset] = useState(0);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showShare, setShowShare] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
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
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const nextOffsetRef = useRef(0);
  const navigationTokenRef = useRef(0);
  const navigationLockUntilRef = useRef(0);

  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation(conversationId),
  });

  const windowQuery = useQuery({
    queryKey: ["message-window", conversationId, offset],
    queryFn: () =>
      getConversationMessageWindow(conversationId, {
        includeBlocks: false,
        limit: PAGE_SIZE,
        offset,
        contentMode: "preview",
      }),
  });

  const hasMore = Boolean(windowQuery.data?.has_more);
  const total = windowQuery.data?.total ?? messages.length;

  useEffect(() => {
    setOffset(0);
    nextOffsetRef.current = 0;
    setMessages([]);
    setSelectedMessageIds(new Set());
    setPendingTargetMessageId(targetMessageId);
    setExpandedHeavyMessageIds(new Set());
    setBlockCache({});
    setExpandAllHeavyBlocks(false);
    setExpandProgress({ current: 0, total: 0, active: false });
    setInitialPaintReady(false);
  }, [conversationId, targetMessageId]);

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

  const navigateToTarget = useCallback(
    async ({ messageId, blockIndex }: NavigateTarget): Promise<NavigationResult> => {
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
          const cachedBlocks = blockCache[messageId] ?? [];
          const contextStart = Math.max(0, blockIndex - 20);
          const contextEnd = Math.min(Math.max((knownMessage?.block_count ?? 1) - 1, 0), blockIndex + 20);
          const cachedBounds = getBlockBounds(cachedBlocks);
          const needsTargetWindow =
            !cachedBlocks.some((block) => block.block_index === blockIndex) ||
            cachedBounds === null ||
            cachedBounds.min > contextStart ||
            cachedBounds.max < contextEnd;
          if (knownMessage && !messageHasInlineBlocks(knownMessage) && needsTargetWindow) {
            const blocks = await getMessageBlocks(messageId, { start: contextStart, limit: 200 });
            if (navigationTokenRef.current !== token) {
              return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
            }
            setBlockCache((current) => ({
              ...current,
              [messageId]: mergeBlockWindows(current[messageId], blocks),
            }));
          }
          setExpandedHeavyMessageIds((current) => new Set(current).add(messageId));
        }

        const result = await navigateMountedTarget({
          root: scrollContainerRef.current,
          targetId: blockId ?? messageIdDom,
          fallbackId: undefined,
          tokenIsCurrent: () => navigationTokenRef.current === token,
          offset: 12,
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

  useEffect(() => {
    const messageId = pendingTargetMessageId ?? targetMessageId;
    if (!messageId) {
      return;
    }
    void navigateToTarget({ messageId, source: "search" }).finally(() => setPendingTargetMessageId(null));
  }, [navigateToTarget, pendingTargetMessageId, targetMessageId]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasMore) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !windowQuery.isFetching) {
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
    if (blockCache[message.id]) {
      return blockCache[message.id];
    }
    const inlineBlocks = message.render_blocks?.length
      ? message.render_blocks
      : message.current_version?.blocks;
    if (inlineBlocks && inlineBlocks.length > 0) {
      return [];
    }
    const blocks = await getMessageBlocks(message.id, { start: 0, limit: 200 });
    setBlockCache((current) => ({
      ...current,
      [message.id]: mergeBlockWindows(current[message.id], blocks),
    }));
    return blocks;
  }

  async function loadAdjacentMessageBlocks(
    message: MessageListItem,
    direction: "previous" | "next",
  ): Promise<void> {
    const cached = blockCache[message.id] ?? [];
    const bounds = getBlockBounds(cached);
    if (!bounds) {
      await ensureMessageBlocks(message);
      return;
    }
    const start = direction === "previous" ? Math.max(0, bounds.min - 200) : bounds.max + 1;
    const limit = direction === "previous" ? bounds.min - start : 200;
    if (limit <= 0 || start >= message.block_count) {
      return;
    }
    const blocks = await getMessageBlocks(message.id, { start, limit });
    setBlockCache((current) => ({
      ...current,
      [message.id]: mergeBlockWindows(current[message.id], blocks),
    }));
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
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-[#e5e5e5] bg-white/95 backdrop-blur">
          {loadingProgress < 100 ? (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#e5e7eb]">
              <div className="h-full bg-[#10a37f] transition-[width] duration-300" style={{ width: `${loadingProgress}%` }} />
            </div>
          ) : null}
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 pl-16 md:px-6 md:pl-6">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-[#111827]">
                {conversation.display_title || conversation.title}
              </h1>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-[#6b7280]">
                <span>{loadedLabel}</span>
              </div>
            </div>
            <button
              type="button"
              aria-label="对话操作"
              onClick={() => setShowMobileActions((current) => !current)}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-xl text-[#4b5563] hover:bg-[#ececeb] md:inline-flex"
            >
              ⋯
            </button>
            <div className="flex shrink-0 gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setShowMobileIndex(true)}
                className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151]"
              >
                索引
              </button>
              <button
                type="button"
                onClick={() => setShowMobileToc(true)}
                className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151]"
              >
                目录
              </button>
              <button
                type="button"
                onClick={() => setShowMobileActions((current) => !current)}
                className="min-h-10 rounded-lg bg-[#111827] px-3 text-sm font-medium text-white"
              >
                更多
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

        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="grid min-h-full grid-cols-1 gap-5 px-3 py-6 sm:px-4 sm:py-8 md:px-6 xl:grid-cols-[48px_minmax(0,1fr)_256px]">
            <div className="relative z-[120] hidden xl:block">
              <div className="sticky top-20">
                <ConversationIndex
                  conversationId={conversationId}
                  activeMessageId={activeMessageId}
                  onNavigate={(item) => {
                    void navigateToTarget({ messageId: item.messageId, source: "dialogue-index" });
                  }}
                />
              </div>
            </div>
            <div className="mx-auto w-full max-w-[820px] min-w-0">
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
                  <ReadingPositionClient conversationId={conversationId} messages={messages} />
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
            </div>
            <div className="hidden xl:block">
              <div className="sticky top-20">
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
              </div>
            </div>
          </div>
        </div>
      </section>
      {showMobileIndex ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close dialogue index"
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowMobileIndex(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[76vh] overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#111827]">对话索引</h2>
                {mobileNavigation.pending ? <p className="text-xs text-[#10a37f]">定位中…</p> : null}
                {mobileNavigation.error ? <p className="text-xs text-[#b91c1c]">{mobileNavigation.error}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setShowMobileIndex(false)}
                className="min-h-10 rounded-lg px-3 text-sm text-[#6b7280] hover:bg-[#f7f7f8]"
              >
                关闭
              </button>
            </div>
            <ConversationIndex
              conversationId={conversationId}
              activeMessageId={activeMessageId}
              mode="sheet"
              onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget({ messageId: item.messageId, source: "dialogue-index" });
                setMobileNavigation({ pending: false, error: result.ok ? null : "未能定位，请重试。" });
                if (result.ok) setShowMobileIndex(false);
              }}
            />
          </div>
        </div>
      ) : null}
      {showMobileToc ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close contents"
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowMobileToc(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#111827]">章节目录</h2>
                {mobileNavigation.pending ? <p className="text-xs text-[#10a37f]">定位中…</p> : null}
                {mobileNavigation.error ? <p className="text-xs text-[#b91c1c]">{mobileNavigation.error}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setShowMobileToc(false)}
                className="min-h-10 rounded-lg px-3 text-sm text-[#6b7280] hover:bg-[#f7f7f8]"
              >
                关闭
              </button>
            </div>
            <ConversationToc
              conversationId={conversationId}
              activeMessageId={activeMessageId}
              activeItems={activeTocItems}
              activeBlockId={activeBlockId}
              observerKey={tocObserverKey}
              mode="sheet"
              onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget({
                  messageId: item.message_id,
                  blockIndex: item.block_index,
                  source: "section-toc",
                });
                setMobileNavigation({ pending: false, error: result.ok ? null : "未能定位，请重试。" });
                if (result.ok) setShowMobileToc(false);
              }}
            />
          </div>
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
