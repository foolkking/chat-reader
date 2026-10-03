"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Code2 } from "lucide-react";
import { continuationApi as api, type ContinuationRevisionRead } from "../../lib/api";
import { usePreferences } from "../../components/preferences-provider";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { ContinuationFind } from "./continuation-find";
import { IndexReading, type ContinuationNavigate, type ContinuationViewState } from "./continuation-index";
import { useContinuationDraft } from "./use-continuation-draft";
import type { SavedContinuationDraft } from "../../lib/continuation-drafts";
export { IndexReading } from "./continuation-index";
const action = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm text-secondary hover:bg-subtle disabled:opacity-50";

export function ContinuationDocument({ conversationId: id, member, revision, generation, onDirtyChange, onUpload, locked = false, onSavingChange, onNavigate, viewState, onDiscardReady }: {
  conversationId: string; member: "current" | "index"; revision?: ContinuationRevisionRead;
  generation?: number; onDirtyChange: (dirty: boolean) => void; onUpload: () => void;
  locked?: boolean; onSavingChange?: (saving: boolean) => void;
  onNavigate?: ContinuationNavigate;
  viewState?: ContinuationViewState;
  onDiscardReady?: (discard: (() => Promise<void>) | null) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const t = (a: string, b: string) => zh ? a : b;
  const cache = useQueryClient();
  const present = Boolean(revision?.members[member]);
  const query = useQuery({ queryKey: ["continuation", id, "document", revision?.id, member], queryFn: () => api.member(id, "revisions", revision!.id, member), enabled: present });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState("");
  const [editGeneration, setEditGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [latest, setLatest] = useState<{ text: string; generation: number } | null>(null);
  const local = useContinuationDraft(id, member);
  useEffect(() => { onDiscardReady?.(local.discard); return () => onDiscardReady?.(null); }, [local.discard, onDiscardReady]);
  const dirty = editing && draft !== original;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange?.(saving); return () => onSavingChange?.(false); }, [saving, onSavingChange]);
  const text = query.data ?? "";
  const begin = (saved?: SavedContinuationDraft) => {
    const initial = text || (member === "index" ? "{}\n" : "");
    local.begin(saved); setDraft(saved?.value.text ?? initial); setOriginal(saved?.value.original ?? initial);
    setEditGeneration(saved?.value.base_generation ?? generation ?? 0); setEditing(true); setError(""); setNotice(""); setLatest(null);
  };
  const discard = async () => {
    if (dirty && !window.confirm(t("放弃未保存的编辑？", "Discard unsaved edits?"))) return;
    setSaving(true);
    try { await local.discard(); setEditing(false); setError(""); await local.list.refetch(); void cache.invalidateQueries({ queryKey: ["continuation", id] }); }
    catch { setError(t("未能清除本机草稿，请重试。", "Could not clear the local draft. Retry.")); }
    finally { setSaving(false); }
  };
  const compare = async () => {
    setSaving(true);
    try {
      const state = await api.state(id);
      const rows = await api.revisions(id);
      const selected = rows.find(row => row.id === state.adopted_revision_id);
      if (state.adopted_revision_id && !selected) throw new Error("Files changed while reading.");
      const content = selected?.members[member] ? await api.member(id, "revisions", selected.id, member) : "";
      setLatest({ text: content, generation: state.generation });
    } catch { setError(t("无法读取最新文件，草稿已保留，请重试。", "Could not read the latest file. Draft retained; retry.")); }
    finally { setSaving(false); }
  };
  const save = async (compared?: { text: string; generation: number }) => {
    if (saving || locked) return;
    if (!navigator.onLine) { setError(t("请联网后保存，编辑内容仍保留。", "Connect to save. Your draft is retained.")); return; }
    if (!draft.trim()) { setError(t("文件不能为空。", "The file cannot be empty.")); return; }
    if (member === "index") {
      try { const parsed: unknown = JSON.parse(draft); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(); }
      catch { setError(t("请使用有效的 JSON 对象；未检查其中的接续内容。", "Use a valid JSON object; continuation content is not assessed.")); return; }
    }
    const limit = member === "current" ? 1024 * 1024 : 8 * 1024 * 1024;
    if (new Blob([draft]).size > limit) { setError(t("文件超过大小限制。", "The file exceeds its size limit.")); return; }
    setSaving(true); setError("");
    try {
      const form = new FormData(); form.append("base_generation", String(compared?.generation ?? editGeneration));
      form.append(member, new File([draft], member === "current" ? "current.md" : "index.json", { type: "text/plain" }));
      await cache.cancelQueries({ queryKey: ["continuation", id] });
      const saved = await api.updateFiles(id, form); setEditing(false); setOriginal(draft); setLatest(null);
      try { await local.discard(); }
      catch { setError(t("文件已保存，但本机草稿未清除。可在草稿列表中删除。", "File saved, but the local draft was not cleared. Remove it from the draft list.")); }
      await local.list.refetch();
      cache.setQueryData(["continuation", id, "state"], { generation: saved.generation, adopted_revision_id: saved.revision_id });
      await cache.invalidateQueries({ queryKey: ["continuation", id] });
      setNotice(t("已保存", "Saved"));
    } catch (e) { setError(e instanceof Error && e.message === "CONTEXT_BASE_CHANGED" ? t("另一个窗口已经更新文件。草稿已保留，请比较最新文件后再保存。", "Another window updated the files. Draft retained; compare the latest file before saving.") : t("保存失败，草稿已保留，请重试。", "Save failed. Your draft is retained; retry.")); }
    finally { setSaving(false); }
  };
  const metadata = member === "current" ? text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] : undefined;
  return <fieldset disabled={locked} className="min-w-0" onKeyDown={e => { if (editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}>
    <div className="mb-6 flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-ui pb-3">
      <p className="text-xs text-secondary">{editing ? t("编辑中 · 保存后保留最近三次", "Editing · Latest three saves retained") : revision ? new Date(revision.created_at).toLocaleString(resolvedLocale) : t("尚未创建", "Not created yet")}</p>
      <div className="flex items-center gap-1">
        {editing ? <><button className={action} disabled={saving} onClick={() => void discard()}>{t("取消", "Cancel")}</button><button className="min-h-11 rounded-md bg-[var(--text)] px-4 text-sm text-[var(--surface)] disabled:opacity-50" disabled={saving || !dirty} onClick={() => void save()}>{saving ? t("保存中…", "Saving…") : t("保存", "Save")}</button></> : <>
          {present ? <button className={action} aria-pressed={raw} onClick={() => setRaw(v => !v)}><Code2 className="h-4 w-4" />{raw ? t("阅读", "Read") : t("原文", "Source")}</button> : null}
          {present ? <button className={action} disabled={!query.data} aria-label={t("下载文件", "Download file")} onClick={() => { const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = member === "current" ? "current.md" : "index.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download className="h-4 w-4" /></button> : null}
          <button className={action} disabled={generation === undefined || (present && !query.data)} onClick={() => begin()}><Pencil className="h-4 w-4" />{t("编辑", "Edit")}</button>
        </>}
      </div>
    </div>
    {error || query.isError ? <p role="alert" className="mb-4 text-sm text-[var(--danger)]">{error || t("读取失败，请重试。", "Could not read the file. Retry.")}{query.isError ? <button className={action} onClick={() => void query.refetch()}>{t("重试", "Retry")}</button> : null}</p> : null}
    {notice ? <p role="status" className="mb-3 text-sm text-secondary">{notice}</p> : null}
    {editing && error ? <button className={action} disabled={saving} onClick={() => void compare()}>{t("比较最新文件", "Compare latest file")}</button> : null}
    {editing && latest ? <section className="mb-4 space-y-3 border-y border-ui py-3" aria-label={t("最新文件比较", "Latest file comparison")}><h3 className="text-sm font-semibold">{t("服务器当前文件", "Current server file")}</h3><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-subtle p-3 text-sm leading-6">{latest.text || t("此文件尚不存在。", "This file does not exist yet.")}</pre><button className={action} disabled={saving} onClick={() => { if (window.confirm(t("用当前草稿更新刚查看的文件？另一份接续文件保持不变。", "Update the file you just reviewed with this draft? The other continuation file stays unchanged."))) void save(latest); }}>{t("用草稿更新此版本", "Update this version with draft")}</button></section> : null}
    {editing && dirty ? <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-secondary"><span role="status">{local.status === "saved" ? t("草稿已保存在本机", "Draft saved on this device") : local.status === "saving" ? t("正在保存本机草稿…", "Saving local draft…") : t("本机草稿保存失败，请重试或下载", "Local draft could not be saved. Retry or download it.")}</span>{local.status === "failed" ? <button className={action} onClick={() => local.retain(draft, original, editGeneration)}>{t("重试保存草稿", "Retry saving draft")}</button> : null}<button className={action} onClick={() => { const url = URL.createObjectURL(new Blob([draft], { type: "text/plain;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = member === "current" ? "current.md" : "index.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{t("下载草稿", "Download draft")}</button></div> : null}
    {!editing && local.list.isError ? <p className="mb-3 text-xs text-secondary">{t("本机草稿暂时无法读取。", "Local drafts are unavailable.")}<button className={action} onClick={() => void local.list.refetch()}>{t("重试", "Retry")}</button></p> : null}
    {!editing && local.list.data?.length ? <section aria-label={t("本机接续草稿", "Local continuation drafts")} className="mb-6 divide-y divide-[var(--border)] border-y border-ui">{local.list.data.map(saved => <div key={saved.key} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 text-xs text-secondary">{t("未保存草稿 · ", "Unsaved draft · ")}{new Date(saved.value.updated_at).toLocaleString(resolvedLocale)}</span><button className={action} onClick={() => begin(saved)}>{t("继续编辑", "Resume draft")}</button><button className={action} onClick={() => { if (window.confirm(t("删除这份本机草稿？已保存文件不受影响。", "Delete this local draft? Saved files are unchanged."))) void local.remove(saved).then(() => setError(""), () => setError(t("草稿已变化或无法删除，请重新读取。", "Draft changed or could not be deleted. Reload it."))); }}>{t("删除草稿", "Delete draft")}</button></div>)}</section> : null}
    {editing ? <textarea autoFocus aria-label={t("编辑 ", "Edit ") + member} spellCheck={false} value={draft} onChange={e => { setDraft(e.target.value); local.retain(e.target.value, original, editGeneration); }} disabled={saving} className="min-h-96 w-full resize-y rounded-lg border border-ui bg-subtle p-4 font-mono text-base leading-7 text-primary outline-none focus:ring-2 focus:ring-[var(--focus)]" /> : present && query.isPending ? <p role="status" className="py-12 text-secondary">{t("正在读取内容…", "Loading content…")}</p> : !present ? <div className="py-16 text-center"><h3 className="text-xl font-semibold">{member === "current" ? t("把接下来的事情留在这里", "Keep what comes next here") : t("为历史留一份索引", "Keep an index of the history")}</h3><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-secondary">{t("可以直接编写，也可以上传外部维护好的文件。", "Write here, or upload files maintained externally.")}</p><button className="mt-6 min-h-11 rounded-md border border-ui px-5 text-sm hover:bg-subtle" onClick={onUpload}>{t("上传文件", "Upload files")}</button></div> : raw ? <ContinuationFind zh={zh} contentKey={text}><pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-sm leading-7">{text}</pre></ContinuationFind> : member === "current" ? <ContinuationFind zh={zh} contentKey={text}>
      {metadata ? <details className="mb-6 text-xs text-secondary"><summary className="min-h-11 cursor-pointer py-3">{t("文件元数据", "File metadata")}</summary><pre className="overflow-auto whitespace-pre-wrap break-all bg-subtle p-3 leading-6">{metadata}</pre></details> : null}
      <div data-testid="continuation-reading" className="max-w-prose text-base leading-7 [&_h1]:mt-0 [&_h1]:border-0 [&_h2]:mt-8 [&_h3]:mt-6 [&_p]:my-4 [&_ul]:my-4 [&_ol]:my-4 [&_li]:my-1"><MarkdownRenderer text={metadata ? text.slice(metadata.length) : text} isAssistant={false} preserveSourceOffsets /></div>
    </ContinuationFind> : <IndexReading text={text} zh={zh} onNavigate={onNavigate} viewState={viewState} />}
  </fieldset>;
}
