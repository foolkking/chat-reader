import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/use-mobile-header-auto-hide.ts", import.meta.url), "utf8");
const reader = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const property = "--reader-mobile-header-height";

// Actual transpiled sizing callback, with explicit size/observer/style doubles.
// These probes do not claim browser geometry, layout timing or real-device cost.
function fixture(initialHeight = 132, previous = "") {
  const values = new Map(previous ? [[property, previous]] : []), writes = [], observers = [];
  const parent = { style: {
    getPropertyValue: key => values.get(key) ?? "",
    setProperty: (key, value) => { writes.push([key, value]); values.set(key, value); },
    removeProperty: key => values.delete(key),
  } };
  Object.defineProperty(parent, "scrollTop", { get() { throw new Error("Sizing must not read or change scroll position"); }, set() { throw new Error("Sizing must not manufacture scrolling"); } });
  const header = { parentElement: parent, offsetHeight: initialHeight };
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(element, options) { this.element = element; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", "ResizeObserver", compiled)(module, module.exports, () => ({}), Observer);
  const bind = module.exports.reserveMobileReaderHeaderSpace;
  assert.equal(typeof bind, "function", "The fixed pt-14 reserve needs an actual mounted-header size owner");
  return { bind, header, parent, values, writes, observers };
}

test("Reader wires a measured mobile header reserve and native scroll padding, leaving desktop normal flow", () => {
  assert.match(reader, /ref=\{reserveMobileReaderHeaderSpace\}[^>]*data-testid="mobile-reader-header"/);
  assert.match(reader, /pt-\[var\(--reader-mobile-header-height,3\.5rem\)\]/);
  assert.match(reader, /scroll-pt-\[var\(--reader-mobile-header-height,3\.5rem\)\]/);
  assert.match(reader, /md:pt-0/); assert.match(reader, /md:scroll-pt-0/);
});

test("the first mounted reserve includes the entire wrapped guide and header border", () => {
  const f = fixture(); const cleanup = f.bind(f.header);
  assert.equal(f.values.get(property), "132px"); assert.equal(f.observers.length, 1);
  assert.equal(f.observers[0].element, f.header);
  assert.deepEqual(f.observers[0].options, { box: "border-box" });
  assert.equal(typeof cleanup, "function"); cleanup();
});

test("locale wrapping and dismissing the guide update the reserve only when its size changes", () => {
  const f = fixture(); const cleanup = f.bind(f.header);
  f.header.offsetHeight = 156; f.observers[0].callback();
  assert.equal(f.values.get(property), "156px");
  f.header.offsetHeight = 60; f.observers[0].callback();
  assert.equal(f.values.get(property), "60px");
  assert.equal(f.writes.length, 3); cleanup();
});

test("auto-hide transforms do not collapse reserved space or add repeated style writes", () => {
  const f = fixture(); const cleanup = f.bind(f.header);
  for (let index = 0; index < 20; index += 1) f.observers[0].callback();
  assert.equal(f.values.get(property), "132px"); assert.equal(f.writes.length, 1); cleanup();
});

test("null or detached headers do not create an observer", () => {
  const f = fixture(); assert.equal(f.bind(null), undefined);
  assert.equal(f.bind({ parentElement: null, offsetHeight: 60 }), undefined);
  assert.equal(f.observers.length, 0); assert.equal(f.writes.length, 0);
});

test("hidden or invalid measurements keep the last meaningful size", () => {
  const f = fixture(); const cleanup = f.bind(f.header);
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    f.header.offsetHeight = value; f.observers[0].callback();
    assert.equal(f.values.get(property), "132px");
  }
  assert.equal(f.writes.length, 1); cleanup();
});

test("unmount disconnects the observer, removes its property and ignores late callbacks", () => {
  const f = fixture(); const cleanup = f.bind(f.header); cleanup();
  assert.equal(f.observers[0].disconnected, true); assert.equal(f.values.has(property), false);
  f.header.offsetHeight = 500; f.observers[0].callback();
  assert.equal(f.values.has(property), false); assert.equal(f.writes.length, 1);
});

test("cleanup restores an earlier value but does not overwrite a newer owner's value", () => {
  const f = fixture(132, "72px"); const cleanup = f.bind(f.header); cleanup();
  assert.equal(f.values.get(property), "72px");
  const next = f.bind(f.header); f.values.set(property, "204px"); next();
  assert.equal(f.values.get(property), "204px");
});

test("replacing the actual header keeps one live observer and retires old callbacks", () => {
  const f = fixture(); const first = f.bind(f.header); first();
  const replacement = { ...f.header, offsetHeight: 168 }; const second = f.bind(replacement);
  f.header.offsetHeight = 333; f.observers[0].callback();
  assert.equal(f.values.get(property), "168px");
  assert.equal(f.observers.filter(item => !item.disconnected).length, 1); second();
});
