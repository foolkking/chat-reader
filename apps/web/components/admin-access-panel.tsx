"use client";

import { Check, Clipboard, KeyRound, Link2, Search, UserRound, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAccessInvitation,
  createUserPasswordReset,
  getAccessInvitations,
  getAccessOverview,
  getAccessUsers,
  getAccountProfile,
  revokeAccessInvitation,
  setRegistrationMode,
  updateAccessUserStatus,
  type AccessInvitation,
  type AccessOverview,
  type AccessUser,
} from "../lib/account-access-client";
import type { RegistrationMode } from "../lib/auth-client";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

type AccessTab = "users" | "registration" | "invitations";

export function AdminAccessPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const { confirm } = useInteractionDialog();
  const copy = useMemo(() => adminCopy(resolvedLocale === "zh-CN"), [resolvedLocale]);
  const [tab, setTab] = useState<AccessTab>("users");
  const [overview, setOverview] = useState<AccessOverview | null>(null);
  const [registration, setRegistration] = useState<RegistrationMode>("CLOSED");
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [invitations, setInvitations] = useState<AccessInvitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [inviteHours, setInviteHours] = useState(168);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [oneTimeLink, setOneTimeLink] = useState<{ label: string; url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      const [nextOverview, nextUsers, nextInvitations, profile] = await Promise.all([
        getAccessOverview(), getAccessUsers(), getAccessInvitations(), getAccountProfile(),
      ]);
      setOverview(nextOverview);
      setRegistration(nextOverview.registration_mode);
      setUsers(nextUsers);
      setInvitations(nextInvitations);
      setCurrentUserId(profile.user_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.loadFailed);
    } finally {
      setBusy("");
    }
  }, [copy.loadFailed]);

  useEffect(() => { void load(); }, [load]);
  const registrationDirty = overview !== null && registration !== overview.registration_mode;
  useEffect(() => { onDirtyChange?.(registrationDirty); }, [onDirtyChange, registrationDirty]);

  const saveRegistration = async () => {
    setBusy("registration");
    setError("");
    setNotice("");
    try {
      const result = await setRegistrationMode(registration);
      setOverview((current) => current ? { ...current, registration_mode: result.registration_mode } : current);
      setNotice(copy.registrationSaved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.registrationFailed);
    } finally {
      setBusy("");
    }
  };

  const toggleUser = async (user: AccessUser) => {
    const nextStatus = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    const disabling = nextStatus === "DISABLED";
    if (disabling && !(await confirm({
      title: copy.disableTitle(user.display_name || user.email),
      description: copy.disableDescription,
      confirmLabel: copy.disable,
      danger: true,
    }))) return;
    setBusy(user.id);
    setError("");
    try {
      const result = await updateAccessUserStatus(user.id, nextStatus);
      setUsers((items) => items.map((item) => item.id === user.id ? { ...item, status: result.status } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.userFailed);
    } finally {
      setBusy("");
    }
  };

  const createReset = async (user: AccessUser) => {
    if (!(await confirm({ title: copy.resetTitle(user.display_name || user.email), description: copy.resetDescription, confirmLabel: copy.createReset }))) return;
    setBusy("reset:" + user.id);
    setError("");
    try {
      const result = await createUserPasswordReset(user.id);
      if (result.reset_url) setOneTimeLink({ label: copy.resetLink, url: result.reset_url, expiresAt: result.expires_at });
      setTab("users");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.resetFailed);
    } finally {
      setBusy("");
    }
  };

  const createInvitation = async () => {
    setBusy("invitation");
    setError("");
    try {
      const result = await createAccessInvitation(inviteHours);
      if (result.invite_url) setOneTimeLink({ label: copy.inviteLink, url: result.invite_url, expiresAt: result.expires_at });
      setInvitations(await getAccessInvitations());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.inviteFailed);
    } finally {
      setBusy("");
    }
  };

  const revokeInvitation = async (invitation: AccessInvitation) => {
    if (!(await confirm({ title: copy.revokeTitle, description: copy.revokeDescription, confirmLabel: copy.revoke, danger: true }))) return;
    setBusy(invitation.id);
    setError("");
    try {
      await revokeAccessInvitation(invitation.id);
      setInvitations((items) => items.map((item) => item.id === invitation.id ? { ...item, status: "REVOKED" } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.revokeFailed);
    } finally {
      setBusy("");
    }
  };

  const copyLink = async () => {
    if (!oneTimeLink) return;
    try {
      await navigator.clipboard.writeText(oneTimeLink.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(copy.copyFailed);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLocaleLowerCase();
    if (!query) return users;
    return users.filter((user) => [user.email, user.display_name ?? "", user.role, user.status].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [userQuery, users]);
  const activeUsers = users.filter((user) => user.status === "ACTIVE").length;
  const disabledUsers = users.length - activeUsers;

  return <section className="space-y-4" aria-label={copy.title}>
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-accent"><UsersRound className="h-4 w-4" aria-hidden="true" /></span><div><h3 className="text-sm font-semibold text-primary">{copy.instanceAccess}</h3><p className="mt-0.5 text-xs leading-5 text-secondary">{copy.description}</p></div></div>

    <div className="grid grid-cols-3 border-b border-ui" role="tablist" aria-label={copy.title}>
      {(["users", "registration", "invitations"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={"min-h-10 border-b-2 px-2 text-xs font-medium " + (tab === value ? "border-[var(--accent)] text-primary" : "border-transparent text-secondary hover:text-primary")}>{copy.tabs[value]}</button>)}
    </div>

    {oneTimeLink ? <div className="border border-[var(--accent)] bg-[var(--accent-soft)] p-3" role="status">
      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-primary">{oneTimeLink.label}</p><p className="mt-1 text-xs leading-5 text-secondary">{copy.oneTimeHint} {copy.expires} {formatDate(oneTimeLink.expiresAt, resolvedLocale)}</p></div><button type="button" onClick={() => setOneTimeLink(null)} className="text-xs font-medium text-secondary hover:text-primary">{copy.dismiss}</button></div>
      <div className="mt-3 flex gap-2"><input readOnly value={oneTimeLink.url} aria-label={oneTimeLink.label} className="input-base min-h-10 min-w-0 flex-1 px-3 text-xs" /><button type="button" onClick={() => void copyLink()} className="btn-secondary flex min-h-10 shrink-0 items-center gap-2 px-3 text-xs font-medium">{copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copied ? copy.copied : copy.copy}</button></div>
    </div> : null}

    {tab === "users" ? <div role="tabpanel" className="space-y-3">
      <div className="grid grid-cols-3 gap-2" aria-label={resolvedLocale === "zh-CN" ? "用户概览" : "User summary"}>
        <SummaryStat label={resolvedLocale === "zh-CN" ? "用户总数" : "Total users"} value={users.length} />
        <SummaryStat label={resolvedLocale === "zh-CN" ? "可用用户" : "Active"} value={activeUsers} />
        <SummaryStat label={resolvedLocale === "zh-CN" ? "已禁用" : "Disabled"} value={disabledUsers} />
      </div>
      <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" aria-hidden="true" /><span className="sr-only">{resolvedLocale === "zh-CN" ? "搜索用户" : "Search users"}</span><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} className="input-base min-h-10 w-full pl-9 pr-9 text-sm" placeholder={resolvedLocale === "zh-CN" ? "搜索用户" : "Search users"} aria-label={resolvedLocale === "zh-CN" ? "搜索用户" : "Search users"} />{userQuery ? <button type="button" onClick={() => setUserQuery("")} aria-label={resolvedLocale === "zh-CN" ? "清除搜索" : "Clear search"} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-secondary hover:bg-subtle hover:text-primary"><X className="h-4 w-4" /></button> : null}</label>
      <div className="divide-y divide-[var(--border)]">
      {filteredUsers.map((user) => <div key={user.id} className={`py-4 ${selectedUserId === user.id ? "-mx-2 rounded-lg bg-subtle px-2" : ""}`}>
        <div className="flex items-start gap-3"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-primary">{user.display_name || user.email}</p><StateLabel tone={user.status === "ACTIVE" ? "accent" : "muted"}>{user.status === "ACTIVE" ? copy.active : copy.disabled}</StateLabel>{user.role === "ADMIN" ? <StateLabel tone="neutral">{copy.admin}</StateLabel> : null}{user.id === currentUserId ? <StateLabel tone="accent">{copy.you}</StateLabel> : null}</div>{user.display_name ? <p className="mt-0.5 truncate text-xs text-secondary">{user.email}</p> : null}<p className="mt-1 text-xs text-secondary">{copy.joined} {formatDate(user.created_at, resolvedLocale)}</p></div></div>
        <div className="mt-3 flex flex-wrap justify-end gap-2 pl-7"><button type="button" onClick={() => setSelectedUserId((current) => current === user.id ? null : user.id)} className="btn-secondary min-h-9 px-3 text-xs font-medium">{selectedUserId === user.id ? (resolvedLocale === "zh-CN" ? "收起详情" : "Hide details") : (resolvedLocale === "zh-CN" ? "查看详情" : "View details")}</button>{user.id !== currentUserId ? <><button type="button" onClick={() => void createReset(user)} disabled={Boolean(busy)} className="btn-secondary flex min-h-9 items-center gap-2 px-3 text-xs font-medium"><KeyRound className="h-3.5 w-3.5" />{copy.createReset}</button><button type="button" onClick={() => void toggleUser(user)} disabled={Boolean(busy)} className={"min-h-9 px-3 text-xs font-medium " + (user.status === "ACTIVE" ? "text-[var(--danger)]" : "text-accent")}>{user.status === "ACTIVE" ? copy.disable : copy.enable}</button></> : null}</div>
        {selectedUserId === user.id ? <UserDetails user={user} locale={resolvedLocale} zh={resolvedLocale === "zh-CN"} /> : null}
      </div>)}
      {!filteredUsers.length && busy !== "load" ? <p className="py-5 text-sm text-secondary">{userQuery ? (resolvedLocale === "zh-CN" ? "没有匹配的用户。" : "No matching users.") : copy.noUsers}</p> : null}
      </div>
    </div> : null}

    {tab === "registration" ? <div role="tabpanel" className="space-y-4">
      <div className="grid grid-cols-3 rounded-lg bg-subtle p-1">{(["CLOSED", "INVITE_ONLY", "OPEN"] as const).map((mode) => <button key={mode} type="button" onClick={() => setRegistration(mode)} aria-pressed={registration === mode} className={"min-h-9 rounded-md px-2 text-xs " + (registration === mode ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary hover:text-primary")}>{copy.modes[mode]}</button>)}</div>
      <p className="text-sm leading-6 text-secondary">{copy.modeDescriptions[registration]}</p>
      {registration === "OPEN" ? <p className="border-l-2 border-[var(--warning)] pl-3 text-xs leading-5 text-secondary">{copy.openWarning}</p> : null}
      <p className="text-xs text-secondary">{overview?.smtp_configured ? copy.smtpReady : copy.smtpMissing}</p>
      <div className="flex justify-end"><button type="button" onClick={() => void saveRegistration()} disabled={!registrationDirty || busy === "registration"} className="btn-primary min-h-10 px-4 text-xs font-medium disabled:opacity-45">{busy === "registration" ? copy.saving : copy.saveRegistration}</button></div>
    </div> : null}

    {tab === "invitations" ? <div role="tabpanel" className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 border-b border-ui pb-4"><label className="min-w-36 flex-1 text-xs font-medium text-secondary">{copy.validFor}<input type="number" min={1} max={2160} value={inviteHours} onChange={(event) => setInviteHours(Math.max(1, Math.min(2160, Number(event.target.value) || 1)))} className="input-base mt-1 min-h-10 w-full px-3" /></label><button type="button" onClick={() => void createInvitation()} disabled={busy === "invitation"} className="btn-primary flex min-h-10 items-center gap-2 px-4 text-xs font-medium"><Link2 className="h-4 w-4" />{busy === "invitation" ? copy.creating : copy.createInvitation}</button></div>
      <div className="divide-y divide-[var(--border)]">{invitations.map((invitation) => <div key={invitation.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-medium text-primary">{copy.invitation}</p><StateLabel tone={invitation.status === "PENDING" ? "accent" : "muted"}>{copy.invitationStates[invitation.status]}</StateLabel></div><p className="mt-1 text-xs text-secondary">{copy.expires} {formatDate(invitation.expires_at, resolvedLocale)}</p></div>{invitation.status === "PENDING" ? <button type="button" onClick={() => void revokeInvitation(invitation)} disabled={Boolean(busy)} className="min-h-9 px-2 text-xs font-medium text-[var(--danger)]">{copy.revoke}</button> : null}</div>)}</div>
      {!invitations.length && busy !== "load" ? <p className="py-4 text-sm text-secondary">{copy.noInvitations}</p> : null}
    </div> : null}

    {busy === "load" ? <p role="status" className="text-sm text-secondary">{copy.loading}</p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-accent">{notice}</p> : null}
  </section>;
}

function StateLabel({ tone, children }: { tone: "accent" | "muted" | "neutral"; children: React.ReactNode }) {
  const className = tone === "accent" ? "bg-[var(--accent-soft)] text-accent" : tone === "neutral" ? "bg-subtle text-primary" : "bg-subtle text-secondary";
  return <span className={"rounded-sm px-1.5 py-0.5 text-[11px] font-medium " + className}>{children}</span>;
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-ui bg-subtle px-3 py-2"><p className="text-[11px] text-secondary">{label}</p><p className="mt-0.5 text-lg font-semibold text-primary" aria-label={`${label}: ${value}`}>{value}</p></div>;
}

function UserDetails({ user, locale, zh }: { user: AccessUser; locale: "zh-CN" | "en-US"; zh: boolean }) {
  return <section className="mt-3 rounded-lg border border-ui bg-subtle p-3" aria-label={zh ? "用户详情" : "User details"}>
    <div className="mb-2 flex items-center justify-between gap-3"><h4 className="text-xs font-semibold text-primary">{zh ? "用户详情" : "User details"}</h4><span className="truncate text-[11px] text-secondary" title={user.id}>{user.id}</span></div>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt className="text-secondary">{zh ? "邮箱" : "Email"}</dt><dd className="truncate text-primary">{user.email}</dd><dt className="text-secondary">{zh ? "状态" : "Status"}</dt><dd className="text-primary">{user.status === "ACTIVE" ? (zh ? "可用" : "Active") : (zh ? "已禁用" : "Disabled")}</dd><dt className="text-secondary">{zh ? "创建于" : "Created"}</dt><dd className="text-primary">{formatDate(user.created_at, locale)}</dd></dl>
    <p className="mt-2 text-[11px] leading-5 text-secondary">{zh ? "详情仅供查看。管理操作会记录并按需要撤销会话。" : "Read-only details. Administrative actions are logged and revoke sessions when required."}</p>
  </section>;
}

function formatDate(value: string, locale: "zh-CN" | "en-US") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function adminCopy(zh: boolean) {
  const common = {
    tabs: zh ? { users: "\u7528\u6237", registration: "\u6ce8\u518c", invitations: "\u9080\u8bf7" } : { users: "Users", registration: "Registration", invitations: "Invitations" },
    modes: zh ? { CLOSED: "\u5173\u95ed", INVITE_ONLY: "\u4ec5\u9080\u8bf7", OPEN: "\u5f00\u653e" } : { CLOSED: "Closed", INVITE_ONLY: "Invite only", OPEN: "Open" },
    invitationStates: zh ? { PENDING: "\u5f85\u4f7f\u7528", USED: "\u5df2\u4f7f\u7528", EXPIRED: "\u5df2\u8fc7\u671f", REVOKED: "\u5df2\u64a4\u9500" } : { PENDING: "Pending", USED: "Used", EXPIRED: "Expired", REVOKED: "Revoked" },
  };
  return zh ? {
    ...common, title: "\u7528\u6237\u4e0e\u8bbf\u95ee", instanceAccess: "\u5b9e\u4f8b\u8bbf\u95ee", description: "\u7ba1\u7406\u8c01\u53ef\u4ee5\u767b\u5f55\u6b64 Chat Reader \u5b9e\u4f8b\uff0c\u4ee5\u53ca\u5982\u4f55\u521b\u5efa\u65b0\u8d26\u6237\u3002", loadFailed: "\u65e0\u6cd5\u52a0\u8f7d\u8bbf\u95ee\u8bbe\u7f6e\u3002", loading: "\u6b63\u5728\u52a0\u8f7d\u8bbf\u95ee\u8bbe\u7f6e\u2026", active: "\u53ef\u7528", disabled: "\u5df2\u7981\u7528", admin: "\u7ba1\u7406\u5458", you: "\u5f53\u524d\u8d26\u6237", joined: "\u521b\u5efa\u4e8e", disable: "\u7981\u7528\u8d26\u6237", enable: "\u542f\u7528\u8d26\u6237", disableTitle: (name: string) => "\u7981\u7528 " + name + "\uff1f", disableDescription: "\u8be5\u7528\u6237\u7684\u73b0\u6709\u4f1a\u8bdd\u5c06\u88ab\u64a4\u9500\uff0c\u4f46\u4e0d\u4f1a\u5220\u9664\u5176\u6570\u636e\u3002", userFailed: "\u65e0\u6cd5\u66f4\u65b0\u7528\u6237\u72b6\u6001\u3002", createReset: "\u521b\u5efa\u91cd\u7f6e\u94fe\u63a5", resetTitle: (name: string) => "\u4e3a " + name + " \u521b\u5efa\u5bc6\u7801\u91cd\u7f6e\u94fe\u63a5\uff1f", resetDescription: "\u94fe\u63a5\u53ea\u663e\u793a\u4e00\u6b21\uff0c\u8bf7\u901a\u8fc7\u5b89\u5168\u6e20\u9053\u4ea4\u7ed9\u8be5\u7528\u6237\u3002", resetLink: "\u4e00\u6b21\u6027\u5bc6\u7801\u91cd\u7f6e\u94fe\u63a5", resetFailed: "\u65e0\u6cd5\u521b\u5efa\u91cd\u7f6e\u94fe\u63a5\u3002", noUsers: "\u6682\u65e0\u7528\u6237\u3002", modeDescriptions: { CLOSED: "\u4e0d\u63a5\u53d7\u65b0\u8d26\u6237\u3002\u73b0\u6709\u7528\u6237\u53ef\u7ee7\u7eed\u767b\u5f55\u3002", INVITE_ONLY: "\u53ea\u6709\u6301\u6709\u6709\u6548\u9080\u8bf7\u94fe\u63a5\u7684\u4eba\u53ef\u4ee5\u521b\u5efa\u8d26\u6237\u3002", OPEN: "\u4efb\u4f55\u80fd\u8bbf\u95ee\u6ce8\u518c\u9875\u7684\u4eba\u90fd\u53ef\u4ee5\u521b\u5efa\u8d26\u6237\u3002" }, openWarning: "\u5f00\u653e\u6ce8\u518c\u4f1a\u6269\u5927\u5b9e\u4f8b\u8bbf\u95ee\u8303\u56f4\u3002\u4ec5\u5728\u5165\u53e3\u548c\u6570\u636e\u6743\u9650\u5df2\u786e\u8ba4\u65f6\u4f7f\u7528\u3002", smtpReady: "\u90ae\u4ef6\u670d\u52a1\u5df2\u914d\u7f6e\uff0c\u7528\u6237\u53ef\u4ee5\u8bf7\u6c42\u5bc6\u7801\u91cd\u7f6e\u3002", smtpMissing: "\u90ae\u4ef6\u670d\u52a1\u672a\u914d\u7f6e\uff1b\u7ba1\u7406\u5458\u4ecd\u53ef\u521b\u5efa\u4e00\u6b21\u6027\u91cd\u7f6e\u94fe\u63a5\u3002", saveRegistration: "\u4fdd\u5b58\u6ce8\u518c\u6a21\u5f0f", saving: "\u6b63\u5728\u4fdd\u5b58\u2026", registrationSaved: "\u6ce8\u518c\u6a21\u5f0f\u5df2\u66f4\u65b0\u3002", registrationFailed: "\u65e0\u6cd5\u66f4\u65b0\u6ce8\u518c\u6a21\u5f0f\u3002", validFor: "\u6709\u6548\u5c0f\u65f6\u6570", createInvitation: "\u521b\u5efa\u9080\u8bf7", creating: "\u6b63\u5728\u521b\u5efa\u2026", invitation: "\u8d26\u6237\u9080\u8bf7", inviteLink: "\u4e00\u6b21\u6027\u9080\u8bf7\u94fe\u63a5", inviteFailed: "\u65e0\u6cd5\u521b\u5efa\u9080\u8bf7\u3002", expires: "\u8fc7\u671f\u65f6\u95f4", revoke: "\u64a4\u9500", revokeTitle: "\u64a4\u9500\u6b64\u9080\u8bf7\uff1f", revokeDescription: "\u672a\u4f7f\u7528\u7684\u94fe\u63a5\u5c06\u7acb\u5373\u5931\u6548\u3002", revokeFailed: "\u65e0\u6cd5\u64a4\u9500\u9080\u8bf7\u3002", noInvitations: "\u5c1a\u672a\u521b\u5efa\u9080\u8bf7\u3002", oneTimeHint: "\u5173\u95ed\u540e\u4e0d\u4f1a\u518d\u663e\u793a\u5b8c\u6574\u94fe\u63a5\u3002", copy: "\u590d\u5236", copied: "\u5df2\u590d\u5236", copyFailed: "\u65e0\u6cd5\u590d\u5236\u94fe\u63a5\u3002", dismiss: "\u5b8c\u6210",
  } : {
    ...common, title: "Users & access", instanceAccess: "Instance access", description: "Control who can sign in to this Chat Reader instance and how new accounts are created.", loadFailed: "Unable to load access settings.", loading: "Loading access settings...", active: "Active", disabled: "Disabled", admin: "Administrator", you: "Current account", joined: "Created", disable: "Disable account", enable: "Enable account", disableTitle: (name: string) => "Disable " + name + "?", disableDescription: "Existing sessions will be revoked, but this does not delete the user's data.", userFailed: "Unable to update user status.", createReset: "Create reset link", resetTitle: (name: string) => "Create a password reset link for " + name + "?", resetDescription: "The link is shown once. Share it with the user through a secure channel.", resetLink: "One-time password reset link", resetFailed: "Unable to create reset link.", noUsers: "No users found.", modeDescriptions: { CLOSED: "No new accounts are accepted. Existing users can still sign in.", INVITE_ONLY: "Only people with a valid invitation link can create an account.", OPEN: "Anyone who can reach the registration page can create an account." }, openWarning: "Open registration expands access to this instance. Use it only when the entry point and data permissions are understood.", smtpReady: "Email delivery is configured, so users can request password resets.", smtpMissing: "Email delivery is not configured. Administrators can still create one-time reset links.", saveRegistration: "Save registration mode", saving: "Saving...", registrationSaved: "Registration mode updated.", registrationFailed: "Unable to update registration mode.", validFor: "Valid for (hours)", createInvitation: "Create invitation", creating: "Creating...", invitation: "Account invitation", inviteLink: "One-time invitation link", inviteFailed: "Unable to create invitation.", expires: "Expires", revoke: "Revoke", revokeTitle: "Revoke this invitation?", revokeDescription: "The unused link will stop working immediately.", revokeFailed: "Unable to revoke invitation.", noInvitations: "No invitations have been created.", oneTimeHint: "The complete link will not be shown again after dismissal.", copy: "Copy", copied: "Copied", copyFailed: "Unable to copy the link.", dismiss: "Done",
  };
}
