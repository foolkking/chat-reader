import type { DialogueIndexItem, RenderBlockRead } from "../../lib/types";

export type NeighborhoodRange = {
  offset: number;
  limit: number;
  firstOrdinal: number;
  lastOrdinal: number;
};

export function resolveNeighborhoodRange(
  items: DialogueIndexItem[],
  activeMessageId: string,
  beforeTurns = 2,
  afterTurns = 10,
): NeighborhoodRange | null {
  const ordered = [...items].sort((left, right) => left.ordinal - right.ordinal);
  const active = ordered.find((item) => item.message_id === activeMessageId);
  if (!active) return null;

  const userStarts = ordered.filter((item) => item.role === "user");
  if (userStarts.length === 0) return toRange(active.ordinal, active.ordinal);

  let activeTurnPosition = userStarts.findIndex((item, index) => {
    const nextUserOrdinal = userStarts[index + 1]?.ordinal ?? Number.POSITIVE_INFINITY;
    return active.ordinal >= item.ordinal && active.ordinal < nextUserOrdinal;
  });
  if (activeTurnPosition < 0) activeTurnPosition = 0;

  const firstTurnPosition = Math.max(0, activeTurnPosition - beforeTurns);
  const lastTurnPosition = Math.min(userStarts.length - 1, activeTurnPosition + afterTurns);
  const firstOrdinal = userStarts[firstTurnPosition].ordinal;
  const nextTurnOrdinal = userStarts[lastTurnPosition + 1]?.ordinal;
  const lastOrdinal = nextTurnOrdinal
    ? nextTurnOrdinal - 1
    : ordered.at(-1)?.ordinal ?? active.ordinal;

  return toRange(firstOrdinal, lastOrdinal);
}

export function hasCompleteBlockSet(blocks: RenderBlockRead[] | undefined, blockCount: number): boolean {
  if (blockCount <= 0) return true;
  if (!blocks || blocks.length < blockCount) return false;
  const indexes = new Set(blocks.map((block) => block.block_index));
  return indexes.size >= blockCount && indexes.has(0) && indexes.has(blockCount - 1);
}

function toRange(firstOrdinal: number, lastOrdinal: number): NeighborhoodRange {
  return {
    offset: Math.max(0, firstOrdinal - 1),
    limit: Math.max(1, lastOrdinal - firstOrdinal + 1),
    firstOrdinal,
    lastOrdinal,
  };
}
