import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/offline/library-shell.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("library-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const shell = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LibraryShell");
const declaration = name => {
  const node = shell.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(ast) === name));
  assert.ok(node, `actual callback ${name}`);
  return node.getText(ast);
};
const effect = marker => {
  const node = shell.body.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect"
    && node.getText(ast).includes(marker));
  assert.ok(node, `actual effect ${marker}`);
  return node.expression.arguments[0].getText(ast);
};
const compiled = ts.transpileModule(`
  ${declaration("reloadSearchIndex")}
  ${declaration("reloadLocal")}
  exports.rebuild = reloadSearchIndex;
  exports.reload = reloadLocal;
  exports.watch = ${effect("addEventListener(AUTH_GENERATION_CHANGED_EVENT, retire)")};
  exports.search = (query) => (${effect("const indexSequence = searchReloadSequenceRef.current")})();
  exports.unmount = (${effect("libraryMountedRef.current = true")})();
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const snapshot = text => ({
  documents: [{ id: "synthetic-body", document_type: "message", plain_text: text }],
  annotations: [], notebooks: [],
});

// Executes the actual callbacks, subscription handlers and query effect.
// Dexie notifications, auth, timers and worker transport are controlled
// adapters, not an IndexedDB/liveQuery/React/browser acceptance claim.
function fixture({ allowed = true } = {}) {
  const state = { ready: false, failed: false, results: [], resultQuery: "", revision: 0, watchRevision: 0 };
  const calls = { initialized: [], reads: [], watches: 0, unsubscribed: 0 };
  let generation = 1, contents = snapshot("initial"), subscriber, worker = async () => undefined;
  let search = async () => [], cleanup, disposed = false;
  const timers = new Map(), listeners = new Map();
  let timerId = 0;
  const setTimer = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  const clearTimer = id => timers.delete(id);
  const setter = key => value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const table = (name, values) => ({ toArray: async () => {
    calls.reads.push(name);
    return structuredClone(values());
  } });
  const db = {
    searchDocuments: table("documents", () => contents.documents),
    annotations: table("annotations", () => contents.annotations),
    notebooks: table("notebooks", () => contents.notebooks),
    conversations: table("conversations", () => []),
    messages: table("messages", () => []),
    transaction: async (_mode, _tables, fn) => fn(),
  };
  const captureOfflineAccess = () => {
    if (!allowed) throw Error("synthetic access locked");
    return generation;
  };
  const bindings = {
    exports: {}, useCallback: fn => fn, offlineDb: db,
    queryClient: {}, invalidateReaderSearch: () => {},
    searchReloadSequenceRef: { current: 0 }, searchReloadQueueRef: { current: Promise.resolve() },
    searchWatchFailedRef: { current: false }, libraryMountedRef: { current: false },
    reloadSequenceRef: { current: 0 }, reloadQueueRef: { current: Promise.resolve() },
    localReadRef: { current: { phase: "ready", refreshing: false, refreshError: false } },
    setSearchIndexReady: setter("ready"), setSearchFailed: setter("failed"),
    setSearchResults: setter("results"), setSearchResultQuery: setter("resultQuery"),
    setSearchIndexRevision: setter("revision"), setSearchWatchRevision: setter("watchRevision"),
    setLocalRead: setter("localRead"), setConversations: setter("conversations"), setStorage: setter("storage"),
    captureOfflineAccess, assertOfflineAccess: value => {
      if (value !== captureOfflineAccess()) throw Error("synthetic retired access");
    },
    initializeOfflineSearch: async docs => { calls.initialized.push(docs); await worker(docs); },
    buildOfflineSearchDocuments: docs => docs,
    liveQuery: _read => ({ subscribe: value => {
      calls.watches++; subscriber = value;
      return { unsubscribe: () => { calls.unsubscribed++; } };
    } }),
    AUTH_GENERATION_CHANGED_EVENT: "synthetic-auth-generation",
    window: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
      setTimeout: setTimer, clearTimeout: clearTimer,
    },
    setTimeout: setTimer, clearTimeout: clearTimer, navigator: {},
    libraryActivityTime: () => 0, searchOffline: query => search(query),
    searchIndexReady: true,
  };
  new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  const api = bindings.exports;
  const restartWatch = () => { cleanup?.(); cleanup = api.watch(); };
  restartWatch();
  return {
    ...api, state, calls, bindings, restartWatch,
    emit(value) { contents = value; subscriber.next(structuredClone(value)); },
    failWatch() { subscriber.error(Error("synthetic subscription failure")); },
    setContents(value) { contents = value; },
    setWorker(value) { worker = value; },
    setSearch(value) { search = value; },
    async timers() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); await setImmediate(); },
    retire() { allowed = false; generation++; listeners.get("synthetic-auth-generation")?.(); },
    reauthorize() { allowed = true; generation++; },
    dispose() { if (disposed) return; disposed = true; cleanup?.(); api.unmount(); },
  };
}

test("rapid committed changes invalidate visible rows and coalesce to the latest snapshot", async () => {
  const f = fixture();
  try {
    await f.rebuild(); f.state.results = ["synthetic old result"];
    f.calls.initialized.length = 0; f.calls.reads.length = 0;
    f.emit(snapshot("first edit")); f.emit(snapshot("latest edit"));
    assert.equal(f.state.ready, false);
    assert.deepEqual(f.state.results, []);
    await f.timers();
    assert.equal(f.calls.initialized.length, 1);
    assert.equal(f.calls.initialized[0][0].plain_text, "latest edit");
    assert.equal(f.state.ready, true);
    assert.deepEqual(f.calls.reads, ["conversations"], "no full message scan on a content notification");
  } finally { f.dispose(); }
});

test("a pending old snapshot cannot overwrite an explicit fresh rebuild", async () => {
  const f = fixture();
  try {
    f.emit(snapshot("obsolete queued snapshot"));
    f.setContents(snapshot("fresh manual read"));
    await f.rebuild(); await f.timers();
    assert.equal(f.calls.initialized.length, 1);
    assert.equal(f.calls.initialized[0][0].plain_text, "fresh manual read");
  } finally { f.dispose(); }
});

test("an in-flight older worker rebuild is serialized before the latest rebuild", async () => {
  const f = fixture(), held = deferred();
  try {
    f.setWorker(docs => docs[0]?.plain_text === "initial" ? held.promise : Promise.resolve());
    const old = f.rebuild(); await setImmediate();
    f.emit(snapshot("latest"));
    await f.timers();
    assert.equal(f.calls.initialized.length, 1);
    held.resolve(); await old; await setImmediate();
    assert.equal(f.calls.initialized.length, 2);
    assert.equal(f.calls.initialized[1][0].plain_text, "latest");
    assert.equal(f.state.ready, true);
    assert.equal(f.state.revision, 1, "a retired rebuild cannot publish readiness/revision");
  } finally { held.resolve(); f.dispose(); }
});

test("deletion rebuilds an empty corpus instead of leaving deleted hits searchable", async () => {
  const f = fixture();
  try {
    await f.rebuild(); f.emit({ documents: [], annotations: [], notebooks: [] }); await f.timers();
    assert.deepEqual(f.calls.initialized.at(-1), []);
    assert.equal(f.state.ready, true);
  } finally { f.dispose(); }
});

test("a failed subscription can be reattached through the existing local retry", async () => {
  const f = fixture();
  try {
    f.failWatch(); assert.equal(f.state.failed, true);
    await f.reload();
    assert.equal(f.state.watchRevision, 1);
    assert.equal(f.bindings.searchWatchFailedRef.current, false);
    // React applies the changed dependency and runs this cleanup/new effect.
    f.restartWatch(); f.emit(snapshot("after retry")); await f.timers();
    assert.equal(f.calls.watches, 2);
    assert.equal(f.calls.initialized.at(-1)[0].plain_text, "after retry");
    assert.equal(f.state.ready, true);
  } finally { f.dispose(); }
});

test("worker failure retains retryability without poisoning the serialized queue", async () => {
  const f = fixture();
  try {
    f.setWorker(async () => { throw Error("synthetic worker failure"); });
    await assert.rejects(f.rebuild());
    assert.equal(f.state.failed, true); assert.equal(f.state.ready, false);
    f.setWorker(async () => undefined);
    await f.rebuild();
    assert.equal(f.state.failed, false); assert.equal(f.state.ready, true);
  } finally { f.dispose(); }
});

test("capture failure is an unavailable search state, not an uncaught effect error", async () => {
  const f = fixture({ allowed: false });
  try {
    assert.equal(f.state.failed, true);
    await assert.rejects(f.rebuild());
    assert.equal(f.state.ready, false);
    assert.deepEqual(f.calls.reads, []);
  } finally { f.dispose(); }
});

test("explicit retry after reauthorization reattaches a retired watcher with new access", async () => {
  const f = fixture();
  try {
    await f.rebuild();
    f.emit(snapshot("retired pending edit"));
    f.retire();
    await f.timers();
    assert.equal(f.state.failed, true);
    assert.equal(f.bindings.searchWatchFailedRef.current, true);
    assert.equal(f.calls.initialized.length, 1);
    f.reauthorize();
    f.setContents(snapshot("fresh authorized contents"));
    await f.reload();
    assert.equal(f.state.watchRevision, 1);
    f.restartWatch();
    f.emit(snapshot("new authorized edit")); await f.timers();
    assert.equal(f.calls.watches, 2);
    assert.equal(f.calls.initialized.at(-1)[0].plain_text, "new authorized edit");
    assert.equal(f.state.ready, true);
    assert.equal(f.state.failed, false);
  } finally { f.dispose(); }
});

for (const transition of ["auth", "unmount"]) test(`${transition} retires delayed rebuilds and old query results`, async () => {
  const f = fixture(), held = deferred();
  try {
    await f.rebuild();
    f.setSearch(() => held.promise);
    const stopSearch = f.search("needle"); await f.timers();
    f.emit(snapshot("retired edit"));
    if (transition === "auth") f.retire(); else f.dispose();
    held.resolve(["synthetic stale hit"]); await setImmediate(); await f.timers();
    assert.equal(f.calls.initialized.length, 1);
    assert.deepEqual(f.state.results, []);
    stopSearch();
  } finally { held.resolve([]); f.dispose(); }
});

test("a query from the preceding index generation cannot republish old hits during refresh", async () => {
  const f = fixture(), held = deferred();
  try {
    await f.rebuild(); f.setSearch(() => held.promise);
    const stop = f.search("needle"); await f.timers();
    f.emit(snapshot("new content")); held.resolve(["synthetic stale hit"]); await setImmediate();
    assert.deepEqual(f.state.results, []);
    stop(); await f.timers();
    f.setSearch(async () => ["synthetic current hit"]);
    const stopNew = f.search("needle"); await f.timers();
    assert.deepEqual(f.state.results, ["synthetic current hit"]);
    stopNew();
  } finally { held.resolve([]); f.dispose(); }
});
