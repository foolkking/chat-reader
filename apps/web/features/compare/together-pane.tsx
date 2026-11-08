"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { BookmarkPlus, ExternalLink, MessageSquareText, Search, X } from "lucide-react";
import { getConversation, getConversationReaderTurn } from "../../lib/api";
import { remoteReaderDataSource } from "../../lib/reader-data-source";
import { authenticationGeneration } from "../../lib/offline-access";
import type { MessageListItem, NavigateTarget, NavigationResult, ReadingPositionInput } from "../../lib/types";
import { ConversationIndex } from "../toc/conversation-index";
import { ConversationToc } from "../toc/conversation-toc";
import { tocNavigationTarget } from "../conversations/reader-locator-target";
import { MessageItem } from "../conversations/message-item";
import { cancelReaderPosition, navigateMountedTarget, readerPositionBusy } from "../conversations/reader-navigation";
import { acquireReaderBlockLease, type ReaderBlockLease } from "../conversations/block-virtualization";
import { captureReadingPosition } from "../conversations/reading-position-capture";
import { resolveActiveReadingTarget } from "../conversations/reader-active-position";
import { ConversationSearchPanel, type ConversationSearchPanelState } from "../search/conversation-search-panel";
import { resolveKeyboardMessage } from "../conversations/reader-keyboard-navigation";
import { readingPositionHref, targetFromReadingPosition, togetherExternalResultHref, type TogetherSnapshot } from "./together-session";

export type TogetherPaneHandle = { navigate: (target: NavigateTarget) => Promise<NavigationResult>; capture: () => ReadingPositionInput | null; focus: () => void };
export type TogetherPaneState = { messages: MessageListItem[]; messageId: string | null; title: string };
type Props = {
  conversationId: string; zh: boolean; active: boolean; snapshot?: TogetherSnapshot; paneRef: Ref<TogetherPaneHandle>;
  initialTarget?: NavigateTarget; targetSequence?: number;
  onActivate: () => boolean; onState: (id: string, state: TogetherPaneState) => void;
  onSnapshot: (id: string, snapshot: TogetherSnapshot) => void; onAnnotations: () => void;
  onOpenExternal: (href: string) => void;
};

/** The original ComparePane's independent complete-turn reader, not a second
 * ConversationReader. Navigation still uses the shared real-DOM coordinator. */
export function TogetherPane({ conversationId, zh, active, snapshot, initialTarget, targetSequence = 0, paneRef, onActivate, onState, onSnapshot, onAnnotations, onOpenExternal }: Props) {
  const client = useQueryClient();
  const conversation = useQuery({ queryKey: ["compare-conversation", conversationId], queryFn: ({ signal }) => getConversation(conversationId, signal) });
  const startingTarget = useRef(snapshot?.target ?? targetFromReadingPosition(snapshot?.position) ?? initialTarget);
  const [anchorId, setAnchorId] = useState<string | null>(startingTarget.current?.messageId ?? null);
  const [readingMessageId, setReadingMessageId] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<{ target: NavigateTarget; serial: number; messageFallback?: boolean; isCurrent?: () => boolean; resolve: (result: NavigationResult) => void } | null>(null);
  const [navigationError, setNavigationError] = useState<NavigationResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(snapshot?.searchOpen ?? false), [positionError, setPositionError] = useState(false);
  const searchState = useRef<ConversationSearchPanelState | undefined>(snapshot?.search);
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const root = useRef<HTMLDivElement>(null), serial = useRef(0), initialized = useRef(false);
  const generation = useRef(authenticationGeneration()), mounted = useRef(true), activeRef = useRef(active);
  activeRef.current = active;
  const userIntent = useRef(false), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentSequence = useRef(0), consumedIntent = useRef(0);
  const lastSaved = useRef("");
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<typeof navigation>(null);
  const turn = useQuery({
    queryKey: ["compare-turn", conversationId, anchorId],
    queryFn: ({ signal }) => getConversationReaderTurn(conversationId, anchorId ?? undefined, signal),
    enabled: conversation.isSuccess,
  });
  const latest = useRef({ messages: [] as MessageListItem[], total: 0, title: "" });
  latest.current = { messages: turn.data?.items ?? [], total: turn.data?.total_messages ?? 0, title: conversation.data?.display_title || conversation.data?.title || "" };
  const capture = useCallback(() => root.current ? captureReadingPosition(root.current, latest.current.messages, latest.current.total) : null, []);
  const cancel = useCallback(() => {
    serial.current++;
    cancelReaderPosition(root.current);
    pending.current?.resolve({ ok: false, targetId: "", reason: "cancelled" });
    pending.current = null; setNavigation(null);
    if (root.current) { delete root.current.dataset.navigationStage; root.current.dispatchEvent(new Event("chat-reader:position-released")); }
  }, []);
  const navigate = useCallback(async (target: NavigateTarget, intentIsCurrent: () => boolean = () => true): Promise<NavigationResult> => {
    cancel(); const ticket = serial.current;
    // Explicit navigation consumes earlier scrolling. A later image decode or
    // Viewer return cannot persist that old gesture as new reading progress.
    consumedIntent.current = intentSequence.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setNavigationError(null);
    if (root.current) root.current.dataset.navigationStage = "loading:together";
    const current = () => mounted.current && ticket === serial.current && generation.current === authenticationGeneration() && intentIsCurrent();
    try {
      const context = await remoteReaderDataSource.getTargetContext(conversationId, target);
      if (!current()) return { ok: false, targetId: "", reason: "cancelled" };
      const locator = context.resolvedLocator;
      if ((locator && ["STALE", "AMBIGUOUS", "NOT_FOUND"].includes(locator.status))
        || (!locator && target.messageVersionId && target.messageVersionId !== context.targetMessage?.current_version?.id)) {
        const result: NavigationResult = { ok: false, targetId: "", reason: "stale-anchor" };
        if (root.current) delete root.current.dataset.navigationStage;
        setNavigationError(result); return result;
      }
      const resolved = locator ? { ...target, messageId: locator.message_id ?? target.messageId,
        blockIndex: locator.block_index ?? undefined, characterOffset: locator.start_offset ?? undefined,
        endCharacterOffset: locator.end_offset ?? undefined } : target;
      const messageFallback = Boolean(locator && locator.block_index == null && (locator.status === "MESSAGE_ONLY" || locator.status === "REMAPPED_VERSION"))
        && (target.blockIndex !== undefined || Boolean(target.renderBlockId) || target.characterOffset !== undefined);
      if (messageFallback) { resolved.renderBlockId = undefined; resolved.alignmentOffset = 120; }
      client.setQueryData(["compare-turn", conversationId, resolved.messageId], context.readerTurn);
      setAnchorId(resolved.messageId);
      setReadingMessageId(resolved.messageId);
      return await new Promise<NavigationResult>(resolve => {
        const request = { target: resolved, serial: ticket, messageFallback, isCurrent: intentIsCurrent, resolve };
        pending.current = request; setNavigation(request);
      });
    } catch {
      const result: NavigationResult = { ok: false, targetId: "", reason: current() ? "load-failed" : "cancelled" };
      if (current()) { setNavigationError(result); if (root.current) delete root.current.dataset.navigationStage; }
      return result;
    } finally {
      // A search can retire its intent while only the remote read is pending.
      // That cancellation has no mounted navigation effect to release its flag.
      if (ticket === serial.current && root.current?.dataset.navigationStage === "loading:together") {
        delete root.current.dataset.navigationStage;
        root.current.dispatchEvent(new Event("chat-reader:position-released"));
      }
    }
  }, [cancel, client, conversationId]);
  useImperativeHandle(paneRef, () => ({ navigate, capture, focus: () => root.current?.focus({ preventScroll: true }) }), [navigate, capture]);
  useEffect(() => {
    if (!navigation || !turn.data?.items.some(item => item.id === navigation.target.messageId)) return;
    const node = root.current, { target, serial: ticket, resolve } = navigation;
    if (!node) return;
    let alive = true;
    let lease: ReaderBlockLease | null = null;
    const owns = () => alive && mounted.current && ticket === serial.current && node.isConnected && generation.current === authenticationGeneration();
    const current = () => owns() && navigation.isCurrent?.() !== false;
    node.dataset.navigationStage = "aligning:compare";
    const handBack = () => {
      delete node.dataset.navigationStage;
      node.dispatchEvent(new Event("chat-reader:position-released"));
    };
    void (async () => {
      try {
        if (target.blockIndex !== undefined) lease = await acquireReaderBlockLease(target.messageId, target.blockIndex, current);
        if (!current()) return;
        const located = await navigateMountedTarget({
          root: node, targetId: target.blockIndex === undefined ? `message-${target.messageId}` : `block-${target.messageId}-${target.blockIndex}`,
          fallbackId: `message-${target.messageId}`, allowFallback: target.allowMessageFallback,
          offset: target.alignmentOffset ?? 120, alignmentTolerance: 1, tokenIsCurrent: current,
          characterOffset: target.characterOffset, endCharacterOffset: target.endCharacterOffset,
          quote: target.quote, prefix: target.prefix, suffix: target.suffix,
        });
        if (!current()) return;
        const result = navigation.messageFallback && located.ok ? { ...located, fallback: true } : located;
        resolve(result);
        pending.current = null; setNavigation(null); setNavigationError(result.ok && !result.fallback ? null : result);
      } catch {
        if (current()) {
          const result: NavigationResult = { ok: false, targetId: "", reason: "load-failed" };
          resolve(result); pending.current = null; setNavigation(null); setNavigationError(result);
        }
      } finally {
        // Preserve the existing ordering: return actual geometry before the
        // retained virtual row can become a spacer again.
        if (owns()) {
          handBack();
          if (!current()) { resolve({ ok: false, targetId: "", reason: "cancelled" }); pending.current = null; setNavigation(null); }
        }
        lease?.release(); lease = null;
      }
    })();
    return () => {
      const owned = owns() && node.dataset.navigationStage === "aligning:compare";
      alive = false;
      if (owned) { cancelReaderPosition(node); handBack(); }
      resolve({ ok: false, targetId: "", reason: "cancelled" });
      lease?.release(); lease = null;
    };
  }, [navigation, turn.data]);
  useEffect(() => {
    if (!conversation.isSuccess || initialized.current) return;
    initialized.current = true;
    if (startingTarget.current) { void navigate(startingTarget.current); return; }
    const ticket = serial.current;
    void remoteReaderDataSource.getReadingPosition(conversationId).then(result => {
      if (!mounted.current || ticket !== serial.current || userIntent.current || generation.current !== authenticationGeneration()) return;
      const target = targetFromReadingPosition(result.position);
      if (target) void navigate(target);
    }).catch(() => { /* Reading remains available; never invent a resume point. */ });
  }, [conversation.isSuccess, conversationId, navigate]);
  const lastSequence = useRef(targetSequence);
  useEffect(() => {
    if (targetSequence === lastSequence.current) return;
    lastSequence.current = targetSequence;
    if (initialTarget) void navigate(initialTarget);
  }, [initialTarget, targetSequence, navigate]);
  useEffect(() => {
    if (!turn.data || !conversation.data) return;
    onState(conversationId, { messages: turn.data.items, messageId: readingMessageId ?? anchorId ?? turn.data.items[0]?.id ?? null,
      title: conversation.data.display_title || conversation.data.title });
  }, [conversationId, conversation.data, turn.data, anchorId, readingMessageId, onState]);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    return () => {
      const position = captureReadingPosition(node, latest.current.messages, latest.current.total);
      onSnapshot(conversationId, { position, title: latest.current.title, search: searchState.current, searchOpen: searchOpenRef.current });
    };
  }, [conversation.isSuccess, conversationId, onSnapshot]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; serial.current++; pending.current?.resolve({ ok: false, targetId: "", reason: "cancelled" }); cancelReaderPosition(root.current); if (saveTimer.current) clearTimeout(saveTimer.current); if (activeTimer.current) clearTimeout(activeTimer.current); };
  }, []);
  useEffect(() => {
    if (!active) { consumedIntent.current = intentSequence.current; if (saveTimer.current) clearTimeout(saveTimer.current); }
  }, [active]);
  useEffect(() => {
    const open = () => { if (activeRef.current) setSearchOpen(true); };
    window.addEventListener("chat-reader:open-reader-search", open);
    return () => window.removeEventListener("chat-reader:open-reader-search", open);
  }, []);
  const positionBusy = () => {
    const node = root.current;
    return !node || readerPositionBusy(node) || Boolean(node.dataset.navigationStage)
      || ["readerGeometryCompensating", "readerLayoutCompensating", "readerSurfaceCompensating", "readerViewerLocked"]
        .some(key => node.dataset[key] === "true");
  };
  const intent = () => {
    if (root.current?.dataset.readerViewerLocked === "true") return;
    onActivate(); userIntent.current = true; cancel(); intentSequence.current++; setNavigationError(null);
  };
  const remember = () => {
    if (!activeTimer.current) activeTimer.current = setTimeout(() => {
      activeTimer.current = null;
      if (!mounted.current || !root.current || positionBusy()) return;
      const target = resolveActiveReadingTarget(root.current, 120);
      if (target?.messageId) setReadingMessageId(target.messageId);
    }, 80);
    if (!activeRef.current || intentSequence.current <= consumedIntent.current || positionBusy()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!activeRef.current || !mounted.current || positionBusy() || generation.current !== authenticationGeneration()
        || intentSequence.current <= consumedIntent.current) return;
      const position = capture();
      if (!position) return;
      // Claim this gesture before the promise resolves; never replay an
      // unconfirmed write because another programmatic scroll event arrives.
      consumedIntent.current = intentSequence.current;
      const signature = JSON.stringify(position);
      if (signature === lastSaved.current) return;
      const current = () => mounted.current && generation.current === authenticationGeneration();
      void remoteReaderDataSource.saveReadingPosition(conversationId, position).then(() => {
        if (current()) { lastSaved.current = signature; setPositionError(false); }
      }, () => { if (current()) setPositionError(true); });
    }, 1000);
  };
  const bookmark = () => {
    const position = capture();
    // The owning workspace follows the active pane on this event's commit.
    if (position?.message_id) requestAnimationFrame(() => {
      if (mounted.current && generation.current === authenticationGeneration()) window.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", { detail: { conversationId, messageId: position.message_id, position } }));
    });
  };
  if (conversation.isPending) return <section className="p-4 text-sm text-secondary">{zh ? "正在读取对话…" : "Loading conversation…"}</section>;
  if (conversation.isError) return <section role="alert" className="p-4 text-sm">{zh ? "无法读取此对话。" : "Conversation unavailable."}<button type="button" className="min-h-11 px-2 underline" onClick={() => void conversation.refetch()}>{zh ? "重试本侧" : "Retry this pane"}</button></section>;
  const title = latest.current.title, data = turn.data;
  const iconClass = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle";
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-page" aria-label={title} data-together-pane={conversationId} data-pane-active={active}
    onPointerDownCapture={event => { if (!onActivate()) { event.preventDefault(); event.stopPropagation(); } }}
    onClickCapture={event => { if (!onActivate()) { event.preventDefault(); event.stopPropagation(); } }}
    onFocusCapture={event => { if (!onActivate()) event.stopPropagation(); }}>
    <header className="shrink-0 border-b border-ui px-3 py-2">
      <div className="flex items-center gap-1"><h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>{title}</h2>
        <button type="button" className={iconClass} aria-label={zh ? "搜索当前对话" : "Search this conversation"} onClick={() => setSearchOpen(value => !value)}><Search className="h-[18px] w-[18px]" /></button>
        <button type="button" className={iconClass} aria-label={zh ? "保存当前位置" : "Save reading position"} onClick={bookmark}><BookmarkPlus className="h-[18px] w-[18px]" /></button>
        <button type="button" className={iconClass} aria-label={zh ? "批注与书签" : "Annotations and bookmarks"} onClick={onAnnotations}><MessageSquareText className="h-[18px] w-[18px]" /></button>
        <a href={readingPositionHref(conversationId, snapshot?.position ?? null)} onClick={event => {
          const href = readingPositionHref(conversationId, capture()); event.currentTarget.href = href;
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenExternal(href); }
        }}
          onAuxClick={event => { event.currentTarget.href = readingPositionHref(conversationId, capture()); }}
          className={iconClass} aria-label={zh ? "单独打开此对话" : "Open conversation alone"}><ExternalLink className="h-[18px] w-[18px]" /></a>
      </div>
      <div className="flex min-w-0 gap-2">
        <details className="relative min-w-0 flex-1"><summary className="min-h-11 cursor-pointer px-2 py-3 text-xs text-secondary">{zh ? "对话目录" : "Dialogue index"}</summary><div className="absolute left-0 top-full z-30 max-h-[55svh] w-[min(85vw,24rem)] overflow-auto rounded-lg border border-ui bg-raised p-2 shadow-sm">
          <ConversationIndex conversationId={conversationId} sourceKey={`compare:${conversationId}`} mode="sheet" ready onNavigate={item => void navigate({ messageId: item.messageId, source: "dialogue-index" })} />
        </div></details>
        <details className="relative min-w-0 flex-1"><summary className="min-h-11 cursor-pointer px-2 py-3 text-xs text-secondary">{zh ? "章节目录" : "Sections"}</summary><div className="absolute right-0 top-full z-30 max-h-[55svh] w-[min(85vw,24rem)] overflow-auto rounded-lg border border-ui bg-raised p-2 shadow-sm">
          <ConversationToc conversationId={conversationId} sourceKey={`compare:${conversationId}`} activeMessageId={readingMessageId ?? anchorId ?? data?.items[0]?.id} mode="sheet" ready={Boolean(data)} onNavigate={item => void navigate(tocNavigationTarget(item))} />
        </div></details>
      </div>
    </header>
    {searchOpen ? <div className="max-h-[45svh] shrink-0 overflow-auto border-b border-ui"><ConversationSearchPanel conversationId={conversationId} sourceKey={`together:${conversationId}`} initialState={searchState.current} onStateChange={state => { searchState.current = state; }}
      externalResultHref={target => togetherExternalResultHref(conversationId, target)} onOpenExternal={onOpenExternal}
      onClose={() => { cancel(); setSearchOpen(false); }} onNavigate={async (target, _context, isCurrent) => target.messageId ? navigate({ ...target, annotationId: target.annotationId ?? undefined, messageId: target.messageId, source: "search", allowMessageFallback: true }, isCurrent) : { ok: false, targetId: "", reason: "block-not-found" }} /></div> : null}
    {navigationError ? <div role="alert" className="flex items-center px-3 text-xs text-secondary"><span className="flex-1">{zh ? "未能精确定位，正文仍保留。可从目录重新选择位置。" : "Exact location unavailable. Content is preserved; choose a location from the index."}</span><button type="button" className={iconClass} aria-label={zh ? "关闭提示" : "Dismiss"} onClick={() => setNavigationError(null)}><X className="h-4 w-4" /></button></div> : null}
    {positionError ? <p role="status" className="px-3 text-xs text-secondary">{zh ? "阅读位置尚未保存；请使用书签保留重要位置。" : "Reading position not saved; bookmark important places."}</p> : null}
    <div ref={root} tabIndex={0} data-reader-scroll-root="true" onWheelCapture={intent} onTouchStartCapture={intent}
      onPointerDownCapture={event => {
        if (event.target === event.currentTarget) intent();
        else if (root.current?.dataset.readerViewerLocked !== "true") {
          // A selection/click supersedes a pending remote navigation, but is
          // not itself evidence of reading progress.
          userIntent.current = true; consumedIntent.current = intentSequence.current;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          cancel();
        }
      }}
      onScroll={remember} onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || (event.target instanceof Element && event.target.closest("input,textarea,button,a,select,[contenteditable=true]"))) return;
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "j", "k"].includes(event.key)) intent();
        const key = event.key === "Home" ? "home" : event.key === "End" ? "end" : event.key;
        if (["home", "end", "j", "k"].includes(key)) {
          event.preventDefault();
          const ticket = serial.current;
          void resolveKeyboardMessage(key as "home" | "end" | "j" | "k", capture()?.message_id ?? anchorId,
            options => remoteReaderDataSource.getDialogueIndex(conversationId, options)).then(id => {
              if (id && mounted.current && ticket === serial.current && generation.current === authenticationGeneration()) void navigate({ messageId: id, source: "message-action" });
            }).catch(() => { if (mounted.current && ticket === serial.current) setNavigationError({ ok: false, targetId: "", reason: "load-failed" }); });
        }
      }} className="reader-aux-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 outline-none sm:px-5 [overflow-anchor:none]">
      {turn.isPending ? <p className="text-sm text-secondary">{zh ? "正在读取完整轮次…" : "Loading complete turn…"}</p> : turn.isError || !data
        ? <button type="button" className="min-h-11 px-3 text-sm" onClick={() => void turn.refetch()}>{zh ? "读取失败，重试本轮" : "Load failed. Retry turn"}</button>
        : <div className="mx-auto grid max-w-3xl gap-4">{data.items.map(message => <MessageItem key={`${conversationId}:${message.id}`} message={message} readOnly allowCopySelection attachmentAccess={{ kind: "owner", readOnly: true }} conversationTitle={title} />)}</div>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-t border-ui px-3 py-1 text-xs text-secondary">
      <span>{data ? `${data.start_offset + 1}–${data.end_offset} / ${data.total_messages}` : ""}</span>
      <div className="flex gap-1"><button type="button" disabled={!data?.previous_anchor_message_id || turn.isFetching} className="min-h-11 rounded px-2 hover:bg-subtle disabled:opacity-40" onClick={() => { if (data?.previous_anchor_message_id) void navigate({ messageId: data.previous_anchor_message_id, source: "message-action" }); }}>{zh ? "上一轮" : "Previous turn"}</button>
        <button type="button" disabled={!data?.next_anchor_message_id || turn.isFetching} className="min-h-11 rounded px-2 hover:bg-subtle disabled:opacity-40" onClick={() => { if (data?.next_anchor_message_id) void navigate({ messageId: data.next_anchor_message_id, source: "message-action" }); }}>{zh ? "下一轮" : "Next turn"}</button></div>
    </footer>
  </section>;
}
