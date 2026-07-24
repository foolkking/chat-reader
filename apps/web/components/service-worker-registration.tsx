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
        void caches.delete("chat-reader-library-v3");
        void caches.delete("chat-reader-library-v4");
        void caches.delete("chat-reader-library-v5");
      }
      return;
    }
    const register = () => {
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        const libraryScope = new URL("/library", window.location.origin).href;
        await Promise.all(registrations.map(async (registration) => {
          const normalizedScope = registration.scope.replace(/\/+$/, "");
          if (normalizedScope === libraryScope.replace(/\/+$/, "")) return;
          await registration.unregister();
        }));
        const registration = await navigator.serviceWorker.register("/library-sw.js", {
          scope: "/library",
          updateViaCache: "none",
        });
        await registration.update();
      }).catch(() => {
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
