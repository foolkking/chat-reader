import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveViewerPresentation,
  viewerPresentationStyle,
  type ViewerPresentation,
} from "../features/attachments/viewer-presentation";
import type { AttachmentViewerKind, AttachmentViewerMode } from "../features/attachments/preview-adapter-registry";

function presentation(viewerKind: AttachmentViewerKind, viewerMode: AttachmentViewerMode, itemCount = 1, pdfPageCount: number | null = null) {
  return resolveViewerPresentation({ viewerKind, viewerMode, itemCount, pdfPageCount });
}

test("viewer kinds resolve to adaptive presentation classes", () => {
  expect(presentation("audio", "audio").presentation).toBe("compact");
  for (const [kind, mode] of [["markdown", "markdown-rendered"], ["text", "text"], ["code", "code"], ["json", "json-tree"]] as Array<[AttachmentViewerKind, AttachmentViewerMode]>) {
    expect(presentation(kind, mode).presentation).toBe("reading");
  }
  expect(presentation("table", "table").presentation).toBe("workspace");
  expect(presentation("pdf", "pdf", 1, 1)).toEqual({ presentation: "document", size: "normal" });
  expect(presentation("pdf", "pdf", 1, 8)).toEqual({ presentation: "document", size: "large" });
  expect(presentation("image", "image-focus").presentation).toBe("media");
  expect(presentation("image", "image-overview", 9).presentation).toBe("workspace");
  expect(presentation("video", "video").presentation).toBe("media");
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
