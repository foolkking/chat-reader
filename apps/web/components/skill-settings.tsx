"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError, createSkill, deleteSkill, getSkills, setSkillSelection, updateSkill } from "../lib/api";
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
  const [refreshError, setRefreshError] = useState(false);
  const [bundleBusy, setBundleBusy] = useState<Record<string, boolean>>({});
  const [bundleDirty, setBundleDirty] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["skills", category, locale], queryFn: ({ signal }) => getSkills({ category, locale }, signal), retry: false });
  const mounted = useRef(false);
  const scopeRef = useRef(`${category}:${locale}`);
  scopeRef.current = `${category}:${locale}`;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const dirty = Boolean(name.trim() || file || Object.values(bundleDirty).some(Boolean));
  // Settle the aggregate guard before a visible replacement can be closed.
  // Other rows and the upload form still contribute their unsaved drafts.
  useLayoutEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const refreshSkills = async (requestedCategory = category, requestedLocale = locale) => {
    const requestedScope = `${requestedCategory}:${requestedLocale}`;
    try {
      await queryClient.cancelQueries({ queryKey: ["skills"] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["skills"] }),
        queryClient.invalidateQueries({ queryKey: ["resolved-skill"] }),
      ]);
    } catch {
      if (mounted.current && scopeRef.current === requestedScope) {
        setRefreshError(true);
      }
    }
  };
  const upload = useMutation({
    mutationFn: () => {
      if (!file || !/\.(zip|md)$/i.test(file.name)) throw new ApiRequestError("Invalid Skill upload file.", 422, "/api/skills");
      return createSkill({ category, name: name.trim() || file.name.replace(/\.(zip|md)$/i, ""), file });
    },
    onSuccess: () => {
      const requestedCategory = category, requestedLocale = locale;
      setName(""); setFile(null); if (fileInput.current) fileInput.current.value = "";
      if (mounted.current && scopeRef.current === `${requestedCategory}:${requestedLocale}`) {
        setNotice(zh ? "Skill 已保存；如需使用，请手动设为首选。" : "Skill saved. Set it as preferred to use it.");
        setRefreshError(false);
      }
      void refreshSkills(requestedCategory, requestedLocale);
    },
  });
  const select = useMutation({
    mutationFn: (skillId: string | null) => setSkillSelection({ category, skill_id: skillId }),
    onSuccess: () => { if (mounted.current && scopeRef.current === `${category}:${locale}`) setNotice(zh ? "首选设置已更新。" : "Preferred Skill updated."); void refreshSkills(category, locale); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) => updateSkill(id, { status }),
    onSuccess: () => { if (mounted.current && scopeRef.current === `${category}:${locale}`) setNotice(zh ? "Skill 状态已更新。" : "Skill status updated."); void refreshSkills(category, locale); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSkill(id),
    onSuccess: (_result, id) => { setBundleDirty((previous) => ({ ...previous, [id]: false })); if (mounted.current && scopeRef.current === `${category}:${locale}`) setNotice(zh ? "Skill 已删除。" : "Skill deleted."); void refreshSkills(category, locale); },
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateSkill(id, { name }),
    onSuccess: () => { if (mounted.current && scopeRef.current === `${category}:${locale}`) setNotice(zh ? "Skill 名称已更新。" : "Skill name updated."); void refreshSkills(category, locale); },
  });
  const busy = query.isPending || upload.isPending || select.isPending || toggle.isPending || remove.isPending || rename.isPending || Object.values(bundleBusy).some(Boolean);
  const mutationFailure = upload.error
    ? { error: upload.error, action: "upload" as const }
    : select.error
      ? { error: select.error, action: "select" as const }
      : toggle.error
        ? { error: toggle.error, action: "update" as const }
        : remove.error
          ? { error: remove.error, action: "delete" as const }
          : rename.error
            ? { error: rename.error, action: "update" as const }
            : null;
  const clearMutationErrors = () => {
    upload.reset(); select.reset(); toggle.reset(); remove.reset(); rename.reset();
    setNotice(null); setRefreshError(false);
  };
  const runSelection = (skillId: string | null) => { clearMutationErrors(); select.mutate(skillId); };
  const runToggle = (id: string, status: "ACTIVE" | "DISABLED") => { clearMutationErrors(); toggle.mutate({ id, status }); };
  const runRename = (id: string, value: string) => { clearMutationErrors(); rename.mutate({ id, name: value }); };
  const runDelete = (id: string) => { clearMutationErrors(); remove.mutate(id); };
  const changeScope = async (change: () => void) => {
    if (busy) return;
    if (dirty && !await confirm({ title: zh ? "放弃未保存的更改？" : "Discard unsaved changes?", description: zh ? "切换后需要重新选择尚未保存的文件。" : "You will need to select unsaved files again after switching.", confirmLabel: zh ? "放弃并切换" : "Discard and switch" })) return;
    clearMutationErrors();
    setName(""); setFile(null); setBundleDirty({}); setUploadOpen(false);
    if (fileInput.current) fileInput.current.value = "";
    onDirtyChange?.(false); change();
  };
  const rows = useMemo(() => query.data ?? [], [query.data]);
  return <section className={focused ? "space-y-4" : "space-y-3"}>
    {!focused ? <h3 className="text-sm font-semibold text-primary">{zh ? "Skill 管理" : "Skills"}</h3> : null}
    <div className="grid grid-cols-3 rounded-lg bg-subtle p-1">{categories.map((item) => <button key={item.id} type="button" disabled={busy} aria-pressed={category === item.id} onClick={() => category !== item.id && void changeScope(() => setCategory(item.id))} className={`min-h-11 rounded-md px-3 text-sm ${category === item.id ? "bg-surface font-medium shadow-sm" : "text-secondary"}`}>{zh ? item.label : ({ EXPORT_CONTEXT: "Acquisition", CONVERSATION_RESCUE: "Format conversion", CONTEXT_MAINTENANCE: "Maintenance" })[item.id]}</button>)}</div>
    {rows.some(skill => skill.legacy_selection_conflict) ? <p role="status" className="text-sm text-secondary">{zh ? "你之前按语言选择了不同 Skill。请选择一个统一首选；原文件都会保留。" : "Your previous language choices differ. Choose one preferred Skill; all original files stay available."}</p> : null}
    <div className="space-y-2">{query.isLoading ? <p className="text-xs text-secondary">{zh ? "正在读取 Skill…" : "Loading Skills…"}</p> : null}{rows.map((skill) => <SkillRow key={skill.id} skill={skill} busy={busy} onBusyChange={(value) => setBundleBusy((previous) => previous[skill.id] === value ? previous : { ...previous, [skill.id]: value })} onRename={async () => { const value = await prompt({ title: zh ? "修改 Skill 名称" : "Rename Skill", initialValue: skill.name, label: zh ? "名称" : "Name" }); if (value?.trim() && value.trim() !== skill.name) runRename(skill.id, value.trim()); }} onDirtyChange={(value) => setBundleDirty((previous) => previous[skill.id] === value ? previous : { ...previous, [skill.id]: value })} onSelect={() => runSelection(skill.source === "USER" ? skill.id : null)} onToggle={() => skill.source === "USER" && runToggle(skill.id, skill.status === "ACTIVE" ? "DISABLED" : "ACTIVE")} onDelete={async () => { if (skill.source === "USER" && await confirm({ title: zh ? `删除“${skill.name}”？` : `Delete “${skill.name}”?`, description: zh ? "此 Skill 的文件和版本记录将被删除。" : "This removes the Skill and its version history.", danger: true })) { runDelete(skill.id); } }} />)}</div>
    <button type="button" disabled={busy} aria-expanded={uploadOpen} onClick={() => setUploadOpen(value => !value)} className="btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-sm"><Upload className="h-4 w-4" />{zh ? "上传我的 Skill" : "Upload my Skill"}</button>
    {uploadOpen ? <div className="rounded-xl border border-dashed border-ui bg-subtle/50 p-3"><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="text-xs text-secondary">{zh ? "Skill 名称" : "Skill name"}<input value={name} disabled={busy} onChange={(e) => { setName(e.target.value); if (e.target.value) onDirtyChange?.(true); }} className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-2 text-base sm:text-sm text-primary" placeholder={zh ? "默认使用文件名" : "Defaults to filename"} /></label><div className="min-w-0"><button type="button" disabled={busy} className="btn-secondary min-h-11 w-full px-3 text-sm" onClick={() => fileInput.current?.click()}>{zh ? "选择文件" : "Choose file"}</button><input ref={fileInput} disabled={busy} type="file" accept=".zip,.md" aria-label={zh ? "选择 Skill ZIP 或 Markdown 文件" : "Choose a Skill ZIP or Markdown file"} onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.length) onDirtyChange?.(true); }} hidden />{file ? <p className="mt-1 break-all text-xs text-secondary">{file.name}</p> : null}</div><button type="button" disabled={!file || busy} onClick={() => { clearMutationErrors(); upload.mutate(); }} className="btn-primary min-h-11 px-3 text-sm disabled:opacity-50">{upload.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : (zh ? "保存 Skill" : "Save Skill")}</button></div>{upload.isError ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{skillMutationError(upload.error, "upload", zh)}</p> : null}</div> : null}

    {notice && !uploadOpen ? <p role="status" className="text-xs text-accent">{notice}</p> : null}
    {refreshError ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "操作已完成，但 Skill 列表刷新失败；请重新加载并核对。" : "The action completed, but the Skill list could not refresh. Reload it to verify."}</p> : null}
    {query.isError ? <div role="alert" className="text-xs text-[var(--danger)]"><p>{query.data?.length ? (zh ? "Skill 列表刷新失败，当前仍显示上次结果；已确认的操作仍有效。" : "The Skill list could not refresh; showing the previous results. Confirmed changes still apply.") : (zh ? "无法读取 Skill 列表。" : "The Skill list could not load.")}</p><button type="button" disabled={query.isFetching} onClick={() => { setNotice(null); setRefreshError(false); void query.refetch(); }} className="btn-secondary mt-2 min-h-11 px-3">{zh ? "重新加载" : "Retry loading"}</button></div> : null}
    {mutationFailure && (mutationFailure.action !== "upload" || !uploadOpen) ? <p role="alert" className="text-xs text-[var(--danger)]">{skillMutationError(mutationFailure.error, mutationFailure.action, zh)}</p> : null}
  </section>;
}

function skillMutationError(error: unknown, action: "upload" | "select" | "update" | "delete", zh: boolean): string {
  if (error instanceof Error && /choose a skill zip or markdown/i.test(error.message)) {
    return zh ? "请选择 Skill ZIP 或 Markdown 文件。" : "Choose a Skill ZIP or Markdown file.";
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return zh ? "登录已过期，请重新登录后继续。" : "Your session expired. Sign in again to continue.";
    if (error.status === 403) return zh ? "当前账户或系统设置不允许此操作。" : "Your account or system settings do not allow this action.";
    if (error.status === 404) return zh ? "此 Skill 已不存在，请重新加载列表。" : "This Skill is no longer available. Reload the list.";
    if (error.status === 409) return zh ? "Skill 状态已发生变化，请重新加载后再操作。" : "The Skill changed elsewhere. Reload the list before continuing.";
    if (error.status === 413 || error.status === 422) return action === "upload"
      ? (zh ? "文件不符合 Skill 上传要求或超出大小限制；请检查 ZIP/Markdown 文件后重试。" : "The file does not meet Skill upload requirements or exceeds the size limit. Check the ZIP/Markdown file and retry.")
      : (zh ? "提交内容无效，请检查后重试。" : "The submitted value is invalid. Check it and retry.");
    if (error.status === 429) return zh ? "操作过于频繁，请稍后重试。" : "Too many requests. Try again shortly.";
  }
  if (action === "upload") return zh
    ? "上传结果尚未确认。文件仍保留；请重新加载 Skill 列表核对后再决定是否重试。"
    : "The upload result is not confirmed. Your file is retained; reload the Skill list before deciding whether to retry.";
  return zh
    ? "操作结果尚未确认。请重新加载 Skill 列表核对后再决定是否重试。"
    : "The action result is not confirmed. Reload the Skill list before deciding whether to retry.";
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
