/* global self, caches */

const LEGACY_CACHES = [
  "chat-reader-shell-v1",
  "chat-reader-static-v2",
  "chat-reader-library-v3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all(LEGACY_CACHES.map((key) => caches.delete(key)))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister()),
  );
});
