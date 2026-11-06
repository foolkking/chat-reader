import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/features/conversations/reading-viewport.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture() {
  const observers = [], frames = new Map(), cancelled = [], corrections = [];
  let next = 0, busy = false;
  class Element extends EventTarget {
    dataset = {}; style = { overflowAnchor: "auto" }; scrollTop = 0; flowTop = 150; isConnected = true;
    contains(node) { return node === this.target; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 600 }; }
  }
  class KeyboardEvent extends Event { constructor(key) { super("keydown"); this.key = key; } }
  const root = new Element(), second = new Element();
  for (const [index, scroller] of [root, second].entries()) {
    scroller.target = { id: `target-${index}`, isConnected: true,
      getBoundingClientRect: () => ({ top: scroller.flowTop - scroller.scrollTop, left: 0, width: 500 }),
    };
    scroller.addEventListener("chat-reader:geometry-correction", event => corrections.push({ scroller, ...event.detail }));
  }
  const document = { documentElement: new Element(), getElementById: id => [root.target, second.target].find(node => node.id === id) };
  const exports = {};
  new Function("exports", "require", "document", "window", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "KeyboardEvent", "Node", compiled)(
    exports, name => {
      assert.equal(name, "./reader-navigation");
      return { captureScrollAnchor: scroller => ({ targetId: scroller.target.id, offset: scroller.target.getBoundingClientRect().top }),
        cancelReaderPosition: scroller => { cancelled.push(scroller); busy = false; }, readerPositionBusy: () => busy };
    }, document, {}, class {
      constructor(callback) { this.callback = callback; this.closed = false; observers.push(this); }
      observe() {} unobserve() {} disconnect() { this.closed = true; }
    }, callback => { frames.set(++next, callback); return next; }, id => frames.delete(id), KeyboardEvent, { TEXT_NODE: 3 },
  );
  return { ...exports, root, second, observers, cancelled, corrections, KeyboardEvent,
    content: scroller => ({ closest: () => scroller }), setBusy: value => { busy = value; },
    frame: () => { const tasks = [...frames.values()]; frames.clear(); tasks.forEach(task => task()); },
    resize: () => observers.filter(observer => !observer.closed).forEach(observer => observer.callback()),
  };
}
test("one owner corrects the actual delta once for all messages in one scroller", () => {
  const f = fixture(), release1 = f.observeReadingViewport(f.content(f.root)), release2 = f.observeReadingViewport(f.content(f.root));
  f.frame();
  assert.equal(f.observers.length, 1);
  f.root.flowTop += 40; f.resize(); f.resize();
  assert.equal(f.root.scrollTop, 40);
  assert.equal(f.corrections.length, 1);
  assert.equal(f.root.target.getBoundingClientRect().top, 150);
  release1(); assert.equal(f.observers[0].closed, false);
  release2(); assert.equal(f.observers[0].closed, true);
  assert.equal(f.root.style.overflowAnchor, "auto");
});
test("real input cancels old navigation and user scrolling is never undone", () => {
  const f = fixture(), release = f.observeReadingViewport(f.content(f.root));
  f.frame(); f.setBusy(true);
  f.root.dispatchEvent(new Event("wheel"));
  assert.deepEqual(f.cancelled, [f.root]);
  f.root.scrollTop = 80; f.root.dispatchEvent(new Event("scroll"));
  f.resize();
  assert.equal(f.root.scrollTop, 80);
  assert.equal(f.corrections.length, 0);
  f.frame(); f.root.flowTop += 12; f.resize();
  assert.equal(f.root.scrollTop, 92);
  release();
});
test("explicit navigation owns its layout round and independent Compare scrollers never cross-compensate", () => {
  const f = fixture(), release1 = f.observeReadingViewport(f.content(f.root)), release2 = f.observeReadingViewport(f.content(f.second));
  f.frame(); f.setBusy(true);
  f.root.flowTop += 100; f.resize();
  assert.equal(f.root.scrollTop, 0);
  f.setBusy(false);
  f.root.dispatchEvent(new Event("chat-reader:position-released")); f.frame();
  f.root.flowTop += 10; f.resize();
  assert.equal(f.root.scrollTop, 10);
  assert.equal(f.second.scrollTop, 0);
  release1(); release2();
});

test("Viewer owns only its scroller; modal input and its return cannot revive a stale geometry anchor", () => {
  const f = fixture(), release1 = f.observeReadingViewport(f.content(f.root)), release2 = f.observeReadingViewport(f.content(f.second));
  f.frame();
  f.root.dataset.readerViewerLocked = "true";
  for (const type of ["pointerdown", "wheel", "touchstart", "touchmove"]) f.root.dispatchEvent(new Event(type));
  f.root.dispatchEvent(new f.KeyboardEvent("ArrowDown"));
  assert.deepEqual(f.cancelled, []);
  f.root.flowTop += 90; f.second.flowTop += 12; f.resize(); f.frame();
  assert.equal(f.root.scrollTop, 0);
  assert.equal(f.second.scrollTop, 12);
  // The viewer restores its real occurrence before releasing ownership. The
  // geometry owner must rebase, not repeat that correction against old data.
  f.root.scrollTop = 90;
  f.root.dispatchEvent(new Event("scroll"));
  delete f.root.dataset.readerViewerLocked;
  f.root.dispatchEvent(new Event("chat-reader:position-released")); f.frame();
  assert.equal(f.root.scrollTop, 90);
  assert.equal(f.corrections.filter(row => row.scroller === f.root).length, 0);
  f.root.flowTop += 8; f.resize();
  assert.equal(f.root.scrollTop, 98);
  f.frame(); f.root.dispatchEvent(new Event("wheel"));
  assert.deepEqual(f.cancelled, [f.root]);
  release1(); release2();
});
