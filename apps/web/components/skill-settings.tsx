"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Loader2, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createSkill, deleteSkill, getSkill, getSkills, setSkillSelection, updateSkill } from "../lib/api";
import type { SkillCategory, SkillLocale, SkillRead } from "../lib/types";

const categories: Array<{ id: SkillCategory; label: string }> = [
  { id: "EXPORT_CONTEXT", label: "导出 Skill" },
  { id: "CONVERSATION_RESCUE", label: "转换格式 Skill" },
];
const locales: Array<{ id: SkillLocale; label: string }> = [{ id: "zh-CN", label: "中文" }, { id: "en", label: "English" }];

export function SkillSettings({ focused = false, onDirtyChange }: { focused?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [category, setCategory] = useState<SkillCategory>("EXPORT_CONTEXT");
  const [locale, setLocale] = useState<SkillLocale>("zh-CN");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SkillRead | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["skills", category, locale], queryFn: () => getSkills({ category, locale }) });
  const dirty = Boolean(name.trim() || file);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const upload = useMutation({
    mutationFn: () => file ? createSkill({ category, locale, name: name.trim() || file.name.replace(/\.md$/i, ""), file }) : Promise.reject(new Error("请选择 .md 文件")),
    onSuccess: () => { setName(""); setFile(null); setNotice("已保存 Skill；如需使用，请手动设置为首选。"); void queryClient.invalidateQueries({ queryKey: ["skills"] }); },
  });
  const select = useMutation({ mutationFn: (skillId: string | null) => setSkillSelection({ category, locale, skill_id: skillId }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["skills"] }) });
  const toggle = useMutation({ mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) => updateSkill(id, { status }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["skills"] }) });
  const remove = useMutation({ mutationFn: (id: string) => deleteSkill(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["skills"] }) });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  return <section className={focused ? "space-y-4" : "space-y-3"}>
    {!focused ? <h3 className="text-sm font-semibold text-primary">Skill 管理</h3> : <div><p className="text-sm font-semibold text-primary">Skill 管理</p><p className="mt-1 text-xs text-secondary">系统默认始终保留；自定义 Skill 上传后不会自动替换默认。</p></div>}
    <div className="grid grid-cols-2 rounded-lg bg-subtle p-1">{categories.map((item) => <button key={item.id} type="button" onClick={() => setCategory(item.id)} className={`min-h-9 rounded-md px-3 text-sm ${category === item.id ? "bg-surface font-medium shadow-sm" : "text-secondary"}`}>{item.label}</button>)}</div>
    <div className="flex gap-2">{locales.map((item) => <button key={item.id} type="button" onClick={() => setLocale(item.id)} className={`rounded-md border px-3 py-1.5 text-xs ${locale === item.id ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-ui text-secondary"}`}>{item.label}</button>)}</div>
    <div className="space-y-2">{query.isLoading ? <p className="text-xs text-secondary">正在读取 Skill…</p> : null}{rows.map((skill) => <SkillRow key={skill.id} skill={skill} onView={() => setViewing(skill)} onSelect={() => select.mutate(skill.source === "USER" ? skill.id : null)} onToggle={() => skill.source === "USER" && toggle.mutate({ id: skill.id, status: skill.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })} onDelete={() => skill.source === "USER" && window.confirm(`删除“${skill.name}”？`) && remove.mutate(skill.id)} />)}</div>
    <div className="rounded-xl border border-dashed border-ui bg-subtle/50 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary"><Upload className="h-4 w-4 text-accent" />上传我的 Skill</div><div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs text-secondary">Skill 名称<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-ui bg-surface px-2 text-sm text-primary" placeholder="例如：我的导出规则" /></label><label className="text-xs text-secondary">选择 .md 文件<input type="file" accept=".md,text/markdown,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs text-secondary" /></label><button type="button" disabled={!file || upload.isPending} onClick={() => upload.mutate()} className="btn-primary min-h-9 px-3 text-sm disabled:opacity-50">{upload.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "保存 Skill"}</button></div><p className="mt-2 text-[11px] text-secondary">仅支持 UTF-8 Markdown，单文件不超过 512 KiB。保存后需手动设置为首选。</p>{notice ? <p className="mt-2 text-xs text-accent" role="status">{notice}</p> : null}{upload.isError ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{upload.error.message}</p> : null}</div>
    {viewing ? <SkillContentDialog skill={viewing} onClose={() => setViewing(null)} /> : null}
  </section>;
}

function SkillRow({ skill, onView, onSelect, onToggle, onDelete }: { skill: SkillRead; onView: () => void; onSelect: () => void; onToggle: () => void; onDelete: () => void }) {
  return <article className="rounded-lg border border-ui bg-surface px-3 py-2.5"><div className="flex items-start gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-accent"><Sparkles className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary">{skill.name}</p><p className="mt-0.5 text-xs text-secondary">{skill.source === "BUILTIN" ? "系统默认 · 不可修改" : `我的 Skill · ${skill.status === "ACTIVE" ? "可用" : "已禁用"}`}</p></div>{skill.is_selected ? <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[11px] text-accent">首选</span> : null}</div><div className="mt-2 flex flex-wrap gap-3 pl-11 text-xs"><button type="button" onClick={onView} className="inline-flex items-center gap-1 text-secondary hover:text-primary"><Eye className="h-3.5 w-3.5" />查看</button><a href={skill.content_url ?? "#"} download className="inline-flex items-center gap-1 text-secondary hover:text-primary"><Download className="h-3.5 w-3.5" />下载</a>{skill.source === "USER" && !skill.is_selected ? <button type="button" onClick={onSelect} className="text-accent">设为首选</button> : null}{skill.source === "USER" && skill.is_selected ? <button type="button" onClick={onSelect} className="inline-flex items-center gap-1 text-accent"><RotateCcw className="h-3.5 w-3.5" />使用系统默认</button> : null}{skill.source === "USER" ? <><button type="button" onClick={onToggle} className="text-secondary">{skill.status === "ACTIVE" ? "禁用" : "启用"}</button><button type="button" onClick={onDelete} className="inline-flex items-center gap-1 text-[var(--danger)]"><Trash2 className="h-3.5 w-3.5" />删除</button></> : null}</div></article>;
}

function SkillContentDialog({ skill, onClose }: { skill: SkillRead; onClose: () => void }) {
  const detail = useQuery({ queryKey: ["skill", skill.id], queryFn: async () => skill.source === "USER" ? getSkill(skill.id) : { content: await fetch(skill.content_url ?? "").then((response) => response.text()) } });
  const content = detail.data?.content;
  return <div className="fixed inset-0 z-[360] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-5" onPointerDown={(e) => e.target === e.currentTarget && onClose()}><div className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl sm:max-w-3xl sm:rounded-xl"><header className="flex items-center justify-between border-b border-ui px-4 py-3"><div><p className="text-sm font-semibold text-primary">{skill.name}</p><p className="text-xs text-secondary">纯文本预览，不执行其中内容</p></div><button type="button" onClick={onClose} aria-label="关闭" className="rounded-md p-2 text-secondary hover:bg-subtle"><X className="h-4 w-4" /></button></header><pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs leading-5 text-primary">{detail.isLoading ? "正在读取…" : content}</pre></div></div>;
}
