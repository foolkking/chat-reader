"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getUserFeatureEntries, mergeConversationTags } from "../../lib/api";
import type { ConversationTagValue, UserFeatureEntry } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { getOfflineConversationTags } from "../../lib/offline-db";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { useFeatureEntryRecovery } from "../../components/feature-entry-recovery";
import { authenticationGeneration } from "../../lib/offline-access";

export const conversationTagsQueryKey = ["user-feature-entries", "conversation-tag"] as const;

export function ConversationTagsPanel({ conversationId = "", conversationIds, offline = false, management = false, disabled = false, onBusyChange }: { conversationId?: string; conversationIds?: string[]; offline?: boolean; management?: boolean; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const targets = conversationIds ?? (conversationId ? [conversationId] : []);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const { confirm } = useInteractionDialog();
  const queryKey = offline ? [...conversationTagsQueryKey, "offline", conversationId] : conversationTagsQueryKey;
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [mergeState, setMergeState] = useState<"idle" | "saving" | "check">("idle");
  const mounted = useRef(true), generation = useRef(authenticationGeneration()), mergeFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && generation.current === authenticationGeneration();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retainedDraft, setRetainedDraft] = useState<ConversationTagValue | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey });
    void client.invalidateQueries({ queryKey: ["conversation", "remote"] });
    void client.invalidateQueries({ queryKey: ["conversations"] });
    void client.invalidateQueries({ queryKey: ["search"] });
    void client.invalidateQueries({ queryKey: ["user-feature-entries", "saved-search"] });
  };
  const confirmed = () => { setError(null); setName(""); setEditingId(null); setEditingName(""); setRetainedDraft(null); refresh(); };
  const recovery = useFeatureEntryRecovery<ConversationTagValue>("conversation-tag", zh, confirmed, confirmed, (intended, current) => {
    setError(null);
    setRetainedDraft(intended.value);
    if (current) { setEditingId(current.id); setEditingName(intended.value.name); }
    else { setName(intended.value.name); setEditingId(null); }
  });
  const tagsQuery = useQuery({
    ...(offline ? { networkMode: "always" as const } : {}),
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
      recovery.save(entry ? { ...entry, value } : { id: crypto.randomUUID(), collection: "conversation-tag", revision: 0, value, created_at: "", updated_at: "" }),
  });
  const remove = useMutation({
    mutationFn: recovery.remove,
  });
  const pending = save.isPending || remove.isPending || mergeState === "saving";
  useEffect(() => { onBusyChange?.(pending); return () => onBusyChange?.(false); }, [pending, onBusyChange]);
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);
  const visibleTags = useMemo(() => tags.filter((entry) => entry.value.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, tags]);
  async function addTag() {
    const trimmed = name.trim();
    if (!trimmed || disabled || offline || recovery.blocked || mergeState !== "idle" || mergeFlight.current || tagsQuery.isError || tagsQuery.isPending) return;
    setError(null);
    const existing = tags.find((entry) => entry.value.name.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0);
    try {
      await save.mutateAsync({ entry: existing ?? null, value: { name: existing?.value.name ?? trimmed, conversation_ids: Array.from(new Set([...(existing?.value.conversation_ids ?? []), ...targets])) } });
      setName("");
    } catch (cause) {
      setError(recovery.errorText(cause));
    }
  }
  async function toggleTag(entry: UserFeatureEntry<ConversationTagValue>) {
    if (disabled || offline || recovery.blocked || mergeState !== "idle") return;
    setError(null);
    const ids = new Set(entry.value.conversation_ids);
    const remove = targets.every(id => ids.has(id));
    for (const id of targets) { if (remove) ids.delete(id); else ids.add(id); }
    try {
      await save.mutateAsync({ entry, value: { ...entry.value, conversation_ids: [...ids] } });
    } catch (cause) {
      setError(recovery.errorText(cause));
    }
  }
  async function renameTag(entry: UserFeatureEntry<ConversationTagValue>) {
    if (disabled || offline || recovery.blocked || mergeState !== "idle") return;
    const nextName = editingName.trim();
    if (!nextName || nextName === entry.value.name) { setEditingId(null); return; }
    try {
      await save.mutateAsync({ entry, value: { ...entry.value, name: nextName } });
      setEditingId(null);
      setEditingName("");
    } catch (cause) {
      setError(recovery.errorText(cause));
    }
  }
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 p-3">
      <div>
        <h2 className="text-sm font-semibold text-primary">{zh ? "对话标签" : "Conversation tags"}</h2>
        <p className="mt-1 text-xs text-secondary">{offline
          ? (zh ? "这是下载时的标签快照。联网后可管理；移除离线副本会一并清除本地快照。" : "These are tags captured with the download. Manage them online; removing this offline copy also clears the local snapshot.")
          : (zh ? "标签只属于当前账户；删除标签不会删除对话。" : "Tags belong to this account. Deleting a tag never deletes a conversation.")}</p>
      </div>
      {!offline ? <div className="flex gap-2">
        <input value={name} disabled={recovery.blocked || mergeState !== "idle"} maxLength={40} aria-label={zh ? "标签名称" : "Tag name"} onChange={(event) => { setName(event.target.value); if (!management) setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !save.isPending) { event.preventDefault(); void addTag(); } }} placeholder={zh ? "搜索或创建标签" : "Find or create a tag"} className="min-w-0 flex-1 rounded-md border border-ui bg-surface px-3 py-2 text-sm text-primary" />
        <button type="button" onClick={() => void addTag()} disabled={recovery.blocked || mergeState !== "idle" || tagsQuery.isPending || tagsQuery.isError || !name.trim()} className="min-h-11 rounded-md bg-[var(--text)] px-3 text-xs text-[var(--surface)] disabled:opacity-50">{zh ? (tags.some(tag => tag.value.name === name.trim()) ? "添加" : "创建") : (tags.some(tag => tag.value.name === name.trim()) ? "Add" : "Create")}</button>
      </div> : null}
      {management ? <input value={query} aria-label={zh ? "搜索标签" : "Search tags"} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索标签" : "Search tags"} className="min-h-11 rounded-md border border-ui bg-surface px-3 text-sm text-primary" /> : null}
      {tagsQuery.isPending ? <p className="text-xs text-secondary">{zh ? "正在读取标签…" : "Loading tags…"}</p> : null}
      {tagsQuery.isError ? <div role="alert" className="text-xs text-[var(--danger)]"><p>{zh ? "无法读取标签，已输入的名称仍保留。" : "Tags could not be loaded. Your input is retained."}</p><button type="button" disabled={tagsQuery.isFetching} onClick={() => void tagsQuery.refetch()} className="min-h-11 underline">{zh ? "重试读取" : "Retry reading"}</button></div> : null}
      {!offline ? recovery.panel : null}
      {!offline && retainedDraft ? <details className="text-xs text-secondary">
        <summary className="min-h-11 cursor-pointer py-3">{zh ? "保留的标签草稿" : "Retained tag draft"}</summary>
        <p>{zh ? "名称已带回输入框，关联以当前服务器状态为准。请对照后重新勾选，不会自动覆盖其他对话的关联。" : "The name is back in the input. Associations use the current server state. Review and select them again; other conversations are not overwritten automatically."}</p>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(retainedDraft, null, 2)}</pre>
      </details> : null}
      <ul className="grid gap-1">
        {visibleTags.map((entry) => {
          const active = targets.length > 0 && targets.every(id => entry.value.conversation_ids.includes(id));
          return <li key={entry.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-subtle">
            {!offline && !management ? <input type="checkbox" checked={active} disabled={recovery.blocked || mergeState !== "idle" || tagsQuery.isError} onChange={() => void toggleTag(entry)} aria-label={`${active ? (zh ? "移除" : "Remove") : (zh ? "添加" : "Add")} ${entry.value.name}`} /> : null}
            {editingId === entry.id
              ? <input autoFocus disabled={recovery.blocked || mergeState !== "idle"} value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameTag(entry); if (event.key === "Escape") setEditingId(null); }} className="min-h-11 min-w-0 flex-1 rounded border border-ui bg-surface px-2 py-1 text-sm text-primary" aria-label={zh ? "标签新名称" : "New tag name"} />
              : management ? <Link href={`/tags?tag=${entry.id}`} className="min-h-11 min-w-0 flex-1 py-3 text-sm text-primary hover:underline">{entry.value.name}</Link> : <span className="min-w-0 flex-1 truncate text-sm text-primary">{entry.value.name}</span>}
            {!offline && management ? <div className="flex flex-wrap gap-1">
              {editingId === entry.id
                ? <button type="button" disabled={recovery.blocked || mergeState !== "idle" || tagsQuery.isError} onClick={() => void renameTag(entry)} className="min-h-11 rounded border border-ui px-2 text-xs">{zh ? "保存" : "Save"}</button>
                : <button type="button" disabled={recovery.blocked || mergeState !== "idle" || tagsQuery.isError} onClick={() => { setEditingId(entry.id); setEditingName(entry.value.name); }} className="min-h-11 rounded border border-ui px-2 text-xs">{zh ? "改名" : "Rename"}</button>}
              <button type="button" disabled={mergeState !== "idle" || recovery.blocked || tagsQuery.isError} onClick={() => { setMergeFrom(entry.id); setMergeInto(""); }} className="min-h-11 rounded px-2 text-xs">{zh ? "合并" : "Merge"}</button>
              <button type="button" onClick={async () => {
                const confirmed = await confirm({ title: zh ? `删除标签“${entry.value.name}”？` : `Delete tag “${entry.value.name}”?`, description: zh ? "不会删除任何对话。" : "No conversations will be deleted.", danger: true });
                if (confirmed) void remove.mutateAsync(entry).catch((cause) => setError(recovery.errorText(cause)));
              }} disabled={recovery.blocked || mergeState !== "idle" || tagsQuery.isError} className="min-h-11 rounded border border-ui px-2 text-xs text-[var(--danger)]">{zh ? "删除" : "Delete"}</button>
            </div> : null}
            <span className="text-xs text-secondary">{entry.value.conversation_ids.length}</span>
          </li>;
        })}
      </ul>
      {!tagsQuery.isPending && !tagsQuery.isError && !visibleTags.length ? <p className="text-xs text-secondary">{zh ? "没有匹配的标签。" : "No matching tags."}</p> : null}
      {!management && !offline ? <Link href="/tags" className="min-h-11 py-3 text-xs text-accent">{zh ? "管理全部标签" : "Manage all tags"}</Link> : null}
      {targets.length > 1 ? <p className="text-xs text-secondary">{zh ? `勾选会添加到所选 ${targets.length} 个对话；取消勾选会全部移除。每个标签单独确认保存。` : `Checking adds this tag to all ${targets.length} conversations; unchecking removes it from all. Each tag saves separately.`}</p> : null}
      {mergeFrom ? <div className="grid gap-2 border-t border-ui pt-3">
        <label className="text-sm">{zh ? "合并到标签（保留目标名称）" : "Merge into (keep target name)"}<select value={mergeInto} onChange={event => setMergeInto(event.target.value)} disabled={mergeState !== "idle"} className="mt-1 min-h-11 w-full rounded border border-ui bg-surface px-2"><option value="">{zh ? "选择目标" : "Choose target"}</option>{tags.filter(tag => tag.id !== mergeFrom).map(tag => <option key={tag.id} value={tag.id}>{tag.value.name}</option>)}</select></label>
        <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={!mergeInto || mergeState !== "idle" || recovery.blocked} onClick={async () => {
          if (mergeFlight.current || !current()) return;
          const source = tags.find(tag => tag.id === mergeFrom), target = tags.find(tag => tag.id === mergeInto);
          if (!source || !target) return;
          mergeFlight.current = true;
          try {
            if (!await confirm({ title: zh ? "合并这两个标签？" : "Merge these tags?", description: zh ? "关联对话合并，已保存搜索改为目标标签。不会删除对话。" : "Unions conversations and redirects saved searches. No conversations are deleted." }) || !current()) return;
            setMergeState("saving"); setError(null);
            await mergeConversationTags(source, target);
            if (current()) { setMergeState("idle"); setMergeFrom(null); refresh(); }
          } catch {
            if (current()) { setMergeState("check"); setError(zh ? "合并未确认。请只读核对结果，不要重复提交。" : "Merge not confirmed. Check the result before another submission."); }
          } finally { mergeFlight.current = false; }
        }}>{mergeState === "saving" ? (zh ? "正在合并…" : "Merging…") : (zh ? "确认合并" : "Merge tags")}</button>
        {mergeState === "check" ? <button type="button" disabled={tagsQuery.isFetching} className="min-h-11 text-sm text-accent" onClick={async () => { const result = await tagsQuery.refetch(); if (current() && !result.isError) { setMergeState("idle"); setMergeFrom(null); setError(zh ? "已读取最新标签，请核对关联和目标名称后再操作。" : "Latest tags loaded. Review associations and names before another action."); refresh(); } }}>{zh ? "核对结果" : "Check result"}</button> : null}
        {mergeState === "idle" ? <button type="button" className="min-h-11 text-xs" onClick={() => setMergeFrom(null)}>{zh ? "取消合并" : "Cancel merge"}</button> : null}
      </div> : null}
      {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
    </fieldset>
  );
}
