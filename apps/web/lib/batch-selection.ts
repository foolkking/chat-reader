export type BatchSelectionResult = {
  succeededIds: string[];
  failedIds: string[];
  unconfirmedIds: string[];
  notStartedIds: string[];
};

export type BatchSelectionProgress = {
  total: number;
  succeeded: number;
  failed: number;
  unconfirmed: number;
  inFlight: number;
  notStarted: number;
  stopped?: boolean;
};

export type BatchSelectionOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: BatchSelectionProgress) => void;
};

export async function runBatchSelection(
  ids: string[],
  operation: (id: string) => Promise<unknown>,
  concurrency = 4,
  options: BatchSelectionOptions = {},
): Promise<BatchSelectionResult> {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  const unconfirmedIds: string[] = [];
  let cursor = 0;
  let inFlight = 0;
  const report = () => options.onProgress?.({
    total: ids.length,
    succeeded: succeededIds.length,
    failed: failedIds.length,
    unconfirmed: unconfirmedIds.length,
    inFlight,
    notStarted: ids.length - cursor,
    stopped: options.signal?.aborted ?? false,
  });
  options.signal?.addEventListener("abort", report);
  report();

  async function worker() {
    while (!options.signal?.aborted && cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const id = ids[index];
      inFlight += 1;
      report();
      try {
        await operation(id);
        succeededIds.push(id);
      } catch (error) {
        if (isDefiniteHttpRejection(error)) {
          failedIds.push(id);
        } else {
          // A timeout, connection loss, 408, or 5xx can occur after commit.
          // Never label such a write as definitely failed or replay it blindly.
          unconfirmedIds.push(id);
        }
      } finally {
        inFlight -= 1;
        report();
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
    return { succeededIds, failedIds, unconfirmedIds, notStartedIds: ids.slice(cursor) };
  } finally {
    options.signal?.removeEventListener("abort", report);
  }
}

function isDefiniteHttpRejection(error: unknown): error is Error & { status: number } {
  return error instanceof Error && error.name === "ApiRequestError"
    && typeof (error as Error & { status?: unknown }).status === "number"
    && (error as Error & { status: number }).status >= 400
    && (error as Error & { status: number }).status < 500
    && (error as Error & { status: number }).status !== 408;
}
