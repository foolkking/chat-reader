import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/attachments/attachment-viewer.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("attachment-viewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Set(["finishViewerScrollLock", "acquireViewerScrollLock", "releaseViewerScrollLock"]);
const declarations = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && functions.has(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => /^viewer(?:Scroll|Previous|Reader|Release)/.test(item.name.getText(ast))));
const shell = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AttachmentViewerShell");
const calls = shell.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression));
const lock = calls.find(node => node.expression.expression.getText(ast) === "useLayoutEffect"
  && node.getText(ast).includes("acquireViewerScrollLock"));
const focus = calls.find(node => node.expression.expression.getText(ast) === "useDialogFocus");
assert.ok(lock && focus && lock.pos < focus.pos, "Capture the scroller before modal focus, not in a later passive effect.");
const compiled = ts.transpileModule(`
  ${declarations.map(node => node.getText(ast)).join("\n")}
  exports.acquire = acquireViewerScrollLock;
  exports.release = releaseViewerScrollLock;
  exports.mount = session => { ${lock.getText(ast)} };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

// Actual lock helpers and mounted layout effect. Browser layout/scroll dispatch
// and the modal's DOM are controlled here; full-frame browser proof is separate.
function fixture() {
  let serial = 0, cleanup;
  const frames = new Map(), scrolls = [], released = [];
  class Root extends EventTarget {
    dataset = {}; scrollTop = 80;
    getBoundingClientRect() { return { top: 50 }; }
  }
  const document = { body: { style: { overflow: "auto" } }, documentElement: new Root() };
  const window = {
    scrollX: 7, scrollY: 500,
    scrollTo(options) {
      assert.equal("x" in options || "y" in options, false, "ScrollToOptions only accepts left/top.");
      scrolls.push({ ...options });
      if (options.left !== undefined) this.scrollX = options.left;
      if (options.top !== undefined) this.scrollY = options.top;
    },
    scrollBy(options) { this.scrollY += options.top; scrolls.push({ delta: options.top }); },
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const root = new Root(), other = new Root();
  for (const value of [document.documentElement, root, other])
    value.addEventListener("chat-reader:position-released", () => released.push(value));
  const trigger = (scroller = document.documentElement) => ({
    isConnected: true, flowTop: 800,
    closest() { return scroller === document.documentElement ? null : scroller; },
    getBoundingClientRect() {
      return { top: this.flowTop - (scroller === document.documentElement ? window.scrollY : scroller.scrollTop)
        + (scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top) };
    },
  });
  const exports = {};
  new Function("exports", "window", "document", "useLayoutEffect", compiled)(
    exports, window, document, effect => { cleanup = effect(); },
  );
  return { ...exports, window, document, root, other, trigger, frames, scrolls, released,
    unmount: () => cleanup(),
    frame() { const tasks = [...frames.values()]; frames.clear(); tasks.forEach(task => task()); },
  };
}

test("Viewer layout effect captures window left/top before focus and fences native return events for one frame", () => {
  const f = fixture(), trigger = f.trigger();
  f.mount({ trigger });
  assert.equal(f.document.body.style.overflow, "hidden");
  assert.equal(f.document.documentElement.dataset.readerViewerLocked, "true");
  // Simulate a browser focus/virtualization scroll after layout-effect capture.
  f.window.scrollX = 0; f.window.scrollY = 3;
  f.unmount();
  assert.deepEqual(f.scrolls, [{ left: 7, top: 500, behavior: "auto" }]);
  assert.equal(trigger.getBoundingClientRect().top, 300);
  assert.equal(f.document.body.style.overflow, "auto");
  assert.equal(f.document.documentElement.dataset.readerLastScrollWriter, "viewer");
  assert.equal(f.document.documentElement.dataset.readerViewerLocked, "true");
  f.frame();
  assert.equal(f.document.documentElement.dataset.readerViewerLocked, undefined);
  assert.deepEqual(f.released, [f.document.documentElement]);
  assert.equal(f.frames.size, 0);
});

test("return compensates the real trigger's changed geometry exactly once, not an old scroll loop", () => {
  const f = fixture(), trigger = f.trigger();
  f.acquire(trigger);
  trigger.flowTop += 35;
  f.window.scrollY = 0;
  f.release();
  assert.equal(f.window.scrollY, 535);
  assert.equal(trigger.getBoundingClientRect().top, 300);
  assert.deepEqual(f.scrolls, [{ left: 7, top: 500, behavior: "auto" }, { delta: 35 }]);
  f.frame();
  f.window.scrollY += 20; f.frame();
  assert.equal(f.window.scrollY, 555, "No delayed restoration overrides subsequent reading.");
});

test("Compare returns to the originating occurrence without moving the other pane", () => {
  const f = fixture(), trigger = f.trigger(f.root);
  f.other.scrollTop = 240;
  f.acquire(trigger);
  trigger.flowTop += 45; f.root.scrollTop = 180;
  f.release();
  assert.equal(f.root.scrollTop, 125);
  assert.equal(trigger.getBoundingClientRect().top - f.root.getBoundingClientRect().top, 720);
  assert.equal(f.other.scrollTop, 240);
  assert.equal(f.other.dataset.readerViewerLocked, undefined);
  f.frame();
  assert.deepEqual(f.released, [f.root]);
});

test("a removed occurrence falls back only within its original element scroller", () => {
  const f = fixture(), trigger = f.trigger(f.root);
  f.acquire(trigger);
  trigger.isConnected = false; f.root.scrollTop = 300; f.other.scrollTop = 240;
  f.release(); f.frame();
  assert.equal(f.root.scrollTop, 80);
  assert.equal(f.other.scrollTop, 240);
});

test("nested owners retain the lock until the last release and preserve a previous dataset value", () => {
  const f = fixture(), trigger = f.trigger();
  f.document.documentElement.dataset.readerViewerLocked = "false";
  f.acquire(trigger); f.acquire(trigger);
  f.release();
  assert.equal(f.document.body.style.overflow, "hidden");
  assert.equal(f.scrolls.length, 0);
  f.release(); f.frame();
  assert.equal(f.document.body.style.overflow, "auto");
  assert.equal(f.document.documentElement.dataset.readerViewerLocked, "false");
  assert.deepEqual(f.released, [f.document.documentElement]);
});

test("reopening before the release frame cannot let the previous callback clear the new lock", () => {
  const f = fixture();
  f.acquire(f.trigger()); f.release();
  assert.equal(f.frames.size, 1);
  f.acquire(f.trigger(f.root));
  assert.equal(f.frames.size, 0);
  assert.equal(f.document.documentElement.dataset.readerViewerLocked, undefined);
  f.frame();
  assert.equal(f.root.dataset.readerViewerLocked, "true");
  assert.equal(f.document.body.style.overflow, "hidden");
  f.release(); f.frame();
  assert.equal(f.root.dataset.readerViewerLocked, undefined);
  assert.deepEqual(f.released, [f.document.documentElement, f.root]);
});
