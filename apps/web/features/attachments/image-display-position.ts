type Rect = { left: number; right: number; top: number; bottom: number };

/** Keep the anchored menu reachable without covering Reader's sticky rails. */
export function imageDisplayMenuPosition(
  anchor: Pick<Rect, "right" | "bottom">,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  obstacles: Rect[],
) {
  const margin = 16, gap = 8;
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const left = Math.max(margin, Math.min(anchor.right - size.width, maxLeft));
  const top = Math.max(margin, Math.min(anchor.bottom + 4, viewport.height - size.height - margin));
  const rails = obstacles.filter(rect => rect.right > rect.left && rect.bottom > rect.top
    && rect.top < top + size.height && rect.bottom > top);
  const clear = (x: number) => rails.every(rect => x + size.width <= rect.left || x >= rect.right);
  const candidates = [left, ...rails.flatMap(rect => [rect.left - size.width - gap, rect.right + gap])]
    .filter(x => x >= margin && x <= maxLeft && clear(x))
    .sort((a, b) => Math.abs(a - left) - Math.abs(b - left));
  return { left: candidates[0] ?? left, top };
}
