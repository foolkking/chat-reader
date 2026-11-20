import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = ts.transpileModule(readFileSync(new URL("../../apps/web/e2e/reader-native-input.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture() {
  let clock = 0;
  const steps = [];
  class Element {
    top = 0;
    listeners = new Map();
    get scrollTop() { return this.top; }
    set scrollTop(value) { this.top = value; }
    scrollTo(options) { this.top = options.top; }
    scrollBy(options) { this.top += options.top; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name, fn) { assert.equal(this.listeners.get(name), fn); this.listeners.delete(name); }
    fire(name, clientY) { this.listeners.get(name)?.({ touches: [{ clientY }] }); }
  }
  const el = new Element(), exports = {};
  vm.runInNewContext(source, {
    exports, Element, performance: { now: () => clock },
    requestAnimationFrame(callback) {
      clock += 16;
      steps.shift()?.();
      queueMicrotask(() => callback(clock));
    },
  });
  const probe = exports.watchHeldReaderInput({ evaluateHandle: fn => fn(el) });
  return { el, probe, steps, clock: () => clock };
}

test("quiet frames before the final native touch coordinate cannot establish a baseline", async () => {
  const { el, probe, steps } = fixture();
  el.fire("touchmove", 280);
  steps.push(...Array(6).fill(null), () => el.fire("touchmove", 208));
  const settled = await probe.settle(208);
  assert.equal(settled.frames.length, 10);
  assert.equal(settled.quietFrames, 4);
  assert.equal(settled.lastTouchY, 208);
  probe.dispose();
});

test("a compositor delta arriving after touch acknowledgement resets the pre-response barrier", async () => {
  const { el, probe, steps } = fixture();
  el.top = 270;
  el.fire("touchmove", 208);
  steps.push(null, null, () => { el.top = 342; });
  const settled = await probe.settle(208);
  assert.equal(settled.top, 342);
  assert.equal(settled.frames.length, 7);
  assert.equal(probe.readCalls().length, 0, "Native input must not be reported as a programmatic write");
  probe.dispose();
});

test("the barrier fails closed if the position response has already been released", async () => {
  const { el, probe } = fixture();
  el.fire("wheel");
  probe.release();
  await assert.rejects(probe.settle(null), /before releasing/);
  probe.dispose();
});

test("missing input or perpetual movement fails within the original input budget", async () => {
  for (const moving of [false, true]) {
    const { el, probe, steps, clock } = fixture();
    if (moving) {
      el.fire("wheel");
      steps.push(...Array.from({ length: 130 }, () => () => { el.top++; }));
    }
    await assert.rejects(probe.settle(null), /original 2s input budget/);
    assert.ok(clock() >= 2000 && clock() <= 2016);
    probe.dispose();
  }
});

test("a late programmatic jump remains visible after settling, with no tolerance inflation", async () => {
  const { el, probe } = fixture();
  el.top = 342;
  el.fire("wheel");
  const settled = await probe.settle(null);
  probe.release();
  el.scrollTop += 72;
  assert.equal(el.scrollTop - settled.top, 72);
  assert.throws(() => assert.ok(Math.abs(el.scrollTop - settled.top) <= 2));
  const [call] = probe.readCalls();
  assert.equal(call.method, "scrollTop"); assert.equal(call.released, true);
  assert.equal(call.before, 342); assert.equal(call.after, 414);
  probe.dispose();
});

test("scroll observation delegates real methods and restores all original properties and listeners", async () => {
  const { el, probe } = fixture();
  el.scrollTo({ top: 100 }); el.scrollBy({ top: 20 }); el.scrollTop = 140;
  assert.equal(el.scrollTop, 140);
  assert.deepEqual(Array.from(probe.readCalls(), call => call.method), ["scrollTo", "scrollBy", "scrollTop"]);
  probe.dispose();
  for (const name of ["scrollTop", "scrollTo", "scrollBy"]) assert.equal(Object.hasOwn(el, name), false);
  assert.equal(el.listeners.size, 0);
  el.scrollBy({ top: 30 }); assert.equal(el.scrollTop, 170);
});
