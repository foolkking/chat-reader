"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      return;
    }
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      if ("caches" in window) {
        void caches.delete("chat-reader-shell-v1");
        void caches.delete("chat-reader-static-v2");
      }
      return;
    }
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => registration.update()).catch(() => {
        // The reader remains fully usable without the optional offline shell.
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
