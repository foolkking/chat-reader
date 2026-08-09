import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeJustifiedRows } from "../features/attachments/attachment-inline-policy";
import { resolveInlinePresentation, type AttachmentRenderPlan, type AttachmentViewerKind } from "../features/attachments/preview-adapter-registry";
import { parseDelimitedRows } from "../features/attachments/attachment-table-policy";

function plan(viewerKind: AttachmentViewerKind | null, inline: AttachmentRenderPlan["inline"]): AttachmentRenderPlan {
  return {
    dataState: "available",
    capability: {
      rendererKey: viewerKind ?? "generic",
      inlineMode: inline === "file-row" ? "download-only" : "inline-rich",
      viewerKind,
      friendlyType: "fixture",
    },
    runtime: { status: "idle" },
    inline,
    viewerKind,
    viewerMode: null,
    actions: { open: viewerKind !== null, download: true, retry: false, locate: true },
  };
}

test("RenderPlan resolves to the six frozen inline presentations", () => {
  expect(resolveInlinePresentation(plan("markdown", "preview-panel"))).toBe("reading");
  expect(resolveInlinePresentation(plan("code", "preview-panel"))).toBe("reading");
  expect(resolveInlinePresentation(plan("table", "preview-panel"))).toBe("data");
  expect(resolveInlinePresentation(plan("image", "media"))).toBe("gallery");
  expect(resolveInlinePresentation(plan("audio", "preview-panel"))).toBe("audio-list");
  expect(resolveInlinePresentation(plan("video", "preview-panel"))).toBe("video");
  expect(resolveInlinePresentation(plan("document", "preview-panel"))).toBe("file-list");
  expect(resolveInlinePresentation(plan("archive", "preview-panel"))).toBe("file-list");
  expect(resolveInlinePresentation(plan("image", "preview-panel"))).toBe("file-list");
  expect(resolveInlinePresentation(plan(null, "file-row"))).toBe("file-list");
});

test("justified gallery keeps aspect ratios and caps the final row at 1.1 target height", () => {
  const rows = computeJustifiedRows([
    { key: "wide", ratio: 2, item: "wide" },
    { key: "portrait", ratio: 0.75, item: "portrait" },
    { key: "square", ratio: 1, item: "square" },
    { key: "last", ratio: 1.4, item: "last" },
    { key: "tail", ratio: 1, item: "tail" },
  ], 880);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.at(-1)?.height).toBeLessThanOrEqual(220);
  for (const row of rows) {
    for (const item of row.items) expect(item.width).toBeGreaterThan(0);
  }
});

test("lane, surface and progressive-disclosure contracts are centralized", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const block = readFileSync(resolve(process.cwd(), "features/attachments/attachment-block.tsx"), "utf8");
  const group = readFileSync(resolve(process.cwd(), "features/attachments/attachment-inline-layout.tsx"), "utf8");
  expect(css).toContain("--attachment-lane-reading: 45rem");
  expect(css).toContain("--attachment-lane-data: 55rem");
  expect(css).toContain("--attachment-lane-audio: 38rem");
  expect(css).toContain("--attachment-lane-video: 43rem");
  expect(css).toContain("--attachment-lane-files: 38rem");
  expect(css).toContain(".attachment-file-list-row + .attachment-file-list-row");
  expect(css).toContain(".attachment-audio-row + .attachment-audio-row");
  expect(css).toContain(".attachment-gallery-trigger:hover .attachment-gallery-overlay");
  expect(block).toContain("attachment-audio-row");
  expect(block).toContain("attachment-file-list-row");
  expect(block).not.toContain("Attachment: ");
  expect(group).toContain('initialMode: "image-overview"');
});

test("runtime preview failures move to FileList while static capability stays unchanged", () => {
  const registry = readFileSync(resolve(process.cwd(), "features/attachments/preview-adapter-registry.ts"), "utf8");
  expect(registry).toContain('if (runtime.status === "unsupported") return fileRowPlan');
  expect(registry).toContain('if (runtime.status === "failed") return fileRowPlan');
  expect(registry).toContain('if (plan.inline === "file-row") return "file-list"');
});

test("CSV and TSV viewer defaults to bounded table mode with a Raw escape hatch", () => {
  expect(parseDelimitedRows('name,notes\nAlice,"has, comma"\nBob,"two ""quotes"""', ",")).toEqual([
    ["name", "notes"],
    ["Alice", "has, comma"],
    ["Bob", 'two "quotes"'],
  ]);
  const source = readFileSync(resolve(process.cwd(), "features/attachments/attachment-viewer.tsx"), "utf8");
  expect(source).toContain('viewerKind === "table"');
  expect(source).toContain('active={effectiveMode === "table"}');
  expect(source).toContain('active={effectiveMode === "table-raw"}');
  expect(source).toContain('data-testid="attachment-table-viewer"');
  expect(source).toContain('mode={mode === "table-raw" ? "source" : "rendered"}');
});
