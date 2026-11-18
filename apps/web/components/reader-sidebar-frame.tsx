"use client";

import { PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { useEffect, type CSSProperties } from "react";
import { ResizeHandle, useResizablePane } from "./resizable-pane";

export function ReaderSidebarFrame({
  children,
  desktopExpanded,
  onDesktopExpand,
  mobileOpen,
  onMobileClose,
  railExtra,
}: {
  children: React.ReactNode;
  desktopExpanded: boolean;
  onDesktopExpand: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  railExtra?: React.ReactNode;
}) {
  const sidebarSize = useResizablePane({
    storageKey: "chat-reader:sidebar-width",
    defaultSize: 288,
    minSize: 224,
    maxSize: () => Math.min(448, Math.max(224, window.innerWidth * 0.42)),
  });

  useEffect(() => {
    window.dispatchEvent(new Event("chat-reader:reader-sidebar-layout-change"));
  }, [desktopExpanded, sidebarSize.size]);

  return (
    <>
      {mobileOpen && <button type="button" aria-label="Close sidebar" className="fixed inset-0 z-[80] bg-black/30 md:hidden" onClick={onMobileClose} />}
      {!desktopExpanded ? (
        <aside data-reader-primary-sidebar className="hidden h-full w-14 shrink-0 flex-col items-center border-r border-ui bg-sidebar py-3 text-primary md:flex">
          <Link href="/" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" aria-label="Chat Reader 首页">CR</Link>
          <button type="button" onClick={onDesktopExpand} className="mt-4 flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-surface hover:text-primary" aria-label="Open sidebar" title="Open sidebar">
            <PanelLeftOpen className="h-5 w-5" />
          </button>
          {railExtra}
        </aside>
      ) : null}
      {/* One navigation tree: a CSS-hidden desktop copy previously registered the
          same drag/drop IDs as the visible drawer and could receive its drops. */}
      {(desktopExpanded || mobileOpen) && (
        <aside data-reader-primary-sidebar
          className={`fixed inset-y-0 left-0 z-[81] ${mobileOpen ? "flex" : "hidden"} w-[86vw] max-w-[20rem] shrink-0 flex-col overflow-hidden border-r border-ui bg-sidebar text-primary shadow-2xl md:relative md:inset-auto md:z-auto md:h-full md:w-[var(--sidebar-width)] md:max-w-none md:shadow-none ${desktopExpanded ? "md:flex" : "md:hidden"}`}
          style={{ "--sidebar-width": `${sidebarSize.size}px` } as CSSProperties}>
          {children}
          <div className="hidden md:block"><ResizeHandle side="right" label="Resize sidebar" onPointerDown={(event) => sidebarSize.startResize(event)} onDoubleClick={sidebarSize.resetSize} /></div>
        </aside>
      )}
    </>
  );
}
