"use client";

import { Mail } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { cancelEmailChange, emailChangeError, readEmailChange, requestEmailChange, type EmailChangeState } from "../lib/auth-client";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

export function EmailChangePanel({ onDirtyChange, onRefreshProfile }: { onDirtyChange: (dirty: boolean) => void; onRefreshProfile: () => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const [state, setState] = useState<EmailChangeState | null>(null);
  const [open, setOpen] = useState(false), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const dirty = !!email || !!password || busy;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setState(await readEmailChange()); onRefreshProfile(); }
    catch (cause) { setError(emailChangeError(cause, zh)); }
    finally { setLoading(false); }
  }, [onRefreshProfile, zh]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  async function send(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const pending = await requestEmailChange(email.trim(), password);
      setState({ pending, email_delivery_available: true }); setEmail(""); setPassword(""); setOpen(false);
      setNotice(zh ? "验证邮件已发送。请在新邮箱中打开最新链接，并确认更换。" : "Verification sent. Open the latest link in your new inbox and confirm the change.");
    } catch (cause) { setError(emailChangeError(cause, zh)); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!await confirm({ title: zh ? "取消这次邮箱修改？" : "Cancel this email change?", description: zh ? "已发送的确认链接将失效，当前邮箱继续有效。" : "The confirmation link will stop working. Your current email stays unchanged.", confirmLabel: zh ? "取消申请" : "Cancel request" })) return;
    setBusy(true); setError("");
    try { await cancelEmailChange(); setState((value) => value ? { ...value, pending: null } : value); setEmail(""); setPassword(""); setOpen(false); setNotice(zh ? "已取消，当前邮箱保持不变。" : "Request cancelled. Your current email is unchanged."); }
    catch (cause) { setError(emailChangeError(cause, zh)); }
    finally { setBusy(false); }
  }
  return <section aria-label={zh ? "修改邮箱" : "Change email"} className="space-y-3 border-t border-ui pt-5">
    <div className="flex items-start gap-3"><Mail aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-secondary" /><div><h3 className="text-sm font-semibold text-primary">{zh ? "修改邮箱" : "Change email"}</h3><p className="mt-1 text-xs leading-5 text-secondary">{zh ? "先验证当前密码，再确认新邮箱。完成前，旧邮箱继续用于登录。" : "Verify your password, then confirm your new email. Keep using your old email until the change is complete."}</p></div></div>
    {state?.pending ? <div className="space-y-2 rounded-lg bg-subtle p-3"><p className="text-sm font-medium text-primary">{zh ? "等待新邮箱确认" : "Awaiting email confirmation"}</p><p className="break-all text-sm text-primary">{state.pending.target_email}</p><p className="text-xs text-secondary">{zh ? "链接到期时间：" : "Link expires: "}{new Date(state.pending.expires_at).toLocaleString(resolvedLocale)}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { setEmail(state.pending!.target_email); setPassword(""); setOpen(true); }}>{zh ? "重新发送或更换地址" : "Resend or change address"}</button><button type="button" disabled={busy} className="btn-ghost min-h-11 px-3 text-xs" onClick={() => void cancel()}>{zh ? "取消申请" : "Cancel request"}</button></div></div> : null}
    {loading && !state ? <p role="status" className="text-sm text-secondary">{zh ? "正在检查邮箱设置…" : "Checking email settings…"}</p> : null}
    {state && !state.email_delivery_available ? <p role="status" className="text-sm text-secondary">{zh ? "管理员尚未配置邮件服务，暂时无法修改邮箱。" : "Email delivery has not been configured. Changing your email is unavailable."}</p> : null}
    {!open && !state?.pending ? <button type="button" className="btn-secondary min-h-11 px-4 text-sm" disabled={busy || !state?.email_delivery_available} onClick={() => setOpen(true)}>{zh ? "设置新邮箱" : "Set a new email"}</button> : null}
    {open ? <form className="grid gap-3" onSubmit={send}>
      <label className="text-sm text-secondary">{zh ? "新邮箱" : "New email"}<input type="email" required maxLength={320} autoComplete="email" disabled={busy} value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} className="input-base mt-1 min-h-11 w-full px-3 text-base sm:text-sm" /></label>
      <label className="text-sm text-secondary">{zh ? "验证当前密码" : "Verify current password"}<input type="password" required maxLength={1024} autoComplete="current-password" disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} className="input-base mt-1 min-h-11 w-full px-3 text-base sm:text-sm" /></label>
      <p className="text-xs leading-5 text-secondary">{zh ? "新链接 30 分钟内有效。重新发送会替换上一次的链接。" : "The link works for 30 minutes. Resending replaces the previous link."}</p>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} className="btn-ghost min-h-11 px-3 text-sm" onClick={async () => { if (dirty && !await confirm({ title: zh ? "放弃未发送的邮箱修改？" : "Discard this unsent email change?", confirmLabel: zh ? "放弃输入" : "Discard input" })) return; setOpen(false); setEmail(""); setPassword(""); }}>{zh ? "收起" : "Close form"}</button><button type="submit" disabled={busy || !state?.email_delivery_available || !email || !password} className="btn-primary min-h-11 px-4 text-sm">{busy ? (zh ? "正在发送…" : "Sending…") : (zh ? "验证并发送邮件" : "Verify & send email")}</button></div>
    </form> : null}
    {error ? <div role="alert" className="text-sm text-[var(--danger)]"><p>{error}</p><button type="button" disabled={loading || busy} className="btn-secondary mt-2 min-h-11 px-3 text-xs" onClick={() => { setError(""); void refresh(); }}>{zh ? "刷新申请状态" : "Refresh request status"}</button></div> : null}
    {notice ? <p role="status" className="text-sm text-secondary">{notice}</p> : null}
  </section>;
}
