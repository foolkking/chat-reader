import { useSyncExternalStore } from "react";

export const SERVER_SESSION_CHANGED = "chat-reader:server-session-changed";
export type ServerSession = {
  status: "unknown" | "verified" | "sign-in-required" | "unavailable";
  userId: string | null;
  expiresAt: number;
  checkedAt: number;
};
const initial: ServerSession = { status: "unknown", userId: null, expiresAt: 0, checkedAt: 0 };
let current = initial;
const listeners = new Set<() => void>();
export function serverSession(): ServerSession { return current; }
export function setServerSession(next: ServerSession): void {
  current = next;
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SERVER_SESSION_CHANGED));
}
export function pauseServerSession(status: "sign-in-required" | "unavailable"): void {
  setServerSession({ ...current, status, checkedAt: Date.now() });
}
export function canUseServer(userId?: string | null): boolean {
  return current.status === "verified" && current.expiresAt > Date.now()
    && (!userId || current.userId === userId);
}
export function observeSessionResponse(response: Response, requestUserId: string | null): void {
  const userId = response.headers.get("X-Chat-Reader-User");
  const expiresAt = Date.parse(response.headers.get("X-Chat-Reader-Session-Expires") ?? "");
  // A response is not an account binding. Only extend the already bound identity.
  if (response.ok && userId && userId === requestUserId && current.userId === userId
    && Number.isFinite(expiresAt) && expiresAt > current.expiresAt && current.status === "verified") {
    setServerSession({ ...current, expiresAt });
  }
}
export function useServerSession(): ServerSession {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    serverSession, () => initial,
  );
}
