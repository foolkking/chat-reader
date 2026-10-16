import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const compile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function syncHarness(locks) {
  const source = ts.createSourceFile("annotation-sync.ts", read("lib/annotation-sync.ts"), ts.ScriptTarget.Latest, true);
  const names = new Set(["running", "tails", "normalizeConversationIds", "flushAnnotationOutbox"]);
  const selected = source.statements.filter(node => names.has(node.name?.text)
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(source)))));
  const db = { name: "synthetic-db" }, reads = [], positions = [], lockCalls = [];
  let gate = null, accessFailure = false;
  const navigator = {
    onLine: true,
    ...(locks ? { locks: { request: async (key, work) => { lockCalls.push(key); return await work({}); } } } : {}),
  };
  const scope = {
    navigator, offlineDb: db,
    captureOfflineAccess: () => 1,
    assertOfflineAccess: () => { if (accessFailure) throw new Error("synthetic access retired"); },
    flushBatch: async (_db, _access, ids) => {
      reads.push(ids);
      if (gate) await gate.promise;
      return { synced: 1, conflicts: 0 };
    },
    flushReadingPositionBatch: async (_db, _access, ids) => { positions.push(ids); return { synced: 2, conflicts: 0 }; },
  };
  const exports = {};
  new Function("exports", ...Object.keys(scope), compile(selected.map(node => node.getText(source)).join("\n")))(
    exports, ...Object.values(scope),
  );
  return {
    flush: exports.flushAnnotationOutbox, reads, positions, lockCalls, navigator,
    hold: value => { gate = value; }, failAccess: value => { accessFailure = value; },
  };
}
for (const locks of [false, true]) {
  test(`scope deduplication and serial draining survive ${locks ? "Web Locks" : "fallback"} path`, async () => {
    const f = syncHarness(locks), hold = deferred();
    f.hold(hold);
    const first = f.flush(["b", "a", "a"]), same = f.flush(["a", "b"]), later = f.flush(["c"]);
    assert.equal(first, same);
    await tick();
    assert.deepEqual(f.reads, [["a", "b"]]);
    f.hold(null); hold.resolve();
    assert.deepEqual(await first, { synced: 3, conflicts: 0, retryAt: undefined });
    assert.deepEqual(await later, { synced: 3, conflicts: 0, retryAt: undefined });
    assert.deepEqual(f.reads, [["a", "b"], ["c"]]);
    assert.deepEqual(f.positions, [["a", "b"], ["c"]]);
    assert.equal(f.lockCalls.length, locks ? 2 : 0);
  });
  test(`failed queue tails permit an explicit later retry with ${locks ? "locks" : "fallback"}`, async () => {
    const f = syncHarness(locks);
    f.failAccess(true);
    await assert.rejects(f.flush(["a"]), /synthetic access retired/);
    await tick();
    f.failAccess(false);
    assert.equal((await f.flush(["a"])).synced, 3);
    assert.deepEqual(f.reads, [["a"]]);
  });
}
test("an empty conversation scope never becomes a global sync request", async () => {
  const f = syncHarness(true);
  await f.flush([]);
  assert.deepEqual(f.reads, [[]]);
  assert.deepEqual(f.positions, [[]]);
  await f.flush();
  assert.equal(f.reads.at(-1), undefined);
});
test("offline sync returns a settled empty result without requesting locks or transport", async () => {
  const f = syncHarness(true);
  f.navigator.onLine = false;
  assert.deepEqual(await f.flush(), { synced: 0, conflicts: 0 });
  assert.equal(f.reads.length, 0);
  assert.equal(f.lockCalls.length, 0);
});
test("global offline manager invokes the scope-aware flush with zero arguments and cleans listeners", async () => {
  const calls = [], listeners = new Map();
  let cleanup;
  const exports = {};
  const navigator = { onLine: true };
  const window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  new Function("require", "exports", "navigator", "window", compile(read("components/offline-sync-manager.tsx")))(name => {
    if (name === "react") return { useEffect: effect => { cleanup = effect(); } };
    if (name === "../lib/annotation-repository") return {
      flushAnnotationOutbox: async (...args) => { calls.push(args); return { synced: 0, conflicts: 0 }; },
    };
    throw new Error(name);
  }, exports, navigator, window);
  exports.OfflineSyncManager();
  await tick();
  assert.deepEqual(calls, [[]]);
  assert.equal(listeners.size, 2);
  cleanup();
  assert.equal(listeners.size, 0);
});
test("drag notices retain a single cancellable numeric browser timer", () => {
  const ast = ts.createSourceFile("sidebar.tsx", read("features/projects/project-sidebar.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  const walk = node => {
    if (ts.isFunctionDeclaration(node) && ["showDragNotice", "clearDragNotice"].includes(node.name?.text)) declarations.push(node.getText(ast));
    ts.forEachChild(node, walk);
  };
  walk(ast);
  assert.equal(declarations.length, 2);
  const timers = new Map(), dragNoticeTimerRef = { current: null };
  let notice = null, id = 0;
  const window = {
    setTimeout: fn => { timers.set(++id, fn); return id; },
    clearTimeout: key => timers.delete(key),
  };
  const scope = { window, dragNoticeTimerRef, setDragNotice: value => { notice = value; } };
  const methods = new Function(...Object.keys(scope), compile(declarations.join("\n")) + "\nreturn { showDragNotice, clearDragNotice };")(...Object.values(scope));
  methods.showDragNotice("first"); methods.showDragNotice("second");
  assert.equal(timers.size, 1); assert.equal(notice, "second"); assert.equal(dragNoticeTimerRef.current, 2);
  methods.clearDragNotice();
  assert.equal(timers.size, 0); assert.equal(notice, null); assert.equal(dragNoticeTimerRef.current, null);
});
test("translation dictionaries contain unique keys while preserving the 500-file guidance", () => {
  const source = read("features/import/import-workspace-copy.ts");
  const ast = ts.createSourceFile("copy.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(ast) === "english")).declarationList.declarations[0];
  const names = declaration.initializer.properties.map(item => item.name.text);
  assert.equal(new Set(names).size, names.length);
  assert.match(source, /"一次最多分析 500 个文件。": "Analyze up to 500 files at a time\."/);
});
