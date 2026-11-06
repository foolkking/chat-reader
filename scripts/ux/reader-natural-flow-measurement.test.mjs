import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { Virtualizer } = require("@tanstack/react-virtual");
const source = readFileSync(new URL("../../apps/web/features/conversations/assistant-message-renderer.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("assistant-message-renderer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["useReaderVirtualRowMeasurement", "buildVirtualFlow"]);
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(helpers.length, 2);
const compiled = ts.transpileModule(helpers.map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { useReaderVirtualRowMeasurement, buildVirtualFlow } = new Function("useCallback",
  `${compiled}\nreturn {useReaderVirtualRowMeasurement, buildVirtualFlow};`)(callback => callback);

function row(index, height = 117.28125) {
  return { isConnected: true, height,
    getAttribute: name => name === "data-index" ? String(index) : null,
    hasAttribute: name => name === "data-index",
    getBoundingClientRect() { return { height: this.height }; },
  };
}

// Actual installed TanStack core + actual Reader measurement/flow helpers.
// A scrolling ref mounts and unmounts before its asynchronous ResizeObserver
// arrives, as in the CI's 31/32 boundary oscillation. No alternate virtualizer.
function fixture() {
  const writes = [];
  const virtualizer = new Virtualizer({
    count: 100, getScrollElement: () => null, getItemKey: index => index,
    estimateSize: () => 92, initialRect: { width: 600, height: 500 }, initialOffset: 3100,
    observeElementRect: () => () => {}, observeElementOffset: () => () => {},
    scrollToFn: (...args) => writes.push(args),
    measureElement: element => element.getBoundingClientRect().height,
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  virtualizer.getMeasurements();
  virtualizer.isScrolling = true;
  const measure = useReaderVirtualRowMeasurement(virtualizer);
  const targetTop = first => {
    const items = virtualizer.getMeasurements().slice(first, 35);
    const flow = buildVirtualFlow(items, 0, virtualizer.getTotalSize());
    let top = 0;
    for (const { item, gapBefore } of flow.rows) {
      top += gapBefore;
      if (item.index === 33) return top;
      top += item.index === 31 ? 117.28125 : 92;
    }
    throw new Error("The real target must remain mounted.");
  };
  return { virtualizer, writes, measure, targetTop };
}

test("scrolling natural-flow rows cache their geometry before the first possible unmount", () => {
  const f = fixture(), node = row(31);
  f.virtualizer.measureElement(node);
  assert.equal(f.virtualizer.itemSizeCache.has(31), false, "Installed default defers this ref measurement.");
  assert.equal(f.targetTop(31) - f.targetTop(32), 25.28125, "The unmeasured boundary reproduces CI's geometry delta.");
  f.measure(node);
  assert.equal(f.virtualizer.itemSizeCache.get(31), 117.28125);
  assert.equal(f.targetTop(31), f.targetTop(32), "Removing a row replaces it with its real size, not an estimate.");
  assert.equal(f.writes.length, 0, "Measurement is not a second position writer.");
});

test("rapid range boundary changes cannot add and remove the same 25.28125px", () => {
  const f = fixture(), node = row(31);
  f.measure(node);
  const top = f.targetTop(31);
  for (let i = 0; i < 12; i++) {
    node.isConnected = false; f.measure(null);
    assert.equal(f.targetTop(32), top);
    node.isConnected = true; f.measure(node);
    assert.equal(f.targetTop(31), top);
  }
  assert.equal(f.writes.length, 0);
});

test("an explicit typography remeasure during scrolling updates only the affected row", () => {
  const f = fixture(), node = row(31);
  f.virtualizer.resizeItem(20, 130);
  f.measure(node); node.height = 140.5; f.measure(node);
  assert.equal(f.virtualizer.itemSizeCache.get(31), 140.5);
  assert.equal(f.virtualizer.itemSizeCache.get(20), 130);
  assert.equal(f.virtualizer.itemSizeCache.size, 2);
  assert.equal(f.writes.length, 0);
});

test("idle refs keep TanStack's regular measurement and null refs keep observer cleanup", () => {
  const f = fixture(), node = row(31);
  f.virtualizer.isScrolling = false; f.measure(node);
  assert.equal(f.virtualizer.itemSizeCache.get(31), 117.28125);
  assert.equal(f.virtualizer.elementsCache.get(31), node);
  node.isConnected = false; f.measure(null);
  assert.equal(f.virtualizer.elementsCache.has(31), false);
  assert.equal(f.virtualizer.itemSizeCache.get(31), 117.28125, "Unmount must not discard the spacer's size.");
});

test("disconnected or zero-height scrolling rows cannot poison a measured spacer", () => {
  const f = fixture(), node = row(31);
  f.measure(node); node.isConnected = false; node.height = 0; f.measure(node);
  assert.equal(f.virtualizer.itemSizeCache.get(31), 117.28125);
  node.isConnected = true; f.measure(node);
  assert.equal(f.virtualizer.itemSizeCache.get(31), 117.28125);
  node.height = Number.NaN; f.measure(node);
  assert.equal(f.virtualizer.itemSizeCache.get(31), 117.28125);
});

for (const name of ["ElementVirtualizedBlocks", "WindowVirtualizedBlocks"]) {
  test(`${name} routes refs, explicit layout measurement and gap recovery through the same actual helper`, () => {
    const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
    assert.match(component, /const measureRow = useReaderVirtualRowMeasurement\(virtualizer\)/);
    assert.match(component, /useVirtualLayoutMeasurements\([\s\S]*?virtualizer\.measure,\s*measureRow,/);
    assert.match(component, /useVisibleVirtualGapRecovery\([\s\S]*?measureRow,/);
    assert.match(component, /<VirtualBlockRow[^>]*measureElement=\{measureRow\}/);
    assert.doesNotMatch(component, /virtualizer\.measureElement/);
    assert.match(component, /readerGeometryOwner === "viewport"\) return false/);
  });
}
