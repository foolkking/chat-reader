"use client";

import { useEffect } from "react";
import { flushAnnotationOutbox } from "../lib/annotation-repository";

export function OfflineSyncManager() {
  useEffect(() => {
    let running = false;
    const flush = () => {
      if (running) return;
      running = true;
      void flushAnnotationOutbox().catch(() => undefined).finally(() => { running = false; });
    };
    flush();
    window.addEventListener("online", flush);
    window.addEventListener("chat-reader:outbox", flush);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("chat-reader:outbox", flush);
    };
  }, []);
  return null;
}
