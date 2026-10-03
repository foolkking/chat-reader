"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useLayoutEffect } from "react";
import { adminApi, type AdminImportFormat } from "../lib/admin-client";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

export function AdminImportFormatSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [offset, setOffset] = useState(0);
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: ["admin-import-formats", offset], queryFn: () => adminApi.importFormats(offset) });
  useLayoutEffect(() => { onDirtyChange?.(dirtyRows.size > 0); }, [dirtyRows, onDirtyChange]);
  return <section className="space-y-4">

    {query.isLoading ? <p role="status">{zh ? "正在读取候选格式…" : "Loading candidate formats…"}</p> : null}
    {query.isError ? <div role="alert"><p className="text-sm text-[var(--danger)]">{query.error.message}</p><button type="button" onClick={() => void query.refetch()} className="btn-secondary mt-2 min-h-11 px-3">{zh ? "重试" : "Retry"}</button></div> : null}
    {query.data?.total === 0 ? <p className="text-sm text-secondary">{zh ? "还没有用户学习的格式。用户在导入中完成映射与校验后，会出现在这里。" : "No learned formats yet. Candidates appear after users validate mappings during import."}</p> : null}
    <div className="divide-y divide-[var(--border)]">{query.data?.items.map((format) => <PublicationRow key={format.id} format={format} onDirtyChange={(dirty) => setDirtyRows((previous) => { if (previous.has(format.id) === dirty) return previous; const next = new Set(previous); if (dirty) next.add(format.id); else next.delete(format.id); return next; })} />)}</div>
    {query.data && query.data.total > query.data.limit ? <nav aria-label={zh ? "格式分页" : "Format pages"} className="flex flex-wrap items-center justify-between gap-2 border-t border-ui pt-3 text-sm"><button type="button" disabled={!offset || dirtyRows.size > 0} onClick={() => setOffset(Math.max(0, offset - query.data.limit))} className="btn-secondary min-h-11 px-3">{zh ? "上一页" : "Previous"}</button><span>{offset + 1}–{Math.min(offset + query.data.limit, query.data.total)} / {query.data.total}</span><button type="button" disabled={offset + query.data.limit >= query.data.total || dirtyRows.size > 0} onClick={() => setOffset(offset + query.data.limit)} className="btn-secondary min-h-11 px-3">{zh ? "下一页" : "Next"}</button>{dirtyRows.size ? <p className="w-full text-xs text-secondary">{zh ? "翻页前请保存或取消本页更改。" : "Save or cancel changes before changing pages."}</p> : null}</nav> : null}
  </section>;
}

function PublicationRow({ format, onDirtyChange }: { format: AdminImportFormat; onDirtyChange: (dirty: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; revisionId: string } | null>(null);
  const name = draft?.name ?? format.name;
  const revisionId = draft?.revisionId ?? format.published_revision_id ?? format.revisions[0]?.id ?? "";
  const revision = format.revisions.find((item) => item.id === revisionId);
  const dirty = draft !== null && (name !== format.name || revisionId !== (format.published_revision_id ?? format.revisions[0]?.id));
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const mutation = useMutation({ mutationFn: async (action: "publish" | "withdraw") => { if (action === "publish") await adminApi.publishImportFormat(format.id, revisionId, name.trim()); else await adminApi.withdrawImportFormat(format.id); }, onSuccess: async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-import-formats"] }), queryClient.invalidateQueries({ queryKey: ["import-formats"] }), queryClient.invalidateQueries({ queryKey: ["import-format-revisions"] })]);
    setDraft(null);
  } });
  const publish = async () => {
    if (await confirm({ title: zh ? "发布此格式版本？" : "Publish this format version?", description: zh ? `系统名称：${name.trim()}；版本 ${revision?.revision}。所有用户都将可以使用，成功使用者会永久保有该版本。` : `System name: ${name.trim()}; version ${revision?.revision}. All users can use it, and successful use grants continued access.`, confirmLabel: zh ? "确认发布" : "Publish" })) mutation.mutate("publish");
  };
  const withdraw = async () => {
    if (await confirm({ title: zh ? "撤回系统提供？" : "Withdraw system availability?", description: zh ? "新用户将不再获得此格式；已有授权、历史版本和进行中的导入不受影响。" : "New users will no longer receive this format. Existing grants, historical versions and admitted imports remain available.", confirmLabel: zh ? "确认撤回" : "Withdraw" })) mutation.mutate("withdraw");
  };
  return <article className="space-y-3 py-4" aria-label={format.name}>
    <div><h3 className="break-words text-sm font-semibold text-primary">{format.name}</h3><p className="mt-1 text-xs text-secondary">{format.source_mode === "JSON_MARKDOWN" ? "JSON + Markdown" : format.source_mode === "MARKDOWN" ? "Markdown" : "JSON"} · {format.published_revision_id ? (zh ? "系统提供中" : "Published") : (zh ? "未向系统提供" : "Not published")}</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium text-secondary">{zh ? "系统显示名称" : "System display name"}<input maxLength={200} value={name} disabled={mutation.isPending} onChange={(event) => setDraft({ name: event.target.value, revisionId })} className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-3 text-sm text-primary" /></label><label className="block text-xs font-medium text-secondary">{zh ? "发布版本" : "Version to publish"}<select value={revisionId} disabled={mutation.isPending} onChange={(event) => setDraft({ name, revisionId: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-3 text-sm text-primary">{format.revisions.map((item) => <option key={item.id} value={item.id}>{zh ? "版本" : "Version"} {item.revision}{item.id === format.published_revision_id ? (zh ? " · 当前发布" : " · Published") : ""}</option>)}</select></label></div>
    {revision ? <details><summary className="min-h-9 cursor-pointer text-xs font-medium text-accent">{zh ? "检查映射与验证摘要" : "Review mapping and validation"}</summary><p className="my-2 text-xs text-secondary">{revision.verification_summary.valid === true ? (zh ? "全批次校验通过" : "Full batch validated") : (zh ? "未通过校验，不可发布" : "Not validated; cannot publish")}</p><pre className="max-h-72 overflow-auto rounded-md bg-subtle p-3 text-xs text-secondary">{JSON.stringify({ mapping: revision.mapping_spec, validation: revision.validation_spec, verified: revision.verification_summary }, null, 2)}</pre></details> : null}
    <div className="flex flex-wrap gap-2 text-xs"><button type="button" disabled={mutation.isPending || !name.trim() || revision?.verification_summary.valid !== true || (format.published_revision_id === revisionId && name.trim() === format.name)} onClick={() => void publish()} className="btn-secondary min-h-11 px-3">{zh ? "发布所选版本" : "Publish selected version"}</button>{format.published_revision_id ? <button type="button" disabled={mutation.isPending} onClick={() => void withdraw()} className="btn-secondary min-h-11 px-3">{zh ? "撤回系统提供" : "Withdraw publication"}</button> : null}{dirty ? <button type="button" disabled={mutation.isPending} onClick={() => setDraft(null)} className="btn-secondary min-h-11 px-3">{zh ? "取消更改" : "Cancel changes"}</button> : null}</div>
    {mutation.isPending ? <p role="status" className="text-xs text-secondary">{zh ? "正在保存…" : "Saving…"}</p> : null}
    {mutation.isSuccess ? <p role="status" className="text-xs text-secondary">{zh ? "系统提供状态已更新" : "Publication updated"}</p> : null}
    {mutation.isError ? <p role="alert" className="text-xs text-[var(--danger)]">{mutation.error.message}</p> : null}
  </article>;
}
