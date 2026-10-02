"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, ChevronDown, ChevronUp, FileText, Layers3, Wrench } from "lucide-react";
import { useState, useLayoutEffect } from "react";
import { getImportFormats, getImportFormatRevisions, updateImportFormat } from "../lib/api";
import type { ImportFormatProfile } from "../lib/types";
import { useImportDialog } from "./import-dialog-provider";
import { usePreferences } from "./preferences-provider";

type ImportAction = (options?: { repairProfileId?: string }) => void;

export function ImportFormatSettings({ focused = false, onDirtyChange, onOpenImport }: { focused?: boolean; onDirtyChange?: (dirty: boolean) => void; onOpenImport?: ImportAction }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const { openImportDialog } = useImportDialog();
  const [open, setOpen] = useState(focused);
  const [dirtyProfiles, setDirtyProfiles] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: ["import-formats"], queryFn: getImportFormats, enabled: open });
  useLayoutEffect(() => { onDirtyChange?.(dirtyProfiles.size > 0); }, [dirtyProfiles, onDirtyChange]);
  const title = zh ? "我的导入格式" : "My import formats";
  return <section className={focused ? "space-y-4" : "border-t border-ui pt-3"}>
    {!focused ? <button type="button" onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center justify-between text-left text-sm font-medium text-primary" aria-expanded={open}>{title}{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button> : <h3 className="text-sm font-semibold text-primary">{title}</h3>}
    {open ? <>
      <p className="text-xs leading-5 text-secondary">{zh ? "导入时确认字段映射并通过整批校验，即可学习格式。已学习或成功使用的版本会保留在你的账户中。" : "Learn a format by confirming its mapping and validating the whole import batch. Versions you learn or successfully use remain available to your account."}</p>
      {query.isLoading ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取格式…" : "Loading formats…"}</p> : null}
      {query.isError ? <div role="alert" className="text-sm text-[var(--danger)]"><p>{query.error.message}</p><button type="button" className="btn-secondary mt-2 min-h-11 px-3" onClick={() => void query.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
      {query.data && !query.data.some((profile) => profile.kind === "LEARNED") ? <div className="border-y border-ui py-3"><p className="text-sm text-secondary">{zh ? "尚无个人或系统提供的学习格式，内置格式仍可直接导入。" : "No learned formats are available yet. Built-in formats are ready to use."}</p><button type="button" className="btn-secondary mt-2 min-h-11 px-3 text-sm" onClick={() => (onOpenImport ?? openImportDialog)()}>{zh ? "导入并学习" : "Import and learn"}</button></div> : null}
      <div className="divide-y divide-[var(--border)]">{query.data?.toSorted((left, right) => Number(left.kind === "BUILTIN") - Number(right.kind === "BUILTIN")).map((profile) => {
        const key = profile.id ?? profile.key ?? profile.name;
        return <FormatRow key={key} profile={profile} onOpenImport={onOpenImport ?? openImportDialog} onDirtyChange={(dirty) => setDirtyProfiles((current) => { if (current.has(key) === dirty) return current; const next = new Set(current); if (dirty) next.add(key); else next.delete(key); return next; })} />;
      })}</div>
    </> : null}
  </section>;
}

function FormatRow({ profile, onDirtyChange, onOpenImport }: { profile: ImportFormatProfile; onDirtyChange: (dirty: boolean) => void; onOpenImport: ImportAction }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A nullable draft allows refreshes without replacing unsaved input.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? profile.name;
  const dirty = profile.kind === "LEARNED" && name.trim() !== profile.name;
  const revisions = useQuery({ queryKey: ["import-format-revisions", profile.id], queryFn: () => getImportFormatRevisions(profile.id!), enabled: detailsOpen && Boolean(profile.id) });
  const update = useMutation({ mutationFn: (input: { name?: string; status?: "ACTIVE" | "DISABLED" }) => updateImportFormat(profile.id!, input), onSuccess: async (_, input) => {
    await queryClient.invalidateQueries({ queryKey: ["import-formats"] });
    if (input.name !== undefined) setNameDraft(null);
  } });
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const Icon = profile.source_mode === "JSON_MARKDOWN" ? Layers3 : profile.source_mode === "MARKDOWN" ? FileText : Braces;
  const source = profile.kind === "BUILTIN" ? (zh ? "内置 · 只读" : "Built-in · Read only") : [profile.held ? (zh ? "已学习" : "Learned") : null, profile.system_provided ? (zh ? "系统提供" : "System provided") : null].filter(Boolean).join(" · ");
  const descriptions: Record<string, string> = {
    "builtin:chat-reader-exporter": "Chat Reader 原生 JSON，可配对 Markdown 正文。",
    "builtin:chat-reader-markdown-v2": "Chat Reader 原生 Markdown 导出，版本 2。",
    "builtin:canjson-v1": "CanJSON 版本 1 兼容格式。",
    "builtin:canjson-v2": "CanJSON 版本 2 兼容格式。",
    "builtin:chat-reader-markdown": "使用 Prompt / Response 分隔的 Markdown 对话。",
  };
  const description = zh && profile.key ? descriptions[profile.key] ?? profile.description : profile.description;
  return <article className="py-4" aria-label={profile.name}>
    <div className="flex items-start gap-3"><Icon className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /><div className="min-w-0 flex-1">
      <p className="break-words text-sm font-semibold text-primary">{profile.name}</p>
      <p className="mt-1 text-xs text-secondary">{source} · {profile.source_mode.replace("_", " + ")}{profile.kind === "LEARNED" ? " · " + (zh ? "可用版本" : "Available versions") + ": " + (profile.revision_count ?? 0) : ""}</p>
      {profile.verification_summary?.valid ? <p className="mt-1 text-xs text-secondary">{zh ? "全批次验证通过" : "Full batch verified"} · {profile.verification_summary.group_count ?? 0} {zh ? "组" : "groups"}</p> : null}
      {description ? <p className="mt-2 text-xs leading-5 text-secondary">{description}</p> : null}
    </div></div>
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      {profile.kind === "LEARNED" ? <button type="button" disabled={update.isPending} onClick={() => update.mutate({ status: profile.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })} className="btn-secondary min-h-11 px-3">{profile.status === "ACTIVE" ? (zh ? "停用自动识别" : "Disable matching") : (zh ? "启用自动识别" : "Enable matching")}</button> : null}
      {profile.kind === "LEARNED" && profile.id ? <button type="button" onClick={() => onOpenImport({ repairProfileId: profile.id! })} className="btn-secondary inline-flex min-h-11 items-center gap-1 px-3"><Wrench className="h-3.5 w-3.5" aria-hidden="true" />{zh ? "重新学习／修复" : "Relearn / repair"}</button> : null}
      {profile.id ? <button type="button" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen} className="btn-secondary min-h-11 px-3">{detailsOpen ? (zh ? "收起详情" : "Hide details") : (zh ? "版本与个人设置" : "Versions and preferences")}</button> : null}
    </div>
    {detailsOpen ? <div className="mt-3 space-y-3 rounded-lg border border-ui p-3">
      {profile.kind === "LEARNED" ? <form onSubmit={(event) => { event.preventDefault(); if (dirty && name.trim()) update.mutate({ name: name.trim() }); }} className="space-y-2"><label className="block text-xs font-medium text-secondary">{zh ? "个人显示名称" : "Your display name"}<input value={name} maxLength={200} disabled={update.isPending} onChange={(event) => setNameDraft(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-3 text-sm text-primary" /></label><div className="flex gap-2"><button type="submit" disabled={!dirty || !name.trim() || update.isPending} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "保存名称" : "Save name"}</button>{dirty ? <button type="button" disabled={update.isPending} onClick={() => setNameDraft(null)} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "取消更改" : "Cancel changes"}</button> : null}</div></form> : null}
      <p className="text-xs leading-5 text-secondary">{zh ? "点击重新学习／修复并上传来源，即可运行格式健康检查，查看每组结果和失败原因，再按需修复映射。检查不会创建对话；保存新版本须整批验证通过。" : "Choose Relearn / repair and upload source files to check format health, review each group and repair its mapping if needed. Checking creates no conversations; saving a version requires the whole batch to pass."}</p>
      {revisions.isLoading ? <p role="status" className="text-xs text-secondary">{zh ? "正在读取版本…" : "Loading versions…"}</p> : null}
      {revisions.isError ? <div role="alert"><p className="text-xs text-[var(--danger)]">{revisions.error.message}</p><button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => void revisions.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
      {revisions.data?.map((revision) => <div key={revision.id} className="border-t border-ui pt-3"><p className="text-xs font-medium text-primary">{zh ? "版本" : "Version"} {revision.revision}{revision.current ? (zh ? " · 当前可用" : " · Current available") : (zh ? " · 历史兼容" : " · Historical compatibility")}{revision.id === profile.published_revision_id ? (zh ? " · 系统发布" : " · Published") : ""}</p><details className="mt-2"><summary className="min-h-8 cursor-pointer text-xs text-accent">{zh ? "查看字段映射" : "View field mapping"}</summary><pre className="max-h-64 overflow-auto rounded-md bg-subtle p-2 text-xs text-secondary">{JSON.stringify(revision.mapping_spec, null, 2)}</pre></details></div>)}
    </div> : null}
    {update.isPending ? <p role="status" className="mt-2 text-xs text-secondary">{zh ? "正在保存…" : "Saving…"}</p> : null}
    {update.isSuccess ? <p role="status" className="mt-2 text-xs text-secondary">{zh ? "个人设置已保存" : "Personal settings saved"}</p> : null}
    {update.isError ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{update.error.message}</p> : null}
  </article>;
}
