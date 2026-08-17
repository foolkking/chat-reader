"use client";

import { useEffect } from "react";
import {
  markOfflineShellUnsupported,
  prepareOfflineShell,
  registerLibraryServiceWorker,
} from "../lib/offline-shell";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (window.location.pathname === "/login") return;
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      if (window.location.pathname.startsWith("/library")) {
        markOfflineShellUnsupported("当前浏览器或连接不支持安全的离线启动。");
      }
      return;
    }
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      if ("caches" in window) {
        void caches.keys().then((keys) => Promise.all(
          keys.filter((key) => key.startsWith("chat-reader-")).map((key) => caches.delete(key)),
        ));
      }
      if (window.location.pathname.startsWith("/library")) {
        markOfflineShellUnsupported("开发模式不会启用离线启动缓存。");
      }
      return;
    }
    const register = () => {
      void registerLibraryServiceWorker()
        .then(() => window.location.pathname.startsWith("/library") ? prepareOfflineShell() : undefined)
        .catch(() => {
          // The online reader and any previous complete offline revision remain usable.
        });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
