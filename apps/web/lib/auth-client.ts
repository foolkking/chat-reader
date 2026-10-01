import {
  activateProtectedOfflineData,
  captureProtectedOfflineStorageContext,
  lockProtectedOfflineData,
  getActiveOfflineStorageContext,
  readPersistedOfflineUserId,
  type OfflineStorageContext,
} from "./offline-db";
import {
  disableOfflineShellAfterIdentityFailure,
  persistOfflineShellIdentity,
} from "./offline-shell";
import { authorizeOfflineAccess } from "./offline-access";
import { resetOfflineSearch } from "./offline-search";
import { freezeOfflineWrites } from "./offline-write-guard";
import { OfflinePendingChangedError, readOfflinePending } from "./offline-pending";
import { pendingSignoutCleanups, rememberSignoutCleanup, retrySignoutCleanup, SignoutCleanupPendingError } from "./signout-cleanup";

export { AUTH_UNAUTHORIZED_EVENT } from "./offline-access";
export const ACCOUNT_CAPABILITIES_CHANGED_EVENT = "chat-reader:account-capabilities-changed";
const OFFLINE_LEASE_KEY = "chat-reader:authenticated-offline-until";
const OFFLINE_LEASE_USER_KEY = "chat-reader:authenticated-offline-user";
const OFFLINE_LOCKED_USERS_KEY = "chat-reader:offline-locked-users-v1";
export const AUTH_OFFLINE_IDENTITY_STORAGE_KEY = OFFLINE_LEASE_USER_KEY;
const SESSION_PRESENCE_COOKIE = "chat_reader_session_present";
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;

export type AuthSessionState = {
  authenticated: boolean;
  principal_id: string | null;
  user_id: string | null;
  inactivity_expires_at: string | null;
  auth_mode: "single_password" | "multi_account" | "pending_approval" | "pending_verification";
  email: string | null;
  display_name: string | null;
  role: "ADMIN" | "USER" | null;
  registration_mode: RegistrationMode;
  password_reset_available: boolean;
  email_verification_required?: boolean;
  approval_required?: boolean;
  verification_delivery?: "sent" | "failed" | null;
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

export async function readAuthSession(signal?: AbortSignal): Promise<AuthSessionState> {
  const session = await authRequest<AuthSessionState>("/api/auth/session", { signal });
  if (typeof session?.authenticated !== "boolean" || (session.authenticated && !session.user_id && !session.principal_id)) {
    throw new AuthRequestError("Invalid authentication response.", 502);
  }
  return session;
}

export async function readAuthSetup(): Promise<AuthSetupState> {
  return authRequest<AuthSetupState>("/api/auth/setup/status");
}

export async function loginWithPassword(email: string, password: string): Promise<AuthSessionState> {
  // The private boundary initializes local storage after navigation. A local
  // cache failure must not turn an accepted password into a failed login.
  return authMutation<AuthSessionState>("/api/auth/login", { email, password });
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

export async function requestEmailVerification(email: string, password: string): Promise<void> {
  return authMutation<void>("/api/auth/email-verification/request", { email, password });
}

export async function confirmEmailVerification(token: string): Promise<{ verified: boolean; approval_required: boolean }> {
  return authMutation("/api/auth/email-verification/confirm", { token });
}

export type AccountCapabilities = {
  role: "ADMIN" | "USER";
  allow_share_links: boolean;
  allow_public_share: boolean;
  allow_share_password: boolean;
  allow_user_skills: boolean;
  allow_skill_import: boolean;
  allow_user_import: boolean;
  maximum_import_size_mb: number;
  maximum_merge_message_count: number;
  email_delivery_available: boolean;
};

export function readAccountCapabilities(): Promise<AccountCapabilities> {
  return authRequest<AccountCapabilities>("/api/auth/capabilities");
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

export async function logoutCurrentDevice(expectedFingerprint?: string, discardUnreadableStorage = false): Promise<void> {
  return withPreparedSignout(expectedFingerprint, async () => {
    try { await authMutation<void>("/api/auth/logout", undefined); }
    catch (error) { if (!(error instanceof AuthRequestError && error.status === 401)) throw error; }
  }, discardUnreadableStorage);
}

async function withPreparedSignout(expectedFingerprint: string | undefined, mutation: () => Promise<void>, discardUnreadableStorage = false): Promise<void> {
  const userId = getActiveOfflineStorageContext().userId;
  const databaseName = getActiveOfflineStorageContext().databaseName;
  if (!userId) throw new AuthRequestError("Authentication required.", 401);
  const work = async () => {
    if (getActiveOfflineStorageContext().userId !== userId) throw new OfflinePendingChangedError();
    const release = freezeOfflineWrites(userId);
    try {
      const snapshot = await readOfflinePending().catch((error: unknown) => { if (!discardUnreadableStorage) throw error; return null; });
      if (snapshot && (snapshot.userId !== userId || (expectedFingerprint ? snapshot.fingerprint !== expectedFingerprint : snapshot.count > 0))) throw new OfflinePendingChangedError();
      await mutation();
      const currentUser = getActiveOfflineStorageContext().userId ?? readPersistedOfflineUserId();
      if (currentUser && currentUser !== userId) throw new OfflinePendingChangedError();
      await clearBrowserAuthenticationState();
    } finally { release(); }
  };
  return navigator.locks ? navigator.locks.request(`chat-reader:sync:${databaseName}`, work) : work();
}

export async function changeOwnerPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}, expectedFingerprint?: string): Promise<void> {
  await withPreparedSignout(expectedFingerprint, () => authMutation<void>("/api/auth/password", {
    current_password: input.currentPassword,
    new_password: input.newPassword,
    confirm_password: input.confirmPassword,
  }));
}

export function rememberOfflineLease(expiresAt: string | null, userId?: string | null): void {
  try {
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
      window.localStorage.removeItem(OFFLINE_LEASE_KEY);
      window.localStorage.removeItem(OFFLINE_LEASE_USER_KEY);
      return;
    }
    window.localStorage.setItem(OFFLINE_LEASE_KEY, expiresAt);
    const normalizedUserId = normalizeSessionUserId(userId) ?? readOfflineLeaseUserId() ?? readPersistedOfflineUserId();
    if (normalizedUserId) window.localStorage.setItem(OFFLINE_LEASE_USER_KEY, normalizedUserId);
  } catch {
    // Browsers can disallow local storage while still accepting HttpOnly
    // sessions. Such a browser can work online but cannot establish a lease.
    removeOfflineLease();
  }
}

export function hasCurrentOfflineLease(now = Date.now()): boolean {
  const value = readLocalStorage(OFFLINE_LEASE_KEY);
  return hasSessionPresenceMarker()
    && value !== null
    && Number.isFinite(Date.parse(value))
    && Date.parse(value) > now
    && readOfflineLeaseUserId() !== null
    && !lockedOfflineUsers().includes(readOfflineLeaseUserId()!);
}

export function readOfflineLeaseUserId(): string | null {
  const stored = normalizeSessionUserId(readLocalStorage(OFFLINE_LEASE_USER_KEY));
  if (stored) return stored;
  // Upgrade compatibility for a trusted-device lease created by the previous
  // single-owner release. Online verification promotes this logical identity
  // to the migrated User UUID before any other account can use the browser.
  const legacyExpiry = readLocalStorage(OFFLINE_LEASE_KEY);
  return legacyExpiry && Number.isFinite(Date.parse(legacyExpiry)) ? "local:default" : null;
}

export function offlineLeaseExpiresAt(): number {
  return Date.parse(readLocalStorage(OFFLINE_LEASE_KEY) ?? "");
}

export async function activateOfflineLeaseContext(signal?: AbortSignal): Promise<OfflineStorageContext> {
  const userId = readOfflineLeaseUserId();
  if (!userId || !hasCurrentOfflineLease()) throw new Error("Offline identity lease is unavailable.");
  const context = await activateProtectedOfflineData(userId, { signal });
  signal?.throwIfAborted();
  if (!hasCurrentOfflineLease() || readOfflineLeaseUserId() !== userId) {
    lockBrowserAuthenticationState();
    throw new Error("Offline identity lease expired.");
  }
  authorizeOfflineAccess(userId, offlineLeaseExpiresAt(), () => hasCurrentOfflineLease() && readOfflineLeaseUserId() === userId);
  return context;
}

export function getCurrentOfflineRuntimeUserId(): string | null {
  return getActiveOfflineStorageContext().userId;
}

function hasSessionPresenceMarker(): boolean {
  return document.cookie.split(";").some((item) => item.trim() === `${SESSION_PRESENCE_COOKIE}=1`);
}

let clearingAuthentication: Promise<void> | null = null;

export function lockBrowserAuthenticationState(notify = true): void {
  const storedUserId = readOfflineLeaseUserId();
  const userId = getActiveOfflineStorageContext().userId ?? storedUserId ?? readPersistedOfflineUserId();
  if (userId) writeLockedOfflineUsers([...new Set([...lockedOfflineUsers(), userId])]);
  // Another tab may already have verified B while this tab still holds A.
  // Lock A's runtime without erasing B's newly established shared lease.
  if (!storedUserId || storedUserId === userId) {
    removeOfflineLease();
    document.cookie = `${SESSION_PRESENCE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
  lockProtectedOfflineData(notify);
  resetOfflineSearch();
}

export function suspendBrowserOfflineContext(): void {
  lockProtectedOfflineData(false);
  resetOfflineSearch();
}

export function clearBrowserAuthenticationState(): Promise<void> {
  if (clearingAuthentication) return clearingAuthentication;
  const offlineUserId = getActiveOfflineStorageContext().userId ?? readOfflineLeaseUserId() ?? readPersistedOfflineUserId();
  // Capture before locking: storage may be unavailable and the verified runtime
  // context can be the only remaining account binding.
  const captured = captureProtectedOfflineStorageContext(offlineUserId);
  // The initiating UI owns navigation after explicit signout. Broadcasting the
  // local expiry event here navigates before cleanup and dirty-form settlement.
  // Shared lease removal still locks other tabs immediately.
  lockBrowserAuthenticationState(false);
  // Revocation and navigation cannot depend on a functioning cache subsystem.
  // Each cleanup still runs if another storage API is unavailable.
  clearingAuthentication = (async () => {
    const context = await captured;
    if (!context.userId) return;
    rememberSignoutCleanup(context);
    // Failed or blocked deletes retain a durable recovery marker. The login
    // surface displays it and the same account cannot reopen data underneath
    // a deletion that may still finish later.
    await retrySignoutCleanup(context.userId);
  })();
  clearingAuthentication = clearingAuthentication.finally(() => { clearingAuthentication = null; });
  return clearingAuthentication;
}

export async function bindAuthenticatedOfflineContext(session: AuthSessionState, signal?: AbortSignal): Promise<OfflineStorageContext> {
  if (!session.authenticated || !session.user_id && !session.principal_id) throw new AuthRequestError("Authentication required.", 401);
  const userId = resolveSessionUserId(session);
  if (pendingSignoutCleanups().some((context) => context.userId === userId)) {
    if (!await retrySignoutCleanup(userId)) throw new SignoutCleanupPendingError();
    signal?.throwIfAborted();
  }
  try {
    const priorUser = readPersistedOfflineUserId();
    if (priorUser && !localStorage.getItem("chat-reader:legacy-preferences-owner-v1")) localStorage.setItem("chat-reader:legacy-preferences-owner-v1", priorUser);
  } catch { /* Unbound legacy preferences are not automatically uploaded. */ }
  const context = await activateProtectedOfflineData(userId, {
    openDatabase: false,
    claimLegacy: session.principal_id === "owner",
    signal,
  });
  signal?.throwIfAborted();
  try {
    await persistOfflineShellIdentity(context, signal);
  } catch {
    signal?.throwIfAborted();
    // Authentication must not be reported as failed after the server has
    // already created a valid session. If Cache Storage cannot persist the
    // identity pointer, remove the scoped worker so it cannot serve a previous
    // account's offline shell; online use may continue and registration can be
    // retried later.
    await disableOfflineShellAfterIdentityFailure();
  }
  signal?.throwIfAborted();
  writeLockedOfflineUsers(lockedOfflineUsers().filter((id) => id !== userId));
  rememberOfflineLease(session.inactivity_expires_at, userId);
  const expiresAt = Date.parse(session.inactivity_expires_at ?? "");
  authorizeOfflineAccess(userId, expiresAt, () => {
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    const storedUser = readOfflineLeaseUserId();
    // Online authentication can work when localStorage is unavailable. Offline
    // reads always require the persisted, account-bound server lease.
    return navigator.onLine ? (!storedUser || storedUser === userId) : hasCurrentOfflineLease() && storedUser === userId;
  });
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
  // Normalize dot segments before checking capability/auth routes, including
  // paths such as /recent/../share/token. Never put API capabilities in a URL.
  const normalized = new URL(decoded, "https://chat-reader.invalid");
  if (/^\/(?:share|shared|api)(?:\/|$)/i.test(normalized.pathname)) return "/";
  if (/^\/(?:login|register|account-upgrade|password-reset|reset-password)(?:\/|$)/i.test(normalized.pathname)) return "/";
  return pathname;
}

export function loginLocation(pathname: string): string {
  const returnTo = safeReturnPath(pathname);
  return returnTo === "/" ? "/login" : `/login?return_to=${encodeURIComponent(returnTo)}`;
}

async function authMutation<T>(path: string, body: unknown): Promise<T> {
  return authRequest<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
  try {
    const response = await fetch(path, {
      ...init,
      signal,
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...init.headers },
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
    return await response.json() as T;
  } finally {
    window.clearTimeout(timer);
  }
}

function readLocalStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function removeOfflineLease(): void {
  for (const key of [OFFLINE_LEASE_KEY, OFFLINE_LEASE_USER_KEY]) {
    try { window.localStorage.removeItem(key); } catch { /* Storage is unavailable. */ }
  }
}

function resolveSessionUserId(session: AuthSessionState): string {
  if (session.auth_mode === "multi_account" && !session.user_id?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    throw new AuthRequestError("The server did not verify an account UUID.", 502);
  }
  return normalizeSessionUserId(session.user_id)
    ?? normalizeSessionUserId(session.principal_id)
    ?? "local:default";
}

function lockedOfflineUsers(): string[] {
  try {
    const value: unknown = JSON.parse(readLocalStorage(OFFLINE_LOCKED_USERS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

function writeLockedOfflineUsers(users: string[]): void {
  try { window.localStorage.setItem(OFFLINE_LOCKED_USERS_KEY, JSON.stringify(users)); } catch { /* No persisted lease can be used without storage. */ }
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
