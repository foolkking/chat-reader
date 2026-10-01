"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminApi, type AdminNoiseRule, type AdminNoiseRevision } from "../lib/admin-client";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

export function AdminNoiseRuleSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [offset, setOffset] = useState(0);
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: ["admin-noise-rules", offset], queryFn: () => adminApi.noiseRules(offset) });
  useEffect(() => { onDirtyChange?.(dirtyRows.size > 0); }, [dirtyRows, onDirtyChange]);
  return <section className="space-y-4"><p className="text-sm leading-6 text-secondary">{zh ? "选择一个已验证的规则版本，确认匹配范围后向全系统提供。个人修改不自动发布；用户已学习或成功应用的版本在撤回后仍然可用。" : "Review a validated rule version and its matching scope before publishing. Personal edits are not published automatically. Versions learned or successfully applied remain available after withdrawal."}</p>
    {query.isLoading ? <p role="status">{zh ? "正在读取候选规则…" : "Loading candidate rules…"}</p> : null}
    {query.error ? <Retry error={query.error} retry={() => void query.refetch()} zh={zh} /> : null}
    {query.data?.total === 0 ? <p className="text-sm text-secondary">{zh ? "尚无已学习的文本规则。" : "No learned text rules yet."}</p> : null}
    <div className="divide-y divide-[var(--border)]">{query.data?.items.map((rule) => <PublicationRow key={rule.id} rule={rule} onDirtyChange={(dirty) => setDirtyRows((previous) => { if (previous.has(rule.id) === dirty) return previous; const next = new Set(previous); if (dirty) next.add(rule.id); else next.delete(rule.id); return next; })} />)}</div>
    {query.data ? <Pages total={query.data.total} offset={offset} onChange={setOffset} disabled={dirtyRows.size > 0} zh={zh} /> : null}
  </section>;
}

function PublicationRow({ rule, onDirtyChange }: { rule: AdminNoiseRule; onDirtyChange: (dirty: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminNoiseRevision | null>(null);
  const name = nameDraft ?? rule.name;
  const dirty = (nameDraft !== null && nameDraft !== rule.name) || (selected !== null && selected.id !== rule.published_revision_id);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const revisions = useQuery({ queryKey: ["admin-noise-rule-revisions", rule.id, offset], queryFn: () => adminApi.noiseRuleRevisions(rule.id, offset), enabled: open });
  const mutation = useMutation({ mutationFn: async (action: "publish" | "withdraw") => { if (action === "publish") await adminApi.publishNoiseRule(rule.id, selected!.id, name.trim()); else await adminApi.withdrawNoiseRule(rule.id); }, onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["admin-noise-rules"] }), client.invalidateQueries({ queryKey: ["content-cleanup-rules"] }), client.invalidateQueries({ queryKey: ["cleanup-rule-revisions"] })]);
    setNameDraft(null); setSelected(null);
  } });
  const publish = async () => {
    if (selected && await confirm({ title: zh ? "发布此噪声规则版本？" : "Publish this noise rule version?", description: zh ? `${name.trim()} · 版本 ${selected.revision}。所有用户可用于扫描，但删除正文仍需逐次确认。` : `${name.trim()} · version ${selected.revision}. Available to all users for scanning; removing text still requires explicit review.`, confirmLabel: zh ? "确认发布" : "Publish" })) mutation.mutate("publish");
  };
  const withdraw = async () => {
    if (await confirm({ title: zh ? "撤回系统提供？" : "Withdraw system availability?", description: zh ? "停止向新用户提供。已有授权、历史版本和进行中的审查保持可用。" : "Stop offering this rule to new users. Acquired versions, history and admitted reviews remain available.", confirmLabel: zh ? "确认撤回" : "Withdraw" })) mutation.mutate("withdraw");
  };
  return <article aria-label={rule.name} className="space-y-3 py-4"><button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-11 w-full rounded-lg text-left hover:bg-subtle"><span className="block text-sm font-semibold">{rule.name === "Text rule" && zh ? "文本规则" : rule.name}</span><span className="mt-1 block text-xs text-secondary">{rule.published_revision_id ? (zh ? "系统提供中" : "Published") : (zh ? "未发布" : "Not published")} · {rule.revision_count} {zh ? "个历史版本" : "historical versions"} · {rule.source_account_available ? (zh ? "来源账户存在" : "Source account available") : (zh ? "来源账户已删除" : "Source account deleted")}</span></button>
    {open ? <div className="space-y-3 rounded-lg border border-ui p-3"><label className="block text-xs font-medium text-secondary">{zh ? "系统显示名称" : "System display name"}<input maxLength={200} disabled={mutation.isPending} value={name} onChange={(event) => setNameDraft(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary" /></label>
      <p className="text-xs font-medium text-secondary">{zh ? "选择发布版本" : "Choose a version to publish"}</p>
      {revisions.isLoading ? <p role="status">{zh ? "正在读取版本…" : "Loading versions…"}</p> : null}
      {revisions.error ? <Retry error={revisions.error} retry={() => void revisions.refetch()} zh={zh} /> : null}
      <div className="space-y-2">{revisions.data?.items.map((item) => <label key={item.id} className="flex min-h-11 items-start gap-3 rounded-lg border border-ui p-3 text-xs"><input type="radio" name={`rule-${rule.id}`} checked={selected?.id === item.id} disabled={mutation.isPending} onChange={() => setSelected(item)} /><span className="min-w-0"><span className="font-medium">v{item.revision} · {item.validated ? (zh ? "配置验证通过" : "Configuration validated") : (zh ? "未通过验证" : "Not validated")}{item.id === rule.published_revision_id ? (zh ? " · 当前发布" : " · Published") : ""}</span><code className="mt-1 block whitespace-pre-wrap break-words text-secondary">{item.configuration.match_value}</code></span></label>)}</div>
      {revisions.data ? <Pages total={revisions.data.total} offset={offset} onChange={setOffset} disabled={mutation.isPending} zh={zh} /> : null}
      {selected ? <div className="space-y-2 rounded-lg bg-subtle p-3 text-xs"><p className="font-semibold">{zh ? "将发布的匹配范围" : "Matching scope to publish"} · v{selected.revision}</p><pre className="whitespace-pre-wrap break-words">{selected.configuration.match_value}</pre><p>{zh ? "角色" : "Role"}: {selected.configuration.role_filter ?? (zh ? "全部" : "All")} · {zh ? "方式" : "Mode"}: {selected.configuration.matcher_mode} · {zh ? "边界" : "Boundary"}: {selected.configuration.boundary_mode}</p><p>{selected.configuration.case_sensitive ? (zh ? "区分大小写" : "Case-sensitive") : (zh ? "不区分大小写" : "Case-insensitive")}</p></div> : null}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={mutation.isPending || !selected?.validated || !name.trim() || (selected.id === rule.published_revision_id && name.trim() === rule.name)} onClick={() => void publish()} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "发布所选版本" : "Publish selected version"}</button>{rule.published_revision_id ? <button type="button" disabled={mutation.isPending} onClick={() => void withdraw()} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "撤回系统提供" : "Withdraw publication"}</button> : null}{dirty ? <button type="button" disabled={mutation.isPending} onClick={() => { setNameDraft(null); setSelected(null); }} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "取消更改" : "Cancel changes"}</button> : null}</div>
    </div> : null}
    {mutation.isPending ? <p role="status" className="text-xs">{zh ? "正在保存…" : "Saving…"}</p> : null}{mutation.isSuccess ? <p role="status" className="text-xs text-secondary">{zh ? "系统提供状态已更新。" : "Publication updated."}</p> : null}{mutation.error ? <p role="alert" className="text-xs text-[var(--danger)]">{mutation.error.message}</p> : null}
  </article>;
}

function Retry({ error, retry, zh }: { error: Error; retry: () => void; zh: boolean }) {
  return <div role="alert"><p className="text-xs text-[var(--danger)]">{error.message}</p><button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={retry}>{zh ? "重试" : "Retry"}</button></div>;
}

function Pages({ total, offset, onChange, disabled, zh }: { total: number; offset: number; onChange: (next: number) => void; disabled: boolean; zh: boolean }) {
  if (total <= 20) return null;
  return <nav aria-label={zh ? "规则分页" : "Rule pages"} className="flex flex-wrap items-center justify-between gap-2 text-xs"><button type="button" disabled={disabled || !offset} className="btn-secondary min-h-11 px-3" onClick={() => onChange(Math.max(0, offset - 20))}>{zh ? "上一页" : "Previous"}</button><span>{offset + 1}–{Math.min(offset + 20, total)} / {total}</span><button type="button" disabled={disabled || offset + 20 >= total} className="btn-secondary min-h-11 px-3" onClick={() => onChange(offset + 20)}>{zh ? "下一页" : "Next"}</button></nav>;
}
