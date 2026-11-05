import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function compile(file, dependencies = {}, environment = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../../apps/web/${file}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, require(name) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, crypto: { randomUUID }, ...environment });
  return exports;
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function harness(shared = new Map(), { failWrite = false } = {}) {
  let cursor = 0, sequence = 0, effects = [], slots = [], timers = new Map(), pending = [], epoch = 1;
  const writes = [], window = new EventTarget(), document = new EventTarget();
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(initial) {
      const n = cursor++;
      if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial;
      return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value; }];
    },
    useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial }; },
    useCallback(fn, deps) {
      const n = cursor++;
      if (!slots[n] || !equal(slots[n].deps, deps)) slots[n] = { fn, deps };
      return slots[n].fn;
    },
    useEffect(fn, deps) {
      const n = cursor++;
      if (!effects[n] || !equal(effects[n].deps, deps)) pending.push(() => {
        effects[n]?.cleanup?.(); effects[n] = { deps, cleanup: fn() };
      });
    },
  };
  const db = {
    settings: {
      where() { return { startsWith(prefix) { return { toArray: async () => [...shared.values()].filter(row => row.key.startsWith(prefix)).map(row => structuredClone(row)) }; } }; },
      async put(row) { if (failWrite) throw Error("synthetic quota exceeded"); writes.push(structuredClone(row)); shared.set(row.key, structuredClone(row)); },
      async get(key) { return shared.get(key); },
      async delete(key) { shared.delete(key); },
    },
    async transaction(_mode, _table, fn) { return fn(); },
  };
  const source = compile("features/editing/use-source-draft.ts", {
    react, "../../lib/offline-db": { offlineDb: db },
    "../../lib/offline-access": { captureOfflineAccess: () => epoch, assertOfflineAccess(captured) { if (captured !== epoch) throw Error("account changed"); } },
  }, {
    window, document,
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    shared, writes, window, document, matches: source.draftMatchesSource,
    switchAccount() { epoch++; },
    render(text, baseline = "BASE", version = 2, hash = "hash-A") {
      cursor = 0; pending = [];
      const result = source.useSourceDraft("synthetic-conversation", "synthetic-message", version, text, baseline, "version-A", hash);
      pending.forEach(fn => fn()); return result;
    },
    fireTimers() { const todo = [...timers.values()]; timers.clear(); todo.forEach(fn => fn()); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); effects = []; },
  };
}

test("undo to baseline removes a persisted draft and never offers an old edit on reopen", async () => {
  const h = harness();
  h.render("BASE"); await settle();
  h.render("EDIT"); h.fireTimers(); await settle();
  assert.equal(h.shared.size, 1);
  h.render("BASE"); h.unmount(); await settle();
  assert.equal(h.shared.size, 0);
  const reopened = harness(h.shared);
  reopened.render("BASE"); await settle();
  assert.equal(reopened.render("BASE").candidate, null); reopened.unmount();
});
test("100 changes coalesce to one write; close/visibility flush only the latest revision", async () => {
  const h = harness();
  h.render("BASE"); await settle();
  for (let i = 1; i <= 100; i++) h.render(`EDIT-${i}`);
  await settle();
  assert.equal(h.writes.length, 0);
  h.fireTimers(); await settle();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].value.text, "EDIT-100");
  h.render("LATEST"); h.document.visibilityState = "hidden"; h.document.dispatchEvent(new Event("visibilitychange"));
  await settle(); h.unmount(); await settle();
  assert.equal(h.writes.length, 2); assert.equal(h.writes[1].value.text, "LATEST");
});
test("draft keeps its editing baseline when replace-current changes the same version ID", async () => {
  const h = harness();
  h.render("BASE"); await settle();
  h.render("EDIT");
  h.render("EDIT-2", "REMOTE", 2, "hash-B"); h.fireTimers(); await settle();
  const row = h.writes[0].value;
  assert.equal(row.base_content_hash, "hash-A");
  assert.equal(h.matches(row, "version-A", "hash-B"), false);
  assert.equal(h.matches(row, "version-A", "hash-A"), true);
  assert.equal(h.matches({ base_version: 2 }, "version-A", "hash-A"), false);
  h.unmount();
});
test("confirmed save and account switch fence queued draft writes", async () => {
  const h = harness();
  h.render("BASE"); await settle();
  const draft = h.render("EDIT"); await draft.acknowledge("EDIT");
  h.fireTimers(); h.unmount(); await settle(); assert.equal(h.shared.size, 0);
  const other = harness(); other.render("BASE"); await settle();
  other.render("PRIVATE"); other.switchAccount(); other.unmount(); await settle();
  assert.equal(other.writes.length, 0);
});
test("two editors retain distinct drafts; undo in one never removes another tab's saved copy", async () => {
  const shared = new Map(), first = harness(shared), second = harness(shared);
  first.render("BASE"); second.render("BASE"); await settle();
  first.render("FIRST"); first.fireTimers(); second.render("SECOND"); second.fireTimers(); await settle();
  assert.equal(shared.size, 2);
  first.render("BASE"); first.unmount(); await settle();
  assert.equal(shared.size, 1); assert.equal([...shared.values()][0].value.text, "SECOND");
  second.unmount();
});
test("legacy draft is retained with an unknown base and quota failure remains actionable", async () => {
  const legacy = { key: "source-editor-draft:synthetic-message:legacy", value: {
    conversation_id: "synthetic-conversation", message_id: "synthetic-message", base_version: 2,
    text: "LEGACY", saved_at: "2026-01-01T00:00:00Z", revision: 1,
  } };
  const h = harness(new Map([[legacy.key, legacy]]), { failWrite: true });
  h.render("BASE"); await settle();
  const restored = h.render("BASE");
  assert.equal(restored.candidate.value.text, "LEGACY");
  assert.equal(h.matches(restored.candidate.value, "version-A", "hash-A"), false);
  restored.restoreBase(restored.candidate.value);
  h.render("LEGACY"); h.fireTimers(); await settle();
  assert.equal(h.render("LEGACY").status, "error");
  assert.equal(h.shared.size, 1); assert.equal(h.shared.get(legacy.key).value.text, "LEGACY");
  h.unmount(); await settle();
});
test("search pages replace snippets and removed results without deriving offsets from unique count", () => {
  const { collectSearchPages } = compile("features/search/search-pages.ts");
  const a = { document_id: "A", snippet: "old" }, b = { document_id: "B", snippet: "old" };
  const pages = { 0: [a], 50: [b] };
  pages[50] = [{ ...a, snippet: "new" }];
  const result = collectSearchPages(pages);
  assert.equal(result.length, 1); assert.equal(result[0].snippet, "new");
  assert.equal(pages[0][0].snippet, "old");
  assert.equal(collectSearchPages({ 0: [] }).length, 0);
});
test("Share intent survives panel reopen, retains original key and fences another account", () => {
  let generation = 1;
  const store = compile("features/sharing/share-creation-intent.ts", {
    react: {},
    "../../lib/offline-access": { authenticationGeneration: () => generation },
  });
  const payload = { title: "Synthetic", share_password: "synthetic-memory-only" };
  const owned = store.beginShareIntent("conversation", payload);
  assert.throws(() => store.beginShareIntent("conversation", payload), /REQUIRES_CHECK/);
  store.updateShareIntent("conversation", owned, { phase: "unknown" });
  assert.equal(store.currentShareIntent("conversation").key, owned.key);
  store.updateShareIntent("conversation", owned, { phase: "absent" });
  assert.equal(store.currentShareIntent("conversation").payload, payload);
  generation++;
  assert.equal(store.currentShareIntent("conversation"), null);
  store.updateShareIntent("conversation", owned, { phase: "confirmed", url: "synthetic" });
  assert.equal(store.currentShareIntent("conversation"), null);
});
