"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { OFFLINE_DOWNLOAD_CHANGED_EVENT, resumeOfflineDownloads, resumeOfflineServerCancellations } from "../lib/offline-downloads";
import { canUseServer, SERVER_SESSION_CHANGED } from "../lib/server-session";
import { offlineAuthenticationRequired } from "../lib/offline-access";

export function OfflineDownloadManager() {
  const path = usePathname();
  const publicPage = /^\/(?:login|register|share|account-upgrade|password-reset|reset-password|verify-email)(?:\/|$)/.test(path ?? "");
  useEffect(() => {
    if (publicPage) return;
    let active = true, running = false, cancelling = false;
    let controller = new AbortController();
    const run = () => {
      // Offline still has local cancellation work. The coordinator decides
      // which operations need a connection and owns the account writer lock.
      if (!active) return;
      if (controller.signal.aborted) controller = new AbortController();
      const signal = controller.signal;
      if (!running) {
        running = true;
        void Promise.resolve().then(() => resumeOfflineDownloads(signal)).catch(() => undefined).finally(() => { running = false; });
      }
      if (navigator.onLine && (!offlineAuthenticationRequired() || canUseServer()) && !cancelling) {
        cancelling = true;
        void Promise.resolve().then(() => resumeOfflineServerCancellations(signal)).catch(() => undefined).finally(() => { cancelling = false; });
      }
    };
    const offline = () => controller.abort();
    run();
    const timer = setInterval(run, 1500);
    window.addEventListener(OFFLINE_DOWNLOAD_CHANGED_EVENT, run);
    window.addEventListener("online", run);
    window.addEventListener("offline", offline);
    window.addEventListener(SERVER_SESSION_CHANGED, run);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener(OFFLINE_DOWNLOAD_CHANGED_EVENT, run); window.removeEventListener("online", run); window.removeEventListener("offline", offline); window.removeEventListener(SERVER_SESSION_CHANGED, run); };
  }, [publicPage]);
  return null;
}
