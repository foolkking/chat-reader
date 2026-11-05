import type { SearchResultItem } from "../../lib/types";

/** Keep server offsets separate from the number of distinct visible documents. */
export function collectSearchPages(pages: Record<number, SearchResultItem[]>): SearchResultItem[] {
  const documents = new Map<string, SearchResultItem>();
  for (const offset of Object.keys(pages).map(Number).sort((a, b) => a - b)) {
    for (const item of pages[offset]) documents.set(item.document_id, item);
  }
  return [...documents.values()];
}
