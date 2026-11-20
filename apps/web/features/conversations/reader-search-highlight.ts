import { resolveTextAnchorRange } from "./text-anchor";
import { subscribeRenderedBlocks } from "./rendered-block-registry";

export function applySearchHighlight(target: { targetId: string; quote: string; start?: number; end?: number; prefix?: string; suffix?: string } | null): () => void {
  const highlights = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } }).highlights;
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!target || !highlights || !HighlightConstructor || !target.quote) {
    highlights?.delete("chat-reader-search-match");
    return () => undefined;
  }
  let frame = 0, host: HTMLElement | null = null, lastRange: Range | null = null;
  // Listen only while there is a chosen quote. The virtualizer is free to
  // recycle its row: never pin, focus or scroll a block just to paint a match.
  const schedule = () => { if (!frame) frame = window.requestAnimationFrame(apply); };
  const observer = new MutationObserver(() => { lastRange = null; schedule(); });
  const apply = () => {
    frame = 0;
    const element = document.getElementById(target.targetId);
    if (element !== host) {
      observer.disconnect();
      host = element;
      lastRange = null;
      if (host) observer.observe(host, { childList: true, subtree: true, characterData: true });
    } else if (element && lastRange && !lastRange.collapsed && element.contains(lastRange.commonAncestorContainer)) {
      return;
    }
    const range = element ? resolveTextAnchorRange(element, {
      quote: target.quote,
      prefix: target.prefix,
      suffix: target.suffix,
      startOffset: target.start,
      endOffset: target.end,
    }) : null;
    lastRange = range;
    if (range) highlights.set("chat-reader-search-match", new HighlightConstructor(range));
    else highlights.delete("chat-reader-search-match");
  };
  apply();
  const unsubscribe = subscribeRenderedBlocks(schedule);
  schedule();
  return () => {
    unsubscribe(); observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    highlights.delete("chat-reader-search-match");
  };
}
