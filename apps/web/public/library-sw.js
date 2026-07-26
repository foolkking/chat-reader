/* global self, caches, URL, fetch, Request, Response, AbortController */

const META_CACHE = "chat-reader-library-meta-v1";
const ACTIVE_RECORD_KEY = "/__chat_reader_library_active__";
const SHELL_CACHE_PREFIX = "chat-reader-library-shell-";
const LEGACY_CACHE_PATTERN = /^(chat-reader-shell-|chat-reader-static-|chat-reader-library-v\d+$)/;
const MAX_ASSETS = 1000;
const FETCH_CONCURRENCY = 6;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  if (event.data?.type === "GET_LIBRARY_SHELL_STATUS") {
    event.waitUntil(sendStatus(port));
    return;
  }
  if (event.data?.type === "PREPARE_LIBRARY_SHELL") {
    event.waitUntil(prepareLibraryShell(event.data, port));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && isLibraryPath(url.pathname)) {
    event.respondWith(libraryNavigation(request));
    return;
  }
  if (isShellAssetPath(url.pathname)) {
    event.respondWith(activeCacheFirst(request));
  }
});

async function sendStatus(port) {
  try {
    port.postMessage({ type: "RESULT", ok: true, status: await inspectActiveShell() });
  } catch (error) {
    port.postMessage({ type: "RESULT", ok: false, error: errorMessage(error) });
  }
}

async function prepareLibraryShell(data, port) {
  let targetCacheName = null;
  try {
    const requestedRevision = typeof data.revision === "string" ? data.revision : "";
    if (!/^[a-z0-9_-]{6,80}$/i.test(requestedRevision)) {
      throw new Error("Invalid offline shell revision.");
    }
    const assets = normalizeAssets(data.assets);
    const workerUrl = normalizeAsset(data.workerUrl);
    if (!workerUrl || !assets.includes(workerUrl)) {
      throw new Error("The offline search worker is missing from the shell manifest.");
    }
    if (!assets.some((asset) => asset.startsWith("/_next/static/") && asset.includes(".js"))) {
      throw new Error("The offline shell has no JavaScript entry.");
    }
    if (!assets.some((asset) => asset.startsWith("/_next/static/") && asset.includes(".css"))) {
      throw new Error("The offline shell has no stylesheet entry.");
    }

    const active = await readActiveRecord();
    if (active?.revision === requestedRevision) {
      const status = await inspectActiveShell();
      if (status.ready) {
        port.postMessage({ type: "RESULT", ok: true, status });
        return;
      }
    }

    targetCacheName = `${SHELL_CACHE_PREFIX}${requestedRevision}`;
    if (targetCacheName !== active?.cacheName) await caches.delete(targetCacheName);
    const targetCache = await caches.open(targetCacheName);
    const required = ["/library", ...assets];
    let cursor = 0;
    let completed = 0;

    async function cacheNext() {
      while (cursor < required.length) {
        const index = cursor;
        cursor += 1;
        const asset = required[index];
        await cacheRequiredAsset(targetCache, asset);
        completed += 1;
        port.postMessage({ type: "PROGRESS", completed, total: required.length });
      }
    }

    await Promise.all(Array.from(
      { length: Math.min(FETCH_CONCURRENCY, required.length) },
      () => cacheNext(),
    ));

    const record = {
      revision: requestedRevision,
      cacheName: targetCacheName,
      assets: required,
      workerUrl,
      resourceCount: required.length,
      preparedAt: new Date().toISOString(),
    };
    const meta = await caches.open(META_CACHE);
    await meta.put(ACTIVE_RECORD_KEY, new Response(JSON.stringify(record), {
      headers: { "Content-Type": "application/json" },
    }));
    await cleanupSupersededCaches(targetCacheName);
    port.postMessage({ type: "RESULT", ok: true, status: await inspectActiveShell() });
  } catch (error) {
    const active = await readActiveRecord().catch(() => null);
    if (targetCacheName && targetCacheName !== active?.cacheName) {
      await caches.delete(targetCacheName).catch(() => false);
    }
    port.postMessage({ type: "RESULT", ok: false, error: errorMessage(error) });
  }
}

async function cacheRequiredAsset(cache, asset) {
  const url = new URL(asset, self.location.origin);
  const request = new Request(url.href, {
    cache: "reload",
    credentials: "same-origin",
  });
  const response = await fetchWithTimeout(request, 15_000);
  if (!response.ok) throw new Error(`Failed to cache ${url.pathname}: HTTP ${response.status}`);
  if (asset === "/library") {
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("text/html")) throw new Error("The offline library shell is not HTML.");
    await cache.put("/library", response);
    return;
  }
  await cache.put(`${url.pathname}${url.search}`, response);
}

async function inspectActiveShell() {
  const record = await readActiveRecord();
  if (!record) return { ready: false, revision: null, resourceCount: 0, missing: [] };
  const cacheNames = await caches.keys();
  if (!cacheNames.includes(record.cacheName)) {
    return {
      ready: false,
      revision: record.revision,
      resourceCount: record.resourceCount,
      missing: record.assets,
    };
  }
  const cache = await caches.open(record.cacheName);
  const matches = await Promise.all(record.assets.map((asset) => cache.match(asset)));
  const missing = record.assets.filter((_, index) => !matches[index]);
  return {
    ready: missing.length === 0,
    revision: record.revision,
    resourceCount: record.resourceCount,
    missing,
  };
}

async function readActiveRecord() {
  const meta = await caches.open(META_CACHE);
  const response = await meta.match(ACTIVE_RECORD_KEY);
  if (!response) return null;
  const value = await response.json();
  if (!value || typeof value.cacheName !== "string" || !Array.isArray(value.assets)) return null;
  return value;
}

async function libraryNavigation(request) {
  let lastResponse = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(request, 2_000);
      if (response.status < 500) return response;
      lastResponse = response;
    } catch {
      // Retry once before using the last complete shell revision.
    }
    if (attempt === 0) await delay(350);
  }

  const cached = await matchActive("/library") || await matchLegacyLibrary();
  if (cached) return cached;
  if (lastResponse) return lastResponse;
  return new Response("Offline library is not ready. Connect once and open /library to prepare it.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "1" },
  });
}

async function activeCacheFirst(request) {
  const cached = await matchActive(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const record = await readActiveRecord();
    if (record) {
      const cache = await caches.open(record.cacheName);
      await cache.put(request, response.clone()).catch(() => undefined);
    }
  }
  return response;
}

async function matchActive(request) {
  const record = await readActiveRecord();
  if (!record) return null;
  const cache = await caches.open(record.cacheName);
  return cache.match(request);
}

async function matchLegacyLibrary() {
  const cacheNames = await caches.keys();
  for (const cacheName of cacheNames) {
    if (!/^chat-reader-library-v\d+$/.test(cacheName)) continue;
    const response = await (await caches.open(cacheName)).match("/library");
    if (response) return response;
  }
  return null;
}

async function cleanupSupersededCaches(activeCacheName) {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => {
    const supersededShell = cacheName.startsWith(SHELL_CACHE_PREFIX) && cacheName !== activeCacheName;
    const legacy = LEGACY_CACHE_PATTERN.test(cacheName);
    return supersededShell || legacy ? caches.delete(cacheName) : Promise.resolve(false);
  }));
}

function normalizeAssets(values) {
  if (!Array.isArray(values)) throw new Error("The offline shell manifest is invalid.");
  const assets = Array.from(new Set(values.map(normalizeAsset).filter(Boolean)));
  if (!assets.length || assets.length > MAX_ASSETS) throw new Error("The offline shell manifest has an invalid size.");
  return assets.sort();
}

function normalizeAsset(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || !isShellAssetPath(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function isLibraryPath(pathname) {
  return pathname === "/library" || pathname.startsWith("/library/");
}

function isShellAssetPath(pathname) {
  return pathname.startsWith("/_next/static/")
    || pathname.startsWith("/icons/")
    || pathname === "/library/manifest.webmanifest";
}

async function fetchWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timer = self.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(new Request(request, { signal: controller.signal }));
  } finally {
    self.clearTimeout(timer);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => self.setTimeout(resolve, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Offline shell preparation failed.";
}
