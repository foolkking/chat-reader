"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { adminApi, AdminRequestError, type RegistrationPolicy, type RegistrationPolicyPatch } from "../lib/admin-client";
import { authenticationGeneration } from "../lib/offline-access";
import { AdminInvitationsPanel } from "./admin-invitations-panel";
import { usePreferences } from "./preferences-provider";

const labels = [
  ["registration_mode", "注册方式", "Registration mode"],
  ["require_admin_approval", "新账户需要管理员审批", "Require approval for new accounts"],
  ["email_verification_enabled", "新账户需要验证邮箱", "Require email verification for new accounts"],
  ["password_reset_enabled", "允许自助密码找回", "Allow self-service password reset"],
] as const;
function changedPolicy(value: RegistrationPolicy | null, base: RegistrationPolicy | null): RegistrationPolicyPatch {
  if (!value || !base) return {};
  return Object.fromEntries(labels.filter(([key]) => value[key] !== base[key]).map(([key]) => [key, value[key]]));
}

export function AdminRegistrationSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [saved, setSaved] = useState<RegistrationPolicy | null>(null);
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [invitationDirty, setInvitationDirty] = useState(false);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<"load" | "conflict" | "unknown" | "read" | "invalid" | "mail" | "access" | null>(null);
  const [notice, setNotice] = useState<"saved" | "matches" | "server" | "">("");
  const [recovery, setRecovery] = useState<"review" | "check" | null>(null);
  const [comparison, setComparison] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true), generation = useRef(authenticationGeneration());
  const feedback = useRef<HTMLDivElement>(null);
  const active = useCallback(() => mounted.current && generation.current === authenticationGeneration(), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const patch = changedPolicy(policy, saved);
  const dirty = Object.keys(patch).length > 0;
  const valid = !(patch.email_verification_enabled === true && !policy?.smtp_configured);
  useLayoutEffect(() => { onDirtyChange?.(dirty || invitationDirty); }, [dirty, invitationDirty, onDirtyChange]);
  useLayoutEffect(() => { if (error || comparison.length || notice) feedback.current?.focus(); }, [error, comparison, notice]);

  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy("read"); setError(null);
    try {
      const next = await adminApi.registration(controller.signal);
      if (active() && !controller.signal.aborted) { setSaved(next); setPolicy(next); }
    } catch { if (active() && !controller.signal.aborted) setError("load"); }
    finally { if (active() && request.current === controller) { request.current = null; setBusy(null); } }
  }, [active]);
  useEffect(() => { void load(); }, [load]);
  const clearDenied = () => { setPolicy(null); setSaved(null); setRecovery(null); setComparison([]); setError("access"); };
  const readLatest = async () => {
    if (request.current || !recovery || !policy || !saved) return;
    const controller = new AbortController(); request.current = controller;
    setBusy("read"); setError(null);
    try {
      const next = await adminApi.registration(controller.signal);
      if (!active() || controller.signal.aborted) return;
      const matches = Object.entries(patch).every(([key, value]) => next[key as keyof RegistrationPolicyPatch] === value);
      setComparison(matches ? [] : labels.filter(([key]) => key in patch || saved[key] !== next[key]).map(([key]) => key));
      setSaved(next); setPolicy(matches ? next : { ...next, ...patch });
      setRecovery(null); setNotice(matches ? "matches" : "");
    } catch (cause) {
      if (!active() || controller.signal.aborted) return;
      if (cause instanceof AdminRequestError && [401, 403, 404].includes(cause.status)) clearDenied();
      else setError("read");
    } finally { if (active() && request.current === controller) { request.current = null; setBusy(null); } }
  };
  const save = async () => {
    if (!policy || !saved || !dirty || !valid || recovery || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy("save"); setError(null); setNotice(""); setComparison([]);
    try {
      const next = await adminApi.saveRegistration({ ...patch, base_revision: saved.revision }, controller.signal);
      if (!active() || controller.signal.aborted) return;
      setSaved(next); setPolicy(next); setNotice("saved");
    } catch (cause) {
      if (!active() || controller.signal.aborted) return;
      if (cause instanceof AdminRequestError && cause.status === 409) { setRecovery("review"); setError("conflict"); }
      else if (cause instanceof AdminRequestError && [401, 403, 404].includes(cause.status)) clearDenied();
      else if (cause instanceof AdminRequestError && cause.status === 422) {
        setError(cause.message.includes("SMTP") ? "mail" : "invalid"); setRecovery("review");
      } else { setError("unknown"); setRecovery("check"); }
    } finally { if (active() && request.current === controller) { request.current = null; setBusy(null); } }
  };
  const errorCopy = {
    load: zh ? "无法读取注册设置，请重试。" : "Unable to load registration settings. Retry.",
    conflict: zh ? "注册策略已在其他窗口更改。输入已保留，请读取最新策略后再保存。" : "Registration policy changed in another window. Your input is preserved. Read the latest policy before saving.",
    unknown: zh ? "尚未确认保存结果。输入已保留，请先检查当前注册策略。" : "Save is not confirmed. Your input is preserved. Check the current registration policy first.",
    read: zh ? "读取失败，输入已保留。请重试，尚未再次提交。" : "Read failed. Your input is preserved. Retry; no changes were resubmitted.",
    invalid: zh ? "设置未被接受，请读取最新策略后调整。" : "Settings were not accepted. Read the current policy before adjusting.",
    mail: zh ? "邮件服务未配置，无法启用邮箱验证。请读取最新设置后调整。" : "Email delivery is not configured, so verification cannot be enabled. Read the latest settings before adjusting.",
    access: zh ? "当前账户无法管理注册策略。" : "This account cannot manage registration policy.",
  };
  const display = (value: string | boolean) => typeof value === "boolean" ? (value ? (zh ? "开启" : "On") : (zh ? "关闭" : "Off")) : ({ CLOSED: zh ? "关闭" : "Closed", INVITE_ONLY: zh ? "仅邀请" : "Invite only", OPEN: zh ? "开放" : "Open" }[value] ?? value);
  if (!policy) return <div ref={feedback} tabIndex={-1} className="space-y-3 outline-none" aria-busy={busy === "read"}>{error ? <><p role="alert" className="text-sm text-[var(--danger)]">{errorCopy[error]}</p>{error === "load" ? <button type="button" disabled={Boolean(busy)} onClick={() => void load()} className="btn-secondary min-h-11 px-4">{zh ? "重试" : "Retry"}</button> : null}</> : <p role="status" className="text-sm text-secondary">{zh ? "正在读取注册设置…" : "Loading registration settings…"}</p>}</div>;
  return <section className="space-y-5" aria-label={zh ? "注册与邀请" : "Registration & invitations"}>
    <fieldset disabled={Boolean(busy || recovery)} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold text-primary">{zh ? "注册策略" : "Registration policy"}</legend>
      <div className="grid grid-cols-3 rounded-lg bg-subtle p-1">{(["CLOSED", "INVITE_ONLY", "OPEN"] as const).map((mode, i) => <button key={mode} type="button" aria-pressed={policy.registration_mode === mode} onClick={() => { setNotice(""); setPolicy({ ...policy, registration_mode: mode }); }} className={`min-h-11 rounded-md px-2 text-sm ${policy.registration_mode === mode ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary"}`}>{(zh ? ["关闭", "仅邀请", "开放"] : ["Closed", "Invite only", "Open"])[i]}</button>)}</div>
      {(["require_admin_approval", "email_verification_enabled", "password_reset_enabled"] as const).map((key, i) => <label key={key} className="flex min-h-11 items-center gap-3 text-sm text-primary"><input type="checkbox" checked={policy[key]} disabled={key === "email_verification_enabled" && !policy.smtp_configured && !policy.email_verification_enabled} onChange={(e) => { setNotice(""); setPolicy({ ...policy, [key]: e.target.checked }); }} />{(zh ? ["新账户需要管理员审批", "新账户需要验证邮箱", "允许自助密码找回"] : ["Require approval for new accounts", "Require email verification for new accounts", "Allow self-service password reset"])[i]}</label>)}
      <p className="text-sm leading-relaxed text-secondary">{policy.smtp_configured ? (zh ? "邮件服务已配置。验证和审批分别生效，不影响已有可用账户。" : "Email delivery is configured. Verification and approval are independent; existing active accounts are unaffected.") : (zh ? "邮件服务未配置，无法要求邮箱验证。管理员仍可为用户生成一次性密码重置链接。" : "Email delivery is not configured. Verification cannot be enabled; administrators can still issue one-time password reset links.")}</p>
    </fieldset>
    <div ref={feedback} tabIndex={-1} className="space-y-3 outline-none">
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{errorCopy[error]}</p> : null}
      {recovery ? <button type="button" disabled={Boolean(busy)} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => void readLatest()}>{busy === "read" ? (zh ? "正在读取…" : "Loading…") : recovery === "check" ? (zh ? "检查保存结果" : "Check save result") : (zh ? "读取最新注册策略" : "Read latest registration policy")}</button> : null}
      {comparison.length && saved ? <section aria-label={zh ? "比较注册策略" : "Compare registration policy"} className="space-y-3 border-t border-ui pt-3 text-sm">
        <p>{zh ? "已读取最新策略；仅保留本次修改，确认后再保存。" : "Latest policy loaded. Only your edits are retained; review them before saving."}</p>
        <dl>{labels.filter(([key]) => comparison.includes(key)).map(([key, cn, en]) => <div key={key} className="space-y-1 border-b border-ui py-2">
          <dt className="text-primary">{zh ? cn : en}</dt><dd className="flex flex-wrap gap-x-5 gap-y-1 text-secondary"><span>{zh ? "服务器：" : "Server: "}{display(saved[key])}</span><span>{zh ? "待保存：" : "Pending: "}{display(policy[key])}</span></dd>
        </div>)}</dl>
      </section> : null}
      {notice ? <p role="status" className="text-sm text-primary">{notice === "saved" ? (zh ? "注册策略已保存。" : "Registration policy saved.") : notice === "matches" ? (zh ? "当前注册策略与本次提交一致。" : "Current registration policy matches your submitted changes.") : (zh ? "已使用读取到的服务器策略。" : "Using the server policy you just read.")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!dirty || !valid || Boolean(busy || recovery)} onClick={() => void save()} className="btn-primary min-h-11 px-4 text-sm">{busy === "save" ? (zh ? "正在保存…" : "Saving…") : (zh ? "保存注册策略" : "Save registration policy")}</button>
        {comparison.length && saved ? <button type="button" disabled={Boolean(busy)} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => { setPolicy(saved); setComparison([]); setNotice("server"); setError(null); }}>{zh ? "使用服务器策略" : "Use server policy"}</button> : null}
      </div>
    </div>
    <AdminInvitationsPanel onDirtyChange={setInvitationDirty} />
  </section>;
}
