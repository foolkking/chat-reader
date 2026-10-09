export type PdfFitMode = "page" | "width" | "custom";
export type PdfPageSize = { width: number; height: number };

export const PDF_CANVAS_MAX_PIXELS = 4 * 1024 * 1024;
export const PDF_CANVAS_MAX_EDGE = 4096;

export function pdfPageLayout(base: PdfPageSize, container: PdfPageSize, fitMode: PdfFitMode, zoom: number, deviceRatio = 1) {
  if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid PDF page size");
  const widthFit = Math.max(1, container.width - 32) / base.width;
  const heightFit = Math.max(1, container.height - 32) / base.height;
  const scale = fitMode === "page" ? Math.min(widthFit, heightFit) : fitMode === "width" ? widthFit : zoom;
  const width = base.width * scale, height = base.height * scale;
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 32768)) throw new Error("PDF page exceeds preview dimensions");
  // CSS size remains readable/zoomable; the backing bitmap has an independent
  // budget. A high-DPR or unusually large page must not allocate an enormous canvas.
  const ratio = Math.min(Math.max(1, deviceRatio || 1), 2, Math.sqrt(PDF_CANVAS_MAX_PIXELS / (width * height)), PDF_CANVAS_MAX_EDGE / width, PDF_CANVAS_MAX_EDGE / height);
  return { scale, width, height, ratio, pixelWidth: Math.max(1, Math.floor(width * ratio)), pixelHeight: Math.max(1, Math.floor(height * ratio)) };
}

export function parsePdfPageInput(value: string, pageCount: number): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const page = Number(text);
  return Number.isSafeInteger(page) && page >= 1 && page <= pageCount ? page : null;
}

export function isViewerShortcut(event: Pick<KeyboardEvent, "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "isComposing" | "target">): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  const target = event.target as Element | null;
  return !target?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],audio,video");
}

export function createPdfRenderQueue(concurrency = 2) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("Invalid PDF render concurrency");
  type Entry = { priority: number; signal: AbortSignal; start: () => void; cancel: () => void };
  const queue: Entry[] = [];
  let active = 0;
  const drain = () => {
    queue.sort((left, right) => left.priority - right.priority);
    while (active < concurrency && queue.length) {
      const entry = queue.shift()!;
      if (entry.signal.aborted) { entry.cancel(); continue; }
      active += 1;
      entry.start();
    }
  };
  return {
    run(signal: AbortSignal, work: () => Promise<void>, priority = 0): Promise<void> {
      return new Promise((resolve, reject) => {
        const abortError = () => new DOMException("Preview cancelled", "AbortError");
        if (signal.aborted) { reject(abortError()); return; }
        let started = false;
        const entry: Entry = {
          priority, signal,
          cancel: () => { signal.removeEventListener("abort", abort); reject(abortError()); },
          start: () => {
            started = true;
            signal.removeEventListener("abort", abort);
            void Promise.resolve().then(() => { if (signal.aborted) throw abortError(); return work(); })
              .then(resolve, reject).finally(() => { active -= 1; drain(); });
          },
        };
        const abort = () => {
          if (started) return;
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          entry.cancel();
        };
        signal.addEventListener("abort", abort, { once: true });
        queue.push(entry);
        drain();
      });
    },
  };
}

export type PdfRenderQueue = ReturnType<typeof createPdfRenderQueue>;

type PdfPageLease = { users: number; promise: Promise<import("pdfjs-dist").PDFPageProxy>; page?: import("pdfjs-dist").PDFPageProxy; failed?: boolean };
const activePdfPages = new WeakMap<import("pdfjs-dist").PDFDocumentProxy, Map<number, PdfPageLease>>();

/** A main page and its thumbnail may share a proxy. Clean its operator list only
 * after the last consumer's render has settled and released its lease. */
export function acquirePdfPage(documentProxy: import("pdfjs-dist").PDFDocumentProxy, pageNumber: number) {
  let pages = activePdfPages.get(documentProxy);
  if (!pages) { pages = new Map(); activePdfPages.set(documentProxy, pages); }
  let entry = pages.get(pageNumber);
  if (!entry) {
    entry = { users: 0, promise: documentProxy.getPage(pageNumber) };
    const pendingEntry = entry;
    entry.promise = entry.promise.then((page) => { pendingEntry.page = page; return page; }, (reason) => { pendingEntry.failed = true; throw reason; });
    pages.set(pageNumber, entry);
  }
  entry.users += 1;
  const ownedEntry = entry, ownedPages = pages;
  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      ownedEntry.users -= 1;
      const cleanup = () => {
        if (ownedEntry.users || ownedPages.get(pageNumber) !== ownedEntry) return;
        try { ownedEntry.page?.cleanup(); } catch { /* A destroyed document has no reusable page resources. */ }
        if (ownedEntry.page || ownedEntry.failed) ownedPages.delete(pageNumber);
      };
      // Failed promises must leave the pool synchronously, before an immediate
      // explicit retry can acquire the same rejected read again.
      if (ownedEntry.page || ownedEntry.failed) cleanup();
      else void ownedEntry.promise.then(cleanup, cleanup);
    },
  };
}
