"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, type AdminInvitation, type RegistrationPolicy } from "../lib/admin-client";
import { revokeAccessInvitation } from "../lib/account-access-client";
import { usePreferences } from "./preferences-provider";

export function AdminRegistrationSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [saved, setSaved] = useState<RegistrationPolicy | null>(null);
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [hours, setHours] = useState(168);
  const [link, setLink] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(saved) !== JSON.stringify(policy);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    setBusy("load"); setError("");
    try {
      const [nextPolicy, nextInvitations] = await Promise.all([adminApi.registration(), adminApi.invitations()]);
      setSaved(nextPolicy); setPolicy(nextPolicy); setInvitations(nextInvitations);
    } catch { setError(zh ? "无法读取注册设置，请重试。" : "Unable to load registration settings. Retry."); }
    finally { setBusy(""); }
  }, [zh]);
  useEffect(() => { void load(); }, [load]);
  const action = async (key: string, work: () => Promise<void>) => {
    setBusy(key); setError(""); setNotice("");
    try { await work(); }
    catch { setError(zh ? "操作失败，输入已保留，请重试。" : "The action failed. Your input is preserved; retry."); }
    finally { setBusy(""); }
  };

  if (!policy) return <div className="space-y-3" aria-busy={busy === "load"}>{error ? <><p role="alert" className="text-sm text-[var(--danger)]">{error}</p><button type="button" onClick={() => void load()} className="btn-secondary min-h-11 px-4">{zh ? "重试" : "Retry"}</button></> : <p role="status" className="text-sm text-secondary">{zh ? "正在读取注册设置…" : "Loading registration settings…"}</p>}</div>;
  return <section className="space-y-5" aria-label={zh ? "注册与邀请" : "Registration & invitations"}>
    <fieldset disabled={Boolean(busy)} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold text-primary">{zh ? "注册策略" : "Registration policy"}</legend>
      <div className="grid grid-cols-3 rounded-lg bg-subtle p-1">{(["CLOSED", "INVITE_ONLY", "OPEN"] as const).map((mode, i) => <button key={mode} type="button" aria-pressed={policy.registration_mode === mode} onClick={() => { setNotice(""); setPolicy({ ...policy, registration_mode: mode }); }} className={`min-h-11 rounded-md px-2 text-sm ${policy.registration_mode === mode ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary"}`}>{(zh ? ["关闭", "仅邀请", "开放"] : ["Closed", "Invite only", "Open"])[i]}</button>)}</div>
      {(["require_admin_approval", "email_verification_enabled", "password_reset_enabled"] as const).map((key, i) => <label key={key} className="flex min-h-11 items-center gap-3 text-sm text-primary"><input type="checkbox" checked={policy[key]} disabled={key === "email_verification_enabled" && !policy.smtp_configured && !policy.email_verification_enabled} onChange={(e) => { setNotice(""); setPolicy({ ...policy, [key]: e.target.checked }); }} />{(zh ? ["新账户需要管理员审批", "新账户需要验证邮箱", "允许自助密码找回"] : ["Require approval for new accounts", "Require email verification for new accounts", "Allow self-service password reset"])[i]}</label>)}
      <p className="text-sm leading-relaxed text-secondary">{policy.smtp_configured ? (zh ? "邮件服务已配置。验证和审批分别生效，不影响已有可用账户。" : "Email delivery is configured. Verification and approval are independent; existing active accounts are unaffected.") : (zh ? "邮件服务未配置，无法要求邮箱验证。管理员仍可为用户生成一次性密码重置链接。" : "Email delivery is not configured. Verification cannot be enabled; administrators can still issue one-time password reset links.")}</p>
      <button type="button" disabled={!dirty || Boolean(busy) || (policy.email_verification_enabled && !policy.smtp_configured)} onClick={() => void action("save", async () => { const next = await adminApi.saveRegistration(policy); setSaved(next); setPolicy(next); setNotice(zh ? "注册策略已保存。" : "Registration policy saved."); })} className="btn-primary min-h-11 px-4 text-sm">{busy === "save" ? (zh ? "正在保存…" : "Saving…") : (zh ? "保存注册策略" : "Save registration policy")}</button>
    </fieldset>
    <section className="space-y-3 border-t border-ui pt-4" aria-label={zh ? "邀请" : "Invitations"}>
      <h3 className="text-sm font-semibold text-primary">{zh ? "邀请" : "Invitations"}</h3>
      <label className="block text-sm text-secondary" htmlFor="invitation-hours">{zh ? "有效期（小时，1–2160）" : "Valid for (hours, 1–2160)"}</label>
      <div className="flex flex-wrap gap-2"><input id="invitation-hours" type="number" min={1} max={2160} value={hours} disabled={Boolean(busy)} onChange={(e) => setHours(Number(e.target.value))} className="input-base min-h-11 w-28 px-3 text-base" /><button type="button" disabled={Boolean(busy) || !Number.isInteger(hours) || hours < 1 || hours > 2160} onClick={() => void action("invite", async () => { const next = await adminApi.createInvitation(hours); setLink(next.invite_url); setInvitations(await adminApi.invitations()); setPage(0); })} className="btn-secondary min-h-11 px-4 text-sm">{zh ? "创建邀请" : "Create invitation"}</button></div>
      {link ? <div className="space-y-2"><label htmlFor="new-invitation" className="block text-sm text-secondary">{zh ? "新邀请链接（仅显示此次，关闭前请复制）" : "New invitation link (shown only now; copy before closing)"}</label><div className="flex gap-2"><input id="new-invitation" readOnly value={link} className="input-base min-h-11 min-w-0 flex-1 px-3 text-base" /><button type="button" disabled={Boolean(busy)} onClick={() => void action("copy", async () => { await navigator.clipboard.writeText(link); setNotice(zh ? "已复制邀请链接。" : "Invitation link copied."); })} className="btn-secondary min-h-11 px-3 text-sm">{zh ? "复制" : "Copy"}</button></div></div> : null}
      {!invitations.length ? <p className="text-sm text-secondary">{zh ? "还没有邀请，可创建链接邀请新用户。" : "No invitations yet. Create a link to invite a new user."}</p> : <ul className="divide-y divide-[var(--border)]">{invitations.slice(page * 10, (page + 1) * 10).map((invitation) => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="text-sm"><p className="text-primary">{({ PENDING: zh ? "待使用" : "Pending", USED: zh ? "已使用" : "Used", EXPIRED: zh ? "已过期" : "Expired", REVOKED: zh ? "已撤销" : "Revoked" })[invitation.status]}</p><p className="mt-1 text-secondary">{zh ? "到期：" : "Expires: "}{new Date(invitation.expires_at).toLocaleString(resolvedLocale)}</p></div>{invitation.status === "PENDING" ? <button type="button" disabled={Boolean(busy)} onClick={() => void action(invitation.id, async () => { await revokeAccessInvitation(invitation.id); setInvitations(await adminApi.invitations()); setNotice(zh ? "邀请已撤销。" : "Invitation revoked."); })} className="btn-secondary min-h-11 px-3 text-sm">{zh ? "撤销" : "Revoke"}</button> : null}</li>)}</ul>}
      {invitations.length > 10 ? <nav className="flex items-center justify-between gap-2" aria-label={zh ? "邀请分页" : "Invitation pages"}><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="btn-secondary min-h-11 px-3">{zh ? "上一页" : "Previous"}</button><span className="text-sm text-secondary">{page + 1} / {Math.ceil(invitations.length / 10)}</span><button type="button" disabled={(page + 1) * 10 >= invitations.length} onClick={() => setPage(page + 1)} className="btn-secondary min-h-11 px-3">{zh ? "下一页" : "Next"}</button></nav> : null}
    </section>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
  </section>;
}
