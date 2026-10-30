"use client";

import { useEffect, useRef } from "react";

export function ReaderKeyboardHelp({ zh }: { zh: boolean }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !root.current?.open) return;
      root.current.open = false;
      root.current.querySelector("summary")?.focus({ preventScroll: true });
      event.preventDefault();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return <details ref={root} data-reader-auxiliary className="relative text-sm text-secondary">
    <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-ui bg-surface hover:bg-subtle" aria-label={zh ? "阅读快捷键" : "Reading keyboard help"} title={zh ? "阅读快捷键" : "Reading keyboard help"}>?</summary>
    <div className="absolute right-0 top-12 z-[80] w-72 max-w-[85vw] rounded-lg border border-ui bg-raised p-4 shadow-md">
      <h2 className="mb-3 font-semibold text-primary">{zh ? "阅读快捷键" : "Reading keyboard help"}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt>↑ / ↓</dt><dd>{zh ? "逐行滚动" : "Scroll by line"}</dd>
        <dt>Space / ⇧ Space</dt><dd>{zh ? "下一页／上一页" : "Next / previous page"}</dd>
        <dt>PageUp / PageDown</dt><dd>{zh ? "按页滚动" : "Scroll by page"}</dd>
        <dt>Home / End</dt><dd>{zh ? "当前窗口首尾" : "Loaded window start / end"}</dd>
        <dt>J / K</dt><dd>{zh ? "已加载的下一条／上一条消息" : "Next / previous loaded message"}</dd>
        <dt>Tab / Escape</dt><dd>{zh ? "打开边缘目录／关闭面板" : "Reach edge navigation / close panel"}</dd>
      </dl>
      <p className="mt-3 text-xs">{zh ? "输入、中文组词、对话框和目录内不会触发正文快捷键。" : "Reader shortcuts pause in inputs, IME composition, dialogs and navigation."}</p>
    </div>
  </details>;
}
