"use client";

import { Drawer } from "vaul";
import { useEffect, useRef, useState } from "react";
import { useAttachmentViewerOpen } from "../features/attachments/attachment-viewer-state";

export function MobileReaderSheet({
  open,
  onOpenChange,
  title,
  header,
  status,
  restoreFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  header?: React.ReactNode;
  status?: React.ReactNode;
  restoreFocus?: () => HTMLElement | null;
  children: React.ReactNode;
}) {
  const viewerOpen = useAttachmentViewerOpen();
  const [snapPoint, setSnapPoint] = useState<number | string | null>(0.6);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setSnapPoint(0.6);
  }, [open]);

  // Keep only the active mobile surface mounted. Vaul otherwise retains a
  // closing sheet for its exit animation while the selected utility sheet is
  // already opening. Two simultaneous modal focus scopes make Escape close
  // the stale sheet first and can leave focus on document.body.
  if (!open) return null;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(nextOpen) => { if (!viewerOpen) onOpenChange(nextOpen); }}
      snapPoints={[0.6, 0.92]}
      activeSnapPoint={snapPoint}
      setActiveSnapPoint={setSnapPoint}
      fadeFromIndex={1}
      modal
      repositionInputs={false}
    >
      <Drawer.Portal>
        {/* Vaul's Overlay owns RemoveScroll. Pause that lock while the global
            Viewer owns scrolling; keep modal Content mounted to retain files,
            search, selection and the original focus target. */}
        {!viewerOpen ? <Drawer.Overlay className="fixed inset-0 z-50 bg-black/30 md:hidden" /> : null}
        <Drawer.Content
          ref={contentRef}
          aria-label={title}
          inert={viewerOpen || undefined}
          aria-hidden={viewerOpen || undefined}
          onPointerDownOutside={(event) => { if (viewerOpen) event.preventDefault(); }}
          onInteractOutside={(event) => { if (viewerOpen) event.preventDefault(); }}
          onEscapeKeyDown={(event) => { if (viewerOpen) event.preventDefault(); }}
          onOpenAutoFocus={(event) => {
            if (viewerOpen) { event.preventDefault(); return; }
            const preferred = contentRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]");
            if (!preferred) return;
            event.preventDefault();
            preferred.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (viewerOpen) { event.preventDefault(); return; }
            const target = restoreFocus?.();
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
          className="fixed inset-x-0 bottom-0 z-50 h-full overflow-clip rounded-t-2xl border border-b-0 border-ui bg-page text-primary shadow-2xl outline-none md:hidden"
        >
          {/* Vaul translates by viewport minus snap height. Size the working
              area to that visible height, not the offscreen drawer surface. */}
          <div className="flex min-h-0 flex-col overflow-clip" style={{ height: `${Number(snapPoint ?? 0.6) * 100}%` }}>
            <div className="flex shrink-0 justify-center pb-2 pt-3" aria-hidden="true">
              <div className="h-1.5 w-10 rounded-full bg-[var(--border-strong)]" />
            </div>
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            {header ? <div className="shrink-0 border-b border-ui px-[3vw] pb-3">{header}</div> : null}
            {status ? <div className="shrink-0 px-[3vw] py-2" aria-live="polite">{status}</div> : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-[3vw] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {children}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
