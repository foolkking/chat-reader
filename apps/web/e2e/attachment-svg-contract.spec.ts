import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("attachment SVG preview path does not inline or independently open SVG documents", () => {
  const sources = [
    readFileSync(resolve(process.cwd(), "features/attachments/attachment-block.tsx"), "utf8"),
    readFileSync(resolve(process.cwd(), "features/attachments/attachment-viewer.tsx"), "utf8"),
  ];

  for (const source of sources) {
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toMatch(/<object\b/i);
    expect(source).not.toMatch(/<embed\b/i);
    expect(source).not.toContain("window.open(");
    expect(source).not.toMatch(/target=["']_blank["']/i);
  }
});

test("attachment viewer has one body portal and compatibility preview delegates to it", () => {
  const viewer = readFileSync(resolve(process.cwd(), "features/attachments/attachment-viewer.tsx"), "utf8");
  const block = readFileSync(resolve(process.cwd(), "features/attachments/attachment-block.tsx"), "utf8");

  // The PDF toolbar is portaled into the shared shell toolbar host. Only the
  // shell itself may create a portal rooted at document.body.
  expect(viewer.match(/return createPortal\(/g)).toHaveLength(1);
  expect(viewer).toContain("toolbarHost");
  expect(viewer).toContain("<AttachmentViewerShell session={session}");
  expect(viewer).toContain("data-testid=\"attachment-viewer-shell\"");
  expect(block).not.toContain("createPortal(");
});
