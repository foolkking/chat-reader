"use client";

import { useEffect, useRef } from "react";
import { CircleHelp, X } from "lucide-react";

export function ReaderKeyboardHelp({ zh }: { zh: boolean }) {
  const root = useRef<HTMLDetailsElement>(null);
  const dismiss = () => {
    if (!root.current) return;
    root.current.open = false;
    root.current.querySelector("summary")?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !root.current?.open) return;
      dismiss();
      event.preventDefault();
    };
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && root.current?.open && !root.current.contains(event.target)) {
        // Do not steal focus from the control the user chose outside the help.
        root.current.open = false;
      }
    };
    window.addEventListener("keydown", close);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside);
    return () => {
      window.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside);
    };
  }, []);
  return <details ref={root} data-reader-auxiliary className="relative text-sm text-secondary">
    <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-ui bg-surface hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)] [&::-webkit-details-marker]:hidden" aria-label={zh ? "阅读快捷键" : "Reading keyboard help"} title={zh ? "阅读快捷键" : "Reading keyboard help"}><CircleHelp aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" /></summary>
    <div role="dialog" aria-label={zh ? "阅读快捷键" : "Reading keyboard help"} className="absolute right-0 top-12 z-[80] max-h-[min(28rem,70dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-ui bg-raised p-4 shadow-md">
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-semibold text-primary">{zh ? "阅读快捷键" : "Reading keyboard help"}</h2><button type="button" onClick={dismiss} aria-label={zh ? "关闭快捷键说明" : "Close keyboard help"} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-subtle"><X aria-hidden="true" className="h-4 w-4" /></button></div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt>↑ / ↓</dt><dd>{zh ? "向上／向下滚动三行" : "Scroll up / down three lines"}</dd>
        <dt>Space / ⇧ Space</dt><dd>{zh ? "下一页／上一页" : "Next / previous page"}</dd>
        <dt>PageUp / PageDown</dt><dd>{zh ? "按页滚动" : "Scroll by page"}</dd>
        <dt>Home / End</dt><dd>{zh ? "第一条／最后一条消息" : "First / last message"}</dd>
        <dt>J / K</dt><dd>{zh ? "下一条／上一条消息" : "Next / previous message"}</dd>
        <dt>Tab / Escape</dt><dd>{zh ? "按 Tab 在控件间移动／按 Escape 关闭说明" : "Use Tab to move between controls / Escape closes this help"}</dd>
      </dl>
    </div>
  </details>;
}
