import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/components/feature-entry-recovery.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => Array.isArray(node) ? node.flatMap(nodes)
  : node && typeof node === "object" && node.props ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join("")
  : node && typeof node === "object" ? text(node.props?.children) : String(node ?? "");

// Runs the real hook/state machine with transport/account adapters. Browser
// focus/layout acceptance is separately owned by Playwright.
function fixture(collection) {
  const api = {}, events = new EventTarget(), effects = [], writes = [], callbacks = [], reads = [];
  let generation = 1, server = [], first = true, behavior = "accepted-lost", hook;
  class ApiRequestError extends Error { constructor(status) { super("synthetic"); this.status = status; } }
  const modules = {
    react: {
      useCallback: fn => fn, useEffect: fn => { if (first) effects.push(fn()); },
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQueryClient: () => ({ setQueryData() {} }) },
    "../lib/offline-access": { authenticationGeneration: () => generation, AUTH_GENERATION_CHANGED_EVENT: "epoch" },
    "../lib/api": {
      ApiRequestError,
      saveUserFeatureEntry: async (scope, id, input) => {
        writes.push({ scope, id, input });
        if (behavior === "conflict") throw new ApiRequestError(409);
        const row = { id, collection, revision: input.expected_revision + 1, value: input.value };
        if (behavior !== "absent-lost") server = [row];
        if (behavior !== "ok") throw new Error("synthetic response lost");
        return row;
      },
      deleteUserFeatureEntry: async (_scope, id) => { writes.push({ id }); server = []; throw new Error("synthetic response lost"); },
      getUserFeatureEntries: async () => { reads.push(collection); return server; },
    },
  };
  new Function("require", "exports", "window", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name];
  }, api, events);
  function render() {
    hook = api.useFeatureEntryRecovery(collection, false, row => callbacks.push(["saved", row]), row => callbacks.push(["removed", row]), (draft, current) => callbacks.push(["continue", draft, current]));
    first = false; return hook;
  }
  async function click(label) {
    const button = nodes(render().panel).find(node => node.type === "button" && text(node) === label);
    assert.ok(button, `Missing recovery action: ${label}`);
    await button.props.onClick();
    // Retry is intentionally fire-and-forget in the UI.
    await new Promise(resolve => setImmediate(resolve));
    render();
  }
  return {
    render, click, writes, reads, callbacks,
    behavior(value) { behavior = value; }, server(rows) { server = rows; },
    accountChanged() { generation++; events.dispatchEvent(new Event("epoch")); },
    dispose() { for (const cleanup of effects) cleanup?.(); },
  };
}
const entry = collection => ({ id: "synthetic-stable-identity", collection, revision: 0,
  value: { name: "Synthetic retained draft" }, created_at: "", updated_at: "" });

for (const collection of ["saved-search", "export-preset", "offline-checklist"]) {
  test(`${collection}: response loss survives reopening and is confirmed without replay`, async () => {
    const f = fixture(collection);
    try {
      await assert.rejects(f.render().save(entry(collection)));
      assert.equal(f.render().blocked, true);
      await assert.rejects(f.render().save({ ...entry(collection), id: "must-not-be-sent" }));
      assert.equal(f.writes.length, 1);
      await f.click("Check current state");
      assert.equal(f.writes.length, 1);
      assert.equal(f.reads.length, 1);
      await f.click("Accept checked result");
      assert.equal(f.callbacks[0][0], "saved");
      assert.equal(f.render().blocked, false);
    } finally { f.dispose(); }
  });
  test(`${collection}: an absent create can explicitly retry only the original UUID`, async () => {
    const f = fixture(collection);
    try {
      f.behavior("absent-lost");
      await assert.rejects(f.render().save(entry(collection)));
      await f.click("Check current state");
      f.behavior("ok");
      await f.click("Retry original request");
      assert.deepEqual(f.writes.map(row => row.id), ["synthetic-stable-identity", "synthetic-stable-identity"]);
      assert.equal(f.render().blocked, false);
      assert.equal(f.callbacks.length, 1);
    } finally { f.dispose(); }
  });
  test(`${collection}: CAS conflict never replays and account changes discard pending private drafts`, async () => {
    const f = fixture(collection);
    try {
      f.behavior("conflict");
      f.server([{ ...entry(collection), revision: 4, value: { name: "Concurrent current value" } }]);
      await assert.rejects(f.render().save(entry(collection)));
      await f.click("Check current state");
      assert.equal(f.writes.length, 1);
      assert.match(text(f.render().panel), /current value differs/i);
      const stale = f.render();
      f.accountChanged();
      await assert.rejects(stale.save({ ...entry(collection), id: "old-account-must-not-write" }));
      assert.equal(f.writes.length, 1);
      assert.equal(f.render().blocked, false);
      assert.equal(f.render().panel, null);
      assert.equal(f.callbacks.length, 0);
    } finally { f.dispose(); }
  });
}
