import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/sharing/share-readonly-reader.tsx");
const ast = ts.createSourceFile("share-readonly-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ShareReadonlyReader");
const selected = reader.body.statements.filter(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect"
  && (node.getText(ast).includes("const canPersist =") || node.getText(ast).includes("shouldDiscardSharePosition(shareQuery.error)")));
assert.equal(selected.length, 2);
const discardHelper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "shouldDiscardSharePosition");
const nodes = [];
const walk = node => { nodes.push(node); ts.forEachChild(node, walk); };
walk(reader);
const status = nodes.find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "p"
  && node.getText(ast).includes("positionStorageUnavailable"));
assert.ok(status);
assert.ok(status.parent.openingElement.getText(ast).includes("h-16"));
const compile = text => ts.transpileModule(text, { fileName: "share-storage-harness.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const inputs = ["navigationVisit", "storageIsCurrent", "storageKey", "positionStorageDisabledRef", "shareQuery",
  "setStorageKey", "setSavedPosition", "setPositionStorageUnavailable", "messages", "positionReady",
  "refreshActiveMessageFromLayout", "latestStablePositionRef", "messagesRef", "lastScrollTopRef",
  "userScrollIntentRef", "edgeTransitionRef", "scrollDirectionRef", "navigationTokenRef", "scrollIntentSequenceRef",
  "previousSentinelVisibleRef", "nextSentinelVisibleRef", "loadPreviousActionRef", "loadNextActionRef"];
const compiled = compile(`
  ${discardHelper.getText(ast)}
  exports.install = input => {
    const { ${inputs.join(", ")} } = input;
    ${selected.map(node => node.getText(ast)).join("\n")}
  };
  exports.status = (zh, storageIsCurrent, positionStorageUnavailable) => ${status.getText(ast)};
`);
const apiAst = ts.createSourceFile("api.ts", read("lib/api.ts"), ts.ScriptTarget.Latest, true);
const errorModule = {};
new Function("exports", compile(apiAst.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === "ApiRequestError").getText(apiAst)))(errorModule);
const { ApiRequestError } = errorModule;
const position = { message_id: "synthetic-storage-message", block_index: 3, scroll_offset: 7,
  anchor_data: { position_mode: "block-relative-v2", block_id: "synthetic-storage-block", block_offset: 7 },
  saved_at: "2026-10-15T00:00:00.000Z" };
const key = `chat-reader:share-position:${"ab".repeat(32)}`;
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const wiring = {};
new Function("exports", "require", "ApiRequestError", "useEffect", "window", "document", "captureSharePosition", compiled)(
  wiring, require, ApiRequestError, () => {}, {}, {}, () => null,
);

// Exact discard/persistence effect bodies, classification helper, error class
// and fixed-header status JSX. Hook commits, storage, position capture,
// listeners, time and layout-refresh callbacks are controlled adapters.
// Initialization/key/query rejection cases also live in the actual-source
// share-navigation-retirement regression; neither file is browser evidence.
function fixture() {
  const calls = { writes: [], removals: [], changes: [], captures: 0, refresh: [], timers: [] }, handlers = {};
  const events = new Map(), documentEvents = new Map(), timers = new Map(), frames = new Map();
  let now = 100, serial = 0, cursor = 0, pending = new Map();
  const effects = new Map();
  const state = { navigationVisit: { active: true }, storageIsCurrent: true, storageKey: key,
    positionStorageDisabledRef: { current: null }, shareQuery: { isError: false }, positionReady: true,
    savedPosition: position, positionStorageUnavailable: false, messages: [{ id: position.message_id }],
    latestStablePositionRef: { current: position }, messagesRef: { current: [{ id: position.message_id }] } };
  for (const [name, value] of Object.entries({
    lastScrollTopRef: 0, userScrollIntentRef: false, edgeTransitionRef: null, scrollDirectionRef: null,
    navigationTokenRef: 0, scrollIntentSequenceRef: 0, previousSentinelVisibleRef: false, nextSentinelVisibleRef: false,
    loadPreviousActionRef: () => {}, loadNextActionRef: () => {},
  })) state[name] = { current: value };
  for (const name of ["StorageKey", "SavedPosition", "PositionStorageUnavailable"]) {
    const field = name[0].toLowerCase() + name.slice(1);
    state[`set${name}`] = value => { state[field] = value; calls.changes.push([field, value]); };
  }
  state.refreshActiveMessageFromLayout = unlock => calls.refresh.push(unlock);
  const add = (map, name, callback) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(callback);
  };
  const emit = (map, name) => { for (const callback of [...(map.get(name) ?? [])]) callback(); };
  const window = {
    scrollY: 0, performance: { now: () => now },
    addEventListener: (name, callback) => add(events, name, callback),
    removeEventListener: (name, callback) => events.get(name)?.delete(callback),
    setTimeout: (callback, delay) => {
      const id = ++serial; calls.timers.push(delay); timers.set(id, { callback, due: now + delay }); return id;
    },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    localStorage: {
      setItem: (storageKey, bytes) => { calls.writes.push({ key: storageKey, bytes }); handlers.write?.(); },
      removeItem: storageKey => { calls.removals.push(storageKey); handlers.remove?.(); },
    },
  };
  const document = { visibilityState: "visible",
    addEventListener: (name, callback) => add(documentEvents, name, callback),
    removeEventListener: (name, callback) => documentEvents.get(name)?.delete(callback) };
  const exports = {};
  new Function("exports", "require", "ApiRequestError", "useEffect", "window", "document", "captureSharePosition", compiled)(
    exports, require, ApiRequestError, (effect, deps) => pending.set(cursor++, { effect, deps }), window, document,
    () => { calls.captures++; return position; },
  );
  const render = () => {
    cursor = 0; pending = new Map(); exports.install(state);
    const changed = [...pending].filter(([index, next]) => !same(effects.get(index)?.deps, next.deps));
    for (const [index] of changed) effects.get(index)?.cleanup?.();
    for (const [index, next] of changed) effects.set(index, { ...next, cleanup: next.effect() });
  };
  const advance = milliseconds => {
    now += milliseconds;
    for (;;) {
      const next = [...timers].find(([, timer]) => timer.due <= now);
      if (!next) break;
      timers.delete(next[0]); next[1].callback();
    }
  };
  render();
  return { state, calls, handlers, events, frames, timers, render, advance,
    scroll() { window.scrollY += 10; emit(events, "scroll"); },
    pagehide() { emit(events, "pagehide"); },
    hide() { document.visibilityState = "hidden"; emit(documentEvents, "visibilitychange"); },
    dispose() { for (const entry of effects.values()) entry.cleanup?.(); effects.clear(); },
  };
}

test("successful idle saving retains the exact key/bytes and cached unload does not recapture", () => {
  const f = fixture();
  try {
    f.scroll(); f.advance(500); f.scroll(); f.advance(500);
    assert.deepEqual(f.calls.writes, []); // Waits for 1,000 ms idle after the newer scroll.
    f.advance(500);
    assert.deepEqual(f.calls.writes, [{ key, bytes: JSON.stringify(position) }]);
    assert.equal(f.calls.captures, 1);
    f.pagehide(); f.hide();
    assert.equal(f.calls.writes.length, 3);
    assert.ok(f.calls.writes.every(write => write.key === key && write.bytes === JSON.stringify(position)));
    assert.equal(f.calls.captures, 1);
    assert.equal(f.state.positionStorageUnavailable, false);
  } finally { f.dispose(); }
});

test("a quota/access failure is contained once, disables before rerender and preserves readable state", () => {
  const f = fixture();
  try {
    f.handlers.write = () => { throw Error("Synthetic private quota detail"); };
    f.scroll(); f.advance(1000);
    assert.equal(f.calls.writes.length, 1);
    assert.equal(f.state.positionStorageDisabledRef.current, f.state.navigationVisit);
    assert.equal(f.state.storageKey, null);
    assert.equal(f.state.positionStorageUnavailable, true);
    f.pagehide(); f.hide(); f.scroll(); f.advance(5000);
    assert.equal(f.calls.writes.length, 1);
    f.render(); f.pagehide(); f.scroll(); f.advance(5000);
    assert.equal(f.calls.writes.length, 1);
    assert.equal(f.state.messages.length, 1);
    assert.equal(f.state.positionReady, true);
    assert.equal(JSON.stringify(f.calls.changes).includes("Synthetic private"), false);
  } finally { f.dispose(); }
});

for (const rejected of [false, true]) {
  test(`permanent-access removal ${rejected ? "failure" : "success"} cannot be undone by a retained writer`, () => {
    const f = fixture(), oldPagehide = [...f.events.get("pagehide")][0];
    try {
      if (rejected) f.handlers.remove = () => { throw Error("Synthetic denied removal"); };
      f.state.shareQuery = { isError: true, error: new ApiRequestError("Synthetic access failure", 404, "/synthetic") };
      f.render();
      assert.deepEqual(f.calls.removals, [key]);
      assert.equal(f.state.positionStorageDisabledRef.current, f.state.navigationVisit);
      assert.equal(f.state.storageKey, null);
      assert.equal(f.state.savedPosition, null);
      assert.equal(f.state.positionStorageUnavailable, rejected);
      oldPagehide(); f.pagehide(); f.scroll(); f.advance(5000);
      assert.deepEqual(f.calls.writes, []);
      f.render(); assert.deepEqual(f.calls.removals, [key]);
    } finally { f.dispose(); }
  });
}

for (const status of [401, 408, 429, 500, 503]) {
  test(`${status}: password/transient access outcomes retain the existing position policy`, () => {
    const f = fixture();
    try {
      f.state.shareQuery = { isError: true, error: new ApiRequestError("Synthetic transient failure", status, "/synthetic") };
      f.render();
      assert.deepEqual(f.calls.removals, []);
      assert.equal(f.state.storageKey, key);
      assert.equal(f.state.savedPosition, position);
      assert.equal(f.state.positionStorageDisabledRef.current, null);
    } finally { f.dispose(); }
  });
}

for (const retirement of ["visit", "cleanup", "wrong storage visit"]) {
  test(`${retirement}: old unload/timer/frame callbacks cannot write or publish layout tracking`, () => {
    const f = fixture();
    try {
      f.scroll();
      const oldPagehide = [...f.events.get("pagehide")][0],
        oldTimers = [...f.timers.values()].map(timer => timer.callback), oldFrames = [...f.frames.values()];
      if (retirement === "visit") f.state.navigationVisit.active = false;
      else if (retirement === "cleanup") f.dispose();
      else { f.state.storageIsCurrent = false; f.render(); }
      oldPagehide(); for (const callback of oldTimers) callback(); for (const callback of oldFrames) callback();
      f.advance(5000);
      assert.deepEqual(f.calls.writes, []);
      assert.deepEqual(f.calls.refresh, []);
      assert.equal(f.calls.captures, 0);
    } finally { f.dispose(); }
  });
}

test("finite storage status reuses the fixed-height header and does not show an older visit's warning", () => {
  for (const [zh, warning] of [[false, "Progress not saved"], [true, "本机进度无法保存"]]) {
    const failed = renderToStaticMarkup(wiring.status(zh, true, true));
    assert.match(failed, new RegExp(warning));
    assert.match(failed, /role="status"/);
    assert.match(failed, /truncate/);
    assert.equal(failed.includes("Synthetic private"), false);
    for (const [current, unavailable] of [[false, true], [true, false]]) {
      assert.equal(renderToStaticMarkup(wiring.status(zh, current, unavailable)).includes(warning), false);
    }
  }
});
