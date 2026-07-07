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

const PAGE_SIZE = 50;

export function ConversationReader({ conversationId }: { conversationId: string }) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const targetMessageId = searchParams.get("messageId");
  const [offset, setOffset] = useState(0);
  const [messages, setMessages] = useState<MessageListItem[]>([]);

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
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
          <BackLink />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-normal text-slate-500">Reader</p>
              <h1 className="mt-1 truncate text-2xl font-semibold text-slate-950">
                {conversation.display_title || conversation.title}
              </h1>
            </div>
            <div className="text-sm text-slate-600">
              <span>{loadedLabel}</span>
              <span className="mx-2 text-slate-300">/</span>
              <span>{conversation.source_profile}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <AddToProjectControl conversationId={conversation.id} />
            <PinButton scope="global" conversationId={conversation.id} isPinned={conversation.is_global_pinned} />
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
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
            <div className="space-y-5">
              <ReadingPositionClient conversationId={conversationId} messages={messages} />
              {messages.map((message) => (
                <MessageItem key={message.id} message={message} onChanged={refreshReader} />
              ))}
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => setOffset(messages.length)}
                  className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  {windowQuery.isFetching ? "Loading" : "Load more"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <ConversationToc conversationId={conversationId} />
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
