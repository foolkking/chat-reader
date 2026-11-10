import { withRequestDeadline } from "./request-deadline";

/** Blob fallback has an explicit device budget; no uncapped response.blob(). */
export const DIRECT_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
export class DirectDownloadSizeError extends Error {}

export async function readBoundedDownload(response: Response, signal: AbortSignal,
  onProgress: (received: number, total: number | null) => void): Promise<Blob> {
  // Fetch exposes decoded bytes, whereas Content-Length can describe the
  // compressed representation. The actual byte budget always remains active.
  const rawTotal = response.headers.get("content-encoding") ? null : response.headers.get("content-length");
  const declared = rawTotal && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null;
  const total = declared !== null && Number.isSafeInteger(declared) ? declared : null;
  if (total !== null && total > DIRECT_DOWNLOAD_MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new DirectDownloadSizeError("Direct download exceeds the browser budget.");
  }
  if (!response.body) throw new Error("Download stream unavailable.");
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0, completed = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      // Bound inactivity, not total duration: slow, progressing files can finish.
      const next = await withRequestDeadline(() => reader.read(), signal, 30_000);
      signal.throwIfAborted();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > DIRECT_DOWNLOAD_MAX_BYTES) throw new DirectDownloadSizeError("Direct download exceeds the browser budget.");
      chunks.push(new Uint8Array(next.value));
      onProgress(received, total);
    }
    if (total !== null && received !== total) throw new Error("Incomplete download.");
    completed = true;
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
    chunks.length = 0;
  }
}
