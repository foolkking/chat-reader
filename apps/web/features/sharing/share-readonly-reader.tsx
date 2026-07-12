"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSharedConversation } from "../../lib/api";
import type { NavigationResult } from "../../lib/types";
import { MessageItem } from "../conversations/message-item";
import { navigateMountedTarget } from "../conversations/reader-navigation";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";

export function ShareReadonlyReader({ token }: { token: string }) {
  const [showMobileIndex, setShowMobileIndex] = useState(false);
  const [showMobileToc, setShowMobileToc] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [navigationTargetMessageId, setNavigationTargetMessageId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [targetHighlightId, setTargetHighlightId] = useState<string | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [mobileNavigation, setMobileNavigation] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  const navigationTokenRef = useRef(0);
  const navigationLockUntilRef = useRef(0);
  const shareQuery = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: () => getSharedConversation(token),
  });
  const payload = shareQuery.data;
  const messages = payload?.messages ?? [];
  const toc = payload?.toc ?? [];

  const navigateToTarget = useCallback(async (messageId: string, blockIndex?: number): Promise<NavigationResult> => {
    const token = navigationTokenRef.current + 1;
    navigationTokenRef.current = token;
    navigationLockUntilRef.current = Date.now() + 5000;
    setNavigationTargetMessageId(messageId);
    const messageDomId = `message-${messageId}`;
    const blockDomId = blockIndex === undefined ? null : `block-${messageId}-${blockIndex}`;
    if (blockIndex !== undefined) {
      setExpandedMessageIds((current) => new Set(current).add(messageId));
    }
    const result = await navigateMountedTarget({
      root: null,
      targetId: blockDomId ?? messageDomId,
      fallbackId: undefined,
      tokenIsCurrent: () => navigationTokenRef.current === token,
      offset: 80,
    });
    if (result.ok) {
      setActiveMessageId(messageId);
      setActiveBlockId(blockDomId);
      setTargetHighlightId(result.targetId);
      window.setTimeout(() => {
        if (navigationTokenRef.current === token) {
          setTargetHighlightId(null);
          setActiveBlockId(null);
        }
      }, 2000);
    }
    return result;
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      setActiveMessageId(null);
      return undefined;
    }
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
          setNavigationTargetMessageId(null);
          setActiveMessageId(first.dataset.messageId ?? null);
        }
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: [0, 0.25, 0.75] },
    );
    for (const message of messages) {
      const target = document.getElementById(`message-${message.id}`);
      if (target) {
        observer.observe(target);
      }
    }
    return () => observer.disconnect();
  }, [messages]);

  if (shareQuery.isLoading) {
    return <ShareState title="Loading share" detail="Fetching read-only conversation." />;
  }

  if (shareQuery.isError) {
    return <ShareState title="Share unavailable" detail={shareQuery.error.message} />;
  }

  if (!payload) {
    return <ShareState title="Share unavailable" detail="The API returned no shared conversation." />;
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f7f8] text-[#111827]">
      <header className="sticky top-0 z-10 border-b border-[#e5e5e5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl flex-col justify-center px-4 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-normal text-[#6b7280]">Read-only share</p>
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-lg font-semibold text-[#111827]">
              {payload.share.title || payload.conversation.display_title || payload.conversation.title}
            </h1>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setShowMobileIndex(true)}
                className="min-h-10 shrink-0 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] xl:hidden"
              >
                索引
              </button>
              {toc.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowMobileToc(true)}
                  className="min-h-10 shrink-0 rounded-lg border border-[#d1d5db] bg-white px-3 text-sm font-medium text-[#374151] xl:hidden"
                >
                  目录
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <section className="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-6 px-3 py-5 sm:px-6 sm:py-6 xl:grid-cols-[300px_minmax(0,820px)_260px] xl:items-start xl:justify-center">
        <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto xl:block">
          <div className="rounded-2xl border border-[#e5e7eb] bg-white p-3 shadow-sm">
            <ConversationIndex
              conversationId={payload.conversation.id}
              messages={messages}
              activeMessageId={navigationTargetMessageId ?? activeMessageId}
              mode="sheet"
              onNavigate={async (item) => {
                await navigateToTarget(item.messageId);
              }}
            />
          </div>
        </aside>
        <div className="mx-auto w-full max-w-[820px] space-y-5">
          {payload.share.description ? (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 text-sm leading-6 text-[#374151] shadow-sm">
              {payload.share.description}
            </div>
          ) : null}
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              readOnly
              highlightTargetId={targetHighlightId}
              expandHeavyBlocks={expandedMessageIds.has(message.id)}
            />
          ))}
          <div aria-hidden="true" className="h-[calc(100vh-6rem)] min-h-72" />
        </div>
        <div className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto xl:block">
          <ConversationToc
            conversationId={payload.conversation.id}
            activeMessageId={navigationTargetMessageId ?? activeMessageId}
            activeBlockId={activeBlockId}
            items={toc}
            onNavigate={async (item) => {
              await navigateToTarget(item.message_id, item.block_index);
            }}
          />
        </div>
      </section>
      {showMobileIndex ? (
        <div className="fixed inset-0 z-50 xl:hidden">
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
              conversationId={payload.conversation.id}
              messages={messages}
              activeMessageId={navigationTargetMessageId ?? activeMessageId}
              mode="sheet"
              onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget(item.messageId);
                setMobileNavigation({ pending: false, error: result.ok ? null : "未能定位，请重试。" });
                if (result.ok) setShowMobileIndex(false);
              }}
            />
          </div>
        </div>
      ) : null}
      {showMobileToc ? (
        <div className="fixed inset-0 z-50 xl:hidden">
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
              conversationId={payload.conversation.id}
              activeMessageId={navigationTargetMessageId ?? activeMessageId}
              activeBlockId={activeBlockId}
              items={toc}
              mode="sheet"
              onNavigate={async (item) => {
                setMobileNavigation({ pending: true, error: null });
                const result = await navigateToTarget(item.message_id, item.block_index);
                setMobileNavigation({ pending: false, error: result.ok ? null : "未能定位，请重试。" });
                if (result.ok) setShowMobileToc(false);
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ShareState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen bg-[#f7f7f8] px-4 py-10 text-[#111827]">
      <div className="mx-auto max-w-xl rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#6b7280]">{detail}</p>
      </div>
    </main>
  );
}
