"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ListTree, X } from "lucide-react";
import { usePreferences } from "./preferences-provider";
import { ResizeHandle, useResizablePane } from "./resizable-pane";
import { ReaderAuxiliaryVisibility } from "./reader-auxiliary-visibility";
import { MobileReaderSheet } from "./mobile-reader-sheet";

// Reading-desk overlay: the same paper/ink surfaces, application font and 4px
// spacing. Navigation borrows the margin, never the body's layout or DOM identity.
export function ResponsiveReaderFrame({ index, content, toc, focusMode = false }: {
  index: React.ReactNode; content: React.ReactNode; toc: React.ReactNode; focusMode?: boolean;
}) {
  const { readerDensityMode, readerFontSizePx, readerWidthMode, sectionTocMode, resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const id = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<HTMLElement>(null), tocRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panel, setPanel] = useState<"index" | "toc" | null>(null);
  const [compact, setCompact] = useState(false);
  const [columns, setColumns] = useState({ index: false, toc: false });
  const [tocActivity, setTocActivity] = useState<"hidden" | "visible">("hidden");
  const activePanel = focusMode ? panel : null;
  const cancelTimer = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const close = useCallback(() => {
    cancelTimer(); setPanel(null);
    if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
  }, [cancelTimer]);
  useEffect(() => { setPanel(null); cancelTimer(); return cancelTimer; }, [focusMode, cancelTimer]);
  useLayoutEffect(() => {
    const measure = () => {
      setCompact(window.matchMedia("(max-width: 767px)").matches);
      const next = { index: Boolean(indexRef.current?.getClientRects().length), toc: Boolean(tocRef.current?.getClientRects().length) };
      setColumns(current => current.index === next.index && current.toc === next.toc ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (frameRef.current) observer?.observe(frameRef.current);
    if (indexRef.current) observer?.observe(indexRef.current);
    if (tocRef.current) observer?.observe(tocRef.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [focusMode, compact]);
  useEffect(() => {
    if (!activePanel || compact) return;
    const element = activePanel === "index" ? indexRef.current : tocRef.current;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); close(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element?.contains(event.target) && !openerRef.current?.contains(event.target)) { cancelTimer(); setPanel(null); }
    };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, [activePanel, cancelTimer, close, compact]);
  useEffect(() => {
    if (focusMode || sectionTocMode !== "rail") { setTocActivity("visible"); return; }
    const root = frameRef.current?.closest<HTMLElement>('[data-reader-scroll-root="true"]');
    if (!root) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const reveal = () => {
      setTocActivity("visible"); if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setTocActivity("hidden"), 900);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) reveal(); };
    root.addEventListener("scroll", reveal, { passive: true }); root.addEventListener("wheel", reveal, { passive: true });
    root.addEventListener("touchmove", reveal, { passive: true }); root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("scroll", reveal); root.removeEventListener("wheel", reveal);
      root.removeEventListener("touchmove", reveal); root.removeEventListener("keydown", onKeyDown);
      if (hideTimer !== null) clearTimeout(hideTimer);
    };
  }, [focusMode, sectionTocMode]);
  const tocSize = useResizablePane({ storageKey: "chat-reader:section-toc-width", defaultSize: 240, minSize: 192,
    maxSize: () => Math.min(416, Math.max(192, window.innerWidth * 0.34)) });
  const title = (side: "index" | "toc") => side === "index" ? (zh ? "对话索引" : "Dialogue index") : (zh ? "章节目录" : "Section contents");
  const leave = () => {
    cancelTimer();
    timer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (indexRef.current?.contains(focused) || tocRef.current?.contains(focused)) return;
      setPanel(null);
    }, 300);
  };
  const trigger = (side: "index" | "toc") => <button type="button" data-reader-auxiliary
    className={`reader-focus-edge reader-focus-edge-${side}`} aria-label={title(side)} aria-expanded={activePanel === side} aria-controls={`${id}-${compact ? "sheet-" : ""}${side}`}
    onPointerEnter={event => { if (event.pointerType !== "mouse" || event.buttons) return; cancelTimer(); openerRef.current = event.currentTarget; timer.current = setTimeout(() => setPanel(side), 180); }}
    onPointerLeave={leave} onFocus={cancelTimer}
    onClick={event => {
      cancelTimer(); openerRef.current = event.currentTarget;
      if (activePanel === side) { close(); return; }
      setPanel(side);
      if (!compact) requestAnimationFrame(() => {
        const element = (side === "index" ? indexRef : tocRef).current;
        if (element?.dataset.focusPanel === "open") element.querySelector<HTMLElement>("button, input, [tabindex]")?.focus({ preventScroll: true });
      });
    }}><ListTree className="h-4 w-4" aria-hidden="true" /></button>;
  const navigation = (node: React.ReactNode, visible: boolean) => <ReaderAuxiliaryVisibility.Provider value={{ visible, overlay: focusMode }}>{node}</ReaderAuxiliaryVisibility.Provider>;
  const panelHeader = (side: "index" | "toc") => focusMode ? <header className="flex shrink-0 items-center justify-between border-b border-ui px-3 py-2"><h2 className="text-sm font-semibold">{title(side)}</h2><button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-subtle" aria-label={zh ? "关闭目录" : "Close navigation"} onClick={close}><X className="h-4 w-4" /></button></header> : null;
  return <div ref={frameRef} className="reader-frame min-h-full w-full py-[clamp(1rem,2vw,2rem)]"
    data-reader-width={readerWidthMode} data-reader-density={readerDensityMode} data-section-toc={sectionTocMode}
    data-toc-activity={sectionTocMode === "rail" ? tocActivity : "visible"} data-focus-mode={focusMode ? "on" : "off"}
    style={{ "--reader-toc-width": `${tocSize.size}px`, "--reader-font-size": `${readerFontSizePx}px` } as CSSProperties}>
    <aside ref={indexRef} id={`${id}-index`} data-reader-auxiliary data-focus-panel={activePanel === "index" ? "open" : "closed"}
      className="reader-index-column" onPointerEnter={cancelTimer} onPointerLeave={leave}>
      {panelHeader("index")}{!(focusMode && compact) ? navigation(index, focusMode ? activePanel === "index" : columns.index) : null}
    </aside>
    <aside ref={tocRef} id={`${id}-toc`} data-reader-auxiliary data-focus-panel={activePanel === "toc" ? "open" : "closed"}
      className="reader-toc-column min-w-0" onPointerEnter={cancelTimer} onPointerLeave={leave}>
      {panelHeader("toc")}{!(focusMode && compact) ? navigation(toc, focusMode ? activePanel === "toc" : columns.toc && (sectionTocMode !== "rail" || tocActivity === "visible")) : null}
      {!focusMode && sectionTocMode === "visible" ? <ResizeHandle side="left" label={zh ? "调整章节目录宽度" : "Resize section contents"} onPointerDown={event => tocSize.startResize(event, { direction: -1 })} onDoubleClick={tocSize.resetSize} /> : null}
    </aside>
    <div className="reader-layout-grid"><div className="reader-content-column min-w-0">{content}</div></div>
    {focusMode ? <>{trigger("index")}{trigger("toc")}</> : null}
    <MobileReaderSheet open={focusMode && compact && activePanel !== null} onOpenChange={open => { if (!open) close(); }} title={title(activePanel ?? "index")} restoreFocus={() => openerRef.current}>
      {compact && activePanel ? <div className="flex min-h-0 flex-1 flex-col" id={`${id}-sheet-${activePanel}`} data-reader-auxiliary>{navigation(activePanel === "index" ? index : toc, true)}</div> : null}
    </MobileReaderSheet>
  </div>;
}

