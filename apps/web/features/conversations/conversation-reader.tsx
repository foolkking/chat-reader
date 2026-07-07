"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getConversation, getConversationMessages } from "../../lib/api";
import { MessageItem } from "./message-item";

export function ConversationReader({ conversationId }: { conversationId: string }) {
  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation(conversationId),
  });

  const messagesQuery = useQuery({
    queryKey: ["conversation-messages", conversationId, { includeBlocks: true }],
    queryFn: () => getConversationMessages(conversationId, { includeBlocks: true, limit: 200 }),
  });

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

  const conversation = conversationQuery.data;
  if (!conversation) {
    return <ReaderState title="Conversation unavailable" detail="The API returned no conversation payload." action={<BackLink />} />;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
          <BackLink />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-normal text-slate-500">Reader</p>
              <h1 className="mt-1 truncate text-2xl font-semibold text-slate-950">
                {conversation.display_title || conversation.title}
              </h1>
            </div>
            <div className="text-sm text-slate-600">
              <span>{conversation.message_count} messages</span>
              <span className="mx-2 text-slate-300">/</span>
              <span>{conversation.source_profile}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {messagesQuery.isLoading ? (
          <ReaderState title="Loading messages" detail="Fetching current versions and render blocks." />
        ) : null}

        {messagesQuery.isError ? (
          <ReaderState
            title="Messages unavailable"
            detail={messagesQuery.error.message}
            action={
              <button
                type="button"
                onClick={() => void messagesQuery.refetch()}
                className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white"
              >
                Retry
              </button>
            }
          />
        ) : null}

        {messagesQuery.isSuccess && messagesQuery.data.length === 0 ? (
          <ReaderState title="No messages" detail="This conversation has no persisted canonical messages." />
        ) : null}

        {messagesQuery.isSuccess && messagesQuery.data.length > 0 ? (
          <div className="space-y-5">
            {messagesQuery.data.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </div>
        ) : null}
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
