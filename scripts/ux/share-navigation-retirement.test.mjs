import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/sharing/share-readonly-reader.tsx");
const ast = ts.createSourceFile("share-readonly-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ShareReadonlyReader");
const names = new Set(["navigationVisit", "storageIsCurrent", "currentSavedPosition", "initialWindowQuery",
  "applyLoadedWindow", "navigateToTarget"]);
const effects = ["void sharePositionStorageKey(token)", "navigationVisit.active = true;",
  "!storageIsCurrent || !initialWindowQuery.data", "const candidates: Array<number | undefined>"];
const selected = reader.body.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(ast))))
  || (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ["useEffect", "useLayoutEffect"].includes(node.expression.expression.getText(ast))
    && effects.some(text => node.getText(ast).includes(text))));
assert.equal(selected.length, names.size + effects.length);
let manualIntent;
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "markScrollIntent") manualIntent = node;
  ts.forEachChild(node, visit);
};
visit(reader);
assert.ok(manualIntent?.initializer);
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["sharePositionStorageKey", "readSharePosition", "numberOrNull", "findBlockIndexById"].includes(node.name?.text));
assert.equal(helpers.length, 4);
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const inputs = ["token", "shareQuery", "storageReady", "storageVisit", "savedPosition",
  "setStorageKey", "setSavedPosition", "setStorageReady", "setStorageVisit", "setPositionStorageUnavailable", "setLoadedWindow", "setPositionReady",
  "setActiveMessageId", "setNavigationTargetMessageId", "setActiveBlockId", "setTargetHighlightId",
  "setMobileNavigation", "setEdgeLoading", "setEdgeError", "navigationTokenRef", "targetHighlightTimerRef",
  "restoreAttemptedRef", "latestStablePositionRef", "loadedWindowRef", "windowGenerationRef", "initialWindowAppliedRef",
  "loadingPreviousRef", "loadingNextRef", "edgeTransitionRef", "userScrollIntentRef", "scrollDirectionRef",
  "scrollIntentSequenceRef", "previousTurnAnchorRef", "nextTurnAnchorRef", "positionStorageDisabledRef", "onManualIntent"];
const compiled = compile(`function renderShare(input) {
  const { ${inputs.join(", ")} } = input;
  ${selected.map(node => node.getText(ast)).join("\n")}
  const markScrollIntent = ${manualIntent.initializer.getText(ast)};
  return { navigate: navigateToTarget, visit: navigationVisit, manualIntent: markScrollIntent,
    storageIsCurrent, currentSavedPosition, initialWindowQuery };
}
${helpers.map(node => node.getText(ast)).join("\n")}
exports.renderShare = renderShare;`);
const windowExports = {};
new Function("exports", compile(read("features/conversations/reader-window.ts")))(windowExports);
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const message = name => ({ id: `synthetic-share-message-${name}`, order_key: name, role: "assistant",
  current_version: { id: `synthetic-share-version-${name}` },
  render_blocks: [{ id: `synthetic-share-block-${name}`, block_index: 0, block_type: "paragraph" }] });
const A = message("A"), B = message("B");
const target = item => ({ messageId: item.id, messageVersionId: item.current_version.id,
  blockIndex: 0, renderBlockId: item.render_blocks[0].id });
const page = items => ({ items, turns: [], total: items.length, offset: 0, limit: items.length,
  has_previous: false, has_more: false, previousTurnAnchorMessageId: null, nextTurnAnchorMessageId: null });
const saved = item => ({ message_id: item.id, block_index: 3, scroll_offset: 5,
  anchor_data: { block_id: item.render_blocks[0].id, character_offset: 12, block_offset: 7, heading_block_index: 2 },
  saved_at: "2026-10-15T00:00:00.000Z" });
const storageKey = byte => `chat-reader:share-position:${byte.toString(16).padStart(2, "0").repeat(32)}`;

// Actual extracted Share callback/effects/manual intent and local window/key/
// position helpers. Hooks, query snapshots, digest bytes, storage, transport,
// leases, DOM, alignment/settling and timers are controlled adapters. This is
// not mounted React, real crypto/storage, QueryClient or browser acceptance.
function fixture({ items = [B], positions = new Map() } = {}) {
  const calls = { writes: [], resolvers: [], windows: [], leases: [], mounts: [], settles: [], released: [],
    timers: [], clearedTimers: [], querySpecs: [], digests: [], storageReads: [], manual: 0 };
  const handlers = {};
  let memoCursor = 0, effectCursor = 0, current, query = { isSuccess: false, data: undefined };
  let pendingLayout = new Map(), pendingPassive = new Map();
  const memos = [], layouts = new Map(), passives = new Map(), timers = new Map();
  const state = { token: "synthetic-share-visit-A", shareQuery: { isSuccess: true }, storageReady: false,
    storageVisit: null, savedPosition: null, positionReady: false };
  for (const [name, value] of Object.entries({
    navigationTokenRef: 0, targetHighlightTimerRef: null, restoreAttemptedRef: false, latestStablePositionRef: null,
    windowGenerationRef: 0, initialWindowAppliedRef: false, loadingPreviousRef: false, loadingNextRef: false,
    edgeTransitionRef: null, userScrollIntentRef: false, scrollDirectionRef: null, scrollIntentSequenceRef: 0,
    previousTurnAnchorRef: null, nextTurnAnchorRef: null, positionStorageDisabledRef: null,
  })) state[name] = { current: value };
  state.loadedWindowRef = { current: windowExports.emptyLoadedWindow() };
  const setter = name => value => { state[name] = value; calls.writes.push([name, value]); };
  for (const name of ["StorageKey", "SavedPosition", "StorageReady", "StorageVisit", "LoadedWindow", "PositionReady",
    "ActiveMessageId", "NavigationTargetMessageId", "ActiveBlockId", "TargetHighlightId", "MobileNavigation",
    "EdgeLoading", "EdgeError", "PositionStorageUnavailable"]) state[`set${name}`] = setter(name[0].toLowerCase() + name.slice(1));
  state.onManualIntent = () => calls.manual++;
  const memo = (value, deps) => {
    const index = memoCursor++, previous = memos[index];
    if (!previous || !same(previous.deps, deps)) memos[index] = { deps, value: value() };
    return memos[index].value;
  };
  const register = (pending, effect, deps) => pending.set(effectCursor++, { effect, deps });
  const flush = (pending, committed) => {
    const changed = [...pending].filter(([index, next]) => !same(committed.get(index)?.deps, next.deps));
    for (const [index] of changed) committed.get(index)?.cleanup?.();
    for (const [index, next] of changed) committed.set(index, { ...next, cleanup: next.effect() });
    pending.clear();
  };
  const exports = {};
  const dependencies = { exports, useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: (effect, deps) => register(pendingPassive, effect, deps),
    useLayoutEffect: (effect, deps) => register(pendingLayout, effect, deps),
    useQuery: options => { calls.querySpecs.push(options); return query; },
    window: {
      crypto: { subtle: { digest: async (algorithm, bytes) => {
        const token = new TextDecoder().decode(bytes);
        calls.digests.push({ algorithm, token });
        return handlers.digest ? handlers.digest(token) : new Uint8Array(32).fill(token.endsWith("A") ? 1 : 2).buffer;
      } } },
      localStorage: { getItem: key => {
        calls.storageReads.push(key);
        return handlers.storageRead ? handlers.storageRead(key) : positions.get(key) ?? null;
      } },
      clearTimeout: id => { calls.clearedTimers.push(id); timers.delete(id); },
      setTimeout: (callback, delay) => {
        const id = calls.timers.length + 1;
        calls.timers.push({ id, callback, delay }); timers.set(id, callback); return id;
      },
    },
    document: { getElementById: () => null, querySelector: () => null },
    CSS: { escape: value => value }, ACTIVE_READING_OFFSET: 96, INITIAL_WINDOW_TURNS: windowExports.INITIAL_WINDOW_TURNS,
    emptyLoadedWindow: windowExports.emptyLoadedWindow, replaceLoadedWindow: windowExports.replaceLoadedWindow,
    resolveSharedLocator: async (token, value) => {
      calls.resolvers.push({ token, value });
      return handlers.resolver?.(value, token);
    },
    loadSharedCompleteTurnWindow: async (token, id, count) => {
      calls.windows.push({ token, id, count });
      return handlers.window ? handlers.window(id, token) : page([id === A.id ? A : B]);
    },
    acquireReaderBlockLease: async (id, index, isCurrent) => {
      calls.leases.push({ id, index, isCurrent });
      return handlers.lease ? handlers.lease(id) : { release: () => calls.released.push(id) };
    },
    navigateMountedTarget: async options => {
      calls.mounts.push(options);
      return handlers.mount ? handlers.mount(options) : { ok: true, targetId: options.targetId };
    },
    restoreScrollAnchor: async options => { calls.settles.push(options); return handlers.settle?.(options); },
  };
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const render = () => {
    memoCursor = 0; effectCursor = 0; pendingLayout = new Map(); pendingPassive = new Map();
    current = exports.renderShare(state); flush(pendingLayout, layouts);
  };
  render();
  state.loadedWindowRef.current = windowExports.replaceLoadedWindow(page(items), state.windowGenerationRef.current);
  return { state, calls, handlers, timers, render, get current() { return current; },
    get querySpec() { return calls.querySpecs.at(-1); },
    flushPassive() { flush(pendingPassive, passives); },
    async readyStorage() {
      flush(pendingPassive, passives); await setImmediate(); render(); flush(pendingPassive, passives);
    },
    initial(items) { query = { isSuccess: true, data: page(items) }; render(); flush(pendingPassive, passives); },
    switchVisit() { state.token = "synthetic-share-visit-B"; render(); },
    replayLayout() {
      for (const entry of layouts.values()) { entry.cleanup?.(); entry.cleanup = entry.effect(); }
    },
    replayPassive() {
      for (const entry of passives.values()) { entry.cleanup?.(); entry.cleanup = entry.effect(); }
    },
    dispose() {
      for (const entry of layouts.values()) entry.cleanup?.();
      for (const entry of passives.values()) entry.cleanup?.();
    },
  };
}
const observable = f => ({ writes: f.calls.writes.length, windows: f.calls.windows.length, leases: f.calls.leases.length,
  mounts: f.calls.mounts.length, settles: f.calls.settles.length, timers: f.calls.timers.length });
const atStage = async (f, stage, hold) => {
  f.handlers[stage] = (...args) => {
    const id = stage === "resolver" ? args[0].message_id : stage === "mount" || stage === "settle"
      ? (args[0].targetId ?? args[0].anchor.targetId) : args[0];
    if (id.includes(A.id)) return hold.promise;
    if (stage === "window") return page([B]);
    if (stage === "lease") return { release: () => f.calls.released.push(B.id) };
    if (stage === "mount") return { ok: true, targetId: args[0].targetId };
  };
  const older = f.current.navigate(target(A));
  await setImmediate();
  return { older };
};

test("current navigation keeps old four-argument calls, locator payload, offsets, lease release and one highlight timer", async () => {
  const f = fixture();
  try {
    assert.equal((await f.current.navigate(A.id, 0, 91, 12)).ok, true);
    assert.equal(f.calls.resolvers[0].value.message_id, A.id);
    assert.equal(f.calls.resolvers[0].value.canonical_start, 12);
    assert.equal(f.calls.mounts[0].offset, 91);
    assert.equal(f.calls.mounts[0].characterOffset, 12);
    assert.equal(f.calls.settles[0].anchor.offset, 91);
    assert.deepEqual(f.calls.released, [A.id]);
    assert.equal(f.state.positionReady, true);
    assert.equal(f.state.restoreAttemptedRef.current, true);
    assert.equal(f.timers.size, 1);
    assert.equal(f.calls.timers[0].delay, 2000);
    assert.equal((await f.current.navigate(target(B))).ok, true);
    assert.deepEqual(f.calls.clearedTimers, [1]);
    assert.equal(f.timers.size, 1);
    const snapshot = observable(f);
    f.calls.timers[0].callback();
    assert.deepEqual(observable(f), snapshot);
    assert.equal(f.state.targetHighlightTimerRef.current, 2);
  } finally { f.dispose(); }
  assert.equal(f.timers.size, 0);
});

test("optional resolver rejection remains compatible for a current visit", async () => {
  const f = fixture();
  f.handlers.resolver = () => { throw Error("Synthetic unavailable optional endpoint"); };
  try {
    assert.equal((await f.current.navigate(target(A))).ok, true);
    assert.equal(f.calls.windows.length, 1);
  } finally { f.dispose(); }
});

for (const stage of ["resolver", "window", "lease", "mount", "settle"]) {
  for (const rejects of [false, true]) {
    test(`retired ${stage} ${rejects ? "rejection" : "completion"} cannot overwrite newer navigation or start a next stage`, async () => {
      const f = fixture(), hold = deferred();
      try {
        const { older } = await atStage(f, stage, hold);
        assert.equal((await f.current.navigate(target(B))).ok, true);
        const snapshot = observable(f);
        if (rejects) hold.reject(Error("Synthetic obsolete failure"));
        else if (stage === "window") hold.resolve(page([A]));
        else if (stage === "lease") hold.resolve({ release: () => f.calls.released.push(A.id) });
        else if (stage === "mount") hold.resolve({ ok: true, targetId: `block-${A.id}-0` });
        else hold.resolve(undefined);
        assert.equal((await older).reason, "cancelled");
        assert.deepEqual(observable(f), snapshot);
        assert.equal(f.state.activeMessageId, B.id);
        if (["mount", "settle"].includes(stage) || (stage === "lease" && !rejects)) {
          assert.ok(f.calls.released.includes(A.id));
        }
      } finally { f.dispose(); }
    });
  }
}

for (const retirement of ["unmount", "token", "layout replay", "manual input"]) {
  test(`${retirement} retires a pending navigation; callbacks cannot gain admission after unmount/token change`, async () => {
    const f = fixture(), hold = deferred();
    try {
      const oldCallback = f.current.navigate;
      const { older } = await atStage(f, "mount", hold);
      const predicate = f.calls.mounts[0].tokenIsCurrent;
      if (retirement === "unmount") f.dispose();
      else if (retirement === "token") f.switchVisit();
      else if (retirement === "layout replay") f.replayLayout();
      else f.current.manualIntent();
      assert.equal(predicate(), false);
      const snapshot = observable(f);
      hold.resolve({ ok: true, targetId: `block-${A.id}-0` });
      assert.equal((await older).reason, "cancelled");
      assert.deepEqual(observable(f), snapshot);
      assert.deepEqual(f.calls.released, [A.id]);
      if (retirement === "unmount" || retirement === "token") {
        assert.equal((await oldCallback(target(A))).reason, "cancelled");
        assert.deepEqual(observable(f), snapshot);
      }
    } finally { f.dispose(); }
  });
}

test("current load failure remains finite; mounted missing-target failure is unchanged", async () => {
  const f = fixture();
  try {
    f.handlers.window = () => { throw Error("Synthetic current read failure"); };
    assert.equal((await f.current.navigate(target(A))).reason, "load-failed");
    f.handlers.mount = options => ({ ok: false, targetId: options.targetId, reason: "target-not-mounted" });
    assert.equal((await f.current.navigate(target(B))).reason, "target-not-mounted");
    assert.equal(f.calls.settles.length, 0);
    assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});

test("same-intent restoration preserves exact/legacy fallback order and offsets without adding user intent", async () => {
  const positions = new Map([[storageKey(1), JSON.stringify(saved(A))]]);
  const f = fixture({ positions, items: [] });
  try {
    await f.readyStorage();
    const sequence = f.state.scrollIntentSequenceRef.current;
    f.handlers.mount = options => ({ ok: false, targetId: options.targetId, reason: "target-not-mounted" });
    f.initial([A]);
    await setImmediate();
    assert.deepEqual(f.calls.leases.map(call => call.index), [0, 3, 2]);
    assert.deepEqual(f.calls.mounts.map(call => call.targetId), [`block-${A.id}-0`, `block-${A.id}-3`,
      `block-${A.id}-2`, `message-${A.id}`]);
    assert.deepEqual(f.calls.mounts.map(call => call.offset), [96, 89, 89, 96]);
    assert.deepEqual(f.calls.mounts.map(call => call.characterOffset), [12, undefined, undefined, undefined]);
    assert.equal(f.state.scrollIntentSequenceRef.current, sequence);
    assert.equal(f.state.positionReady, true);
  } finally { f.dispose(); }
});

test("a current visit without a saved position becomes ready without an automatic navigation", async () => {
  const f = fixture({ items: [] });
  try {
    await f.readyStorage();
    assert.equal(f.querySpec.queryKey[2], null);
    await f.querySpec.queryFn();
    assert.equal(f.calls.windows.at(-1).id, undefined);
    f.initial([A]);
    await setImmediate();
    assert.equal(f.state.positionReady, true);
    assert.equal(f.state.activeMessageId, A.id);
    assert.equal(f.calls.resolvers.length, 0);
    assert.equal(f.calls.mounts.length, 0);
  } finally { f.dispose(); }
});

for (const takeover of ["cancelled result", "manual input", "explicit choice", "token", "unmount"]) {
  test(`saved-position fallback stops after ${takeover}`, async () => {
    const positions = new Map([[storageKey(1), JSON.stringify(saved(A))]]);
    const f = fixture({ positions, items: [] }), hold = deferred();
    try {
      await f.readyStorage();
      f.handlers.mount = options => options.targetId.includes(A.id)
        ? hold.promise : { ok: true, targetId: options.targetId };
      f.initial([A]);
      await setImmediate();
      assert.equal(f.calls.mounts.length, 1);
      if (takeover === "manual input") f.current.manualIntent();
      else if (takeover === "explicit choice") assert.equal((await f.current.navigate(target(B))).ok, true);
      else if (takeover === "token") f.switchVisit();
      else if (takeover === "unmount") f.dispose();
      const before = f.calls.resolvers.length;
      const readyWrites = f.calls.writes.filter(([name]) => name === "positionReady").length;
      hold.resolve({ ok: false, targetId: `block-${A.id}-0`, reason: "cancelled" });
      await setImmediate();
      assert.equal(f.calls.resolvers.length, before);
      if (takeover === "token" || takeover === "unmount") {
        assert.equal(f.calls.writes.filter(([name]) => name === "positionReady").length, readyWrites);
      } else assert.equal(f.state.positionReady, true);
    } finally { f.dispose(); }
  });
}

test("an explicit choice before initial query success suppresses delayed saved-position restoration", async () => {
  const positions = new Map([[storageKey(1), JSON.stringify(saved(A))]]);
  const f = fixture({ positions, items: [] });
  try {
    await f.readyStorage();
    assert.equal((await f.current.navigate(target(B))).ok, true);
    const resolverCount = f.calls.resolvers.length;
    f.initial([A]);
    await setImmediate();
    assert.equal(f.calls.resolvers.length, resolverCount);
    assert.equal(f.state.activeMessageId, B.id);
    assert.deepEqual(f.state.loadedWindowRef.current.items.map(item => item.id), [B.id]);
    assert.equal(f.state.positionReady, true);
  } finally { f.dispose(); }
});

test("token-scoped readiness withholds the old anchor until the new hashed storage key completes", async () => {
  const positions = new Map([[storageKey(1), JSON.stringify(saved(A))], [storageKey(2), JSON.stringify(saved(B))]]);
  const f = fixture({ positions }), hold = deferred();
  try {
    await f.readyStorage();
    assert.equal(f.current.storageIsCurrent, true);
    assert.equal(f.querySpec.enabled, true);
    assert.equal(f.querySpec.queryKey[2], A.id);
    f.handlers.digest = () => hold.promise;
    f.state.latestStablePositionRef.current = saved(A);
    f.state.restoreAttemptedRef.current = true;
    f.state.positionReady = true;
    f.switchVisit(); f.flushPassive();
    assert.equal(f.current.storageIsCurrent, false);
    assert.equal(f.querySpec.enabled, false);
    assert.equal(f.querySpec.queryKey[2], null);
    assert.equal(f.state.positionReady, false);
    assert.equal(f.state.restoreAttemptedRef.current, false);
    assert.equal(f.state.latestStablePositionRef.current, null);
    assert.equal(f.state.activeMessageId, null);
    hold.resolve(new Uint8Array(32).fill(2).buffer);
    await setImmediate(); f.render(); f.flushPassive();
    assert.equal(f.current.storageIsCurrent, true);
    assert.equal(f.querySpec.queryKey[2], B.id);
    assert.equal(f.state.storageKey, storageKey(2));
    await f.querySpec.queryFn();
    assert.deepEqual(f.calls.windows.at(-1), {
      token: "synthetic-share-visit-B", id: B.id, count: windowExports.INITIAL_WINDOW_TURNS,
    });
    assert.ok(f.calls.digests.every(call => call.algorithm === "SHA-256"));
    assert.deepEqual(f.calls.storageReads, [storageKey(1), storageKey(2)]);
  } finally { f.dispose(); }
});

test("an older storage-key completion cannot relabel a new visit or expose an old saved anchor", async () => {
  const positions = new Map([[storageKey(1), JSON.stringify(saved(A))], [storageKey(2), JSON.stringify(saved(B))]]);
  const f = fixture({ positions }), hold = deferred();
  try {
    f.handlers.digest = token => token.endsWith("A") ? hold.promise : new Uint8Array(32).fill(2).buffer;
    f.flushPassive();
    f.switchVisit(); f.flushPassive();
    await setImmediate(); f.render(); f.flushPassive();
    assert.equal(f.querySpec.queryKey[2], B.id);
    const snapshot = observable(f);
    hold.resolve(new Uint8Array(32).fill(1).buffer);
    await setImmediate(); f.render(); f.flushPassive();
    assert.deepEqual(observable(f), snapshot);
    assert.equal(f.querySpec.queryKey[2], B.id);
    assert.deepEqual(f.calls.storageReads, [storageKey(2)]);
  } finally { f.dispose(); }
});

for (const failure of ["digest", "storage access"]) {
  test(`${failure} failure settles current readiness for unanchored reading without a replacement storage key`, async () => {
    const f = fixture();
    try {
      f.handlers[failure === "digest" ? "digest" : "storageRead"] = () => {
        throw Error("Synthetic private storage detail");
      };
      await f.readyStorage();
      assert.equal(f.current.storageIsCurrent, true);
      assert.equal(f.state.storageReady, true);
      assert.equal(f.state.storageKey, null);
      assert.equal(f.state.savedPosition, null);
      assert.equal(f.state.positionStorageUnavailable, true);
      assert.equal(f.querySpec.enabled, true);
      assert.equal(f.querySpec.queryKey[2], null);
      await f.querySpec.queryFn();
      assert.equal(f.calls.windows.at(-1).id, undefined);
      assert.equal(JSON.stringify(f.calls.writes).includes("Synthetic private"), false);
      assert.equal(f.calls.storageReads.length, failure === "digest" ? 0 : 1);
      const probes = f.calls.digests.length + f.calls.storageReads.length;
      f.replayPassive(); await setImmediate(); f.render(); f.flushPassive();
      assert.equal(f.calls.digests.length + f.calls.storageReads.length, probes);
    } finally { f.dispose(); }
  });
}

test("bad JSON retains the null-anchor behavior without marking accessible storage unavailable", async () => {
  const f = fixture({ positions: new Map([[storageKey(1), "{invalid synthetic JSON"]]) });
  try {
    await f.readyStorage();
    assert.equal(f.state.savedPosition, null);
    assert.equal(f.state.storageKey, storageKey(1));
    assert.equal(f.state.positionStorageUnavailable, false);
    assert.equal(f.querySpec.enabled, true);
  } finally { f.dispose(); }
});

test("a retired digest rejection cannot disable the newer visit's successful storage", async () => {
  const f = fixture(), hold = deferred();
  try {
    f.handlers.digest = token => token.endsWith("A") ? hold.promise : new Uint8Array(32).fill(2).buffer;
    f.flushPassive(); f.switchVisit(); f.flushPassive();
    await setImmediate(); f.render(); f.flushPassive();
    const before = observable(f);
    hold.reject(Error("Synthetic retired digest detail"));
    await setImmediate(); f.render(); f.flushPassive();
    assert.deepEqual(observable(f), before);
    assert.equal(f.state.positionStorageUnavailable, false);
    assert.equal(f.state.storageKey, storageKey(2));
    assert.equal(f.current.storageIsCurrent, true);
  } finally { f.dispose(); }
});

test("a fresh visit may initialize normally after the previous visit disabled its store", async () => {
  const f = fixture();
  try {
    f.handlers.digest = () => { throw Error("Synthetic unavailable digest"); };
    await f.readyStorage();
    const oldVisit = f.current.visit;
    assert.equal(f.state.positionStorageDisabledRef.current, oldVisit);
    f.handlers.digest = () => new Uint8Array(32).fill(2).buffer;
    f.switchVisit(); f.flushPassive();
    await setImmediate(); f.render(); f.flushPassive();
    assert.equal(f.current.storageIsCurrent, true);
    assert.notEqual(f.current.visit, oldVisit);
    assert.equal(f.state.positionStorageDisabledRef.current, null);
    assert.equal(f.state.positionStorageUnavailable, false);
    assert.equal(f.state.storageKey, storageKey(2));
  } finally { f.dispose(); }
});

const positionWith = overrides => JSON.stringify({ ...saved(A), ...overrides });
for (const [name, bytes] of [
  ["null", "null"], ["array", "[]"], ["primitive", "17"], ["string", '"synthetic-position"'], ["empty record", "{}"],
  ["missing message", positionWith({ message_id: undefined })],
  ["blank message", positionWith({ message_id: " \t" })],
  ["numeric message", positionWith({ message_id: 12 })],
  ["object message", positionWith({ message_id: { id: A.id } })],
  ["missing anchor", positionWith({ anchor_data: undefined })],
  ["null anchor", positionWith({ anchor_data: null })],
  ["array anchor", positionWith({ anchor_data: [] })],
  ["string anchor", positionWith({ anchor_data: "synthetic-anchor" })],
  ["missing pixel offset", positionWith({ scroll_offset: undefined })],
  ["null pixel offset", positionWith({ scroll_offset: null })],
  ["string pixel offset", positionWith({ scroll_offset: "5" })],
  ["overflow pixel offset", positionWith({}).replace('"scroll_offset":5', '"scroll_offset":1e400')],
  ["negative block index", positionWith({ block_index: -1 })],
  ["fractional block index", positionWith({ block_index: 0.5 })],
  ["string block index", positionWith({ block_index: "3" })],
  ["boolean block index", positionWith({ block_index: true })],
  ["unsafe block index", positionWith({ block_index: Number.MAX_SAFE_INTEGER + 1 })],
  ["overflow block index", positionWith({}).replace('"block_index":3', '"block_index":1e400')],
]) {
  test(`${name}: unusable stored JSON cannot poison the initial query or start restoration, and reads do not delete it`, async () => {
    const positions = new Map([[storageKey(1), bytes]]), f = fixture({ positions });
    try {
      await f.readyStorage();
      assert.equal(f.state.savedPosition, null);
      assert.equal(f.state.storageKey, storageKey(1));
      assert.equal(f.state.positionStorageUnavailable, false);
      assert.equal(f.state.positionStorageDisabledRef.current, null);
      assert.equal(f.current.storageIsCurrent, true);
      assert.equal(f.querySpec.enabled, true);
      assert.equal(f.querySpec.queryKey[2], null);
      await f.querySpec.queryFn();
      assert.equal(f.calls.windows.at(-1).id, undefined);
      f.initial([B]); await setImmediate();
      assert.equal(f.state.positionReady, true);
      assert.deepEqual(f.calls.resolvers, []);
      assert.deepEqual(f.calls.mounts, []);
      assert.deepEqual(f.calls.storageReads, [storageKey(1)]);
      assert.equal(positions.get(storageKey(1)), bytes);
    } finally { f.dispose(); }
  });
}

for (const [name, position] of [
  ["current v2", { ...saved(A), anchor_data: { ...saved(A).anchor_data, position_mode: "block-relative-v2" } }],
  ["legacy v1 without character anchor", { ...saved(A), anchor_data: {
    position_mode: "block-relative-v1", heading_block_index: 2, block_offset: 7,
  } }],
  ["numeric legacy anchor hints", { ...saved(A), anchor_data: {
    position_mode: "block-relative-v1", heading_block_index: "2", block_offset: "7",
  } }],
  ["minimal message anchor", { message_id: A.id, scroll_offset: 0, anchor_data: {} }],
  ["null block index", { message_id: A.id, block_index: null, scroll_offset: 5.25, anchor_data: {} }],
  ["signed finite pixels and extra metadata", { ...saved(A), scroll_offset: -2.5,
    extra_metadata: { synthetic: true }, anchor_data: { future_field: "synthetic-compatible", block_offset: -2.5 } }],
]) {
  test(`${name}: usable current/legacy fields reach the existing restore unchanged without a read-time migration`, async () => {
    const bytes = JSON.stringify(position), positions = new Map([[storageKey(1), bytes]]), f = fixture({ positions });
    try {
      await f.readyStorage();
      assert.deepEqual(f.state.savedPosition, position);
      assert.equal(f.state.positionStorageUnavailable, false);
      assert.equal(f.state.storageKey, storageKey(1));
      assert.equal(f.querySpec.queryKey[2], A.id);
      await f.querySpec.queryFn();
      assert.equal(f.calls.windows.at(-1).id, A.id);
      f.initial([A]); await setImmediate();
      assert.equal(f.state.positionReady, true);
      assert.equal(f.calls.mounts.length, 1);
      assert.equal(Number.isFinite(f.calls.mounts[0].offset), true);
      assert.ok(f.calls.mounts[0].targetId.includes(A.id));
      assert.equal(positions.get(storageKey(1)), bytes);
      assert.deepEqual(f.calls.storageReads, [storageKey(1)]);
    } finally { f.dispose(); }
  });
}
