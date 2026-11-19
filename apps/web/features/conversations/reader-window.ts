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
  const budget = { nodes: 4096, chars: 131072 };
  for (const turn of page.turns) {
    turnsByKey.set(turn.turn_key, mergeReaderTurn(turnsByKey.get(turn.turn_key), turn, budget));
  }
  return loadedWindowFromTurns(
    Array.from(turnsByKey.values()).sort((left, right) => left.start_offset - right.start_offset),
    current.generation,
  );
}

type ComparisonBudget = { nodes: number; chars: number };

function mergeReaderTurn(existing: ReaderTurnResponse | undefined, incoming: ReaderTurnResponse, budget: ComparisonBudget): ReaderTurnResponse {
  if (!existing || existing === incoming || budget.nodes <= 0) return incoming;
  const { items: previousItems, ...previousMetadata } = existing;
  const { items: incomingItems, ...incomingMetadata } = incoming;
  const previousById = new Map(previousItems.map((message) => [message.id, message]));
  const items = incomingItems.map((message) => {
    const previous = previousById.get(message.id);
    return previous && sameReaderJson(previous, message, budget) ? previous : message;
  });
  if (items.length === previousItems.length && items.every((message, index) => message === previousItems[index])
    && sameReaderJson(previousMetadata, incomingMetadata, budget)) return existing;
  if (items.every((message, index) => message === incomingItems[index])) return incoming;
  return { ...incoming, items };
}

// The neighbour of an edge often repeats a mounted turn. Never treat an ID,
// revision, or hash as proof that attachment/extension fields are unchanged.
// If comparison would be expensive, accept the fresh response instead.
function sameReaderJson(a: unknown, b: unknown, budget: ComparisonBudget, depth = 0): boolean {
  if (--budget.nodes < 0 || depth > 32) return false;
  if (typeof a === "string" && (typeof b !== "string" || a.length !== b.length || (budget.chars -= a.length) < 0)) return false;
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.length <= budget.nodes
      && a.every((value, index) => sameReaderJson(value, b[index], budget, depth + 1));
  }
  const prototype = Object.getPrototypeOf(a);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getPrototypeOf(b) !== prototype) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length <= budget.nodes && keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameReaderJson(left[key], right[key], budget, depth + 1));
}

export function isUnchangedReaderPrefix(current: LoadedMessageWindow, next: LoadedMessageWindow): boolean {
  return current.generation === next.generation && current.total === next.total
    && current.startOffset === next.startOffset && current.hasPrevious === next.hasPrevious
    && current.items.length > 0 && next.items.length > current.items.length
    && current.turns.length > 0 && next.turns.length > current.turns.length
    && current.turns.every((turn, index) => turn === next.turns[index])
    && current.items.every((message, index) => message === next.items[index]);
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

/** Preserve the actual viewport/interaction interval, not an arbitrary tail. */
export function trimLoadedTurnWindowToProtectedMessages(
  current: LoadedMessageWindow,
  protectedIds: ReadonlySet<string>,
): LoadedMessageWindow {
  if (current.turns.length <= MAX_SETTLED_TURNS || protectedIds.size === 0) return current;
  const found = new Set<string>();
  const indexes: number[] = [];
  current.turns.forEach((turn, index) => {
    for (const message of turn.items) if (protectedIds.has(message.id)) {
      found.add(message.id);
      if (indexes.at(-1) !== index) indexes.push(index);
    }
  });
  if (found.size !== protectedIds.size || indexes.length === 0) return current;
  // Keep a neighbour on each side so the nearest boundary need not be
  // immediately fetched again. The protected interval always stays complete.
  let first = Math.max(0, indexes[0] - 1);
  let end = Math.min(current.turns.length, indexes[indexes.length - 1] + 2);
  while (end - first < MAX_SETTLED_TURNS) {
    if (first > 0) first--;
    else if (end < current.turns.length) end++;
    else break;
  }
  if (first === 0 && end === current.turns.length) return current;
  return loadedWindowFromTurns(current.turns.slice(first, end), current.generation);
}

export async function loadCompleteTurnWindow(
  loadTurn: (anchorMessageId?: string) => Promise<ReaderTurnResponse>,
  anchorMessageId?: string,
  targetTurnCount = MAX_SETTLED_TURNS,
  initialTurn?: ReaderTurnResponse,
): Promise<CompleteTurnWindow> {
  // Target-context resolution already fetched the center turn. Reusing it
  // avoids a duplicate reader-turn request before loading its neighbours.
  const center = initialTurn ?? await loadTurn(anchorMessageId);
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
