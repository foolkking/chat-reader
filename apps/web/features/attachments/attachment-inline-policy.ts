export type JustifiedInput<T> = { key: string; ratio: number; item: T };
export type JustifiedRow<T> = { height: number; items: Array<JustifiedInput<T> & { width: number }> };

/**
 * Creates centred, aspect-ratio-preserving rows for the Reader Gallery.
 * The final row is capped at 1.1x the 200px target instead of being stretched
 * merely to fill the lane.
 */
export function computeJustifiedRows<T>(items: JustifiedInput<T>[], containerWidth: number): JustifiedRow<T>[] {
  const gap = 8;
  const target = 200;
  const maxLast = 220;
  const rows: JustifiedInput<T>[][] = [];
  let current: JustifiedInput<T>[] = [];
  let ratioSum = 0;
  for (const item of items) {
    current.push(item);
    ratioSum += Math.max(0.2, Math.min(8, item.ratio));
    const projected = ratioSum * target + Math.max(0, current.length - 1) * gap;
    if (projected >= containerWidth * 0.88 || current.length >= 4) {
      rows.push(current);
      current = [];
      ratioSum = 0;
    }
  }
  if (current.length) rows.push(current);
  return rows.map((row, index) => {
    const sum = row.reduce((total, item) => total + Math.max(0.2, Math.min(8, item.ratio)), 0);
    const available = Math.max(120, containerWidth - Math.max(0, row.length - 1) * gap);
    const naturalFill = available / Math.max(0.2, sum);
    const isLast = index === rows.length - 1;
    const height = Math.max(128, Math.min(isLast ? maxLast : 220, naturalFill));
    return {
      height,
      items: row.map((item) => ({ ...item, width: Math.max(88, Math.min(available, item.ratio * height)) })),
    };
  });
}
