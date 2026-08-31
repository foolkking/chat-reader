export type ReaderPerformanceStage =
  | "first-content"
  | "locator-resolution"
  | "target-mount";

export type ReaderPerformanceOutcome =
  | "success"
  | "empty"
  | "fallback"
  | "failed"
  | "cancelled";

export type ReaderPerformanceDetail = {
  stage: ReaderPerformanceStage;
  durationMs: number;
  outcome: ReaderPerformanceOutcome;
  path?: "initial" | "local" | "remote" | "message-window";
};

export const READER_PERFORMANCE_EVENT = "chat-reader:reader-performance";

/**
 * Exposes redacted Reader timings to browser diagnostics and acceptance tests.
 * The detail deliberately contains only bounded timing and enum values.
 */
export function reportReaderPerformance(
  stage: ReaderPerformanceStage,
  startedAt: number,
  outcome: ReaderPerformanceOutcome,
  path?: ReaderPerformanceDetail["path"],
): ReaderPerformanceDetail | null {
  if (typeof window === "undefined") return null;
  const finishedAt = window.performance.now();
  const durationMs = Math.round(Math.max(0, Math.min(120_000, finishedAt - startedAt)) * 10) / 10;
  const detail: ReaderPerformanceDetail = { stage, durationMs, outcome, ...(path ? { path } : {}) };

  try {
    window.performance.measure(`chat-reader:${stage}`, {
      start: startedAt,
      end: finishedAt,
      detail,
    });
  } catch {
    // The CustomEvent below remains the stable contract in browsers that do
    // not support the PerformanceMeasure options object.
  }
  window.dispatchEvent(new CustomEvent<ReaderPerformanceDetail>(READER_PERFORMANCE_EVENT, { detail }));
  return detail;
}
