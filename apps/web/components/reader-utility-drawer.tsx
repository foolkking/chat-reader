"use client";

import { useEffect, useRef } from "react";
import { ResizableDockPanel } from "./resizable-pane";

export function ReaderUtilityDrawer({
  label,
  onClose,
  active = true,
  children,
}: {
  label: string;
  onClose: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("button, input, select, textarea, a[href]")?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape, true);
      previousFocus?.focus();
    };
  }, [active, onClose]);

  return (
    <div aria-hidden={!active} className={`fixed inset-0 z-40 min-w-0 justify-end overflow-hidden bg-black/15 ${active ? "hidden md:flex" : "hidden"}`}>
      <button type="button" aria-label={label} className="absolute inset-0" onClick={onClose} />
      <ResizableDockPanel
        storageKey="chat-reader:reader-utility-panel-width"
        defaultSize={480}
        minSize={384}
        maxSize={() => Math.min(860, window.innerWidth * 0.6)}
        side="left"
        className="relative z-10 min-w-0 max-w-full border-l border-ui bg-raised shadow-2xl"
      >
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} className="flex h-full min-w-0 max-w-full overflow-hidden">
          {children}
        </div>
      </ResizableDockPanel>
    </div>
  );
}
