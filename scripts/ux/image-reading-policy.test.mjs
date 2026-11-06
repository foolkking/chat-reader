import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const exports = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../../apps/web/lib/image-display.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(exports);
const { scaledImageDimensions, validatedImageDisplay, recommendedImagePercent, imageGridGeometry } = exports;
const sha = "a".repeat(64);
test("reading sizes use the largest whole percentage, preserve small images and half-up rounding", () => {
  for (const [width, height] of [[40, 24], [2400, 1800], [600, 6000], [3000, 300], [640, 1600]]) {
    const percent = recommendedImagePercent(width, height);
    const size = scaledImageDimensions(width, height, percent);
    assert.ok(size.width <= 640 && size.height <= 1600);
    if (percent < 100) {
      const larger = scaledImageDimensions(width, height, percent + 1);
      assert.ok(larger.width > 640 || larger.height > 1600);
    }
  }
  assert.equal(recommendedImagePercent(40, 24), 100);
  assert.equal(recommendedImagePercent(1_000_000, 1_000_000), null);
  assert.deepEqual(scaledImageDimensions(8, 6, 25), { width: 2, height: 2 });
});
test("offline display is a source-bound allowlist, not an arbitrary metadata copy", () => {
  const value = { source_sha256: sha, scale_percent: 50, original_width: 800, original_height: 600, width: 400, height: 300, secret: "not portable" };
  assert.equal(validatedImageDisplay(value, sha).secret, undefined);
  assert.equal(validatedImageDisplay(value, "b".repeat(64)), undefined);
  assert.equal(validatedImageDisplay({ ...value, width: 401 }, sha), undefined);
  assert.equal(validatedImageDisplay({ ...value, scale_percent: 101 }, sha), undefined);
  assert.equal(validatedImageDisplay(null, sha), undefined);
});
test("grid estimates share 320/640 lane thresholds, six-slot cap and no horizontal overflow", () => {
  for (const width of [240, 319, 320, 375, 639, 640, 960]) for (const count of [1, 2, 3, 6, 7, 200]) {
    const grid = imageGridGeometry(count, width);
    assert.equal(grid.columns, Math.min(count, width < 320 ? 1 : width < 640 ? 2 : 3));
    assert.ok(grid.cellWidth * grid.columns + (grid.columns - 1) * 8 <= width + .01);
    assert.equal(grid.height, imageGridGeometry(Math.min(count, 6), width).height);
  }
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
  const actual = new Function("imageGridGeometry", "validatedImageDisplay", "embeddedAttachment", "resolveAttachmentCapability",
    "estimateReaderBlockSize", "stripLeadingTimestamp", "window", compiled + "\nreturn {groupAttachmentBlocks,estimateDisplayUnit};")(
    imageGridGeometry, validatedImageDisplay, value => value, attachment => ({ viewerKind: attachment.kind }),
    () => 68, text => text, { innerHeight: 900 },
  );
  const blocks = Array.from({ length: 20 }, (_, block_index) => ({ block_index, block_type: "image", data: {} }));
  const units = actual.groupAttachmentBlocks([...blocks, { block_index: 20, block_type: "paragraph", data: {} },
    { block_index: 21, block_type: "attachment", data: { attachment: { kind: "text" } } },
    { block_index: 22, block_type: "attachment", data: { attachment: { kind: "image" } } }]);
  assert.deepEqual(units.map(unit => unit.blocks.length), [20, 1, 1, 1]);
  for (const contentWidth of [260, 400, 700]) {
    assert.equal(actual.estimateDisplayUnit(units[0], { contentWidth, lineHeight: 28 }), imageGridGeometry(20, contentWidth).height);
    assert.equal(actual.estimateDisplayUnit(units[3], { contentWidth, lineHeight: 28 }), Math.min(320, contentWidth) * .75);
  }
});
