import Link from "next/link";
import type { SearchResultItem } from "../../lib/types";

export function SearchResults({ items }: { items: SearchResultItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[#e5e5e5] bg-white p-6 text-sm text-[#6b7280] shadow-sm">
        No results.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
      {items.map((item) => (
        <Link
          key={item.document_id}
          href={`/conversations/${item.conversation_id}${item.message_id ? `?messageId=${item.message_id}` : ""}`}
          className="block border-b border-[#f0f0f0] px-5 py-4 last:border-b-0 hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#111827]"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-[#111827]">
                {item.conversation_title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#374151]">{item.snippet}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 text-xs text-[#6b7280] sm:justify-end">
              <span className="rounded-full border border-[#e5e5e5] bg-[#f7f7f8] px-2 py-1">
                {item.document_type}
              </span>
              {item.role ? (
                <span className="rounded-full border border-[#e5e5e5] bg-white px-2 py-1">{item.role}</span>
              ) : null}
              {item.order_key ? (
                <span className="rounded-full border border-[#e5e5e5] bg-white px-2 py-1 font-mono">
                  {item.order_key}
                </span>
              ) : null}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
