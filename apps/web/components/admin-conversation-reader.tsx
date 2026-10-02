"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { adminApi } from "../lib/admin-client";
import { MessageItem } from "../features/conversations/message-item";
import { usePreferences } from "./preferences-provider";
import { AdminLoadError, AdminPageControls, adminButton } from "./admin-users-panel";

/** Separate read-only surface: no owner mutations, position saves or offline copies. */
export function AdminConversationReader({ userId, conversationId }: { userId: string; conversationId: string }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [anchor, setAnchor] = useState<string | undefined>(), [draft, setDraft] = useState(""), [q, setQ] = useState(""), [offset, setOffset] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), requested = useRef<string | null>("first");
  const metadata = useQuery({ queryKey: ["admin-conversation", userId, conversationId], queryFn: () => adminApi.userConversation(userId, conversationId), retry: false });
  const turn = useQuery({ queryKey: ["admin-reader-turn", userId, conversationId, anchor], queryFn: () => adminApi.readUserConversation(userId, conversationId, anchor), retry: false, gcTime: 0 });
  const search = useQuery({ queryKey: ["admin-reader-search", userId, conversationId, q, offset], queryFn: () => adminApi.searchUserConversation(userId, conversationId, q, offset), enabled: searchOpen && !!q, retry: false, gcTime: 0 });
  function navigate(id: string) { requested.current = id; setAnchor(id); setSearchOpen(false); }
  useEffect(() => {
    if (!turn.data || requested.current === null) return;
    const id = requested.current === "first" ? turn.data.items[0]?.id : requested.current;
    if (!id || !turn.data.items.some((item) => item.id === id)) return;
    const frame = requestAnimationFrame(() => {
      const element = root.current?.querySelector<HTMLElement>(`article[data-message-id="${id}"]`);
      if (element && root.current) {
        // The actual message element is the navigation authority. There is no
        // reading-position writer on this administrator surface.
        element.tabIndex = -1; element.focus({ preventScroll: true });
        root.current.scrollTop += element.getBoundingClientRect().top - root.current.getBoundingClientRect().top - 12;
        requested.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [turn.data, anchor, searchOpen]);
  return <main className="reader-frame flex h-dvh min-w-0 flex-col bg-page text-primary">
    <header className="shrink-0 border-b border-ui bg-raised px-4 py-3 sm:px-6"><div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3"><Link href="/" className="btn-ghost inline-flex min-h-11 items-center gap-2 px-2 text-sm"><ArrowLeft className="h-4 w-4" aria-hidden />{zh ? "资料库" : "Library"}</Link><div className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0"><p className="flex items-center gap-2 text-xs text-secondary"><ShieldCheck className="h-4 w-4" aria-hidden />{zh ? "管理员只读查看 · 访问已审计" : "Administrator · Read-only · Audited access"}</p><h1 className="mt-1 break-words text-lg font-semibold">{metadata.data?.title ?? (zh ? "对话" : "Conversation")}</h1></div><button className={adminButton} aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search className="mr-2 inline h-4 w-4" aria-hidden />{zh ? "搜索消息" : "Search messages"}</button></div></header>
    {searchOpen ? <aside className="max-h-[45dvh] shrink-0 overflow-y-auto border-b border-ui bg-raised px-4 py-4" aria-label={zh ? "消息搜索" : "Message search"}><div className="mx-auto max-w-5xl space-y-3"><form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setQ(draft.trim()); setOffset(0); }}><label className="min-w-0 flex-1 text-xs text-secondary">{zh ? "搜索当前对话正文" : "Search this conversation"}<input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={256} className="input-base mt-1 min-h-11 w-full px-3 text-base" /></label><button className={adminButton} type="submit" disabled={!draft.trim()}>{zh ? "搜索" : "Search"}</button></form>{q && search.isPending ? <p role="status">{zh ? "搜索中…" : "Searching…"}</p> : null}{search.isError ? <AdminLoadError zh={zh} onRetry={() => void search.refetch()} /> : null}{search.data ? <><div className="divide-y divide-[var(--border)]">{search.data.items.map((item) => <button key={item.message_id} className="block min-h-11 w-full py-3 text-left text-sm text-primary hover:bg-subtle" onClick={() => navigate(item.message_id)}><span className="text-xs text-secondary">{item.role}</span><span className="mt-1 block break-words">{item.snippet}</span><span className="mt-1 block text-xs text-accent">{zh ? "定位到消息" : "Go to message"}</span></button>)}</div>{search.data.total === 0 ? <p className="text-sm text-secondary">{zh ? "没有匹配消息。" : "No matching messages."}</p> : null}<AdminPageControls offset={offset} total={search.data.total} onPage={setOffset} busy={search.isFetching} zh={zh} /></> : null}</div></aside> : null}
    <div ref={root} data-reader-scroll-root="true" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"><div className="reader-content-inner mx-auto max-w-5xl space-y-6">
      {turn.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "读取完整轮次…" : "Loading complete turn…"}</p> : null}
      {turn.isError || metadata.isError ? <AdminLoadError zh={zh} onRetry={() => { void turn.refetch(); void metadata.refetch(); }} /> : null}
      {turn.data?.items.map((message) => <MessageItem key={message.id} message={message} readOnly userLabel={zh ? "用户" : "User"} attachmentAccess={{ kind: "admin", userId }} highlightTargetId={anchor === message.id ? `message-${message.id}` : undefined} />)}
      {turn.data && !turn.data.items.length ? <p className="text-sm text-secondary">{zh ? "此对话没有可读消息。" : "This conversation has no readable messages."}</p> : null}
    </div></div>
    {turn.data ? <nav aria-label={zh ? "完整轮次导航" : "Complete-turn navigation"} className="shrink-0 border-t border-ui bg-raised px-4 py-3"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2"><span className="text-xs text-secondary">{turn.data.total_messages ? `${turn.data.start_offset + 1}–${turn.data.end_offset} / ${turn.data.total_messages}` : "0"} {zh ? "条消息" : "messages"}</span><div className="flex gap-2"><button className={adminButton} disabled={turn.isFetching || !turn.data.previous_anchor_message_id} onClick={() => navigate(turn.data!.previous_anchor_message_id!)}>{zh ? "上一轮" : "Previous turn"}</button><button className={adminButton} disabled={turn.isFetching || !turn.data.next_anchor_message_id} onClick={() => navigate(turn.data!.next_anchor_message_id!)}>{zh ? "下一轮" : "Next turn"}</button></div></div></nav> : null}
  </main>;
}
