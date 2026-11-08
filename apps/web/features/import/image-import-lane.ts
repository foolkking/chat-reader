/** Measure the actual Reader CSS, including width preference and TOC. No writes. */
export function measureImportImageLane(options: { readerWidthMode: string; sectionTocMode: string }): number {
  const actual = Array.from(document.querySelectorAll<HTMLElement>("[data-reader-scroll-root] .reader-message-body"))
    .find(node => node.getClientRects().length && node.getBoundingClientRect().width >= 44);
  if (actual) return Math.floor(actual.getBoundingClientRect().width);
  const host = document.querySelector<HTMLElement>("[data-reader-main-section], [data-workspace-content]")
    ?? document.querySelector<HTMLElement>("main");
  const width = host?.getBoundingClientRect().width || window.innerWidth;
  const frame = document.createElement("div");
  frame.className = "reader-frame";
  frame.dataset.readerWidth = options.readerWidthMode;
  frame.dataset.sectionToc = options.sectionTocMode;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;width:${width}px`;
  try {
    const toc = Number(window.localStorage.getItem("chat-reader:section-toc-width"));
    if (toc >= 192 && toc <= 416) frame.style.setProperty("--reader-toc-width", `${toc}px`);
  } catch { /* Optional layout preference. */ }
  const grid = document.createElement("div");
  grid.className = "reader-layout-grid";
  const column = document.createElement("div");
  column.className = "reader-content-column";
  grid.append(column); frame.append(grid); document.body.append(frame);
  try { return Math.max(44, Math.min(8192, Math.floor(column.getBoundingClientRect().width))); }
  finally { frame.remove(); }
}
