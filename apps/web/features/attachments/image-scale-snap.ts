export const IMAGE_SCALE_STOPS = [25, 50, 75, 100] as const;

export type ImageScaleSample = { raw: number; time: number; snapped: number | null };

/** Pointer-only magnetism. Slow movement keeps every 1% value reachable. */
export function snapImageScale(raw: number, time: number, previous: ImageScaleSample | null) {
  const clamped = Math.max(1, Math.min(100, raw));
  const elapsed = previous ? time - previous.time : 0;
  const fast = Boolean(previous && elapsed > 0
    && Math.abs(clamped - previous.raw) / elapsed >= 0.12);
  const capture = previous ? (fast ? 4 : 0.5) : 2;
  const release = fast ? 6 : 0.75;
  const nearest = IMAGE_SCALE_STOPS.find(stop => Math.abs(clamped - stop) <= capture);
  const snapped = previous?.snapped != null && Math.abs(clamped - previous.snapped) <= release
    ? previous.snapped : nearest ?? null;
  return {
    percent: snapped ?? Math.round(clamped),
    sample: { raw: clamped, time, snapped } satisfies ImageScaleSample,
  };
}
