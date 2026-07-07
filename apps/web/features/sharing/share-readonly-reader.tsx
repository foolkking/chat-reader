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
    <main className="flex min-h-screen flex-col bg-[#f7f7f8] text-[#111827]">
      <header className="sticky top-0 z-10 border-b border-[#e5e5e5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl flex-col justify-center px-4 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-normal text-[#6b7280]">Read-only share</p>
          <h1 className="truncate text-lg font-semibold text-[#111827]">
            {payload.share.title || payload.conversation.display_title || payload.conversation.title}
          </h1>
        </div>
      </header>
      <section className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="mx-auto w-full max-w-[820px] space-y-5">
          {payload.share.description ? (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 text-sm leading-6 text-[#374151] shadow-sm">
              {payload.share.description}
            </div>
          ) : null}
          {payload.messages.map((message) => (
            <MessageItem key={message.id} message={message} readOnly />
          ))}
        </div>
        {toc.length > 0 ? (
          <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm xl:block">
            <h2 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Contents</h2>
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
                  className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-[#374151] hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#111827]"
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
    <main className="min-h-screen bg-[#f7f7f8] px-4 py-10 text-[#111827]">
      <div className="mx-auto max-w-xl rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#6b7280]">{detail}</p>
      </div>
    </main>
  );
}
