"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { AuthPageShell } from "../../features/auth/auth-page-shell";
import { PasswordField } from "../../features/auth/password-field";
import { AuthRequestError, loginWithPassword, readAuthSession, readAuthSetup, safeReturnPath } from "../../lib/auth-client";
import { pendingSignoutCleanups } from "../../lib/signout-cleanup";
import { SignoutCleanupRecovery } from "../../components/signout-cleanup-recovery";

export default function LoginPage() {
  return <Suspense fallback={<LoginLoading />}><LoginForm /></Suspense>;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const { resolvedLocale } = usePreferences();
  const copy = resolvedLocale === "zh-CN" ? zhCopy : enCopy;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordResetAvailable, setPasswordResetAvailable] = useState(false);
  const [cleanupPending, setCleanupPending] = useState<boolean | null>(null);
  const destination = safeReturnPath(searchParams?.get("return_to") ?? "/");
  const registerHref = destination === "/" ? "/register" : `/register?return_to=${encodeURIComponent(destination)}`;
  const upgraded = searchParams?.get("upgraded") === "1";
  const passwordReset = searchParams?.get("reset") === "1";
  const reauthenticate = searchParams?.get("reauth") === "1";
  const resetHref = destination === "/" ? "/reset-password" : `/reset-password?return_to=${encodeURIComponent(destination)}`;

  useEffect(() => {
    let active = true;
    const pending = pendingSignoutCleanups().length > 0;
    if (pending) { setCleanupPending(true); return; }
    setCleanupPending(false);
    void Promise.all([readAuthSetup(), readAuthSession()]).then(([setup, session]) => {
      if (!active) return;
      if (setup.setup_required) {
        window.location.replace("/account-upgrade");
        return;
      }
      if (session.authenticated && !reauthenticate) {
        window.location.replace(destination);
        return;
      }
      setPasswordResetAvailable(session.password_reset_available);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [destination, reauthenticate, cleanupPending]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await loginWithPassword(email.trim(), password);
      window.location.replace(destination);
    } catch (cause) {
      setError(loginErrorMessage(cause, copy));
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      title={copy.title}
      description={copy.description}
      footer={<div className="space-y-3"><p>{copy.noAccount} <Link href={registerHref} className="font-medium text-[var(--link)] underline decoration-[var(--link-decoration)] underline-offset-4 hover:text-[var(--link-hover)]">{copy.register}</Link></p><Link href="/verify-email" className="inline-flex min-h-11 items-center text-[var(--link)] underline underline-offset-4">{resolvedLocale === "zh-CN" ? "重新发送邮箱验证" : "Resend email verification"}</Link></div>}
    >
      {cleanupPending ? <SignoutCleanupRecovery zh={resolvedLocale === "zh-CN"} onComplete={() => setCleanupPending(false)} /> : cleanupPending === null ? <p role="status">{resolvedLocale === "zh-CN" ? "正在检查本机清理状态…" : "Checking local cleanup…"}</p> : <form onSubmit={submit} className="space-y-4">
        {upgraded ? <p role="status" className="rounded-md bg-[var(--accent-soft)] px-3 py-2 text-sm leading-5 text-primary">{copy.upgradeComplete}</p> : null}
        {passwordReset ? <p role="status" className="rounded-md bg-[var(--accent-soft)] px-3 py-2 text-sm leading-5 text-primary">{copy.resetComplete}</p> : null}
        <div className="space-y-1.5 text-left">
          <label htmlFor="login-email" className="text-sm font-medium text-primary">{copy.email}</label>
          <input
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            className="input-base min-h-11 w-full px-3"
          />
        </div>
        <PasswordField id="login-password" name="password" label={copy.password} value={password} onChange={setPassword} autoComplete="current-password" disabled={submitting} showLabel={copy.showPassword} hideLabel={copy.hidePassword} />
        {passwordResetAvailable ? <div className="-mt-1 text-right"><Link href={resetHref} className="text-sm font-medium text-[var(--link)] underline decoration-[var(--link-decoration)] underline-offset-4 hover:text-[var(--link-hover)]">{copy.forgotPassword}</Link></div> : null}
        {error ? <p role="alert" aria-live="assertive" className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm leading-5 text-[var(--danger)]">{error}</p> : null}
        <button type="submit" disabled={submitting || !email.trim() || !password} className="btn-primary min-h-11 w-full px-4 text-sm font-medium">
          {submitting ? copy.signingIn : copy.signIn}
        </button>
      </form>}
    </AuthPageShell>
  );
}

function LoginLoading() {
  return <AuthPageShell title="Chat Reader" description=""><div className="h-44 animate-pulse rounded-md bg-subtle" aria-label="Loading" /></AuthPageShell>;
}

function loginErrorMessage(cause: unknown, copy: LoginCopy): string {
  if (cause instanceof AuthRequestError) {
    if (cause.status === 401 || cause.status === 422) return copy.invalidCredentials;
    if (cause.status === 409) {
      window.location.replace("/account-upgrade");
      return copy.unavailable;
    }
    if (cause.status === 429) return copy.tooManyAttempts;
  }
  return copy.unavailable;
}

const enCopy = {
  title: "Sign in",
  description: "Open your private conversation library.",
  email: "Email",
  password: "Password",
  showPassword: "Show password",
  hidePassword: "Hide password",
  signIn: "Sign in",
  signingIn: "Signing in...",
  noAccount: "New to this library?",
  register: "Create an account",
  invalidCredentials: "Email or password is incorrect.",
  tooManyAttempts: "Too many attempts. Try again shortly.",
  unavailable: "Unable to sign in. Check your connection and try again.",
  upgradeComplete: "Account upgrade complete. Sign in with your email and current password.",
  resetComplete: "Password updated. Sign in with your new password.",
  forgotPassword: "Forgot password?",
} as const;

type LoginCopy = { [Key in keyof typeof enCopy]: string };

const zhCopy: LoginCopy = {
  title: "登录",
  description: "进入你的私人对话资料库。",
  email: "邮箱",
  password: "密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  signIn: "登录",
  signingIn: "正在登录...",
  noAccount: "还没有账户？",
  register: "创建账户",
  invalidCredentials: "邮箱或密码不正确。",
  tooManyAttempts: "尝试次数过多，请稍后再试。",
  unavailable: "暂时无法登录，请检查网络后重试。",
  upgradeComplete: "账户升级完成。请使用邮箱和当前密码登录。",
  resetComplete: "密码已更新，请使用新密码登录。",
  forgotPassword: "忘记密码？",
};
