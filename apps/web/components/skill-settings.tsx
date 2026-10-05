"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSkill, deleteSkill, getSkills, setSkillSelection, updateSkill } from "../lib/api";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { SkillBundleFiles } from "./skill-bundle-files";
import type { SkillCategory, SkillRead } from "../lib/types";

const categories: Array<{ id: SkillCategory; label: string }> = [
  { id: "EXPORT_CONTEXT", label: "接续上下文" },
  { id: "CONVERSATION_RESCUE", label: "转换格式" },
  { id: "CONTEXT_MAINTENANCE", label: "维护上下文" },
];


export function SkillSettings({ focused = false, onDirtyChange }: { focused?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const { confirm, prompt } = useInteractionDialog();
  const fileInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<SkillCategory>("EXPORT_CONTEXT");
  const [uploadOpen, setUploadOpen] = useState(false);
  const locale = zh ? "zh-CN" : "en";
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bundleBusy, setBundleBusy] = useState<Record<string, boolean>>({});
  const [bundleDirty, setBundleDirty] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["skills", category, locale], queryFn: () => getSkills({ category, locale }) });
  const dirty = Boolean(name.trim() || file || Object.values(bundleDirty).some(Boolean));
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const refreshSkills = async () => {
    await queryClient.cancelQueries({ queryKey: ["skills"] });
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["skills"] }), queryClient.invalidateQueries({ queryKey: ["resolved-skill"] })]);
  };
  const upload = useMutation({
    mutationFn: () => file && /\.(zip|md)$/i.test(file.name) ? createSkill({ category, name: name.trim() || file.name.replace(/\.(zip|md)$/i, ""), file }) : Promise.reject(new Error(zh ? "请选择 Skill ZIP 或 Markdown 文件" : "Choose a Skill ZIP or Markdown file")),
    onSuccess: () => { setName(""); setFile(null); if (fileInput.current) fileInput.current.value = ""; setNotice(zh ? "已保存 Skill；如需使用，请手动设置为首选。" : "Skill saved. Set it as preferred to use it."); return refreshSkills(); },
  });
  const select = useMutation({ mutationFn: (skillId: string | null) => setSkillSelection({ category, skill_id: skillId }), onSuccess: () => { return refreshSkills(); } });
  const toggle = useMutation({ mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) => updateSkill(id, { status }), onSuccess: () => { return refreshSkills(); } });
  const remove = useMutation({ mutationFn: (id: string) => deleteSkill(id), onSuccess: (_result, id) => { setBundleDirty((previous) => ({ ...previous, [id]: false })); return refreshSkills(); } });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => updateSkill(id, { name }),
    onSuccess: () => { return refreshSkills(); } });
  const busy = query.isPending || upload.isPending || select.isPending || toggle.isPending || remove.isPending || rename.isPending || Object.values(bundleBusy).some(Boolean);
  const error = query.error ?? select.error ?? toggle.error ?? remove.error ?? rename.error;
  const changeScope = async (change: () => void) => {
    if (busy) return;
    if (dirty && !await confirm({ title: zh ? "放弃未保存的更改？" : "Discard unsaved changes?", description: zh ? "切换后需要重新选择尚未保存的文件。" : "You will need to select unsaved files again after switching.", confirmLabel: zh ? "放弃并切换" : "Discard and switch" })) return;
    setName(""); setFile(null); setBundleDirty({}); setNotice(null); setUploadOpen(false);
    if (fileInput.current) fileInput.current.value = "";
    onDirtyChange?.(false); change();
  };
  const rows = useMemo(() => query.data ?? [], [query.data]);
  return <section className={focused ? "space-y-4" : "space-y-3"}>
    {!focused ? <h3 className="text-sm font-semibold text-primary">{zh ? "Skill 管理" : "Skills"}</h3> : null}
    <div className="grid grid-cols-3 rounded-lg bg-subtle p-1">{categories.map((item) => <button key={item.id} type="button" disabled={busy} aria-pressed={category === item.id} onClick={() => category !== item.id && void changeScope(() => setCategory(item.id))} className={`min-h-11 rounded-md px-3 text-sm ${category === item.id ? "bg-surface font-medium shadow-sm" : "text-secondary"}`}>{zh ? item.label : ({ EXPORT_CONTEXT: "Acquisition", CONVERSATION_RESCUE: "Format conversion", CONTEXT_MAINTENANCE: "Maintenance" })[item.id]}</button>)}</div>
    {rows.some(skill => skill.legacy_selection_conflict) ? <p role="status" className="text-sm text-secondary">{zh ? "你之前按语言选择了不同 Skill。请选择一个统一首选；原文件都会保留。" : "Your previous language choices differ. Choose one preferred Skill; all original files stay available."}</p> : null}
    <div className="space-y-2">{query.isLoading ? <p className="text-xs text-secondary">{zh ? "正在读取 Skill…" : "Loading Skills…"}</p> : null}{rows.map((skill) => <SkillRow key={skill.id} skill={skill} busy={busy} onBusyChange={(value) => setBundleBusy((previous) => previous[skill.id] === value ? previous : { ...previous, [skill.id]: value })} onRename={async () => { const value = await prompt({ title: zh ? "修改 Skill 名称" : "Rename Skill", initialValue: skill.name, label: zh ? "名称" : "Name" }); if (value?.trim() && value.trim() !== skill.name) rename.mutate({ id: skill.id, name: value.trim() }); }} onDirtyChange={(value) => setBundleDirty((previous) => previous[skill.id] === value ? previous : { ...previous, [skill.id]: value })} onSelect={() => select.mutate(skill.source === "USER" ? skill.id : null)} onToggle={() => skill.source === "USER" && toggle.mutate({ id: skill.id, status: skill.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })} onDelete={async () => { if (skill.source === "USER" && await confirm({ title: zh ? `删除“${skill.name}”？` : `Delete “${skill.name}”?`, description: zh ? "此 Skill 的文件和版本记录将被删除。" : "This removes the Skill and its version history.", danger: true })) { remove.mutate(skill.id); } }} />)}</div>
    <button type="button" disabled={busy} aria-expanded={uploadOpen} onClick={() => setUploadOpen(value => !value)} className="btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-sm"><Upload className="h-4 w-4" />{zh ? "上传我的 Skill" : "Upload my Skill"}</button>
    {uploadOpen ? <div className="rounded-xl border border-dashed border-ui bg-subtle/50 p-3"><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="text-xs text-secondary">{zh ? "Skill 名称" : "Skill name"}<input value={name} disabled={busy} onChange={(e) => { setName(e.target.value); if (e.target.value) onDirtyChange?.(true); }} className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-2 text-base sm:text-sm text-primary" placeholder={zh ? "默认使用文件名" : "Defaults to filename"} /></label><div className="min-w-0"><button type="button" disabled={busy} className="btn-secondary min-h-11 w-full px-3 text-sm" onClick={() => fileInput.current?.click()}>{zh ? "选择文件" : "Choose file"}</button><input ref={fileInput} disabled={busy} type="file" accept=".zip,.md" aria-label={zh ? "选择 Skill ZIP 或 Markdown 文件" : "Choose a Skill ZIP or Markdown file"} onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.length) onDirtyChange?.(true); }} hidden />{file ? <p className="mt-1 break-all text-xs text-secondary">{file.name}</p> : null}</div><button type="button" disabled={!file || busy} onClick={() => upload.mutate()} className="btn-primary min-h-11 px-3 text-sm disabled:opacity-50">{upload.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : (zh ? "保存 Skill" : "Save Skill")}</button></div>{notice ? <p className="mt-2 text-xs text-accent" role="status">{notice}</p> : null}{upload.isError ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{upload.error.message}</p> : null}</div> : null}

    {error ? <div role="alert" className="text-xs text-[var(--danger)]"><p>{error.message}</p>{query.isError ? <button type="button" onClick={() => void query.refetch()} className="mt-2 underline">{zh ? "重新加载" : "Retry loading"}</button> : null}</div> : null}
  </section>;
}

function SkillRow({ skill, busy, onBusyChange, onRename, onSelect, onToggle, onDelete, onDirtyChange }: { skill: SkillRead; busy: boolean; onBusyChange: (busy: boolean) => void; onRename: () => void; onDirtyChange: (dirty: boolean) => void; onSelect: () => void; onToggle: () => void; onDelete: () => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const system = skill.source !== "USER";
  const displayName = skill.source === "BUILTIN" && !skill.is_customized
    ? ({ EXPORT_CONTEXT: "context-acquisition", CONVERSATION_RESCUE: "chat-transcript-normalizer-skill", CONTEXT_MAINTENANCE: "context-continuation-maintainer" })[skill.category]
    : skill.name;
  return <article className="border-b border-ui py-4 first:pt-0 last:border-b-0">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="break-words text-sm font-medium text-primary">{displayName}</p>
        <p className="mt-1 text-xs text-secondary">{system ? (zh ? "系统提供" : "System provided") : (zh ? "个人" : "Personal")}{skill.status === "DISABLED" ? (zh ? " · 已禁用" : " · Disabled") : ""}{skill.is_legacy_preferred ? (zh ? " · 之前的首选" : " · Previous preference") : ""}</p>
      </div>
      {skill.is_selected ? <span className="shrink-0 text-xs font-medium text-accent">{system ? (zh ? "正在使用" : "In use") : (zh ? "首选" : "Preferred")}</span> : null}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {skill.bundle_url ? <a href={skill.bundle_url} download className="inline-flex min-h-11 items-center gap-1 text-secondary hover:text-primary"><Download className="h-4 w-4" />{zh ? "下载" : "Download"}</a> : null}
      {!system && (!skill.is_selected || skill.legacy_selection_conflict) ? <button type="button" disabled={busy || skill.status !== "ACTIVE"} onClick={onSelect} className="min-h-11 text-accent">{zh ? "设为首选" : "Set as preferred"}</button> : null}
      {system && (!skill.is_selected || skill.legacy_selection_conflict) ? <button type="button" disabled={busy} onClick={onSelect} className="inline-flex min-h-11 items-center gap-1 text-accent"><RotateCcw className="h-4 w-4" />{zh ? "使用系统默认" : "Use system default"}</button> : null}
      {!system ? <><button type="button" disabled={busy} onClick={onRename} className="min-h-11 min-w-11 text-secondary">{zh ? "改名" : "Rename"}</button><button type="button" disabled={busy} onClick={onToggle} className="min-h-11 min-w-11 text-secondary">{skill.status === "ACTIVE" ? (zh ? "禁用" : "Disable") : (zh ? "启用" : "Enable")}</button><button type="button" disabled={busy} onClick={onDelete} className="inline-flex min-h-11 items-center gap-1 text-[var(--danger)]"><Trash2 className="h-4 w-4" />{zh ? "删除" : "Delete"}</button></> : null}
    </div>
    {!system ? <SkillBundleFiles skill={skill} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} /> : null}
  </article>;
}
