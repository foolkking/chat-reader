import {
  activateProtectedOfflineData,
  clearProtectedOfflineData,
  getActiveOfflineStorageContext,
  readPersistedOfflineUserId,
  type OfflineStorageContext,
} from "./offline-db";
import {
  clearOfflineShellIdentity,
  disableOfflineShellAfterIdentityFailure,
  persistOfflineShellIdentity,
} from "./offline-shell";

export const AUTH_UNAUTHORIZED_EVENT = "chat-reader:auth-unauthorized";
const OFFLINE_LEASE_KEY = "chat-reader:authenticated-offline-until";
const OFFLINE_LEASE_USER_KEY = "chat-reader:authenticated-offline-user";
export const AUTH_OFFLINE_IDENTITY_STORAGE_KEY = OFFLINE_LEASE_USER_KEY;
const SESSION_PRESENCE_COOKIE = "chat_reader_session_present";

export type AuthSessionState = {
  authenticated: boolean;
  principal_id: string | null;
  user_id: string | null;
  inactivity_expires_at: string | null;
  auth_mode: "single_password" | "multi_account" | "pending_approval";
  email: string | null;
  display_name: string | null;
  role: "ADMIN" | "USER" | null;
  registration_mode: RegistrationMode;
  password_reset_available: boolean;
};

export type RegistrationMode = "CLOSED" | "INVITE_ONLY" | "OPEN";

export type AuthSetupState = {
  setup_required: boolean;
  registration_mode: RegistrationMode;
};

export class AuthRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AuthRequestError";
  }
}

export async function readAuthSession(): Promise<AuthSessionState> {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Authentication check returned ${response.status}`);
  return response.json() as Promise<AuthSessionState>;
}

export async function readAuthSetup(): Promise<AuthSetupState> {
  const response = await fetch("/api/auth/setup/status", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new AuthRequestError("Account setup check failed.", response.status);
  return response.json() as Promise<AuthSetupState>;
}

export async function loginWithPassword(email: string, password: string): Promise<AuthSessionState> {
  const session = await authMutation<AuthSessionState>("/api/auth/login", { email, password });
  await bindAuthenticatedOfflineContext(session);
  return session;
}

export async function registerAccount(input: {
  email: string;
  password: string;
  confirmPassword: string;
  invitationToken?: string;
}): Promise<AuthSessionState> {
  const session = await authMutation<AuthSessionState>("/api/auth/register", {
    email: input.email,
    password: input.password,
    confirm_password: input.confirmPassword,
    invitation_token: input.invitationToken || undefined,
  });
  if (session.authenticated) await bindAuthenticatedOfflineContext(session);
  return session;
}

export async function upgradeLegacyAccount(input: {
  currentPassword: string;
  email: string;
  displayName?: string;
}): Promise<void> {
  await authMutation<void>("/api/auth/setup/upgrade", {
    current_password: input.currentPassword,
    email: input.email,
    display_name: input.displayName || undefined,
  });
  await clearBrowserAuthenticationState();
}

export async function requestPasswordReset(email: string): Promise<void> {
  await authMutation<void>("/api/auth/password-reset/request", { email });
}

export async function resetPassword(input: {
  token: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  await authMutation<void>("/api/auth/password-reset", {
    token: input.token,
    new_password: input.newPassword,
    confirm_password: input.confirmPassword,
  });
  await clearBrowserAuthenticationState();
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

export function rememberOfflineLease(expiresAt: string | null, userId?: string | null): void {
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    window.localStorage.removeItem(OFFLINE_LEASE_KEY);
    window.localStorage.removeItem(OFFLINE_LEASE_USER_KEY);
    return;
  }
  window.localStorage.setItem(OFFLINE_LEASE_KEY, expiresAt);
  const normalizedUserId = normalizeSessionUserId(userId) ?? readOfflineLeaseUserId() ?? readPersistedOfflineUserId();
  if (normalizedUserId) window.localStorage.setItem(OFFLINE_LEASE_USER_KEY, normalizedUserId);
}

export function hasCurrentOfflineLease(now = Date.now()): boolean {
  const value = window.localStorage.getItem(OFFLINE_LEASE_KEY);
  return hasSessionPresenceMarker()
    && value !== null
    && Number.isFinite(Date.parse(value))
    && Date.parse(value) > now
    && readOfflineLeaseUserId() !== null;
}

export function readOfflineLeaseUserId(): string | null {
  const stored = normalizeSessionUserId(window.localStorage.getItem(OFFLINE_LEASE_USER_KEY));
  if (stored) return stored;
  // Upgrade compatibility for a trusted-device lease created by the previous
  // single-owner release. Online verification promotes this logical identity
  // to the migrated User UUID before any other account can use the browser.
  const legacyExpiry = window.localStorage.getItem(OFFLINE_LEASE_KEY);
  return legacyExpiry && Number.isFinite(Date.parse(legacyExpiry)) ? "local:default" : null;
}

export async function activateOfflineLeaseContext(): Promise<OfflineStorageContext> {
  const userId = readOfflineLeaseUserId();
  if (!userId) throw new Error("Offline identity lease is unavailable.");
  return activateProtectedOfflineData(userId);
}

export function getCurrentOfflineRuntimeUserId(): string | null {
  return getActiveOfflineStorageContext().userId;
}

function hasSessionPresenceMarker(): boolean {
  return document.cookie.split(";").some((item) => item.trim() === `${SESSION_PRESENCE_COOKIE}=1`);
}

export async function clearBrowserAuthenticationState(): Promise<void> {
  const offlineUserId = readOfflineLeaseUserId() ?? readPersistedOfflineUserId();
  window.localStorage.removeItem(OFFLINE_LEASE_KEY);
  window.localStorage.removeItem(OFFLINE_LEASE_USER_KEY);
  const context = await clearProtectedOfflineData(offlineUserId);
  await clearOfflineShellIdentity(context);
  await purgeProtectedServiceWorkerContent(context);
}

export async function bindAuthenticatedOfflineContext(session: AuthSessionState): Promise<OfflineStorageContext> {
  const userId = resolveSessionUserId(session);
  const context = await activateProtectedOfflineData(userId);
  try {
    await persistOfflineShellIdentity(context);
  } catch {
    // Authentication must not be reported as failed after the server has
    // already created a valid session. If Cache Storage cannot persist the
    // identity pointer, remove the scoped worker so it cannot serve a previous
    // account's offline shell; online use may continue and registration can be
    // retried later.
    await disableOfflineShellAfterIdentityFailure();
  }
  rememberOfflineLease(session.inactivity_expires_at, userId);
  return context;
}

export function safeReturnPath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\") || hasUnsafeControlCharacter(pathname)) return "/";
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "/";
  }
  if (decoded.startsWith("//") || decoded.includes("\\") || hasUnsafeControlCharacter(decoded)) return "/";
  // Share capability tokens must never be copied into the login URL.
  if (/^\/(?:share|shared)\//i.test(decoded)) return "/";
  if (/^\/(?:login|register|account-upgrade|password-reset|reset-password)(?:\/|\?|$)/i.test(decoded)) return "/";
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
    throw new AuthRequestError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function resolveSessionUserId(session: AuthSessionState): string {
  return normalizeSessionUserId(session.user_id)
    ?? normalizeSessionUserId(session.principal_id)
    ?? "local:default";
}

function normalizeSessionUserId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : null;
}

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

async function purgeProtectedServiceWorkerContent(context: OfflineStorageContext): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const workers = new Set<ServiceWorker>();
  if (navigator.serviceWorker.controller) workers.add(navigator.serviceWorker.controller);
  const registration = await navigator.serviceWorker.getRegistration("/library").catch(() => undefined);
  if (registration?.active) workers.add(registration.active);
  workers.forEach((worker) => worker.postMessage({
    type: "PURGE_PROTECTED_CONTENT",
    namespace: context.namespace,
    purgeLegacy: context.usesLegacyStorage,
  }));
}
