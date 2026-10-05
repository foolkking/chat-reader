"use client";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { usePreferences } from "../../components/preferences-provider";
import { ContinuationPanel } from "./continuation-panel";
import { OfflineContinuationPanel } from "./offline-continuation-panel";
import { ContinuationGuide } from "./continuation-guide";
import type { ContinuationNavigate, ContinuationViewState } from "./continuation-index";

export function ContinuationWorkspace({ conversationId, onClose, restoreFocus, offline = false, onNavigate, viewState, showGuideInitially = false }: {
  conversationId: string; onClose: () => void; restoreFocus: () => HTMLElement | null;
  offline?: boolean;
  onNavigate?: ContinuationNavigate;
  viewState?: ContinuationViewState;
  showGuideInitially?: boolean;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [closeError, setCloseError] = useState(false);
  const discard = useRef<(() => Promise<void>) | null>(null);
  const registerDiscard = useCallback((action: (() => Promise<void>) | null) => { discard.current = action; }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const close = async () => {
    if (busy) return;
    if (dirty && !window.confirm(zh ? "放弃未保存的更改？已保存内容会保留。" : "Discard unsaved changes? Saved content will remain.")) return;
    if (dirty) {
      setBusy(true);
      try { await discard.current?.(); }
      catch { setCloseError(true); return; }
      finally { setBusy(false); }
    }
    onClose();
  };
  useDialogFocus({ open: true, rootRef, initialFocusRef: titleRef, onClose: close, restoreFocus });
  const navigate: ContinuationNavigate | undefined = onNavigate ? async target => {
    if (busy || dirty) return false;
    setBusy(true);
    try { const found = await onNavigate(target); if (found) onClose(); return found; }
    finally { setBusy(false); }
  } : undefined;
  return createPortal(<div className="fixed inset-0 z-[320] flex justify-end bg-[var(--overlay)]">
    <div aria-hidden="true" className="absolute inset-0" onPointerDown={close} />
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="continuation-workspace-title" tabIndex={-1} className={`relative flex h-full w-full min-w-0 flex-col bg-page text-primary shadow-2xl ${expanded ? "" : "md:w-3/5 md:max-w-4xl md:border-l md:border-ui"}`}>
      <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-ui px-4">
        <h2 id="continuation-workspace-title" ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 text-base font-semibold">{zh ? "上下文接续" : "Context continuation"}</h2>
        <button type="button" className="hidden min-h-11 items-center gap-2 rounded-md px-3 hover:bg-subtle md:inline-flex" onClick={() => setExpanded(v => !v)}>{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{expanded ? (zh ? "收起" : "Collapse") : (zh ? "展开阅读" : "Expand reading")}</button>
        <button type="button" disabled={busy} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-subtle disabled:opacity-40" aria-label={zh ? "关闭接续" : "Close continuation"} onClick={close}><X className="h-5 w-5" /></button>
      </header>
      {closeError ? <p role="alert" className="px-5 py-3 text-sm text-[var(--danger)]">{zh ? "无法清除本机草稿，请重试或下载草稿后再关闭。" : "Could not clear the local draft. Retry or download it before closing."}</p> : null}
      <div data-continuation-scroll className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 md:px-10"><div className="mx-auto max-w-3xl"><ContinuationGuide conversationId={conversationId} offline={offline} initiallyOpen={showGuideInitially} />{offline ? <OfflineContinuationPanel conversationId={conversationId} onNavigate={navigate} viewState={viewState} /> : <ContinuationPanel conversationId={conversationId} onDirtyChange={setDirty} onBusyChange={setBusy} onDiscardReady={registerDiscard} onNavigate={navigate} viewState={viewState} />}</div></div>
    </div>
  </div>, document.body);
}
