"use client";

import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { offlineDb } from "../lib/offline-db";
import { ConflictChangedError, loadOfflineConflict, prepareOfflineResolution, retryOfflineResolution, type ConflictMarker, type ConflictPreview } from "../lib/offline-conflicts";
import type { AnnotationRead, NotebookRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

type Content = AnnotationRead | NotebookRead;
const isNote = (value: Content): value is NotebookRead => "blocks" in value;

export function OfflineConflictReview({ conflictKey, onBack, onDirtyChange }: { conflictKey: string; onBack: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN", { confirm } = useInteractionDialog(), queries = useQueryClient();
  const [preview, setPreview] = useState<ConflictPreview | null>(null), [merged, setMerged] = useState<Content | null>(null);
  const [pendingResolution, setPendingResolution] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [draftState, setDraftState] = useState<"saved" | "saving" | "failed">("saved");
  const generation = useRef(0), draftVersion = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError("");
    try {
      const marker = (await offlineDb.settings.get(conflictKey))?.value as ConflictMarker | undefined;
      if (current !== generation.current) return;
      if (marker?.resolution && marker.resolution.error !== "STALE") { setPendingResolution(true); setPreview(null); return; }
      setPendingResolution(false);
      const data = await loadOfflineConflict(conflictKey);
      const saved = (await offlineDb.settings.get(`sync-resolution-draft:${conflictKey}`))?.value as Content | undefined;
      if (current !== generation.current) return;
      setPreview(data); setMerged(saved ?? data.local);
    } catch { if (current === generation.current) setError(zh ? "无法读取当前版本。草稿已保留，请联网后重新比较。" : "Unable to read current versions. Your draft is retained. Reconnect and compare again."); }
    finally { if (current === generation.current) setBusy(false); }
  }, [conflictKey, zh]);
  useEffect(() => { void load(); heading.current?.focus(); return () => { generation.current++; }; }, [load]);
  useLayoutEffect(() => { onDirtyChange?.(draftState !== "saved"); return () => onDirtyChange?.(false); }, [draftState, onDirtyChange]);

  const saveDraft = async (value: Content) => {
    const version = ++draftVersion.current;
    setMerged(value); setDraftState("saving");
    const db = offlineDb;
    try {
      await db.transaction("rw", db.settings, async () => {
        if (!await db.settings.get(conflictKey)) throw new ConflictChangedError();
        await db.settings.put({ key: `sync-resolution-draft:${conflictKey}`, value });
      });
      if (version === draftVersion.current) setDraftState("saved");
    } catch { if (version === draftVersion.current) setDraftState("failed"); }
  };
  const submit = async (choice?: "local" | "server" | "merge") => {
    if (choice && !await confirm({ title: zh ? "确认解决此冲突？" : "Resolve this conflict?", description: zh ? "将应用所选内容并移除该冲突副本。比较后新写入的本机修改仍会保留。" : "Apply the chosen content and remove this conflict copy. New local edits made after this comparison are retained.", confirmLabel: zh ? "确认应用" : "Apply resolution" })) return;
    setBusy(true); setError("");
    try {
      if (choice && preview) await prepareOfflineResolution(preview, choice, merged ?? undefined);
      setPendingResolution(true);
      await retryOfflineResolution(conflictKey);
      await queries.invalidateQueries();
      onBack();
    } catch (cause) {
      setError(cause instanceof ConflictChangedError ? (zh ? "本机内容已变化，请重新比较。" : "Local content changed. Compare again.") : (zh ? "处理未完成。内容与处理请求已保留；重试或重新比较当前版本。" : "Resolution did not finish. Content and the request are retained; retry or compare current versions."));
      const marker = (await offlineDb.settings.get(conflictKey))?.value as ConflictMarker | undefined;
      setPendingResolution(Boolean(marker?.resolution && marker.resolution.error !== "STALE"));
    } finally { setBusy(false); }
  };
  const referenceLabel = (id?: string | null) => {
    const annotation = preview?.references.find((item) => item.id === id);
    return annotation ? `↗ ${annotation.quote || annotation.comment_markdown || (zh ? "整条消息书签" : "Message bookmark")}` : (zh ? "批注引用不可用" : "Annotation reference unavailable");
  };
  const display = (content: Content) => isNote(content) ? <>
    <p className="font-medium">{content.title || (zh ? "无标题笔记" : "Untitled notebook")}</p>
    {content.blocks.map((block) => <p key={block.id} className="whitespace-pre-wrap break-words">{block.type === "markdown" ? block.markdown : referenceLabel(block.annotation_id)}</p>)}
  </> : <>
    {content.is_deleted ? <p className="font-medium text-[var(--danger)]">{zh ? "删除此批注" : "Delete this annotation"}</p> : null}
    <p className="text-xs text-secondary">{content.annotation_type} · {content.color ?? "—"} · {content.anchor_status}</p>
    {content.quote ? <blockquote className="border-l-2 border-ui pl-3 whitespace-pre-wrap break-words">{content.quote}</blockquote> : null}
    <p className="whitespace-pre-wrap break-words">{content.comment_markdown || (zh ? "无附注" : "No comment")}</p>
  </>;
  return <section className="space-y-4" aria-label={zh ? "解决同步冲突" : "Resolve sync conflict"}>
    <button className="btn-secondary min-h-9 px-3 text-sm" disabled={busy || draftState !== "saved"} onClick={onBack}>{zh ? "返回冲突列表" : "Back to conflicts"}</button>
    <h3 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">{zh ? "比较双方内容" : "Compare both versions"}</h3>
    {error ? <p role="alert" className="border-l-2 border-[var(--danger)] pl-3 text-sm">{error}</p> : null}
    {busy ? <p role="status" className="text-sm text-secondary">{zh ? "处理中…" : "Working…"}</p> : null}
    {pendingResolution ? <><p className="text-sm text-secondary">{zh ? "已有已保存的处理请求。重试将确认同一次操作，不会重复应用。" : "A saved resolution is awaiting confirmation. Retry acknowledges the same operation without applying it twice."}</p><button className="btn-primary min-h-11 px-3 text-sm" disabled={busy || !navigator.onLine} onClick={() => void submit()}>{zh ? "重试处理" : "Retry resolution"}</button></> : <>
      <button className="btn-secondary min-h-9 px-3 text-sm" disabled={busy || !navigator.onLine} onClick={() => void load()}>{zh ? "重新比较" : "Compare again"}</button>
      {preview && merged ? <>
        <div className="grid gap-4 border-y border-ui py-4 sm:grid-cols-2">
          {([preview.local, preview.server] as const).map((content, index) => <section key={index} className="min-w-0 space-y-3 text-sm" aria-label={index ? (zh ? "服务器内容" : "Server version") : (zh ? "本机内容" : "Local version")}><h4 className="font-semibold text-accent">{index ? (zh ? "服务器" : "Server") : (zh ? "本机" : "This device")}</h4>{display(content)}</section>)}
        </div>
        <div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-11 px-3 text-sm" disabled={busy || !navigator.onLine} onClick={() => void submit("local")}>{zh ? "保留本机" : "Keep local"}</button><button className="btn-secondary min-h-11 px-3 text-sm" disabled={busy || !navigator.onLine} onClick={() => void submit("server")}>{zh ? "保留服务器" : "Keep server"}</button></div>
        <details className="space-y-3 border-t border-ui pt-3"><summary className="cursor-pointer py-2 text-sm font-medium">{zh ? "手动合并" : "Merge manually"}</summary>
          <p className="text-xs text-secondary">{zh ? "以本机内容为初稿；可复制服务器内容后编辑。草稿仅保存在此账户的本机。" : "Start with local content, or copy the server version and edit. Drafts stay in this account on this device."}</p>
          <div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void saveDraft(preview.local)}>{zh ? "使用本机作为草稿" : "Use local as draft"}</button><button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void saveDraft(preview.server)}>{zh ? "使用服务器作为草稿" : "Use server as draft"}</button></div>
          {isNote(merged) ? <>
            <label className="block text-xs">{zh ? "合并标题" : "Merged title"}<input className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-3 text-sm" maxLength={200} value={merged.title ?? ""} disabled={busy} onChange={(event) => void saveDraft({ ...merged, title: event.target.value })} /></label>
            {merged.blocks.map((block, index) => <div key={block.id} className="space-y-2 border-t border-ui pt-3">{block.type === "markdown" ? <label className="block text-xs">{zh ? "合并正文" : "Merged text"} {index + 1}<textarea className="mt-1 min-h-28 w-full rounded-md border border-ui bg-surface p-3 text-sm" maxLength={50_000} disabled={busy} value={block.markdown ?? ""} onChange={(event) => void saveDraft({ ...merged, blocks: merged.blocks.map((item) => item.id === block.id ? { ...item, markdown: event.target.value } : item) })} /></label> : <p className="text-sm">{referenceLabel(block.annotation_id)}</p>}<button className="btn-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void saveDraft({ ...merged, blocks: merged.blocks.filter((item) => item.id !== block.id) })}>{zh ? "移除此段" : "Remove block"}</button></div>)}
            <button className="btn-secondary min-h-9 px-3 text-sm" disabled={busy || merged.blocks.length >= 5000} onClick={() => void saveDraft({ ...merged, blocks: [...merged.blocks, { id: crypto.randomUUID(), type: "markdown", markdown: "" }] })}>{zh ? "添加正文段落" : "Add text block"}</button>
          </> : <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={merged.is_deleted} disabled={busy} onChange={(event) => void saveDraft({ ...merged, is_deleted: event.target.checked })} />{zh ? "删除此批注" : "Delete this annotation"}</label>
            <label className="block text-xs">{zh ? "合并批注" : "Merged comment"}<textarea className="mt-1 min-h-32 w-full rounded-md border border-ui bg-surface p-3 text-sm" maxLength={20_000} disabled={busy || merged.is_deleted} value={merged.comment_markdown} onChange={(event) => void saveDraft({ ...merged, comment_markdown: event.target.value })} /></label>
          </>}
          <p role="status" className="text-xs text-secondary">{draftState === "saved" ? (zh ? "本机草稿已保存" : "Draft saved on this device") : draftState === "saving" ? (zh ? "正在保存草稿…" : "Saving draft…") : (zh ? "草稿保存失败，请重试保存。" : "Draft could not be saved. Retry saving.")}</p>
          {draftState === "failed" ? <button className="btn-secondary min-h-9 px-3 text-sm" onClick={() => void saveDraft(merged)}>{zh ? "重试保存草稿" : "Retry saving draft"}</button> : null}
          <button className="btn-primary min-h-11 px-3 text-sm" disabled={busy || draftState !== "saved" || !navigator.onLine} onClick={() => void submit("merge")}>{zh ? "应用合并" : "Apply merge"}</button>
        </details>
      </> : null}
    </>}
  </section>;
}
