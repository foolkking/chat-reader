export type ReaderVirtualItemGeometry = {
  index: number;
  start: number;
  end: number;
  mounted?: boolean;
};

export type ReaderViewportCoverage = {
  visibleItemCount: number;
  leadingGap: number;
  trailingGap: number;
  internalGap: number;
  missingIndexes: number[];
  needsRecovery: boolean;
};

export type ReaderViewportInterval = {
  start: number;
  end: number;
};

export type ReaderViewportUnion = {
  visibleIntervalCount: number;
  internalGap: number;
  needsRecovery: boolean;
};

/**
 * Check the virtualizer's expected coordinate coverage without treating the
 * normal spacing between consecutive blocks as a missing region. A missing
 * index range is only suspicious when its expected interval intersects the
 * actual viewport; pinned rows outside the viewport therefore do not trigger
 * a recovery.
 */
export function inspectReaderViewportCoverage(
  items: ReaderVirtualItemGeometry[],
  viewportStart: number,
  viewportEnd: number,
  tolerance = 12,
): ReaderViewportCoverage {
  const start = Math.min(viewportStart, viewportEnd);
  const end = Math.max(viewportStart, viewportEnd);
  const sorted = [...items]
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
    .sort((left, right) => left.start - right.start || left.index - right.index);
  const visible = sorted.filter((item) => item.end > start - tolerance && item.start < end + tolerance);
  const leadingGap = visible.length > 0 ? Math.max(0, visible[0].start - start) : Math.max(0, end - start);
  const trailingGap = visible.length > 0 ? Math.max(0, end - visible.at(-1)!.end) : Math.max(0, end - start);
  const missingIndexes: number[] = [];
  let internalGap = 0;

  for (let index = 0; index < visible.length; index += 1) {
    const current = visible[index];
    if (!current.mounted) missingIndexes.push(current.index);
    const next = visible[index + 1];
    if (!next || next.index <= current.index + 1) continue;
    const gapStart = Math.max(start, current.end);
    const gapEnd = Math.min(end, next.start);
    if (gapEnd - gapStart <= tolerance) continue;
    internalGap = Math.max(internalGap, gapEnd - gapStart);
    const firstMissing = current.index + 1;
    const lastMissing = next.index - 1;
    for (let missing = firstMissing; missing <= lastMissing && missingIndexes.length < 128; missing += 1) {
      missingIndexes.push(missing);
    }
  }

  const needsRecovery = visible.length === 0
    || leadingGap > tolerance
    || trailingGap > tolerance
    || internalGap > tolerance
    || missingIndexes.length > 0;
  return {
    visibleItemCount: visible.length,
    leadingGap,
    trailingGap,
    internalGap,
    missingIndexes: [...new Set(missingIndexes)].slice(0, 128),
    needsRecovery,
  };
}

/**
 * Inspect real mounted row boxes, clipped to this message's visible region.
 * Virtual spacers are not readable content and cannot prove coverage. Large
 * intentional whitespace inside a row is covered by that real row's box.
 */
export function inspectReaderViewportUnion(
  intervals: ReaderViewportInterval[],
  viewportStart: number,
  viewportEnd: number,
  tolerance = 24,
): ReaderViewportUnion {
  const start = Math.min(viewportStart, viewportEnd);
  const end = Math.max(viewportStart, viewportEnd);
  const clipped = intervals
    .map((interval) => ({
      start: Math.max(start, Math.min(end, interval.start)),
      end: Math.max(start, Math.min(end, interval.end)),
    }))
    .filter((interval) => interval.end - interval.start > 0)
    .sort((left, right) => left.start - right.start);

  if (clipped.length === 0) {
    return {
      visibleIntervalCount: 0,
      internalGap: end - start,
      needsRecovery: end - start > tolerance,
    };
  }

  let cursor = clipped[0].end;
  let internalGap = Math.max(0, clipped[0].start - start);
  for (const interval of clipped.slice(1)) {
    if (interval.start > cursor) {
      internalGap = Math.max(internalGap, interval.start - cursor);
    }
    cursor = Math.max(cursor, interval.end);
  }
  internalGap = Math.max(internalGap, end - cursor);
  return {
    visibleIntervalCount: clipped.length,
    internalGap,
    needsRecovery: internalGap > tolerance,
  };
}
