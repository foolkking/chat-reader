import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  buildAttachmentRenderPlan,
  imageDisplayMaxWidth,
  normalizeImageDisplayMode,
  resolveAttachmentCapability,
} from "../features/attachments/preview-adapter-registry";
import type { AttachmentRead } from "../lib/types";
import { attachmentOccurrenceTarget } from "../features/attachments/attachment-location";

function capability(mime: string, filename: string) {
  return resolveAttachmentCapability({
    detected_mime_type: mime,
    declared_mime_type: mime,
    display_name: filename,
    original_filename: filename,
    asset_object: null,
  });
}

function capabilityWith(detectedMime: string, declaredMime: string, filename: string) {
  return resolveAttachmentCapability({
    detected_mime_type: detectedMime,
    declared_mime_type: declaredMime,
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
  expect(capability("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "report.docx").viewerKind).toBe("document");
  expect(capability("application/vnd.oasis.opendocument.text", "report.odt").viewerKind).toBe("document");
  expect(capability("application/msword", "legacy.doc").viewerKind).toBe("document");
  expect(capability("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "book.xlsx").viewerKind).toBe("spreadsheet");
  expect(capability("application/vnd.oasis.opendocument.spreadsheet", "book.ods").viewerKind).toBe("spreadsheet");
  expect(capability("application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx").viewerKind).toBe("presentation");
  expect(capability("application/vnd.oasis.opendocument.presentation", "deck.odp").viewerKind).toBe("presentation");
  expect(capability("application/zip", "archive.zip").viewerKind).toBe("archive");
  expect(capability("application/x-tar", "archive.tar").inlineMode).toBe("download-only");
});

test("trusted mime takes precedence over conflicting filename extensions", () => {
  expect(capability("application/pdf", "fake.png").rendererKey).toBe("pdf");
  expect(capability("application/zip", "fake.txt").viewerKind).toBe("archive");
});

test("generic text detection is refined without overriding trusted binary formats", () => {
  expect(capabilityWith("text/plain", "text/markdown", "README.md").rendererKey).toBe("markdown");
  expect(capabilityWith("text/plain", "application/octet-stream", "model.obj").inlineMode).toBe("download-only");
  expect(capabilityWith("text/plain", "application/octet-stream", "drawing.dxf").inlineMode).toBe("download-only");
  expect(capabilityWith("text/plain", "text/plain", ".hiddenfile").rendererKey).toBe("text");
  expect(capabilityWith("application/pdf", "text/plain", "fake.md").rendererKey).toBe("pdf");
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
  expect(buildAttachmentRenderPlan({ ...base, detected_mime_type: "application/zip", display_name: "archive.zip" }).inline).toBe("preview-panel");
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

test("attachment occurrence navigation preserves the selected same-block identity and offsets", () => {
  const attachment = { id: "attachment-2" } as AttachmentRead;
  const target = attachmentOccurrenceTarget(attachment, {
    message_id: "message-1",
    message_version_id: "version-1",
    is_current_version: true,
    version_number: 1,
    message_role: "assistant",
    message_order_key: "000001",
    message_preview: "second reference",
    render_block_id: "block-1",
    block_index: 4,
    start_offset: 120,
    end_offset: 164,
    occurrence_key: "same-block-occurrence-2",
    placement: "inline",
  });

  expect(target).toEqual({
    messageId: "message-1",
    messageVersionId: "version-1",
    renderBlockId: "block-1",
    blockIndex: 4,
    characterOffset: 120,
    endCharacterOffset: 164,
    occurrenceKey: "same-block-occurrence-2",
    attachmentId: "attachment-2",
    source: "attachment",
  });
});

test("stale attachment locations preserve the stale state and expose truthful recovery actions", () => {
  const reader = readFileSync(resolve(process.cwd(), "features/conversations/conversation-reader.tsx"), "utf8");
  expect(reader).toContain('if (!result.fallback) setNavigationStatus("idle")');
  expect(reader).toContain('附件引用已失效，当前正文保持不变。');
  expect(reader).toContain('queryKey: ["conversation-attachments", conversationId]');
  expect(reader).toContain('刷新文件引用');
  expect(reader).toContain('定位到消息');
});
