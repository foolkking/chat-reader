import type { SearchResultItem } from "../../lib/types";

// Ephemeral React Query state, never localStorage or history containing body text.
// References point at already loaded pages; the query cache's GC and logout clear
// apply to this entry too.
export type SearchDisclosure = { open: boolean; offset: number };
export type SearchReturnState = {
  pages: Record<number, SearchResultItem[]>;
  offset: number;
  documentId: string | null;
  selectedIds: string[];
  disclosures: Record<string, SearchDisclosure>;
  scrollTop: number;
};
