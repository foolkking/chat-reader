"use client";

import { useQuery } from "@tanstack/react-query";
import { getSharedConversation } from "../../lib/api";
import { MessageItem } from "../conversations/message-item";

export function ShareReadonlyReader({ token }: { token: string }) {
  const shareQuery = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: () => getSharedConversation(token),
  });

  if (shareQuery.isLoading) {
    return <ShareState title="Loading share" detail="Fetching read-only conversation." />;
  }

  if (shareQuery.isError) {
    return <ShareState title="Share unavailable" detail={shareQuery.error.message} />;
  }

  const payload = shareQuery.data;
  if (!payload) {
    return <ShareState title="Share unavailable" detail="The API returned no shared conversation." />;
  }

  const toc = payload.toc ?? [];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-normal text-slate-500">Read-only share</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            {payload.share.title || payload.conversation.display_title || payload.conversation.title}
          </h1>
          {payload.share.description ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">{payload.share.description}</p>
          ) : null}
        </div>
      </header>
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-5">
          {payload.messages.map((message) => (
            <MessageItem key={message.id} message={message} readOnly />
          ))}
        </div>
        {toc.length > 0 ? (
          <aside className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Contents</h2>
            <nav className="mt-3 space-y-1">
              {toc.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    const block = document.getElementById(`block-${item.message_id}-${item.block_index}`);
                    const message = document.getElementById(`message-${item.message_id}`);
                    (block ?? message)?.scrollIntoView({ block: "start", behavior: "smooth" });
                  }}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                  style={{ paddingLeft: `${Math.max(0, item.level - 1) * 10 + 8}px` }}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          </aside>
        ) : null}
      </section>
    </main>
  );
}

function ShareState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
      </div>
    </main>
  );
}
