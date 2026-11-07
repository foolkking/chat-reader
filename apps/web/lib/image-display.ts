/** Shared with image_display.py: integer half-up rounding, never upscale. */
export type ImageDisplay = {
  source_sha256: string;
  scale_percent: number;
  original_width: number;
  original_height: number;
  width: number;
  height: number;
  configured?: boolean;
};
export const IMAGE_DISPLAY_CHANGED_EVENT = "chat-reader:image-display-changed";
export type ImageGeometry = Pick<ImageDisplay, "source_sha256" | "original_width" | "original_height">;
export type ImageSize = { width: number; height: number };

export function validatedImageGeometry(value: unknown, sha256: string | undefined): ImageGeometry | undefined {
  if (!value || typeof value !== "object" || !sha256 || !/^[a-f0-9]{64}$/.test(sha256)) return undefined;
  const candidate = value as ImageGeometry;
  if (candidate.source_sha256 !== sha256
    || ![candidate.original_width, candidate.original_height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000)) return undefined;
  return { source_sha256: sha256, original_width: candidate.original_width, original_height: candidate.original_height };
}

export function imageTargetSize(metadata: Record<string, unknown> | undefined, sha256: string | undefined): ImageSize | undefined {
  const saved = validatedImageDisplay(metadata?.image_display_v1, sha256);
  if (saved) return { width: saved.width, height: saved.height };
  const geometry = validatedImageGeometry(metadata?.image_geometry_v1, sha256);
  return geometry ? { width: geometry.original_width, height: geometry.original_height } : undefined;
}

/** A height limit folds content; it must never silently shrink its width. */
export function imageBodyGeometry(size: ImageSize | undefined, laneWidth: number, viewportHeight: number, expanded = false) {
  const target = size ?? { width: 320, height: 240 };
  const width = Math.min(target.width, Math.max(1, laneWidth));
  const fullHeight = width * target.height / target.width;
  const limit = Math.min(640, Math.max(1, viewportHeight) * .7);
  const foldable = target.height / target.width >= 2 && fullHeight > limit;
  return { width, fullHeight, height: foldable && !expanded ? limit : fullHeight, foldable, adapted: width < target.width };
}

export function scaledImageDimensions(width: number, height: number, percent: number) {
  return {
    width: Math.max(1, Math.floor((width * percent + 50) / 100)),
    height: Math.max(1, Math.floor((height * percent + 50) / 100)),
  };
}

export function validatedImageDisplay(value: unknown, sha256: string | undefined): ImageDisplay | undefined {
  if (!value || typeof value !== "object" || !sha256) return undefined;
  const candidate = value as ImageDisplay;
  if (candidate.source_sha256 !== sha256 || !/^[a-f0-9]{64}$/.test(sha256)
    || ![candidate.scale_percent, candidate.original_width, candidate.original_height, candidate.width, candidate.height]
      .every(n => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000)
    || candidate.scale_percent > 100) return undefined;
  const expected = scaledImageDimensions(candidate.original_width, candidate.original_height, candidate.scale_percent);
  if (expected.width !== candidate.width || expected.height !== candidate.height) return undefined;
  return {
    source_sha256: sha256, scale_percent: candidate.scale_percent,
    original_width: candidate.original_width, original_height: candidate.original_height,
    width: candidate.width, height: candidate.height,
    ...(typeof candidate.configured === "boolean" ? { configured: candidate.configured } : {}),
  };
}

export function recommendedImagePercent(width: number, height: number, laneWidth: number): number | null {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || !(laneWidth > 0)) return null;
  for (let percent = 100; percent >= 1; percent--) {
    const size = scaledImageDimensions(width, height, percent);
    if (size.width <= laneWidth && (percent === 100 || (width * height <= 8_000_000
      && Math.max(size.width, size.height) <= 4096 && size.width * size.height <= 4_000_000))) return percent;
  }
  return null;
}

/** Same source-order flow as CSS flex-wrap; actual per-row measurements win. */
export function imageFlowHeight(sizes: Array<(ImageSize & { caption?: boolean; expanded?: boolean }) | undefined>, laneWidth: number, viewportHeight: number) {
  const visible = sizes.length > 6 ? sizes.slice(0, 5) : sizes;
  const cells = visible.map(size => {
    const body = imageBodyGeometry(size, laneWidth, viewportHeight, size?.expanded);
    return { width: Math.max(44, body.width), height: Math.max(44, body.height) + 48
      + (size?.caption ? 24 : 0) + (body.foldable ? 44 : 0) + (body.adapted ? 20 : 0) };
  });
  if (sizes.length > 6) cells.push({ width: Math.min(160, laneWidth), height: 44 });
  let height = 0, rowWidth = 0, rowHeight = 0;
  for (const cell of cells) {
    if (rowWidth && rowWidth + 8 + cell.width > laneWidth) {
      height += rowHeight + 8; rowWidth = 0; rowHeight = 0;
    }
    rowWidth += (rowWidth ? 8 : 0) + cell.width;
    rowHeight = Math.max(rowHeight, cell.height);
  }
  return height + rowHeight;
}
