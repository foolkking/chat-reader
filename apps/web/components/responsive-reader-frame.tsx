"use client";

import { usePreferences } from "./preferences-provider";

export function ResponsiveReaderFrame({
  index,
  content,
  toc,
}: {
  index: React.ReactNode;
  content: React.ReactNode;
  toc: React.ReactNode;
}) {
  const { readerWidthMode } = usePreferences();
  return (
    <div
      className="reader-frame min-h-full w-full py-[clamp(1rem,2vw,2rem)]"
      data-reader-width={readerWidthMode}
    >
      <aside className="reader-index-column">{index}</aside>
      <div className="reader-layout-grid">
        <div className="reader-content-column min-w-0">{content}</div>
        <aside className="reader-toc-column min-w-0">{toc}</aside>
      </div>
    </div>
  );
}
