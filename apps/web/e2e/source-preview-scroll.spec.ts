import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  selectSourcePreviewAnchor,
  sourceAlignedPreviewScrollTop,
} from "../features/editing/source-preview-scroll";

test("source preview chooses the most precise semantic block", () => {
  const list = { start: 10, end: 120, id: "list" };
  const item = { start: 42, end: 68, id: "item" };
  const next = { start: 130, end: 170, id: "next" };
  expect(selectSourcePreviewAnchor([list, item, next], 50)).toBe(item);
  expect(selectSourcePreviewAnchor([list, item, next], 125)).toBe(list);
  expect(selectSourcePreviewAnchor([list, item, next], 135)).toBe(next);
});

test("source preview interpolates within a block and clamps to its viewport", () => {
  expect(sourceAlignedPreviewScrollTop({
    sourceOffset: 50,
    anchor: { start: 0, end: 100 },
    elementTop: 400,
    elementHeight: 200,
    viewportInset: 12,
    maxScrollTop: 1000,
  })).toBe(488);
  expect(sourceAlignedPreviewScrollTop({
    sourceOffset: 100,
    anchor: { start: 0, end: 100 },
    elementTop: 950,
    elementHeight: 200,
    viewportInset: 12,
    maxScrollTop: 1000,
  })).toBe(1000);
});

test("source editor preview carries source offsets and follows CodeMirror scroll", () => {
  const root = process.cwd();
  const form = fs.readFileSync(path.join(root, "features/editing/edit-message-form.tsx"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "features/conversations/markdown-renderer.tsx"), "utf8");
  expect(form).toContain("requestPreviewScrollSynchronization");
  expect(form).toContain("view.posAtCoords");
  expect(form).toContain("selectSourcePreviewAnchor");
  expect(form).toContain("preserveSourceOffsets");
  expect(renderer).toContain("data-markdown-source-start");
  expect(renderer).toContain("data-markdown-source-end");
});
