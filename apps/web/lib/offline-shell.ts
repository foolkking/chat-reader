import { getOfflineSearchWorkerUrl } from "./offline-search";

export type OfflineShellPhase = "unsupported" | "preparing" | "ready" | "error";

export type OfflineShellStatus = {
  phase: OfflineShellPhase;
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
  status?: {
    ready: boolean;
    revision: string | null;
    resourceCount: number;
    missing: string[];
  };
  error?: string;
};

type WorkerProgressResponse = {
  type: "PROGRESS";
  completed: number;
  total: number;
};

const listeners = new Set<() => void>();
let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
let preparationPromise: Promise<OfflineShellStatus> | null = null;
let currentStatus: OfflineShellStatus = {
  phase: "preparing",
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
    phase: "unsupported",
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
    setStatus({ ...currentStatus, phase: "error", message });
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
  const registration = await navigator.serviceWorker.register("/library-sw.js", {
    scope: "/library",
    updateViaCache: "none",
  });
  await registration.update();
  if (registration.active) return registration;
  await navigator.serviceWorker.ready;
  const readyRegistration = await navigator.serviceWorker.getRegistration("/library");
  if (!readyRegistration?.active) throw new Error("离线启动服务尚未激活，请重试。");
  return readyRegistration;
}

async function prepareOfflineShellInternal(force: boolean): Promise<OfflineShellStatus> {
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/library")) {
    return currentStatus;
  }
  setStatus({ ...currentStatus, phase: "preparing", completed: 0, total: 0, message: null });
  let existing: WorkerStatusResponse | null = null;
  try {
    const registration = await registerLibraryServiceWorker();
    const serviceWorker = registration.active;
    if (!serviceWorker) throw new Error("离线启动服务尚未激活，请重试。");

    existing = await postMessage(serviceWorker, { type: "GET_LIBRARY_SHELL_STATUS" });
    if (existing.ok && existing.status?.ready) applyWorkerStatus(existing);
    const assets = collectLibraryShellAssets();
    const workerUrl = getOfflineSearchWorkerUrl();
    const revision = await createRevision(assets);
    if (existing.ok && existing.status?.ready && existing.status.revision === revision && !force) {
      return applyWorkerStatus(existing);
    }

    const result = await postMessage(serviceWorker, {
      type: "PREPARE_LIBRARY_SHELL",
      revision: force ? `${revision}-${Date.now().toString(36)}` : revision,
      assets,
      workerUrl,
    }, (progress) => {
      setStatus({
        ...currentStatus,
        phase: "preparing",
        completed: progress.completed,
        total: progress.total,
        message: null,
      });
    });
    if (!result.ok || !result.status?.ready) {
      throw new Error(result.error ?? "离线启动资源未能完整缓存。");
    }
    return applyWorkerStatus(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "离线启动准备失败。";
    if (existing?.ok && existing.status?.ready) {
      return applyWorkerStatus({ ...existing, error: message });
    }
    const status = { ...currentStatus, phase: "error" as const, message };
    setStatus(status);
    throw error;
  }
}

function collectLibraryShellAssets(): string[] {
  const urls = new Set<string>([
    "/library/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    getOfflineSearchWorkerUrl(),
  ]);
  document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]").forEach((element) => {
    const value = element instanceof HTMLScriptElement ? element.src : element.href;
    if (value) urls.add(value);
  });
  performance.getEntriesByType("resource").forEach((entry) => urls.add(entry.name));
  return Array.from(urls)
    .map(normalizeShellAsset)
    .filter((value): value is string => Boolean(value))
    .sort();
}

function normalizeShellAsset(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const allowed = url.pathname.startsWith("/_next/static/")
      || url.pathname.startsWith("/icons/")
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
): Promise<WorkerStatusResponse> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("离线启动资源准备超时，请检查连接后重试。"));
    }, 60_000);
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

function applyWorkerStatus(result: WorkerStatusResponse): OfflineShellStatus {
  const workerStatus = result.status;
  const status: OfflineShellStatus = {
    phase: workerStatus?.ready ? "ready" : "error",
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
