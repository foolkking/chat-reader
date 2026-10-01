// A short, account-bound finalization barrier. It does not change the lease or
// delete data; only an explicit logout holds it while confirming the snapshot.
const PREFIX = "chat-reader:offline-write-freeze:";
export const OFFLINE_WRITE_FREEZE_EVENT = "chat-reader:offline-write-freeze";
const inMemory = new Map<string, { nonce: string; expires: number }>();
const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("chat-reader:offline-write-freeze") : null;
channel?.addEventListener("message", (event) => {
  const value = event.data;
  if (!value || typeof value.userId !== "string" || value.userId.length > 256 || typeof value.nonce !== "string") return;
  if (value.release) { if (inMemory.get(value.userId)?.nonce === value.nonce) inMemory.delete(value.userId); }
  else if (Number.isFinite(value.expires) && value.expires > Date.now() && value.expires <= Date.now() + 65_000) inMemory.set(value.userId, { nonce: value.nonce, expires: value.expires });
  window.dispatchEvent(new Event(OFFLINE_WRITE_FREEZE_EVENT));
});
export function offlineWriteFreezeExpiry(userId: string | null): number {
  if (!userId) return 0;
  try { return current(userId)?.expires ?? 0; } catch { return 0; }
}
export class OfflineWriteSuspendedError extends Error {
  constructor() { super("Local changes are paused while this account signs out. Retry shortly."); this.name = "OfflineWriteSuspendedError"; }
}
function current(userId: string) {
  let persisted: { nonce: string; expires: number } | null = null;
  try { persisted = JSON.parse(localStorage.getItem(`${PREFIX}${userId}`) ?? "null"); } catch { /* Memory and the cross-tab channel still fence writes. */ }
  const local = inMemory.get(userId);
  return local && local.expires > (persisted?.expires ?? 0) ? local : persisted;
}
export function assertOfflineWritable(userId: string | null): void {
  if (!userId || typeof window === "undefined") return;
  let frozen: ReturnType<typeof current>;
  try { frozen = current(userId); } catch { return; }
  if (frozen && frozen.expires > Date.now()) throw new OfflineWriteSuspendedError();
}
export function freezeOfflineWrites(userId: string): () => void {
  assertOfflineWritable(userId);
  const key = `${PREFIX}${userId}`, nonce = crypto.randomUUID();
  const value = { nonce, expires: Date.now() + 60_000 };
  inMemory.set(userId, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* A deliberate storage-failure signout remains possible. */ }
  channel?.postMessage({ userId, ...value });
  if (current(userId)?.nonce !== nonce) throw new OfflineWriteSuspendedError();
  window.dispatchEvent(new Event(OFFLINE_WRITE_FREEZE_EVENT));
  return () => {
    try { if (current(userId)?.nonce === nonce) localStorage.removeItem(key); } catch { /* The short barrier expires if storage becomes unavailable. */ }
    if (inMemory.get(userId)?.nonce === nonce) inMemory.delete(userId);
    channel?.postMessage({ userId, nonce, release: true });
    window.dispatchEvent(new Event(OFFLINE_WRITE_FREEZE_EVENT));
  };
}
