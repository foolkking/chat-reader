"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AnnotationRepository } from "../../lib/annotation-repository";
import { notebookDraftKey, readNotebookDraft, removeNotebookDraft, writeNotebookDraft, type NotebookDraft } from "../../lib/notebook-drafts";
import type { AnnotationRead, NavigateTarget, NotebookRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { annotationNavigationTarget } from "../conversations/reader-locator-target";

type Working = Pick<NotebookDraft, "base" | "title" | "blocks">;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const edited = (draft: Working) => draft.title !== (draft.base.title ?? "") || !same(draft.blocks, draft.base.blocks);

// The notebook is a working document: drafts stay beside it, and version
// comparisons use the same quiet rows and paper/graphite tokens as the Reader.
export function NotebookView({ notebook, conflicts, annotations, repository, onSaved, onReload, onResolve, onRiskChange, onNavigate }: {
  notebook: NotebookRead | null; conflicts: NotebookRead[]; annotations: AnnotationRead[]; repository: AnnotationRepository;
  onSaved: (value: NotebookRead) => void; onReload: () => Promise<void>; onResolve: () => Promise<void>;
  onRiskChange: (atRisk: boolean) => void; onNavigate: (target: NavigateTarget) => void | Promise<unknown>;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN", { confirm } = useInteractionDialog();
  const conversationId = notebook?.conversation_id;
  const requestedDraft = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("notebookDraft");
  const key = conversationId ? (requestedDraft?.startsWith(`notebook-draft:${conversationId}:${repository.mode}:`) ? requestedDraft : notebookDraftKey(conversationId, repository.mode)) : "";
  const [draft, setDraft] = useState<Working | null>(null), draftRef = useRef<Working | null>(null);
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState<"saved" | "saving" | "failed">("saved");
  const [error, setError] = useState(""), [latest, setLatest] = useState<NotebookRead | null>(null);
  const version = useRef(0), writes = useRef<Promise<void>>(Promise.resolve()), sequence = useRef(0);
  const currentNotebook = useRef(notebook); currentNotebook.current = notebook;
  const dragIndex = useRef<number | null>(null), [dragging, setDragging] = useState<string | null>(null);
  const loadedKey = useRef("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let active = true;
    setLoading(true); setError("");
    void readNotebookDraft(key).then((saved) => {
      if (!active || !currentNotebook.current) return;
      version.current = saved?.version ?? 0;
      const value = saved ? { base: saved.base, title: saved.title, blocks: saved.blocks }
        : { base: currentNotebook.current, title: currentNotebook.current.title ?? "", blocks: currentNotebook.current.blocks };
      draftRef.current = value; setDraft(value); loadedKey.current = key; setStorage("saved");
    }).catch(() => { if (active) { setStorage("failed"); setError(zh ? "无法读取本机草稿，请重试。" : "Unable to read this device's draft. Retry."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, loadAttempt, zh]);
  useEffect(() => {
    if (!notebook || loadedKey.current !== key || busyRef.current) return;
    const value = draftRef.current;
    if (value && !edited(value)) {
      const updated = { base: notebook, title: notebook.title ?? "", blocks: notebook.blocks };
      draftRef.current = updated; setDraft(updated);
    }
  }, [notebook, key]);
  useEffect(() => {
    const atRisk = storage !== "saved" && Boolean(draft && edited(draft));
    onRiskChange(atRisk);
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (atRisk) window.addEventListener("beforeunload", guard);
    return () => { onRiskChange(false); window.removeEventListener("beforeunload", guard); };
  }, [draft, storage, onRiskChange]);

  const retain = (value: Working) => {
    const serial = ++sequence.current;
    draftRef.current = value; setDraft(value); setStorage("saving");
    writes.current = writes.current.catch(() => undefined).then(async () => {
      version.current = await writeNotebookDraft(key, version.current, { ...value, conversation_id: value.base.conversation_id, mode: repository.mode });
      if (serial === sequence.current) setStorage("saved");
    }).catch(() => { if (serial === sequence.current) setStorage("failed"); });
  };
  const save = async (baseOverride?: NotebookRead) => {
    const value = draftRef.current;
    if (!value || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    await writes.current;
    try {
      const saved = await repository.saveNotebook(baseOverride ?? value.base, value.blocks, value.title || null);
      const next = { base: saved, title: saved.title ?? "", blocks: saved.blocks };
      onSaved(saved); draftRef.current = next; setDraft(next); setLatest(null);
      try { await removeNotebookDraft(key, version.current); version.current = 0; setStorage("saved"); }
      catch { setStorage("failed"); setError(zh ? "笔记已保存，但本机草稿未能清除。可重试清除。" : "Notebook saved, but the local draft could not be cleared. Retry clearing it."); }
    } catch { setError(zh ? "笔记未保存，草稿已保留。可重试，或查看当前版本后再决定。" : "Notebook not saved. Your draft is retained. Retry, or compare the current version before deciding."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const compare = async () => {
    setBusy(true); setError("");
    try { setLatest(await repository.getNotebook(conversationId!)); }
    catch { setError(zh ? "无法读取当前版本，草稿已保留。" : "Unable to read the current version. Draft retained."); }
    finally { setBusy(false); }
  };
  const chooseServer = async () => {
    if (!latest || !await confirm({ title: zh ? "使用当前版本并放弃此草稿？" : "Use the current version and discard this draft?", confirmLabel: zh ? "使用当前版本" : "Use current version", danger: true })) return;
    setBusy(true);
    try {
      await writes.current; await removeNotebookDraft(key, version.current); version.current = 0;
      const next = { base: latest, title: latest.title ?? "", blocks: latest.blocks };
      draftRef.current = next; setDraft(next); onSaved(latest); setLatest(null); setStorage("saved"); setError("");
    } catch { setError(zh ? "草稿未清除，请重试。" : "Draft was not cleared. Retry."); }
    finally { setBusy(false); }
  };
  const dirty = Boolean(draft && edited(draft));
  return <section className="space-y-3" aria-label={zh ? "笔记编辑器" : "Notebook editor"}>
    {loading || !notebook ? <p role="status" className="text-xs text-secondary">{zh ? "加载笔记与本机草稿…" : "Loading notebook and local draft…"}</p> : null}
    {error ? <p role="alert" className="border-l-2 border-[var(--danger)] pl-3 text-xs">{error}</p> : null}
    {!draft && !loading ? <button className="btn-secondary min-h-9 px-3 text-xs" onClick={() => { setLoadAttempt((value) => value + 1); void onReload(); }}>{zh ? "重试加载" : "Retry loading"}</button> : null}
    {draft ? <>
      <div className="flex items-center gap-2 border-b border-ui pb-3"><input aria-label="Notebook title" disabled={busy || loading} value={draft.title} maxLength={200} placeholder={zh ? "精选笔记" : "Notebook"} onChange={(event) => retain({ ...draft, title: event.target.value })} onBlur={() => { if (dirty) void save(); }} className="min-h-10 min-w-0 flex-1 bg-transparent text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" /><span className="text-xs text-secondary">{draft.blocks.length} {zh ? "项" : "items"}</span></div>
      {dirty || busy || storage !== "saved" ? <div className="flex flex-wrap items-center gap-2"><button className="btn-primary min-h-9 px-3 text-xs" disabled={busy || loading} onClick={() => void save()}>{busy ? (zh ? "保存中…" : "Saving…") : (zh ? "保存笔记" : "Save notebook")}</button><span role="status" className="text-xs text-secondary">{storage === "saved" ? (zh ? "草稿已保存在本机" : "Draft saved on this device") : storage === "saving" ? (zh ? "正在保存本机草稿…" : "Saving local draft…") : (zh ? "本机草稿保存失败" : "Local draft could not be saved")}</span>{storage === "failed" ? <button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => retain(draft)}>{zh ? "重试保存草稿" : "Retry saving draft"}</button> : null}</div> : null}
      {error && dirty ? <button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void compare()}>{zh ? "查看当前版本" : "Compare current version"}</button> : null}
      {latest ? <section className="space-y-3 border-y border-ui py-3" aria-label={zh ? "当前版本比较" : "Current version comparison"}><h3 className="text-sm font-semibold">{zh ? "当前已保存版本" : "Currently saved version"}</h3><p className="break-words text-sm">{latest.title}</p>{latest.blocks.map((block) => <p className="whitespace-pre-wrap break-words text-sm" key={block.id}>{block.type === "markdown" ? block.markdown : annotations.find((item) => item.id === block.annotation_id)?.quote || (zh ? "批注引用" : "Annotation reference")}</p>)}<p className="text-xs text-secondary">{zh ? "下方保留你的草稿，可继续编辑后应用。保存会再次检查此版本。" : "Your draft remains below. Edit it before applying; saving checks this version again."}</p><div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void chooseServer()}>{zh ? "保留当前版本" : "Keep current version"}</button><button className="btn-primary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void save(latest)}>{zh ? "应用此草稿" : "Apply this draft"}</button></div></section> : null}
      {conflicts.length ? <section className="space-y-2 border-l-2 border-[var(--warning)] pl-3"><p className="text-xs font-medium">{conflicts.length} {zh ? "份笔记冲突副本" : "notebook conflict copies"}</p>{conflicts.map((copy) => <p key={copy.id} className="break-words text-xs text-secondary">{copy.title || (zh ? "无标题笔记" : "Untitled notebook")} · {copy.blocks.length} {zh ? "项" : "items"}</p>)}<button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void onResolve().catch(() => setError(zh ? "无法打开冲突处理，请重试。" : "Unable to open conflict review. Retry."))}>{zh ? "比较并解决冲突" : "Compare and resolve conflicts"}</button></section> : null}
      {draft.blocks.map((block, index) => {
        const annotation = annotations.find((item) => item.id === block.annotation_id);
        return <div key={block.id} draggable={!busy} onDragStart={() => { dragIndex.current = index; setDragging(block.id); }} onDragEnd={() => { dragIndex.current = null; setDragging(null); }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (busy || dragIndex.current === null || dragIndex.current === index) return; const blocks = [...draft.blocks]; const [moved] = blocks.splice(dragIndex.current, 1); blocks.splice(index, 0, moved); dragIndex.current = null; setDragging(null); retain({ ...draft, blocks }); }} data-state={dragging === block.id ? "dragging" : undefined} className="reader-interactive-row flex gap-2 border-b border-ui pb-3">
          <div className="min-w-0 flex-1">{block.type === "markdown" ? <textarea aria-label={`${zh ? "笔记正文" : "Notebook text"} ${index + 1}`} disabled={busy} value={block.markdown ?? ""} maxLength={50_000} onChange={(event) => retain({ ...draft, blocks: draft.blocks.map((item) => item.id === block.id ? { ...item, markdown: event.target.value } : item) })} onBlur={() => { if (dirty) void save(); }} className="min-h-24 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" /> : annotation ? <button type="button" data-annotation-color={annotation.color ?? "yellow"} onClick={() => void onNavigate(annotationNavigationTarget(annotation))} className="annotation-quote w-full border-l-2 px-3 py-2 text-left text-sm leading-6">{annotation.quote || (zh ? "整条消息书签" : "Message bookmark")}</button> : <p className="text-sm text-[var(--danger)]">{zh ? "引用的批注不可用" : "Annotation reference unavailable"}</p>}</div>
          <div className="flex flex-col gap-1"><button type="button" disabled={busy} onClick={() => retain({ ...draft, blocks: draft.blocks.filter((item) => item.id !== block.id) })} className="flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:text-[var(--danger)]" aria-label={zh ? "从笔记移除" : "Remove from notes"}><Trash2 className="h-4 w-4" /></button><button disabled={busy || !index} className="min-h-9 text-xs text-secondary disabled:opacity-40" onClick={() => { const blocks = [...draft.blocks]; [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; retain({ ...draft, blocks }); }} aria-label={zh ? "上移段落" : "Move block up"}>↑</button></div>
        </div>;
      })}
      <button type="button" disabled={busy || draft.blocks.length >= 5000} onClick={() => retain({ ...draft, blocks: [...draft.blocks, { id: crypto.randomUUID(), type: "markdown", markdown: "" }] })} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-sm"><Plus className="h-4 w-4" />{zh ? "插入说明" : "Add text block"}</button>
      {!draft.blocks.length ? <p className="py-6 text-center text-sm text-secondary">{zh ? "暂无精选笔记" : "No notebook items yet"}</p> : null}
    </> : null}
  </section>;
}
