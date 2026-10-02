"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, type RegistrationPolicy } from "../lib/admin-client";
import { AdminInvitationsPanel } from "./admin-invitations-panel";
import { usePreferences } from "./preferences-provider";

export function AdminRegistrationSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [saved, setSaved] = useState<RegistrationPolicy | null>(null);
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [invitationDirty, setInvitationDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(saved) !== JSON.stringify(policy);
  useEffect(() => { onDirtyChange?.(dirty || invitationDirty); }, [dirty, invitationDirty, onDirtyChange]);

  const load = useCallback(async () => {
    setBusy("load"); setError("");
    try {
      const nextPolicy = await adminApi.registration();
      setSaved(nextPolicy); setPolicy(nextPolicy);
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
    <AdminInvitationsPanel onDirtyChange={setInvitationDirty} />
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
  </section>;
}
