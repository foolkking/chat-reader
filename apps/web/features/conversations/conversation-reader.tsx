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

const PAGE_SIZE = 50;

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
  }, [conversationId, targetMessageId]);

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
            })).items.find((message) => message.id === messageId);
          if (knownMessage && !messageHasInlineBlocks(knownMessage) && !blockCache[messageId]) {
            const start = Math.max(0, blockIndex - 20);
            const blocks = await getMessageBlocks(messageId, { start, limit: 200 });
            if (navigationTokenRef.current !== token) {
              return { ok: false, targetId: blockId ?? messageIdDom, reason: "cancelled" };
            }
            setBlockCache((current) => ({ ...current, [messageId]: blocks }));
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
  const loadedLabel = useMemo(() => `${messages.length} / ${total} loaded`, [messages.length, total]);
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
    setBlockCache((current) => ({ ...current, [message.id]: blocks }));
    return blocks;
  }

  if (conversationQuery.isLoading) {
    return <ReaderState title="Loading conversation" detail="Fetching conversation metadata." />;
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
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 pl-16 md:px-6 md:pl-6">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-[#111827]">
                {conversation.display_title || conversation.title}
              </h1>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-[#6b7280]">
                <span>{loadedLabel}</span>
                <span className="hidden max-w-[220px] truncate rounded-full bg-[#f7f7f8] px-2 py-0.5 sm:inline-flex">
                  {conversation.source_profile}
                </span>
              </div>
            </div>
            <div className="hidden items-center gap-1 rounded-2xl bg-[#f7f7f8] p-1 md:flex">
              <button
                type="button"
                onClick={() => void expandLoadedHeavyMessages()}
                disabled={expandProgress.active}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#d1d5db] bg-white px-3 text-xs font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-70"
              >
                {expandProgress.active ? <Spinner /> : null}
                {expandProgress.active
                  ? `${expandProgress.current} / ${expandProgress.total}`
                  : "Blocks"}
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
                  className="inline-flex h-9 items-center rounded-xl border border-[#d1d5db] bg-white px-3 text-xs font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8]"
                >
                  合并所选
                </button>
              ) : null}
              {selectedOrderedIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void splitSelectedConversationRange()}
                  className="inline-flex h-9 items-center rounded-xl border border-[#d1d5db] bg-white px-3 text-xs font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8]"
                >
                  拆分为新会话
                </button>
              ) : null}
            </div>
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
                操作
              </button>
            </div>
          </div>
          {showMobileActions ? (
            <div className="border-t border-[#f0f0f0] px-4 py-3 md:hidden">
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
                      : "展开 blocks"}
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
                <ReaderState title="Loading messages" detail="Fetching the first message window." />
              ) : null}

              {windowQuery.isError ? (
                <ReaderState title="Messages unavailable" detail={windowQuery.error.message} />
              ) : null}

              {windowQuery.isSuccess && messages.length === 0 ? (
                <ReaderState title="No messages" detail="This conversation has no persisted canonical messages." />
              ) : null}

              {messages.length > 0 ? (
                <div className="space-y-6">
                  <ReadingPositionClient conversationId={conversationId} messages={messages} />
                  {messages.map((message) => (
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
                      cachedBlocks={blockCache[message.id]}
                      onLoadBlocks={async () => {
                        const blocks = await ensureMessageBlocks(message);
                        setExpandedHeavyMessageIds((current) => new Set(current).add(message.id));
                        return blocks;
                      }}
                    />
                  ))}
                  <div ref={loadMoreSentinelRef} className="flex min-h-12 items-center justify-center">
                    {hasMore && windowQuery.isFetching ? (
                      <span className="inline-flex items-center gap-2 text-sm text-[#6b7280]">
                        <Spinner dark />
                        正在加载更多对话
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
        <div className="pointer-events-none fixed inset-x-4 top-20 z-40 flex justify-end md:inset-x-6">
          <div
            className={`pointer-events-auto grid max-h-[calc(100vh-6rem)] w-full gap-4 overflow-y-auto rounded-3xl border border-[#e5e5e5] bg-white/95 p-4 shadow-2xl backdrop-blur ${
              showShare && showExport ? "max-w-[960px] lg:grid-cols-2" : "max-w-[520px]"
            }`}
          >
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
