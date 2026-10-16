"use client";

import { Mail } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { AuthRequestError, cancelEmailChange, emailChangeError, readEmailChange, requestEmailChange, type EmailChangeState } from "../lib/auth-client";
import { authenticationGeneration } from "../lib/offline-access";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

const definiteEmailActionFailure = (cause: unknown) =>
  cause instanceof AuthRequestError && [400, 401, 403, 409, 422, 429, 503].includes(cause.status);

export function EmailChangePanel({ onDirtyChange, onRefreshProfile }: { onDirtyChange: (dirty: boolean) => void; onRefreshProfile: () => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const [state, setState] = useState<EmailChangeState | null>(null);
  const [open, setOpen] = useState(false), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const mounted = useRef(true), generation = useRef(authenticationGeneration());
  const refreshToken = useRef(0), actionToken = useRef(0);
  const action = useRef<"send" | "cancel" | null>(null), confirming = useRef(false);
  const current = useCallback(() => mounted.current && generation.current === authenticationGeneration(), []);
  const dirty = !!email || !!password || busy;
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onDirtyChange(false); };
  }, [onDirtyChange]);
  const refresh = useCallback(async () => {
    if (!current() || action.current || confirming.current) return;
    const token = ++refreshToken.current;
    setLoading(true);
    try {
      const next = await readEmailChange();
      if (!current() || token !== refreshToken.current) return;
      setState(next); onRefreshProfile();
    } catch (cause) {
      if (current() && token === refreshToken.current) setError(emailChangeError(cause, zh));
    } finally {
      if (current() && token === refreshToken.current) setLoading(false);
    }
  }, [current, onRefreshProfile, zh]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!current() || action.current || confirming.current) return;
    const token = ++actionToken.current;
    refreshToken.current++;
    action.current = "send";
    setBusy(true); setError(""); setNotice("");
    try {
      const pending = await requestEmailChange(email.trim(), password);
      if (!current() || action.current !== "send" || token !== actionToken.current) return;
      setState({ pending, email_delivery_available: true }); setEmail(""); setPassword(""); setOpen(false);
      setNotice(zh ? "验证邮件已发送。请在新邮箱中打开最新链接，并确认更换。" : "Verification sent. Open the latest link in your new inbox and confirm the change.");
    } catch (cause) {
      if (current() && action.current === "send" && token === actionToken.current) {
        setError(definiteEmailActionFailure(cause)
          ? emailChangeError(cause, zh)
          : (zh ? "申请结果尚未确认。请先刷新申请状态，再决定是否重新发送；输入已保留。" : "The request result is not confirmed. Refresh the request status before deciding whether to resend; your input is retained."));
      }
    } finally {
      if (action.current === "send" && token === actionToken.current) action.current = null;
      if (current() && token === actionToken.current) setBusy(false);
    }
  }
  async function cancel() {
    if (!current() || action.current || confirming.current) return;
    confirming.current = true;
    try {
      if (!await confirm({ title: zh ? "取消这次邮箱修改？" : "Cancel this email change?", description: zh ? "已发送的确认链接将失效，当前邮箱继续有效。" : "The confirmation link will stop working. Your current email stays unchanged.", confirmLabel: zh ? "取消申请" : "Cancel request" }) || !current()) return;
    } finally { confirming.current = false; }
    if (!current() || action.current) return;
    const token = ++actionToken.current;
    refreshToken.current++;
    action.current = "cancel";
    setBusy(true); setError(""); setNotice("");
    try {
      await cancelEmailChange();
      if (!current() || action.current !== "cancel" || token !== actionToken.current) return;
      setState((value) => value ? { ...value, pending: null } : value); setEmail(""); setPassword(""); setOpen(false); setNotice(zh ? "已取消，当前邮箱保持不变。" : "Request cancelled. Your current email is unchanged.");
    } catch (cause) {
      if (current() && action.current === "cancel" && token === actionToken.current) {
        setError(definiteEmailActionFailure(cause)
          ? emailChangeError(cause, zh)
          : (zh ? "取消结果尚未确认。请先刷新申请状态，再决定是否重试；不会自动重复提交。" : "The cancellation result is not confirmed. Refresh the request status before deciding whether to retry; nothing was resubmitted automatically."));
      }
    } finally {
      if (action.current === "cancel" && token === actionToken.current) action.current = null;
      if (current() && token === actionToken.current) setBusy(false);
    }
  }
  async function closeForm() {
    if (!current() || action.current || confirming.current) return;
    if (!email && !password) { setOpen(false); return; }
    confirming.current = true;
    try {
      if (!await confirm({ title: zh ? "放弃未发送的邮箱修改？" : "Discard this unsent email change?", confirmLabel: zh ? "放弃输入" : "Discard input" }) || !current()) return;
      setOpen(false); setEmail(""); setPassword(""); setError("");
    } finally { confirming.current = false; }
  }
  return <section aria-label={zh ? "修改邮箱" : "Change email"} className="space-y-3 border-t border-ui pt-5">
    <div className="flex items-start gap-3"><Mail aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-secondary" /><div><h3 className="text-sm font-semibold text-primary">{zh ? "修改邮箱" : "Change email"}</h3></div></div>
    {state?.pending ? <div className="space-y-2 rounded-lg bg-subtle p-3"><p className="text-sm font-medium text-primary">{zh ? "等待新邮箱确认" : "Awaiting email confirmation"}</p><p className="break-all text-sm text-primary">{state.pending.target_email}</p><p className="text-xs text-secondary">{zh ? "链接到期时间：" : "Link expires: "}{new Date(state.pending.expires_at).toLocaleString(resolvedLocale)}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { setEmail(state.pending!.target_email); setPassword(""); setOpen(true); }}>{zh ? "重新发送或更换地址" : "Resend or change address"}</button><button type="button" disabled={busy} className="btn-ghost min-h-11 px-3 text-xs" onClick={() => void cancel()}>{zh ? "取消申请" : "Cancel request"}</button></div></div> : null}
    {loading && !state ? <p role="status" className="text-sm text-secondary">{zh ? "正在检查邮箱设置…" : "Checking email settings…"}</p> : null}
    {state && !state.email_delivery_available ? <p role="status" className="text-sm text-secondary">{zh ? "管理员尚未配置邮件服务，暂时无法修改邮箱。" : "Email delivery has not been configured. Changing your email is unavailable."}</p> : null}
    {!open && !state?.pending ? <button type="button" className="btn-secondary min-h-11 px-4 text-sm" disabled={busy || !state?.email_delivery_available} onClick={() => setOpen(true)}>{zh ? "设置新邮箱" : "Set a new email"}</button> : null}
    {open ? <form className="grid gap-3" onSubmit={send}>
      <p className="mt-1 text-xs leading-5 text-secondary">{zh ? "先验证当前密码，再确认新邮箱。完成前，旧邮箱继续用于登录。" : "Verify your password, then confirm your new email. Keep using your old email until the change is complete."}</p>
      <label className="text-sm text-secondary">{zh ? "新邮箱" : "New email"}<input type="email" required maxLength={320} autoComplete="email" disabled={busy} value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} className="input-base mt-1 min-h-11 w-full px-3 text-base sm:text-sm" /></label>
      <label className="text-sm text-secondary">{zh ? "验证当前密码" : "Verify current password"}<input type="password" required maxLength={1024} autoComplete="current-password" disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} className="input-base mt-1 min-h-11 w-full px-3 text-base sm:text-sm" /></label>
      <p className="text-xs leading-5 text-secondary">{zh ? "新链接 30 分钟内有效。重新发送会替换上一次的链接。" : "The link works for 30 minutes. Resending replaces the previous link."}</p>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy || confirming.current} className="btn-ghost min-h-11 px-3 text-sm" onClick={() => void closeForm()}>{zh ? "收起" : "Close form"}</button><button type="submit" disabled={busy || !state?.email_delivery_available || !email || !password} className="btn-primary min-h-11 px-4 text-sm">{busy ? (zh ? "正在发送…" : "Sending…") : (zh ? "验证并发送邮件" : "Verify & send email")}</button></div>
    </form> : null}
    {error ? <div role="alert" className="text-sm text-[var(--danger)]"><p>{error}</p><button type="button" disabled={loading || busy} className="btn-secondary mt-2 min-h-11 px-3 text-xs" onClick={() => { setError(""); void refresh(); }}>{zh ? "刷新申请状态" : "Refresh request status"}</button></div> : null}
    {notice ? <p role="status" className="text-sm text-secondary">{notice}</p> : null}
  </section>;
}
