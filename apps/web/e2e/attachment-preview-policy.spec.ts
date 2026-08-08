import { expect, test } from "@playwright/test";
import { resolveAttachmentPreviewKind } from "../features/attachments/preview-adapter-registry";

test("attachment preview policy separates lightweight previews from reliable download fallbacks", () => {
  expect(resolveAttachmentPreviewKind("text/markdown", "README.md")).toBe("markdown");
  expect(resolveAttachmentPreviewKind("text/plain", "data.csv")).toBe("table");
  expect(resolveAttachmentPreviewKind("text/plain", "script.py")).toBe("code");
  expect(resolveAttachmentPreviewKind("image/svg+xml", "diagram.svg")).toBe("image");
  expect(resolveAttachmentPreviewKind("image/tiff", "scan.tiff")).toBe("download");
  expect(resolveAttachmentPreviewKind("video/x-msvideo", "clip.avi")).toBe("download");
  expect(resolveAttachmentPreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "report.docx")).toBe("download");
  expect(resolveAttachmentPreviewKind("application/zip", "archive.zip")).toBe("download");
});
