"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { useFeatureEntryRecovery } from "../../components/feature-entry-recovery";
import { getUserFeatureEntries } from "../../lib/api";
import type { OfflineCatalogResponse, OfflineChecklistValue, UserFeatureEntry } from "../../lib/types";

const QUERY_KEY = ["user-feature-entries", "offline-checklist"] as const;

export function OfflineChecklistsPanel({
  catalog,
  online,
  busy,
  onRun,
}: {
  catalog: OfflineCatalogResponse | undefined;
  online: boolean;
  busy: boolean;
  onRun: (value: OfflineChecklistValue) => Promise<void>;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const checklists = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getUserFeatureEntries<OfflineChecklistValue>("offline-checklist", signal),
    staleTime: 30_000,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [includeAssets, setIncludeAssets] = useState<OfflineChecklistValue["include_assets"]>("small");
  const [targets, setTargets] = useState<OfflineChecklistValue["targets"]>([]);
  const [scope, setScope] = useState<"conversation" | "project">("conversation");
  const [targetId, setTargetId] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const handleSaved = (saved: UserFeatureEntry<OfflineChecklistValue>) => {
      queryClient.setQueryData<UserFeatureEntry<OfflineChecklistValue>[]>(QUERY_KEY, (items = []) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      resetEditor();
  };
  const handleRemoved = (entry: UserFeatureEntry<OfflineChecklistValue>) => {
      queryClient.setQueryData<UserFeatureEntry<OfflineChecklistValue>[]>(QUERY_KEY, (items = []) => items.filter((item) => item.id !== entry.id));
      setError("");
  };
  const recovery = useFeatureEntryRecovery<OfflineChecklistValue>("offline-checklist", zh, handleSaved, handleRemoved, (intended, current) => { setError(""); setEditing(current ? { id: current.id, name: intended.value.name } : null); setName(intended.value.name); setIncludeAssets(intended.value.include_assets); setTargets(intended.value.targets); setOpen(!current); });
  const save = useMutation({
    mutationFn: recovery.save,
    onError: (error) => setError(recovery.errorText(error)),
  });
  const remove = useMutation({
    mutationFn: recovery.remove,
    onError: (error) => setError(recovery.errorText(error)),
  });

  const available = scope === "conversation"
    ? (catalog?.conversations ?? []).map((item) => ({ id: item.id, label: item.display_title }))
    : (catalog?.projects ?? []).map((item) => ({ id: item.id, label: item.name }));
  const selectedKeys = new Set(targets.map((item) => `${item.scope}:${item.id}`));

  function resetEditor() {
    setOpen(false);
    setName("");
    setIncludeAssets("small");
    setTargets([]);
    setTargetId("");
    setEditing(null);
    setError("");
  }

  function addTarget() {
    if (!targetId || selectedKeys.has(`${scope}:${targetId}`) || targets.length >= 50) return;
    setTargets((current) => [...current, { scope, id: targetId }]);
    setTargetId("");
  }

  function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !targets.length) return;
    const now = new Date().toISOString();
    save.mutate({
      id: crypto.randomUUID(),
      collection: "offline-checklist",
      revision: 0,
      value: { name: trimmed, targets: [...targets], include_assets: includeAssets },
      created_at: now,
      updated_at: now,
    });
  }

  function rename(event: FormEvent<HTMLFormElement>, entry: UserFeatureEntry<OfflineChecklistValue>) {
    event.preventDefault();
    const trimmed = editing?.name.trim() ?? "";
    if (!trimmed || trimmed === entry.value.name) {
      setEditing(null);
      return;
    }
    save.mutate({ ...entry, value: { ...entry.value, name: trimmed } });
  }

  return (
    <section className="space-y-3 rounded-lg border border-ui bg-surface p-3" aria-labelledby="offline-checklists-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="offline-checklists-heading" className="text-sm font-semibold text-primary">{zh ? "离线常备清单" : "Offline checklists"}</h2>
          <p className="mt-0.5 text-xs text-secondary">{zh ? "保存范围与附件策略；更新时冻结当前 ID，逐项加入下载队列。" : "Saves scopes and asset policy; updating freezes the current IDs and queues them one by one."}</p>
        </div>
        <button type="button" disabled={recovery.blocked || !checklists.isSuccess || checklists.data.length >= 20 || !catalog} onClick={() => { setOpen((value) => !value); setError(""); }} className="btn-secondary inline-flex min-h-9 items-center gap-1.5 px-2.5 text-xs disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" />{zh ? "新建清单" : "New checklist"}
        </button>
      </div>
      {open ? <form onSubmit={saveCurrent} className="space-y-3 border-t border-ui pt-3">
        <label className="block text-xs font-medium text-secondary">{zh ? "名称" : "Name"}<input disabled={recovery.blocked} autoFocus maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} className="mt-1 min-h-10 w-full rounded-md border border-ui bg-page px-2.5 text-sm text-primary" required /></label>
        <div className="flex flex-wrap gap-2">
          <label className="min-w-36 flex-1 text-xs text-secondary">{zh ? "范围类型" : "Scope"}<select disabled={recovery.blocked} className="mt-1 min-h-10 w-full rounded-md border border-ui bg-page px-2.5 text-sm text-primary" value={scope} onChange={(event) => { setScope(event.target.value as typeof scope); setTargetId(""); }}><option value="conversation">{zh ? "对话" : "Conversation"}</option><option value="project">{zh ? "项目" : "Project"}</option></select></label>
          <label className="min-w-48 flex-[2] text-xs text-secondary">{zh ? "添加范围" : "Add target"}<select disabled={recovery.blocked} className="mt-1 min-h-10 w-full rounded-md border border-ui bg-page px-2.5 text-sm text-primary" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">{zh ? "选择…" : "Choose…"}</option>{available.map((item) => <option key={item.id} value={item.id} disabled={selectedKeys.has(`${scope}:${item.id}`)}>{item.label}</option>)}</select></label>
          <button type="button" className="btn-secondary mt-5 inline-flex min-h-10 items-center gap-1 px-2.5 text-xs" disabled={recovery.blocked || !targetId || targets.length >= 50} onClick={addTarget}><Plus className="h-3.5 w-3.5" />{zh ? "加入" : "Add"}</button>
        </div>
        {targets.length ? <ul className="flex flex-wrap gap-1.5">{targets.map((target) => <li key={`${target.scope}:${target.id}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-subtle px-2 py-1 text-xs text-primary"><span className="max-w-52 truncate">{labelForTarget(target, catalog, zh)}</span><button type="button" disabled={recovery.blocked} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-secondary hover:text-primary" onClick={() => setTargets((current) => current.filter((item) => item.scope !== target.scope || item.id !== target.id))} aria-label={zh ? "移除范围" : "Remove target"}><X className="h-3 w-3" /></button></li>)}</ul> : <p className="text-xs text-secondary">{zh ? "至少加入一个项目或对话。" : "Add at least one project or conversation."}</p>}
        <label className="block text-xs text-secondary">{zh ? "附件策略" : "Attachments"}<select disabled={recovery.blocked} className="mt-1 min-h-10 w-full rounded-md border border-ui bg-page px-2.5 text-sm text-primary" value={includeAssets} onChange={(event) => setIncludeAssets(event.target.value as OfflineChecklistValue["include_assets"])}><option value="none">{zh ? "仅附件信息" : "Metadata only"}</option><option value="small">{zh ? "小附件（≤10 MiB）" : "Small files (≤10 MiB)"}</option><option value="all">{zh ? "全部附件" : "All attachments"}</option></select></label>
        <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary inline-flex min-h-10 items-center gap-1.5 px-3 text-xs" disabled={save.isPending || recovery.blocked || !name.trim() || !targets.length}><Save className="h-3.5 w-3.5" />{zh ? "保存清单" : "Save checklist"}</button><button type="button" disabled={recovery.blocked} className="btn-secondary min-h-10 px-3 text-xs" onClick={resetEditor}>{zh ? "取消" : "Cancel"}</button></div>
      </form> : null}
      {checklists.isPending ? <p role="status" className="text-xs text-secondary">{zh ? "正在读取清单…" : "Loading checklists…"}</p> : null}
      {checklists.isError ? <div role="alert" className="text-xs text-secondary"><p>{zh ? "清单暂不可用；仍可手动下载。" : "Checklists are unavailable; manual downloads still work."}</p><button type="button" disabled={recovery.blocked} className="mt-1 min-h-9 text-accent underline" onClick={() => void checklists.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
      {checklists.isSuccess && checklists.data.length ? <ul className="divide-y divide-[var(--border)]">
        {checklists.data.map((entry) => <li key={entry.id} className="space-y-2 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {editing?.id === entry.id ? <form onSubmit={(event) => rename(event, entry)} className="flex min-w-40 flex-1 items-center gap-1"><input disabled={recovery.blocked} autoFocus maxLength={80} value={editing.name} onChange={(event) => setEditing({ id: entry.id, name: event.currentTarget.value })} className="min-h-9 min-w-0 flex-1 rounded-md border border-ui bg-page px-2 text-xs text-primary" required /><button type="submit" disabled={save.isPending || recovery.blocked || !editing.name.trim()} className="inline-flex h-9 w-9 items-center justify-center text-accent" aria-label={zh ? "保存名称" : "Save name"}><Check className="h-3.5 w-3.5" /></button><button type="button" disabled={recovery.blocked} className="inline-flex h-9 w-9 items-center justify-center text-secondary" onClick={() => setEditing(null)} aria-label={zh ? "取消改名" : "Cancel rename"}><X className="h-3.5 w-3.5" /></button></form> : <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary">{entry.value.name}</p><p className="text-xs text-secondary">{entry.value.targets.length} {zh ? "个范围" : "targets"} · {entry.value.include_assets}</p></div>}
            {editing?.id !== entry.id ? <><button type="button" className="inline-flex h-9 w-9 items-center justify-center text-secondary hover:bg-subtle" onClick={() => { setEditing({ id: entry.id, name: entry.value.name }); setError(""); }} aria-label={zh ? `重命名 ${entry.value.name}` : `Rename ${entry.value.name}`}><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={recovery.blocked || remove.isPending || recovery.blocked} className="inline-flex h-9 w-9 items-center justify-center text-secondary hover:text-[var(--danger)] disabled:opacity-50" onClick={() => remove.mutate(entry)} aria-label={zh ? `删除 ${entry.value.name}` : `Delete ${entry.value.name}`}><Trash2 className="h-3.5 w-3.5" /></button><button type="button" disabled={recovery.blocked || !online || busy || !catalog} className="btn-secondary inline-flex min-h-9 items-center gap-1 px-2.5 text-xs" onClick={() => void onRun(entry.value)}><Download className="h-3.5 w-3.5" />{zh ? "更新" : "Update"}</button></> : null}
          </div>
        </li>)}
      </ul> : checklists.isSuccess ? <p className="text-xs text-secondary">{zh ? "尚无常备清单。" : "No offline checklists yet."}</p> : null}
      {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
    {recovery.panel}
    </section>
  );
}

function labelForTarget(target: OfflineChecklistValue["targets"][number], catalog: OfflineCatalogResponse | undefined, zh: boolean): string {
  const label = target.scope === "conversation"
    ? catalog?.conversations.find((item) => item.id === target.id)?.display_title
    : catalog?.projects.find((item) => item.id === target.id)?.name;
  return `${target.scope === "conversation" ? (zh ? "对话" : "Conversation") : (zh ? "项目" : "Project")} · ${label ?? target.id}`;
}
