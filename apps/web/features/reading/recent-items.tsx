"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getRecentItems } from "../../lib/api";

export function RecentItems({ compact = false }: { compact?: boolean }) {
  const recentQuery = useQuery({
    queryKey: ["recent-items"],
    queryFn: getRecentItems,
  });

  if (recentQuery.isLoading) {
    return <StateLine label="Loading recent items" />;
  }
  if (recentQuery.isError) {
    return <StateLine label={recentQuery.error.message} />;
  }

  const items = recentQuery.data ?? [];
  if (items.length === 0) {
    return <StateLine label="No recent conversations" />;
  }

  return (
    <section className="space-y-3">
      {!compact ? <h1 className="text-xl font-semibold text-[#111827]">Recent conversations</h1> : null}
      <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/conversations/${item.conversation_id}`}
            className="block border-b border-[#f0f0f0] px-5 py-4 last:border-b-0 hover:bg-[#f7f7f8]"
          >
            <p className="truncate text-sm font-semibold text-slate-950">
              {item.conversation.display_title || item.conversation.title}
            </p>
            <p className="mt-1 text-xs text-[#6b7280]">
              Opened {new Date(item.last_opened_at).toLocaleString()} / {item.open_count} times
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function StateLine({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 text-sm text-[#6b7280] shadow-sm">
      {label}
    </div>
  );
}
