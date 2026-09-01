import { AUTH_UNAUTHORIZED_EVENT, type AuthSessionState, type RegistrationMode } from "./auth-client";

export type DeviceSession = {
  id: string;
  device_label: string;
  created_at: string;
  last_activity_at: string;
  current: boolean;
};

export type AccessOverview = {
  registration_mode: RegistrationMode;
  smtp_configured: boolean;
};

export type AccessUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: "ADMIN" | "USER";
  status: "ACTIVE" | "DISABLED";
  created_at: string;
};

export type AccessInvitation = {
  id: string;
  status: "PENDING" | "USED" | "EXPIRED" | "REVOKED";
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export type OneTimeLink = {
  expires_at: string;
  invite_url?: string;
  reset_url?: string;
};

export async function getAccountProfile(): Promise<AuthSessionState> {
  return request<AuthSessionState>("/api/auth/me");
}

export async function updateAccountProfile(displayName: string): Promise<AuthSessionState> {
  return request<AuthSessionState>("/api/auth/me", json("PATCH", { display_name: displayName.trim() || null }));
}

export async function getDeviceSessions(): Promise<DeviceSession[]> {
  return request<DeviceSession[]>("/api/auth/sessions");
}

export async function logoutOtherDeviceSessions(): Promise<void> {
  await request<void>("/api/auth/sessions/logout-others", { method: "POST" });
}

export async function getAccessOverview(): Promise<AccessOverview> {
  return request<AccessOverview>("/api/admin/access");
}

export async function getAccessUsers(): Promise<AccessUser[]> {
  return request<AccessUser[]>("/api/admin/access/users");
}

export async function setRegistrationMode(mode: RegistrationMode): Promise<{ registration_mode: RegistrationMode; updated_at: string }> {
  return request("/api/admin/access/registration", json("PUT", { mode }));
}

export async function updateAccessUserStatus(userId: string, status: "ACTIVE" | "DISABLED"): Promise<{ id: string; status: "ACTIVE" | "DISABLED" }> {
  return request(`/api/admin/access/users/${encodeURIComponent(userId)}/status`, json("PATCH", { status }));
}

export async function createAccessInvitation(expiresInHours: number): Promise<OneTimeLink & { id: string; token: string }> {
  return request("/api/admin/access/invitations", json("POST", { expires_in_hours: expiresInHours }));
}

export async function getAccessInvitations(): Promise<AccessInvitation[]> {
  return request<AccessInvitation[]>("/api/admin/access/invitations");
}

export async function revokeAccessInvitation(invitationId: string): Promise<void> {
  await request<void>(`/api/admin/access/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" });
}

export async function createUserPasswordReset(userId: string, expiresInMinutes = 30): Promise<OneTimeLink> {
  return request(`/api/admin/access/users/${encodeURIComponent(userId)}/password-reset`, json("POST", { expires_in_minutes: expiresInMinutes }));
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch {
    throw new Error("CONNECTION_FAILED");
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    }
    let message = `Request returned ${response.status}`;
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === "string") message = payload.detail;
    } catch {
      // Keep the bounded fallback for non-JSON proxy failures.
    }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
