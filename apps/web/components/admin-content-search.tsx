"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { adminApi } from "../lib/admin-client";
import { AdminLoadError, AdminPageControls, adminButton } from "./admin-users-panel";

export function AdminContentSearch({ zh }: { zh: boolean }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(""), [q, setQ] = useState<string | null>(null), [offset, setOffset] = useState(0);
  const list = useQuery({ queryKey: ["admin-content-search", q, offset], queryFn: () => adminApi.contentSearch(q ?? "", offset), enabled: open && q !== null, retry: false });
  return <section className="border-y border-ui py-1" aria-label={zh ? "跨用户内容搜索" : "Search across user content"}>
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm text-primary" aria-expanded={open} onClick={() => setOpen(!open)}><span className="flex items-center gap-2"><Search className="h-4 w-4 text-secondary" aria-hidden />{zh ? "跨用户内容搜索" : "Search across user content"}</span><ChevronDown aria-hidden className={`h-4 w-4 ${open ? "rotate-180" : ""}`} /></button>
    {open ? <div className="space-y-3 pb-4"><p className="text-xs leading-5 text-secondary">{zh ? "查找标题与正文。查看结果和打开对话都会留下审计记录。" : "Search titles and messages. Viewing results and opening conversations are audited."}</p><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setQ(draft.trim()); setOffset(0); }}><label className="min-w-0 flex-1"><span className="sr-only">{zh ? "搜索全部用户的对话" : "Search all user conversations"}</span><input autoFocus required maxLength={256} value={draft} onChange={(event) => setDraft(event.target.value)} className="input-base min-h-11 w-full px-3 text-base" /></label><button className={adminButton} disabled={list.isFetching || !draft.trim()}>{zh ? "搜索正文" : "Search content"}</button></form>
      {q !== null && list.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在搜索…" : "Searching…"}</p> : null}{list.isError ? <AdminLoadError zh={zh} onRetry={() => void list.refetch()} /> : null}
      {list.data && !list.isError ? <><ul className="divide-y divide-[var(--border)]">{list.data.items.map((item) => <li key={item.conversation_id} className="space-y-1 py-3"><a href={`/admin/users/${item.user_id}/conversations/${item.conversation_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent"><span className="break-words">{item.title}</span><ExternalLink className="h-4 w-4 shrink-0" aria-hidden /><span className="sr-only">{zh ? "（新标签页，只读）" : "(new tab, read-only)"}</span></a><p className="break-all text-xs text-secondary">{item.user_display_name || item.user_email}</p><p className="line-clamp-3 break-words text-sm text-secondary">{item.snippet}</p></li>)}</ul>{!list.data.items.length ? <p className="py-4 text-sm text-secondary">{zh ? "未找到匹配的对话。" : "No matching conversations."}</p> : null}<AdminPageControls offset={offset} total={list.data.total} onPage={setOffset} busy={list.isFetching} zh={zh} /></> : null}
    </div> : null}
  </section>;
}
