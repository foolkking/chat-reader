/** Runtime fence for protected local work, including requests already in flight. */
export const OFFLINE_ACCESS_LOCKED_EVENT = "chat-reader:offline-access-locked";
export const AUTH_UNAUTHORIZED_EVENT = "chat-reader:auth-unauthorized";

export class OfflineAccessError extends Error {
  constructor() { super("Offline access is locked. Sign in again to continue."); this.name = "OfflineAccessError"; }
}

let required = true;
let generation = 0;
let identity: string | null = null;
let validator: (() => boolean) | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

export function configureOfflineAccess(authenticationRequired: boolean): void {
  if (required !== authenticationRequired) {
    required = authenticationRequired;
    generation += 1;
    identity = null;
    validator = null;
    clearTimeout(expiryTimer);
  }
}

export function authorizeOfflineAccess(userId: string, expiresAt: number, valid: () => boolean): void {
  if (identity !== userId || validator === null) generation += 1;
  identity = userId;
  validator = valid;
  clearTimeout(expiryTimer);
  const schedule = () => {
    if (!required || !Number.isFinite(expiresAt)) return;
    expiryTimer = setTimeout(() => {
      if (validator && !validator()) lockOfflineAccess();
      else if (expiresAt > Date.now()) schedule();
    }, Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647)));
  };
  schedule();
}

export function lockOfflineAccess(notify = true): void {
  const wasAuthorized = identity !== null || validator !== null;
  generation += 1;
  identity = null;
  validator = null;
  clearTimeout(expiryTimer);
  if (notify && wasAuthorized && typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_ACCESS_LOCKED_EVENT));
}

export function captureOfflineAccess(): number {
  if (required && (!identity || !validator || !validator())) {
    if (identity || validator) lockOfflineAccess();
    throw new OfflineAccessError();
  }
  return generation;
}

export function assertOfflineAccess(captured: number): void {
  if (captured !== captureOfflineAccess()) throw new OfflineAccessError();
}

export function offlineAuthenticationRequired(): boolean { return required; }

// Public/initialization requests also need an epoch, without requiring offline
// access. A late 401 from the old account must not invalidate a new identity.
export function authenticationGeneration(): number { return generation; }

export function notifyAuthenticationFailure(requestGeneration: number): void {
  if (generation === requestGeneration && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
}
