import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript"), React = appRequire("react");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const noop = () => {};

function load(path, mocks, window) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8"), {
    fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", "window", code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error("Unexpected dependency: " + name);
    return appRequire(name);
  }, module, module.exports, window);
  return module.exports;
}

// Actual hook/component bodies, with explicit deterministic hook/effect doubles.
// These checks do not claim mounted React, browser focus or backend acceptance.
function hooks() {
  const values = [], refs = [], effects = [];
  let valueIndex = 0, refIndex = 0, effectIndex = 0;
  return {
    react: { ...React,
      useState: initial => {
        const index = valueIndex++;
        if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
        return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
      },
      useRef: initial => { const index = refIndex++; return refs[index] ??= { current: initial }; },
      useEffect: (callback, deps) => {
        const index = effectIndex++, previous = effects[index];
        if (!previous || deps.some((value, position) => value !== previous.deps[position])) {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: callback() };
        }
      },
    },
    render: callback => { valueIndex = 0; refIndex = 0; effectIndex = 0; return callback(); },
    dispose: () => effects.forEach(effect => effect.cleanup?.()),
  };
}

function windowFixture() {
  const window = new EventTarget();
  window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
  return window;
}

function findButton(surface, label) {
  const visit = node => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) return node.map(visit).find(Boolean);
    if (node.type === "button" && node.props.children === label) return node.props;
    return visit(node.props?.children);
  };
  const button = visit(surface);
  assert.ok(button, "Missing actual rendered action: " + label);
  return button;
}

function exportFixture(outcome = async () => ({ job_id: "synthetic-export" })) {
  const runtime = hooks(), window = windowFixture(), writes = [];
  const { useBatchExport } = load("features/conversations/use-batch-export.tsx", {
    react: runtime.react,
    "@tanstack/react-query": { useQueryClient: () => ({ setQueryData: noop, invalidateQueries: async () => {} }) },
    "../../lib/api": { queueConversationBatchExport: async (ids, key, signal) => {
      writes.push({ ids, key, signal }); return outcome();
    } },
    "../../lib/batch-export-errors": { batchExportFailureCode: () => "UNCONFIRMED", batchExportError: code => code },
    "../../lib/offline-access": { authenticationGeneration: () => 0, OFFLINE_ACCESS_LOCKED_EVENT: "synthetic:locked" },
  }, window);
  return { ...runtime, writes, render: () => runtime.render(() => useBatchExport(false)) };
}

for (const count of [4999, 5000, 5001]) {
  test(`batch export ${count}: oversized input is rejected before queueing without truncation`, async () => {
    const f = exportFixture();
    try {
      const ids = Array.from({ length: count }, (_, index) => ({ id: `synthetic-export-${index}` }));
      const initial = f.render();
      assert.equal(initial.overLimit(count), count > 5000);
      await initial.submit(ids);
      assert.equal(f.writes.length, count > 5000 ? 0 : 1);
      if (count <= 5000) assert.deepEqual(f.writes[0].ids, ids.map(item => item.id));
      else assert.match(renderToStaticMarkup(f.render().feedback), /BATCH_EXPORT_LIMIT/);
    } finally { f.dispose(); }
  });
}

test("an invalid oversized selection does not discard a previous export's safe replay key", async () => {
  let attempts = 0;
  const f = exportFixture(async () => { if (++attempts === 1) throw new Error("Synthetic lost export acknowledgement"); return { job_id: "synthetic-original-task" }; });
  try {
    const original = Array.from({ length: 5000 }, (_, index) => ({ id: `synthetic-safe-${index}` }));
    await f.render().submit(original);
    await f.render().submit([...original, { id: "synthetic-excess" }]);
    assert.equal(f.writes.length, 1);
    await f.render().submit(original);
    assert.equal(f.writes.length, 2);
    assert.equal(f.writes[1].key, f.writes[0].key);
    assert.deepEqual(f.writes[1].ids, f.writes[0].ids);
  } finally { f.dispose(); }
});

const batch = load("lib/batch-selection.ts", {}, undefined);
function resultFixture(read = async id => ({ id, title: "Synthetic checked result", status: "archived", project_name: null })) {
  const runtime = hooks(), window = windowFixture(), reads = [];
  let generation = 0, scope = "synthetic-original-list";
  const { useBatchResultCheck } = load("features/conversations/use-batch-result-check.tsx", {
    react: runtime.react,
    "../../lib/api": { getConversation: async id => { reads.push(id); return read(id); } },
    "../../lib/batch-selection": batch,
    "../../lib/offline-access": { authenticationGeneration: () => generation, AUTH_GENERATION_CHANGED_EVENT: "synthetic:identity" },
  }, window);
  return { ...runtime, reads, render: () => runtime.render(() => useBatchResultCheck(false, scope)),
    switchScope: () => { scope = "synthetic-new-list"; },
    switchAccount: () => { generation++; window.dispatchEvent(new Event("synthetic:identity")); } };
}
const unresolved = ids => ({ succeededIds: [], failedIds: [], unconfirmedIds: ids, notStartedIds: [] });

test("unknown batch results remain reachable without rows; current-state GETs never manufacture receipts or Undo", async () => {
  const f = resultFixture();
  try {
    f.render().record(unresolved(["synthetic-gone-row"]));
    let result = f.render();
    assert.equal(result.blockedIds.has("synthetic-gone-row"), true);
    findButton(result.surface, "Check current state of unconfirmed items").onClick();
    await setImmediate();
    result = f.render();
    assert.deepEqual(f.reads, ["synthetic-gone-row"]);
    const markup = renderToStaticMarkup(result.surface);
    assert.match(markup, /current state, not a receipt/);
    assert.match(markup, /Archived/);
    assert.match(markup, /href="\/conversations\/synthetic-gone-row"/);
    assert.equal(result.blockedIds.size, 1, "a matching current state alone is not permission to replay");
    findButton(result.surface, "Reviewed; continue with current state").onClick();
    assert.equal(f.render().blockedIds.size, 0);
  } finally { f.dispose(); }
});

test("a failed read stays unresolved and cannot expose the release-selection action", async () => {
  const f = resultFixture(async () => { throw new Error("Synthetic scoped read outage"); });
  try {
    f.render().record(unresolved(["synthetic-still-unknown"]));
    findButton(f.render().surface, "Check current state of unconfirmed items").onClick();
    await setImmediate();
    const result = f.render();
    assert.match(renderToStaticMarkup(result.surface), /1 items could not be read and remain unconfirmed/);
    assert.doesNotMatch(renderToStaticMarkup(result.surface), /Reviewed; continue with current state/);
    assert.equal(result.blockedIds.size, 1);
  } finally { f.dispose(); }
});

for (const retire of ["switchScope", "switchAccount", "dispose"]) {
  test(`batch check ${retire}: retire a held read and stop pending dispatch without publishing old rows`, async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = resultFixture(async id => { await gate; return { id, title: "Synthetic retired title", status: "active" }; });
    try {
      f.render().record(unresolved(Array.from({ length: 6 }, (_, index) => `synthetic-retire-${index}`)));
      findButton(f.render().surface, "Check current state of unconfirmed items").onClick();
      assert.equal(f.reads.length, 4);
      f[retire]();
      if (retire === "switchScope") assert.equal(f.render().surface, null);
      release(); await setImmediate();
      assert.equal(f.reads.length, 4);
      if (retire !== "dispose") assert.equal(f.render().surface, null);
    } finally { release(); f.dispose(); }
  });
}

test("bulk move selection is read-only until explicit confirmation, which freezes IDs and rejects rapid repeats", async () => {
  const runtime = hooks(), window = windowFixture(), writes = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { BulkMoveReview } = load("components/bulk-move-review.tsx", {
    react: runtime.react, "./preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
  }, window);
  const ids = ["synthetic-first", "synthetic-second"];
  const render = () => runtime.render(() => BulkMoveReview({
    selectedIds: ids, projects: [{ id: "synthetic-destination", name: "Synthetic destination" }], busy: false,
    onMove: async (selected, target) => { writes.push({ selected, target }); await gate; },
  }));
  try {
    let surface = render();
    surface.props.children[1].props.onChange({ target: { value: "synthetic-destination" } });
    surface = render();
    assert.equal(writes.length, 0);
    const confirm = findButton(surface, "Confirm move");
    confirm.onClick(); confirm.onClick();
    ids.push("synthetic-later-selection");
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], { selected: ["synthetic-first", "synthetic-second"], target: "synthetic-destination" });
  } finally { release(); await setImmediate(); runtime.dispose(); }
});
