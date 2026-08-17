import { clearProtectedOfflineData } from "./offline-db";

export const AUTH_UNAUTHORIZED_EVENT = "chat-reader:auth-unauthorized";
const OFFLINE_LEASE_KEY = "chat-reader:authenticated-offline-until";
const SESSION_PRESENCE_COOKIE = "chat_reader_session_present";

export type AuthSessionState = {
  authenticated: boolean;
  principal_id: string | null;
  inactivity_expires_at: string | null;
  auth_mode: "single_password";
};

export async function readAuthSession(): Promise<AuthSessionState> {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Authentication check returned ${response.status}`);
  return response.json() as Promise<AuthSessionState>;
}

export async function loginWithPassword(password: string): Promise<AuthSessionState> {
  return authMutation<AuthSessionState>("/api/auth/login", { password });
}

export async function logoutCurrentDevice(): Promise<void> {
  await authMutation<void>("/api/auth/logout", undefined);
  await clearBrowserAuthenticationState();
}

export async function changeOwnerPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  await authMutation<void>("/api/auth/password", {
    current_password: input.currentPassword,
    new_password: input.newPassword,
    confirm_password: input.confirmPassword,
  });
  await clearBrowserAuthenticationState();
}

export function rememberOfflineLease(expiresAt: string | null): void {
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    window.localStorage.removeItem(OFFLINE_LEASE_KEY);
    return;
  }
  window.localStorage.setItem(OFFLINE_LEASE_KEY, expiresAt);
}

export function hasCurrentOfflineLease(now = Date.now()): boolean {
  const value = window.localStorage.getItem(OFFLINE_LEASE_KEY);
  return hasSessionPresenceMarker() && value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
}

function hasSessionPresenceMarker(): boolean {
  return document.cookie.split(";").some((item) => item.trim() === `${SESSION_PRESENCE_COOKIE}=1`);
}

export async function clearBrowserAuthenticationState(): Promise<void> {
  window.localStorage.removeItem(OFFLINE_LEASE_KEY);
  await clearProtectedOfflineData();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "PURGE_PROTECTED_CONTENT" });
  }
}

export function safeReturnPath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) return "/";
  // Share capability tokens must never be copied into the login URL.
  if (/^\/(?:share|shared)\//i.test(pathname)) return "/";
  return pathname;
}

export function loginLocation(pathname: string): string {
  const returnTo = safeReturnPath(pathname);
  return returnTo === "/" ? "/login" : `/login?return_to=${encodeURIComponent(returnTo)}`;
}

async function authMutation<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "Authentication request failed.";
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch {
      // Keep the generic message for non-JSON failures.
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
