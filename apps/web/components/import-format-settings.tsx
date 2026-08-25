"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, ChevronDown, ChevronUp, FileText, Layers3, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteImportFormat, getImportFormats, getImportFormatRevisions, updateImportFormat } from "../lib/api";
import type { ImportFormatProfile } from "../lib/types";
import { useImportDialog } from "./import-dialog-provider";

export function ImportFormatSettings({ focused = false, onDirtyChange, onOpenImport }: { focused?: boolean; onDirtyChange?: (dirty: boolean) => void; onOpenImport?: (options?: { repairProfileId?: string }) => void }) {
  const [open, setOpen] = useState(focused);
  const [dirtyProfiles, setDirtyProfiles] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: ["import-formats"], queryFn: getImportFormats, enabled: open });
  useEffect(() => {
    onDirtyChange?.(dirtyProfiles.size > 0);
  }, [dirtyProfiles, onDirtyChange]);
  return (
    <section className={focused ? "space-y-3" : "border-t border-ui pt-3"}>
      {!focused ? <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-9 w-full items-center justify-between text-left text-sm font-medium text-primary" aria-expanded={open}>
        <span><span className="block">导入格式</span><span className="mt-0.5 block text-xs font-normal text-secondary">管理内置与已学习的 JSON / Markdown 格式</span></span>
        {open ? <ChevronUp className="h-4 w-4 text-secondary" /> : <ChevronDown className="h-4 w-4 text-secondary" />}
      </button> : <div><h3 className="text-sm font-semibold text-primary">导入格式</h3><p className="mt-1 text-xs leading-5 text-secondary">管理内置与已学习的 JSON / Markdown 格式。</p></div>}
      {open ? <div className="mt-3 space-y-3">{query.isLoading ? <p className="text-xs text-secondary">正在读取导入格式…</p> : null}{query.isError ? <p role="alert" className="text-xs text-[var(--danger)]">{query.error.message}</p> : null}{query.data?.map((profile) => { const profileKey = profile.id ?? profile.key ?? profile.name; return <FormatRow key={profileKey} profile={profile} onOpenImport={onOpenImport} onDirtyChange={(dirty) => setDirtyProfiles((current) => { const next = new Set(current); if (dirty) next.add(profileKey); else next.delete(profileKey); return next; })} />; })}</div> : null}
    </section>
  );
}

function FormatRow({ profile, onDirtyChange, onOpenImport }: { profile: ImportFormatProfile; onDirtyChange?: (dirty: boolean) => void; onOpenImport?: (options?: { repairProfileId?: string }) => void }) {
  const { openImportDialog } = useImportDialog();
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [name, setName] = useState(profile.name);
  const revisions = useQuery({ queryKey: ["import-format-revisions", profile.id], queryFn: () => getImportFormatRevisions(profile.id!), enabled: detailsOpen && Boolean(profile.id) });
  const updateMutation = useMutation({ mutationFn: (input: { name?: string; status?: "ACTIVE" | "DISABLED" }) => updateImportFormat(profile.id!, input), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["import-formats"] }) });
  const deleteMutation = useMutation({ mutationFn: () => deleteImportFormat(profile.id!), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["import-formats"] }) });
  const Icon = profile.source_mode === "JSON_MARKDOWN" ? Layers3 : profile.source_mode === "MARKDOWN" ? FileText : Braces;
  useEffect(() => {
    onDirtyChange?.(profile.kind === "LEARNED" && name.trim() !== profile.name);
  }, [name, onDirtyChange, profile.kind, profile.name]);
  return (
    <article className="border-l-2 border-ui pl-3">
      <div className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><div className="min-w-0 flex-1">
        {profile.kind === "LEARNED" ? <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && name !== profile.name && updateMutation.mutate({ name: name.trim() })} className="h-7 w-full bg-transparent text-sm font-medium text-primary outline-none focus:ring-1 focus:ring-[var(--focus)]" aria-label="导入格式名称" /> : <p className="truncate text-sm font-medium text-primary">{profile.name}</p>}
        <p className="mt-0.5 text-xs text-secondary">{profile.kind === "BUILTIN" ? "内置 · 只读" : `已学习 · ${profile.revision_count ?? 0} 个版本`} · {profile.source_mode.replace("_", " + ")}</p>
      </div></div>
      {profile.description ? <p className="mt-2 text-xs leading-5 text-secondary">{profile.description}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {profile.kind === "LEARNED" ? <button type="button" onClick={() => updateMutation.mutate({ status: profile.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })} className="font-medium text-accent underline">{profile.status === "ACTIVE" ? "禁用" : "启用"}</button> : null}
        {profile.kind === "LEARNED" && profile.id ? <button type="button" onClick={() => (onOpenImport ?? openImportDialog)({ repairProfileId: profile.id! })} className="inline-flex items-center gap-1 font-medium text-accent underline"><Wrench className="h-3.5 w-3.5" />修复格式</button> : null}
        {profile.id ? <button type="button" onClick={() => setDetailsOpen((value) => !value)} className="font-medium text-secondary underline">{detailsOpen ? "收起映射" : "查看映射"}</button> : null}
        {profile.kind === "LEARNED" ? <button type="button" onClick={() => window.confirm(`删除导入格式“${profile.name}”？历史导入不会受影响。`) && deleteMutation.mutate()} className="inline-flex items-center gap-1 font-medium text-[var(--danger)]"><Trash2 className="h-3.5 w-3.5" />删除</button> : null}
      </div>
      {detailsOpen ? <div className="mt-3"><p className="mb-2 text-xs leading-5 text-secondary">结构变化时使用“修复格式”上传一组代表性文件；验证成功会新增版本，旧版本继续用于旧来源。</p>{revisions.isLoading ? <p className="text-xs text-secondary">正在读取…</p> : revisions.data?.length ? <div className="max-h-60 divide-y divide-ui overflow-auto border-y border-ui">{revisions.data.map((revision) => <div key={revision.id} className="py-2.5"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-primary">版本 {revision.revision}{revision.current ? " · 当前" : ""}</span><span className="text-secondary">{revision.status === "SUPERSEDED" ? "历史兼容" : "已验证"}</span></div><details className="mt-1.5"><summary className="cursor-pointer text-xs font-medium text-accent">查看字段映射</summary><pre className="mt-2 overflow-auto rounded-md bg-subtle p-2 text-[11px] leading-5 text-secondary">{JSON.stringify(revision.mapping_spec, null, 2)}</pre></details></div>)}</div> : <p className="text-xs text-secondary">没有版本数据</p>}</div> : null}
      {updateMutation.isError || deleteMutation.isError ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{updateMutation.error?.message ?? deleteMutation.error?.message}</p> : null}
    </article>
  );
}
