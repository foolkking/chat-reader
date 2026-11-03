import type { DialogueIndexResponse } from "../../lib/types";

export type ReaderMessageShortcut = "home" | "end" | "j" | "k";

/** Resolve identities through the canonical index, not the bounded DOM window. */
export async function resolveKeyboardMessage(
  key: ReaderMessageShortcut,
  currentMessageId: string | null,
  loadIndex: (options: { offset?: number; limit: number; anchorMessageId?: string }) => Promise<DialogueIndexResponse>,
  cachedPages: DialogueIndexResponse[] = [],
): Promise<string | null> {
  if (key === "home" || key === "end" || !currentMessageId) {
    const cached = cachedPages.find(page => key === "end"
      ? page.offset + page.items.length === page.total && page.items.length > 0
      : page.offset === 0 && page.items.length > 0);
    if (cached) return key === "end" ? cached.items.at(-1)?.message_id ?? null : cached.items[0]?.message_id ?? null;
    const first = await loadIndex({ offset: 0, limit: 1 });
    if (key !== "end" || first.total <= 1) return first.items[0]?.message_id ?? null;
    const last = await loadIndex({ offset: first.total - 1, limit: 1 });
    if (!last.items.length && last.total > 0 && last.total !== first.total) {
      const refreshed = await loadIndex({ offset: last.total - 1, limit: 1 });
      return refreshed.items[0]?.message_id ?? null;
    }
    return last.items[0]?.message_id ?? null;
  }
  for (const page of cachedPages) {
    const index = page.items.findIndex(item => item.message_id === currentMessageId);
    if (index < 0) continue;
    const direction = key === "j" ? 1 : -1;
    const neighbor = page.items[index + direction];
    if (neighbor) return neighbor.message_id;
    if (page.offset + index + direction < 0 || page.offset + index + direction >= page.total) return null;
  }
  const page = await loadIndex({ anchorMessageId: currentMessageId, limit: 3 });
  const index = page.items.findIndex(item => item.message_id === currentMessageId);
  if (index < 0) throw new Error("Reader shortcut anchor is unavailable.");
  const direction = key === "j" ? 1 : -1;
  const neighbor = page.items[index + direction];
  if (neighbor) return neighbor.message_id;
  const offset = page.offset + index + direction;
  if (offset < 0 || offset >= page.total) return null;
  const adjacent = await loadIndex({ offset, limit: 1 });
  return adjacent.items[0]?.message_id ?? null;
}
