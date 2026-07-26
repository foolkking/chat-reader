"use client";

import { PanelLeftOpen } from "lucide-react";
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

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-[80] md:hidden">
          <button type="button" aria-label="Close sidebar" className="absolute inset-0 bg-black/30" onClick={onMobileClose} />
          <aside className="absolute inset-y-0 left-0 flex w-[86vw] max-w-[20rem] flex-col overflow-hidden border-r border-ui bg-sidebar text-primary shadow-2xl">
            {children}
          </aside>
        </div>
      ) : null}
      {!desktopExpanded ? (
        <aside className="hidden h-full w-14 shrink-0 flex-col items-center border-r border-ui bg-sidebar py-3 text-primary md:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-semibold text-white">CR</div>
          <button type="button" onClick={onDesktopExpand} className="mt-4 flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-surface hover:text-primary" aria-label="Open sidebar" title="Open sidebar">
            <PanelLeftOpen className="h-5 w-5" />
          </button>
          {railExtra}
        </aside>
      ) : (
        <aside className="relative hidden h-full shrink-0 flex-col overflow-hidden border-r border-ui bg-sidebar text-primary md:flex" style={{ width: sidebarSize.size }}>
          {children}
          <ResizeHandle side="right" label="Resize sidebar" onPointerDown={(event) => sidebarSize.startResize(event)} onDoubleClick={sidebarSize.resetSize} />
        </aside>
      )}
    </>
  );
}
