"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { AuthPageShell } from "../../features/auth/auth-page-shell";
import { PasswordField } from "../../features/auth/password-field";
import { AuthRequestError, confirmEmailVerification, requestEmailVerification } from "../../lib/auth-client";

export default function VerifyEmailPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  }, []);

  const handleError = (cause: unknown) => {
    if (cause instanceof AuthRequestError) {
      if (cause.status === 429) return zh ? "请求过于频繁，请稍后重试。" : "Too many requests. Try again later.";
      if (cause.status === 401) return zh ? "邮箱或密码不正确。" : "Email or password is incorrect.";
      if (cause.status === 409) return zh ? "此账户不需要邮箱验证，请尝试登录或联系管理员。" : "This account does not need verification. Try signing in or contact the administrator.";
      if (cause.status === 422) return zh ? "链接无效、已使用或已过期，请重新发送。" : "The link is invalid, used, or expired. Request a new link.";
      if (cause.status === 503) return zh ? "邮件服务暂不可用，请稍后重试。" : "Email delivery is unavailable. Try again later.";
    }
    return zh ? "操作失败，请检查网络后重试。" : "Unable to complete this action. Check your connection and retry.";
  };
  const confirm = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await confirmEmailVerification(token);
      setVerified(true); setToken("");
      window.history.replaceState(null, "", window.location.pathname);
      setNotice(result.approval_required
        ? (zh ? "邮箱已验证，账户仍需等待管理员审批。" : "Email verified. Your account still requires administrator approval.")
        : (zh ? "邮箱已验证，可以登录。" : "Email verified. You can now sign in."));
    } catch (cause) { setError(handleError(cause)); }
    finally { setBusy(false); }
  };
  const resend = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await requestEmailVerification(email.trim(), password);
      setPassword(""); setToken("");
      window.history.replaceState(null, "", window.location.pathname);
      setNotice(zh ? "已重新发送。请使用最新邮件中的链接，旧链接已失效。" : "A new link was sent. Use the latest email; earlier links are no longer valid.");
    } catch (cause) { setError(handleError(cause)); }
    finally { setBusy(false); }
  };
  return <AuthPageShell title={zh ? "验证邮箱" : "Verify email"} description={zh ? "确认邮箱后，账户还需满足当前注册审批要求。" : "After email verification, your account must also meet its registration approval requirements."} footer={<Link href="/login" className="text-accent underline underline-offset-4">{zh ? "返回登录" : "Sign in"}</Link>}>
    <div className="space-y-5">
      {token && !verified ? <div className="space-y-3"><p className="text-sm text-secondary">{zh ? "点击下方按钮确认此邮箱。链接在发送后 30 分钟内有效。" : "Confirm this email below. The link expires 30 minutes after it was sent."}</p><button type="button" autoFocus disabled={busy} onClick={() => void confirm()} className="btn-primary min-h-11 w-full px-4">{busy ? (zh ? "处理中…" : "Working…") : (zh ? "确认邮箱" : "Confirm email")}</button></div> : null}
      {error ? <p role="alert" className="state-error text-sm">{error}</p> : null}
      {notice ? <p role="status" className="rounded-md border border-ui bg-subtle p-3 text-sm text-primary">{notice}</p> : null}
      {!verified ? <form onSubmit={resend} className="space-y-4 border-t border-ui pt-4">
        <h2 className="text-sm font-semibold text-primary">{zh ? "重新发送验证邮件" : "Resend verification email"}</h2>
        <div className="space-y-1.5"><label htmlFor="verification-email" className="text-sm text-primary">{zh ? "注册邮箱" : "Account email"}</label><input id="verification-email" type="email" required autoComplete="username" value={email} maxLength={320} disabled={busy} onChange={(e) => setEmail(e.target.value)} className="input-base min-h-11 w-full px-3" /></div>
        <PasswordField id="verification-password" name="password" label={zh ? "账户密码" : "Account password"} value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} showLabel={zh ? "显示密码" : "Show password"} hideLabel={zh ? "隐藏密码" : "Hide password"} />
        <button type="submit" disabled={busy || !email.trim() || !password} className="btn-secondary min-h-11 w-full px-4">{busy ? (zh ? "处理中…" : "Working…") : (zh ? "发送新链接" : "Send a new link")}</button>
      </form> : null}
    </div>
  </AuthPageShell>;
}
