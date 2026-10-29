"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Save, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { deleteUserFeatureEntry, getUserFeatureEntries, saveUserFeatureEntry } from "../../lib/api";
import type { ExportPresetValue, UserFeatureEntry } from "../../lib/types";

const QUERY_KEY = ["user-feature-entries", "export-preset"] as const;
type PresetSettings = Omit<ExportPresetValue, "name">;

export function ExportPresetsPanel({
  current,
  onApply,
}: {
  current: PresetSettings;
  onApply: (value: PresetSettings) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const presets = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getUserFeatureEntries<ExportPresetValue>("export-preset", signal),
    staleTime: 30_000,
  });
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (entry: UserFeatureEntry<ExportPresetValue>) => saveUserFeatureEntry("export-preset", entry.id, {
      expected_revision: entry.revision,
      value: entry.value,
    }),
    onSuccess: (saved) => {
      queryClient.setQueryData<UserFeatureEntry<ExportPresetValue>[]>(QUERY_KEY, (items = []) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setSaveOpen(false);
      setEditing(null);
      setName("");
      setError("");
    },
    onError: () => setError(zh ? "预设保存失败；当前导出选项未改变。" : "The preset could not be saved; current export options are unchanged."),
  });
  const remove = useMutation({
    mutationFn: (entry: UserFeatureEntry<ExportPresetValue>) => deleteUserFeatureEntry("export-preset", entry.id, entry.revision),
    onSuccess: (_result, entry) => {
      queryClient.setQueryData<UserFeatureEntry<ExportPresetValue>[]>(QUERY_KEY, (items = []) => items.filter((item) => item.id !== entry.id));
      setError("");
    },
    onError: () => setError(zh ? "预设删除失败；列表已保留，请重试。" : "The preset could not be deleted; it remains in the list."),
  });

  function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    save.mutate({
      id: crypto.randomUUID(),
      collection: "export-preset",
      revision: 0,
      value: { ...current, name: trimmed },
      created_at: now,
      updated_at: now,
    });
  }

  function rename(event: FormEvent<HTMLFormElement>, entry: UserFeatureEntry<ExportPresetValue>) {
    event.preventDefault();
    const trimmed = editing?.name.trim() ?? "";
    if (!trimmed || trimmed === entry.value.name) {
      setEditing(null);
      return;
    }
    save.mutate({ ...entry, value: { ...entry.value, name: trimmed } });
  }

  return (
    <section className="space-y-2 rounded-lg border border-ui bg-surface p-3" aria-labelledby="export-presets-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="export-presets-heading" className="text-sm font-semibold text-primary">{zh ? "导出预设" : "Export presets"}</h2>
          <p className="mt-0.5 text-xs text-secondary">{zh ? "只保存选项，不保存对话、任务或下载地址。" : "Stores options only—not conversations, jobs, or download URLs."}</p>
        </div>
        <button type="button" disabled={!presets.isSuccess || presets.data.length >= 20} onClick={() => { setSaveOpen((value) => !value); setError(""); }} className="btn-secondary inline-flex min-h-9 items-center gap-1.5 px-2.5 text-xs disabled:opacity-50">
          <Save className="h-3.5 w-3.5" aria-hidden="true" />{zh ? "保存当前" : "Save current"}
        </button>
      </div>
      {saveOpen ? <form onSubmit={saveCurrent} className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 text-xs font-medium text-secondary">
          {zh ? "预设名称" : "Preset name"}
          <input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} className="mt-1 min-h-10 w-full rounded-md border border-ui bg-page px-2.5 text-sm text-primary" required />
        </label>
        <button type="submit" disabled={save.isPending || !name.trim()} className="btn-primary min-h-10 px-3 text-xs">{zh ? "保存" : "Save"}</button>
        <button type="button" onClick={() => { setSaveOpen(false); setName(""); }} className="btn-secondary inline-flex min-h-10 items-center gap-1 px-2.5 text-xs"><X className="h-3.5 w-3.5" />{zh ? "取消" : "Cancel"}</button>
      </form> : null}
      {presets.isPending ? <p role="status" className="text-xs text-secondary">{zh ? "正在读取预设…" : "Loading presets…"}</p> : null}
      {presets.isError ? <div role="alert" className="text-xs text-secondary"><p>{zh ? "预设暂不可用；仍可手动导出。" : "Presets are unavailable; manual export still works."}</p><button type="button" className="mt-1 min-h-9 text-accent underline" onClick={() => void presets.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
      {presets.isSuccess && presets.data.length ? <ul className="divide-y divide-[var(--border)]">
        {presets.data.map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-1 py-1.5">
          {editing?.id === entry.id ? <form onSubmit={(event) => rename(event, entry)} className="flex min-w-40 flex-1 items-center gap-1">
            <input autoFocus maxLength={80} value={editing.name} onChange={(event) => setEditing({ id: entry.id, name: event.currentTarget.value })} className="min-h-9 min-w-0 flex-1 rounded-md border border-ui bg-page px-2 text-xs text-primary" required />
            <button type="submit" disabled={save.isPending || !editing.name.trim()} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-accent hover:bg-subtle" aria-label={zh ? "保存名称" : "Save name"}><Check className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setEditing(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "取消改名" : "Cancel rename"}><X className="h-3.5 w-3.5" /></button>
          </form> : <button type="button" onClick={() => onApply(entry.value)} className="min-h-9 min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-medium text-primary">{entry.value.name}</span>
            <span className="block truncate text-[11px] text-secondary">{describePreset(entry.value, zh)}</span>
          </button>}
          {editing?.id !== entry.id ? <>
            <button type="button" onClick={() => { setEditing({ id: entry.id, name: entry.value.name }); setError(""); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? `重命名 ${entry.value.name}` : `Rename ${entry.value.name}`}><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(entry)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50" aria-label={zh ? `删除 ${entry.value.name}` : `Delete ${entry.value.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
          </> : null}
        </li>)}
      </ul> : presets.isSuccess ? <p className="text-xs text-secondary">{zh ? "尚无导出预设。" : "No export presets yet."}</p> : null}
      {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}

function describePreset(value: ExportPresetValue, zh: boolean): string {
  const extras = [
    value.include_attachments && (zh ? "附件" : "attachments"),
    value.include_description && (zh ? "简介" : "description"),
    value.include_annotations && (zh ? "批注" : "annotations"),
    value.include_notebook && (zh ? "笔记" : "notebook"),
  ].filter(Boolean);
  return `${value.format}${extras.length ? ` · ${extras.join(", ")}` : ""}`;
}
