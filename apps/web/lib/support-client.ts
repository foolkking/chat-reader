import { assertOfflineAccess, captureOfflineAccess, notifyAuthenticationFailure } from "./offline-access";

export type SupportKind = "LIMIT" | "QUESTION" | "ISSUE";
export type SupportStatus = "OPEN" | "WAITING" | "APPROVED" | "REJECTED" | "RESOLVED" | "WITHDRAWN" | "IMPORTED";
export type SupportLimits = { import_size_mb?: number | null; merge_message_count?: number | null };
export type SupportLimitState = { revision: number; approved: SupportLimits; effective: Required<SupportLimits>; hard_bounds: Required<SupportLimits> };
export type SupportRequest = { id: string; kind: SupportKind; title: string; status: SupportStatus; revision: number; requested_limits: SupportLimits; approved_limits: SupportLimits; notify_replies: boolean; created_at: string; updated_at: string };
export type SupportMessage = { id: string; author_role: "ADMIN" | "USER"; operation: string; body: string; mail_state: string; notification_attempts: number; created_at: string; can_retry_mail?: boolean };
export type SupportDetail = SupportRequest & { limits: SupportLimitState; mail_available: boolean; messages: SupportMessage[]; message_total: number; message_offset: number; owner?: { id: string; name: string; email: string } };
export type SupportPage = { items: SupportRequest[]; total: number; offset: number; limit: number };
export type SupportAction = "REPLY" | "APPROVE" | "REJECT" | "RESOLVE" | "REQUEST_INFO" | "WITHDRAW";
export type SupportFlight = { key: string; path: string; method: "POST" | "PUT"; payload: Record<string, unknown> };

export class SupportError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export async function supportFetch<T>(path: string, flight?: SupportFlight, signal?: AbortSignal): Promise<T> {
  const access = captureOfflineAccess();
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const response = await fetch(path, { method: flight?.method ?? "GET", credentials: "same-origin", cache: "no-store", signal: boundedSignal,
    ...(flight ? { headers: { "Content-Type": "application/json", "Idempotency-Key": flight.key }, body: JSON.stringify(flight.payload) } : {}) });
  if (response.status === 401) notifyAuthenticationFailure(access);
  assertOfflineAccess(access);
  const result = await response.json().catch(() => null);
  assertOfflineAccess(access);
  if (!response.ok) throw new SupportError(typeof result?.detail?.code === "string" ? result.detail.code : "REQUEST_FAILED", response.status);
  if (!result || typeof result !== "object") throw new SupportError("INVALID_RESPONSE", 502);
  return result as T;
}

export const supportInbox = (admin: boolean) => admin ? "/api/admin/requests" : "/api/me/requests";
export function supportErrorText(error: unknown, zh: boolean): string {
  const code = error instanceof SupportError ? error.code : "NETWORK";
  const texts: Record<string, [string, string]> = {
    REQUEST_CHANGED: ["请求有新回复。刷新并查看后，再提交保留的输入。", "This request has changed. Refresh and review it before resubmitting your retained input."],
    LIMIT_CHANGED: ["限额已被修改。请重新读取后再决定。", "Limits changed. Reload them before deciding."],
    REQUEST_CLOSED: ["此请求已结束，不能继续回复。输入已保留。", "This request is closed. Your input is retained."],
    REQUEST_NOT_FOUND: ["请求不存在，或当前账户无权查看。", "This request is unavailable to this account."],
    LIMIT_REQUEST_ALREADY_OPEN: ["已有待处理的限额申请，请在“我的请求”中补充说明。", "A limit request is already open. Add details in My requests."],
    TOO_MANY_OPEN_REQUESTS: ["待处理请求已达上限，请先处理已有请求。", "Too many open requests. Review your existing requests first."],
    REQUEST_RATE_LIMIT: ["提交过于频繁，请稍后重试。输入已保留。", "Too many submissions. Retry later; your input is retained."],
    REQUEST_MUST_INCREASE_LIMIT: ["申请值需要高于当前生效的限制。", "Request a value above your current effective limit."],
    LIMIT_EXCEEDS_DEPLOYMENT: ["申请超出当前服务器支持的范围，请调整数值。", "This exceeds the server limit. Adjust the requested value."],
    IDEMPOTENCY_CONFLICT: ["此提交记录与服务器不一致，请先查看请求列表确认结果。", "This submission differs from the server record. Check the request list before continuing."],
    MAIL_RETRY_NOT_ALLOWED: ["此邮件不能重试。请刷新查看最新状态。", "This notification cannot be retried. Refresh its status."],
    MAIL_RETRY_LIMIT: ["邮件重试次数已达上限，站内请求仍然保留。", "Email retry limit reached. The request remains in the inbox."],
    MAIL_UNAVAILABLE: ["邮件服务不可用，站内请求仍然保留。", "Email is unavailable. The request remains in the inbox."],
  };
  return texts[code]?.[zh ? 0 : 1] ?? (zh ? "未能确认操作结果。输入已保留，可重试同一次提交。" : "Could not confirm the result. Your input is retained; retry this submission.");
}

export function supportStatusText(status: string, zh: boolean) {
  const labels: Record<string, [string, string]> = { OPEN: ["待处理", "Open"], WAITING: ["待补充", "Needs information"], APPROVED: ["已批准", "Approved"], REJECTED: ["未批准", "Declined"], RESOLVED: ["已解决", "Resolved"], WITHDRAWN: ["已撤回", "Withdrawn"], IMPORTED: ["历史记录", "Imported history"] };
  return labels[status]?.[zh ? 0 : 1] ?? status;
}

export function supportKindText(kind: SupportKind, zh: boolean) {
  return { LIMIT: zh ? "限额申请" : "Limit request", QUESTION: zh ? "使用求助" : "Help", ISSUE: zh ? "问题反馈" : "Issue" }[kind];
}
