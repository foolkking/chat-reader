"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getConversation, getConversationReaderTurn, getConversations } from "../../lib/api";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";
import { MessageItem } from "../conversations/message-item";
import { usePreferences } from "../../components/preferences-provider";

export function ConversationCompare() {
  const params = useSearchParams();
  const router = useRouter();
  const leftId = params?.get("left") ?? "";
  const initialRight = params?.get("right") ?? "";
  const [rightId, setRightId] = useState(initialRight);
  const [rightDraft, setRightDraft] = useState(initialRight);
  const [activeSide, setActiveSide] = useState<"left" | "right">("left");
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);
  const candidates = useQuery({
    queryKey: ["conversation-compare-candidates", searchTerm],
    queryFn: ({ signal }) => getConversations({ q: searchTerm, statusScope: "all", limit: 20, sort: "recent_read" }, signal),
  });
  const options = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (candidates.data ?? []).filter((item) =>
      item.id !== leftId
      && (!needle || `${item.display_title} ${item.title}`.toLocaleLowerCase().includes(needle)),
    ).slice(0, 12);
  }, [candidates.data, leftId, search]);

  function applyRightId(value: string) {
    const next = value.trim();
    if (!next || next === leftId) return;
    setRightId(next);
    setRightDraft(next);
    const url = new URL(window.location.href);
    url.searchParams.set("right", next);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  return <main className="flex h-dvh min-h-0 min-w-0 flex-col bg-page text-primary">
    <header className="z-10 flex flex-wrap items-center gap-3 border-b border-ui bg-surface px-4 py-3">
      <button type="button" onClick={() => router.back()} className="min-h-10 rounded-md border border-ui px-3 text-xs">{zh ? "返回" : "Back"}</button>
      <div className="min-w-0 flex-1"><h1 className="text-base font-semibold">{zh ? "只读对照阅读" : "Read-only comparison"}</h1><p className="text-xs text-secondary">{zh ? "两侧目录、当前轮次与滚动各自独立；不会同步或写入阅读位置。" : "Each side has independent navigation, turn and scrolling. Nothing is synchronized or saved as a reading position."}</p></div>
      <div className="relative flex min-w-0 flex-1 basis-full flex-wrap gap-2 md:basis-auto md:flex-nowrap">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder={zh ? "按标题查找要对照的对话" : "Find a conversation by title"} className="min-h-10 min-w-40 flex-1 rounded-md border border-ui bg-page px-3 text-sm" aria-label={zh ? "搜索对照对话" : "Search comparison conversations"} />
        <input value={rightDraft} onChange={event => setRightDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") applyRightId(rightDraft); }} placeholder={zh ? "或粘贴对话 ID" : "Or paste a conversation ID"} className="min-h-10 min-w-32 flex-1 rounded-md border border-ui bg-page px-3 text-xs" aria-label={zh ? "对照对话 ID" : "Comparison conversation ID"} />
        <button type="button" onClick={() => applyRightId(rightDraft)} disabled={!rightDraft.trim() || rightDraft.trim() === leftId} className="min-h-10 rounded-md bg-[var(--text)] px-3 text-xs text-[var(--surface)] disabled:opacity-50">{zh ? "打开" : "Open"}</button>
        {search.trim() && options.length ? <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-ui bg-surface p-1 shadow-xl md:right-1/3">
          {options.map(item => <li key={item.id}><button type="button" onClick={() => { applyRightId(item.id); setSearch(""); }} className="min-h-10 w-full rounded px-3 text-left text-sm hover:bg-subtle"><span className="block truncate">{item.display_title || item.title}</span><span className="block text-[11px] text-secondary">{item.message_count} {zh ? "条消息" : "messages"}</span></button></li>)}
        </ul> : null}
        {search.trim() && candidates.isError ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "搜索失败，可重试或粘贴对话 ID。" : "Search failed. Retry or paste a conversation ID."}<button type="button" onClick={() => void candidates.refetch()} className="ml-1 underline">{zh ? "重试" : "Retry"}</button></p> : null}
        {searchTerm && search.trim() === searchTerm && candidates.isSuccess && !options.length ? <p role="status" className="text-xs text-secondary">{zh ? "未找到匹配的其他对话。" : "No other matching conversations."}</p> : null}
      </div>
    </header>
    {!leftId || !rightId ? <p className="m-4 rounded-lg border border-ui bg-subtle p-4 text-sm text-secondary">{zh ? "先在原对话点击“对照阅读”，再搜索或输入另一条有权限的对话。" : "Open comparison from a conversation, then find or enter another conversation you can access."}</p>
      : leftId === rightId ? <p role="alert" className="m-4 rounded-lg border border-ui bg-subtle p-4 text-sm text-secondary">{zh ? "两侧必须是不同的对话。" : "Choose two different conversations."}</p>
      : <>
        <div className="grid grid-cols-2 gap-1 border-b border-ui bg-surface p-2 md:hidden">
          <button type="button" onClick={() => setActiveSide("left")} aria-pressed={activeSide === "left"} className={`min-h-10 rounded-md text-sm ${activeSide === "left" ? "bg-subtle font-medium" : "text-secondary"}`}>{zh ? "左侧" : "Left"}</button>
          <button type="button" onClick={() => setActiveSide("right")} aria-pressed={activeSide === "right"} className={`min-h-10 rounded-md text-sm ${activeSide === "right" ? "bg-subtle font-medium" : "text-secondary"}`}>{zh ? "右侧" : "Right"}</button>
        </div>
        <div className="grid min-h-0 flex-1 gap-px overflow-hidden bg-ui md:grid-cols-2">
          <div className={activeSide === "left" ? "min-h-0" : "hidden min-h-0 md:block"}><ComparePane key={leftId} conversationId={leftId} label={zh ? "左侧对话" : "Left conversation"} zh={zh} /></div>
          <div className={activeSide === "right" ? "min-h-0" : "hidden min-h-0 md:block"}><ComparePane key={rightId} conversationId={rightId} label={zh ? "右侧对话" : "Right conversation"} zh={zh} /></div>
        </div>
      </>}
  </main>;
}

function ComparePane({ conversationId, label, zh }: { conversationId: string; label: string; zh: boolean }) {
  const conversation = useQuery({ queryKey: ["compare-conversation", conversationId], queryFn: ({ signal }) => getConversation(conversationId, signal) });
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [targetBlockId, setTargetBlockId] = useState<string | null>(null);
  const turn = useQuery({
    queryKey: ["compare-turn", conversationId, activeMessageId],
    queryFn: ({ signal }) => getConversationReaderTurn(conversationId, activeMessageId ?? undefined, signal),
    enabled: conversation.isSuccess,
  });

  useEffect(() => {
    if (!targetBlockId || !turn.data) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetBlockId)?.scrollIntoView({ block: "center", behavior: "auto" });
      setTargetBlockId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [targetBlockId, turn.data]);

  if (conversation.isPending) return <section className="min-h-0 bg-page p-4 text-sm text-secondary">{zh ? "正在加载…" : "Loading…"}</section>;
  if (conversation.isError || !conversation.data) return <section className="min-h-0 bg-page p-4 text-sm text-[var(--danger)]">{label}: {zh ? "无法读取此对话。" : "This conversation could not be read."}</section>;
  const title = conversation.data.display_title || conversation.data.title;
  const activeTurn = turn.data;
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-page" aria-label={label}>
    <header className="shrink-0 border-b border-ui px-3 py-2"><h2 className="truncate text-sm font-semibold">{title}</h2><div className="mt-2 flex min-w-0 gap-2">
      <details className="relative min-w-0 flex-1">
        <summary className="min-h-9 cursor-pointer rounded-md border border-ui px-3 py-2 text-xs text-secondary">{zh ? "对话目录" : "Dialogue index"}</summary>
        <div className="absolute left-0 top-full z-10 mt-1 max-h-[55vh] w-[min(90vw,28rem)] overflow-y-auto rounded-lg border border-ui bg-surface p-2 shadow-xl">
          <ConversationIndex conversationId={conversationId} sourceKey={`compare:${conversationId}`} mode="sheet" ready={conversation.isSuccess} onNavigate={item => setActiveMessageId(item.messageId)} />
        </div>
      </details>
      <details className="relative min-w-0 flex-1">
        <summary className="min-h-9 cursor-pointer rounded-md border border-ui px-3 py-2 text-xs text-secondary">{zh ? "章节目录" : "Sections"}</summary>
        <div className="absolute right-0 top-full z-10 mt-1 max-h-[55vh] w-[min(90vw,28rem)] overflow-y-auto rounded-lg border border-ui bg-surface p-2 shadow-xl">
          <ConversationToc conversationId={conversationId} sourceKey={`compare:${conversationId}`} activeMessageId={activeMessageId ?? activeTurn?.items[0]?.id} mode="sheet" ready={Boolean(activeTurn)} onNavigate={item => { setActiveMessageId(item.message_id); setTargetBlockId(`block-${item.message_id}-${item.block_index}`); }} />
        </div>
      </details>
    </div></header>
    <div data-reader-scroll-root="true" className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
      {turn.isPending ? <p className="text-sm text-secondary">{zh ? "正在读取完整轮次…" : "Loading complete turn…"}</p>
        : turn.isError || !activeTurn ? <div role="alert" className="rounded-lg border border-ui bg-subtle p-3 text-sm text-secondary"><p>{zh ? "无法读取该轮次。" : "This turn could not be loaded."}</p><button type="button" onClick={() => void turn.refetch()} className="mt-2 min-h-9 text-accent">{zh ? "重试" : "Retry"}</button></div>
          : <div className="mx-auto grid max-w-3xl gap-4">{activeTurn.items.map(message => <MessageItem key={`${conversationId}:${message.id}`} message={message} readOnly conversationTitle={title} highlightTargetId={targetBlockId} />)}</div>}
    </div>
    <footer className="flex shrink-0 items-center justify-between border-t border-ui bg-surface px-3 py-2 text-xs text-secondary">
      <span>{activeTurn ? (zh ? `第 ${activeTurn.start_offset + 1}–${activeTurn.end_offset} 条／共 ${activeTurn.total_messages} 条` : `Messages ${activeTurn.start_offset + 1}–${activeTurn.end_offset} of ${activeTurn.total_messages}`) : (zh ? "完整轮次" : "Complete turn")}</span>
      <div className="flex gap-2"><button type="button" disabled={!activeTurn?.previous_anchor_message_id || turn.isFetching} onClick={() => setActiveMessageId(activeTurn?.previous_anchor_message_id ?? null)} className="min-h-9 rounded border border-ui px-2 disabled:opacity-40">{zh ? "上一轮" : "Previous turn"}</button><button type="button" disabled={!activeTurn?.next_anchor_message_id || turn.isFetching} onClick={() => setActiveMessageId(activeTurn?.next_anchor_message_id ?? null)} className="min-h-9 rounded border border-ui px-2 disabled:opacity-40">{zh ? "下一轮" : "Next turn"}</button></div>
    </footer>
  </section>;
}
