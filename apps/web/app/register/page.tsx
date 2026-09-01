"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { AuthPageShell } from "../../features/auth/auth-page-shell";
import { PasswordField } from "../../features/auth/password-field";
import {
  AuthRequestError,
  readAuthSession,
  readAuthSetup,
  registerAccount,
  safeReturnPath,
  type RegistrationMode,
} from "../../lib/auth-client";

type RegistrationState = RegistrationMode | "LOADING" | "ERROR";

export default function RegisterPage() {
  return <Suspense fallback={<RegisterLoading />}><RegisterForm /></Suspense>;
}

function RegisterForm() {
  const searchParams = useSearchParams();
  const { resolvedLocale } = usePreferences();
  const copy = resolvedLocale === "zh-CN" ? zhCopy : enCopy;
  const [mode, setMode] = useState<RegistrationState>("LOADING");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invitationToken, setInvitationToken] = useState(searchParams?.get("invite") ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const destination = safeReturnPath(searchParams?.get("return_to") ?? "/");
  const loginHref = destination === "/" ? "/login" : `/login?return_to=${encodeURIComponent(destination)}`;

  const loadAvailability = () => {
    setMode("LOADING");
    Promise.all([readAuthSetup(), readAuthSession()])
      .then(([setup, session]) => {
        if (setup.setup_required) {
          window.location.replace("/account-upgrade");
          return;
        }
        if (session.authenticated) {
          window.location.replace(destination);
          return;
        }
        setMode(setup.registration_mode);
      })
      .catch(() => setMode("ERROR"));
  };

  useEffect(() => {
    let active = true;
    Promise.all([readAuthSetup(), readAuthSession()])
      .then(([setup, session]) => {
        if (!active) return;
        if (setup.setup_required) {
          window.location.replace("/account-upgrade");
          return;
        }
        if (session.authenticated) {
          window.location.replace(destination);
          return;
        }
        setMode(setup.registration_mode);
      })
      .catch(() => active && setMode("ERROR"));
    return () => { active = false; };
  }, [destination]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError(copy.passwordMismatch);
      return;
    }
    setSubmitting(true);
    try {
      const session = await registerAccount({
        email: email.trim(),
        password,
        confirmPassword,
        invitationToken: mode === "INVITE_ONLY" ? invitationToken.trim() : undefined,
      });
      if (!session.authenticated && session.auth_mode === "pending_approval") {
        setPendingApproval(true);
        return;
      }
      window.location.replace(destination);
    } catch (cause) {
      setError(registrationErrorMessage(cause, mode, copy));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      title={copy.title}
      description={copy.description}
      footer={<>{copy.hasAccount} <Link href={loginHref} className="font-medium text-[var(--link)] underline decoration-[var(--link-decoration)] underline-offset-4 hover:text-[var(--link-hover)]">{copy.backToLogin}</Link></>}
    >
      {mode === "LOADING" ? <RegistrationLoading copy={copy} /> : null}
      {mode === "ERROR" ? <RegistrationLoadError copy={copy} onRetry={loadAvailability} /> : null}
      {mode === "CLOSED" ? <ClosedRegistration copy={copy} /> : null}
      {pendingApproval ? <div className="rounded-md border border-ui bg-subtle px-4 py-4" role="status"><p className="font-medium text-primary">{copy.pendingTitle}</p><p className="mt-1.5 text-sm leading-5 text-secondary">{copy.pendingDescription}</p><Link href={loginHref} className="btn-secondary mt-4 inline-flex min-h-10 items-center px-4 text-sm font-medium">{copy.backToLogin}</Link></div> : mode === "OPEN" || mode === "INVITE_ONLY" ? (
        <form onSubmit={submit} className="space-y-4">
          {mode === "INVITE_ONLY" ? <p className="rounded-md bg-[var(--color-semantic-warning-soft)] px-3 py-2 text-sm leading-5 text-[var(--color-semantic-warning)]">{copy.inviteOnly}</p> : null}
          <div className="space-y-1.5 text-left">
            <label htmlFor="register-email" className="text-sm font-medium text-primary">{copy.email}</label>
            <input id="register-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} className="input-base min-h-11 w-full px-3" />
          </div>
          <PasswordField id="register-password" name="password" label={copy.password} value={password} onChange={setPassword} autoComplete="new-password" minLength={12} disabled={submitting} showLabel={copy.showPassword} hideLabel={copy.hidePassword} />
          <PasswordField id="register-confirm-password" name="confirmPassword" label={copy.confirmPassword} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={12} disabled={submitting} showLabel={copy.showConfirmPassword} hideLabel={copy.hideConfirmPassword} />
          {mode === "INVITE_ONLY" ? (
            <div className="space-y-1.5 text-left">
              <label htmlFor="invitation-token" className="text-sm font-medium text-primary">{copy.invitationCode}</label>
              <input id="invitation-token" name="invitationToken" type="text" autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={512} value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} disabled={submitting} className="input-base min-h-11 w-full px-3 font-mono text-sm" />
            </div>
          ) : null}
          {error ? <p role="alert" aria-live="assertive" className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm leading-5 text-[var(--danger)]">{error}</p> : null}
          <button type="submit" disabled={submitting || !email.trim() || !password || !confirmPassword || (mode === "INVITE_ONLY" && !invitationToken.trim())} className="btn-primary min-h-11 w-full px-4 text-sm font-medium">
            {submitting ? copy.creating : copy.createAccount}
          </button>
        </form>
      ) : null}
    </AuthPageShell>
  );
}

function RegistrationLoading({ copy }: { copy: RegisterCopy }) {
  return <div className="space-y-3" role="status"><span className="sr-only">{copy.loading}</span><div className="h-11 animate-pulse rounded-md bg-subtle" /><div className="h-11 animate-pulse rounded-md bg-subtle" /><div className="h-11 animate-pulse rounded-md bg-subtle" /></div>;
}

function RegistrationLoadError({ copy, onRetry }: { copy: RegisterCopy; onRetry: () => void }) {
  return <div className="state-error text-sm"><p className="font-medium">{copy.loadError}</p><button type="button" onClick={onRetry} className="btn-secondary mt-4 min-h-10 px-4">{copy.retry}</button></div>;
}

function ClosedRegistration({ copy }: { copy: RegisterCopy }) {
  return <div className="rounded-md border border-ui bg-subtle px-4 py-4"><p className="font-medium text-primary">{copy.closedTitle}</p><p className="mt-1.5 text-sm leading-5 text-secondary">{copy.closedDescription}</p></div>;
}

function RegisterLoading() {
  return <AuthPageShell title="Chat Reader" description=""><div className="h-52 animate-pulse rounded-md bg-subtle" aria-label="Loading" /></AuthPageShell>;
}

function registrationErrorMessage(cause: unknown, mode: RegistrationState, copy: RegisterCopy): string {
  if (cause instanceof AuthRequestError) {
    if (cause.status === 429) return copy.tooManyAttempts;
    if (cause.status === 403 && mode === "INVITE_ONLY") return copy.invalidInvitation;
    if (cause.status === 422 || cause.status === 409) return copy.invalidDetails;
  }
  return copy.unavailable;
}

const enCopy = {
  title: "Create an account",
  description: "Start a private conversation library on this instance.",
  email: "Email",
  password: "Password",
  confirmPassword: "Confirm password",
  showPassword: "Show password",
  hidePassword: "Hide password",
  showConfirmPassword: "Show confirmed password",
  hideConfirmPassword: "Hide confirmed password",
  invitationCode: "Invitation code",
  inviteOnly: "This instance accepts new accounts by invitation only.",
  createAccount: "Create account",
  creating: "Creating account...",
  hasAccount: "Already have an account?",
  backToLogin: "Sign in",
  passwordMismatch: "Passwords do not match.",
  invalidInvitation: "The invitation is invalid, expired, or already used.",
  invalidDetails: "Unable to create an account with these details.",
  tooManyAttempts: "Too many attempts. Try again shortly.",
  unavailable: "Unable to create an account. Check your connection and try again.",
  closedTitle: "Registration is closed",
  closedDescription: "This Chat Reader instance is not accepting new accounts.",
  loading: "Checking registration availability",
  loadError: "Registration availability could not be checked.",
  retry: "Try again",
  pendingTitle: "Account awaiting approval",
  pendingDescription: "Your account was created. A system administrator must approve it before you can sign in.",
} as const;

type RegisterCopy = { [Key in keyof typeof enCopy]: string };

const zhCopy: RegisterCopy = {
  title: "创建账户",
  description: "在当前实例中建立你的私人对话资料库。",
  email: "邮箱",
  password: "密码",
  confirmPassword: "确认密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  showConfirmPassword: "显示确认密码",
  hideConfirmPassword: "隐藏确认密码",
  invitationCode: "邀请码",
  inviteOnly: "当前实例仅接受受邀用户注册。",
  createAccount: "创建账户",
  creating: "正在创建账户...",
  hasAccount: "已有账户？",
  backToLogin: "返回登录",
  passwordMismatch: "两次输入的密码不一致。",
  invalidInvitation: "邀请码无效、已过期或已使用。",
  invalidDetails: "无法使用这些信息创建账户。",
  tooManyAttempts: "尝试次数过多，请稍后再试。",
  unavailable: "暂时无法创建账户，请检查网络后重试。",
  closedTitle: "当前实例未开放注册",
  closedDescription: "此 Chat Reader 实例暂不接受新账户。",
  loading: "正在检查注册状态",
  loadError: "无法确认当前实例的注册状态。",
  retry: "重试",
  pendingTitle: "账户正在等待审批",
  pendingDescription: "账户已创建。系统管理员审批后才能登录。",
};
