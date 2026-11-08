"use client";

import { createRef, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { getConversation } from "../../lib/api";
import { ArrowLeft, Plus, X } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";
import { AnnotationWorkspace, type AnnotationLeaveGuard } from "../annotations/annotation-workspace";
import { remoteAnnotationRepository } from "../../lib/annotation-repository";
import { TogetherChooser, type TogetherChoice } from "./together-chooser";
import { TogetherPane, type TogetherPaneHandle, type TogetherPaneState } from "./together-pane";
import { togetherTarget, TOGETHER_MAX_TABS, TOGETHER_MIN_PANE, type TogetherSnapshot } from "./together-session";
import type { NavigateTarget } from "../../lib/types";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";

type Tab = { id: string; title?: string; target?: NavigateTarget; sequence: number };
const GUTTER = 12;
const subscribeIdentity = (listener: () => void) => {
  window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, listener);
};
export function ConversationCompare() {
  const generation = useSyncExternalStore(subscribeIdentity, authenticationGeneration, () => 0);
  return <TogetherWorkspace key={generation} />;
}
function TogetherWorkspace() {
  const params = new URLSearchParams(useSearchParams()?.toString() ?? ""), router = useRouter(), zh = usePreferences().resolvedLocale === "zh-CN";
  const initial = useRef([...new Set([params.get("left"), params.get("right")].filter((id): id is string => Boolean(id)))].slice(0, TOGETHER_MAX_TABS));
  const [tabs, setTabs] = useState<Tab[]>(() => initial.current.map(id => ({ id, sequence: 0, target: togetherTarget(params.get(id === params.get("right") ? "rightHref" : "leftHref") ?? "") })));
  const [visible, setVisible] = useState<string[]>(initial.current.slice(0, 2));
  const initialAnnotation = useRef(tabs.find(tab => tab.target?.annotationId));
  const [activeId, setActiveId] = useState(initialAnnotation.current?.id ?? initial.current[0] ?? "");
  const [choosing, setChoosing] = useState(params.has("choose") || initial.current.length < 2);
  const [annotationsOpen, setAnnotationsOpen] = useState(Boolean(initialAnnotation.current));
  const [annotationTarget, setAnnotationTarget] = useState<{ conversationId: string; id: string } | null>(() => initialAnnotation.current?.target?.annotationId
    ? { conversationId: initialAnnotation.current.id, id: initialAnnotation.current.target.annotationId } : null);
  const [paneStates, setPaneStates] = useState<Record<string, TogetherPaneState>>({});
  const [width, setWidth] = useState(0), [fraction, setFraction] = useState(.5);
  const [notice, setNotice] = useState("");
  const leaveGuard = useRef<AnnotationLeaveGuard | null>(null);
  const focusAfterLeave = useRef(false);
  const leaving = useRef(false), mounted = useRef(true), active = useRef(activeId);
  active.current = activeId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function beforeLeaving(action: () => void): boolean {
    if (leaving.current) return false;
    const guard = leaveGuard.current;
    if (!guard?.needsConfirmation()) { action(); return true; }
    leaving.current = true;
    const owner = activeId;
    void guard.confirm().then(allowed => {
      if (allowed && mounted.current && active.current === owner) { focusAfterLeave.current = true; action(); }
    }).catch(() => { /* A failed confirmation cannot authorize leaving. */ }).finally(() => { leaving.current = false; });
    return false;
  }
  const titles = useQueries({ queries: tabs.map(tab => ({
    queryKey: ["compare-conversation", tab.id],
    queryFn: ({ signal }: { signal: AbortSignal }) => getConversation(tab.id, signal),
  })) });
  const body = useRef<HTMLDivElement>(null), snapshots = useRef(new Map<string, TogetherSnapshot>());
  const handles = useRef(new Map<string, ReturnType<typeof createRef<TogetherPaneHandle>>>());
  useLayoutEffect(() => {
    if (!focusAfterLeave.current) return;
    focusAfterLeave.current = false;
    handles.current.get(activeId)?.current?.focus();
  }, [activeId]);
  const closed = useRef(new Set<string>());
  const snapshot = useCallback((id: string, value: TogetherSnapshot) => { if (!closed.current.has(id)) snapshots.current.set(id, value); }, []);
  const receive = useCallback((id: string, value: TogetherPaneState) => {
    setPaneStates(current => ({ ...current, [id]: value }));
    setTabs(current => current.map(tab => tab.id === id && tab.title !== value.title ? { ...tab, title: value.title } : tab));
  }, []);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node); setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const open = () => setChoosing(true);
    window.addEventListener("chat-reader:open-together", open);
    return () => window.removeEventListener("chat-reader:open-together", open);
  }, []);
  const split = visible.length === 2 && width >= TOGETHER_MIN_PANE * 2 + GUTTER;
  const minimum = Math.min(.5, TOGETHER_MIN_PANE / Math.max(1, width - GUTTER));
  const ratio = Math.max(minimum, Math.min(1 - minimum, fraction));
  const mountedIds = split ? visible : (activeId ? [activeId] : []);
  function activate(id: string) {
    if (id === activeId) return !leaving.current;
    const allowed = beforeLeaving(() => {
      setActiveId(id);
      setVisible(current => current.includes(id) ? current : current.length < 2 ? [...current, id] : current.map(value => value === activeId ? id : value));
    });
    // A keyboard focus in the other pane must not become the confirmation's
    // return target: cancelling would focus it and immediately ask again.
    if (!allowed && !document.querySelector('[role="dialog"][aria-modal="true"]')) handles.current.get(activeId)?.current?.focus();
    return allowed;
  }
  function choose(choice: TogetherChoice, approved = false) {
    if (leaving.current && !approved) return;
    if (!approved) { beforeLeaving(() => choose(choice, true)); return; }
    const existing = tabs.find(tab => tab.id === choice.conversationId);
    if (!existing && tabs.length >= TOGETHER_MAX_TABS) { setNotice(zh ? "最多打开 8 个对话，请先关闭一个标签。" : "Up to 8 conversations. Close a tab before opening another."); return; }
    closed.current.delete(choice.conversationId);
    const target = togetherTarget(choice.href);
    if (target?.annotationId) { setAnnotationTarget({ conversationId: choice.conversationId, id: target.annotationId }); setAnnotationsOpen(true); }
    if (target) snapshots.current.delete(choice.conversationId);
    setTabs(current => existing ? current.map(tab => tab.id === choice.conversationId ? { ...tab, ...(target ? { target, sequence: tab.sequence + 1 } : {}) } : tab)
      : [...current, { id: choice.conversationId, title: choice.title, target, sequence: 0 }]);
    if (!visible.includes(choice.conversationId)) setVisible(current => current.length < 2 ? [...current, choice.conversationId]
      : current.map(id => id !== activeId ? choice.conversationId : id));
    setActiveId(choice.conversationId); setChoosing(false); setNotice("");
  }
  function closeTab(id: string, approved = false) {
    if (leaving.current && !approved) return;
    if (id === activeId && !approved) { beforeLeaving(() => closeTab(id, true)); return; }
    closed.current.add(id);
    snapshots.current.delete(id);
    setPaneStates(current => { const next = { ...current }; delete next[id]; return next; });
    if (annotationTarget?.conversationId === id) setAnnotationTarget(null);
    const next = tabs.filter(tab => tab.id !== id);
    const remaining = visible.filter(value => value !== id);
    const replacement = next.find(tab => !remaining.includes(tab.id));
    if (visible.includes(id) && replacement && remaining.length < 2) remaining.push(replacement.id);
    setTabs(next); setVisible(remaining);
    if (activeId === id) setActiveId(remaining[0] ?? next[0]?.id ?? "");
    handles.current.delete(id);
  }
  const activeState = paneStates[activeId];
  const closeWorkspace = () => beforeLeaving(() => {
    const origin = params.get("returnTo");
    if (origin?.startsWith("/conversations/") && !origin.includes("\\") && !origin.includes("\n")) router.push(origin);
    else if (initial.current[0]) router.push(`/conversations/${initial.current[0]}`);
    else router.push("/");
  });
  return <main className="flex h-dvh min-h-0 min-w-0 flex-col bg-page text-primary">
    <header className="flex flex-wrap items-center gap-2 border-b border-ui bg-surface px-3 py-2">
      <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-secondary hover:bg-subtle" onClick={closeWorkspace}><ArrowLeft className="h-[18px] w-[18px]" />{zh ? "返回阅读" : "Back to reading"}</button>
      <h1 className="min-w-0 flex-1 text-sm font-semibold">{zh ? "一起阅读" : "Read together"}</h1>
      <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-secondary hover:bg-subtle" title="Alt+Shift+O" onClick={() => setChoosing(true)}><Plus className="h-[18px] w-[18px]" />{zh ? "打开另一对话" : "Open another"}</button>
    </header>
    <nav aria-label={zh ? "已打开的对话" : "Open conversations"} className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ui bg-surface px-2">
      {tabs.map((tab, index) => <div key={tab.id} className={`flex shrink-0 items-center border-b-2 ${tab.id === activeId ? "border-[var(--accent)]" : "border-transparent"}`}>
        <button type="button" aria-current={tab.id === activeId ? "page" : undefined} className="min-h-11 max-w-56 truncate px-3 text-sm text-secondary hover:text-primary" onClick={() => activate(tab.id)}>{titles[index]?.data?.display_title || titles[index]?.data?.title || paneStates[tab.id]?.title || tab.title || (zh ? "读取对话…" : "Loading conversation…")}</button>
        <button type="button" className="inline-flex h-11 w-11 items-center justify-center text-secondary hover:bg-subtle" aria-label={`${zh ? "关闭对话" : "Close conversation"} ${paneStates[tab.id]?.title || tab.title || ""}`} onClick={() => closeTab(tab.id)}><X className="h-4 w-4" /></button>
      </div>)}
    </nav>
    {notice && !choosing ? <p role="status" className="px-4 py-2 text-xs text-secondary">{notice}</p> : null}
    <div ref={body} className="relative grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: split ? `minmax(0, ${ratio}fr) ${GUTTER}px minmax(0, ${1 - ratio}fr)` : "minmax(0, 1fr)" }}>
      {!tabs.length ? <div className="p-6 text-sm text-secondary">{zh ? "搜索要一起阅读的对话，阅读位置和正文滚动相互独立。" : "Find conversations to read together. Each keeps its own position and scrolling."}</div> : null}
      {mountedIds.flatMap((id, index) => {
        const tab = tabs.find(item => item.id === id);
        if (!tab) return [];
        if (!handles.current.has(id)) handles.current.set(id, createRef<TogetherPaneHandle>());
        const pane = <div key={id} className="min-h-0 min-w-0 overflow-hidden"><TogetherPane conversationId={id} zh={zh} active={activeId === id} snapshot={snapshots.current.get(id)} initialTarget={tab.target} targetSequence={tab.sequence} paneRef={handles.current.get(id)!}
          onActivate={() => activate(id)} onState={receive} onSnapshot={snapshot} onAnnotations={() => { if (activate(id)) setAnnotationsOpen(true); }}
          onOpenExternal={href => beforeLeaving(() => router.push(href))} /></div>;
        if (!split || index === 0) return [pane];
        return [<div key="divider" className="relative border-x border-ui bg-subtle"><button type="button" role="separator" aria-label={zh ? "调整阅读栏宽度" : "Resize reading panes"} aria-orientation="vertical" aria-valuemin={Math.round(minimum * 100)} aria-valuemax={Math.round((1 - minimum) * 100)} aria-valuenow={Math.round(ratio * 100)}
          className="absolute inset-y-0 left-1/2 z-20 w-11 -translate-x-1/2 cursor-col-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
          onDoubleClick={() => setFraction(.5)} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId) || !body.current) return; const bounds = body.current.getBoundingClientRect(); setFraction(Math.max(minimum, Math.min(1 - minimum, (event.clientX - bounds.left - GUTTER / 2) / (bounds.width - GUTTER)))); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); setFraction(event.key === "Home" ? .5 : Math.max(minimum, Math.min(1 - minimum, ratio + (event.key === "ArrowLeft" ? -.025 : .025)))); } }} /></div>, pane];
      })}
    </div>
    {activeState && activeId ? <AnnotationWorkspace leaveGuardRef={leaveGuard} conversationId={activeId} messages={activeState.messages} activeMessageId={activeState.messageId} initialAnnotationId={annotationTarget?.conversationId === activeId ? annotationTarget.id : undefined} repository={remoteAnnotationRepository} open={annotationsOpen} onOpenChange={setAnnotationsOpen}
      onNavigate={target => handles.current.get(activeId)?.current?.navigate(target) ?? { ok: false, targetId: "", reason: "target-not-mounted" }} /> : null}
    <TogetherChooser open={choosing} onClose={() => setChoosing(false)} onChoose={choose} openedIds={tabs.map(tab => tab.id)} notice={notice} onOpenExternal={href => beforeLeaving(() => router.push(href))} />
  </main>;
}
