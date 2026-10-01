"use client";

import { useEffect } from "react";
import { flushAnnotationOutbox } from "../lib/annotation-repository";

export function OfflineSyncManager() {
  useEffect(() => {
    let running = false;
    let active = true;
    let requested = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (!active || !navigator.onLine) return;
      if (running) { requested = true; return; }
      clearTimeout(timer);
      running = true;
      void Promise.resolve().then(flushAnnotationOutbox).then((result) => {
        failures = 0;
        // Finite requests drain in separate ticks. New edits made while waiting
        // for a response also get a turn after the current transaction commits.
        requested ||= result.synced > 0;
        if (result.retryAt && active) timer = setTimeout(flush, Math.max(100, result.retryAt - Date.now()));
      }).catch(() => {
        failures += 1;
        if (active && failures < 5) timer = setTimeout(flush, Math.min(60_000, 2_000 * 2 ** (failures - 1)));
      }).finally(() => {
        running = false;
        if (active && requested) { requested = false; timer = setTimeout(flush, 100); }
      });
    };
    flush();
    window.addEventListener("online", flush);
    window.addEventListener("chat-reader:outbox", flush);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("online", flush);
      window.removeEventListener("chat-reader:outbox", flush);
    };
  }, []);
  return null;
}
