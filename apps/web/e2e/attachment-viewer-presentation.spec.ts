import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveViewerPresentation,
  viewerPresentationStyle,
  type ViewerPresentation,
} from "../features/attachments/viewer-presentation";
import type { AttachmentViewerKind, AttachmentViewerMode } from "../features/attachments/preview-adapter-registry";
import { releaseOfflineAttachmentUrls } from "../lib/offline-db";

function presentation(viewerKind: AttachmentViewerKind, viewerMode: AttachmentViewerMode, itemCount = 1, pdfPageCount: number | null = null) {
  return resolveViewerPresentation({ viewerKind, viewerMode, itemCount, pdfPageCount });
}

test("viewer kinds resolve to adaptive presentation classes", () => {
  expect(presentation("audio", "audio").presentation).toBe("compact");
  for (const [kind, mode] of [["markdown", "markdown-rendered"], ["text", "text"], ["code", "code"], ["json", "json-tree"]] as Array<[AttachmentViewerKind, AttachmentViewerMode]>) {
    expect(presentation(kind, mode).presentation).toBe("reading");
  }
  expect(presentation("table", "table").presentation).toBe("workspace");
  expect(presentation("document", "document").presentation).toBe("compact");
  expect(presentation("spreadsheet", "spreadsheet").presentation).toBe("reading");
  expect(presentation("presentation", "presentation").presentation).toBe("reading");
  expect(presentation("archive", "archive").presentation).toBe("compact");
  expect(presentation("pdf", "pdf", 1, 1)).toEqual({ presentation: "document", size: "normal" });
  expect(presentation("pdf", "pdf", 1, 8)).toEqual({ presentation: "document", size: "large" });
  expect(presentation("image", "image-focus").presentation).toBe("media");
  expect(presentation("image", "image-overview", 9).presentation).toBe("workspace");
  expect(presentation("video", "video").presentation).toBe("media");
});

test("complex viewers only promote to workspace when parsed content needs the space", () => {
  expect(resolveViewerPresentation({ viewerKind: "document", viewerMode: "document", itemCount: 1, contentMetrics: { documentBlocks: 8 } }).presentation).toBe("compact");
  expect(resolveViewerPresentation({ viewerKind: "document", viewerMode: "document", itemCount: 1, contentMetrics: { documentBlocks: 80 } }).presentation).toBe("reading");
  expect(resolveViewerPresentation({ viewerKind: "spreadsheet", viewerMode: "spreadsheet", itemCount: 1, contentMetrics: { sheetCount: 1, maxRows: 10, maxColumns: 5 } }).presentation).toBe("reading");
  expect(resolveViewerPresentation({ viewerKind: "spreadsheet", viewerMode: "spreadsheet", itemCount: 1, contentMetrics: { sheetCount: 1, maxRows: 100, maxColumns: 5 } }).presentation).toBe("workspace");
  expect(resolveViewerPresentation({ viewerKind: "presentation", viewerMode: "presentation", itemCount: 1, contentMetrics: { slideCount: 4 } }).presentation).toBe("reading");
  expect(resolveViewerPresentation({ viewerKind: "presentation", viewerMode: "presentation", itemCount: 1, contentMetrics: { slideCount: 24 } }).presentation).toBe("workspace");
  expect(resolveViewerPresentation({ viewerKind: "archive", viewerMode: "archive", itemCount: 1, contentMetrics: { archiveFiles: 1, archiveDirectories: 0 } }).presentation).toBe("compact");
  expect(resolveViewerPresentation({ viewerKind: "archive", viewerMode: "archive", itemCount: 1, contentMetrics: { archiveFiles: 120, archiveDirectories: 8 } }).presentation).toBe("workspace");
});

test("desktop presentation sizes differ while workspace and maximize retain large canvas", () => {
  const viewport = { width: 1920, height: 1080 };
  const style = (value: ViewerPresentation, size: "normal" | "large" = "normal", maximized = false) => viewerPresentationStyle({ presentation: value, size, maximized, viewport, mediaDimensions: null, itemCount: 1 });
  expect(style("compact").width).toBe(720);
  expect(style("reading").width).toBe(1000);
  expect(style("document").width).toBe(1120);
  expect(style("workspace").width).toBe("96vw");
  expect(style("reading", "normal", true)).toMatchObject({ width: "96vw", height: "94vh" });
});

test("media uses intrinsic dimensions without enlarging a small image to the viewport", () => {
  const style = viewerPresentationStyle({ presentation: "media", size: "normal", maximized: false, viewport: { width: 1920, height: 1080 }, mediaDimensions: { width: 300, height: 200 }, itemCount: 1 });
  expect(style.width).toBe(360);
  expect(style.height).toBe(320);
});

test("mobile always uses a full viewport shell", () => {
  for (const presentationValue of ["compact", "reading", "document", "media", "workspace"] as ViewerPresentation[]) {
    expect(viewerPresentationStyle({ presentation: presentationValue, size: "normal", maximized: false, viewport: { width: 390, height: 844 }, mediaDimensions: { width: 300, height: 200 }, itemCount: 1 })).toMatchObject({ width: "100vw", height: "100dvh" });
  }
});

test("unified shell owns presentation, maximize, and PDF fit controls", () => {
  const source = readFileSync(resolve(process.cwd(), "features/attachments/attachment-viewer.tsx"), "utf8");
  expect(source).toContain("data-viewer-presentation={presentation.presentation}");
  expect(source).toContain("data-viewer-maximized={maximized ? \"true\" : \"false\"}");
  expect(source).toContain("if (maximizedRef.current)");
  expect(source).toContain("Fit page");
  expect(source).toContain("Fit width");
  expect(source).toContain('data-pdf-fit={fitMode}');
  expect(source).not.toContain('sm:h-[94vh] sm:w-[96vw]');
});

test("complex attachment viewers are lazy and bounded", () => {
  const source = readFileSync(resolve(process.cwd(), "features/attachments/complex-attachment-viewer.tsx"), "utf8");
  const worker = readFileSync(resolve(process.cwd(), "features/attachments/complex-attachment-worker.ts"), "utf8");
  expect(source).toContain("new Worker(new URL(\"./complex-attachment-worker.ts\", import.meta.url)");
  expect(source).toContain("MAX_SOURCE_BYTES");
  expect(source).toContain("onPresentationMetrics");
  expect(worker).toContain("validateCentralDirectory");
  expect(worker).toContain("MAX_EXPANDED_BYTES");
  expect(worker).toContain("parseLegacyWordDocument");
  expect(worker).not.toContain("eval(");
});

test("inline attachments use group-owned semantic lanes without changing the reader width", () => {
  const block = readFileSync(resolve(process.cwd(), "features/attachments/attachment-block.tsx"), "utf8");
  const groups = readFileSync(resolve(process.cwd(), "features/conversations/assistant-message-renderer.tsx"), "utf8");
  const layout = readFileSync(resolve(process.cwd(), "features/attachments/attachment-inline-layout.tsx"), "utf8");
  expect(layout).toContain("attachment-lane--${presentation}");
  expect(layout).toContain("partitionPresentationRuns");
  expect(groups).toContain("<AttachmentInlineGroup items={items} />");
  expect(block).not.toContain("mx-auto max-w-[720px]");
  expect(block).not.toContain("mx-auto max-w-[560px]");
});

test("offline viewer cleanup revokes only temporary attachment URLs", () => {
  const revoked: string[] = [];
  const urlApi = URL as typeof URL & { revokeObjectURL: (url: string) => void };
  const originalRevoke = urlApi.revokeObjectURL;
  urlApi.revokeObjectURL = (url: string) => revoked.push(url);
  try {
    releaseOfflineAttachmentUrls({
      content_url: "blob:offline-content",
      download_url: "blob:offline-content",
    } as never);
    releaseOfflineAttachmentUrls({
      content_url: "https://offline.chat-reader.local/assets/a",
      download_url: null,
    } as never);
  } finally {
    urlApi.revokeObjectURL = originalRevoke;
  }
  expect(revoked).toEqual(["blob:offline-content"]);

  const viewer = readFileSync(resolve(process.cwd(), "features/attachments/attachment-viewer.tsx"), "utf8");
  expect(viewer).toContain("if (access.kind === \"offline\") releaseOfflineAttachmentUrls(attachment)");
  expect(viewer).toContain("if (access.kind === \"offline\") releaseOfflineAttachmentUrls(query.data)");
});
