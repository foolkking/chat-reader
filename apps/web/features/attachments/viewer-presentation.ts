import type { CSSProperties } from "react";
import type { AttachmentViewerKind, AttachmentViewerMode } from "./preview-adapter-registry";

export type ViewerPresentation = "compact" | "reading" | "document" | "media" | "workspace";
export type ViewerPresentationOptions = {
  size?: "normal" | "large";
  maximized?: boolean;
};

export type ViewerPresentationInput = {
  viewerKind: AttachmentViewerKind | null;
  viewerMode: AttachmentViewerMode | null;
  itemCount: number;
  pdfPageCount?: number | null;
};

export type ViewerMediaDimensions = { width: number; height: number } | null;
export type ViewerViewport = { width: number; height: number };

export function resolveViewerPresentation(input: ViewerPresentationInput): { presentation: ViewerPresentation; size: "normal" | "large" } {
  if (input.viewerKind === "image" && input.viewerMode === "image-overview") return { presentation: "workspace", size: "large" };
  if (input.viewerKind === "table") return { presentation: "workspace", size: "large" };
  if (["spreadsheet", "presentation", "archive"].includes(input.viewerKind ?? "")) return { presentation: "workspace", size: "large" };
  if (input.viewerKind === "document") return { presentation: "reading", size: "normal" };
  if (input.viewerKind === "audio") return { presentation: "compact", size: "normal" };
  if (input.viewerKind === "pdf") return { presentation: "document", size: (input.pdfPageCount ?? 1) > 1 ? "large" : "normal" };
  if (input.viewerKind === "image" || input.viewerKind === "video") return { presentation: "media", size: input.itemCount > 1 ? "large" : "normal" };
  if (["markdown", "text", "code", "json"].includes(input.viewerKind ?? "")) {
    return { presentation: "reading", size: input.viewerKind === "code" ? "large" : "normal" };
  }
  return { presentation: "compact", size: "normal" };
}

export function viewerPresentationStyle({
  presentation,
  size,
  maximized,
  viewport,
  mediaDimensions,
  itemCount,
}: {
  presentation: ViewerPresentation;
  size: "normal" | "large";
  maximized: boolean;
  viewport: ViewerViewport;
  mediaDimensions: ViewerMediaDimensions;
  itemCount: number;
}): CSSProperties {
  if (viewport.width < 768) return { width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none" };
  if (maximized) return { width: "96vw", height: "94vh", maxWidth: "96vw", maxHeight: "94vh" };

  if (presentation === "compact") {
    return {
      width: Math.min(720, viewport.width * 0.9),
      height: Math.min(420, Math.max(300, viewport.height * 0.46)),
      maxWidth: "90vw",
      maxHeight: "70vh",
    };
  }
  if (presentation === "reading") {
    return {
      width: Math.min(size === "large" ? 1240 : 1000, viewport.width * 0.9),
      height: Math.min(900, viewport.height * 0.82),
      maxWidth: "90vw",
      maxHeight: "82vh",
    };
  }
  if (presentation === "document") {
    return {
      width: Math.min(size === "large" ? 1280 : 1120, viewport.width * 0.88),
      height: Math.min(size === "large" ? 1000 : 900, viewport.height * (size === "large" ? 0.9 : 0.86)),
      maxWidth: "88vw",
      maxHeight: "90vh",
    };
  }
  if (presentation === "workspace") {
    return { width: "96vw", height: "94vh", maxWidth: "96vw", maxHeight: "94vh" };
  }

  const maxWidth = viewport.width * 0.9;
  const maxHeight = viewport.height * 0.9;
  const filmstripHeight = itemCount > 1 ? 66 : 0;
  const chromeHeight = 58 + filmstripHeight + 32;
  const fallbackWidth = Math.min(1100, viewport.width * 0.86);
  const naturalWidth = mediaDimensions?.width || fallbackWidth;
  const naturalHeight = mediaDimensions?.height || fallbackWidth * 9 / 16;
  const scale = Math.min(1, (maxWidth - 32) / naturalWidth, (maxHeight - chromeHeight) / naturalHeight);
  const contentWidth = naturalWidth * Math.max(0.1, scale);
  const contentHeight = naturalHeight * Math.max(0.1, scale);
  const minimumWidth = itemCount > 1 ? 520 : 360;
  const minimumHeight = itemCount > 1 ? 460 : 320;
  return {
    width: Math.min(maxWidth, Math.max(minimumWidth, contentWidth + 32)),
    height: Math.min(maxHeight, Math.max(minimumHeight, contentHeight + chromeHeight)),
    maxWidth: "90vw",
    maxHeight: "90vh",
  };
}

export function isMobileViewerViewport(viewport: ViewerViewport): boolean {
  return viewport.width < 768;
}
