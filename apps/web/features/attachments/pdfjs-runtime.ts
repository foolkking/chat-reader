type PdfJsModule = typeof import("pdfjs-dist");

const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
let modulePromise: Promise<PdfJsModule> | null = null;

export function getPdfJsWorkerUrl(): string {
  return workerUrl;
}

export async function loadPdfJs(): Promise<PdfJsModule> {
  modulePromise ??= import("pdfjs-dist");
  const pdfjs = await modulePromise;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}
