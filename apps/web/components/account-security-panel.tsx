"use client";

import { KeyRound, Laptop, LogOut, RefreshCw, UserRound } from "lucide-react";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { getAccountProfile, getDeviceSessions, logoutOtherDeviceSessions, updateAccountProfile, type DeviceSession } from "../lib/account-access-client";
import { changeOwnerPassword, logoutCurrentDevice, type AuthSessionState } from "../lib/auth-client";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";
import { readOfflinePending, type OfflinePendingSnapshot } from "../lib/offline-pending";
import { PendingChangesPanel } from "./pending-changes-panel";
import { EmailChangePanel } from "./email-change-panel";
import { pendingSignoutCleanups, SIGNOUT_CLEANUP_EVENT } from "../lib/signout-cleanup";

export function AccountSecurityPanel({ focused = false, onDirtyChange }: { focused?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale, persistPreferenceDraft } = usePreferences();
  const { confirm } = useInteractionDialog();
  const copy = useMemo(() => accountCopy(resolvedLocale === "zh-CN"), [resolvedLocale]);
  const [profile, setProfile] = useState<AuthSessionState | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [emailDirty, setEmailDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [pendingSignout, setPendingSignout] = useState<{ snapshot: OfflinePendingSnapshot; intent: "logout" | "password" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextProfile, nextSessions] = await Promise.all([getAccountProfile(), getDeviceSessions()]);
      setProfile(nextProfile);
      setDisplayName(nextProfile.display_name ?? "");
      setSessions(nextSessions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed]);

  useEffect(() => { void load(); }, [load]);
  const profileDirty = profile !== null && displayName.trim() !== (profile.display_name ?? "");
  const passwordDirty = Boolean(passwords.current || passwords.next || passwords.confirm);
  useLayoutEffect(() => { onDirtyChange?.(profileDirty || passwordDirty || emailDirty); }, [onDirtyChange, passwordDirty, profileDirty, emailDirty]);
  const refreshIdentity = useCallback(() => { void getAccountProfile().then(setProfile).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to refresh account.")); }, []);
  const otherSessionCount = sessions.filter((session) => !session.current).length;
  const finishSignout = () => {
    // Remove the form's beforeunload guard before deliberate navigation. The
    // server mutation has already succeeded. Failed local cleanup replaces the
    // entire private boundary, keeping even memory-only recovery available.
    flushSync(() => {
      setPasswords({ current: "", next: "", confirm: "" });
      setEmailDirty(false);
      setDisplayName(profile?.display_name ?? "");
      onDirtyChange?.(false);
    });
    if (pendingSignoutCleanups().length) window.dispatchEvent(new Event(SIGNOUT_CLEANUP_EVENT));
    else window.location.replace("/login");
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await updateAccountProfile(displayName);
      setProfile(next);
      setDisplayName(next.display_name ?? "");
      setNotice(copy.profileSaved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.profileFailed);
    } finally {
      setProfileBusy(false);
    }
  };

  const logout = async () => {
    setSessionBusy(true);
    setError("");
    try {
      const snapshot = await (async () => {
        try { await persistPreferenceDraft(); const value = await readOfflinePending(); setStorageUnavailable(false); return value; }
        catch (cause) { setStorageUnavailable(true); throw cause; }
      })();
      if (snapshot.count) { setPendingSignout({ snapshot, intent: "logout" }); setSessionBusy(false); return; }
      await logoutCurrentDevice(snapshot.fingerprint);
      finishSignout();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.logoutFailed);
      setSessionBusy(false);
    }
  };

  const discardUnreadableAndLogout = async () => {
    const zh = resolvedLocale === "zh-CN";
    if (!await confirm({ title: zh ? "无法检查本机修改，仍然退出？" : "Sign out without checking local changes?", description: zh ? "浏览器存储不可用，无法检查或导出未同步修改、偏好与草稿。继续将放弃这些本机修改，并尝试清除本账户的本机资料；服务器资料保留。" : "Browser storage is unavailable, so unsynced changes, preferences and drafts cannot be checked or exported. Continuing discards those local changes and attempts to clear this account's local data. Server data remains.", confirmLabel: zh ? "放弃本机修改并退出" : "Discard local changes and sign out", danger: true })) return;
    setSessionBusy(true); setError("");
    try { await logoutCurrentDevice(undefined, true); finishSignout(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : copy.logoutFailed); setSessionBusy(false); }
  };

  const logoutOthers = async () => {
    if (!otherSessionCount || !(await confirm({
      title: copy.logoutOthersTitle,
      description: copy.logoutOthersDescription(otherSessionCount),
      confirmLabel: copy.logoutOthers,
      danger: true,
    }))) return;
    setSessionBusy(true);
    setError("");
    setNotice("");
    try {
      await logoutOtherDeviceSessions();
      setSessions(await getDeviceSessions());
      setNotice(copy.otherSessionsClosed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.sessionsFailed);
    } finally {
      setSessionBusy(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordBusy(true);
    setError("");
    try {
      await persistPreferenceDraft();
      const snapshot = await readOfflinePending();
      if (snapshot.count) { setPendingSignout({ snapshot, intent: "password" }); setPasswordBusy(false); return; }
      await changeOwnerPassword({ currentPassword: passwords.current, newPassword: passwords.next, confirmPassword: passwords.confirm }, snapshot.fingerprint);
      finishSignout();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.passwordFailed);
      setPasswordBusy(false);
    }
  };

  if (pendingSignout) return <PendingChangesPanel initial={pendingSignout.snapshot} onCancel={() => setPendingSignout(null)} onProceed={async (fingerprint) => {
    await persistPreferenceDraft();
    if (pendingSignout.intent === "password") await changeOwnerPassword({ currentPassword: passwords.current, newPassword: passwords.next, confirmPassword: passwords.confirm }, fingerprint);
    else await logoutCurrentDevice(fingerprint);
    finishSignout();
  }} />;
  return <section className={focused ? "space-y-6" : "space-y-3 border-t border-ui pt-3"} aria-label={copy.title}>
    <SettingsSection icon={UserRound} title={copy.identity} badge={profile ? (profile.role === "ADMIN" ? (resolvedLocale === "zh-CN" ? "系统管理员" : "Administrator") : (resolvedLocale === "zh-CN" ? "用户" : "User")) : undefined}>
      {loading ? <p className="text-sm text-secondary" role="status">{copy.loading}</p> : profile ? <form onSubmit={saveProfile} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><label className="block min-w-0 text-xs font-medium text-secondary">{copy.email}<input value={profile.email ?? ""} readOnly aria-readonly="true" className="input-base mt-1 min-h-10 w-full bg-subtle px-3 text-secondary" /></label>
        <label className="block text-xs font-medium text-secondary">{resolvedLocale === "zh-CN" ? "用户名" : "Username"}<input aria-label={copy.displayName} value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={200} className="input-base mt-1 min-h-10 w-full px-3 text-primary" placeholder={copy.displayNamePlaceholder} /></label></div>
        <div className="flex justify-end"><button type="submit" disabled={!profileDirty || profileBusy} className="btn-primary min-h-9 px-4 text-xs font-medium disabled:opacity-45">{profileBusy ? copy.saving : copy.saveProfile}</button></div>
      </form> : null}
    </SettingsSection>

    {profile?.role === "USER" ? <EmailChangePanel onDirtyChange={setEmailDirty} onRefreshProfile={refreshIdentity} /> : null}

    <SettingsSection icon={Laptop} title={copy.devices}>
      <div className="divide-y divide-[var(--border)] border-y border-ui">
        {sessions.map((session) => <div key={session.id} className="flex min-h-14 items-center gap-3 py-3">
          <Laptop className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium text-primary">{session.device_label}</p>{session.current ? <span className="rounded-sm bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-medium text-accent">{copy.currentDevice}</span> : null}</div><p className="mt-0.5 text-xs text-secondary">{copy.lastActive} {formatDate(session.last_activity_at, resolvedLocale)}</p></div>
        </div>)}
        {!loading && !sessions.length ? <p className="py-3 text-sm text-secondary">{copy.noSessions}</p> : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 pt-3">
        <button type="button" onClick={() => void load()} disabled={loading || sessionBusy} className="btn-secondary flex min-h-9 items-center gap-2 px-3 text-xs font-medium"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{copy.refresh}</button>
        <button type="button" onClick={() => void logoutOthers()} disabled={!otherSessionCount || sessionBusy} className="btn-secondary min-h-9 px-3 text-xs font-medium disabled:opacity-45">{copy.logoutOthers}</button>
      </div>
    </SettingsSection>

    <SettingsSection icon={KeyRound} title={copy.password}>
      <button type="button" onClick={() => setPasswordOpen((value) => !value)} aria-expanded={passwordOpen} className="btn-secondary min-h-9 px-3 text-xs font-medium">{passwordOpen ? copy.cancelPassword : copy.changePassword}</button>
      {passwordOpen ? <form onSubmit={changePassword} className="mt-3 space-y-3 bg-subtle p-3">
        <p className="text-xs text-secondary">{copy.passwordDescription}</p>
        <PasswordInput label={copy.currentPassword} autoComplete="current-password" value={passwords.current} onChange={(value) => setPasswords((state) => ({ ...state, current: value }))} />
        <PasswordInput label={copy.newPassword} autoComplete="new-password" value={passwords.next} onChange={(value) => setPasswords((state) => ({ ...state, next: value }))} minLength={12} />
        <PasswordInput label={copy.confirmPassword} autoComplete="new-password" value={passwords.confirm} onChange={(value) => setPasswords((state) => ({ ...state, confirm: value }))} minLength={12} />
        <button type="submit" disabled={passwordBusy} className="btn-primary min-h-10 w-full px-3 text-xs font-medium">{passwordBusy ? copy.saving : copy.changePasswordAndLogout}</button>
      </form> : null}
    </SettingsSection>

    <div className="border-t border-ui pt-4"><button type="button" onClick={() => void logout()} disabled={sessionBusy} className="flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--danger)] hover:underline"><LogOut className="h-4 w-4" aria-hidden="true" />{copy.logoutCurrent}</button></div>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {storageUnavailable ? <button type="button" disabled={sessionBusy} className="btn-secondary min-h-11 px-3 text-sm text-[var(--danger)]" onClick={() => void discardUnreadableAndLogout()}>{resolvedLocale === "zh-CN" ? "存储不可用时退出…" : "Sign out with unavailable storage…"}</button> : null}
    {notice ? <p role="status" className="text-sm text-accent">{notice}</p> : null}
  </section>;
}

function SettingsSection({ icon: Icon, title, badge, children }: { icon: typeof UserRound; title: string; badge?: string; children: React.ReactNode }) {
  return <section className="space-y-3"><div className="flex items-start gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-accent"><Icon className="h-4 w-4" aria-hidden="true" /></span><div className="flex min-h-8 flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-primary">{title}</h3>{badge ? <span className="rounded-md bg-subtle px-2 py-1 text-xs text-secondary">{badge}</span> : null}</div></div><div className="pl-0 sm:pl-11">{children}</div></section>;
}

function PasswordInput({ label, value, onChange, autoComplete, minLength }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; minLength?: number }) {
  return <label className="block text-xs font-medium text-secondary">{label}<input type="password" autoComplete={autoComplete} required minLength={minLength} maxLength={1024} className="input-base mt-1 min-h-10 w-full px-3" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function formatDate(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function accountCopy(zh: boolean) {
  return zh ? {
    title: "\u8d26\u6237\u4e0e\u5b89\u5168", identity: "\u8d26\u6237\u8eab\u4efd", identityDescription: "\u90ae\u7bb1\u7528\u4e8e\u767b\u5f55\uff1b\u663e\u793a\u540d\u79f0\u7528\u4e8e\u8bc6\u522b\u5f53\u524d\u8d26\u6237\u3002", email: "\u90ae\u7bb1", displayName: "\u663e\u793a\u540d\u79f0", displayNamePlaceholder: "\u53ef\u9009", saveProfile: "\u4fdd\u5b58\u8d26\u6237\u4fe1\u606f", profileSaved: "\u8d26\u6237\u4fe1\u606f\u5df2\u4fdd\u5b58\u3002", profileFailed: "\u65e0\u6cd5\u4fdd\u5b58\u8d26\u6237\u4fe1\u606f\u3002", devices: "\u5df2\u767b\u5f55\u8bbe\u5907", devicesDescription: "\u6bcf\u53f0\u8bbe\u5907\u4f7f\u7528\u72ec\u7acb\u4f1a\u8bdd\uff1b\u9000\u51fa\u5176\u4ed6\u8bbe\u5907\u4e0d\u4f1a\u4e2d\u65ad\u5f53\u524d\u8bbe\u5907\u3002", currentDevice: "\u5f53\u524d\u8bbe\u5907", lastActive: "\u6700\u8fd1\u6d3b\u52a8", noSessions: "\u6682\u65e0\u53ef\u663e\u793a\u7684\u8bbe\u5907\u4f1a\u8bdd\u3002", refresh: "\u5237\u65b0", logoutOthers: "\u9000\u51fa\u5176\u4ed6\u8bbe\u5907", logoutOthersTitle: "\u9000\u51fa\u5176\u4ed6\u8bbe\u5907\uff1f", logoutOthersDescription: (count: number) => "\u5c06\u7acb\u5373\u64a4\u9500 " + count + " \u4e2a\u5176\u4ed6\u8bbe\u5907\u4f1a\u8bdd\uff0c\u5f53\u524d\u8bbe\u5907\u4fdd\u6301\u767b\u5f55\u3002", otherSessionsClosed: "\u5176\u4ed6\u8bbe\u5907\u5df2\u9000\u51fa\u3002", sessionsFailed: "\u65e0\u6cd5\u66f4\u65b0\u8bbe\u5907\u4f1a\u8bdd\u3002", password: "\u5bc6\u7801", passwordDescription: "\u4fee\u6539\u5bc6\u7801\u4f1a\u64a4\u9500\u6240\u6709\u8bbe\u5907\u4f1a\u8bdd\uff0c\u5e76\u8981\u6c42\u91cd\u65b0\u767b\u5f55\u3002", changePassword: "\u4fee\u6539\u5bc6\u7801", cancelPassword: "\u6536\u8d77\u5bc6\u7801\u8868\u5355", currentPassword: "\u5f53\u524d\u5bc6\u7801", newPassword: "\u65b0\u5bc6\u7801", confirmPassword: "\u786e\u8ba4\u65b0\u5bc6\u7801", changePasswordAndLogout: "\u4fee\u6539\u5bc6\u7801\u5e76\u9000\u51fa\u6240\u6709\u8bbe\u5907", passwordFailed: "\u65e0\u6cd5\u4fee\u6539\u5bc6\u7801\u3002", logoutCurrent: "\u9000\u51fa\u5f53\u524d\u8d26\u6237", logoutFailed: "\u9000\u51fa\u5931\u8d25\u3002", loadFailed: "\u65e0\u6cd5\u52a0\u8f7d\u8d26\u6237\u4fe1\u606f\u3002", loading: "\u6b63\u5728\u52a0\u8f7d\u8d26\u6237\u4fe1\u606f\u2026", saving: "\u6b63\u5728\u4fdd\u5b58\u2026",
  } : {
    title: "Account & security", identity: "Account identity", identityDescription: "Your email signs you in; the display name identifies this account.", email: "Email", displayName: "Display name", displayNamePlaceholder: "Optional", saveProfile: "Save account details", profileSaved: "Account details saved.", profileFailed: "Unable to save account details.", devices: "Signed-in devices", devicesDescription: "Each device has its own session. Signing out other devices keeps this device active.", currentDevice: "Current device", lastActive: "Last active", noSessions: "No device sessions are available.", refresh: "Refresh", logoutOthers: "Log out other devices", logoutOthersTitle: "Log out other devices?", logoutOthersDescription: (count: number) => "This immediately revokes " + count + " other device " + (count === 1 ? "session" : "sessions") + ". This device stays signed in.", otherSessionsClosed: "Other devices have been logged out.", sessionsFailed: "Unable to update device sessions.", password: "Password", passwordDescription: "Changing your password revokes every device session and requires a fresh sign-in.", changePassword: "Change password", cancelPassword: "Collapse password form", currentPassword: "Current password", newPassword: "New password", confirmPassword: "Confirm new password", changePasswordAndLogout: "Change password and log out all devices", passwordFailed: "Unable to change password.", logoutCurrent: "Log out current account", logoutFailed: "Logout failed.", loadFailed: "Unable to load account details.", loading: "Loading account details...", saving: "Saving...",
  };
}
