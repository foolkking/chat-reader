import Link from "next/link";
import type { SearchResultItem } from "../../lib/types";

export function SearchResults({ items }: { items: SearchResultItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
        No results.
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
      {items.map((item) => (
        <Link
          key={item.document_id}
          href={`/conversations/${item.conversation_id}${item.message_id ? `?messageId=${item.message_id}` : ""}`}
          className="block px-4 py-4 hover:bg-slate-50"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-950">
                {item.conversation_title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-700">{item.snippet}</p>
            </div>
            <div className="shrink-0 text-left text-xs text-slate-500 sm:text-right">
              <p>{item.document_type}</p>
              {item.role ? <p className="mt-1">{item.role}</p> : null}
              {item.order_key ? <p className="mt-1 font-mono">{item.order_key}</p> : null}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
