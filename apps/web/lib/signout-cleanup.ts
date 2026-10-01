import { deleteProtectedOfflineStorage, type OfflineStorageContext } from "./offline-db";
import { clearOfflineShellIdentity } from "./offline-shell";

const PREFIX = "chat-reader:pending-signout-cleanup:";
const COMPLETED_PREFIX = "chat-reader:completed-signout-cleanup:";
export const SIGNOUT_CLEANUP_EVENT = "chat-reader:signout-cleanup";
type CleanupContext = OfflineStorageContext & { cleanupId: string };
const memory = new Map<string, CleanupContext>();
const flights = new Map<string, Promise<void>>();

function stores(): Storage[] {
  const result: Storage[] = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try { result.push(window[name]); } catch { /* Keep the in-memory recovery. */ }
  }
  return result;
}

export function rememberSignoutCleanup(context: OfflineStorageContext): void {
  if (!context.userId) return;
  const record = { ...context, cleanupId: crypto.randomUUID() };
  memory.set(context.userId, record);
  for (const storage of stores()) {
    try { storage.setItem(PREFIX + encodeURIComponent(context.userId), JSON.stringify({ legacy: context.usesLegacyStorage, cleanupId: record.cleanupId })); break; } catch { /* The other store or memory can still retain recovery. */ }
  }
}

export function pendingSignoutCleanups(): CleanupContext[] {
  // Local storage is shared and takes precedence over a tab's fallback copy.
  for (const storage of stores().reverse()) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index); if (!key?.startsWith(PREFIX)) continue;
        try {
          const userId = decodeURIComponent(key.slice(PREFIX.length)), value: unknown = JSON.parse(storage.getItem(key) ?? "null");
          if (!userId || userId.length > 256 || !value || typeof value !== "object" || !("legacy" in value) || typeof value.legacy !== "boolean" || !("cleanupId" in value) || typeof value.cleanupId !== "string") continue;
          const namespace = value.legacy ? "legacy" : `user-${Array.from(new TextEncoder().encode(userId), (b) => b.toString(16).padStart(2, "0")).join("")}`;
          // Reconstruct only our own namespace. Stored values can never supply
          // arbitrary database/cache names to a destructive browser operation.
          memory.set(userId, { userId, namespace, usesLegacyStorage: value.legacy, cleanupId: value.cleanupId,
            databaseName: `chat-reader-offline-library${value.legacy ? "" : `--${namespace}`}`,
            assetCacheName: `chat-reader-offline-assets-v1${value.legacy ? "" : `--${namespace}`}` });
        } catch { /* Ignore malformed unrelated storage. */ }
      }
    } catch { /* Keep pending in memory if storage is inaccessible. */ }
  }
  for (const [userId, context] of memory) {
    try {
      if (localStorage.getItem(COMPLETED_PREFIX + encodeURIComponent(userId)) === context.cleanupId) memory.delete(userId);
    } catch { /* An unconfirmed cleanup remains pending. */ }
  }
  return [...memory.values()];
}

export class SignoutCleanupPendingError extends Error {
  constructor() { super("Signout cleanup is incomplete."); this.name = "SignoutCleanupPendingError"; }
}

async function clearOne(context: CleanupContext): Promise<void> {
  const existing = flights.get(context.databaseName); if (existing) return existing;
  const work = async () => {
    if (!pendingSignoutCleanups().some((row) => row.userId === context.userId && row.cleanupId === context.cleanupId)) return;
    const results = await Promise.allSettled([deleteProtectedOfflineStorage(context), clearOfflineShellIdentity(context)]);
    if (results.some((result) => result.status === "rejected")) throw new SignoutCleanupPendingError();
    // Revocation may have happened while localStorage itself was unavailable.
    // Remove that account's old lease once storage recovers; never erase B's.
    if (localStorage.getItem("chat-reader:authenticated-offline-user") === context.userId) {
      localStorage.removeItem("chat-reader:authenticated-offline-until");
      localStorage.removeItem("chat-reader:authenticated-offline-user");
    }
    if (localStorage.getItem("chat-reader:offline-active-user-v1") === context.userId) localStorage.removeItem("chat-reader:offline-active-user-v1");
    // A completion token prevents another tab's older in-memory/sessionStorage
    // fallback from re-deleting data after the account signs in again.
    localStorage.setItem(COMPLETED_PREFIX + encodeURIComponent(context.userId!), context.cleanupId);
    for (const storage of stores()) {
      try {
        const key = PREFIX + encodeURIComponent(context.userId!);
        if (JSON.parse(storage.getItem(key) ?? "null")?.cleanupId === context.cleanupId) storage.removeItem(key);
      } catch { /* The shared completion token makes stale copies inert. */ }
    }
    memory.delete(context.userId!);
  };
  const flight = (navigator.locks ? navigator.locks.request(`chat-reader:signout-cleanup:${context.databaseName}`, work) : work())
    .then(() => undefined)
    .finally(() => { flights.delete(context.databaseName); });
  flights.set(context.databaseName, flight);
  return flight;
}

export async function retrySignoutCleanup(userId?: string): Promise<boolean> {
  const contexts = pendingSignoutCleanups().filter((context) => !userId || context.userId === userId);
  let timer: number | undefined;
  try {
    // A blocked IDB delete can finish later. Its marker stays until completion;
    // the auth boundary refuses to reopen that account while it is pending.
    return await Promise.race([
      Promise.allSettled(contexts.map(clearOne)).then((results) => results.every((result) => result.status === "fulfilled")),
      new Promise<boolean>((resolve) => { timer = window.setTimeout(() => resolve(false), 3_000); }),
    ]);
  } finally { window.clearTimeout(timer); }
}
