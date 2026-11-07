import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const exports = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../../apps/web/lib/image-display.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(exports);
const { scaledImageDimensions, validatedImageDisplay, recommendedImagePercent, imageFlowHeight, imageTargetSize, imageBodyGeometry, validatedImageGeometry } = exports;
const sha = "a".repeat(64);
test("Viewer 1:1 is intrinsic CSS pixels, width-fit starts at the top, fit never upscales", () => {
  const policy = {};
  new Function("exports", ts.transpileModule(readFileSync(new URL("../../apps/web/features/attachments/image-viewer-geometry.ts", import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(policy);
  const canvas = { width: 800, height: 600 }, image = { width: 1200, height: 2400 };
  assert.deepEqual(policy.imageViewerTransform(image, canvas, "original"), { scale: 1, x: -200, y: 0 });
  assert.deepEqual(policy.imageViewerTransform(image, canvas, "fit"), { scale: .25, x: 250, y: 0 });
  assert.equal(policy.imageViewerTransform(image, canvas, "width").scale, 2 / 3);
  assert.equal(policy.imageViewerTransform(image, canvas, "width").y, 0);
  assert.equal(policy.imageViewerTransform({ width: 32, height: 24 }, canvas, "fit").scale, 1);
});
test("column recommendation is a concrete percentage, with resize admission intact", () => {
  assert.equal(recommendedImagePercent(40, 24, 720), 100);
  assert.equal(recommendedImagePercent(1200, 800, 720), 60);
  assert.equal(recommendedImagePercent(240, 4000, 720), 100);
  assert.equal(recommendedImagePercent(1_000_000, 1_000_000, 720), null);
  assert.equal(recommendedImagePercent(1200, 800, 0), null);
  assert.deepEqual(scaledImageDimensions(8, 6, 25), { width: 2, height: 2 });
});
test("source geometry supplies default 100 without a save, but never overrides saved size", () => {
  const geometry = { source_sha256: sha, original_width: 1200, original_height: 800, secret: "omit" };
  assert.deepEqual(imageTargetSize({ image_geometry_v1: geometry }, sha), { width: 1200, height: 800 });
  assert.equal(validatedImageGeometry(geometry, "b".repeat(64)), undefined);
  assert.equal(validatedImageGeometry({ ...geometry, original_width: 1.2 }, sha), undefined);
  assert.equal(validatedImageGeometry({ ...geometry, original_height: 1_000_001 }, sha), undefined);
  assert.equal(validatedImageGeometry(geometry, sha).secret, undefined);
  const saved = { ...geometry, scale_percent: 50, width: 600, height: 400 };
  assert.deepEqual(imageTargetSize({ image_geometry_v1: geometry, image_display_v1: saved }, sha), { width: 600, height: 400 });
  assert.deepEqual(imageTargetSize({ image_geometry_v1: geometry }, sha), imageTargetSize({ image_display_v1: { ...geometry, scale_percent: 100, width: 1200, height: 800 } }, sha));
});
test("long images fold their height, not their width; small images never upscale", () => {
  const folded = imageBodyGeometry({ width: 240, height: 4000 }, 720, 900);
  assert.equal(folded.width, 240); assert.equal(folded.height, 630); assert.equal(folded.fullHeight, 4000);
  assert.equal(imageBodyGeometry({ width: 240, height: 4000 }, 720, 900, true).height, 4000);
  assert.equal(imageBodyGeometry({ width: 32, height: 24 }, 720, 900).width, 32);
  assert.equal(imageBodyGeometry({ width: 1200, height: 800 }, 720, 900).width, 720);
  assert.equal(imageBodyGeometry({ width: 1200, height: 800 }, 720, 900).adapted, true);
});
test("offline display is a source-bound allowlist, not an arbitrary metadata copy", () => {
  const value = { source_sha256: sha, scale_percent: 50, original_width: 800, original_height: 600, width: 400, height: 300, secret: "not portable" };
  assert.equal(validatedImageDisplay(value, sha).secret, undefined);
  assert.equal(validatedImageDisplay(value, "b".repeat(64)), undefined);
  assert.equal(validatedImageDisplay({ ...value, width: 401 }, sha), undefined);
  assert.equal(validatedImageDisplay({ ...value, scale_percent: 101 }, sha), undefined);
  assert.equal(validatedImageDisplay(null, sha), undefined);
});
test("natural-flow estimates preserve requested widths and source order", () => {
  assert.equal(imageFlowHeight([{ width: 300, height: 200 }, { width: 300, height: 200 }], 720, 900), 248);
  assert.equal(imageFlowHeight([{ width: 500, height: 300 }, { width: 500, height: 300 }], 720, 900), 704);
  assert.equal(imageFlowHeight([{ width: 300, height: 200 }, { width: 300, height: 200 }], 607, 900), 504);
  assert.equal(imageFlowHeight([{ width: 300, height: 200 }, { width: 300, height: 200 }], 608, 900), 248);
});
test("actual ordinary/virtual display-unit grouping estimates image rows, not attachment list rows", () => {
  const source = ts.createSourceFile("renderer.tsx", readFileSync(new URL("../../apps/web/features/conversations/assistant-message-renderer.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["groupAttachmentBlocks", "isImageAttachment", "estimateDisplayUnit"];
  const functions = names.map(name => {
    const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node); return node.getText(source);
  }).join("\n");
  const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const actual = new Function("imageFlowHeight", "imageTargetSize", "embeddedAttachment", "resolveAttachmentCapability",
    "estimateReaderBlockSize", "stripLeadingTimestamp", "window", compiled + "\nreturn {groupAttachmentBlocks,estimateDisplayUnit};")(
    imageFlowHeight, imageTargetSize, value => value, attachment => ({ viewerKind: attachment.kind }),
    () => 68, text => text, { innerHeight: 900 },
  );
  const blocks = Array.from({ length: 20 }, (_, block_index) => ({ block_index, block_type: "image", data: {} }));
  const units = actual.groupAttachmentBlocks([...blocks, { block_index: 20, block_type: "paragraph", data: {} },
    { block_index: 21, block_type: "attachment", data: { attachment: { kind: "text" } } },
    { block_index: 22, block_type: "attachment", data: { attachment: { kind: "image" } } }]);
  assert.deepEqual(units.map(unit => unit.blocks.length), [20, 1, 1, 1]);
  for (const contentWidth of [260, 400, 700]) {
    assert.equal(actual.estimateDisplayUnit(units[0], { contentWidth, lineHeight: 28 }), imageFlowHeight(Array(20).fill(undefined), contentWidth, 900));
    assert.equal(actual.estimateDisplayUnit(units[3], { contentWidth, lineHeight: 28 }), imageFlowHeight([undefined], contentWidth, 900));
  }
});
