"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { adminApi } from "../lib/admin-client";
import { AdminLoadError, AdminPageControls, adminButton } from "./admin-users-panel";
import { useAttachmentViewer } from "../features/attachments/attachment-viewer";

export function AdminUserContent({ userId, zh }: { userId: string; zh: boolean }) {
  const [tab, setTab] = useState<"conversations" | "attachments">("conversations");
  const [draft, setDraft] = useState(""), [q, setQ] = useState(""), [offset, setOffset] = useState(0);
  const viewer = useAttachmentViewer();
  const conversations = useQuery({ queryKey: ["admin-user-conversations", userId, q, offset], queryFn: () => adminApi.userConversations(userId, q, offset), enabled: tab === "conversations", retry: false });
  const attachments = useQuery({ queryKey: ["admin-user-attachments", userId, q, offset], queryFn: () => adminApi.userAttachments(userId, q, offset), enabled: tab === "attachments", retry: false });
  const query = tab === "conversations" ? conversations : attachments;
  return <div className="space-y-3">
    <nav aria-label={zh ? "资料类型" : "Content type"} className="flex gap-2">{(["conversations", "attachments"] as const).map((value) => <button key={value} aria-pressed={tab === value} className={`${tab === value ? "btn-primary" : "btn-secondary"} min-h-11 px-3 text-sm`} onClick={() => { setTab(value); setQ(""); setDraft(""); setOffset(0); }}>{value === "conversations" ? (zh ? "对话" : "Conversations") : (zh ? "附件" : "Attachments")}</button>)}</nav>
    <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setQ(draft.trim()); setOffset(0); }}><label className="min-w-0 flex-1 text-xs text-secondary">{tab === "conversations" ? (zh ? "搜索对话标题" : "Search conversation titles") : (zh ? "搜索附件名称" : "Search attachment names")}<input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={256} className="input-base mt-1 min-h-11 w-full px-3 text-base" /></label><button type="submit" className={adminButton} aria-label={zh ? "搜索资料" : "Search content"}><Search className="h-4 w-4" aria-hidden /></button></form>
    {query.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "读取资料…" : "Loading content…"}</p> : null}
    {query.isError ? <AdminLoadError zh={zh} onRetry={() => void query.refetch()} /> : null}
    <div className="divide-y divide-[var(--border)] border-y border-ui">
      {tab === "conversations" ? conversations.data?.items.map((item) => <div key={item.id} className="py-3"><a className="inline-flex min-h-11 items-center gap-2 break-words text-sm font-medium text-primary hover:text-accent" href={`/admin/users/${userId}/conversations/${item.id}`} target="_blank" rel="noreferrer">{item.title}<ExternalLink className="h-4 w-4 shrink-0" aria-hidden /><span className="sr-only">{zh ? "（在新标签页只读打开）" : "(open read-only in a new tab)"}</span></a><p className="text-xs text-secondary">{item.message_count} {zh ? "条消息" : "messages"} · {item.turn_count} {zh ? "轮" : "turns"}</p><p className="mt-1 line-clamp-2 break-words text-sm text-secondary">{item.summary}</p></div>) : attachments.data?.items.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 py-3"><div className="min-w-0 flex-1 basis-40"><p className="break-all text-sm text-primary">{item.display_name}</p><p className="mt-1 text-xs text-secondary">{item.asset_object ? `${(item.asset_object.byte_size / 1024).toFixed(1)} KB` : (zh ? "资源不可用" : "Resource unavailable")}</p></div>{item.content_url ? <button className={adminButton} onClick={(event) => viewer.open({ source: "file-panel", scope: "single", items: [{ itemKey: item.id, attachmentId: item.id }], activeItemKey: item.id, access: { kind: "admin", userId }, permissions: { downloadOriginal: true, enumerateConversationImages: false, batchDownload: false }, trigger: event.currentTarget })}>{zh ? "查看" : "View"}</button> : null}{item.download_url ? <a className={`${adminButton} inline-flex items-center`} href={item.download_url} download>{zh ? "下载" : "Download"}</a> : null}</div>)}
    </div>
    {query.data?.total === 0 ? <p className="py-3 text-sm text-secondary">{zh ? "没有匹配的资料。" : "No matching content."}</p> : null}
    {query.data ? <AdminPageControls offset={offset} total={query.data.total} onPage={setOffset} busy={query.isFetching} zh={zh} /> : null}
  </div>;
}
