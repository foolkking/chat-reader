export type SourcePreviewAnchor = {
  start: number;
  end: number;
};

export function selectSourcePreviewAnchor<T extends SourcePreviewAnchor>(
  anchors: T[],
  sourceOffset: number,
): T | null {
  if (!anchors.length) return null;
  const containing = anchors
    .filter((anchor) => anchor.start <= sourceOffset && sourceOffset <= anchor.end)
    .sort((left, right) => {
      const spanDifference = (left.end - left.start) - (right.end - right.start);
      return spanDifference || right.start - left.start;
    });
  if (containing[0]) return containing[0];

  const previous = anchors
    .filter((anchor) => anchor.start <= sourceOffset)
    .sort((left, right) => right.end - left.end || right.start - left.start)[0];
  return previous ?? anchors[0] ?? null;
}

export function sourceAlignedPreviewScrollTop({
  sourceOffset,
  anchor,
  elementTop,
  elementHeight,
  viewportInset,
  maxScrollTop,
}: {
  sourceOffset: number;
  anchor: SourcePreviewAnchor;
  elementTop: number;
  elementHeight: number;
  viewportInset: number;
  maxScrollTop: number;
}): number {
  const span = Math.max(1, anchor.end - anchor.start);
  const progress = Math.max(0, Math.min(1, (sourceOffset - anchor.start) / span));
  const target = elementTop + Math.max(0, elementHeight) * progress - viewportInset;
  return Math.max(0, Math.min(maxScrollTop, target));
}
