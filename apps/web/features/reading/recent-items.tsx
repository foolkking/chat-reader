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
      {!compact ? <h1 className="text-2xl font-semibold text-slate-950">Recent</h1> : null}
      <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/conversations/${item.conversation_id}`}
            className="block px-4 py-3 hover:bg-slate-50"
          >
            <p className="truncate text-sm font-semibold text-slate-950">
              {item.conversation.display_title || item.conversation.title}
            </p>
            <p className="mt-1 text-xs text-slate-500">
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
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
      {label}
    </div>
  );
}
