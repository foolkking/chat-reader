import { withRequestDeadline } from "../../lib/request-deadline";

export const INLINE_TEXT_BYTES = 128 * 1024;

/** A preview is an explicit prefix, never a truncated download or import. Even
 * a server ignoring Range cannot make us buffer the full attachment. */
export async function readInlineTextPreview(url: string, signal: AbortSignal) {
  const response = await withRequestDeadline(requestSignal => fetch(url, {
    headers: { Range: `bytes=0-${INLINE_TEXT_BYTES - 1}` },
    signal: AbortSignal.any([signal, requestSignal]),
  }), signal, 30_000);
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("PREVIEW_READ_FAILED");
  }
  const range = response.headers.get("content-range")?.match(/^bytes 0-(\d+)\/(\d+|\*)$/);
  const length = response.headers.get("content-encoding") ? null : response.headers.get("content-length");
  const declared = range ? Number(range[1]) + 1 : length && /^\d+$/.test(length) ? Number(length) : null;
  const expected = declared !== null && Number.isSafeInteger(declared) ? declared : null;
  const total = range ? range[2] === "*" ? null : Number(range[2]) : expected;
  if (response.status === 206 && (!range || expected === null || expected > INLINE_TEXT_BYTES
    || (total !== null && (!Number.isSafeInteger(total) || total < expected))
    || response.headers.has("content-encoding"))) {
    void response.body.cancel().catch(() => undefined);
    throw new Error("PREVIEW_RANGE_INVALID");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "", complete = false, overflow = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (bytes < INLINE_TEXT_BYTES) {
      signal.throwIfAborted();
      const result = await withRequestDeadline(() => reader.read(), signal, 30_000);
      signal.throwIfAborted();
      if (result.done) {
        if (expected !== null && bytes < expected) throw new Error("PREVIEW_INCOMPLETE");
        complete = true;
        break;
      }
      const prefix = result.value.subarray(0, INLINE_TEXT_BYTES - bytes);
      if (expected !== null && bytes + result.value.byteLength > expected) throw new Error("PREVIEW_INCOMPLETE");
      bytes += prefix.byteLength;
      text += decoder.decode(prefix, { stream: true });
      if (result.value.byteLength > prefix.byteLength) { overflow = true; break; }
    }
    // Do not turn a cut UTF-8 sequence into an invented replacement character.
    const limited = overflow || (total !== null ? total > bytes : Boolean(range) || !complete);
    if (!limited) text += decoder.decode();
    return { text, limited };
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}
