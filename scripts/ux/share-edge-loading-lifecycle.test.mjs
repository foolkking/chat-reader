import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/sharing/share-readonly-reader.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("share-readonly-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ShareReadonlyReader");
const edgeFunctions = new Map();
const visit = node => {
  if (ts.isFunctionDeclaration(node) && ["loadPreviousPage", "loadNextPage"].includes(node.name?.text)) {
    edgeFunctions.set(node.name.text, node);
  }
  ts.forEachChild(node, visit);
};
visit(reader);
assert.equal(edgeFunctions.size, 2);
assert.match(edgeFunctions.get("loadPreviousPage").getText(ast), /navigationVisit\.active\s*&&/);
assert.match(edgeFunctions.get("loadNextPage").getText(ast), /navigationVisit\.active\s*&&/);
for (const name of ["loadPreviousPage", "loadNextPage"]) {
  const text = edgeFunctions.get(name).getText(ast);
  assert.match(text, /if \(transitionIsCurrent\(\)\) setEdgeError/);
  assert.match(text, /if \(navigationVisit\.active\) \{\s*setEdgeLoading/);
}

const compile = text => ts.transpileModule(text, {
  fileName: "share-edge-loading-harness.ts",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const compiled = compile(`
function renderEdges(input) {
  const {
    token, navigationVisit, loadedWindowRef, previousTurnAnchorRef, nextTurnAnchorRef,
    loadingPreviousRef, loadingNextRef, edgeTransitionRef, scrollDirectionRef,
    setEdgeLoading, setEdgeError, applyLoadedWindow, loadSharedCompleteTurnWindow,
    captureScrollAnchor, acquireShareScrollAnchorLease, mergeLoadedTurnWindow,
    syncShareTurnAnchors, notifyReaderWindowLayoutChanged, restoreScrollAnchor,
    trimLoadedTurnWindow, messageIdForShareAnchor, ACTIVE_READING_OFFSET,
  } = input;
  ${edgeFunctions.get("loadPreviousPage").getText(ast)}
  ${edgeFunctions.get("loadNextPage").getText(ast)}
  return { previous: loadPreviousPage, next: loadNextPage };
}
exports.renderEdges = renderEdges;
`);
const exports = {};
new Function("exports", compiled)(exports);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const page = { items: [{ id: "synthetic-next-message" }], hasPrevious: false, hasMore: false };
const currentWindow = () => ({
  generation: 4, items: [{ id: "synthetic-current-message" }], hasPrevious: true,
  hasMore: true,
});

function fixture() {
  const calls = { loads: [], merged: 0, anchors: 0, restores: 0, leases: 0, releases: 0,
    layout: 0, errors: [], loading: [] };
  const state = { edgeLoading: null };
  const input = {
    token: "synthetic-share", navigationVisit: { active: true },
    loadedWindowRef: { current: currentWindow() },
    previousTurnAnchorRef: { current: "synthetic-previous-anchor" },
    nextTurnAnchorRef: { current: "synthetic-next-anchor" },
    loadingPreviousRef: { current: false }, loadingNextRef: { current: false },
    edgeTransitionRef: { current: null }, scrollDirectionRef: { current: "up" },
    setEdgeLoading: updater => {
      state.edgeLoading = typeof updater === "function" ? updater(state.edgeLoading) : updater;
      calls.loading.push(state.edgeLoading);
    },
    setEdgeError: value => calls.errors.push(value),
    applyLoadedWindow: value => { input.loadedWindowRef.current = value; calls.merged++; },
    loadSharedCompleteTurnWindow: async (token, anchor) => {
      calls.loads.push({ token, anchor });
      return input.load?.(token, anchor);
    },
    captureScrollAnchor: () => { calls.anchors++; return null; },
    acquireShareScrollAnchorLease: async () => {
      calls.leases++;
      return { release: () => { calls.releases++; } };
    },
    mergeLoadedTurnWindow: (current, loaded) => ({ ...current, ...loaded, generation: current.generation }),
    syncShareTurnAnchors: () => undefined,
    notifyReaderWindowLayoutChanged: () => { calls.layout++; },
    restoreScrollAnchor: async () => { calls.restores++; return true; },
    trimLoadedTurnWindow: value => value,
    messageIdForShareAnchor: () => "synthetic-anchor",
    ACTIVE_READING_OFFSET: 96,
  };
  const render = () => { input.edges = exports.renderEdges(input); return input; };
  render();
  return { input, calls, state, render };
}

test("current edge success keeps existing merge/feedback path and releases its transition", async () => {
  const f = fixture();
  f.input.load = async () => page;
  const result = f.input.edges.previous();
  await result;
  assert.deepEqual(f.calls.loads, [{ token: "synthetic-share", anchor: "synthetic-previous-anchor" }]);
  assert.equal(f.calls.merged, 1);
  assert.deepEqual(f.calls.errors, [null], "a new edge attempt clears prior feedback without publishing an error");
  assert.equal(f.input.edgeTransitionRef.current, null);
  assert.equal(f.input.loadingPreviousRef.current, false);
  assert.equal(f.state.edgeLoading, null);
});

for (const direction of ["previous", "next"]) {
  test(`${direction} invocation after visit retirement starts no read or UI work`, async () => {
    const f = fixture();
    f.input.navigationVisit.active = false;
    f.input.load = async () => page;
    await f.input.edges[direction]();
    assert.deepEqual(f.calls.loads, []);
    assert.deepEqual(f.calls.loading, []);
    assert.deepEqual(f.calls.errors, []);
    assert.equal(f.calls.merged, 0); assert.equal(f.calls.anchors, 0); assert.equal(f.calls.restores, 0);
    assert.equal(f.input.loadingPreviousRef.current, false); assert.equal(f.input.loadingNextRef.current, false);
    assert.equal(f.input.edgeTransitionRef.current, null);
  });
  test(`${direction} current failure retains actionable feedback and releases loading`, async () => {
    const f = fixture();
    f.input.scrollDirectionRef.current = direction === "previous" ? "up" : "down";
    f.input.load = async () => { throw new Error("Synthetic current edge failure"); };
    await f.input.edges[direction]();
    assert.equal(f.calls.loads.length, 1);
    assert.deepEqual(f.calls.errors, [null, direction]);
    assert.deepEqual(f.calls.loading, [direction, null]);
    assert.equal(f.input.edgeTransitionRef.current, null);
    assert.equal(f.calls.merged, 0);
  });
  test(`${direction} completion after visit retirement cannot merge, capture, restore, error or publish loading`, async () => {
    const f = fixture(), hold = deferred();
    f.input.load = () => hold.promise;
    const pending = f.input.edges[direction]();
    await setImmediate();
    assert.deepEqual(f.calls.errors, [null], "only the current attempt's initial clear is allowed");
    const beforeRetirement = f.calls.errors.length;
    f.input.navigationVisit.active = false;
    hold.resolve(page);
    await pending;
    assert.equal(f.calls.merged, 0);
    assert.equal(f.calls.anchors, 0);
    assert.equal(f.calls.restores, 0);
    assert.deepEqual(f.calls.errors.slice(beforeRetirement), []);
    assert.deepEqual(f.calls.loading, ["previous" === direction ? "previous" : "next"]);
  });
}

for (const direction of ["previous", "next"]) {
  test(`${direction} rejection after direction reversal does not publish stale error`, async () => {
    const f = fixture(), hold = deferred();
    f.input.load = () => hold.promise;
    const pending = f.input.edges[direction]();
    await setImmediate();
    assert.deepEqual(f.calls.errors, [null]);
    const beforeReversal = f.calls.errors.length;
    f.input.scrollDirectionRef.current = direction === "previous" ? "down" : "up";
    hold.reject(new Error("synthetic stale edge failure"));
    await pending;
    assert.deepEqual(f.calls.errors.slice(beforeReversal), []);
    assert.equal(f.input.edgeTransitionRef.current, null);
  });
}
