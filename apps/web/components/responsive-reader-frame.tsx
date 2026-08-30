"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { usePreferences } from "./preferences-provider";
import { ResizeHandle, useResizablePane } from "./resizable-pane";

export function ResponsiveReaderFrame({
  index,
  content,
  toc,
  focusMode = false,
}: {
  index: React.ReactNode;
  content: React.ReactNode;
  toc: React.ReactNode;
  focusMode?: boolean;
}) {
  const { readerDensityMode, readerFontSizePx, readerWidthMode, sectionTocMode } = usePreferences();
  const [tocActivity, setTocActivity] = useState<"hidden" | "visible">("hidden");
  useEffect(() => {
    if (sectionTocMode !== "rail") {
      setTocActivity("visible");
      return undefined;
    }
    const root = document.querySelector<HTMLElement>('[data-reader-scroll-root="true"]');
    if (!root) return undefined;
    let hideTimer: number | null = null;
    const reveal = () => {
      setTocActivity("visible");
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setTocActivity("hidden"), 900);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) reveal();
    };
    root.addEventListener("scroll", reveal, { passive: true });
    root.addEventListener("wheel", reveal, { passive: true });
    root.addEventListener("touchmove", reveal, { passive: true });
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("scroll", reveal);
      root.removeEventListener("wheel", reveal);
      root.removeEventListener("touchmove", reveal);
      root.removeEventListener("keydown", onKeyDown);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, [sectionTocMode]);
  const tocSize = useResizablePane({
    storageKey: "chat-reader:section-toc-width",
    defaultSize: 240,
    minSize: 192,
    maxSize: () => Math.min(416, Math.max(192, window.innerWidth * 0.34)),
  });
  return (
    <div
      className="reader-frame min-h-full w-full py-[clamp(1rem,2vw,2rem)]"
      data-reader-width={readerWidthMode}
      data-reader-density={readerDensityMode}
      data-section-toc={sectionTocMode}
      data-toc-activity={sectionTocMode === "rail" ? tocActivity : "visible"}
      data-focus-mode={focusMode ? "on" : "off"}
      style={{ "--reader-toc-width": `${tocSize.size}px`, "--reader-font-size": `${readerFontSizePx}px` } as CSSProperties}
    >
      <aside className="reader-index-column">{index}</aside>
      <aside className="reader-toc-column min-w-0">
        {toc}
        {sectionTocMode === "visible" ? <ResizeHandle side="left" label="Resize section TOC" onPointerDown={(event) => tocSize.startResize(event, { direction: -1 })} onDoubleClick={tocSize.resetSize} /> : null}
      </aside>
      <div className="reader-layout-grid">
        <div className="reader-content-column min-w-0">{content}</div>
      </div>
    </div>
  );
}
