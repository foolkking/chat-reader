"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { Copy, Link2, Pencil, RefreshCw, Search } from "lucide-react";
import { getMyShares, revokeShares } from "../lib/api";
import type { OwnedShareRead, ShareBatchResult } from "../lib/types";
import { ShareStatusDetails } from "../features/sharing/share-status-details";
import { ShareEditor } from "../features/sharing/share-editor";
import { ShareActionsMenu } from "../features/sharing/share-actions-menu";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

export function MySharesPanel({ onDirtyChange, onOpenConversation }: { onDirtyChange: (dirty: boolean) => void; onOpenConversation: (id: string) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog(), client = useQueryClient();
  const [search, setSearch] = useState(""), [q, setQuery] = useState(""), [status, setStatus] = useState("all"), [offset, setOffset] = useState(0);
  const [conversation, setConversation] = useState<{ id: string; title: string } | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({}), [editing, setEditing] = useState<OwnedShareRead | null>(null);
  const [busy, setBusy] = useState(false), [online, setOnline] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<Array<ShareBatchResult & { title: string }>>([]);
  const root = useRef<HTMLDivElement>(null), restore = useRef<{ id: string; scroll: number } | null>(null);
  const shares = useQuery({ queryKey: ["my-shares", q, status, conversation?.id, offset], queryFn: () => getMyShares({ q, status, conversationId: conversation?.id, offset }), retry: false, enabled: online });
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useLayoutEffect(() => { if (!editing) onDirtyChange(busy); }, [busy, editing, onDirtyChange]);
  useEffect(() => {
    if (!editing && restore.current) {
      const { id, scroll } = restore.current;
      const control = root.current?.querySelector<HTMLElement>(`[data-share-edit="${id}"]`) ?? root.current?.querySelector<HTMLInputElement>("input");
      control?.focus({ preventScroll: true });
      if (root.current?.parentElement) root.current.parentElement.scrollTop = scroll;
      restore.current = null;
    }
  }, [editing]);

  function resetSelection() { setOffset(0); setSelected({}); setResults([]); setNotice(null); }
  async function revoke(ids: string[], names = selected) {
    if (!ids.length || busy) return;
    if (!await confirm({ title: zh ? `撤销 ${ids.length} 个分享？` : `Revoke ${ids.length} shares?`, description: zh ? "这些链接将立即停止访问。此操作不能撤销，对话原文会保留。" : "These links will stop working immediately. Revocation cannot be undone; source conversations remain.", confirmLabel: zh ? "撤销分享" : "Revoke shares", danger: true })) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await revokeShares(ids);
      const completed = new Set(response.results.filter((item) => item.status === "revoked").map((item) => item.share_id));
      setSelected((value) => Object.fromEntries(Object.entries(value).filter(([id]) => !completed.has(id))));
      setResults(response.results.map((item) => ({ ...item, title: names[item.share_id] || (zh ? "分享链接" : "Share link") })));
      setNotice(zh ? `已撤销 ${completed.size} 个分享。` : `${completed.size} shares revoked.`);
      await Promise.all([client.invalidateQueries({ queryKey: ["my-shares"] }), client.invalidateQueries({ queryKey: ["shares"] })]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : (zh ? "撤销失败，选择已保留。" : "Revoke failed. Your selection is retained.")); }
    finally { setBusy(false); }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setNotice(zh ? "链接已复制。" : "Link copied."); }
    catch { setError(zh ? "复制失败，请打开链接后从地址栏复制。" : "Copy failed. Open the link and copy it from the address bar."); }
  }
  const ids = Object.keys(selected), pageItems = shares.data?.items ?? [];
  const failed = results.filter((item) => item.status !== "revoked");
  if (editing) return <div ref={root}><ShareEditor key={editing.id} share={editing} onDirtyChange={onDirtyChange} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice(zh ? "分享设置已保存，原链接保持不变。" : "Share settings saved. The existing link is unchanged."); }} /></div>;
  return <div ref={root} className="grid min-w-0 gap-4" aria-busy={busy}>
    {!online ? <p role="status" className="rounded-lg bg-subtle p-3 text-sm text-secondary">{zh ? "分享管理需要联网。请连接后刷新。" : "Share management requires a connection. Reconnect and refresh."}</p> : null}
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search); resetSelection(); }}>
      <label className="relative min-w-0 flex-1"><span className="sr-only">{zh ? "按对话或分享标题搜索" : "Search conversation or share title"}</span><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-secondary" /><input className="min-h-11 w-full rounded-lg border border-ui bg-surface pl-9 pr-3 text-base text-primary sm:text-sm" placeholder={zh ? "搜索对话或分享标题" : "Search by conversation or title"} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={200} disabled={busy} /></label>
      <button type="submit" className="btn-secondary min-h-11 px-4 text-sm" disabled={busy || !online}>{zh ? "搜索" : "Search"}</button>
    </form>
    <div role="group" aria-label={zh ? "分享状态" : "Share status"} className="flex border-b border-ui">
      {(["all", "active", "expired", "revoked"] as const).map((value, index) => <button key={value} type="button" aria-pressed={status === value} className={`min-h-11 flex-1 border-b-2 px-2 text-sm ${status === value ? "border-[var(--text)] font-semibold text-primary" : "border-transparent text-secondary hover:bg-subtle"}`} disabled={busy} onClick={() => { setStatus(value); resetSelection(); }}>{(zh ? ["全部", "有效", "已过期", "已撤销"] : ["All", "Active", "Expired", "Revoked"])[index]}</button>)}
    </div>
    {conversation ? <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-subtle px-3 text-sm text-secondary"><span className="truncate">{conversation.title}</span><button type="button" disabled={busy} className="btn-ghost min-h-11 shrink-0 px-2 text-xs" onClick={() => { setConversation(null); resetSelection(); }}>{zh ? "查看全部对话" : "All conversations"}</button></div> : null}
    <div className="flex items-center justify-between gap-2 text-xs text-secondary">
      <span>{shares.data ? (zh ? `共 ${shares.data.total} 个分享` : `${shares.data.total} shares`) : (zh ? "分享链接" : "Share links")}</span>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-ghost min-h-11 px-3 text-xs" aria-pressed={selecting} disabled={busy} onClick={() => { setSelecting((value) => !value); setSelected({}); }}>{selecting ? (zh ? "完成选择" : "Done selecting") : (zh ? "批量管理" : "Manage multiple")}</button>
        <button type="button" aria-label={zh ? "刷新" : "Refresh"} title={zh ? "刷新" : "Refresh"} className="btn-ghost flex h-11 w-11 items-center justify-center" disabled={shares.isFetching || busy || !online} onClick={() => void shares.refetch()}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${shares.isFetching ? "motion-safe:animate-spin" : ""}`} /></button>
      </div>
    </div>
    {shares.isPending && online ? <p role="status" className="text-sm text-secondary">{zh ? "正在加载分享…" : "Loading shares…"}</p> : null}
    {shares.isError ? <p role="alert" className="break-words text-sm text-[var(--danger)]">{zh ? "无法读取分享列表，请刷新重试。" : "Unable to load shares. Refresh to retry."}</p> : null}
    {notice ? <p role="status" className="rounded-lg bg-subtle px-3 py-2 text-sm text-primary">{notice}</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-[var(--danger)]">{error}</p> : null}
    {failed.length ? <div role="alert" className="grid gap-2 border-y border-ui py-3 text-sm text-primary"><p>{zh ? `${failed.length} 项未完成，其他项已撤销。` : `${failed.length} items incomplete; other items were revoked.`}</p>{failed.map((item) => <div key={item.share_id} className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-words">{item.title} · {item.status === "not_found" ? (zh ? "已不存在或不可访问" : "Missing or inaccessible") : (zh ? "操作失败" : "Failed")}</span><button type="button" className="btn-secondary min-h-11 shrink-0 px-3 text-xs" disabled={busy || !online} onClick={() => void revoke([item.share_id], { [item.share_id]: item.title })}>{zh ? "重试此项" : "Retry item"}</button></div>)}</div> : null}
    {selecting ? <div className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle p-2 text-xs">
      <button type="button" className="btn-ghost min-h-11 px-3" disabled={!pageItems.some((item) => item.status !== "revoked" && !(item.id in selected)) || ids.length >= 100 || busy || !online} onClick={() => setSelected((value) => { const next = { ...value }; for (const item of pageItems) if (item.status !== "revoked" && Object.keys(next).length < 100) next[item.id] = item.title || item.conversation_title; return next; })}>{zh ? "选择本页可撤销项" : "Select revocable on this page"}</button>
      <button type="button" className="btn-ghost min-h-11 px-3" disabled={!ids.length || busy} onClick={() => setSelected({})}>{zh ? "清空选择" : "Clear selection"}</button>
    </div> : null}
    {!shares.isPending && !shares.isError && !pageItems.length ? <div className="grid justify-items-center gap-2 py-8 text-center">
      <Link2 aria-hidden="true" className="mb-1 h-6 w-6 text-secondary" />
      <p className="text-sm font-medium text-primary">{zh ? (q || status !== "all" || conversation ? "没有符合条件的分享" : "还没有分享链接") : (q || status !== "all" || conversation ? "No matching shares" : "No share links yet")}</p>
      <p className="text-sm text-secondary">{zh ? (q || status !== "all" || conversation ? "试试其他标题，或清除筛选。" : "在对话中选择“分享”，创建第一个链接。") : (q || status !== "all" || conversation ? "Try another title or clear your filters." : "Choose Share in a conversation to create your first link.")}</p>
      {q || status !== "all" || conversation ? <button type="button" className="btn-secondary mt-2 min-h-11 px-4 text-sm" onClick={() => { setSearch(""); setQuery(""); setStatus("all"); setConversation(null); resetSelection(); }}>{zh ? "清除筛选" : "Clear filters"}</button> : null}
    </div> : null}
    <div className="divide-y divide-[var(--border)]">{pageItems.map((share) => <article key={share.id} aria-label={share.title || share.conversation_title} className={`grid min-w-0 gap-3 py-4 ${share.id in selected ? "bg-subtle" : ""}`}>
      <div className="flex min-w-0 items-start gap-2">
        {selecting ? <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"><input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" aria-label={zh ? `选择 ${share.title || share.conversation_title}` : `Select ${share.title || share.conversation_title}`} checked={share.id in selected} disabled={busy || !online || share.status === "revoked" || (!selected[share.id] && ids.length >= 100)} onChange={(e) => setSelected((value) => { const next = { ...value }; if (e.target.checked) next[share.id] = share.title || share.conversation_title; else delete next[share.id]; return next; })} /></label> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-sm font-semibold leading-6 text-primary">{share.title || share.conversation_title}</h3><ShareStatusDetails share={share} locale={resolvedLocale} /></div>
        </div>
      </div>
      {!selecting ? <div className="flex items-center gap-1">
        {share.share_url ? <button type="button" className="btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-xs" onClick={() => void copy(share.share_url!)}><Copy aria-hidden="true" className="h-4 w-4" />{zh ? "复制链接" : "Copy link"}</button> : null}
        <button type="button" data-share-edit={share.id} className="btn-ghost inline-flex min-h-11 items-center gap-2 px-3 text-xs" disabled={busy || !online || share.status === "revoked" || share.conversation_deleted} onClick={() => { restore.current = { id: share.id, scroll: root.current?.parentElement?.scrollTop ?? 0 }; setEditing(share); }}><Pencil aria-hidden="true" className="h-4 w-4" />{zh ? "编辑分享" : "Edit share"}</button>
        <div className="ml-auto"><ShareActionsMenu share={share} zh={zh} busy={busy} online={online} onSource={() => onOpenConversation(share.conversation_id)} onFilter={() => { setConversation({ id: share.conversation_id, title: share.conversation_title }); resetSelection(); }} onRevoke={() => void revoke([share.id], { [share.id]: share.title || share.conversation_title })} /></div>
      </div> : null}
      {!share.share_url ? <p className="text-xs text-secondary">{zh ? "旧链接地址不可恢复，仍可管理或撤销。" : "This older URL is unavailable; its share can still be managed or revoked."}</p> : null}
    </article>)}</div>
    <div className="flex items-center justify-between gap-2 border-t border-ui pt-3"><button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={!offset || busy || shares.isFetching} onClick={() => setOffset((v) => Math.max(0, v - 20))}>{zh ? "上一页" : "Previous page"}</button><span className="text-xs text-secondary">{shares.data ? (zh ? `第 ${Math.floor(offset / 20) + 1} 页 · 共 ${shares.data.total} 项` : `Page ${Math.floor(offset / 20) + 1} · ${shares.data.total} total`) : "—"}</span><button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={!shares.data?.has_more || busy || shares.isFetching} onClick={() => setOffset((v) => v + 20)}>{zh ? "下一页" : "Next page"}</button></div>
    {selecting ? <div className="sticky -bottom-5 grid gap-2 border-t border-ui bg-raised py-3"><p role="status" className="text-xs text-secondary">{zh ? `已选 ${ids.length} 项（跨页保留，上限 100）` : `${ids.length} selected across pages (up to 100)`}</p><button type="button" className="btn-danger min-h-11 w-full border border-ui px-4 text-sm disabled:opacity-60" disabled={!ids.length || busy || !online} onClick={() => void revoke(ids)}>{busy ? (zh ? "正在撤销…" : "Revoking…") : (zh ? `撤销所选 ${ids.length} 项` : `Revoke ${ids.length} selected`)}</button></div> : null}
  </div>;
}
