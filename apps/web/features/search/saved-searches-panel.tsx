"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Save, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { getUserFeatureEntries } from "../../lib/api";
import type { SavedSearchValue, UserFeatureEntry } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { useFeatureEntryRecovery } from "../../components/feature-entry-recovery";

const QUERY_KEY = ["user-feature-entries", "saved-search"] as const;

export function SavedSearchesPanel({
  current,
  onApply,
}: {
  current: Omit<SavedSearchValue, "name">;
  onApply: (value: SavedSearchValue) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const searches = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getUserFeatureEntries<SavedSearchValue>("saved-search", signal),
    staleTime: 30_000,
  });
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const handleSaved = (saved: UserFeatureEntry<SavedSearchValue>) => {
      queryClient.setQueryData<UserFeatureEntry<SavedSearchValue>[]>(QUERY_KEY, (items = []) => {
        const next = items.filter((item) => item.id !== saved.id);
        return [saved, ...next];
      });
      setEditing(null);
      setSaveOpen(false);
      setNewName("");
      setError("");
  };
  const handleRemoved = (entry: UserFeatureEntry<SavedSearchValue>) => {
      queryClient.setQueryData<UserFeatureEntry<SavedSearchValue>[]>(QUERY_KEY, (items = []) => items.filter((item) => item.id !== entry.id));
      setError("");
  };
  const recovery = useFeatureEntryRecovery<SavedSearchValue>("saved-search", zh, handleSaved, handleRemoved, (intended, current) => { setError(""); setEditing(current ? { id: current.id, name: intended.value.name } : null); setNewName(intended.value.name); setSaveOpen(!current); if (!current) onApply(intended.value); });
  const save = useMutation({
    mutationFn: recovery.save,
    onError: (error) => setError(recovery.errorText(error)),
  });
  const remove = useMutation({
    mutationFn: recovery.remove,
    onError: (error) => setError(recovery.errorText(error)),
  });

  function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || !current.q.trim()) return;
    const id = crypto.randomUUID();
    save.mutate({
      id,
      collection: "saved-search",
      revision: 0,
      value: { ...current, name },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  function rename(event: FormEvent<HTMLFormElement>, entry: UserFeatureEntry<SavedSearchValue>) {
    event.preventDefault();
    const name = editing?.name.trim() ?? "";
    if (!name || name === entry.value.name) { setEditing(null); return; }
    save.mutate({ ...entry, value: { ...entry.value, name } });
  }

  return (
    <section aria-labelledby="saved-searches-heading" className="border-y border-ui py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="saved-searches-heading" className="text-sm font-semibold text-primary">{zh ? "已保存的搜索" : "Saved searches"}</h2>
        <button type="button" disabled={recovery.blocked || !current.q.trim() || !searches.isSuccess || searches.data.length >= 20} onClick={() => { setSaveOpen((open) => !open); setError(""); }} className="btn-secondary inline-flex min-h-10 items-center gap-1.5 px-3 text-sm disabled:opacity-50">
          <Save className="h-4 w-4" aria-hidden="true" />{zh ? "保存当前搜索" : "Save current search"}
        </button>
      </div>
      <p className="mt-1 text-xs text-secondary">{zh ? "只保存筛选条件，不保存搜索结果。最多 20 项；这些条件与你的账户同步，不记录搜索正文到诊断信息。" : "Saves filters, not result snapshots. Up to 20 per account; query conditions sync with your account and are excluded from diagnostic details."}</p>
      {saveOpen ? <form onSubmit={saveCurrent} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-xs font-medium text-secondary">
          {zh ? "名称" : "Name"}
          <input disabled={recovery.blocked} autoFocus maxLength={80} value={newName} onChange={(event) => setNewName(event.currentTarget.value)} className="mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-3 text-sm text-primary" required />
        </label>
        <button type="submit" disabled={save.isPending || recovery.blocked || !newName.trim()} className="btn-primary min-h-11 px-3 text-sm">{zh ? "保存" : "Save"}</button>
        <button type="button" disabled={recovery.blocked} onClick={() => { setSaveOpen(false); setNewName(""); }} className="btn-secondary inline-flex min-h-11 items-center gap-1 px-3 text-sm"><X className="h-4 w-4" />{zh ? "取消" : "Cancel"}</button>
      </form> : null}
      {searches.isPending ? <p role="status" className="mt-3 text-sm text-secondary">{zh ? "正在读取已保存搜索…" : "Loading saved searches…"}</p> : null}
      {searches.isError ? <div role="alert" className="mt-3 text-sm text-secondary"><p>{zh ? "无法读取已保存搜索；当前搜索功能不受影响。" : "Saved searches could not be loaded. Search itself is unaffected."}</p><button type="button" disabled={recovery.blocked} onClick={() => void searches.refetch()} className="mt-1 min-h-10 text-accent underline">{zh ? "重试" : "Retry"}</button></div> : null}
      {searches.isSuccess && searches.data.length ? <ul className="mt-3 divide-y divide-[var(--border)]">
        {searches.data.map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
          {editing?.id === entry.id ? <form onSubmit={(event) => rename(event, entry)} className="flex min-w-48 flex-1 items-center gap-2">
            <input disabled={recovery.blocked} aria-label={zh ? "搜索名称" : "Search name"} autoFocus maxLength={80} value={editing.name} onChange={(event) => setEditing({ id: entry.id, name: event.currentTarget.value })} className="min-h-10 min-w-0 flex-1 rounded-md border border-ui bg-surface px-2 text-sm text-primary" required />
            <button type="submit" disabled={save.isPending || recovery.blocked || !editing.name.trim()} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-accent hover:bg-subtle" aria-label={zh ? "保存名称" : "Save name"}><Check className="h-4 w-4" /></button>
            <button type="button" disabled={recovery.blocked} onClick={() => setEditing(null)} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "取消改名" : "Cancel rename"}><X className="h-4 w-4" /></button>
          </form> : <button type="button" disabled={recovery.blocked} onClick={() => onApply(entry.value)} className="min-h-11 min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium text-primary">{entry.value.name}</span>
            <span className="block truncate text-xs text-secondary">{entry.value.q}</span>
          </button>}
          {editing?.id !== entry.id ? <>
            <button type="button" disabled={recovery.blocked} onClick={() => { setEditing({ id: entry.id, name: entry.value.name }); setError(""); }} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? `重命名 ${entry.value.name}` : `Rename ${entry.value.name}`}><Pencil className="h-4 w-4" /></button>
            <button type="button" disabled={remove.isPending || recovery.blocked} onClick={() => remove.mutate(entry)} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50" aria-label={zh ? `删除 ${entry.value.name}` : `Delete ${entry.value.name}`}><Trash2 className="h-4 w-4" /></button>
          </> : null}
        </li>)}
      </ul> : searches.isSuccess ? <p className="mt-3 text-sm text-secondary">{zh ? "尚无已保存的搜索。" : "No saved searches yet."}</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}
    {recovery.panel}
    </section>
  );
}
