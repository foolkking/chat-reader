"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getConversations } from "../../lib/api";
import { AddToProjectControl } from "../projects/add-to-project-control";
import { PinButton } from "../reading/pin-button";

export function ConversationList() {
  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: getConversations,
  });

  if (conversationsQuery.isLoading) {
    return <StateBlock title="Loading conversations" detail="Fetching canonical conversation list." />;
  }

  if (conversationsQuery.isError) {
    return (
      <StateBlock
        title="Conversation API unavailable"
        detail={conversationsQuery.error.message}
        action={
          <button
            type="button"
            onClick={() => void conversationsQuery.refetch()}
            className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white"
          >
            Retry
          </button>
        }
      />
    );
  }

  const conversations = conversationsQuery.data ?? [];
  if (conversations.length === 0) {
    return <StateBlock title="No conversations yet" detail="Preview and commit an import to start reading." />;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-950">Conversations</h2>
        <span className="text-sm text-slate-500">{conversations.length} shown</span>
      </div>
      <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {conversations.map((conversation) => (
          <article
            key={conversation.id}
            className="flex flex-col gap-3 px-4 py-4 transition hover:bg-slate-50"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Link href={`/conversations/${conversation.id}`}>
                  <h3 className="truncate text-base font-semibold text-slate-950">
                    {conversation.is_global_pinned ? "Pinned / " : ""}
                    {conversation.display_title || conversation.title}
                  </h3>
                </Link>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                  {conversation.first_user_message ?? "No first user message."}
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="text-xs font-medium text-slate-500">{conversation.source_profile}</p>
                <p className="mt-1 text-sm text-slate-700">{conversation.message_count} messages</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <AddToProjectControl conversationId={conversation.id} />
              <PinButton scope="global" conversationId={conversation.id} isPinned={conversation.is_global_pinned} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StateBlock({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
