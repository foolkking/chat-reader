"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { AuthPageShell } from "../../features/auth/auth-page-shell";
import { PasswordField } from "../../features/auth/password-field";
import { AuthRequestError, readAuthSetup, upgradeLegacyAccount } from "../../lib/auth-client";

export default function AccountUpgradePage() {
  const { resolvedLocale } = usePreferences();
  const copy = resolvedLocale === "zh-CN" ? zhCopy : enCopy;
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void readAuthSetup()
      .then((setup) => {
        if (!active) return;
        if (!setup.setup_required) {
          window.location.replace("/login");
          return;
        }
        setChecking(false);
      })
      .catch(() => active && setError(copy.checkFailed));
    return () => { active = false; };
  }, [copy.checkFailed]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await upgradeLegacyAccount({ currentPassword, email: email.trim(), displayName: displayName.trim() || undefined });
      window.location.replace("/login?upgraded=1");
    } catch (cause) {
      if (cause instanceof AuthRequestError && cause.status === 401) setError(copy.wrongPassword);
      else if (cause instanceof AuthRequestError && (cause.status === 409 || cause.status === 422)) setError(copy.invalidDetails);
      else setError(copy.unavailable);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell title={copy.title} description={copy.description}>
      {checking && !error ? <div className="h-52 animate-pulse rounded-md bg-subtle" role="status" aria-label={copy.checking} /> : null}
      {!checking ? (
        <form onSubmit={submit} className="space-y-4">
          <p className="rounded-md bg-[var(--accent-soft)] px-3 py-2 text-sm leading-5 text-primary">{copy.explanation}</p>
          <PasswordField id="upgrade-current-password" name="currentPassword" label={copy.currentPassword} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" autoFocus disabled={submitting} showLabel={copy.showPassword} hideLabel={copy.hidePassword} />
          <div className="space-y-1.5 text-left">
            <label htmlFor="upgrade-email" className="text-sm font-medium text-primary">{copy.email}</label>
            <input id="upgrade-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} className="input-base min-h-11 w-full px-3" />
          </div>
          <div className="space-y-1.5 text-left">
            <label htmlFor="upgrade-display-name" className="text-sm font-medium text-primary">{copy.displayName} <span className="font-normal text-secondary">{copy.optional}</span></label>
            <input id="upgrade-display-name" name="displayName" type="text" autoComplete="name" maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={submitting} className="input-base min-h-11 w-full px-3" />
          </div>
          {error ? <p role="alert" aria-live="assertive" className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm leading-5 text-[var(--danger)]">{error}</p> : null}
          <button type="submit" disabled={submitting || !currentPassword || !email.trim()} className="btn-primary min-h-11 w-full px-4 text-sm font-medium">{submitting ? copy.upgrading : copy.upgrade}</button>
        </form>
      ) : null}
      {checking && error ? <div className="state-error text-sm"><p>{error}</p><button type="button" onClick={() => window.location.reload()} className="btn-secondary mt-4 min-h-10 px-4">{copy.retry}</button></div> : null}
    </AuthPageShell>
  );
}

const enCopy = {
  title: "Upgrade the owner account",
  description: "Connect the existing library to its first administrator account.",
  explanation: "Your conversations and current password stay unchanged. After the upgrade, sign in once with your email and password.",
  currentPassword: "Current owner password",
  email: "Administrator email",
  displayName: "Display name",
  optional: "(optional)",
  showPassword: "Show password",
  hidePassword: "Hide password",
  upgrade: "Upgrade account",
  upgrading: "Upgrading account...",
  checking: "Checking account upgrade status",
  checkFailed: "Account upgrade status could not be checked.",
  wrongPassword: "The current owner password is incorrect.",
  invalidDetails: "This administrator email cannot be used.",
  unavailable: "Unable to upgrade the account. Check your connection and try again.",
  retry: "Try again",
} as const;

type UpgradeCopy = { [Key in keyof typeof enCopy]: string };

const zhCopy: UpgradeCopy = {
  title: "升级管理员账户",
  description: "将现有资料库绑定到第一个管理员账户。",
  explanation: "现有对话和当前密码不会改变。升级完成后，请使用邮箱和密码重新登录一次。",
  currentPassword: "当前所有者密码",
  email: "管理员邮箱",
  displayName: "显示名称",
  optional: "（可选）",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  upgrade: "升级账户",
  upgrading: "正在升级账户...",
  checking: "正在检查账户升级状态",
  checkFailed: "无法确认账户升级状态。",
  wrongPassword: "当前所有者密码不正确。",
  invalidDetails: "无法使用此管理员邮箱。",
  unavailable: "暂时无法升级账户，请检查网络后重试。",
  retry: "重试",
};
