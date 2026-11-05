import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/components/use-support-draft.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const same = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));

// Actual persistence hook; controlled hook phases and storage completion.
// Layout effects run before the observed UI commit; passive effects are held
// until explicitly flushed. This is not a mounted React/IndexedDB test.
function fixture() {
  const slots = [], effects = new Map(), waiting = [], writes = [], notifications = [];
  let cursor = 0, renderingEffects = [], view, dirty, callback = value => { dirty = value; notifications.push(value); };
  const initial = { version: 0, title: "", body: "", importLimit: "", flight: null };
  const react = {
    useState: initial => {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef: initial => slots[cursor++] ??= { current: initial },
    useCallback: (callback, deps) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect: (effect, deps) => renderingEffects.push({ index: cursor++, effect, deps, phase: "passive" }),
    useLayoutEffect: (effect, deps) => renderingEffects.push({ index: cursor++, effect, deps, phase: "layout" }),
  };
  const exports = {};
  new Function("exports", "require", compiled)(exports, name => {
    if (name === "react") return react;
    if (name === "../lib/offline-access") return { captureOfflineAccess: () => 1, assertOfflineAccess: () => {} };
    assert.equal(name, "../lib/support-drafts");
    return {
      readSupportDraft: async () => undefined,
      removeSupportDraft: async () => {},
      writeSupportDraft: async (_key, version, draft) => {
        const gate = deferred(); writes.push({ ...gate, version, draft });
        await gate.promise; return version + 1;
      },
    };
  });
  function run(effect) {
    effects.get(effect.index)?.cleanup?.();
    effects.set(effect.index, { ...effect, cleanup: effect.effect() });
  }
  function render() {
    cursor = 0; renderingEffects = [];
    view = exports.useSupportDraft("support-draft:new", initial, callback);
    for (const effect of renderingEffects) {
      if (same(effects.get(effect.index)?.deps, effect.deps)) continue;
      if (effect.phase === "layout") run(effect); else waiting.push(effect);
    }
    return view;
  }
  function passive() { while (waiting.length) run(waiting.shift()); }
  render();
  return {
    writes, notifications, render, passive, get view() { return view; }, get dirty() { return dirty; },
    replaceCallback(next) { callback = next; },
  };
}
async function ready() {
  const f = fixture(); f.passive(); await setImmediate(); f.render(); f.passive(); return f;
}

test("pending draft protection publishes in the same commit as saving, before passive effects", async () => {
  const f = await ready();
  const job = f.view.persist({ ...f.view.draft, title: "Synthetic pending draft" });
  const view = f.render();
  assert.equal(view.saving, true);
  assert.equal(f.dirty, true);
  await setImmediate(); f.writes[0].resolve(); await job; await setImmediate();
});

test("the saved status cannot be visible while the host still thinks the draft is unsaved", async () => {
  const f = await ready();
  const job = f.view.persist({ ...f.view.draft, title: "Synthetic saved draft" });
  f.render(); f.passive(); await setImmediate();
  assert.equal(f.dirty, true);
  f.writes[0].resolve(); await job; await setImmediate();
  const view = f.render();
  assert.equal(view.ready, true); assert.equal(view.saving, false); assert.equal(view.error, null);
  assert.equal(f.dirty, false, "Escape must not see the old dirty flag before passive effects");
});

test("an earlier committed write cannot release protection for a later queued revision", async () => {
  const f = await ready();
  const first = f.view.persist({ ...f.view.draft, title: "Synthetic first" });
  const second = f.view.persist({ ...f.view.draft, title: "Synthetic latest" });
  f.render(); f.passive(); await setImmediate();
  f.writes[0].resolve(); await first; await setImmediate(); f.render();
  assert.equal(f.view.saving, true); assert.equal(f.dirty, true);
  assert.equal(f.writes[1].version, 1);
  f.writes[1].resolve(); await second; await setImmediate(); f.render();
  assert.equal(f.dirty, false); assert.equal(f.view.draft.title, "Synthetic latest");
});

test("failed storage stays protected until explicit retry commits the retained draft", async () => {
  const f = await ready();
  const job = f.view.persist({ ...f.view.draft, title: "Synthetic retained draft" });
  const rejected = assert.rejects(job, /synthetic storage/);
  f.render(); f.passive(); await setImmediate();
  f.writes[0].reject(Error("synthetic storage failure")); await rejected; await setImmediate(); f.render();
  assert.equal(f.view.saving, false); assert.ok(f.view.error); assert.equal(f.dirty, true);
  const retry = f.view.retry(); await setImmediate(); f.render();
  assert.equal(f.view.saving, true); assert.equal(f.dirty, true);
  assert.equal(f.writes[1].draft.title, "Synthetic retained draft");
  f.writes[1].resolve(); await retry; await setImmediate(); f.render();
  assert.equal(f.view.error, null); assert.equal(f.view.saving, false); assert.equal(f.dirty, false);
});

test("a replacement host callback receives the current protection before paint", async () => {
  const f = await ready(), received = [];
  const job = f.view.persist({ ...f.view.draft, body: "Synthetic pending body" });
  f.render(); f.passive(); await setImmediate();
  f.replaceCallback(value => received.push(value)); f.render();
  assert.deepEqual(received, [true]);
  f.writes[0].resolve(); await job; await setImmediate(); f.render();
  assert.deepEqual(received, [true, false]);
});
