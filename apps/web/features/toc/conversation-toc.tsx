"use client";

import { useQuery } from "@tanstack/react-query";
import { getConversationToc } from "../../lib/api";

export function ConversationToc({ conversationId }: { conversationId: string }) {
  const tocQuery = useQuery({
    queryKey: ["toc", conversationId],
    queryFn: () => getConversationToc(conversationId),
  });

  if (tocQuery.isLoading) {
    return <TocShell label="Loading TOC" />;
  }
  if (tocQuery.isError) {
    return <TocShell label={tocQuery.error.message} />;
  }

  const items = tocQuery.data?.items ?? [];
  if (items.length === 0) {
    return <TocShell label="No headings" />;
  }

  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Contents</h2>
      <nav className="mt-3 space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => scrollToTocTarget(item.message_id, item.block_index)}
            className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
            style={{ paddingLeft: `${Math.max(0, item.level - 1) * 10 + 8}px` }}
          >
            {item.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function TocShell({ label }: { label: string }) {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
      {label}
    </aside>
  );
}

function scrollToTocTarget(messageId: string, blockIndex: number) {
  const block = document.getElementById(`block-${messageId}-${blockIndex}`);
  const message = document.getElementById(`message-${messageId}`);
  (block ?? message)?.scrollIntoView({ block: "start", behavior: "smooth" });
}
