"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History, Trash2, X } from "lucide-react";
import { useState } from "react";
import { deleteMessageVersion, getMessageVersions, selectMessageVersion } from "../../lib/api";
import type { MessageListItem } from "../../lib/types";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";

export function VersionHistoryPanel({ messageId, currentVersionId, onChanged }: {
  messageId: string;
  currentVersionId?: string;
  onChanged: (message: MessageListItem, conversationRevision?: number) => Promise<void> | void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const dialog = useInteractionDialog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const versionsQuery = useQuery({ queryKey: ["message-versions", messageId], queryFn: () => getMessageVersions(messageId) });
  const versions = [...(versionsQuery.data?.items ?? [])].sort((a, b) => a.version_number - b.version_number);
  const currentIndex = Math.max(0, versions.findIndex((version) => version.id === (versionsQuery.data?.current_version_id ?? currentVersionId)));
  const current = versions[currentIndex];

  async function select(index: number) {
    const target = versions[index];
    if (!target || target.id === current?.id || busy) return;
    setBusy(true);
    try {
      const response = await selectMessageVersion(messageId, target.id);
      await versionsQuery.refetch();
      await onChanged(response.message, response.conversation_revision);
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!current?.can_delete || busy) return;
    const confirmed = await dialog.confirm({ title: zh ? `永久删除 v${current.version_number}？` : `Permanently delete v${current.version_number}?`, description: current.is_current ? (zh ? "当前消息会自动切换到上一可用版本。此操作不能撤销。" : "The message will switch to the nearest earlier version. This cannot be undone.") : (zh ? "此操作不能撤销。" : "This cannot be undone."), confirmLabel: zh ? "永久删除" : "Delete permanently", danger: true });
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await deleteMessageVersion(messageId, current.id);
      await versionsQuery.refetch();
      await onChanged(response.message, response.conversation_revision);
    } finally { setBusy(false); }
  }

  if (versionsQuery.isLoading) return <span className="inline-flex h-10 w-10 animate-pulse rounded-lg bg-subtle" aria-label={zh ? "正在加载版本" : "Loading versions"} />;
  if (versions.length === 0) return null;

  return (
    <div className="relative flex items-center gap-1" data-testid="message-version-control">
      <button type="button" disabled={busy || currentIndex <= 0} onClick={() => void select(currentIndex - 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:opacity-30" aria-label={zh ? "上一版" : "Previous version"} title={zh ? "上一版" : "Previous version"}><ChevronLeft className="h-4 w-4" /></button>
      <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-secondary hover:bg-subtle" aria-label={zh ? "版本详情" : "Version details"} title={zh ? "版本详情" : "Version details"}><History className="h-4 w-4" /><span>{currentIndex + 1} / {versions.length}</span></button>
      <button type="button" disabled={busy || currentIndex >= versions.length - 1} onClick={() => void select(currentIndex + 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:opacity-30" aria-label={zh ? "下一版" : "Next version"} title={zh ? "下一版" : "Next version"}><ChevronRight className="h-4 w-4" /></button>
      {open && current ? <section className="absolute right-0 top-11 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-ui bg-raised p-3 shadow-2xl" aria-label={zh ? "版本详情面板" : "Version details panel"}>
        <header className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-primary">{zh ? "版本" : "Version"} v{current.version_number}</h3><p className="mt-1 text-xs text-secondary">{new Date(current.created_at).toLocaleString(resolvedLocale)} · {current.edit_type}</p></div><button type="button" onClick={() => setOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭版本详情" : "Close version details"}><X className="h-4 w-4" /></button></header>
        {current.edit_reason ? <p className="mt-2 text-xs text-secondary">{current.edit_reason}</p> : null}
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-3 text-xs leading-5 text-primary">{current.display_text || current.plain_text || ""}</pre>
        <div className="mt-3 flex justify-end"><button type="button" disabled={!current.can_delete || busy} onClick={() => void remove()} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40" title={current.is_initial ? (zh ? "初始版本不能删除" : "The initial version cannot be deleted") : (zh ? "永久删除版本" : "Permanently delete version")}><Trash2 className="h-4 w-4" />{current.is_initial ? (zh ? "初始版本受保护" : "Initial version protected") : (zh ? "永久删除" : "Delete permanently")}</button></div>
      </section> : null}
    </div>
  );
}
