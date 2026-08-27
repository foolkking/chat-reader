import { getOfflineSearchWorkerUrl } from "./offline-search";

export type OfflineShellAvailability = "unknown" | "ready" | "unavailable" | "unsupported";
export type OfflineShellUpdatePhase = "idle" | "checking" | "preparing" | "failed";

export type OfflineShellStatus = {
  availability: OfflineShellAvailability;
  updatePhase: OfflineShellUpdatePhase;
  revision: string | null;
  resourceCount: number;
  completed: number;
  total: number;
  missing: string[];
  message: string | null;
};

type WorkerStatusResponse = {
  type: "RESULT";
  ok: boolean;
  protocolVersion?: number;
  status?: {
    ready: boolean;
    revision: string | null;
    resourceCount: number;
    missing: string[];
  };
  error?: string;
};

const WORKER_PROTOCOL_VERSION = 1;
const WORKER_HANDSHAKE_TIMEOUT = 3_000;
const WORKER_ACTIVATION_TIMEOUT = 15_000;
const SHELL_META_CACHE = "chat-reader-library-meta-v1";
const ACTIVE_RECORD_KEY = "/__chat_reader_library_active__";

type WorkerProgressResponse = {
  type: "PROGRESS";
  completed: number;
  total: number;
};

type CachedShellRecord = {
  revision: string;
  cacheName: string;
  assets: string[];
  criticalAssets?: string[];
  resourceCount?: number;
};

const listeners = new Set<() => void>();
let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
let preparationPromise: Promise<OfflineShellStatus> | null = null;
let reconciliationPromise: Promise<OfflineShellStatus> | null = null;
let currentStatus: OfflineShellStatus = {
  availability: "unknown",
  updatePhase: "checking",
  revision: null,
  resourceCount: 0,
  completed: 0,
  total: 0,
  missing: [],
  message: null,
};

export function getOfflineShellStatus(): OfflineShellStatus {
  return currentStatus;
}

export function subscribeOfflineShellStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markOfflineShellUnsupported(message: string): void {
  setStatus({
    availability: "unsupported",
    updatePhase: "idle",
    revision: null,
    resourceCount: 0,
    completed: 0,
    total: 0,
    missing: [],
    message,
  });
}

export function registerLibraryServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (registrationPromise) return registrationPromise;
  registrationPromise = registerLibraryServiceWorkerInternal().catch((error: unknown) => {
    registrationPromise = null;
    const message = error instanceof Error ? error.message : "Service Worker 注册失败。";
    setStatus({
      ...currentStatus,
      availability: currentStatus.availability === "ready" ? "ready" : "unavailable",
      updatePhase: "failed",
      message,
    });
    throw error;
  });
  return registrationPromise;
}

export function prepareOfflineShell(options: { force?: boolean } = {}): Promise<OfflineShellStatus> {
  if (preparationPromise && !options.force) return preparationPromise;
  const request = prepareOfflineShellInternal(options.force ?? false).finally(() => {
    if (preparationPromise === request) preparationPromise = null;
  });
  preparationPromise = request;
  return request;
}

async function registerLibraryServiceWorkerInternal(): Promise<ServiceWorkerRegistration> {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error("当前浏览器或连接不支持安全的离线启动。");
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  const libraryScope = new URL("/library", window.location.origin).href.replace(/\/+$/, "");
  await Promise.all(registrations.map(async (registration) => {
    if (registration.scope.replace(/\/+$/, "") === libraryScope) return;
    await registration.unregister();
  }));
  const existingRegistration = registrations.find((registration) => registration.scope.replace(/\/+$/, "") === libraryScope);
  if (existingRegistration?.active && await supportsLibraryShellProtocol(existingRegistration.active)) {
    // The active shell is canonical for the current visit. Network update and
    // runtime reconciliation are background work and never gate Library use.
    void existingRegistration.update().catch(() => undefined);
    return existingRegistration;
  }
  let registration = await navigator.serviceWorker.register("/library-sw.js", {
    scope: "/library",
    updateViaCache: "none",
  });
  await registration.update();
  let active = await activatePendingWorker(registration);
  if (active && await supportsLibraryShellProtocol(active)) return registration;

  // An upgraded page can still observe the previous active worker while the
  // replacement is installing. Re-register only this scope if it cannot speak
  // the current protocol; Cache Storage and IndexedDB remain intact.
  await registration.unregister();
  registration = await navigator.serviceWorker.register("/library-sw.js", {
    scope: "/library",
    updateViaCache: "none",
  });
  active = await activatePendingWorker(registration);
  if (!active || !await supportsLibraryShellProtocol(active)) {
    throw new Error("离线启动服务尚未激活，请重试。");
  }
  return registration;
}

async function activatePendingWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const candidate = registration.installing ?? registration.waiting;
  if (!candidate) return registration.active;
  if (candidate.state !== "activated") {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        candidate.removeEventListener("statechange", handleStateChange);
        reject(new Error("Service Worker activation timed out."));
      }, WORKER_ACTIVATION_TIMEOUT);
      const handleStateChange = () => {
        if (candidate.state === "activated") {
          window.clearTimeout(timer);
          candidate.removeEventListener("statechange", handleStateChange);
          resolve();
        } else if (candidate.state === "redundant") {
          window.clearTimeout(timer);
          candidate.removeEventListener("statechange", handleStateChange);
          reject(new Error("Service Worker update became redundant."));
        }
      };
      candidate.addEventListener("statechange", handleStateChange);
      handleStateChange();
    });
  }
  return candidate.state === "activated" ? candidate : registration.active;
}

async function supportsLibraryShellProtocol(serviceWorker: ServiceWorker): Promise<boolean> {
  try {
    const result = await postMessage(
      serviceWorker,
      { type: "GET_LIBRARY_SHELL_STATUS" },
      undefined,
      WORKER_HANDSHAKE_TIMEOUT,
    );
    return result.ok && result.protocolVersion === WORKER_PROTOCOL_VERSION;
  } catch {
    return false;
  }
}

async function prepareOfflineShellInternal(force: boolean): Promise<OfflineShellStatus> {
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/library")) {
    return currentStatus;
  }
  // A cached Library page can mount before the Service Worker message channel
  // is ready. Cache Storage is the source of truth for whether its current
  // shell can run offline, so establish that state first. In particular, an
  // optional skill document must never leave the UI stuck at "checking".
  const cachedStatus = await inspectCachedShellFromWindow();
  if (cachedStatus?.availability === "ready" && !force) {
    setStatus(cachedStatus);
    void reconcileCachedShellInBackground(cachedStatus).catch(() => undefined);
    return cachedStatus;
  }
  setStatus({
    ...currentStatus,
    updatePhase: "checking",
    completed: 0,
    total: 0,
    message: null,
  });
  let existing: WorkerStatusResponse | null = null;
  try {
    const registration = await registerLibraryServiceWorker();
    const serviceWorker = registration.active;
    if (!serviceWorker) throw new Error("离线启动服务尚未激活，请重试。");

    existing = await postMessage(serviceWorker, { type: "GET_LIBRARY_SHELL_STATUS" });
    if (existing.ok && existing.status?.ready) {
      applyWorkerStatus(existing);
      if (!force) {
        // A complete active shell is immediately usable. Runtime reconciliation
        // continues in the background and cannot block Reader or package sync.
        void startOfflineShellReconciliation(serviceWorker, existing).catch((error: unknown) => {
          applyWorkerStatus({
            type: "RESULT",
            ok: true,
            protocolVersion: existing?.protocolVersion,
            status: existing?.status,
            error: error instanceof Error ? error.message : "离线启动资源后台更新失败。",
          }, "failed");
        });
        return currentStatus;
      }
    }
    return await startOfflineShellReconciliation(serviceWorker, existing, force);
  } catch (error) {
    const message = error instanceof Error ? error.message : "离线启动准备失败。";
    if (existing?.ok && existing.status?.ready) {
      return applyWorkerStatus({ ...existing, error: message }, "failed");
    }
    const status = { ...currentStatus, availability: "unavailable" as const, updatePhase: "failed" as const, message };
    setStatus(status);
    throw error;
  }
}

async function reconcileCachedShellInBackground(fallback: OfflineShellStatus): Promise<void> {
  try {
    const registration = await registerLibraryServiceWorker();
    const serviceWorker = registration.active;
    if (!serviceWorker) return;
    const existing = await postMessage(serviceWorker, { type: "GET_LIBRARY_SHELL_STATUS" });
    if (!existing.ok || !existing.status?.ready) return;
    await startOfflineShellReconciliation(serviceWorker, existing);
  } catch (error) {
    // The previously verified cache remains readable. Surface a truthful
    // update failure rather than changing a ready shell into an indeterminate
    // checking state.
    setStatus({
      ...fallback,
      updatePhase: "failed",
      message: error instanceof Error ? error.message : "Offline shell update failed.",
    });
  }
}

async function inspectCachedShellFromWindow(): Promise<OfflineShellStatus | null> {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  try {
    const metadata = await caches.open(SHELL_META_CACHE);
    const response = await metadata.match(ACTIVE_RECORD_KEY);
    if (!response) return null;
    const record = await response.json() as CachedShellRecord;
    if (!record || typeof record.cacheName !== "string" || !Array.isArray(record.assets)) return null;
    const cacheNames = await caches.keys();
    if (!cacheNames.includes(record.cacheName)) return null;
    const criticalAssets = Array.isArray(record.criticalAssets)
      ? record.criticalAssets
      : record.assets.filter((asset) => !isOptionalShellAsset(asset));
    const shell = await caches.open(record.cacheName);
    const matches = await Promise.all(criticalAssets.map((asset) => shell.match(asset)));
    const missing = criticalAssets.filter((_, index) => !matches[index]);
    if (missing.length) {
      return {
        availability: "unavailable",
        updatePhase: "idle",
        revision: typeof record.revision === "string" ? record.revision : null,
        resourceCount: record.resourceCount ?? record.assets.length,
        completed: 0,
        total: 0,
        missing,
        message: "Offline shell resources are incomplete.",
      };
    }
    return {
      availability: "ready",
      updatePhase: "idle",
      revision: typeof record.revision === "string" ? record.revision : null,
      resourceCount: record.resourceCount ?? record.assets.length,
      completed: record.resourceCount ?? record.assets.length,
      total: record.resourceCount ?? record.assets.length,
      missing: [],
      message: null,
    };
  } catch {
    return null;
  }
}

function startOfflineShellReconciliation(
  serviceWorker: ServiceWorker,
  existing: WorkerStatusResponse,
  force = false,
): Promise<OfflineShellStatus> {
  if (reconciliationPromise && !force) return reconciliationPromise;
  const request = reconcileOfflineShell(serviceWorker, existing, force).finally(() => {
    if (reconciliationPromise === request) reconciliationPromise = null;
  });
  reconciliationPromise = request;
  return request;
}

async function reconcileOfflineShell(serviceWorker: ServiceWorker, existing: WorkerStatusResponse, force = false): Promise<OfflineShellStatus> {
  setStatus({ ...currentStatus, updatePhase: "preparing", completed: 0, total: 0, message: null });
  const runtimeAssets = await warmAttachmentViewerRuntime();
  const assets = collectLibraryShellAssets(runtimeAssets);
  const criticalAssets = assets.filter((asset) => !isOptionalShellAsset(asset));
  const workerUrl = getOfflineSearchWorkerUrl();
  const revision = await createRevision(assets);
  if (existing.ok && existing.status?.ready && existing.status.revision === revision && !force) {
    return applyWorkerStatus(existing);
  }
  const result = await postMessage(serviceWorker, {
    type: "PREPARE_LIBRARY_SHELL",
    revision: force ? `${revision}-${Date.now().toString(36)}` : revision,
    assets,
    criticalAssets,
    workerUrl,
  }, (progress) => {
    setStatus({
      ...currentStatus,
      updatePhase: "preparing",
      completed: progress.completed,
      total: progress.total,
      message: null,
    });
  });
  if (!result.ok || !result.status?.ready) {
    throw new Error(result.error ?? "离线启动资源未能完整缓存。");
  }
  return applyWorkerStatus(result);
}

function isOptionalShellAsset(asset: string): boolean {
  // Skill documents are useful offline but are not required to mount Library
  // or Reader. A missing one must not make the entire shell unavailable.
  return asset.startsWith("/skills/");
}

async function warmAttachmentViewerRuntime(): Promise<string[]> {
  // Offline preparation is explicit. Load dynamic viewer chunks now so the
  // shell asset inventory includes them instead of discovering a missing
  // renderer only after connectivity has been lost.
  const before = new Set(performance.getEntriesByType("resource").map((entry) => entry.name));
  const pdfRuntime = await import("../features/attachments/pdfjs-runtime");
  const results = await Promise.allSettled([
    pdfRuntime.loadPdfJs(),
    import("react-zoom-pan-pinch"),
  ]);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) {
    throw new Error("部分附件预览组件未能缓存，请联网后重试。");
  }
  const loadedAssets = performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((value) => !before.has(value))
    .map(normalizeShellAsset)
    .filter((value): value is string => Boolean(value));
  const workerAsset = normalizeShellAsset(pdfRuntime.getPdfJsWorkerUrl());
  if (workerAsset) loadedAssets.push(workerAsset);
  return Array.from(new Set(loadedAssets));
}

function collectLibraryShellAssets(runtimeAssets: string[] = []): string[] {
  const urls = new Set<string>([
    "/library/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/skills/chat-reader-conversation-context-acquisition-skill.v1.md",
    "/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md",
    getOfflineSearchWorkerUrl(),
  ]);
  document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]").forEach((element) => {
    const value = element instanceof HTMLScriptElement ? element.src : element.href;
    if (value) urls.add(value);
  });
  collectBundledKatexAssets().forEach((asset) => urls.add(asset));
  runtimeAssets.forEach((asset) => urls.add(asset));
  return Array.from(urls)
    .map(normalizeShellAsset)
    .filter((value): value is string => Boolean(value))
    .sort();
}

function collectBundledKatexAssets(): string[] {
  const assets = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheets are never part of the offline shell contract.
      continue;
    }
    collectKatexAssetsFromRules(rules, assets);
  }
  return Array.from(assets).sort();
}

function collectKatexAssetsFromRules(rules: CSSRuleList, assets: Set<string>): void {
  for (const rule of Array.from(rules)) {
    if (rule.type === CSSRule.FONT_FACE_RULE) {
      const source = (rule as CSSFontFaceRule).style.getPropertyValue("src");
      for (const match of source.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const asset = normalizeShellAsset(match[1]);
        if (asset?.startsWith("/_next/static/media/KaTeX_")) assets.add(asset);
      }
      continue;
    }
    const nestedRules = "cssRules" in rule ? (rule as CSSGroupingRule).cssRules : null;
    if (nestedRules) collectKatexAssetsFromRules(nestedRules, assets);
  }
}

function normalizeShellAsset(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const allowed = url.pathname.startsWith("/_next/static/")
      || url.pathname.startsWith("/icons/")
      || url.pathname.startsWith("/skills/")
      || url.pathname === "/library/manifest.webmanifest";
    return allowed ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

async function createRevision(assets: string[]): Promise<string> {
  const value = assets.join("\n");
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function postMessage(
  serviceWorker: ServiceWorker,
  message: Record<string, unknown>,
  onProgress?: (progress: WorkerProgressResponse) => void,
  timeout = 60_000,
): Promise<WorkerStatusResponse> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("离线启动资源准备超时，请检查连接后重试。"));
    }, timeout);
    channel.port1.onmessage = (event: MessageEvent<WorkerStatusResponse | WorkerProgressResponse>) => {
      if (event.data.type === "PROGRESS") {
        onProgress?.(event.data);
        return;
      }
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    serviceWorker.postMessage(message, [channel.port2]);
  });
}

function applyWorkerStatus(result: WorkerStatusResponse, updatePhase: OfflineShellUpdatePhase = "idle"): OfflineShellStatus {
  const workerStatus = result.status;
  const status: OfflineShellStatus = {
    availability: workerStatus?.ready ? "ready" : "unavailable",
    updatePhase,
    revision: workerStatus?.revision ?? null,
    resourceCount: workerStatus?.resourceCount ?? 0,
    completed: workerStatus?.resourceCount ?? 0,
    total: workerStatus?.resourceCount ?? 0,
    missing: workerStatus?.missing ?? [],
    message: result.error ?? null,
  };
  setStatus(status);
  return status;
}

function setStatus(status: OfflineShellStatus): void {
  currentStatus = status;
  listeners.forEach((listener) => listener());
}
