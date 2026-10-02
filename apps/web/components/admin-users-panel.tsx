"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Search, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { adminApi, type AdminUser } from "../lib/admin-client";
import { getTask, retryTask } from "../lib/api";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";
import { AdminUserContent } from "./admin-user-content";
import { AdminContentSearch } from "./admin-content-search";

export const adminButton = "btn-secondary min-h-11 px-3 text-sm";
const pending = (status?: string) => !!status && ["queued", "processing", "cancelling"].includes(status);
export function AdminPageControls({ offset, total, onPage, busy, zh }: { offset: number; total: number; onPage: (offset: number) => void; busy: boolean; zh: boolean }) {
  return <nav aria-label={zh ? "分页" : "Pagination"} className="flex flex-wrap items-center justify-between gap-2 border-t border-ui pt-3">
    <span className="text-xs text-secondary">{total ? `${offset + 1}–${Math.min(offset + 20, total)} / ${total}` : (zh ? "0 项" : "0 items")}</span>
    <div className="flex gap-2"><button className={adminButton} disabled={busy || offset === 0} onClick={() => onPage(Math.max(0, offset - 20))}>{zh ? "上一页" : "Previous"}</button><button className={adminButton} disabled={busy || offset + 20 >= total} onClick={() => onPage(offset + 20)}>{zh ? "下一页" : "Next"}</button></div>
  </nav>;
}

function statusLabel(user: AdminUser, zh: boolean) {
  if (pending(user.deletion?.status)) return zh ? "删除中" : "Deleting";
  if (user.deletion?.status === "failed") return zh ? "删除失败" : "Deletion failed";
  if (user.status === "DISABLED") return zh ? "已禁用" : "Disabled";
  if (user.approval_status === "REJECTED") return zh ? "已拒绝" : "Rejected";
  if (user.approval_status === "PENDING") return zh ? "待审批" : "Awaiting approval";
  if (user.email_verification_required && !user.email_verified_at) return zh ? "待验证邮箱" : "Awaiting verification";
  return user.can_login ? (zh ? "可登录" : "Active") : (zh ? "未激活" : "Pending");
}

export function AdminUsersPanelEnhanced({ initialUserId }: { initialUserId?: string } = {}) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [draft, setDraft] = useState(""), [q, setQ] = useState(""), [state, setState] = useState("ALL"), [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialUserId ?? null), [notice, setNotice] = useState("");
  const root = useRef<HTMLElement>(null), returnTo = useRef({ id: "", scroll: 0 });
  const users = useQuery({ queryKey: ["admin-users", q, state, offset], queryFn: () => adminApi.userPage(q, state, offset), retry: false,
    refetchInterval: (query) => query.state.data?.items.some((item) => pending(item.deletion?.status)) ? 2000 : false, refetchIntervalInBackground: false });
  function open(user: AdminUser) {
    returnTo.current = { id: user.id, scroll: root.current?.closest<HTMLElement>('[data-settings-scroll-root="true"]')?.scrollTop ?? 0 };
    setNotice(""); setSelected(user.id);
  }
  function back(deleted = false) {
    setSelected(null);
    if (deleted) { setNotice(zh ? "账户与私有内容已删除，共享资料已保留。" : "Account and private content deleted. Shared resources were preserved."); void client.invalidateQueries({ queryKey: ["admin-users"] }); }
    requestAnimationFrame(() => {
      const scroll = root.current?.closest<HTMLElement>('[data-settings-scroll-root="true"]');
      if (scroll) scroll.scrollTop = returnTo.current.scroll;
      (root.current?.querySelector<HTMLElement>(`[data-user-detail="${returnTo.current.id}"]`) ?? root.current)?.focus({ preventScroll: true });
    });
  }
  return <section ref={root} tabIndex={-1} className="space-y-4 outline-none" aria-label={zh ? "用户" : "Users"}>
    {selected ? <AdminUserDetail key={selected} id={selected} zh={zh} onBack={back} /> : <>
      <div><h3 className="text-sm font-semibold text-primary">{zh ? "用户" : "Users"}</h3><p className="mt-1 text-sm text-secondary">{zh ? "查找账户，审核访问权限，按需查看资料。" : "Find accounts, review access and inspect content when needed."}</p></div>
      {notice ? <p role="status" className="flex gap-2 text-sm text-primary"><CheckCircle2 aria-hidden className="h-5 w-5 shrink-0 text-accent" />{notice}</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); setQ(draft.trim()); setOffset(0); }} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-[2] basis-48 text-xs text-secondary">{zh ? "邮箱或名称" : "Email or name"}<div className="mt-1 flex"><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={200} className="input-base min-h-11 w-full min-w-0 px-3 text-base" /><button type="submit" className={adminButton} aria-label={zh ? "搜索用户" : "Search users"}><Search aria-hidden className="h-4 w-4" /></button></div></label>
        <label className="min-w-0 flex-1 basis-36 text-xs text-secondary">{zh ? "账户状态" : "Account status"}<select value={state} onChange={(event) => { setState(event.target.value); setOffset(0); }} className="input-base mt-1 min-h-11 w-full px-3 text-sm">{[["ALL", "全部", "All"], ["ACTIVE", "可登录", "Active"], ["PENDING", "待审批", "Awaiting approval"], ["UNVERIFIED", "待验证邮箱", "Awaiting verification"], ["REJECTED", "已拒绝", "Rejected"], ["DISABLED", "已禁用", "Disabled"]].map(([value, cn, en]) => <option value={value} key={value}>{zh ? cn : en}</option>)}</select></label>
      </form>
      <AdminContentSearch zh={zh} />
      {users.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取用户…" : "Loading accounts…"}</p> : null}
      {users.isError ? <AdminLoadError zh={zh} onRetry={() => void users.refetch()} /> : null}
      {users.data ? <><div className="divide-y divide-[var(--border)] border-t border-ui">{users.data.items.map((user) => <div key={user.id} className="flex items-center gap-3 py-4">
        {user.role === "ADMIN" ? <ShieldCheck className="h-5 w-5 shrink-0 text-accent" aria-hidden /> : <UserRound className="h-5 w-5 shrink-0 text-secondary" aria-hidden />}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="break-all text-sm font-semibold text-primary">{user.display_name || user.email || (zh ? "未设置邮箱" : "Email not set")}</span><span className="text-xs text-secondary">{user.role === "ADMIN" ? "Root Admin" : statusLabel(user, zh)}</span></div><p className="mt-1 break-all text-xs text-secondary">{user.display_name ? `${user.email ?? ""} · ` : ""}{user.stats.conversations} {zh ? "对话" : "conversations"} · {user.stats.attachments} {zh ? "附件" : "attachments"}</p></div>
        <button data-user-detail={user.id} className="btn-ghost inline-flex min-h-11 shrink-0 items-center gap-1 px-2 text-sm" onClick={() => open(user)} aria-label={`${zh ? "查看账户" : "View account"}: ${user.display_name || user.email}`}><span>{zh ? "详情" : "Details"}</span><ArrowRight className="h-4 w-4" aria-hidden /></button>
      </div>)}</div>{!users.data.items.length ? <div className="py-6 text-sm text-secondary">{zh ? "没有匹配的账户。可以调整搜索词或状态。" : "No matching accounts. Adjust your search or status."}{offset > 0 ? <button className={`${adminButton} ml-2`} onClick={() => setOffset(0)}>{zh ? "回到首页" : "First page"}</button> : null}</div> : null}<AdminPageControls offset={offset} total={users.data.total} onPage={setOffset} busy={users.isFetching} zh={zh} /></> : null}
    </>}
  </section>;
}

export function AdminLoadError({ zh, onRetry }: { zh: boolean; onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-3 border-l-2 border-[var(--danger)] pl-3 text-sm text-[var(--danger)]"><span>{zh ? "暂时无法读取，请检查连接后重试。" : "Unable to load. Check your connection and retry."}</span><button className={adminButton} onClick={onRetry}>{zh ? "重试" : "Retry"}</button></div>;
}

function AdminUserDetail({ id, zh, onBack }: { id: string; zh: boolean; onBack: (deleted?: boolean) => void }) {
  const client = useQueryClient(), { confirm } = useInteractionDialog();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reset, setReset] = useState<{ reset_url: string; expires_at: string } | null>(null);
  const [impact, setImpact] = useState<Record<string, number | string> | null>(null), [content, setContent] = useState(false);
  const deleteKey = useRef(""), title = useRef<HTMLHeadingElement>(null), resetInput = useRef<HTMLInputElement>(null), dangerHeading = useRef<HTMLHeadingElement>(null);
  const user = useQuery({ queryKey: ["admin-user", id], queryFn: () => adminApi.user(id), retry: false });
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const taskId = queuedId ?? user.data?.deletion?.job_id;
  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => getTask(taskId!), enabled: !!taskId, retry: false,
    refetchInterval: (query) => pending(query.state.data?.status) ? 1500 : false, refetchIntervalInBackground: false });
  const onBackRef = useRef(onBack); onBackRef.current = onBack;
  useEffect(() => { title.current?.focus(); }, [user.isSuccess]);
  useEffect(() => { if (task.data?.status === "committed") onBackRef.current(true); }, [task.data?.status]);
  useEffect(() => {
    if (!impact) return;
    const scroll = dangerHeading.current?.closest<HTMLElement>('[data-settings-scroll-root="true"]');
    if (scroll) scroll.scrollTop = 0;
    dangerHeading.current?.focus({ preventScroll: true });
  }, [impact]);
  useEffect(() => { if (reset) resetInput.current?.focus(); }, [reset]);
  async function act(work: () => Promise<unknown>, done: string) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try { await work(); setNotice(done); await Promise.all([user.refetch(), client.invalidateQueries({ queryKey: ["admin-users"] }), client.invalidateQueries({ queryKey: ["active-tasks"] }), taskId ? task.refetch() : Promise.resolve()]); }
    catch { setError(zh ? "操作未完成。请重试；已提交的删除任务会自动关联。" : "The action did not finish. Retry; an accepted deletion will be reattached."); void user.refetch(); }
    finally { setBusy(false); }
  }
  const row = user.data, deletion = task.data ?? row?.deletion ?? (queuedId ? { job_id: queuedId, status: "queued", phase: "queued", progress: 0 } : undefined);
  const deleting = pending(deletion?.status), failed = deletion?.status === "failed";
  const locked = busy || deleting || failed;
  async function reject() {
    if (await confirm({ title: zh ? "拒绝注册？" : "Reject registration?", description: zh ? "该账户将不能登录。" : "This account will be unable to sign in.", confirmLabel: zh ? "拒绝" : "Reject", danger: true })) await act(() => adminApi.rejectUser(id), zh ? "注册已拒绝。" : "Registration rejected.");
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString(zh ? "zh-CN" : "en") : "—";
  if (row && impact) return <section className="space-y-5" aria-label={zh ? "删除账户确认" : "Account deletion confirmation"}>
    <button className="btn-ghost inline-flex min-h-11 items-center gap-2 px-2 text-sm" disabled={busy} onClick={() => setImpact(null)}><ArrowLeft className="h-4 w-4" aria-hidden />{zh ? "返回账户详情" : "Back to account"}</button>
    <header><h3 ref={dangerHeading} tabIndex={-1} className="text-lg font-semibold text-primary outline-none">{zh ? "确认删除范围" : "Confirm deletion scope"}</h3><p className="mt-2 break-all text-sm text-secondary">{row.display_name || row.email}<br />{row.display_name ? row.email : null}</p></header>
    <p className="border-l-2 border-[var(--danger)] pl-3 text-sm leading-relaxed text-secondary">{zh ? "永久删除账户及下列私有资料，归档内容也包括在内。确认后立即锁定账户，后台任务不可撤销。" : "Permanently delete this account and the private data below, including archived content. Confirmation locks the account immediately. The background task cannot be cancelled."}</p>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-y border-ui py-4">{[["projects", zh ? "项目" : "Projects"], ["conversations", zh ? "对话" : "Conversations"], ["attachments", zh ? "附件引用" : "Attachment references"], ["background_tasks", zh ? "后台任务" : "Background tasks"], ["skills", "Skills"], ["annotations", zh ? "批注" : "Annotations"], ["notebooks", zh ? "笔记" : "Notebooks"], ["format_grants", zh ? "格式授权" : "Format grants"], ["rule_grants", zh ? "规则授权" : "Rule grants"]].map(([key, name]) => <div key={key}><dt className="text-xs text-secondary">{name}</dt><dd className="mt-1 text-sm font-semibold text-primary">{impact[key] ?? 0}</dd></div>)}</dl>
    <p className="text-sm leading-relaxed text-secondary">{zh ? "个人偏好、阅读位置和会话也会移除。其他用户仍引用的附件、格式和规则继续保留；执行失败可重试。" : "Preferences, reading positions and sessions are also removed. Attachments, formats and rules used by others remain. Failed deletion can be retried."}</p>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    <footer className="flex flex-wrap justify-end gap-3 border-t border-ui pt-4"><button className={adminButton} disabled={busy} onClick={() => setImpact(null)}>{zh ? "取消" : "Cancel"}</button><button className="btn-danger min-h-11 px-4 text-sm" disabled={busy} onClick={() => void act(async () => { const queued = await adminApi.deleteUser(id, deleteKey.current); setQueuedId(queued.job_id); setImpact(null); }, zh ? "删除已加入队列，等待后台结果。" : "Deletion queued; waiting for the result.")}>{busy ? (zh ? "正在提交…" : "Submitting…") : (zh ? "确认删除账户" : "Confirm account deletion")}</button></footer>
  </section>;
  return <div className="space-y-5">
    <button className="btn-ghost inline-flex min-h-11 items-center gap-2 px-2 text-sm" onClick={() => onBack()}><ArrowLeft className="h-4 w-4" aria-hidden />{zh ? "返回用户列表" : "Back to users"}</button>
    {user.isPending ? <p role="status">{zh ? "读取账户…" : "Loading account…"}</p> : null}
    {user.isError ? <AdminLoadError zh={zh} onRetry={() => void user.refetch()} /> : null}
    {row ? <>
      <header><h3 ref={title} tabIndex={-1} className="break-all text-lg font-semibold text-primary outline-none">{row.display_name || row.email}</h3><p className="mt-1 break-all text-sm text-secondary">{row.email} · {row.role === "ADMIN" ? "Root Admin" : statusLabel({ ...row, deletion: deletion ? { ...row.deletion!, ...deletion } : null }, zh)}</p></header>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-y border-ui py-4 text-sm">{[
        [zh ? "项目" : "Projects", row.stats.projects], [zh ? "对话" : "Conversations", row.stats.conversations],
        [zh ? "附件" : "Attachments", row.stats.attachments], [zh ? "附件引用大小" : "Referenced attachment size", `${(row.stats.attachment_bytes / 1048576).toFixed(2)} MB`],
        [zh ? "注册时间" : "Registered", date(row.created_at)], [zh ? "最近登录" : "Last sign-in", date(row.last_login_at)],
      ].map(([key, value]) => <div key={key}><dt className="text-xs text-secondary">{key}</dt><dd className="mt-1 break-words text-primary">{value}</dd></div>)}</dl>
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}{notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
      {deleting || failed ? <section className="space-y-3 border-l-2 border-[var(--warning)] pl-4" aria-label={zh ? "账户删除任务" : "Account deletion task"}><h4 className="text-sm font-semibold">{failed ? (zh ? "删除失败，资料已保留" : "Deletion failed; data retained") : (zh ? "正在删除账户" : "Deleting account")}</h4><p className="text-sm text-secondary">{zh ? "账户已锁定。关闭后可从此处或任务中心继续查看。" : "The account is locked. Return here or use Tasks to check progress."}</p>{deleting ? <progress className="h-2 w-full accent-[var(--accent)]" max={100} value={deletion?.progress ?? 0} aria-label={zh ? "删除进度" : "Deletion progress"} /> : <button className={adminButton} disabled={busy} onClick={() => void act(() => retryTask(taskId!), zh ? "已重新加入队列。" : "Queued again.")}>{zh ? "重试删除" : "Retry deletion"}</button>}{task.isError ? <AdminLoadError zh={zh} onRetry={() => void task.refetch()} /> : null}</section> : null}
      {row.role !== "ADMIN" ? <section className="space-y-3" aria-label={zh ? "访问与安全" : "Access & security"}>
        <h4 className="text-sm font-semibold text-primary">{zh ? "访问与安全" : "Access & security"}</h4>
        <p className="text-xs text-secondary">{row.email_verification_required ? (row.email_verified_at ? (zh ? "邮箱已验证" : "Email verified") : (zh ? "邮箱待验证，审批通过后仍需完成验证。" : "Email unverified; approval still requires verification.")) : (zh ? "此账户无需邮箱验证。" : "Email verification is not required for this account.")}</p>
        <div className="flex flex-wrap gap-2">{row.approval_status === "PENDING" && row.status !== "DISABLED" ? <><button className="btn-primary min-h-11 px-3 text-sm" disabled={locked} onClick={() => void act(() => adminApi.approveUser(id), zh ? "审批已通过。" : "Approved.")}>{zh ? "批准注册" : "Approve registration"}</button><button className={adminButton} disabled={locked} onClick={() => void reject()}>{zh ? "拒绝注册" : "Reject registration"}</button></> : null}
          <button className={adminButton} disabled={locked} onClick={() => void act(() => adminApi.setUserStatus(id, row.status === "DISABLED" ? "ACTIVE" : "DISABLED"), zh ? "账户状态已更新。" : "Account status updated.")}>{row.status === "DISABLED" ? (zh ? "启用账户" : "Enable account") : (zh ? "禁用账户" : "Disable account")}</button>
          <button className={adminButton} disabled={locked} onClick={() => void act(() => adminApi.revokeSessions(id), zh ? "该用户所有会话已撤销。" : "All user sessions revoked.")}>{zh ? "撤销会话" : "Revoke sessions"}</button>
        </div>
        <details className="group border-y border-ui py-2"><summary className="flex min-h-11 cursor-pointer items-center justify-between text-sm text-primary">{zh ? "密码帮助" : "Password assistance"}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden /></summary><p className="mb-3 text-xs text-secondary">{zh ? "生成一次性链接并交给用户，30 分钟内有效。" : "Create a one-time link for the user, valid for 30 minutes."}</p><button className={adminButton} disabled={locked} onClick={() => void act(async () => setReset(await adminApi.resetUser(id)), "")}>{zh ? "生成重置链接" : "Create reset link"}</button>{reset ? <div className="mt-3 space-y-2"><label htmlFor="admin-reset-link" className="text-xs text-secondary">{zh ? "重置链接，有效至" : "Reset link, expires"} {date(reset.expires_at)}</label><input ref={resetInput} id="admin-reset-link" readOnly value={reset.reset_url} onFocus={(event) => event.currentTarget.select()} className="input-base min-h-11 w-full px-3 text-base" /><button className={adminButton} onClick={() => void navigator.clipboard.writeText(reset.reset_url).then(() => setNotice(zh ? "重置链接已复制。" : "Reset link copied."), () => setError(zh ? "复制失败，请从输入框手动复制。" : "Copy failed. Select and copy the link manually."))}>{zh ? "复制链接" : "Copy link"}</button><button className={`${adminButton} ml-2`} onClick={() => setReset(null)}>{zh ? "隐藏" : "Hide"}</button></div> : null}</details>
      </section> : null}
      <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-semibold">{zh ? "用户资料" : "User content"}</h4><p className="mt-1 text-xs text-secondary">{zh ? "只读查看，访问将记录在审计中。" : "Read-only inspection. Access is audited."}</p></div><button className={adminButton} disabled={deleting} aria-expanded={content} onClick={() => setContent(!content)}>{content ? (zh ? "收起资料" : "Hide content") : (zh ? "查看资料" : "Inspect content")}</button></div>{content ? <AdminUserContent userId={id} zh={zh} /> : null}</section>
      {row.role !== "ADMIN" && !deleting && !failed ? <section className="border-t border-ui pt-4"><button className="btn-ghost min-h-11 px-3 text-sm text-[var(--danger)]" disabled={busy} onClick={() => void act(async () => { setImpact(await adminApi.deleteImpact(id)); deleteKey.current ||= crypto.randomUUID(); }, "")}>{zh ? "删除账户…" : "Delete account…"}</button></section> : null}
    </> : null}
  </div>;
}
