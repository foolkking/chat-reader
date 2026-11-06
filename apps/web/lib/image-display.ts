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

export function recommendedImagePercent(width: number, height: number): number | null {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) return null;
  for (let percent = 100; percent >= 1; percent--) {
    const size = scaledImageDimensions(width, height, percent);
    if (size.width <= 640 && size.height <= 1600) return percent;
  }
  return null;
}

/** Also used by virtual row estimates. CSS container queries use these thresholds. */
export function imageGridGeometry(count: number, laneWidth: number) {
  const visible = Math.min(6, Math.max(1, count));
  const width = Math.max(1, laneWidth);
  const columns = Math.min(visible, width < 320 ? 1 : width < 640 ? 2 : 3);
  const cellWidth = Math.max(1, (width - (columns - 1) * 8) / columns);
  const rows = Math.ceil(visible / columns);
  return { columns, cellWidth, height: rows * cellWidth * 3 / 4 + (rows - 1) * 8 };
}
