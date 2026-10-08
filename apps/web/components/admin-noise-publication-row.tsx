"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { adminApi, AdminRequestError, type AdminNoiseRule, type AdminNoiseRevision, type Page } from "../lib/admin-client";
import { authenticationGeneration } from "../lib/offline-access";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

type Draft = { base: AdminNoiseRule; name: string; selected: AdminNoiseRevision | null };
type Operation = { action: "publish" | "withdraw"; base: string; name: string; revision: AdminNoiseRevision | null };

export function AdminNoisePublicationRow({ rule, unavailable, onDirtyChange }: { rule: AdminNoiseRule; unavailable: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN", { confirm } = useInteractionDialog(), client = useQueryClient();
  const [open, setOpen] = useState(false), [offset, setOffset] = useState(0), [draft, setDraft] = useState<Draft | null>(null);
  const [attempt, setAttempt] = useState<Operation | null>(null), [recovery, setRecovery] = useState<"unknown" | "conflict" | "access" | null>(null);
  const [comparison, setComparison] = useState<AdminNoiseRule | null>(null), [notice, setNotice] = useState<"saved" | "matches" | "retry" | "invalid" | "" >("");
  const feedback = useRef<HTMLDivElement>(null), nameInput = useRef<HTMLInputElement>(null), heading = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true), generation = useRef(authenticationGeneration()), request = useRef<AbortController | null>(null);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  const signal = () => { request.current?.abort(); request.current = new AbortController(); return request.current.signal; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const currentDraft = draft ?? { base: rule, name: rule.name, selected: null }, { name, selected } = currentDraft;
  const revisions = useQuery({ queryKey: ["admin-noise-rule-revisions", rule.id, offset], queryFn: ({ signal }) => adminApi.noiseRuleRevisions(rule.id, offset, signal), enabled: open, staleTime: 0, retry: false });
  const patch = (saved: AdminNoiseRule) => client.setQueriesData<Page<AdminNoiseRule>>({ queryKey: ["admin-noise-rules"] }, old => old ? { ...old, items: old.items.map(item => item.id === saved.id ? saved : item) } : undefined);
  const refresh = () => { for (const key of ["admin-noise-rules", "content-cleanup-rules", "cleanup-rule-revisions"]) void client.invalidateQueries({ queryKey: [key] }); void client.invalidateQueries({ queryKey: ["admin-noise-rule-revisions", rule.id] }); };
  const acknowledge = (saved: AdminNoiseRule, checked: boolean) => { patch(saved); setDraft(null); setAttempt(null); setRecovery(null); setComparison(null); setNotice(checked ? "matches" : "saved"); refresh(); };
  const mutation = useMutation({
    mutationFn: async (op: Operation) => {
      await client.cancelQueries({ queryKey: ["admin-noise-rules"] });
      if (!active()) throw new Error("Inactive editor");
      return op.action === "publish" ? (await adminApi.publishNoiseRule(rule.id, op.revision!.id, op.name, op.base, signal())).rule : adminApi.withdrawNoiseRule(rule.id, op.base, signal());
    },
    onSuccess: saved => { if (active()) acknowledge(saved, false); },
    onError: error => {
      if (!active()) return;
      if (error instanceof AdminRequestError && [401, 403, 404].includes(error.status)) setRecovery("access");
      else if (error instanceof AdminRequestError && error.status === 422) { setAttempt(null); setNotice("invalid"); }
      else setRecovery(error instanceof AdminRequestError && error.status === 409 ? "conflict" : "unknown");
    },
  });
  const check = useMutation({
    mutationFn: async () => { await client.cancelQueries({ queryKey: ["admin-noise-rules"] }); return adminApi.noiseRule(rule.id, signal()); },
    onSuccess: saved => {
      if (!active()) return;
      const matches = attempt?.action === "withdraw" ? !saved.published_revision_id : attempt?.revision?.id === saved.published_revision_id && attempt?.name === saved.name;
      if (matches) acknowledge(saved, true); else { patch(saved); setComparison(saved); setRecovery(null); void client.invalidateQueries({ queryKey: ["admin-noise-rule-revisions", rule.id] }); }
    },
    onError: error => { if (active() && error instanceof AdminRequestError && [401, 403, 404].includes(error.status)) { setComparison(null); setRecovery("access"); } },
  });
  const busy = mutation.isPending || check.isPending, blocked = busy || unavailable || !!recovery || !!comparison || !currentDraft.base.publication_token;
  const historyUnavailable = revisions.isFetching || revisions.isError || !revisions.data;
  const dirty = !!draft && (draft.name !== draft.base.name || !!draft.selected && draft.selected.id !== draft.base.published_revision_id);
  useLayoutEffect(() => { onDirtyChange(dirty || busy || !!attempt); }, [dirty, busy, attempt, onDirtyChange]);
  useEffect(() => { if (notice === "retry") nameInput.current?.focus(); else if (recovery || comparison || notice) feedback.current?.focus(); }, [recovery, comparison, notice]);
  const availability = useRef({ blocked, historyUnavailable }); availability.current = { blocked, historyUnavailable };
  const edit = (changes: Partial<Draft>) => { setNotice(""); setDraft({ ...currentDraft, ...changes }); };
  const act = async (action: Operation["action"]) => {
    if (blocked || action === "publish" && (historyUnavailable || !selected?.validated || !name.trim())) return;
    const op: Operation = { action, base: currentDraft.base.publication_token, name: name.trim(), revision: selected };
    const accepted = await confirm(action === "publish" ? {
      title: zh ? "发布此噪声规则版本？" : "Publish this noise rule version?",
      description: zh ? `${op.name} · 版本 ${selected!.revision}。所有用户可用于扫描，但删除正文仍需逐次确认。` : `${op.name} · version ${selected!.revision}. Available to all users for scanning; removing text still requires explicit review.`, confirmLabel: zh ? "确认发布" : "Publish",
    } : {
      title: zh ? "撤回系统提供？" : "Withdraw system availability?",
      description: `${rule.name}${rule.published_revision ? ` · v${rule.published_revision}` : ""}${zh ? "。停止向新用户提供。已有授权、历史版本和进行中的审查保持可用。" : ". Stop offering this rule to new users. Acquired versions, history and admitted reviews remain available."}`, confirmLabel: zh ? "确认撤回" : "Withdraw",
    });
    if (!accepted || !active() || availability.current.blocked || action === "publish" && availability.current.historyUnavailable) return;
    setAttempt(op); setNotice(""); check.reset(); mutation.mutate(op);
  };
  const cancel = () => { setDraft(null); setAttempt(null); setComparison(null); setRecovery(null); setNotice(""); check.reset(); heading.current?.focus(); };
  const rebase = () => {
    if (!comparison || busy || check.isError) return;
    setDraft({ ...currentDraft, base: comparison }); setComparison(null); setAttempt(null); setNotice("retry");
  };
  const role = (value: string | null) => value ? (zh ? ({ user: "用户", assistant: "助手", system: "系统", tool: "工具" }[value] ?? value) : value) : (zh ? "全部角色" : "All roles");
  const mode = (value: string) => ({ EXACT: zh ? "精确匹配" : "Exact", NORMALIZED: zh ? "归一化匹配" : "Normalized", APPROXIMATE: zh ? "近似匹配" : "Approximate" }[value] ?? value);
  const boundary = (value: string) => ({ ANYWHERE: zh ? "任意位置" : "Anywhere", WHOLE_LINE: zh ? "独占一行" : "Whole line", BLOCK_END: zh ? "段落末尾" : "Block end" }[value] ?? value);
  return <article aria-label={rule.name} data-rule-id={rule.id} className="space-y-3 py-4">
    <button ref={heading} type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-11 w-full rounded-lg text-left hover:bg-subtle">
      <span className="block break-words text-sm font-semibold">{rule.name === "Text rule" && zh ? "文本规则" : rule.name}</span>
      <span className="mt-1 block text-xs text-secondary">{rule.published_revision_id ? `${zh ? "系统提供中" : "Published"}${rule.published_revision ? ` · v${rule.published_revision}` : ""}` : (zh ? "未发布" : "Not published")} · {rule.revision_count} {zh ? "个历史版本" : "historical versions"}{!rule.source_account_available ? ` · ${zh ? "来源账户已删除" : "Source account deleted"}` : ""}</span>
    </button>
    {open ? <div className="space-y-3 border-t border-ui pt-3">
      <label className="block text-xs font-medium text-secondary">{zh ? "系统显示名称" : "System display name"}<input ref={nameInput} maxLength={200} disabled={busy || !!recovery || !!comparison} value={name} onChange={event => edit({ name: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary" /></label>
      <p className="text-xs font-medium text-secondary">{zh ? "选择发布版本" : "Choose a version to publish"}</p>
      {revisions.isFetching ? <p role="status" className="text-xs text-secondary">{zh ? "正在读取版本…" : "Loading versions…"}</p> : null}
      {revisions.isError ? <div role="alert" className="space-y-2 text-xs text-[var(--danger)]"><p>{zh ? "版本读取失败；上次结果暂时不能选择。" : "Versions could not load. Previous entries cannot be selected yet."}</p><button type="button" disabled={revisions.isFetching} className="btn-secondary min-h-11 px-3" onClick={() => void revisions.refetch()}>{zh ? "重试读取版本" : "Retry loading versions"}</button></div> : null}
      <div className="divide-y divide-[var(--border)]">{revisions.data?.items.map(item => <label key={item.id} className="flex min-h-11 items-start gap-3 py-3 text-xs">
        <input type="radio" name={`rule-${rule.id}`} checked={selected?.id === item.id} disabled={blocked || historyUnavailable || !item.validated} onChange={() => edit({ selected: item })} className="mt-1" />
        <span className="min-w-0 flex-1"><span className="font-medium">v{item.revision} · {item.validated ? (zh ? "配置验证通过" : "Configuration validated") : (zh ? "未通过验证" : "Not validated")}{item.id === rule.published_revision_id ? (zh ? " · 当前发布" : " · Published") : ""}</span><span className="mt-1 block whitespace-pre-wrap break-words text-secondary [overflow-wrap:anywhere]">{item.configuration.match_value}</span></span>
      </label>)}</div>
      {revisions.data && revisions.data.total > 20 ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><button type="button" disabled={!offset || busy || historyUnavailable} className="btn-secondary min-h-11 px-3" onClick={() => setOffset(Math.max(0, offset - 20))}>{zh ? "较新版本" : "Newer versions"}</button><span>{offset + 1}–{Math.min(offset + 20, revisions.data.total)} / {revisions.data.total}</span><button type="button" disabled={busy || historyUnavailable || offset + 20 >= revisions.data.total} className="btn-secondary min-h-11 px-3" onClick={() => setOffset(offset + 20)}>{zh ? "更早版本" : "Older versions"}</button></div> : null}
      {selected ? <div className="space-y-2 rounded-lg bg-subtle p-3 text-xs"><p className="font-semibold">{zh ? "将发布的匹配范围" : "Matching scope to publish"} · v{selected.revision}</p><pre tabIndex={0} aria-label={zh ? "将发布的匹配文本" : "Match text to publish"} className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans leading-5 [overflow-wrap:anywhere]">{selected.configuration.match_value}</pre><p>{role(selected.configuration.role_filter)} · {mode(selected.configuration.matcher_mode)} · {boundary(selected.configuration.boundary_mode)} · {selected.configuration.case_sensitive ? (zh ? "区分大小写" : "Case-sensitive") : (zh ? "不区分大小写" : "Case-insensitive")}</p></div> : null}
    </div> : null}
    <div ref={feedback} tabIndex={-1} className="space-y-2 text-xs leading-5 outline-none">
      {mutation.isPending ? <p role="status">{zh ? "正在保存…" : "Saving…"}</p> : null}
      {notice ? <p role="status" className="text-secondary">{notice === "saved" ? (zh ? "系统提供状态已更新。" : "Publication updated.") : notice === "matches" ? (zh ? "当前系统状态已符合本次选择，无需重复操作。" : "The current publication matches your choice; no repeat action is needed.") : notice === "retry" ? (zh ? "已保留你的选择，请重新确认后提交。" : "Your choice is retained. Confirm again to submit.") : (zh ? "未能发布，请检查名称和所选版本后重试。" : "Could not publish. Check the name and selected version before retrying.")}</p> : null}
      {recovery ? <div className="space-y-2 border-l-2 border-[var(--danger)] pl-3"><p role="alert">{recovery === "access" ? (zh ? "此规则已不可操作，请重新打开设置检查权限和可用性。" : "This rule is no longer available to edit. Reopen settings to check access and availability.") : check.isError ? (zh ? "核对失败，尚未确认系统状态。请检查连接后重试核对。" : "Check failed; the current publication is unconfirmed. Check your connection and retry.") : recovery === "conflict" ? (zh ? "系统提供状态已被其他窗口更新。你的选择已保留，请先查看当前状态。" : "Another window changed the publication. Your choice is retained; review the current state first.") : (zh ? "尚未确认操作结果。请先核对，避免重复发布或撤回。" : "The result is unconfirmed. Check it before publishing or withdrawing again.")}</p>{recovery !== "access" ? <button type="button" disabled={busy} className="btn-secondary min-h-11 px-3" onClick={() => check.mutate()}>{check.isPending ? (zh ? "正在核对…" : "Checking…") : (zh ? "检查当前发布" : "Check current publication")}</button> : null}</div> : null}
      {comparison ? <div className="space-y-3 border-l-2 border-[var(--color-semantic-warning)] pl-3" aria-label={zh ? "发布状态比较" : "Publication comparison"}>
        <p>{zh ? "当前状态与本次选择不同。请比较后决定，尚未再次提交。" : "The current state differs from your choice. Compare before deciding; nothing has been resubmitted."}</p>
        <div className="grid grid-cols-2 gap-3 break-words [overflow-wrap:anywhere]"><div><p className="font-semibold">{zh ? "当前系统" : "Current system"}</p><p>{comparison.name}</p><p>{comparison.published_revision_id ? `v${comparison.published_revision}` : (zh ? "未发布" : "Not published")}</p></div><div><p className="font-semibold">{zh ? "你的选择" : "Your choice"}</p><p>{attempt?.action === "withdraw" ? (zh ? "撤回系统提供" : "Withdraw publication") : attempt?.name}</p>{attempt?.action === "publish" ? <p>v{attempt.revision?.revision}</p> : null}</div></div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={rebase} className="btn-secondary min-h-11 px-3">{zh ? "保留选择，重新确认" : "Keep choice and reconfirm"}</button><button type="button" disabled={busy} onClick={cancel} className="btn-secondary min-h-11 px-3">{zh ? "使用当前系统状态" : "Use current system state"}</button></div>
      </div> : null}
    </div>
    {open ? <div className="flex flex-wrap gap-2"><button type="button" disabled={blocked || historyUnavailable || !selected?.validated || !name.trim() || selected.id === rule.published_revision_id && name.trim() === rule.name} onClick={() => void act("publish")} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "发布所选版本" : "Publish selected version"}</button>{rule.published_revision_id ? <button type="button" disabled={blocked} onClick={() => void act("withdraw")} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "撤回系统提供" : "Withdraw publication"}</button> : null}{dirty && !recovery && !comparison ? <button type="button" disabled={busy} onClick={cancel} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "取消更改" : "Cancel changes"}</button> : null}</div> : null}
  </article>;
}
