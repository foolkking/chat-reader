"use client";
import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { continuationApi as api, type ContinuationRevisionRead } from "../../lib/api";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-ui px-3 py-2 text-sm hover:bg-subtle disabled:opacity-50";
type Member = "current" | "index";

export function ContinuationHistory({ conversationId, rows, selectedRevisionId, generation, zh, disabled, onBusy, onRestored }: {
  conversationId: string; rows: ContinuationRevisionRead[]; selectedRevisionId?: string | null; generation: number;
  zh: boolean; disabled: boolean; onBusy: (busy: boolean) => void; onRestored: (member: Member, result: { generation: number; revision_id: string }) => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ row: ContinuationRevisionRead; member: Member; text: string; generation: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const cache = useQueryClient();
  const run = async (action: () => Promise<void>) => {
    if (pending || disabled) return;
    setPending(true); onBusy(true); setError("");
    try { await action(); }
    catch (error) {
      void cache.invalidateQueries({ queryKey: ["continuation", conversationId] });
      setError(error instanceof Error && error.message === "CONTEXT_BASE_CHANGED"
        ? (zh ? "文件已在其他窗口更新。请从最新列表重新选择历史文件，比较后再恢复。" : "Files changed in another window. Select a file from the refreshed history and compare before restoring.")
        : (zh ? "无法读取或恢复这份文件；历史列表已刷新，请重新选择。" : "Could not read or restore this file. History has refreshed; select it again."));
    }
    finally { setPending(false); onBusy(false); }
  };
  const restore = async () => {
    if (!preview || !navigator.onLine) { setError(zh ? "请联网后恢复。" : "Connect to restore."); return; }
    const name = preview.member === "current" ? "Current" : "Index";
    const other = preview.member === "current" ? "Index" : "Current";
    if (!window.confirm(zh ? `将这份 ${name} 恢复为当前文件？${other} 保持不变，并保留最近三次记录。` : `Restore this ${name} as the current file? ${other} stays unchanged. The latest three updates are retained.`)) return;
    await run(async () => {
      const form = new FormData();
      form.append("base_generation", String(preview.generation));
      form.append(preview.member, new File([preview.text], preview.member === "current" ? "current.md" : "index.json"));
      const saved = await api.updateFiles(conversationId, form);
      await onRestored(preview.member, saved);
      setPreview(null);
    });
  };
  return <div className="min-w-0 space-y-4">
    <h3 className="text-sm font-semibold">{zh ? "最近 3 次更新" : "Latest 3 updates"}</h3>
    {rows.length === 0 ? <p className="text-sm text-secondary">{zh ? "尚未上传文件。" : "No files uploaded yet."}</p> : null}
    {rows.slice(0, 3).map(row => <div key={row.id} className="space-y-2 border-b border-ui pb-3">
      <p className="text-sm">{row.id === selectedRevisionId ? (zh ? "当前 · " : "Current · ") : ""}{new Date(row.created_at).toLocaleString(zh ? "zh-CN" : "en-US")}</p>
      <div className="flex flex-wrap gap-2">{(["current", "index"] as const).map(member => <button key={member} className={button} disabled={pending || disabled || !row.members[member]} aria-pressed={preview?.row.id === row.id && preview.member === member} onClick={() => void run(async () => {
        const [text, state] = await Promise.all([api.member(conversationId, "revisions", row.id, member), api.state(conversationId)]);
        setPreview({ row, member, text, generation: state.generation });
      })}>{zh ? "查看 " : "View "}{member}{!row.members[member] ? (zh ? "（未上传）" : " (not uploaded)") : ""}</button>)}</div>
    </div>)}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {pending ? <p role="status" className="text-sm text-secondary">{zh ? "正在处理…" : "Working…"}</p> : null}
    {preview ? <section className="space-y-3" aria-label={zh ? "历史文件预览" : "Historical file preview"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{preview.member === "current" ? "Current" : "Index"} · {new Date(preview.row.created_at).toLocaleString(zh ? "zh-CN" : "en-US")}</h4>
        <button className={button} disabled={pending} onClick={() => setPreview(null)}><X className="h-4 w-4" />{zh ? "关闭预览" : "Close preview"}</button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-subtle p-3 text-sm leading-7">{preview.text}</pre>
      {preview.row.id !== selectedRevisionId ? <button className={button} disabled={pending || disabled} onClick={() => void restore()}><RotateCcw className="h-4 w-4" />{zh ? `仅恢复 ${preview.member === "current" ? "Current" : "Index"}` : `Restore ${preview.member === "current" ? "Current" : "Index"} only`}</button> : null}
      {preview.generation !== generation ? <p className="text-xs text-secondary">{zh ? "当前文件已有新更新；恢复前请重新打开历史文件。" : "Current files have changed; reopen the historical file before restoring."}</p> : null}
    </section> : null}
  </div>;
}
