/* global self, caches */

const LEGACY_CACHE_PATTERN = /^(chat-reader-shell-|chat-reader-static-|chat-reader-library-v\d+$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => LEGACY_CACHE_PATTERN.test(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister()),
  );
});
