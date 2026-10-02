"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Search, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { findArchiveAccountTargets, getArchiveAccountChoices, saveArchiveAccountChoice, type ArchiveAccountChoice } from "../lib/api";
import type { BackgroundTaskRead } from "../lib/types";
import { archiveError } from "./archive-ui";
import { usePreferences } from "./preferences-provider";

const button = "btn-secondary min-h-11 px-3 text-sm";

export function SystemArchiveOwnership({ preview, online, busy, canRestore, onRestore, onBusyChange }: {
  preview: BackgroundTaskRead; online: boolean; busy: boolean; canRestore: boolean;
  onRestore: (revision: string) => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN", client = useQueryClient();
  const [offset, setOffset] = useState(0), [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [editing, setEditing] = useState<ArchiveAccountChoice | null>(null), [saving, setSaving] = useState(false);
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [targetOffset, setTargetOffset] = useState(0);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const accounts = useQuery({ queryKey: ["system-archive-accounts", preview.job_id, offset, unresolvedOnly],
    queryFn: () => getArchiveAccountChoices(preview.job_id, offset, unresolvedOnly), enabled: online, retry: false });
  const targets = useQuery({ queryKey: ["system-archive-targets", query, targetOffset],
    queryFn: () => findArchiveAccountTargets(query, targetOffset), enabled: online && !!editing, retry: false });
  const repeated = preview.result.already_restored === true;
  useEffect(() => { onBusyChange(saving); }, [saving, onBusyChange]);
  useEffect(() => { if (editing) searchInput.current?.focus(); }, [editing]);
  useEffect(() => {
    if (accounts.data && offset > 0 && offset >= accounts.data.matched) setOffset(Math.max(0, Math.ceil(accounts.data.matched / 20) * 20 - 20));
  }, [accounts.data, offset]);

  function edit(row: ArchiveAccountChoice) {
    setEditing(row); setSearch(row.email ?? ""); setQuery(row.email ?? ""); setTargetOffset(0); setError(""); setNotice("");
  }
  function returnToList() { setEditing(null); requestAnimationFrame(() => heading.current?.focus()); }
  async function save(target: string | null) {
    if (!editing || !accounts.data || saving || busy) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await saveArchiveAccountChoice(preview.job_id, editing.source_key, accounts.data.revision, target);
      await client.invalidateQueries({ queryKey: ["system-archive-accounts", preview.job_id] });
      setNotice(zh ? "归属选择已保存，确认恢复前不会创建或修改账户。" : "Ownership choice saved. Accounts remain unchanged until you confirm restoration.");
      returnToList();
    } catch (failure) {
      setError(archiveError(failure instanceof Error ? failure.message : "", zh));
      await client.invalidateQueries({ queryKey: ["system-archive-accounts", preview.job_id] });
    } finally { setSaving(false); }
  }
  const rowName = (row: ArchiveAccountChoice) => row.email || row.display_name || (row.role === "UNOWNED" ? (zh ? "尚未归属账户的资料" : "Materials without an owner") : (zh ? `旧账户 ${row.source_key.slice(0, 8)}` : `Legacy account ${row.source_key.slice(0, 8)}`));

  return <section className="grid min-w-0 gap-3 border-t border-ui pt-4" aria-labelledby="archive-ownership-title">
    <div><h4 id="archive-ownership-title" ref={heading} tabIndex={-1} className="text-sm font-semibold text-primary outline-none">{zh ? "确认账户归属" : "Review account ownership"}</h4><p className="mt-1 text-xs leading-5 text-secondary">{preview.result.configuration_included ? (zh ? "包含账户偏好、格式、规则、Skill 及功能／访问策略；恢复时一起导入。" : "Account preferences, formats, rules, Skills and feature / access policies are included in this restore.") : (zh ? "这份旧归档不包含系统配置，仅恢复其中声明的资料。" : "This earlier archive has no system configuration. Only its declared materials will be restored.")}</p></div>
    {accounts.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取账户归属…" : "Loading account ownership…"}</p> : null}
    {accounts.isError ? <div role="alert" className="grid gap-2 text-sm text-[var(--danger)]"><p>{zh ? "读取归属失败，请联网重试。" : "Unable to load ownership. Reconnect and retry."}</p><button type="button" className={button} disabled={!online} onClick={() => void accounts.refetch()}>{zh ? "重试读取归属" : "Retry ownership"}</button></div> : null}
    {repeated ? <p className="rounded-lg bg-subtle p-3 text-sm leading-6 text-primary">{zh ? "这份归档已有成功恢复记录。再次确认只返回原结果，不重复创建账户和资料。" : "This archive has already been restored. Confirming again returns the original result without creating accounts or materials again."}</p> : accounts.data ? <>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm tabular-nums text-secondary">{zh ? `${accounts.data.total} 个来源 · ${accounts.data.unresolved} 个待确认` : `${accounts.data.total} sources · ${accounts.data.unresolved} need a choice`}</p><label className="flex min-h-11 items-center gap-2 text-sm text-primary"><input type="checkbox" disabled={saving || busy} checked={unresolvedOnly} onChange={(event) => { setUnresolvedOnly(event.target.checked); setOffset(0); returnToList(); }} className="h-4 w-4 accent-[var(--accent)]" />{zh ? "只看待确认" : "Only unresolved"}</label></div>
      {editing ? <div className="grid min-w-0 gap-3 rounded-lg bg-subtle p-3">
        <div><p className="break-words text-sm font-medium text-primary">{rowName(editing)}</p><p className="mt-1 text-xs leading-5 text-secondary">{zh ? "选择此来源资料在当前实例中归属的账户。" : "Choose the account that will own these materials in this instance."}</p></div>
        {editing.role === "USER" ? <button type="button" className={button} disabled={saving || busy || !online || !!editing.suggested_target} onClick={() => void save(null)}>{zh ? "使用此邮箱新建账户（需重设密码）" : "Create an account with this email (password reset required)"}</button> : null}
        {editing.suggested_target ? <p className="text-xs leading-5 text-secondary">{zh ? "该邮箱已存在，请明确选择资料归属，系统不会自动合并账户。" : "This email already exists. Choose ownership explicitly; accounts are never automatically merged."}</p> : null}
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setTargetOffset(0); }}><label className="grid min-w-0 flex-1 gap-1 text-xs text-secondary">{zh ? "搜索目标账户" : "Search target accounts"}<input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} className="input-base min-h-11 w-full px-3 text-sm" /></label><button type="submit" className={button} disabled={saving || !online}><Search aria-hidden="true" className="mr-1 inline h-4 w-4" />{zh ? "搜索" : "Search"}</button></form>
        {targets.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取账户…" : "Loading accounts…"}</p> : targets.isError ? <button type="button" disabled={!online} className={button} onClick={() => void targets.refetch()}>{zh ? "读取失败，重试" : "Loading failed. Retry"}</button> : targets.data?.items.length ? <div className="divide-y divide-[var(--border)] border-y border-ui">{targets.data.items.map((target) => <button type="button" key={target.id} disabled={saving || busy || !online} onClick={() => void save(target.id)} className="flex min-h-14 w-full items-center gap-3 py-3 text-left hover:bg-surface"><UserRound aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" /><span className="min-w-0 flex-1 break-words text-sm text-primary">{target.email || target.display_name}<span className="mt-1 block text-xs text-secondary">{target.role === "ADMIN" ? "Root Admin" : (zh ? "普通账户" : "User account")}</span></span><span className="text-sm text-accent">{zh ? "选择" : "Choose"}</span></button>)}</div> : <p className="text-sm text-secondary">{zh ? "没有匹配账户，试试其他邮箱或名称。" : "No matching accounts. Try another email or name."}</p>}
        {targets.data && targets.data.total > 20 ? <div className="flex items-center justify-between gap-2"><button type="button" className={button} disabled={targetOffset === 0 || saving} onClick={() => setTargetOffset(targetOffset - 20)}>{zh ? "上一页账户" : "Previous accounts"}</button><button type="button" className={button} disabled={targetOffset + 20 >= targets.data.total || saving} onClick={() => setTargetOffset(targetOffset + 20)}>{zh ? "下一页账户" : "Next accounts"}</button></div> : null}
        <button type="button" disabled={saving} className="btn-ghost min-h-11 px-3 text-sm" onClick={returnToList}>{zh ? "返回归属清单" : "Back to ownership list"}</button>
      </div> : <>
        <div className="divide-y divide-[var(--border)] border-y border-ui">{accounts.data.items.map((row) => <div key={row.source_key} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
          <div className="min-w-0"><p className="break-words text-sm text-primary">{rowName(row)}</p><p className="mt-1 text-xs text-secondary">{row.role === "ADMIN" ? "Root Admin" : row.role === "USER" ? (zh ? "归档中的账户" : "Archived account") : (zh ? "旧版归档来源" : "Earlier archive source")}</p></div><ArrowRight aria-hidden="true" className="hidden h-4 w-4 text-secondary sm:block" />
          <div className="min-w-0 break-words text-sm text-secondary">{row.decision === "ROOT" ? (zh ? "当前 Root Admin · 凭据保留" : "Current Root Admin · credentials retained") : row.decision === "NEW" ? <>{zh ? "新建账户" : "Create account"}<span className="mt-1 block text-xs">{zh ? "首次登录前需重设密码" : "Password reset before first login"}</span></> : row.decision === "EXISTING" && row.target ? <>{row.target.email || row.target.display_name}<span className="mt-1 block text-xs">{zh ? "使用已有账户" : "Use existing account"}</span></> : <span className="text-[var(--warning)]">{zh ? "请选择归属账户" : "Choose an owner"}</span>}</div>
          {row.decision === "ROOT" ? <Check aria-label={zh ? "已确认" : "Confirmed"} className="h-4 w-4 text-accent" /> : <button type="button" disabled={busy || saving || !online} className={button} onClick={() => edit(row)}>{row.decision === "UNSET" || !row.target && row.decision === "EXISTING" ? (zh ? "选择账户" : "Choose account") : (zh ? "更改归属" : "Change owner")}</button>}
        </div>)}</div>
        {!accounts.data.items.length ? <p className="text-sm text-secondary">{unresolvedOnly ? (zh ? "所有来源均已确认。" : "All sources have an ownership choice.") : (zh ? "这份归档没有需要映射的账户。" : "This archive has no accounts to map.")}</p> : null}
        {accounts.data.matched > 20 ? <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className={button} disabled={offset === 0 || saving || !online} onClick={() => setOffset(offset - 20)}>{zh ? "上一页来源" : "Previous sources"}</button><span className="text-xs tabular-nums text-secondary">{offset + 1}–{Math.min(offset + 20, accounts.data.matched)} / {accounts.data.matched}</span><button type="button" className={button} disabled={offset + 20 >= accounts.data.matched || saving || !online} onClick={() => setOffset(offset + 20)}>{zh ? "下一页来源" : "Next sources"}</button></div> : null}
      </>}
    </> : null}
    {error ? <p role="alert" className="break-words text-sm text-[var(--danger)]">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-accent">{notice}</p> : null}
    {!editing ? <div className="sticky bottom-0 grid gap-2 border-t border-ui bg-raised pb-1 pt-3"><p className="text-xs leading-5 text-secondary">{zh ? "归属选择自动保存。确认将按上方清单恢复所有资料；重复提交同一归档不会重复创建。" : "Ownership choices save automatically. Confirm to restore all reviewed materials. Repeating the same archive creates no duplicates."}</p><button type="button" className="btn-primary min-h-11 px-4 text-sm" disabled={busy || saving || !online || accounts.isError || accounts.isFetching || !accounts.data || (!repeated && (!canRestore || accounts.data.unresolved > 0))} onClick={() => { setError(""); void onRestore(accounts.data!.revision); }}>{busy ? (zh ? "正在提交恢复…" : "Submitting restore…") : repeated ? (zh ? "查看已有恢复结果" : "Retrieve previous restore result") : (zh ? "确认恢复系统归档" : "Restore system archive")}</button></div> : null}
  </section>;
}
