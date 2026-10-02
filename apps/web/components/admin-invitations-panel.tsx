"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { adminApi, type AdminInvitation } from "../lib/admin-client";
import { AdminLoadError, AdminPageControls, adminButton } from "./admin-users-panel";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

const states = [["ALL", "全部", "All"], ["PENDING", "待使用", "Pending"], ["USED", "已使用", "Used"], ["EXPIRED", "已过期", "Expired"], ["REVOKED", "已撤销", "Revoked"]] as const;

export function AdminInvitationsPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const client = useQueryClient(), { confirm } = useInteractionDialog();
  const [state, setState] = useState("ALL"), [offset, setOffset] = useState(0), [hours, setHours] = useState(168);
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<{ id: string; invite_url: string; expires_at: string } | null>(null), [copied, setCopied] = useState(false);
  const createButton = useRef<HTMLButtonElement>(null), linkInput = useRef<HTMLInputElement>(null), inFlight = useRef(false);
  const list = useQuery({ queryKey: ["admin-invitations", state, offset], queryFn: () => adminApi.invitationPage(state, offset), retry: false });
  useEffect(() => { onDirtyChange?.(Boolean(issued && !copied) || busy === "create"); }, [issued, copied, busy, onDirtyChange]);
  useEffect(() => { if (issued) linkInput.current?.focus(); }, [issued]);
  const date = (value: string) => new Date(value).toLocaleString(resolvedLocale);
  async function run(key: string, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(key); setError(""); setNotice("");
    try { await work(); }
    catch { setError(key === "create" ? (zh ? "尚未确认创建结果。请刷新邀请列表核对；无法获取的链接可撤销后重新创建。" : "Creation could not be confirmed. Refresh the list; revoke any unavailable link before creating another.") : key === "copy" ? (zh ? "复制失败，链接仍保留。可以选中链接手动复制。" : "Copy failed. The link is preserved; select it to copy manually.") : (zh ? "操作失败，请重试。" : "Action failed. Please retry.")); }
    finally { inFlight.current = false; setBusy(""); }
  }
  async function revoke(item: AdminInvitation | { id: string }) {
    if (!await confirm({ title: zh ? "撤销邀请？" : "Revoke invitation?", description: zh ? "链接将立即失效，尚未注册的用户将无法继续使用。" : "The link will stop working immediately for new registrations.", confirmLabel: zh ? "撤销邀请" : "Revoke invitation", danger: true })) return;
    await run(item.id, async () => {
      await adminApi.revokeInvitation(item.id);
      if (issued?.id === item.id) { setIssued(null); setCopied(false); createButton.current?.focus(); }
      setNotice(zh ? "邀请已撤销。" : "Invitation revoked.");
      await client.invalidateQueries({ queryKey: ["admin-invitations"] });
    });
  }
  return <section className="space-y-4 border-t border-ui pt-5" aria-label={zh ? "邀请" : "Invitations"}>
    <header className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-semibold text-primary"><Link2 className="h-4 w-4 text-accent" aria-hidden />{zh ? "邀请" : "Invitations"}</h3><p className="mt-1 text-sm text-secondary">{zh ? "每个链接仅能注册一个账户。创建后及时复制，历史列表不保留链接。" : "Each link registers one account. Copy it after creation; links are not retained in history."}</p></div>{!creating && !issued ? <button ref={createButton} type="button" className={`${adminButton} inline-flex shrink-0 items-center gap-1`} onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden />{zh ? "创建邀请" : "Create invitation"}</button> : null}</header>
    {creating && !issued ? <form className="space-y-3 rounded-lg bg-subtle p-4" onSubmit={(event) => { event.preventDefault(); void run("create", async () => {
      const next = await adminApi.createInvitation(hours); setIssued(next); setCopied(false); setCreating(false); setState("ALL"); setOffset(0);
      await client.invalidateQueries({ queryKey: ["admin-invitations"] });
    }); }}>
      <label htmlFor="invitation-hours" className="block text-sm text-secondary">{zh ? "有效期（小时，1–2160）" : "Valid for (hours, 1–2160)"}</label>
      <div className="flex flex-wrap items-center gap-2"><input autoFocus id="invitation-hours" type="number" min={1} max={2160} step={1} required value={hours || ""} disabled={Boolean(busy)} onChange={(event) => setHours(Number(event.target.value))} className="input-base min-h-11 w-28 px-3 text-base" />
        <button type="submit" disabled={Boolean(busy) || !Number.isInteger(hours) || hours < 1 || hours > 2160} className="btn-primary min-h-11 px-4 text-sm">{busy === "create" ? (zh ? "正在创建…" : "Creating…") : (zh ? "生成邀请链接" : "Generate invite link")}</button>
        <button type="button" disabled={Boolean(busy)} className={adminButton} onClick={() => { setCreating(false); requestAnimationFrame(() => createButton.current?.focus()); }}>{zh ? "取消" : "Cancel"}</button></div>
    </form> : null}
    {issued ? <section className="space-y-3 rounded-lg border border-ui bg-subtle p-4" aria-label={zh ? "新邀请链接" : "New invitation link"}>
      <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-primary">{zh ? "链接已生成，仅在此处显示一次" : "Your link is ready — shown only here"}</h4><p className="mt-1 text-xs text-secondary">{zh ? "到期：" : "Expires: "}{date(issued.expires_at)}</p></div>
        <button type="button" disabled={Boolean(busy)} className="btn-ghost flex h-11 w-11 shrink-0 items-center justify-center" aria-label={zh ? "隐藏邀请链接" : "Hide invite link"} onClick={async () => {
          if (!copied && !await confirm({ title: zh ? "隐藏尚未复制的链接？" : "Hide the uncopied link?", description: zh ? "隐藏后无法再次查看，邀请仍然有效。可以先手动复制，或撤销此邀请。" : "You cannot view it again, but it stays valid. Copy it manually or revoke it first.", confirmLabel: zh ? "隐藏链接" : "Hide link" })) return;
          setIssued(null); setCopied(false); requestAnimationFrame(() => createButton.current?.focus());
        }}><X className="h-4 w-4" aria-hidden /></button></div>
      <label htmlFor="new-invitation" className="sr-only">{zh ? "新邀请链接" : "New invitation link"}</label><input ref={linkInput} id="new-invitation" readOnly value={issued.invite_url} onFocus={(event) => event.target.select()} className="input-base min-h-11 w-full min-w-0 px-3 text-base" />
      <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" disabled={Boolean(busy)} className="btn-primary inline-flex min-h-11 items-center gap-2 px-4 text-sm" onClick={() => void run("copy", async () => { await navigator.clipboard.writeText(issued.invite_url); setCopied(true); setNotice(zh ? "已复制邀请链接。" : "Invitation link copied."); })}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{zh ? "复制链接" : "Copy link"}</button><button type="button" className="btn-ghost min-h-11 px-3 text-sm text-[var(--danger)]" disabled={Boolean(busy)} onClick={() => void revoke(issued)}>{zh ? "撤销此邀请" : "Revoke this invitation"}</button></div>
    </section> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}{notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="text-xs text-secondary">{zh ? "邀请状态" : "Invitation status"}<select className="input-base mt-1 block min-h-11 px-3 text-sm" value={state} disabled={Boolean(busy)} onChange={(event) => { setState(event.target.value); setOffset(0); }}>{states.map(([value, cn, en]) => <option key={value} value={value}>{zh ? cn : en}</option>)}</select></label><button type="button" className={adminButton} disabled={list.isFetching || Boolean(busy)} onClick={() => void list.refetch()}>{zh ? "刷新邀请" : "Refresh invitations"}</button></div>
    {list.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取邀请…" : "Loading invitations…"}</p> : null}{list.isError ? <AdminLoadError zh={zh} onRetry={() => void list.refetch()} /> : null}
    {list.data && !list.isError ? <><ul className="divide-y divide-[var(--border)] border-t border-ui" aria-label={zh ? "邀请记录" : "Invitation history"}>{list.data.items.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-4"><div className="min-w-0 space-y-1"><p className={`text-sm font-medium ${item.status === "PENDING" ? "text-accent" : "text-primary"}`}>{states.find(([value]) => value === item.status)?.[zh ? 1 : 2]}</p><p className="text-xs text-secondary">{zh ? "创建：" : "Created: "}{date(item.created_at)}</p><p className="text-xs text-secondary">{item.used_at ? (zh ? "使用：" : "Used: ") + date(item.used_at) : (zh ? "到期：" : "Expires: ") + date(item.expires_at)}</p></div>{item.status === "PENDING" ? <button type="button" disabled={Boolean(busy)} onClick={() => void revoke(item)} className={adminButton}>{busy === item.id ? (zh ? "正在撤销…" : "Revoking…") : (zh ? "撤销" : "Revoke")}</button> : null}</li>)}</ul>
      {!list.data.items.length ? <p className="py-4 text-sm text-secondary">{zh ? "没有符合当前筛选的邀请。" : "No invitations match this filter."}</p> : null}<AdminPageControls offset={offset} total={list.data.total} busy={list.isFetching || Boolean(busy)} onPage={setOffset} zh={zh} /></> : null}
  </section>;
}
