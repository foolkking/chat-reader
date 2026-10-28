import type { Query, QueryClient } from "@tanstack/react-query";

export const READER_SEARCH_CHANGED_EVENT = "chat-reader:search-content-changed";
export type ReaderSearchChange = { mode: "remote" | "offline"; conversationId?: string };

/** Retire both mounted searches and cached queries belonging to a closed panel. */
export function invalidateReaderSearch(queryClient: QueryClient, scope: ReaderSearchChange): void {
  const predicate = (query: Query) => {
    const [, sourceKey, conversationId] = query.queryKey;
    return typeof sourceKey === "string"
      && (sourceKey === scope.mode || sourceKey.startsWith(`${scope.mode}:`))
      && (!scope.conversationId || conversationId === scope.conversationId);
  };
  // reset cancels the old query (including a late response), clears every page
  // and refetches only active observers. A closed panel cannot reopen stale data.
  void queryClient.resetQueries({ queryKey: ["conversation-search"], predicate }).catch(() => undefined);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(READER_SEARCH_CHANGED_EVENT, { detail: scope }));
}
