import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = appRequire("react"), ts = appRequire("typescript");
const source = readFileSync(new URL("../../apps/web/components/offline-conflict-review.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "offline-conflict-review.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const note = title => ({ id: "synthetic-note", conversation_id: "synthetic-conversation", title,
  blocks: [{ id: "synthetic-block", type: "markdown", markdown: "Synthetic merge body" }], revision: 1 });
const preview = (key, title = "Synthetic local") => ({ key, marker: {}, local: note(title),
  server: note("Synthetic server"), copy: note("Synthetic conflict copy"), pendingIds: [], references: [] });
const annotation = comment => ({ id: "synthetic-annotation", conversation_id: "synthetic-conversation",
  message_id: null, message_version_id: null, annotation_type: "bookmark", color: null,
  start_block_index: null, start_offset: null, end_block_index: null, end_offset: null,
  quote: null, prefix: null, suffix: null, comment_markdown: comment, anchor_status: "valid",
  revision: 1, is_deleted: false, conflict_of_id: null, metadata: {},
  created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z" });
class ConflictChangedError extends Error {}

// Actual compiled component; hooks, requests, local storage and confirmation
// are controlled adapters, not mounted React, Dexie or browser evidence.
function fixture({ saved, read, put, get, prepare, retry, confirm, invalidate } = {}) {
  let cursor = 0, locale = "en-US", conflictKey = "synthetic-conflict-a", tree, disposed = false;
  const hooks = [], layouts = new Map(), effects = new Map();
  const hook = init => { const index = cursor++; return hooks[index] ?? (hooks[index] = init()); };
  const memo = (make, deps) => {
    const entry = hook(() => ({}));
    if (!same(entry.deps, deps)) Object.assign(entry, { value: make(), deps });
    return entry.value;
  };
  const effect = queue => (fn, deps) => {
    const index = cursor, entry = hook(() => ({}));
    if (!same(entry.deps, deps)) { entry.deps = deps; queue.set(index, fn); }
  };
  const react = { ...React,
    useState: init => {
      const entry = hook(() => ({ value: typeof init === "function" ? init() : init }));
      entry.set ??= value => {
        if (disposed) calls.postDisposeUpdates++;
        entry.value = typeof value === "function" ? value(entry.value) : value;
      };
      return [entry.value, entry.set];
    },
    useRef: init => hook(() => ({ current: init })), useCallback: (fn, deps) => memo(() => fn, deps),
    useLayoutEffect: effect(layouts), useEffect: effect(effects),
  };
  const store = new Map([["synthetic-conflict-a", {}], ["synthetic-conflict-b", {}]]);
  if (saved) store.set("sync-resolution-draft:synthetic-conflict-a", saved);
  const calls = { reads: [], gets: [], puts: [], prepared: [], retries: [], confirmations: [],
    invalidations: 0, backs: 0, dirty: [], postDisposeUpdates: 0 };
  const db = {
    settings: {
      get: async key => {
        calls.gets.push(key);
        if (get) await get(key);
        return store.has(key) ? { key, value: store.get(key) } : undefined;
      },
      put: async row => { calls.puts.push(row); if (put) await put(row); store.set(row.key, row.value); },
    },
    transaction: async (_mode, _table, work) => work(),
  };
  const mocks = {
    react,
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {
      calls.invalidations++; if (invalidate) await invalidate();
    } }) },
    "../lib/offline-db": { offlineDb: db },
    "../lib/offline-conflicts": { ConflictChangedError,
      loadOfflineConflict: async key => { calls.reads.push(key); return read ? read(key) : preview(key); },
      prepareOfflineResolution: async (...args) => { calls.prepared.push(args); if (prepare) await prepare(...args); },
      retryOfflineResolution: async key => { calls.retries.push(key); if (retry) await retry(key); },
    },
    "./preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async options => {
      calls.confirmations.push(options); return confirm ? confirm(options) : true;
    } }) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "navigator", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw Error(`Unexpected dependency ${name}`);
    return appRequire(name);
  }, module, module.exports, { onLine: true });
  const onBack = () => { calls.backs++; }, onDirtyChange = dirty => { calls.dirty.push(dirty); };
  const render = () => {
    cursor = 0;
    tree = module.exports.OfflineConflictReview({ conflictKey, onBack, onDirtyChange });
    return tree;
  };
  const flush = () => {
    for (const queue of [layouts, effects]) {
      for (const [index, fn] of queue) { hooks[index].cleanup?.(); hooks[index].cleanup = fn(); }
      queue.clear();
    }
  };
  const paint = () => { render(); flush(); return render(); };
  paint();
  return {
    calls, store, paint, get tree() { return tree; },
    async settle() { await setImmediate(); paint(); },
    locale(value) { locale = value; paint(); },
    key(value) { conflictKey = value; paint(); },
    dispose() { disposed = true; for (const entry of hooks) entry.cleanup?.(); layouts.clear(); effects.clear(); },
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) {
    for (const item of tree) { const found = find(item, predicate); if (found) return found; }
    return;
  }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);
function button(f, label) {
  const node = find(f.tree, item => item.type === "button" && text(item.props.children) === label);
  assert.ok(node, `Missing button: ${label}`);
  return node.props;
}
function titleInput(f) {
  const node = find(f.tree, item => item.type === "input" && item.props.maxLength === 200);
  assert.ok(node, "Missing manual merge title input");
  return node.props;
}
function editTitle(f, title) { titleInput(f).onChange({ target: { value: title } }); f.paint(); }

test("initial comparison initializes from the stored merge draft, falling back to local content", async () => {
  for (const saved of [undefined, note("Synthetic saved draft")]) {
    const f = fixture({ saved });
    try {
      await f.settle();
      assert.equal(titleInput(f).value, saved?.title ?? "Synthetic local");
      assert.deepEqual(f.calls.reads, ["synthetic-conflict-a"]);
      assert.deepEqual(f.calls.puts, []);
    } finally { f.dispose(); }
  }
});

test("Compare again preserves a failed in-memory merge and Retry saves that same edit, not the old stored draft", async () => {
  let fail = true;
  const f = fixture({ saved: note("Synthetic older stored draft"), put: async () => { if (fail) throw Error("Synthetic private storage detail"); } });
  try {
    await f.settle();
    editTitle(f, "Synthetic unsaved merge");
    await f.settle();
    assert.ok(text(f.tree).includes("Draft could not be saved."));
    assert.equal(button(f, "Back to conflicts").disabled, true);
    button(f, "Compare again").onClick();
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic unsaved merge");
    assert.equal(f.store.get("sync-resolution-draft:synthetic-conflict-a").title, "Synthetic older stored draft");
    assert.ok(text(f.tree).includes("Draft could not be saved."));
    assert.equal(button(f, "Apply merge").disabled, true);
    fail = false;
    button(f, "Retry saving draft").onClick();
    await f.settle();
    assert.equal(f.store.get("sync-resolution-draft:synthetic-conflict-a").title, "Synthetic unsaved merge");
    assert.equal(button(f, "Apply merge").disabled, false);
    assert.ok(!text(f.tree).includes("Synthetic private storage detail"));
  } finally { f.dispose(); }
});

test("comparison during a pending draft write retains the visible merge until the write settles", async () => {
  const held = deferred(), f = fixture({ put: () => held.promise });
  try {
    await f.settle();
    editTitle(f, "Synthetic pending merge");
    button(f, "Compare again").onClick();
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic pending merge");
    assert.ok(text(f.tree).includes("Saving draft"));
    held.resolve();
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic pending merge");
    assert.equal(button(f, "Apply merge").disabled, false);
  } finally { held.resolve(); f.dispose(); }
});

test("annotation comment save failure also retains the merge through comparison and explicit retry", async () => {
  let fail = true, count = 0;
  const f = fixture({ saved: annotation("Synthetic stored comment"),
    put: async () => { if (fail) throw Error("Synthetic storage failure"); },
    read: key => {
      count++;
      return { ...preview(key), local: annotation(`Synthetic local comment ${count}`),
        server: annotation(`Synthetic server comment ${count}`), copy: annotation("Synthetic conflict comment") };
    } });
  const commentInput = () => {
    const node = find(f.tree, item => item.type === "textarea" && item.props.maxLength === 20_000);
    assert.ok(node, "Missing merged annotation comment");
    return node.props;
  };
  try {
    await f.settle();
    commentInput().onChange({ target: { value: "Synthetic retained comment" } });
    await f.settle();
    button(f, "Compare again").onClick();
    await f.settle();
    assert.equal(commentInput().value, "Synthetic retained comment");
    assert.ok(text(f.tree).includes("Synthetic server comment 2"));
    assert.equal(button(f, "Apply merge").disabled, true);
    fail = false;
    button(f, "Retry saving draft").onClick();
    await f.settle();
    assert.equal(f.store.get("sync-resolution-draft:synthetic-conflict-a").comment_markdown, "Synthetic retained comment");
    assert.equal(button(f, "Apply merge").disabled, false);
  } finally { f.dispose(); }
});

test("a newer edit made while comparison is in flight cannot be replaced by that read", async () => {
  let count = 0;
  const held = deferred(), f = fixture({ read: key => ++count === 1 ? preview(key) : held.promise });
  try {
    await f.settle();
    const inputBeforeRead = titleInput(f);
    button(f, "Compare again").onClick();
    inputBeforeRead.onChange({ target: { value: "Synthetic edit after read began" } });
    f.paint();
    held.resolve(preview("synthetic-conflict-a", "Synthetic comparison fallback"));
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic edit after read began");
    assert.equal(f.calls.puts.at(-1).value.title, "Synthetic edit after read began");
  } finally { held.resolve(preview("synthetic-conflict-a")); f.dispose(); }
});

test("a failed comparison retains the initialized draft and locale changes translate feedback without another read", async () => {
  let count = 0;
  const f = fixture({ saved: note("Synthetic retained merge"), read: key => {
    if (++count > 1) throw Error("Synthetic private read detail");
    return preview(key);
  } });
  try {
    await f.settle();
    button(f, "Compare again").onClick();
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic retained merge");
    assert.ok(text(f.tree).includes("Unable to read current versions."));
    const reads = f.calls.reads.length;
    f.locale("zh-CN");
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic retained merge");
    assert.equal(f.calls.reads.length, reads);
    assert.ok(text(f.tree).includes("无法读取当前版本"));
    assert.ok(!text(f.tree).includes("Synthetic private read detail"));
  } finally { f.dispose(); }
});

test("a locale change during failed draft persistence preserves the current edit and dirty protection", async () => {
  const f = fixture({ put: async () => { throw Error("Synthetic write failure"); } });
  try {
    await f.settle();
    editTitle(f, "Synthetic failed merge");
    await f.settle();
    const reads = f.calls.reads.length;
    f.locale("zh-CN");
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic failed merge");
    assert.equal(f.calls.reads.length, reads);
    assert.ok(text(f.tree).includes("草稿保存失败"));
    assert.equal(button(f, "返回冲突列表").disabled, true);
    assert.equal(f.calls.dirty.at(-1), true);
  } finally { f.dispose(); }
});

test("a real conflict-key change resets the draft and retires the previous save completion", async () => {
  const held = deferred(), f = fixture({ put: row => row.key.endsWith("synthetic-conflict-a") ? held.promise : undefined });
  try {
    await f.settle();
    editTitle(f, "Synthetic old conflict edit");
    f.store.set("sync-resolution-draft:synthetic-conflict-b", note("Synthetic second conflict draft"));
    f.key("synthetic-conflict-b");
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic second conflict draft");
    held.reject(Error("Synthetic retired write failure"));
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic second conflict draft");
    assert.equal(button(f, "Back to conflicts").disabled, false);
    assert.ok(!text(f.tree).includes("Draft could not be saved."));
  } finally { held.resolve(); f.dispose(); }
});

test("a previous conflict comparison resolving after a key change cannot replace the new draft or preview", async () => {
  let count = 0;
  const held = deferred(), f = fixture({ read: key => {
    if (key === "synthetic-conflict-a" && ++count > 1) return held.promise;
    return preview(key, key === "synthetic-conflict-b" ? "Synthetic second local" : "Synthetic first local");
  } });
  try {
    await f.settle();
    button(f, "Compare again").onClick();
    await f.settle();
    f.key("synthetic-conflict-b");
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic second local");
    held.resolve(preview("synthetic-conflict-a", "Synthetic retired comparison"));
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic second local");
    assert.ok(text(f.tree).includes("Synthetic second local"));
    assert.ok(!text(f.tree).includes("Synthetic retired comparison"));
    assert.equal(button(f, "Back to conflicts").disabled, false);
  } finally { held.resolve(preview("synthetic-conflict-a")); f.dispose(); }
});

test("applying a merge still prepares the current draft and acknowledges the same conflict key", async () => {
  const f = fixture();
  try {
    await f.settle();
    editTitle(f, "Synthetic chosen merge");
    await f.settle();
    button(f, "Compare again").onClick();
    await f.settle();
    button(f, "Apply merge").onClick();
    await f.settle();
    assert.equal(f.calls.prepared.length, 1);
    assert.equal(f.calls.prepared[0][0].key, "synthetic-conflict-a");
    assert.equal(f.calls.prepared[0][1], "merge");
    assert.equal(f.calls.prepared[0][2].title, "Synthetic chosen merge");
    assert.deepEqual(f.calls.retries, ["synthetic-conflict-a"]);
    assert.equal(f.calls.invalidations, 1);
    assert.equal(f.calls.backs, 1);
  } finally { f.dispose(); }
});

function noResolutionActions(f) {
  for (const label of ["Keep local", "Keep server", "Apply merge", "Retry resolution"]) {
    assert.equal(find(f.tree, item => item.type === "button" && text(item.props.children) === label), undefined, label);
  }
}

test("an initial failed marker read stays unconfirmed; rechecking only reads status and any eligible comparison", async () => {
  for (const marker of [{}, { resolution: { error: "STALE" } }, { resolution: { error: "NETWORK" } }]) {
    let failStatus = true;
    const f = fixture({ get: key => {
      if (failStatus && key === "synthetic-conflict-a") throw Error("Synthetic private status detail");
    } });
    try {
      await f.settle();
      noResolutionActions(f);
      assert.ok(text(f.tree).includes("Saved resolution status could not be checked."));
      assert.ok(!text(f.tree).includes("Synthetic private status detail"));
      assert.equal(button(f, "Recheck resolution status").disabled, false);
      assert.deepEqual(f.calls.reads, []);
      f.store.set("synthetic-conflict-a", marker);
      failStatus = false;
      button(f, "Recheck resolution status").onClick();
      await f.settle();
      if (marker.resolution?.error === "NETWORK") {
        assert.equal(button(f, "Retry resolution").disabled, false);
        assert.deepEqual(f.calls.reads, []);
      } else {
        assert.equal(titleInput(f).value, "Synthetic local");
        assert.deepEqual(f.calls.reads, ["synthetic-conflict-a"]);
      }
      assert.deepEqual(f.calls.prepared, []);
      assert.deepEqual(f.calls.retries, []);
      assert.deepEqual(f.calls.puts, []);
      assert.equal(f.calls.invalidations, 0);
      assert.equal(f.calls.backs, 0);
    } finally { f.dispose(); }
  }
});

test("a prepare failure plus failed status read preserves the failed merge and dirty protection until read-only recovery", async () => {
  let failStatus = false;
  const f = fixture({ saved: note("Synthetic stored merge"),
    put: async () => { throw Error("Synthetic draft storage failure"); },
    get: key => { if (failStatus && key === "synthetic-conflict-a") throw Error("Synthetic private status detail"); },
    prepare: async () => { failStatus = true; throw Error("Synthetic private prepare detail"); },
  });
  try {
    await f.settle();
    editTitle(f, "Synthetic retained failed merge");
    await f.settle();
    button(f, "Keep local").onClick();
    await f.settle();
    noResolutionActions(f);
    assert.ok(text(f.tree).includes("Saved resolution status could not be checked."));
    assert.equal(button(f, "Back to conflicts").disabled, true);
    assert.equal(f.calls.dirty.at(-1), true);
    const gets = f.calls.gets.length, reads = f.calls.reads.length;
    f.locale("zh-CN");
    await f.settle();
    assert.equal(f.calls.gets.length, gets);
    assert.equal(f.calls.reads.length, reads);
    assert.ok(text(f.tree).includes("无法确认已保存的处理请求状态"));
    assert.equal(button(f, "返回冲突列表").disabled, true);
    failStatus = false;
    button(f, "重新检查处理状态").onClick();
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic retained failed merge");
    assert.ok(text(f.tree).includes("草稿保存失败"));
    assert.equal(f.store.get("sync-resolution-draft:synthetic-conflict-a").title, "Synthetic stored merge");
    assert.equal(f.calls.prepared.length, 1);
    assert.deepEqual(f.calls.retries, []);
    assert.equal(f.calls.backs, 0);
    assert.ok(!text(f.tree).includes("Synthetic private"));
  } finally { f.dispose(); }
});

test("failed resolution and status read require a recheck before retrying the already-saved request", async () => {
  let failStatus = false, failRetry = true;
  const f = fixture({
    get: key => { if (failStatus && key === "synthetic-conflict-a") throw Error("Synthetic status failure"); },
    prepare: async () => { f.store.set("synthetic-conflict-a", {
      resolution: { operation: { operation_id: "synthetic-resolution-operation" }, error: "NETWORK" },
    }); },
    retry: async () => { if (failRetry) { failStatus = true; throw Error("Synthetic retry failure"); } },
  });
  try {
    await f.settle();
    button(f, "Keep server").onClick();
    await f.settle();
    noResolutionActions(f);
    assert.equal(button(f, "Recheck resolution status").disabled, false);
    failStatus = false;
    button(f, "Recheck resolution status").onClick();
    await f.settle();
    assert.equal(button(f, "Retry resolution").disabled, false);
    assert.equal(f.calls.reads.length, 1, "The recheck must not compare past a saved pending request");
    assert.equal(f.calls.prepared.length, 1);
    assert.deepEqual(f.calls.retries, ["synthetic-conflict-a"]);
    failRetry = false;
    button(f, "Retry resolution").onClick();
    await f.settle();
    assert.equal(f.calls.prepared.length, 1, "Retry must not prepare another resolution");
    assert.deepEqual(f.calls.retries, ["synthetic-conflict-a", "synthetic-conflict-a"]);
    assert.equal(f.calls.invalidations, 1);
    assert.equal(f.calls.backs, 1);
  } finally { f.dispose(); }
});

test("retiring a conflict while confirmation waits prevents later preparation and submission", async () => {
  const held = deferred(), f = fixture({ confirm: () => held.promise });
  try {
    await f.settle();
    button(f, "Keep local").onClick();
    f.key("synthetic-conflict-b");
    await f.settle();
    held.resolve(true);
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic local");
    assert.equal(f.calls.confirmations.length, 1);
    assert.deepEqual(f.calls.prepared, []);
    assert.deepEqual(f.calls.retries, []);
    assert.equal(f.calls.invalidations, 0);
    assert.equal(f.calls.backs, 0);
    assert.equal(button(f, "Back to conflicts").disabled, false);
  } finally { held.resolve(false); f.dispose(); }
});

test("a prepare already started can finish saving its request after retirement without starting the next network step", async () => {
  const held = deferred(), f = fixture({ prepare: async () => {
    await held.promise;
    f.store.set("synthetic-conflict-a", { resolution: { error: "NETWORK" } });
  } });
  try {
    await f.settle();
    button(f, "Keep local").onClick();
    await f.settle();
    assert.equal(f.calls.prepared.length, 1);
    f.key("synthetic-conflict-b");
    await f.settle();
    held.resolve();
    await f.settle();
    assert.deepEqual(f.calls.retries, []);
    assert.equal(f.calls.invalidations, 0);
    assert.equal(f.calls.backs, 0);
    assert.equal(titleInput(f).value, "Synthetic local");
    assert.equal(button(f, "Back to conflicts").disabled, false);
    f.key("synthetic-conflict-a");
    await f.settle();
    assert.equal(button(f, "Retry resolution").disabled, false, "The already-saved request remains recoverable");
  } finally { held.resolve(); f.dispose(); }
});

test("an old resolution settling after a conflict change cannot navigate or relabel the new visit", async () => {
  for (const reject of [false, true]) {
    const held = deferred(), f = fixture({ retry: () => held.promise });
    try {
      await f.settle();
      button(f, "Keep local").onClick();
      await f.settle();
      assert.deepEqual(f.calls.retries, ["synthetic-conflict-a"]);
      f.store.set("sync-resolution-draft:synthetic-conflict-b", note("Synthetic second merge"));
      f.key("synthetic-conflict-b");
      await f.settle();
      const gets = f.calls.gets.length;
      if (reject) held.reject(Error("Synthetic retired resolution failure")); else held.resolve();
      await f.settle();
      assert.equal(titleInput(f).value, "Synthetic second merge");
      assert.equal(button(f, "Back to conflicts").disabled, false);
      assert.equal(find(f.tree, item => item.props?.role === "alert"), undefined);
      assert.equal(f.calls.gets.length, gets, "A retired failure must not begin its recovery lookup");
      assert.equal(f.calls.invalidations, 0);
      assert.equal(f.calls.backs, 0);
    } finally { held.resolve(); f.dispose(); }
  }
});

test("an old recovery status lookup cannot publish success or failure after a conflict change", async () => {
  for (const reject of [false, true]) {
    let recovering = false;
    const held = deferred(), f = fixture({
      prepare: async () => { recovering = true; throw Error("Synthetic prepare failure"); },
      get: key => { if (recovering && key === "synthetic-conflict-a") return held.promise; },
    });
    try {
      await f.settle();
      button(f, "Keep local").onClick();
      await f.settle();
      f.key("synthetic-conflict-b");
      await f.settle();
      if (reject) held.reject(Error("Synthetic retired lookup failure")); else held.resolve();
      await f.settle();
      assert.equal(titleInput(f).value, "Synthetic local");
      assert.equal(button(f, "Back to conflicts").disabled, false);
      assert.equal(find(f.tree, item => item.props?.role === "alert"), undefined);
      assert.deepEqual(f.calls.retries, []);
      assert.equal(f.calls.backs, 0);
    } finally { held.resolve(); f.dispose(); }
  }
});

test("retiring a visit during invalidation prevents the old return callback", async () => {
  const held = deferred(), f = fixture({ invalidate: () => held.promise });
  try {
    await f.settle();
    button(f, "Keep local").onClick();
    await f.settle();
    assert.equal(f.calls.invalidations, 1);
    f.key("synthetic-conflict-b");
    await f.settle();
    held.resolve();
    await f.settle();
    assert.equal(titleInput(f).value, "Synthetic local");
    assert.equal(button(f, "Back to conflicts").disabled, false);
    assert.equal(f.calls.backs, 0);
  } finally { held.resolve(); f.dispose(); }
});

test("unmount retires a started resolution's failure feedback, lookup and return callback", async () => {
  const held = deferred(), f = fixture({ retry: () => held.promise });
  try {
    await f.settle();
    button(f, "Keep local").onClick();
    await f.settle();
    assert.deepEqual(f.calls.retries, ["synthetic-conflict-a"]);
    const gets = f.calls.gets.length;
    f.dispose();
    held.reject(Error("Synthetic unmounted resolution failure"));
    await setImmediate();
    assert.equal(f.calls.gets.length, gets);
    assert.equal(f.calls.postDisposeUpdates, 0);
    assert.equal(f.calls.invalidations, 0);
    assert.equal(f.calls.backs, 0);
  } finally { held.resolve(); f.dispose(); }
});
