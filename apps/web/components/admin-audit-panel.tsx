"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { adminApi, type AuditFilters } from "../lib/admin-client";
import { AdminLoadError, AdminPageControls, adminButton } from "./admin-users-panel";
import { usePreferences } from "./preferences-provider";

const empty: AuditFilters = { action: "", actor: "", target: "", result: "ALL", created_after: "", created_before: "" };
const actionNames: Record<string, [string, string]> = {
  USER_DELETE_QUEUED: ["提交账户删除", "Account deletion queued"], USER_DELETED: ["账户已删除", "Account deleted"], USER_DELETE_FAILED: ["账户删除失败", "Account deletion failed"],
  USER_APPROVED: ["批准注册", "Registration approved"], USER_REJECTED: ["拒绝注册", "Registration rejected"], USER_DISABLED: ["禁用账户", "Account disabled"], USER_ENABLED: ["启用账户", "Account enabled"], USER_SESSIONS_REVOKED: ["撤销会话", "Sessions revoked"],
  PASSWORD_RESET_CREATED: ["创建密码重置链接", "Password reset link created"], INVITATION_CREATED: ["创建邀请", "Invitation created"], INVITATION_REVOKED: ["撤销邀请", "Invitation revoked"],
  REGISTRATION_MODE_CHANGED: ["修改注册策略", "Registration policy changed"], GLOBAL_FEATURE_CHANGED: ["修改功能策略", "Feature policy changed"],
  VIEW_USER_CONVERSATION: ["查看用户对话", "User conversation viewed"], VIEW_USER_ATTACHMENT: ["查看用户附件", "User attachment viewed"], DOWNLOAD_USER_ATTACHMENT: ["下载用户附件", "User attachment downloaded"],
};

export function AdminAuditPanel() {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [draft, setDraft] = useState(empty), [filters, setFilters] = useState(empty), [offset, setOffset] = useState(0), [error, setError] = useState("");
  const list = useQuery({ queryKey: ["admin-audit", filters, offset], queryFn: () => adminApi.auditPage(filters, offset), retry: false });
  const choices = useQuery({ queryKey: ["admin-audit-actions"], queryFn: adminApi.auditActions, retry: false });
  function apply() {
    const start = draft.created_after ? new Date(draft.created_after) : null, end = draft.created_before ? new Date(draft.created_before) : null;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime())) || (start && end && start > end)) {
      setError(zh ? "请检查时间范围，结束时间不能早于开始时间。" : "Check the time range. The end must not precede the start."); return;
    }
    setError(""); setOffset(0); setFilters({ ...draft, action: draft.action.trim(), actor: draft.actor.trim(), target: draft.target.trim(), created_after: start?.toISOString() ?? "", created_before: end?.toISOString() ?? "" });
  }
  return <section className="space-y-4" aria-label={zh ? "安全与审计" : "Security & audit"}>
    <header className="flex items-start gap-3"><ShieldCheck aria-hidden className="mt-1 h-5 w-5 shrink-0 text-accent" /><div><h3 className="text-sm font-semibold text-primary">{zh ? "管理员操作记录" : "Administrator activity"}</h3></div></header>
    <form onSubmit={(event) => { event.preventDefault(); apply(); }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-secondary">{zh ? "操作" : "Action"}<input aria-label={zh ? "操作" : "Action"} list="admin-audit-actions" maxLength={64} value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })} placeholder={zh ? "全部操作，或输入操作代码" : "All actions, or enter an action code"} className="input-base mt-1 min-h-11 w-full px-3 text-base" /><datalist id="admin-audit-actions">{choices.data?.map((value) => <option key={value} value={value}>{actionNames[value]?.[zh ? 0 : 1] ?? value}</option>)}</datalist></label>
        <label className="text-xs text-secondary">{zh ? "结果" : "Result"}<select aria-label={zh ? "结果" : "Result"} value={draft.result} onChange={(event) => setDraft({ ...draft, result: event.target.value })} className="input-base mt-1 min-h-11 w-full px-3 text-sm">{[["ALL", "全部", "All"], ["SUCCESS", "成功", "Success"], ["FAILURE", "失败", "Failure"], ["DENIED", "拒绝", "Denied"]].map(([value, cn, en]) => <option key={value} value={value}>{zh ? cn : en}</option>)}</select></label></div>
      <details className="border-y border-ui py-1"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-primary">{zh ? "账户与时间范围" : "Accounts & time range"}<ChevronDown className="h-4 w-4" aria-hidden /></summary><div className="grid gap-3 pb-3 sm:grid-cols-2">
        {(["actor", "target"] as const).map((key) => <label key={key} className="min-w-0 text-xs text-secondary">{key === "actor" ? (zh ? "操作人" : "Actor") : (zh ? "目标账户" : "Target account")}<input maxLength={200} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} placeholder={zh ? "邮箱、名称或完整账户 ID" : "Email, name or full account ID"} className="input-base mt-1 min-h-11 w-full px-3 text-base" /></label>)}
        {(["created_after", "created_before"] as const).map((key) => <label key={key} className="min-w-0 text-xs text-secondary">{key === "created_after" ? (zh ? "开始时间（本机时区）" : "From (local time)") : (zh ? "结束时间（本机时区）" : "To (local time)")}<input type="datetime-local" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} className="input-base mt-1 min-h-11 w-full min-w-0 px-3 text-base" /></label>)}
      </div></details>
      <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary min-h-11 px-4 text-sm" disabled={list.isFetching}>{zh ? "查询记录" : "Find events"}</button><button type="button" className={adminButton} disabled={list.isFetching} onClick={() => { setDraft(empty); setFilters(empty); setOffset(0); setError(""); }}>{zh ? "清除筛选" : "Clear filters"}</button><button type="button" className={adminButton} disabled={list.isFetching} onClick={() => void list.refetch()}>{zh ? "刷新" : "Refresh"}</button></div>
    </form>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}{list.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取记录…" : "Loading events…"}</p> : null}{list.isError ? <AdminLoadError zh={zh} onRetry={() => void list.refetch()} /> : null}
    {list.data && !list.isError ? <><ol className="divide-y divide-[var(--border)] border-t border-ui" aria-label={zh ? "审计记录" : "Audit events"}>{list.data.items.map((item) => <li key={item.id} className="space-y-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-semibold text-primary">{actionNames[item.action]?.[zh ? 0 : 1] ?? item.action.replaceAll("_", " ")}</p><span className={`text-xs ${item.result === "SUCCESS" ? "text-accent" : "text-[var(--danger)]"}`}>{({ SUCCESS: zh ? "成功" : "Success", FAILURE: zh ? "失败" : "Failure", DENIED: zh ? "拒绝" : "Denied" })[item.result] ?? item.result}</span></div>
      <p className="text-xs text-secondary">{new Date(item.created_at).toLocaleString(resolvedLocale)}</p><p className="break-all text-sm text-secondary">{zh ? "操作人：" : "By: "}{item.actor_name || item.actor_email || "Root Admin"}{item.target_user_id ? <> · {zh ? "目标：" : "Target: "}{item.target_name || item.target_email || (zh ? "已删除账户" : "Deleted account")}</> : null}</p>
      <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-secondary">{zh ? "查看记录详情" : "Event details"}</summary><dl className="space-y-2 border-l border-ui pl-3 text-xs">{[[zh ? "操作代码" : "Action code", item.action], [zh ? "目标账户 ID" : "Target account ID", item.target_user_id], [zh ? "资源类型" : "Resource type", item.resource_type], [zh ? "资源 ID" : "Resource ID", item.resource_id]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-secondary">{label}</dt><dd className="mt-1 break-all text-primary">{value}</dd></div>)}</dl></details>
    </li>)}</ol>{!list.data.items.length ? <p className="py-5 text-sm text-secondary">{zh ? "没有符合筛选条件的记录。" : "No events match these filters."}</p> : null}<AdminPageControls offset={offset} total={list.data.total} busy={list.isFetching} onPage={setOffset} zh={zh} /></> : null}
  </section>;
}
