import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/conversations/conversation-reader.tsx");
const ast = ts.createSourceFile("conversation-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const names = new Set(["navigateToTarget", "handleSearchNavigate", "navigateSearchResult", "publishSearchNavigation", "clearSearchNavigation"]);
const callbacks = reader.body.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => names.has(item.name.getText(ast))));
const guard = reader.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ownsReaderReadRecovery");
const reset = reader.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === "useLayoutEffect" && node.getText(ast).includes("clearSearchNavigation();"));
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["locallyResolvableMessage", "navigationTargetIdentity", "readerCacheIdentity", "setNavigationStage"].includes(node.name?.text));
assert.equal(callbacks.length, names.size);
assert.equal(reset.length, 1);
assert.equal(helpers.length, 4);
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const inputNames = ["conversationId", "dataSource", "conversationQuery", "queryClient", "recentOwner", "recentOwnerRef",
  "searchNavigation", "searchNavigationRef", "setSearchNavigation", "setSearchHighlight", "navigationTokenRef",
  "openSearchAttachment", "openSearchAnnotation",
  "navigationInProgressRef", "lastNavigationTargetRef", "restoreAttemptedRef", "readingRestoreTokenRef", "restoreInProgressRef",
  "windowGenerationRef", "loadedWindowRef", "applyLoadedWindow", "userScrollIntentRef", "scrollDirectionRef",
  "scrollIntentSequenceRef", "setNavigationStatus", "setNavigationFailureReason", "setActiveMessageId", "setActiveBlockId",
  "locatePulseTimerRef", "setLocatePulse", "scrollContainerRef", "resolvedLocatorKeysRef", "previousTurnAnchorRef",
  "nextTurnAnchorRef", "initialWindowAppliedRef"];
const compiled = compile(`function renderNavigation(input) {
  const { ${inputNames.join(", ")} } = input;
  ${guard.getText(ast)}
  ${callbacks.map(node => node.getText(ast)).join("\n")}
  ${reset.map(node => node.getText(ast)).join("\n")}
  return { navigate: navigateToTarget, panel: handleSearchNavigate, next: navigateSearchResult,
    publish: publishSearchNavigation, clear: clearSearchNavigation };
}
${helpers.map(node => node.getText(ast)).join("\n")}
exports.renderNavigation = renderNavigation;`);
const windowExports = {};
new Function("exports", compile(read("features/conversations/reader-window.ts")))(windowExports);
const searchTargetExports = {};
new Function("exports", compile(read("features/search/search-result-target.ts")))(searchTargetExports);
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const message = name => ({ id: `synthetic-message-${name}`, role: "assistant", order_key: name,
  current_version: { id: `synthetic-version-${name}` },
  render_blocks: [{ id: `synthetic-block-${name}`, block_index: 0, block_type: "paragraph", plain_text: "012Synthetic unchanged text" }] });
const A = message("A"), B = message("B");
const target = (item, source = "message-action") => ({ messageId: item.id, source,
  messageVersionId: item.current_version.id, blockIndex: 0, renderBlockId: item.render_blocks[0].id });
const page = items => ({ items, turns: [], total: items.length, offset: 0, limit: items.length,
  has_previous: false, has_more: false, previousTurnAnchorMessageId: null, nextTurnAnchorMessageId: null });
const searchContext = (query = "synthetic") => ({ query, index: 0, targets: [target(A), target(B)] });

// Exact extracted Reader callbacks/guard/reset effect and local locator/window
// helpers. Hook scheduling, transport/neighborhood, leases, geometry, mounted
// alignment, settling, timers and state publication are controlled adapters.
// This is not mounted React, a browser, physical cancellation or DOM evidence.
function fixture({ mode = "remote", items = [B] } = {}) {
  const calls = { writes: [], windows: [], contexts: [], turns: [], leases: [], mounts: [], settles: [], attachments: [], annotations: [],
    stages: [], cache: [], reports: [], released: [], timerClears: [], timers: [] };
  const handlers = {};
  let epoch = 1, cursor = 0, layout, current, now = 0;
  const memos = [];
  const state = { conversationId: "synthetic-navigation-conversation", conversationQuery: { data: { offline_revision: 1, render_version: 1 } },
    searchNavigation: null, searchHighlight: null };
  const root = { scrollTop: 120, dataset: new Proxy({}, { set: (object, name, value) => {
    if (name === "navigationStage") calls.stages.push(value);
    object[name] = value; return true;
  } }) };
  for (const [name, value] of Object.entries({
    navigationTokenRef: 0, navigationInProgressRef: false, lastNavigationTargetRef: null,
    restoreAttemptedRef: false, readingRestoreTokenRef: 0, restoreInProgressRef: false,
    windowGenerationRef: 0, userScrollIntentRef: false, scrollDirectionRef: null,
    scrollIntentSequenceRef: 0, locatePulseTimerRef: null, previousTurnAnchorRef: null, nextTurnAnchorRef: null,
    initialWindowAppliedRef: false, searchNavigationRef: null,
  })) state[name] = { current: value };
  state.scrollContainerRef = { current: root };
  state.loadedWindowRef = { current: windowExports.replaceLoadedWindow(page(items), 0) };
  state.resolvedLocatorKeysRef = { current: new Set() };
  state.dataSource = { mode,
    getTargetContext: async (_id, value) => {
      calls.contexts.push(value);
      return handlers.context ? handlers.context(value) : { targetMessage: value.messageId === A.id ? A : B,
        readerTurn: {}, resolvedLocator: { status: "EXACT" }, dialogueIndex: { items: [] }, toc: { items: [] } };
    },
    getReaderTurn: async (_id, id) => {
      calls.turns.push(id);
      return handlers.turn ? handlers.turn(id) : { items: [] };
    },
  };
  state.recentOwner = { active: true, epoch, conversationId: state.conversationId, dataSource: state.dataSource };
  state.recentOwnerRef = { current: state.recentOwner };
  state.openSearchAttachment = attachmentId => calls.attachments.push(attachmentId);
  state.openSearchAnnotation = async target => {
    calls.annotations.push(target);
    return { ok: true, targetId: `annotation-${target.annotationId}` };
  };
  state.queryClient = { setQueryData: (...args) => calls.cache.push(args) };
  const setter = name => value => { state[name] = value; calls.writes.push([name, value]); };
  for (const name of ["SearchNavigation", "SearchHighlight", "NavigationStatus", "NavigationFailureReason",
    "ActiveMessageId", "ActiveBlockId", "LocatePulse"]) state[`set${name}`] = setter(name[0].toLowerCase() + name.slice(1));
  state.applyLoadedWindow = value => { state.loadedWindowRef.current = value; calls.writes.push(["window", value]); };
  const exports = {};
  const dependencies = {
    exports, useCallback: (callback, deps) => {
      const index = cursor++, previous = memos[index];
      if (!previous || !same(previous.deps, deps)) memos[index] = { deps, callback };
      return memos[index].callback;
    },
    useLayoutEffect: (effect, deps) => {
      if (layout && same(layout.deps, deps)) return;
      layout?.cleanup?.(); layout = { deps, effect, cleanup: effect() };
    },
    window: { performance: { now: () => ++now }, innerWidth: 1200,
      clearTimeout: id => calls.timerClears.push(id), setTimeout: callback => { calls.timers.push(callback); return calls.timers.length; } },
    document: { getElementById: () => null, querySelector: () => null },
    CSS: { escape: value => value }, ACTIVE_READING_OFFSET: 120,
    authenticationGeneration: () => epoch,
    loadCompleteTurnWindow: async (_source, _conversation, id) => {
      calls.windows.push(id);
      return handlers.window ? handlers.window(id) : page([id === A.id ? A : B]);
    },
    replaceLoadedWindow: windowExports.replaceLoadedWindow,
    acquireReaderBlockLease: async (id, _index, isCurrent) => {
      calls.leases.push({ id, isCurrent });
      return handlers.lease ? handlers.lease(id) : { release: () => calls.released.push(id) };
    },
    navigateMountedTarget: async options => {
      calls.mounts.push(options);
      return handlers.mount ? handlers.mount(options) : { ok: true, targetId: options.targetId };
    },
    restoreScrollAnchor: async options => { calls.settles.push(options); return handlers.settle?.(options); },
    captureScrollAnchor: () => null, resolveTextAnchorRange: () => null, firstVisibleRangeRect: () => null,
    resolveCanonicalSearchAnchor: searchTargetExports.resolveCanonicalSearchAnchor,
    reportReaderPerformance: (...args) => calls.reports.push(args),
  };
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const render = () => { cursor = 0; current = exports.renderNavigation(state); };
  render();
  return { state, calls, handlers, root, render, get current() { return current; },
    retire(kind) {
      if (kind === "account") epoch++;
      else if (kind === "visit") state.recentOwnerRef.current = { ...state.recentOwner };
      else { state.recentOwner.active = false; layout?.cleanup?.(); }
    },
    switchVisit(conversationId = state.conversationId) {
      state.recentOwner.active = false;
      state.conversationId = conversationId;
      state.dataSource = { ...state.dataSource };
      state.recentOwner = { ...state.recentOwner, active: true, conversationId, dataSource: state.dataSource };
      state.recentOwnerRef.current = state.recentOwner; render();
    },
    replayReset() {
      layout?.cleanup?.();
      layout.cleanup = layout.effect();
    },
    dispose() { state.recentOwner.active = false; layout?.cleanup?.(); },
  };
}
const observable = f => ({ writes: f.calls.writes.length, stages: f.calls.stages.length,
  cache: f.calls.cache.length, mounts: f.calls.mounts.length, settles: f.calls.settles.length });

for (const mode of ["remote", "offline"]) {
  test(`${mode}: current exact navigation retains locators, timing budgets and lease cleanup`, async () => {
    const f = fixture({ mode });
    try {
      const result = await f.current.navigate({ ...target(A, "search"), characterOffset: 3, endCharacterOffset: 12, quote: "Synthetic" });
      assert.equal(result.ok, true);
      assert.deepEqual(f.calls.windows, [A.id]);
      assert.equal(f.calls.contexts[0].quote, undefined, "an exact search range must not be rematched as an ambiguous quote");
      assert.equal(f.calls.mounts[0].characterOffset, 3);
      assert.equal(f.calls.mounts[0].endCharacterOffset, 12);
      assert.equal(f.calls.mounts[0].quote, "Synthetic");
      assert.equal(f.calls.mounts[0].timeoutMs, 8000);
      assert.equal(f.calls.settles[0].minimumMs, 1400);
      assert.equal(f.calls.settles[0].timeoutMs, 5000);
      assert.equal(f.state.navigationStatus, "idle");
      assert.deepEqual(f.calls.released, [A.id]);
      assert.equal(f.state.navigationInProgressRef.current, false);
    } finally { f.dispose(); }
  });
}

for (const kind of ["stale-version", "out-of-range", "wrong-block"]) {
  test(`search ${kind} falls back to the message without applying an old range or quote`, async () => {
    const f = fixture();
    try {
      const exact = { ...target(A, "search"), characterOffset: 3, endCharacterOffset: 12, quote: "Synthetic" };
      const invalid = kind === "stale-version" ? { ...exact, messageVersionId: "synthetic-old-version" }
        : kind === "out-of-range" ? { ...exact, endCharacterOffset: 1000 }
        : { ...exact, renderBlockId: "synthetic-missing-block" };
      const result = await f.current.navigate(invalid);
      assert.equal(result.ok, true);
      assert.equal(result.fallback, true);
      assert.equal(result.targetId, `message-${A.id}`);
      assert.equal(f.calls.mounts[0].characterOffset, undefined);
      assert.equal(f.calls.mounts[0].endCharacterOffset, undefined);
      assert.equal(f.calls.mounts[0].quote, null);
      assert.equal(f.state.navigationStatus, "stale");
    } finally { f.dispose(); }
  });
}

for (const rejects of [false, true]) {
  test(`an older target-context ${rejects ? "rejection" : "response"} cannot start another neighborhood or replace newer success`, async () => {
    const hold = deferred(), f = fixture();
    f.handlers.context = () => hold.promise;
    try {
      const older = f.current.navigate(target(A, "annotation"));
      assert.equal((await f.current.navigate(target(B))).ok, true);
      const snapshot = observable(f);
      if (rejects) hold.reject(Error("Synthetic private failure"));
      else hold.resolve({ readerTurn: {}, resolvedLocator: { status: "EXACT" } });
      assert.equal((await older).reason, "cancelled");
      assert.deepEqual(observable(f), snapshot);
      assert.deepEqual(f.calls.windows, []);
      assert.equal(f.state.resolvedLocatorKeysRef.current.size, 0);
      assert.equal(f.calls.reports.at(-1)[2], "cancelled");
    } finally { f.dispose(); }
  });
}

for (const rejects of [false, true]) {
  test(`an older neighborhood ${rejects ? "rejection" : "response"} cannot remember a validated locator or publish`, async () => {
    const hold = deferred(), f = fixture();
    f.handlers.window = id => id === A.id ? hold.promise : page([B]);
    try {
      const older = f.current.navigate(target(A, "annotation")); await setImmediate();
      assert.deepEqual(f.calls.windows, [A.id]);
      await f.current.navigate(target(B));
      const snapshot = observable(f);
      if (rejects) hold.reject(Error("Synthetic private failure")); else hold.resolve(page([A]));
      assert.equal((await older).reason, "cancelled");
      assert.deepEqual(observable(f), snapshot);
      assert.equal(f.state.resolvedLocatorKeysRef.current.size, 0);
    } finally { f.dispose(); }
  });
}

for (const kind of ["missing", "found", "reject"]) {
  test(`an older fallback turn ${kind} cannot overwrite a newer navigation status`, async () => {
    const hold = deferred(), f = fixture();
    f.handlers.window = id => id === A.id ? page([]) : page([B]);
    f.handlers.turn = () => hold.promise;
    try {
      const older = f.current.navigate(target(A)); await setImmediate();
      assert.deepEqual(f.calls.turns, [A.id]);
      await f.current.navigate(target(B));
      const snapshot = observable(f);
      if (kind === "reject") hold.reject(Error("Synthetic private failure"));
      else hold.resolve({ items: kind === "missing" ? [] : [A] });
      assert.equal((await older).reason, "cancelled");
      assert.deepEqual(observable(f), snapshot);
      assert.equal(f.state.navigationFailureReason, null);
    } finally { f.dispose(); }
  });
}

for (const stage of ["lease", "mount", "settle"]) {
  for (const rejects of [false, true]) {
    test(`retired ${stage} ${rejects ? "rejection" : "completion"} cannot publish over newer success and releases its lease`, async () => {
      const hold = deferred(), f = fixture();
      const lease = { release: () => f.calls.released.push(A.id) };
      f.handlers[stage] = value => {
        const isA = stage === "lease" ? value === A.id : value.targetId?.includes(A.id) || value.anchor?.targetId?.includes(A.id);
        if (isA) return hold.promise;
        return stage === "lease" ? { release: () => f.calls.released.push(B.id) }
          : stage === "mount" ? { ok: true, targetId: value.targetId } : true;
      };
      try {
        const older = f.current.navigate(target(A, "search")); await setImmediate();
        await f.current.navigate(target(B));
        const snapshot = observable(f);
        if (rejects) hold.reject(Error("Synthetic private failure"));
        else hold.resolve(stage === "lease" ? lease : stage === "mount" ? { ok: true, targetId: `block-${A.id}-0` } : true);
        assert.equal((await older).reason, "cancelled");
        assert.deepEqual(observable(f), snapshot);
        assert.equal(f.calls.released.filter(id => id === A.id).length, stage === "lease" && rejects ? 0 : 1);
      } finally { f.dispose(); }
    });
  }
}

for (const kind of ["account", "visit", "unmount"]) {
  test(`${kind} retirement fences old navigation admission, continuations and mounted predicates`, async () => {
    const hold = deferred(), f = fixture();
    f.handlers.mount = () => hold.promise;
    try {
      const oldNavigate = f.current.navigate;
      const older = oldNavigate(target(B)); await setImmediate();
      const mounted = f.calls.mounts[0];
      f.retire(kind);
      assert.equal(mounted.tokenIsCurrent(), false);
      const snapshot = observable(f), reports = f.calls.reports.length;
      assert.equal((await oldNavigate(target(A))).reason, "cancelled");
      assert.deepEqual(observable(f), snapshot);
      assert.equal(f.calls.reports.length, reports, "retired admission does not start timing");
      hold.reject(Error("Synthetic private failure"));
      assert.equal((await older).reason, "cancelled");
      assert.deepEqual(observable(f), snapshot);
      assert.equal(f.calls.released.filter(id => id === B.id).length, 1);
      assert.equal(f.state.navigationInProgressRef.current, false);
    } finally { f.dispose(); }
  });
}

test("older finally cannot clear a newer in-progress navigation", async () => {
  const first = deferred(), second = deferred(), f = fixture();
  f.handlers.context = () => first.promise;
  f.handlers.mount = options => options.targetId.includes(B.id) ? second.promise : { ok: true, targetId: options.targetId };
  try {
    const older = f.current.navigate(target(A, "search"));
    const newer = f.current.navigate(target(B)); await setImmediate();
    first.reject(Error("Synthetic old failure")); assert.equal((await older).reason, "cancelled");
    assert.equal(f.state.navigationInProgressRef.current, true);
    second.resolve({ ok: true, targetId: `block-${B.id}-0` }); await newer;
    assert.equal(f.state.navigationInProgressRef.current, false);
  } finally { f.dispose(); }
});

test("reset cleanup permanently retires a started token even when the same active visit is replayed", async () => {
  const hold = deferred(), f = fixture();
  f.handlers.lease = id => id === A.id ? hold.promise : { release: () => f.calls.released.push(id) };
  try {
    const older = f.current.navigate(target(A, "search")); await setImmediate();
    const token = f.state.navigationTokenRef.current;
    f.replayReset();
    assert.equal(f.state.recentOwner.active, true, "same active owner, as after setup replay");
    assert.ok(f.state.navigationTokenRef.current > token);
    const snapshot = observable(f);
    hold.resolve({ release: () => f.calls.released.push(A.id) });
    assert.equal((await older).reason, "cancelled");
    assert.deepEqual(observable(f), snapshot);
    assert.equal(f.calls.released.filter(id => id === A.id).length, 1);
    assert.equal((await f.current.navigate(target(B))).ok, true);
  } finally { f.dispose(); }
});

for (const stage of ["context", "window", "turn", "lease", "mount", "settle"]) {
  test(`a current ${stage} rejection still exposes the existing finite recovery reason`, async () => {
    const f = fixture();
    f.handlers[stage] = async () => { throw Error("Synthetic private failure"); };
    if (stage === "turn") f.handlers.window = () => page([]);
    try {
      const result = await f.current.navigate(target(A, stage === "turn" ? "message-action" : "search"));
      assert.equal(result.ok, false);
      assert.equal(result.reason, stage === "context" || stage === "window" ? "target-context-failed" : "load-failed");
      assert.equal(f.state.navigationStatus, "failed");
      assert.equal(f.state.navigationFailureReason, result.reason);
      assert.equal(f.state.navigationInProgressRef.current, false);
      assert.ok(!JSON.stringify(f.calls.writes).includes("Synthetic private failure"));
    } finally { f.dispose(); }
  });
}

test("a current missing fallback target still reports target-not-mounted without committing a guessed window", async () => {
  const f = fixture();
  f.handlers.window = () => page([]);
  try {
    const result = await f.current.navigate(target(A));
    assert.equal(result.reason, "target-not-mounted");
    assert.equal(f.state.navigationFailureReason, "target-not-mounted");
    assert.deepEqual(f.state.loadedWindowRef.current.items, [B]);
    assert.deepEqual(f.calls.mounts, []);
  } finally { f.dispose(); }
});

for (const [status, reason] of [["NOT_FOUND", "attachment-not-found"], ["STALE", "stale-anchor"], ["AMBIGUOUS", "ambiguous"]]) {
  test(`current server locator ${status} preserves its existing recovery classification`, async () => {
    const f = fixture();
    f.handlers.context = () => ({ targetMessage: A, readerTurn: {}, resolvedLocator: { status },
      dialogueIndex: { items: [] }, toc: { items: [] } });
    try {
      const result = await f.current.navigate({ ...target(A, "attachment"),
        occurrenceKey: "synthetic-occurrence", attachmentId: "synthetic-attachment" });
      assert.equal(result.reason, reason);
      assert.equal(f.state.navigationFailureReason, reason);
      assert.equal(f.state.navigationStatus, status === "STALE" ? "stale" : "failed");
      assert.deepEqual(f.calls.mounts, []);
    } finally { f.dispose(); }
  });
}

test("a current exact local search target still avoids transport and retains its short settle guard", async () => {
  const f = fixture();
  try {
    assert.equal((await f.current.navigate(target(B, "search"))).ok, true);
    assert.deepEqual(f.calls.contexts, []);
    assert.deepEqual(f.calls.windows, []);
    assert.equal(f.calls.settles[0].minimumMs, 220);
    assert.equal(f.calls.settles[0].settleMs, 100);
  } finally { f.dispose(); }
});

for (const replacement of ["dismiss", "replace", "visit"]) {
  test(`footer ${replacement} cannot be undone by a later successful next-match navigation`, async () => {
    const hold = deferred(), f = fixture({ items: [A, B] });
    try {
      const context = searchContext();
      f.current.publish(context); f.render();
      f.handlers.mount = () => hold.promise;
      const oldNext = f.current.next, pending = oldNext(1); await setImmediate();
      if (replacement === "dismiss") f.current.clear();
      else if (replacement === "replace") f.current.publish(searchContext("synthetic-new-query"));
      else f.switchVisit();
      const stateContext = f.state.searchNavigation;
      const highlightWrites = f.calls.writes.filter(([name]) => name === "searchHighlight").length;
      hold.resolve({ ok: true, targetId: `block-${B.id}-0` }); await pending;
      assert.equal(f.state.searchNavigation, stateContext);
      assert.equal(f.calls.writes.filter(([name]) => name === "searchHighlight").length, highlightWrites);
      const count = f.calls.mounts.length;
      await oldNext(1);
      assert.equal(f.calls.mounts.length, count, "retired footer handler cannot readmit navigation");
    } finally { f.dispose(); }
  });
}

test("current footer navigation publishes its context/index and the exact highlight", async () => {
  const f = fixture({ items: [A, B] });
  try {
    const context = searchContext(); f.current.publish(context); f.render();
    await f.current.next(1);
    assert.deepEqual(f.state.searchNavigation, { ...context, index: 1 });
    assert.equal(f.state.searchNavigationRef.current, f.state.searchNavigation);
    assert.equal(f.state.searchHighlight.targetId, `block-${B.id}-0`);
  } finally { f.dispose(); }
});

test("footer attachment and annotation results use their dedicated destinations", async () => {
  const f = fixture({ items: [A, B] });
  try {
    const attachmentContext = { query: "file", index: 0, targets: [{ attachmentId: "synthetic-attachment" }] };
    f.current.publish(attachmentContext); f.render();
    await f.current.next(0);
    assert.deepEqual(f.calls.attachments, ["synthetic-attachment"]);
    assert.deepEqual(f.calls.windows, []);
    assert.deepEqual(f.calls.mounts, []);

    const annotationTarget = {
      annotationId: "synthetic-annotation",
      messageId: A.id,
      messageVersionId: A.current_version.id,
      blockIndex: 2,
      characterOffset: 5,
    };
    const annotationContext = { query: "note", index: 0, targets: [annotationTarget] };
    f.current.publish(annotationContext); f.render();
    await f.current.next(0);
    assert.deepEqual(f.calls.annotations, [annotationTarget]);
    assert.deepEqual(f.calls.windows, []);
    assert.deepEqual(f.calls.mounts, []);
  } finally { f.dispose(); }
});

for (const scope of ["source", "conversation"]) {
  test(`${scope} reset retires search controls, recovery target, status and pulse without discarding panel return state`, () => {
    const f = fixture();
    try {
      f.current.publish(searchContext());
      f.state.searchHighlight = { targetId: "synthetic-old-target" };
      f.state.navigationStatus = "failed"; f.state.navigationFailureReason = "load-failed";
      f.state.lastNavigationTargetRef.current = target(A);
      f.state.resolvedLocatorKeysRef.current.add("synthetic-validated-locator");
      f.state.navigationInProgressRef.current = true;
      f.state.locatePulseTimerRef.current = 42;
      const token = f.state.navigationTokenRef.current;
      f.switchVisit(scope === "conversation" ? "synthetic-new-conversation" : undefined);
      assert.equal(f.state.searchNavigation, null);
      assert.equal(f.state.searchNavigationRef.current, null);
      assert.equal(f.state.searchHighlight, null);
      assert.equal(f.state.navigationStatus, "idle");
      assert.equal(f.state.navigationFailureReason, null);
      assert.equal(f.state.lastNavigationTargetRef.current, null);
      assert.equal(f.state.resolvedLocatorKeysRef.current.size, 0);
      assert.ok(f.state.navigationTokenRef.current > token);
      assert.equal(f.state.navigationInProgressRef.current, false);
      assert.deepEqual(f.calls.timerClears, [42]);
      assert.ok(!reset[0].getText(ast).includes("setSearchPanelState"));
    } finally { f.dispose(); }
  });
}

test("both footer dismiss actions use the synchronous clear and context state has one publisher", () => {
  const dismissals = [], stateWrites = [];
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onClick"
      && node.initializer?.getText(ast).includes("clearSearchNavigation();")) dismissals.push(node.initializer.getText(ast));
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "setSearchNavigation") stateWrites.push(node);
    ts.forEachChild(node, visit);
  };
  visit(reader);
  assert.equal(dismissals.length, 2);
  assert.ok(dismissals.some(text => text.includes('openUtilityPanel("search")')));
  assert.ok(dismissals.some(text => text.includes("setLocatePulse(null)")));
  assert.equal(stateWrites.length, 1);
});
