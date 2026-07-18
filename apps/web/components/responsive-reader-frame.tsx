"use client";

export function ResponsiveReaderFrame({
  index,
  content,
  toc,
  indexExpanded,
}: {
  index: React.ReactNode;
  content: React.ReactNode;
  toc: React.ReactNode;
  indexExpanded: boolean;
}) {
  return (
    <div
      className="reader-frame grid min-h-full w-full grid-cols-1 py-[clamp(1rem,2vw,2rem)] xl:items-start"
      data-index-expanded={indexExpanded ? "true" : "false"}
    >
      <aside className="reader-index-column relative z-20 hidden min-w-0 xl:block">{index}</aside>
      <div className="reader-content-column min-w-0">{content}</div>
      <aside className="reader-toc-column hidden min-w-0 xl:block">{toc}</aside>
    </div>
  );
}
