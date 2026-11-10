/** A finite control/read operation, not a deadline for uploading file bytes.
 * Timing out a write says nothing about whether the server accepted it. */
export async function withRequestDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal | null,
  milliseconds = 20_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      abort = () => { controller.abort(); reject(new Error("REQUEST_ABORTED")); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("REQUEST_TIMEOUT"));
      }, milliseconds);
    });
    // The race also bounds a response-body read or non-cooperative transport.
    return await Promise.race([deadline, controller.signal.aborted ? Promise.reject(new Error("REQUEST_ABORTED")) : run(controller.signal)]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
