import type {
  LoadedMessageWindow,
  MessageWindowResponse,
  WindowGeneration,
} from "../../lib/types";

export const MAX_WINDOW_MESSAGES = 120;

export function emptyLoadedWindow(generation: WindowGeneration = 0): LoadedMessageWindow {
  return {
    items: [],
    startOffset: 0,
    endOffset: 0,
    total: 0,
    hasPrevious: false,
    hasMore: false,
    generation,
  };
}

export function replaceLoadedWindow(
  page: MessageWindowResponse,
  generation: WindowGeneration,
): LoadedMessageWindow {
  return {
    items: page.items,
    startOffset: page.offset,
    endOffset: page.offset + page.items.length,
    total: page.total,
    hasPrevious: page.has_previous,
    hasMore: page.has_more,
    generation,
  };
}

export function prependLoadedWindow(
  current: LoadedMessageWindow,
  page: MessageWindowResponse,
): LoadedMessageWindow {
  if (page.offset + page.items.length < current.startOffset) return current;
  const currentIds = new Set(current.items.map((item) => item.id));
  const prepended = page.items.filter((item) => !currentIds.has(item.id));
  const combined = [...prepended, ...current.items];
  const items = combined.slice(0, MAX_WINDOW_MESSAGES);
  const startOffset = Math.min(page.offset, current.startOffset);
  const endOffset = startOffset + items.length;
  return {
    items,
    startOffset,
    endOffset,
    total: page.total,
    hasPrevious: startOffset > 0,
    hasMore: endOffset < page.total,
    generation: current.generation,
  };
}

export function appendLoadedWindow(
  current: LoadedMessageWindow,
  page: MessageWindowResponse,
): LoadedMessageWindow {
  if (page.offset > current.endOffset) return current;
  const currentIds = new Set(current.items.map((item) => item.id));
  const appended = page.items.filter((item) => !currentIds.has(item.id));
  const combined = [...current.items, ...appended];
  const trimCount = Math.max(0, combined.length - MAX_WINDOW_MESSAGES);
  const items = combined.slice(trimCount);
  const startOffset = current.startOffset + trimCount;
  const endOffset = startOffset + items.length;
  return {
    items,
    startOffset,
    endOffset,
    total: page.total,
    hasPrevious: startOffset > 0,
    hasMore: endOffset < page.total,
    generation: current.generation,
  };
}
