import type {
  LoadedMessageWindow,
  ReaderTurnResponse,
  WindowGeneration,
} from "../../lib/types";

export const MAX_WINDOW_MESSAGES = 120;
export const MAX_SETTLED_TURNS = 3;
export const INITIAL_WINDOW_TURNS = 5;

export type CompleteTurnWindow = {
  items: LoadedMessageWindow["items"];
  turns: ReaderTurnResponse[];
  limit: number;
  offset: number;
  total: number;
  has_previous: boolean;
  has_more: boolean;
  previousTurnAnchorMessageId: string | null;
  nextTurnAnchorMessageId: string | null;
};

export function emptyLoadedWindow(generation: WindowGeneration = 0): LoadedMessageWindow {
  return {
    items: [],
    turns: [],
    startOffset: 0,
    endOffset: 0,
    total: 0,
    hasPrevious: false,
    hasMore: false,
    generation,
  };
}

export function replaceLoadedWindow(
  page: CompleteTurnWindow,
  generation: WindowGeneration,
): LoadedMessageWindow {
  return {
    items: page.items,
    turns: page.turns,
    startOffset: page.offset,
    endOffset: page.offset + page.items.length,
    total: page.total,
    hasPrevious: page.has_previous,
    hasMore: page.has_more,
    generation,
  };
}

export function mergeLoadedTurnWindow(
  current: LoadedMessageWindow,
  page: CompleteTurnWindow,
): LoadedMessageWindow {
  const turnsByKey = new Map(current.turns.map((turn) => [turn.turn_key, turn]));
  for (const turn of page.turns) turnsByKey.set(turn.turn_key, turn);
  return loadedWindowFromTurns(
    Array.from(turnsByKey.values()).sort((left, right) => left.start_offset - right.start_offset),
    current.generation,
  );
}

export function trimLoadedTurnWindow(
  current: LoadedMessageWindow,
  direction: "previous" | "next",
  protectedMessageId: string | null,
  maxTurns = MAX_SETTLED_TURNS,
): LoadedMessageWindow {
  if (current.turns.length <= maxTurns || !protectedMessageId) return current;
  const candidate = direction === "next"
    ? current.turns.slice(-maxTurns)
    : current.turns.slice(0, maxTurns);
  if (!candidate.some((turn) => turn.items.some((message) => message.id === protectedMessageId))) {
    return current;
  }
  return loadedWindowFromTurns(candidate, current.generation);
}

export async function loadCompleteTurnWindow(
  loadTurn: (anchorMessageId?: string) => Promise<ReaderTurnResponse>,
  anchorMessageId?: string,
  targetTurnCount = MAX_SETTLED_TURNS,
): Promise<CompleteTurnWindow> {
  const center = await loadTurn(anchorMessageId);
  const turns = [center];
  const seen = new Set([center.turn_key]);
  const loadAnchor = async (anchor: string | null) => {
    if (!anchor || turns.length >= targetTurnCount) return;
    const turn = await loadTurn(anchor);
    if (!seen.has(turn.turn_key)) {
      seen.add(turn.turn_key);
      turns.push(turn);
    }
  };
  await Promise.all([
    loadAnchor(center.previous_anchor_message_id),
    loadAnchor(center.next_anchor_message_id),
  ]);
  while (turns.length < targetTurnCount) {
    turns.sort((left, right) => left.start_offset - right.start_offset);
    const first = turns[0];
    const last = turns[turns.length - 1];
    const before = turns.length;
    await loadAnchor(last.next_anchor_message_id ?? first.previous_anchor_message_id);
    if (turns.length === before) break;
  }
  return completeWindowFromTurns(turns, center.total_messages);
}

function completeWindowFromTurns(turns: ReaderTurnResponse[], total: number): CompleteTurnWindow {
  const ordered = [...turns].sort((left, right) => left.start_offset - right.start_offset);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const items = ordered.flatMap((turn) => turn.items).sort((left, right) => left.order_key.localeCompare(right.order_key));
  return {
    items,
    turns: ordered,
    limit: items.length,
    offset: first?.start_offset ?? 0,
    total,
    has_previous: Boolean(first?.previous_anchor_message_id),
    has_more: Boolean(last?.next_anchor_message_id),
    previousTurnAnchorMessageId: first?.previous_anchor_message_id ?? null,
    nextTurnAnchorMessageId: last?.next_anchor_message_id ?? null,
  };
}

function loadedWindowFromTurns(
  turns: ReaderTurnResponse[],
  generation: WindowGeneration,
): LoadedMessageWindow {
  const complete = completeWindowFromTurns(
    turns,
    turns[0]?.total_messages ?? 0,
  );
  return replaceLoadedWindow(complete, generation);
}

export function prependLoadedWindow(
  current: LoadedMessageWindow,
  page: CompleteTurnWindow,
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
    turns: current.turns,
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
  page: CompleteTurnWindow,
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
    turns: current.turns,
    startOffset,
    endOffset,
    total: page.total,
    hasPrevious: startOffset > 0,
    hasMore: endOffset < page.total,
    generation: current.generation,
  };
}

