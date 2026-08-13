"use client";

import { useRef } from "react";
import { ResizableDockPanel } from "./resizable-pane";
import { useDialogFocus } from "./use-dialog-focus";

export function ReaderUtilityDrawer({
  label,
  onClose,
  restoreFocus,
  active = true,
  children,
}: {
  label: string;
  onClose: () => void;
  restoreFocus?: () => HTMLElement | null;
  active?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus({ open: active, rootRef: panelRef, onClose, restoreFocus });

  return (
    <div aria-hidden={!active} className={`fixed inset-0 z-40 min-w-0 justify-end overflow-hidden bg-black/15 ${active ? "hidden md:flex" : "hidden"}`}>
      <div data-dialog-backdrop aria-hidden="true" className="absolute inset-0" onPointerDown={onClose} />
      <ResizableDockPanel
        storageKey="chat-reader:reader-utility-panel-width"
        defaultSize={480}
        minSize={384}
        maxSize={() => Math.min(860, window.innerWidth * 0.6)}
        side="left"
        className="relative z-10 min-w-0 max-w-full border-l border-ui bg-raised shadow-2xl"
      >
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="flex h-full min-w-0 max-w-full overflow-hidden">
          {children}
        </div>
      </ResizableDockPanel>
    </div>
  );
}
