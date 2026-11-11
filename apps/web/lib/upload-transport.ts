export type UploadProgress = { stage: "uploading" | "confirming"; percent: number | null };

/** Inactivity bounds, not a total deadline for a slow upload. Aborting only
 * stops this transport; it never proves that the server rejected the write. */
export function sendUpload(url: string, body: FormData, options: {
  headers: Record<string, string>; signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let finished = false, uploaded = 0, received = 0, confirming = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousProgress = "";
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      request.upload.removeEventListener("progress", progress);
      request.upload.removeEventListener("load", sent);
      request.removeEventListener("progress", responseProgress);
      request.removeEventListener("load", load);
      request.removeEventListener("error", error);
      request.removeEventListener("abort", aborted);
    };
    const fail = (reason: string) => {
      if (finished) return;
      finished = true; cleanup(); request.abort(); reject(new Error(reason));
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fail("UPLOAD_INACTIVE"), confirming ? 300_000 : 120_000);
    };
    const publish = (percent: number | null) => {
      const value: UploadProgress = { stage: confirming ? "confirming" : "uploading", percent };
      const identity = `${value.stage}:${percent}`;
      if (identity !== previousProgress && !finished) {
        previousProgress = identity; options.onProgress?.(value);
      }
    };
    const progress = (event: ProgressEvent) => {
      if (finished || confirming) return;
      if (event.loaded > uploaded) { uploaded = event.loaded; arm(); }
      publish(event.lengthComputable && event.total > 0 ? Math.min(100, Math.floor(event.loaded * 100 / event.total)) : null);
    };
    const sent = () => {
      if (finished) return;
      confirming = true; arm(); publish(100);
    };
    const responseProgress = (event: ProgressEvent) => {
      if (!finished && event.loaded > received) { received = event.loaded; confirming = true; arm(); }
    };
    const abort = () => fail("UPLOAD_STOPPED");
    const error = () => fail("CONNECTION_FAILED");
    const aborted = () => fail("UPLOAD_STOPPED");
    const load = () => {
      if (finished) return;
      if (request.status < 200) { fail("CONNECTION_FAILED"); return; }
      finished = true; cleanup();
      try {
        const headers = new Headers();
        for (const line of request.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
          const separator = line.indexOf(":");
          if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
        resolve(new Response(request.status === 204 ? null : request.responseText, { status: request.status, headers }));
      } catch {
        reject(new Error("UPLOAD_RESPONSE_INVALID"));
      }
    };
    if (options.signal?.aborted) { fail("UPLOAD_STOPPED"); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    request.upload.addEventListener("progress", progress);
    request.upload.addEventListener("load", sent);
    request.addEventListener("progress", responseProgress);
    request.addEventListener("load", load);
    request.addEventListener("error", error);
    request.addEventListener("abort", aborted);
    try {
      request.open("POST", url);
      for (const [key, value] of Object.entries(options.headers)) request.setRequestHeader(key, value);
      publish(null); arm(); request.send(body);
    } catch { fail("CONNECTION_FAILED"); }
  });
}
