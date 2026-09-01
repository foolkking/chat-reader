import { AUTH_UNAUTHORIZED_EVENT } from "./auth-client";
import type { ReaderTurnResponse } from "./types";

export type AdminUserStatus = "ACTIVE" | "DISABLED" | "PENDING";
export type AdminUser = {
  id: string; email: string; display_name: string | null; role: "ADMIN" | "USER"; status: AdminUserStatus;
  created_at: string; last_login_at: string | null; email_verified_at: string | null;
  stats: { projects: number; conversations: number; attachments: number; attachment_bytes: number };
};
export type RegistrationPolicy = { registration_mode: "CLOSED" | "INVITE_ONLY" | "OPEN"; require_admin_approval: boolean; email_verification_enabled: boolean; password_reset_enabled: boolean; smtp_configured: boolean };
export type AdminInvitation = { id: string; status: "PENDING" | "USED" | "EXPIRED" | "REVOKED"; created_at: string; expires_at: string; used_at: string | null };
export type UserConversation = { id: string; title: string; status: string; message_count: number; turn_count: number; summary: string; created_at: string; updated_at: string };
export type UserAttachment = { id: string; display_name: string; detected_mime_type: string | null; asset_object: { byte_size: number } | null; content_url: string | null; download_url: string | null };
export type Page<T> = { items: T[]; total: number; limit: number; offset: number };
export type SystemSkill = { id: string; skill_key: string; category: "EXPORT_CONTEXT" | "CONVERSATION_RESCUE"; locale: "zh-CN" | "en"; name: string; source_kind: "BUNDLED" | "ADMIN_CREATED"; status: "ACTIVE" | "DISABLED"; default_enabled: boolean; is_customized: boolean; byte_size: number; builtin_content_url: string | null; updated_at: string };
export type FeaturePolicy = { allow_share_links: boolean; allow_public_share: boolean; allow_share_password: boolean; allow_user_skills: boolean; allow_skill_import: boolean; allow_user_import: boolean; maximum_import_size_mb: number; updated_at: string };
export type BackgroundTask = { job_id: string; job_type: string; status: string; phase: string; progress: number };
export type BackupRecord = { id: string; operation: "BACKUP" | "RESTORE"; status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; artifact_name: string | null; byte_size: number | null; summary: Record<string, unknown>; created_at: string; completed_at: string | null };
export type AuditEntry = { id: string; actor_user_id: string; action: string; target_user_id: string | null; resource_type: string | null; resource_id: string | null; result: string; metadata: Record<string, unknown>; request_id: string | null; created_at: string };
export type ContentResult = { conversation_id: string; user_id: string; user_email: string; user_display_name: string | null; title: string; status: string; message_count: number; snippet: string; created_at: string; updated_at: string };

export const adminApi = {
  users: () => request<AdminUser[]>("/api/admin/access/users"),
  setUserStatus: (id: string, status: "ACTIVE" | "DISABLED") => request<{ id: string; status: AdminUserStatus }>(`/api/admin/access/users/${id}/status`, json("PATCH", { status })),
  approveUser: (id: string) => request<{ id: string; status: AdminUserStatus }>(`/api/admin/access/users/${id}/approve`, { method: "POST" }),
  rejectUser: (id: string) => request<{ id: string; status: AdminUserStatus }>(`/api/admin/access/users/${id}/reject`, { method: "POST" }),
  revokeSessions: (id: string) => request<{ id: string; revoked_sessions: number }>(`/api/admin/access/users/${id}/sessions/revoke`, { method: "POST" }),
  resetUser: (id: string) => request<{ reset_url: string; expires_at: string }>(`/api/admin/access/users/${id}/password-reset`, json("POST", { expires_in_minutes: 30 })),
  deleteImpact: (id: string) => request<Record<string, number | string>>(`/api/admin/access/users/${id}/deletion-impact`),
  deleteUser: (id: string) => request<BackgroundTask>(`/api/admin/access/users/${id}/delete`, json("POST", { confirm_user_id: id }, { "Idempotency-Key": crypto.randomUUID() })),
  userConversations: (id: string, q = "") => request<Page<UserConversation>>(`/api/admin/content/users/${id}/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  readUserConversation: (userId: string, conversationId: string) => request<ReaderTurnResponse>(`/api/admin/content/users/${userId}/conversations/${conversationId}/reader-turn`),
  userAttachments: (id: string, q = "") => request<Page<UserAttachment>>(`/api/admin/content/users/${id}/attachments${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  registration: () => request<RegistrationPolicy>("/api/admin/access"),
  saveRegistration: (value: Omit<RegistrationPolicy, "smtp_configured">) => request<RegistrationPolicy>("/api/admin/access/registration", json("PUT", { mode: value.registration_mode, ...value })),
  invitations: () => request<AdminInvitation[]>("/api/admin/access/invitations"),
  createInvitation: (hours: number) => request<{ id: string; invite_url: string; expires_at: string }>("/api/admin/access/invitations", json("POST", { expires_in_hours: hours })),
  revokeInvitation: (id: string) => request<void>(`/api/admin/access/invitations/${id}`, { method: "DELETE" }),
  systemSkills: () => request<SystemSkill[]>("/api/admin/system-skills"),
  systemSkill: (id: string) => request<SystemSkill & { content: string | null }>(`/api/admin/system-skills/${id}`),
  createSystemSkill: (value: { category: string; locale: string; name: string; content: string; default_enabled: boolean }) => request<SystemSkill>("/api/admin/system-skills", json("POST", value)),
  updateSystemSkill: (id: string, value: Record<string, unknown>) => request<SystemSkill>(`/api/admin/system-skills/${id}`, json("PATCH", value)),
  deleteSystemSkill: (id: string) => request<void>(`/api/admin/system-skills/${id}`, { method: "DELETE" }),
  restoreSystemSkill: (id: string) => request<SystemSkill>(`/api/admin/system-skills/${id}/restore`, { method: "POST" }),
  features: () => request<FeaturePolicy>("/api/admin/features"),
  saveFeatures: (value: Omit<FeaturePolicy, "updated_at">) => request<FeaturePolicy>("/api/admin/features", json("PUT", value)),
  backups: () => request<BackupRecord[]>("/api/admin/backups"),
  createBackup: () => request<BackgroundTask>("/api/admin/backups", json("POST", { include_archived: true }, { "Idempotency-Key": crypto.randomUUID() })),
  restoreBackup: (id: string) => request<BackupRecord>(`/api/admin/backups/${id}/restore`, { method: "POST" }),
  audit: (action = "") => request<AuditEntry[]>(`/api/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`),
  contentSearch: (q: string) => request<Page<ContentResult>>(`/api/admin/content/search?q=${encodeURIComponent(q)}`),
};

function json(method: string, body: unknown, extraHeaders: Record<string, string> = {}): RequestInit {
  return { method, headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json", ...init.headers } });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    let message = `Request returned ${response.status}`;
    try { const payload = await response.json() as { detail?: unknown }; if (typeof payload.detail === "string") message = payload.detail; } catch { /* bounded fallback */ }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
