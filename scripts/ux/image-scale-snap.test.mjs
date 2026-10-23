import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/attachments/image-scale-snap.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { snapImageScale, IMAGE_SCALE_STOPS } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("common image percentages remain 25/50/75/100", () => {
  assert.deepEqual(IMAGE_SCALE_STOPS, [25, 50, 75, 100]);
});
for (const stop of [25, 50, 75, 100]) {
  test(`fast pointer motion is attracted to ${stop}%`, () => {
    const next = snapImageScale(stop - 3, 20, { raw: stop - 10, time: 0, snapped: null });
    assert.equal(next.percent, stop);
    assert.equal(next.sample.raw, stop - 3, "raw samples must not accumulate snapped motion");
  });
}
test("fast magnetism has a finite release boundary", () => {
  assert.equal(snapImageScale(55, 10, { raw: 49, time: 0, snapped: 50 }).percent, 50);
  assert.equal(snapImageScale(57, 10, { raw: 49, time: 0, snapped: 50 }).percent, 57);
});
test("slow pointer movement can reach every integer including adjacent percentages", () => {
  for (let value = 1; value <= 100; value++) {
    assert.equal(snapImageScale(value, 100, { raw: value - 1, time: 0, snapped: null }).percent, value);
  }
  assert.equal(snapImageScale(51, 100, { raw: 50, time: 0, snapped: 50 }).percent, 51);
  assert.equal(snapImageScale(49, 100, { raw: 50, time: 0, snapped: 50 }).percent, 49);
});
test("pointer values are rounded and clamped without changing the original-relative scale", () => {
  for (const [raw, expected] of [[-20, 1], [0, 1], [37.4, 37], [37.6, 38], [140, 100]]) {
    assert.equal(snapImageScale(raw, 100, null).percent, expected);
  }
});
test("zero/negative timestamp deltas do not create unbounded velocity", () => {
  for (const time of [0, -1]) assert.equal(snapImageScale(52, time, { raw: 40, time: 0, snapped: null }).percent, 52);
});
