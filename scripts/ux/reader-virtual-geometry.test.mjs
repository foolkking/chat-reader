import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const source = readFileSync(
  new URL("../../apps/web/features/conversations/reader-virtual-geometry.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  fileName: "reader-virtual-geometry.ts",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { inspectReaderViewportCoverage, inspectReaderViewportUnion } = module.exports;

test("consecutive virtual rows may have normal block spacing without recovery", () => {
  const result = inspectReaderViewportCoverage([
    { index: 4, start: 0, end: 180, mounted: true },
    { index: 5, start: 260, end: 440, mounted: true },
    { index: 6, start: 520, end: 700, mounted: true },
  ], 260, 620);

  assert.equal(result.needsRecovery, false);
  assert.equal(result.internalGap, 0);
  assert.deepEqual(result.missingIndexes, []);
});

test("a missing virtual index inside the viewport is recoverable", () => {
  const result = inspectReaderViewportCoverage([
    { index: 10, start: 0, end: 180, mounted: true },
    { index: 12, start: 520, end: 700, mounted: true },
  ], 100, 640);

  assert.equal(result.needsRecovery, true);
  assert.ok(result.internalGap > 300);
  assert.deepEqual(result.missingIndexes, [11]);
});

test("a pinned row outside the viewport does not create a false internal gap", () => {
  const result = inspectReaderViewportCoverage([
    { index: 0, start: -3000, end: -2800, mounted: true },
    { index: 80, start: 100, end: 300, mounted: true },
    { index: 81, start: 300, end: 500, mounted: true },
  ], 100, 500);

  assert.equal(result.needsRecovery, false);
});

test("adjacent actual row boxes cover the readable viewport", () => {
  const result = inspectReaderViewportUnion([
    { start: 0, end: 180 },
    { start: 180, end: 420 },
    { start: 420, end: 620 },
  ], 0, 600);

  assert.equal(result.needsRecovery, false);
  assert.equal(result.internalGap, 0);
});

for (const intervals of [
  [{ start: 250, end: 600 }],
  [{ start: 0, end: 350 }],
]) test(`a partially blank viewport edge is reported: ${JSON.stringify(intervals)}`, () => {
  assert.equal(inspectReaderViewportUnion(intervals, 0, 600).needsRecovery, true);
});

const rendererSource = readFileSync(new URL("../../apps/web/features/conversations/assistant-message-renderer.tsx", import.meta.url), "utf8");
const rendererAst = ts.createSourceFile("renderer.tsx", rendererSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const recoveryNode = rendererAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useVisibleVirtualGapRecovery");
assert.ok(recoveryNode);
const recoveryCode = ts.transpileModule(recoveryNode.getText(rendererAst), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function runRecovery({ top, bottom, items, rows, margin = top, mode = "element" }) {
  const measured = [];
  const margins = [];
  const elements = rows.map(row => ({ dataset: { index: String(row.index) }, getBoundingClientRect: () => row }));
  const root = { scrollTop: 0, clientHeight: 600, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
  const container = {
    dataset: {},
    closest: () => root,
    getBoundingClientRect: () => ({ top, bottom }),
    querySelector: selector => elements.find(row => selector.includes(`"${row.dataset.index}"`)) ?? null,
    querySelectorAll: () => elements,
  };
  const hook = new Function("useRef", "useLayoutEffect", "window",
    "inspectReaderViewportCoverage", "inspectReaderViewportUnion",
    recoveryCode + "\nreturn useVisibleVirtualGapRecovery;")(
    value => ({ current: value }), effect => effect(),
    { innerHeight: 600, scrollY: 0, performance: { now: () => 1000 } },
    inspectReaderViewportCoverage, inspectReaderViewportUnion,
  );
  hook({ current: container }, items, mode, margin, value => margins.push(value), row => measured.push(row));
  return { measured, margins, container };
}

for (const mode of ["element", "window"]) {
  test(`${mode} recovery only checks the visible part of its own message`, () => {
    for (const [top, bottom] of [[200, 450], [-200, 200]]) {
      const result = runRecovery({
        top, bottom, mode,
        items: [{ index: 0, start: top, end: bottom }],
        rows: [{ index: 0, top, bottom }],
      });
      assert.equal(result.measured.length, 0);
      assert.equal(result.container.dataset.readerVirtualRecovery, undefined);
    }
  });
  test(`${mode} stale margin is corrected before interpreting old range geometry`, () => {
    const result = runRecovery({
      top: 100, bottom: 500, mode, margin: 0,
      items: [{ index: 0, start: 0, end: 400 }],
      rows: [{ index: 0, top: 100, bottom: 500 }],
    });
    assert.deepEqual(result.margins, [100]);
    assert.equal(result.measured.length, 0);
  });
}

test("confirmed missing row recovery remeasures mounted rows without resetting the virtualizer", () => {
  const result = runRecovery({
    top: 0, bottom: 600,
    items: [{ index: 0, start: 0, end: 200 }, { index: 2, start: 400, end: 600 }],
    rows: [{ index: 0, top: 0, bottom: 200 }, { index: 2, top: 400, bottom: 600 }],
  });
  assert.equal(result.measured.length, 2);
  assert.doesNotMatch(recoveryCode, /recoverVirtualizer|\.measure\(/);
  assert.doesNotMatch(recoveryCode, /querySelectorAll[^;]*data-reader-virtual-spacer/);
});

test("user intent releases a geometry lease and programmatic geometry is not persisted", () => {
  const reader = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
  const mark = reader.slice(reader.indexOf("const markReaderScrollIntent ="), reader.indexOf("const markReaderScrollIntent =") + 1700);
  assert.match(mark, /geometryTransitionRef\.current \+= 1;\s*if \(root\) delete root\.dataset\.readerGeometryCompensating/);
  const persist = reader.slice(reader.indexOf("const persist = () =>"), reader.indexOf("const persistWhenIdle ="));
  assert.match(persist, /readerGeometryCompensating === "true"/);
  assert.match(persist, /readerSurfaceCompensating === "true"/);
});

test("an actual blank band inside the viewport is reported", () => {
  const result = inspectReaderViewportUnion([
    { start: 0, end: 180 },
    { start: 460, end: 620 },
  ], 0, 600, 32);

  assert.equal(result.needsRecovery, true);
  assert.equal(result.internalGap, 280);
});
