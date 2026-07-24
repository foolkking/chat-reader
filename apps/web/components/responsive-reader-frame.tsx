"use client";

import type { CSSProperties } from "react";
import { usePreferences } from "./preferences-provider";
import { ResizeHandle, useResizablePane } from "./resizable-pane";

export function ResponsiveReaderFrame({
  index,
  content,
  toc,
}: {
  index: React.ReactNode;
  content: React.ReactNode;
  toc: React.ReactNode;
}) {
  const { readerWidthMode, sectionTocMode } = usePreferences();
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
      data-section-toc={sectionTocMode}
      style={{ "--reader-toc-width": `${tocSize.size}px` } as CSSProperties}
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
