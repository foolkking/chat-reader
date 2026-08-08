import { expect, test } from "@playwright/test";
import {
  buildAttachmentRenderPlan,
  imageDisplayMaxWidth,
  normalizeImageDisplayMode,
  resolveAttachmentCapability,
} from "../features/attachments/preview-adapter-registry";
import type { AttachmentRead } from "../lib/types";

function capability(mime: string, filename: string) {
  return resolveAttachmentCapability({
    detected_mime_type: mime,
    declared_mime_type: mime,
    display_name: filename,
    original_filename: filename,
    asset_object: null,
  });
}

test("attachment renderer policy separates supported viewers from reliable download fallbacks", () => {
  expect(capability("text/markdown", "README.md").rendererKey).toBe("markdown");
  expect(capability("text/csv", "data.csv").rendererKey).toBe("table");
  expect(capability("text/x-python", "script.py").rendererKey).toBe("code");
  expect(capability("image/svg+xml", "diagram.svg").rendererKey).toBe("image");
  expect(capability("image/tiff", "scan.tiff").rendererKey).toBe("converted-image");
  expect(capability("video/x-msvideo", "clip.avi").inlineMode).toBe("download-only");
  expect(capability("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "report.docx").inlineMode).toBe("download-only");
  expect(capability("application/zip", "archive.zip").inlineMode).toBe("download-only");
});

test("trusted mime takes precedence over conflicting filename extensions", () => {
  expect(capability("application/pdf", "fake.png").rendererKey).toBe("pdf");
  expect(capability("application/zip", "fake.txt").inlineMode).toBe("download-only");
});

test("render plans expose only media, preview-panel, or file-row skins", () => {
  const base = {
    id: "attachment-1",
    conversation_id: "conversation-1",
    display_name: "image.png",
    original_filename: "image.png",
    detected_mime_type: "image/png",
    declared_mime_type: "image/png",
    status: "active",
    scan_status: "scanner_disabled",
    resolution_status: "resolved",
    content_url: "/api/attachments/attachment-1/content",
    download_url: "/api/attachments/attachment-1/content?download=1",
    asset_object: { id: "asset-1", byte_size: 16, sha256: "a".repeat(64), detected_mime_type: "image/png", status: "available", scan_status: "scanner_disabled" },
    occurrences: [],
  } as unknown as AttachmentRead;

  expect(buildAttachmentRenderPlan(base).inline).toBe("media");
  expect(buildAttachmentRenderPlan({ ...base, detected_mime_type: "text/markdown", display_name: "notes.md" }).inline).toBe("preview-panel");
  expect(buildAttachmentRenderPlan({ ...base, detected_mime_type: "application/zip", display_name: "archive.zip" }).inline).toBe("file-row");
  expect(buildAttachmentRenderPlan(base, { status: "unsupported", requestId: "probe-1", reason: "browser-capability" }).fileRowVariant).toBe("unsupported");
  expect(buildAttachmentRenderPlan(base, { status: "failed", requestId: "probe-2", reason: "decode" }).fileRowVariant).toBe("preview-failed");
});

test("image display modes are presentation-only bounded values", () => {
  expect(normalizeImageDisplayMode("inline")).toBe("auto");
  expect(normalizeImageDisplayMode("card")).toBe("auto");
  expect(normalizeImageDisplayMode("unexpected")).toBe("auto");
  expect(imageDisplayMaxWidth("small")).toBe("280px");
  expect(imageDisplayMaxWidth("medium")).toBe("480px");
  expect(imageDisplayMaxWidth("large")).toBe("100%");
});
