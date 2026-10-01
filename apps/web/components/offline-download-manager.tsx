"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { OFFLINE_DOWNLOAD_CHANGED_EVENT, resumeOfflineDownloads } from "../lib/offline-downloads";

export function OfflineDownloadManager() {
  const path = usePathname();
  const publicPage = /^\/(?:login|register|share|account-upgrade|password-reset|reset-password|verify-email)(?:\/|$)/.test(path ?? "");
  useEffect(() => {
    if (publicPage) return;
    let active = true, running = false;
    let controller = new AbortController();
    const run = () => {
      if (!active || running || !navigator.onLine) return;
      running = true;
      if (controller.signal.aborted) controller = new AbortController();
      void Promise.resolve().then(() => resumeOfflineDownloads(controller.signal)).catch(() => undefined).finally(() => { running = false; });
    };
    const offline = () => controller.abort();
    run();
    const timer = setInterval(run, 1500);
    window.addEventListener(OFFLINE_DOWNLOAD_CHANGED_EVENT, run);
    window.addEventListener("online", run);
    window.addEventListener("offline", offline);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener(OFFLINE_DOWNLOAD_CHANGED_EVENT, run); window.removeEventListener("online", run); window.removeEventListener("offline", offline); };
  }, [publicPage]);
  return null;
}
