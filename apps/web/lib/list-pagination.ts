export type ListPage<T> = {
  items: T[];
  offset: number;
  hasMore: boolean;
};

export function flattenPages<T extends { id: string }>(pages: ListPage<T>[] | undefined): T[] {
  return [...new Map((pages?.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values()];
}
