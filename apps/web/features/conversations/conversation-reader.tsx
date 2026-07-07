"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getConversation, getConversationMessageWindow } from "../../lib/api";
import type { MessageListItem } from "../../lib/types";
import { AddToProjectControl } from "../projects/add-to-project-control";
import { PinButton } from "../reading/pin-button";
import { ReadingPositionClient } from "../reading/reading-position-client";
import { ConversationToc } from "../toc/conversation-toc";
import { MessageItem } from "./message-item";
import { ShareButton } from "../sharing/share-button";
import { SharePanel } from "../sharing/share-panel";
import { ExportButton } from "../exporting/export-button";
import { ExportPanel } from "../exporting/export-panel";
import { ProjectSidebar } from "../projects/project-sidebar";

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

  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation(conversationId),
  });

  const windowQuery = useQuery({
    queryKey: ["message-window", conversationId, offset],
    queryFn: () =>
      getConversationMessageWindow(conversationId, {
        includeBlocks: true,
        limit: PAGE_SIZE,
        offset,
      }),
  });

  useEffect(() => {
    setOffset(0);
    setMessages([]);
    setSelectedMessageIds(new Set());
  }, [conversationId]);

  useEffect(() => {
    if (!windowQuery.isSuccess) {
      return;
    }
    setMessages((current) => {
      const next = offset === 0 ? [] : [...current];
      for (const message of windowQuery.data.items) {
        if (!next.some((item) => item.id === message.id)) {
          next.push(message);
        }
      }
      return next;
    });
  }, [offset, windowQuery.data, windowQuery.isSuccess]);

  useEffect(() => {
    if (!targetMessageId || messages.length === 0) {
      return;
    }
    const target = document.getElementById(`message-${targetMessageId}`);
    if (target) {
      target.scrollIntoView({ block: "start" });
    } else if (windowQuery.data?.has_more && offset < 1000 && !windowQuery.isFetching) {
      setOffset((current) => current + PAGE_SIZE);
    }
  }, [messages.length, offset, targetMessageId, windowQuery.data?.has_more, windowQuery.isFetching]);

  const hasMore = Boolean(windowQuery.data?.has_more);
  const total = windowQuery.data?.total ?? messages.length;
  const conversation = conversationQuery.data;
  const loadedLabel = useMemo(() => `${messages.length} / ${total} loaded`, [messages.length, total]);
  const selectedIds = useMemo(() => Array.from(selectedMessageIds), [selectedMessageIds]);

  async function refreshReader() {
    setMessages([]);
    setOffset(0);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["message-window", conversationId] }),
      queryClient.invalidateQueries({ queryKey: ["toc", conversationId] }),
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] }),
    ]);
  }

  if (conversationQuery.isLoading) {
    return <ReaderState title="Loading conversation" detail="Fetching conversation metadata." />;
  }

  if (conversationQuery.isError) {
    return (
      <ReaderState
        title="Conversation unavailable"
        detail={conversationQuery.error.message}
        action={<BackLink />}
      />
    );
  }

  if (!conversation) {
    return (
      <ReaderState
        title="Conversation unavailable"
        detail="The API returned no conversation payload."
        action={<BackLink />}
      />
    );
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-[#e5e5e5] bg-white/95 backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-3 px-4 pl-16 md:px-6 md:pl-6">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-[#111827]">
                {conversation.display_title || conversation.title}
              </h1>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-[#6b7280]">
                <span>{loadedLabel}</span>
                <span className="rounded-full bg-[#f7f7f8] px-2 py-0.5">{conversation.source_profile}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <PinButton scope="global" conversationId={conversation.id} isPinned={conversation.is_global_pinned} />
              <ShareButton isOpen={showShare} onToggle={() => setShowShare((current) => !current)} />
              <ExportButton isOpen={showExport} onToggle={() => setShowExport((current) => !current)} />
            </div>
          </div>
          {(showShare || showExport) ? (
            <div className="border-t border-[#f0f0f0] px-6 py-4">
              <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
                {showShare ? <SharePanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
                {showExport ? <ExportPanel conversationId={conversation.id} selectedMessageIds={selectedIds} /> : null}
              </div>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="grid min-h-full grid-cols-1 gap-6 px-4 py-8 md:px-6 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="mx-auto w-full max-w-[820px] min-w-0">
              <div className="mb-4 flex items-center justify-between rounded-2xl border border-[#e5e5e5] bg-white px-4 py-3 shadow-sm">
                <AddToProjectControl conversationId={conversation.id} />
                <BackLink />
              </div>
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
                />
              ))}
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => setOffset(messages.length)}
                  className="mx-auto block rounded-full border border-[#d1d5db] bg-white px-5 py-2 text-sm font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8]"
                >
                  {windowQuery.isFetching ? "Loading" : "Load more"}
                </button>
              ) : null}
            </div>
          ) : null}
            </div>
            <div className="hidden xl:block">
              <div className="sticky top-20">
                <ConversationToc conversationId={conversationId} />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
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

function BackLink() {
  return (
    <Link href="/" className="text-sm font-medium text-slate-600 underline underline-offset-4">
      Back to conversations
    </Link>
  );
}
