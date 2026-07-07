"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getConversations } from "../../lib/api";
import { AddToProjectControl } from "../projects/add-to-project-control";
import { PinButton } from "../reading/pin-button";

export function ConversationList({ onImportClick }: { onImportClick?: () => void }) {
  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: getConversations,
  });

  if (conversationsQuery.isLoading) {
    return <StateBlock title="Loading conversations" detail="Fetching canonical conversation list." loading />;
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
    return (
      <StateBlock
        title="No conversations yet"
        detail="Import a ChatGPT export to start building your local reading archive."
        action={
          <button
            type="button"
            onClick={onImportClick}
            className="rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white hover:bg-black"
          >
            Import conversations
          </button>
        }
      />
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-[#111827]">Conversation history</h2>
        <span className="text-sm text-[#6b7280]">{conversations.length} shown</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
        {conversations.map((conversation) => (
          <article
            key={conversation.id}
            className="group flex flex-col gap-3 border-b border-[#f0f0f0] px-5 py-4 transition last:border-b-0 hover:bg-[#f7f7f8]"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Link href={`/conversations/${conversation.id}`}>
                  <h3 className="truncate text-base font-semibold text-slate-950">
                    {conversation.is_global_pinned ? "Pinned / " : ""}
                    {conversation.display_title || conversation.title}
                  </h3>
                </Link>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#4b5563]">
                  {conversation.first_user_message ?? "No first user message."}
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="inline-flex rounded-full bg-[#f7f7f8] px-2 py-1 text-xs font-medium text-[#4b5563]">
                  {conversation.source_profile}
                </p>
                <p className="mt-1 text-sm text-[#6b7280]">{conversation.message_count} messages</p>
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
  loading = false,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <section className="flex min-h-64 items-center justify-center rounded-2xl border border-[#e5e5e5] bg-white p-8 text-center shadow-sm">
      <div>
        {loading ? <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-[#ececec]" /> : null}
        <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#6b7280]">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </section>
  );
}
