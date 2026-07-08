"use client";

import { useQuery } from "@tanstack/react-query";
import { getConversationToc } from "../../lib/api";

export function ConversationToc({
  conversationId,
  onNavigate,
}: {
  conversationId: string;
  onNavigate?: () => void;
}) {
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
    <aside className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">TOC</h2>
      <nav className="mt-3 space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              scrollToTocTarget(item.message_id, item.block_index);
              onNavigate?.();
            }}
            className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-[#374151] hover:bg-[#f7f7f8]"
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
    <aside className="rounded-2xl border border-[#e5e5e5] bg-white p-4 text-sm text-[#6b7280] shadow-sm">
      {label}
    </aside>
  );
}

function scrollToTocTarget(messageId: string, blockIndex: number) {
  const block = document.getElementById(`block-${messageId}-${blockIndex}`);
  const message = document.getElementById(`message-${messageId}`);
  (block ?? message)?.scrollIntoView({ block: "start", behavior: "smooth" });
}
