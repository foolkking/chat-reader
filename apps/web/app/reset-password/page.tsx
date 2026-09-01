"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { AuthPageShell } from "../../features/auth/auth-page-shell";
import { PasswordField } from "../../features/auth/password-field";
import { AuthRequestError, readAuthSession, requestPasswordReset, resetPassword, safeReturnPath } from "../../lib/auth-client";

type Availability = "LOADING" | "AVAILABLE" | "UNAVAILABLE" | "ERROR";

export default function ResetPasswordPage() {
  return <Suspense fallback={<ResetLoading />}><ResetPasswordContent /></Suspense>;
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const { resolvedLocale } = usePreferences();
  const copy = resolvedLocale === "zh-CN" ? zhCopy : enCopy;
  const token = searchParams?.get("token")?.trim() ?? "";
  const destination = safeReturnPath(searchParams?.get("return_to") ?? "/");
  const loginHref = destination === "/" ? "/login" : `/login?return_to=${encodeURIComponent(destination)}`;

  return (
    <AuthPageShell
      title={token ? copy.resetTitle : copy.requestTitle}
      description={token ? copy.resetDescription : copy.requestDescription}
      footer={<Link href={loginHref} className="font-medium text-[var(--link)] underline decoration-[var(--link-decoration)] underline-offset-4 hover:text-[var(--link-hover)]">{copy.backToLogin}</Link>}
    >
      {token ? <ResetForm token={token} copy={copy} /> : <RequestForm destination={destination} copy={copy} />}
    </AuthPageShell>
  );
}

function RequestForm({ destination, copy }: { destination: string; copy: ResetCopy }) {
  const [availability, setAvailability] = useState<Availability>("LOADING");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void readAuthSession().then((session) => {
      if (!active) return;
      if (session.authenticated) {
        window.location.replace(destination);
        return;
      }
      setAvailability(session.password_reset_available ? "AVAILABLE" : "UNAVAILABLE");
    }).catch(() => active && setAvailability("ERROR"));
    return () => { active = false; };
  }, [destination]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      setError(cause instanceof AuthRequestError && cause.status === 429 ? copy.tooManyAttempts : copy.requestUnavailable);
    } finally {
      setSubmitting(false);
    }
  };

  if (availability === "LOADING") return <div className="h-32 animate-pulse rounded-md bg-subtle" role="status" aria-label={copy.checking} />;
  if (availability === "ERROR") return <div className="state-error text-sm"><p>{copy.checkFailed}</p><button type="button" onClick={() => window.location.reload()} className="btn-secondary mt-4 min-h-10 px-4">{copy.retry}</button></div>;
  if (availability === "UNAVAILABLE") return <div className="rounded-md border border-ui bg-subtle px-4 py-4"><p className="font-medium text-primary">{copy.unavailableTitle}</p><p className="mt-1.5 text-sm leading-5 text-secondary">{copy.unavailableDescription}</p></div>;
  if (sent) return <div role="status" className="rounded-md bg-[var(--accent-soft)] px-4 py-4"><p className="font-medium text-primary">{copy.requestSentTitle}</p><p className="mt-1.5 text-sm leading-5 text-secondary">{copy.requestSentDescription}</p></div>;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5 text-left">
        <label htmlFor="reset-email" className="text-sm font-medium text-primary">{copy.email}</label>
        <input id="reset-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} className="input-base min-h-11 w-full px-3" />
      </div>
      {error ? <p role="alert" aria-live="assertive" className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm leading-5 text-[var(--danger)]">{error}</p> : null}
      <button type="submit" disabled={submitting || !email.trim()} className="btn-primary min-h-11 w-full px-4 text-sm font-medium">{submitting ? copy.sending : copy.sendLink}</button>
    </form>
  );
}

function ResetForm({ token, copy }: { token: string; copy: ResetCopy }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError(copy.passwordMismatch);
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ token, newPassword, confirmPassword });
      window.location.replace("/login?reset=1");
    } catch (cause) {
      setError(cause instanceof AuthRequestError && cause.status === 429 ? copy.tooManyAttempts : copy.invalidToken);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PasswordField id="reset-new-password" name="newPassword" label={copy.newPassword} value={newPassword} onChange={setNewPassword} autoComplete="new-password" minLength={12} autoFocus disabled={submitting} showLabel={copy.showPassword} hideLabel={copy.hidePassword} />
      <PasswordField id="reset-confirm-password" name="confirmPassword" label={copy.confirmPassword} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={12} disabled={submitting} showLabel={copy.showConfirmPassword} hideLabel={copy.hideConfirmPassword} />
      {error ? <p role="alert" aria-live="assertive" className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm leading-5 text-[var(--danger)]">{error}</p> : null}
      <button type="submit" disabled={submitting || !newPassword || !confirmPassword} className="btn-primary min-h-11 w-full px-4 text-sm font-medium">{submitting ? copy.updating : copy.updatePassword}</button>
    </form>
  );
}

function ResetLoading() {
  return <AuthPageShell title="Chat Reader" description=""><div className="h-40 animate-pulse rounded-md bg-subtle" aria-label="Loading" /></AuthPageShell>;
}

const enCopy = {
  requestTitle: "Reset your password",
  requestDescription: "Request a private, time-limited reset link.",
  resetTitle: "Choose a new password",
  resetDescription: "This link can be used once. Updating your password signs out other devices.",
  email: "Email",
  sendLink: "Send reset link",
  sending: "Sending reset link...",
  backToLogin: "Back to sign in",
  checking: "Checking password reset availability",
  checkFailed: "Password reset availability could not be checked.",
  retry: "Try again",
  unavailableTitle: "Password reset is not available",
  unavailableDescription: "This instance does not have email delivery configured. Contact the administrator for a recovery link.",
  requestSentTitle: "Check your email",
  requestSentDescription: "If an account matches that email, a password reset link has been sent.",
  tooManyAttempts: "Too many attempts. Try again shortly.",
  requestUnavailable: "Unable to request a reset link. Check your connection and try again.",
  newPassword: "New password",
  confirmPassword: "Confirm new password",
  showPassword: "Show password",
  hidePassword: "Hide password",
  showConfirmPassword: "Show confirmed password",
  hideConfirmPassword: "Hide confirmed password",
  passwordMismatch: "Passwords do not match.",
  updatePassword: "Update password",
  updating: "Updating password...",
  invalidToken: "This reset link is invalid or has expired. Request a new link.",
} as const;

type ResetCopy = { [Key in keyof typeof enCopy]: string };

const zhCopy: ResetCopy = {
  requestTitle: "重置密码",
  requestDescription: "申请一个私密且限时有效的重置链接。",
  resetTitle: "设置新密码",
  resetDescription: "此链接只能使用一次。更新密码后，其他设备将退出登录。",
  email: "邮箱",
  sendLink: "发送重置链接",
  sending: "正在发送重置链接...",
  backToLogin: "返回登录",
  checking: "正在检查密码重置功能",
  checkFailed: "无法确认密码重置功能是否可用。",
  retry: "重试",
  unavailableTitle: "当前无法通过邮件重置密码",
  unavailableDescription: "此实例尚未配置邮件发送。请联系管理员获取恢复链接。",
  requestSentTitle: "请检查邮箱",
  requestSentDescription: "如果该邮箱对应一个账户，系统已经发送密码重置链接。",
  tooManyAttempts: "尝试次数过多，请稍后再试。",
  requestUnavailable: "暂时无法申请重置链接，请检查网络后重试。",
  newPassword: "新密码",
  confirmPassword: "确认新密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  showConfirmPassword: "显示确认密码",
  hideConfirmPassword: "隐藏确认密码",
  passwordMismatch: "两次输入的密码不一致。",
  updatePassword: "更新密码",
  updating: "正在更新密码...",
  invalidToken: "此重置链接无效或已过期，请重新申请。",
};
