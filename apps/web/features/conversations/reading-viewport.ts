import { captureScrollAnchor, cancelReaderPosition, readerPositionBusy } from "./reader-navigation";
import type { ScrollAnchorSnapshot } from "../../lib/types";

// One owner per physical scroller, shared by all mounted messages. No timers,
// per-image scroll loops, account data, or persisted positions live here.
const owners = new WeakMap<HTMLElement, ReturnType<typeof createOwner>>();

export function observeReadingViewport(content: HTMLElement): () => void {
  const root = content.closest<HTMLElement>('[data-reader-scroll-root="true"]') ?? document.documentElement;
  let owner = owners.get(root);
  if (!owner) { owner = createOwner(root); owners.set(root, owner); }
  owner.add(content);
  return () => {
    owner.remove(content);
    if (!owner.size()) { owner.close(); owners.delete(root); }
  };
}

function createOwner(root: HTMLElement) {
  const windowMode = root === document.documentElement;
  const scrollRoot = windowMode ? null : root;
  const events = windowMode ? window : root;
  const contents = new Set<HTMLElement>();
  let anchor: ScrollAnchorSnapshot | null = null;
  let anchorElement: HTMLElement | null = null;
  let textRange: Range | null = null;
  let textOffset = 0;
  let scrollAtCapture = windowMode ? window.scrollY : root.scrollTop;
  let captureFrame = 0;
  let writing = false;
  let releaseFrame = 0;
  let closed = false;
  let rebaseAfterExplicitPosition = false;
  const previousOverflowAnchor = root.style.overflowAnchor;
  root.style.overflowAnchor = "none";
  root.dataset.readerGeometryOwner = "viewport";
  const offset = () => windowMode ? window.scrollY : root.scrollTop;
  const busy = () => readerPositionBusy(scrollRoot)
    || root.dataset.navigationStage?.startsWith("aligning:")
    || root.dataset.readerPointerDragging === "true"
    || root.dataset.readerLayoutCompensating === "true"
    || root.dataset.readerSurfaceCompensating === "true";
  const capture = () => {
    captureFrame = 0;
    if (closed || writing || busy()) return;
    anchor = captureScrollAnchor(scrollRoot, 120);
    anchorElement = anchor ? document.getElementById(anchor.targetId) : null;
    textRange = null;
    if (anchorElement) {
      const bounds = anchorElement.getBoundingClientRect();
      const rootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
      const caret = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null })
        .caretRangeFromPoint?.(bounds.left + Math.min(24, bounds.width / 2), rootTop + 120);
      if (caret?.startContainer.nodeType === Node.TEXT_NODE && anchorElement.contains(caret.startContainer)) {
        const length = caret.startContainer.textContent?.length ?? 0;
        if (length) {
          const start = Math.min(caret.startOffset, length - 1);
          caret.setStart(caret.startContainer, start);
          caret.setEnd(caret.startContainer, start + 1);
          if (caret.getBoundingClientRect().height > 0) {
            textRange = caret;
            textOffset = caret.getBoundingClientRect().top - rootTop;
          }
        }
      }
    }
    scrollAtCapture = offset();
  };
  const scheduleCapture = () => {
    if (!captureFrame) captureFrame = requestAnimationFrame(() => {
      captureFrame = 0;
      // Virtual rows can resize in the same animation frame as a scroll
      // event. Correct against the preceding real anchor before replacing it.
      if (!rebaseAfterExplicitPosition) compensate();
      if (!busy()) { rebaseAfterExplicitPosition = false; capture(); }
    });
  };
  const compensate = () => {
    if (closed) return;
    if (busy()) { rebaseAfterExplicitPosition = true; scheduleCapture(); return; }
    if (rebaseAfterExplicitPosition) { rebaseAfterExplicitPosition = false; capture(); return; }
    if (!anchor || !anchorElement?.isConnected || !root.contains(anchorElement)) { capture(); return; }
    // Native scrolling since the last sample is user motion, not layout drift.
    const useText = textRange?.startContainer.isConnected && anchorElement.contains(textRange.startContainer)
      && textRange.getBoundingClientRect().height > 0;
    const top = (useText ? textRange!.getBoundingClientRect().top : anchorElement.getBoundingClientRect().top)
      - (scrollRoot?.getBoundingClientRect().top ?? 0);
    const expected = (useText ? textOffset : anchor.offset) - (offset() - scrollAtCapture);
    const delta = top - expected;
    if (!Number.isFinite(delta) || Math.abs(delta) <= .5) return;
    writing = true;
    root.dataset.readerGeometryCompensating = "true";
    root.dataset.readerLastScrollWriter = "geometry";
    const before = offset();
    if (windowMode) window.scrollBy({ top: delta, behavior: "auto" });
    else root.scrollTop += delta;
    scrollAtCapture += offset() - before;
    // Synthetic CI can inspect scalar diagnostics without recording content.
    root.dispatchEvent(new CustomEvent("chat-reader:geometry-correction", { detail: { delta, applied: offset() - before } }));
    if (releaseFrame) cancelAnimationFrame(releaseFrame);
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = 0;
      writing = false;
      delete root.dataset.readerGeometryCompensating;
      capture();
    });
  };
  const resize = new ResizeObserver(compensate);
  const onScroll = () => { if (!writing) scheduleCapture(); };
  const onPositionReleased = () => { rebaseAfterExplicitPosition = true; scheduleCapture(); };
  const onIntent = (event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "j", "k"].includes(event.key)
        || (event.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable=true]")) return;
    }
    cancelReaderPosition(scrollRoot);
    root.dataset.readerLastScrollWriter = "user-intent";
    rebaseAfterExplicitPosition = false;
    // Retain current geometry, never the anchor of an older navigation.
    writing = false;
    if (releaseFrame) cancelAnimationFrame(releaseFrame);
    delete root.dataset.readerGeometryCompensating;
    capture();
  };
  events.addEventListener("scroll", onScroll, { passive: true });
  root.addEventListener("chat-reader:position-released", onPositionReleased);
  for (const event of ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"]) events.addEventListener(event, onIntent, { passive: true });
  resize.observe(root);
  return {
    add(content: HTMLElement) { contents.add(content); resize.observe(content); scheduleCapture(); },
    remove(content: HTMLElement) { contents.delete(content); resize.unobserve(content); },
    size: () => contents.size,
    close() {
      closed = true;
      resize.disconnect();
      cancelAnimationFrame(captureFrame); cancelAnimationFrame(releaseFrame);
      events.removeEventListener("scroll", onScroll);
      root.removeEventListener("chat-reader:position-released", onPositionReleased);
      for (const event of ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"]) events.removeEventListener(event, onIntent);
      delete root.dataset.readerGeometryOwner;
      delete root.dataset.readerGeometryCompensating;
      root.style.overflowAnchor = previousOverflowAnchor;
    },
  };
}
