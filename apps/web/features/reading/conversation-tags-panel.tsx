"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiRequestError, deleteUserFeatureEntry, getUserFeatureEntries, saveUserFeatureEntry } from "../../lib/api";
import type { ConversationTagValue, UserFeatureEntry } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { getOfflineConversationTags } from "../../lib/offline-db";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";

export const conversationTagsQueryKey = ["user-feature-entries", "conversation-tag"] as const;

export function ConversationTagsPanel({ conversationId, offline = false }: { conversationId: string; offline?: boolean }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const { confirm } = useInteractionDialog();
  const queryKey = offline ? [...conversationTagsQueryKey, "offline", conversationId] : conversationTagsQueryKey;
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey });
    void client.invalidateQueries({ queryKey: ["conversation", "remote"] });
    void client.invalidateQueries({ queryKey: ["conversations"] });
  };
  const tagsQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<UserFeatureEntry<ConversationTagValue>[]> => {
      if (!offline) return getUserFeatureEntries<ConversationTagValue>("conversation-tag", signal);
      return (await getOfflineConversationTags(conversationId)).map((tag, index) => ({
        id: `offline:${index}`, collection: "conversation-tag", revision: 0,
        value: { name: tag, conversation_ids: [conversationId] }, created_at: "", updated_at: "",
      }));
    },
  });
  const save = useMutation({
    mutationFn: ({ entry, value }: { entry: UserFeatureEntry<ConversationTagValue> | null; value: ConversationTagValue }) =>
      saveUserFeatureEntry("conversation-tag", entry?.id ?? crypto.randomUUID(), { expected_revision: entry?.revision ?? 0, value }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (entry: UserFeatureEntry<ConversationTagValue>) => deleteUserFeatureEntry("conversation-tag", entry.id, entry.revision),
    onSuccess: refresh,
  });
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);
  const currentTags = useMemo(() => tags.filter((entry) => entry.value.conversation_ids.includes(conversationId)), [conversationId, tags]);
  const visibleTags = useMemo(() => tags.filter((entry) => entry.value.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, tags]);
  async function addTag() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    const existing = tags.find((entry) => entry.value.name.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0);
    try {
      await save.mutateAsync({ entry: existing ?? null, value: { name: existing?.value.name ?? trimmed, conversation_ids: Array.from(new Set([...(existing?.value.conversation_ids ?? []), conversationId])) } });
      setName("");
    } catch (cause) {
      setError(cause instanceof ApiRequestError && cause.status === 409
        ? (zh ? "标签已在其他标签中或名称重复，请刷新后重试。" : "That tag changed elsewhere or the name already exists. Refresh and retry.")
        : (zh ? "标签保存结果未确认，请刷新后核对。" : "The tag result was not confirmed. Refresh and check before retrying."));
    }
  }
  async function toggleTag(entry: UserFeatureEntry<ConversationTagValue>) {
    if (offline) return;
    setError(null);
    const ids = new Set(entry.value.conversation_ids);
    if (ids.has(conversationId)) ids.delete(conversationId); else ids.add(conversationId);
    try {
      await save.mutateAsync({ entry, value: { ...entry.value, conversation_ids: [...ids] } });
    } catch {
      setError(zh ? "标签更新结果未确认，请刷新后核对。" : "The tag update was not confirmed. Refresh and check before retrying.");
    }
  }
  async function renameTag(entry: UserFeatureEntry<ConversationTagValue>) {
    const nextName = editingName.trim();
    if (!nextName || nextName === entry.value.name) { setEditingId(null); return; }
    try {
      await save.mutateAsync({ entry, value: { ...entry.value, name: nextName } });
      setEditingId(null);
      setEditingName("");
    } catch {
      setError(zh ? "标签改名未确认；请刷新后核对。" : "The rename was not confirmed. Refresh and check.");
    }
  }
  return (
    <section className="grid gap-3 p-3">
      <div>
        <h2 className="text-sm font-semibold text-primary">{zh ? "对话标签" : "Conversation tags"}</h2>
        <p className="mt-1 text-xs text-secondary">{offline
          ? (zh ? "这是下载时的标签快照。联网后可管理；移除离线副本会一并清除本地快照。" : "These are tags captured with the download. Manage them online; removing this offline copy also clears the local snapshot.")
          : (zh ? "标签只属于当前账户；删除标签不会删除对话。" : "Tags belong to this account. Deleting a tag never deletes a conversation.")}</p>
      </div>
      {!offline ? <div className="flex gap-2">
        <input value={name} maxLength={40} aria-label={zh ? "标签名称" : "Tag name"} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !save.isPending) { event.preventDefault(); void addTag(); } }} placeholder={zh ? "新建或添加现有标签" : "Create or add an existing tag"} className="min-w-0 flex-1 rounded-md border border-ui bg-surface px-3 py-2 text-sm text-primary" />
        <button type="button" onClick={() => void addTag()} disabled={save.isPending || !name.trim()} className="min-h-10 rounded-md bg-[var(--text)] px-3 text-xs text-[var(--surface)] disabled:opacity-50">{zh ? "添加" : "Add"}</button>
      </div> : null}
      <input value={query} aria-label={zh ? "搜索标签" : "Search tags"} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索标签" : "Search tags"} className="min-h-9 rounded-md border border-ui bg-surface px-3 text-sm text-primary" />
      {tagsQuery.isPending ? <p className="text-xs text-secondary">{zh ? "正在读取标签…" : "Loading tags…"}</p> : null}
      {tagsQuery.isError ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "无法读取标签。" : "Tags could not be loaded."}</p> : null}
      <ul className="grid gap-1">
        {visibleTags.map((entry) => {
          const active = currentTags.some((item) => item.id === entry.id);
          return <li key={entry.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-subtle">
            {!offline ? <input type="checkbox" checked={active} disabled={save.isPending || remove.isPending} onChange={() => void toggleTag(entry)} aria-label={`${active ? (zh ? "移除" : "Remove") : (zh ? "添加" : "Add")} ${entry.value.name}`} /> : null}
            {editingId === entry.id
              ? <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameTag(entry); if (event.key === "Escape") setEditingId(null); }} className="min-w-0 flex-1 rounded border border-ui bg-surface px-2 py-1 text-sm text-primary" aria-label={zh ? "标签新名称" : "New tag name"} />
              : <span className="min-w-0 flex-1 truncate text-sm text-primary">{entry.value.name}</span>}
            {!offline ? <div className="flex gap-1">
              {editingId === entry.id
                ? <button type="button" onClick={() => void renameTag(entry)} className="min-h-8 rounded border border-ui px-2 text-xs">{zh ? "保存" : "Save"}</button>
                : <button type="button" onClick={() => { setEditingId(entry.id); setEditingName(entry.value.name); }} className="min-h-8 rounded border border-ui px-2 text-xs">{zh ? "改名" : "Rename"}</button>}
              <button type="button" onClick={async () => {
                const confirmed = await confirm({ title: zh ? `删除标签“${entry.value.name}”？` : `Delete tag “${entry.value.name}”?`, description: zh ? "不会删除任何对话。" : "No conversations will be deleted.", danger: true });
                if (confirmed) void remove.mutateAsync(entry).catch(() => setError(zh ? "标签删除结果未确认，请刷新后核对。" : "Tag deletion was not confirmed. Refresh and check."));
              }} disabled={remove.isPending} className="min-h-8 rounded border border-ui px-2 text-xs text-[var(--danger)]">{zh ? "删除" : "Delete"}</button>
            </div> : null}
            <span className="text-[11px] text-secondary">{entry.value.conversation_ids.length}</span>
          </li>;
        })}
      </ul>
      {!tagsQuery.isPending && !tagsQuery.isError && !visibleTags.length ? <p className="text-xs text-secondary">{zh ? "没有匹配的标签。" : "No matching tags."}</p> : null}
      {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}
