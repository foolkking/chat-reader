import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const path = "components/offline-sync-center.tsx";
const source = readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const calls = [];
const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("liveQuery(")) calls.push(node);
  ts.forEachChild(node, visit);
};
visit(ast);
assert.equal(calls.length, 1, "Extract the one actual local-ledger effect");
const effect = calls[0];
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["downloadNeedsAttention", "matchesTarget"].includes(node.name?.text));
assert.equal(helpers.length, 2);
const compiled = ts.transpileModule(
  helpers.map(node => node.getText(ast)).join("\n") + `\nexports.effect = (${effect.arguments[0].getText(ast)});`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;
const declarations = new Map();
const collectDeclarations = node => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
  ts.forEachChild(node, collectDeclarations);
};
collectDeclarations(ast);
const scopeFor = new Function("tab", "page", "mode", `return (${declarations.get("readScope").initializer.getText(ast)});`);
const sections = ["copies", "downloads", "pending", "drafts", "conflicts", "failures"];
const viewNames = ["localScopeMatches", "readSectionReady", "localReadError", "localLoading"];
const compiledView = ts.transpileModule(`exports.view = (localRead, readScope, loading) => {
  ${viewNames.map(name => `const ${name} = (${declarations.get(name).initializer.getText(ast)});`).join("\n")}
  return { ready: readSectionReady, localReadError, localLoading };
};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const viewExports = {};
new Function("exports", compiledView)(viewExports);
const sectionViewFor = viewExports.view;
// Retain the older tests' aggregate summary, computed from the actual per-
// section predicate. It is not a component render or a new product contract.
const viewFor = (...args) => {
  const view = sectionViewFor(...args);
  return { localReady: sections.every(view.ready), localReadError: view.localReadError, localLoading: view.localLoading };
};
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const drainMicrotasks = () => new Promise(resolve => setImmediate(resolve));
const copy = id => ({ id, display_title: "Synthetic copy" });
const assets = { total: 1, available: 1, required: 1, missing: 0, metadataKnown: true };
const data = (patch = {}) => {
  const value = {
    count: 1, rows: [copy("synthetic-copy")], tasks: [], operations: [], operationCount: 0,
    markers: [], failedRows: [], failedCount: 0, draftRows: [], draftsTotal: 0,
    contextRows: [], contextTotal: 0, retained: {}, ...patch,
  };
  const success = (section, value) => ({ section, ok: true, value });
  return {
    copyRead: success("copies", { count: value.count, rows: value.rows }),
    downloadRead: success("downloads", { tasks: value.tasks, retained: value.retained }),
    pendingRead: success("pending", { operations: value.operations, operationCount: value.operationCount }),
    conflictRead: success("conflicts", value.markers),
    failureRead: success("failures", { failedRows: value.failedRows, failedCount: value.failedCount }),
    draftRead: success("drafts", { draftRows: value.draftRows, draftsTotal: value.draftsTotal, contextRows: value.contextRows, contextTotal: value.contextTotal }),
  };
};
const failedRead = section => ({ section, ok: false, error: Error("Synthetic section failure") });

// Compile the real effect and its real task-matching helpers. Live-query
// emissions, state setters and inspection promises are controlled adapters.
// The inner combined Dexie read is captured, not run; no React/Cache Storage,
// Blob cost, global manager lifecycle or browser focus is verified here.
function fixture(patch = {}, inspect = async () => assets, initialState = {}) {
  const state = { ...initialState }, inspections = [], subscriptions = [], documentOwner = {};
  const setter = name => value => { state[name] = typeof value === "function" ? value(state[name]) : value; };
  const bindings = {
    selectedConflict: null, cleanup: null, page: 0, tab: "copies", mode: "all",
    refresh: 0, zh: false, entryResolved: true, initialJobId: undefined, initialTarget: undefined,
    entryNavigation: { current: false }, entryFocus: { current: null },
    document: { activeElement: documentOwner },
    liveQuery: read => ({ subscribe: observer => {
      const subscription = { read, observer, stopped: false };
      subscriptions.push(subscription);
      return { unsubscribe: () => { subscription.stopped = true; } };
    } }),
    inspectOfflineCopyAssets: async (...args) => { inspections.push(args); return inspect(...args); },
    ...Object.fromEntries([
      "Loading", "Error", "EntryResolved", "EntryDownloadId", "Tab", "Page", "Total", "Downloads",
      "Pending", "PendingCount", "RetainedCopies", "Drafts", "DraftCount", "ContextDrafts",
      "ContextDraftCount", "SyncFailures", "SyncFailureCount", "Conflicts", "Copies", "LocalRead",
    ].map(name => ["set" + name, setter(name)])),
    ...patch,
  };
  bindings.readScope = scopeFor(bindings.tab, bindings.page, bindings.mode);
  const exports = {};
  new Function(...Object.keys(bindings), "exports", compiled)(...Object.values(bindings), exports);
  const dispose = exports.effect();
  return {
    state, inspections, subscriptions, bindings,
    emit: value => {
      assert.equal(subscriptions.length, 1);
      subscriptions[0].observer.next(value);
    },
    stop: () => { if (dispose) dispose(); },
  };
}

test("Pending and Failures publish their normal ledgers without any hidden asset inspection", async () => {
  for (const tab of ["pending", "failures"]) {
    const f = fixture({ tab }, async () => { throw Error("Hidden assets must not be read"); });
    try {
      f.emit(data({ operationCount: 4, failedCount: 2, draftsTotal: 3, contextTotal: 1,
        operations: [{ operation_id: "synthetic-operation" }] }));
      await drainMicrotasks();
      assert.deepEqual(f.inspections, []);
      assert.equal(f.state.Loading, false);
      assert.equal(f.state.PendingCount, 4);
      assert.equal(f.state.SyncFailureCount, 2);
      assert.equal(f.state.DraftCount, 3);
      assert.equal(f.state.ContextDraftCount, 1);
      assert.equal(f.state.Pending[0].operation_id, "synthetic-operation");
      assert.equal(f.state.Error, undefined);
      assert.deepEqual(f.state.LocalRead, { scope: scopeFor(tab, 0, "all"), failed: [], error: null });
    } finally { f.stop(); }
  }
});

test("conflict and protected-cleanup subviews create no parent local subscription", () => {
  for (const patch of [{ selectedConflict: "synthetic-conflict" },
    { cleanup: { conversationId: "synthetic-copy", attachmentsOnly: true, snapshot: {} } }]) {
    const f = fixture(patch);
    assert.deepEqual(f.subscriptions, []);
    assert.deepEqual(f.inspections, []);
    assert.deepEqual(f.state, {});
    f.stop();
  }
});

test("returning to visible Copies creates its normal subscription and checks the selected asset mode", async () => {
  const hidden = fixture({ selectedConflict: "synthetic-conflict" });
  assert.equal(hidden.subscriptions.length, 0);
  hidden.stop();
  const visible = fixture({ mode: "small" });
  try {
    visible.emit(data({ rows: [copy("synthetic-first"), copy("synthetic-second")] }));
    await drainMicrotasks();
    assert.deepEqual(visible.inspections, [["synthetic-first", "small"], ["synthetic-second", "small"]]);
    assert.deepEqual(visible.state.Copies.map(item => item.assets), [assets, assets]);
    assert.equal(visible.state.Loading, false);
  } finally { visible.stop(); }
});

test("visible copy inspection keeps its error state; empty copies settle without inspecting anything", async () => {
  const broken = fixture({}, async () => { throw Error("Synthetic cache failure"); });
  try {
    broken.emit(data());
    await drainMicrotasks();
    assert.equal(broken.state.Loading, false);
    assert.deepEqual(broken.state.LocalRead, { scope: scopeFor("copies", 0, "all"), failed: ["copies"], error: "assets" });
    assert.equal(broken.state.Error, undefined, "Read errors do not overwrite action feedback");
  } finally { broken.stop(); }
  const empty = fixture();
  try {
    empty.emit(data({ count: 0, rows: [] }));
    await drainMicrotasks();
    assert.deepEqual(empty.inspections, []);
    assert.deepEqual(empty.state.Copies, []);
    assert.equal(empty.state.Loading, false);
  } finally { empty.stop(); }
});

test("cleanup unsubscribes and rejects late inspection and ledger publication", async () => {
  const hold = deferred(), f = fixture({}, () => hold.promise);
  f.emit(data());
  f.stop();
  assert.equal(f.subscriptions[0].stopped, true);
  hold.resolve(assets);
  await drainMicrotasks();
  assert.equal(f.state.Copies, undefined);
  assert.equal(f.state.Loading, true);
  f.emit(data({ count: 99 }));
  assert.equal(f.state.Total, 1);
  assert.equal(f.inspections.length, 1);
});

test("a superseded inspection settles before the latest queued page starts, without publishing old rows", async () => {
  const hold = deferred(), f = fixture({}, id => id === "synthetic-old" ? hold.promise : Promise.resolve(assets));
  try {
    f.emit(data({ rows: [copy("synthetic-old")] }));
    f.emit(data({ rows: [copy("synthetic-new")] }));
    await drainMicrotasks();
    assert.deepEqual(f.inspections, [["synthetic-old", "all"]]);
    assert.equal(f.state.Copies, undefined);
    hold.resolve(assets);
    await drainMicrotasks();
    assert.deepEqual(f.inspections, [["synthetic-old", "all"], ["synthetic-new", "all"]]);
    assert.equal(f.state.Copies[0].conversation.id, "synthetic-new");
  } finally { f.stop(); }
});

test("initial task-target navigation still resolves before inspection without resuming a download", () => {
  const task = { id: "synthetic-download", jobId: "synthetic-job", state: "failed" };
  const f = fixture({ entryResolved: false, initialJobId: task.jobId, entryNavigation: { current: true } });
  try {
    f.emit(data({ tasks: [task] }));
    assert.equal(f.state.EntryResolved, true);
    assert.equal(f.state.EntryDownloadId, task.id);
    assert.equal(f.state.Tab, "failures");
    assert.equal(f.state.Page, 0);
    assert.deepEqual(f.inspections, []);
    assert.equal(f.bindings.entryFocus.current.id, task.id);
  } finally { f.stop(); }
});

test("replacement subviews are effect dependencies, alongside all existing ledger scope controls", () => {
  assert.ok(ts.isArrayLiteralExpression(effect.arguments[1]));
  const dependencies = effect.arguments[1].elements.map(node => node.getText(ast));
  for (const name of ["page", "tab", "mode", "refresh", "zh", "entryResolved", "initialJobId",
    "initialTarget", "selectedConflict", "cleanup", "readScope"]) assert.ok(dependencies.includes(name), `Missing dependency ${name}`);
});

test("an unread or mismatched tab/page/mode cannot report ready data or an empty result", () => {
  const current = scopeFor("pending", 0, "all");
  assert.deepEqual(viewFor(null, current, false), {
    localReady: false, localReadError: null, localLoading: true,
  });
  for (const oldScope of [scopeFor("copies", 0, "all"), scopeFor("pending", 1, "all"),
    scopeFor("pending", 0, "small")]) {
    for (const status of [{ failed: [], error: null }, { failed: ["pending"], error: null }, { failed: ["copies"], error: "assets" }]) {
      assert.deepEqual(viewFor({ scope: oldScope, ...status }, current, false), {
        localReady: false, localReadError: null, localLoading: true,
      });
    }
  }
});

test("matching successful data can remain visible during refresh, with loading explicitly true", () => {
  const scope = scopeFor("copies", 0, "all");
  assert.deepEqual(viewFor({ scope, failed: [], error: null }, scope, true), {
    localReady: true, localReadError: null, localLoading: true,
  });
  assert.deepEqual(viewFor({ scope, failed: [], error: null }, scope, false), {
    localReady: true, localReadError: null, localLoading: false,
  });
});

test("a new scope retires the preceding marker before shared fields can be republished", () => {
  const ready = { scope: scopeFor("pending", 0, "all"), failed: [], error: null };
  const same = fixture({ tab: "pending" }, undefined, { LocalRead: ready });
  const changed = fixture({ tab: "copies" }, undefined, { LocalRead: ready });
  try {
    assert.equal(same.state.LocalRead, ready, "Same-scope refresh keeps its matching success");
    assert.equal(same.state.Loading, true);
    assert.equal(changed.state.LocalRead, null, "A-B-A navigation cannot revive A's retired marker");
    changed.emit(data({ count: 2 }));
    assert.equal(changed.state.Total, 2);
    assert.equal(changed.state.LocalRead, null, "The next scope is not ready before asset inspection");
  } finally { same.stop(); changed.stop(); }
});

test("initial storage failure settles as failure, not ready/empty, on each tab", () => {
  for (const tab of ["copies", "pending", "failures"]) {
    const f = fixture({ tab });
    try {
      assert.equal(f.state.Loading, true);
      assert.equal(f.state.LocalRead, null);
      f.subscriptions[0].observer.error(Error("Synthetic storage failure"));
      assert.deepEqual(viewFor(f.state.LocalRead, f.bindings.readScope, f.state.Loading), {
        localReady: false, localReadError: "storage", localLoading: false,
      });
      assert.equal(f.state.Error, undefined);
      assert.equal(f.state.Total, undefined);
    } finally { f.stop(); }
  }
});

test("a ledger failure fences an older in-flight inspection from restoring ready content", async () => {
  const hold = deferred(), f = fixture({}, () => hold.promise);
  try {
    f.emit(data());
    f.subscriptions[0].observer.error(Error("Synthetic ledger failure"));
    hold.resolve(assets);
    await drainMicrotasks();
    assert.equal(f.state.Copies, undefined);
    assert.equal(viewFor(f.state.LocalRead, f.bindings.readScope, false).localReadError, "storage");
    assert.equal(f.state.Loading, false);
  } finally { f.stop(); }
});

test("a failed refresh retains data in memory but hides its ledger until a successful read", async () => {
  const f = fixture();
  try {
    f.emit(data());
    await drainMicrotasks();
    const previousCopies = f.state.Copies;
    f.subscriptions[0].observer.error(Error("Synthetic storage refresh failure"));
    assert.equal(f.state.Copies, previousCopies);
    assert.equal(f.state.Total, 1);
    assert.deepEqual(viewFor(f.state.LocalRead, f.bindings.readScope, f.state.Loading), {
      localReady: false, localReadError: "storage", localLoading: false,
    });
  } finally { f.stop(); }
});

test("a later successful inspection clears only read feedback, not an action failure", async () => {
  let attempts = 0;
  const f = fixture({}, async () => {
    if (attempts++ === 0) throw Error("Synthetic first resource failure");
    return assets;
  });
  f.state.Error = "Synthetic independent action failure";
  try {
    f.emit(data());
    await drainMicrotasks();
    assert.equal(f.state.LocalRead.error, "assets");
    assert.equal(f.state.Error, "Synthetic independent action failure");
    f.emit(data());
    await drainMicrotasks();
    assert.equal(f.state.LocalRead.error, null);
    assert.equal(f.state.Error, "Synthetic independent action failure");
    assert.equal(f.state.Copies.length, 1);
  } finally { f.stop(); }
});

test("the actual local Retry only increments the local subscription revision and respects busy/loading", () => {
  const buttons = [];
  const collect = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button"
      && node.getText(ast).includes('"Retry local read"')) buttons.push(node);
    ts.forEachChild(node, collect);
  };
  collect(ast);
  assert.equal(buttons.length, 1);
  const attrs = buttons[0].openingElement.attributes.properties;
  const click = attrs.find(attr => attr.name?.getText(ast) === "onClick").initializer.expression;
  const disabled = attrs.find(attr => attr.name?.getText(ast) === "disabled").initializer.expression;
  for (const [busy, localLoading] of [[false, false], [true, false], [false, true], [true, true]]) {
    let refresh = 0;
    const setRefresh = update => { refresh = update(refresh); };
    const handler = new Function("busy", "localLoading", "setRefresh", `return (${click.getText(ast)});`)(busy, localLoading, setRefresh);
    const isDisabled = new Function("busy", "localLoading", `return (${disabled.getText(ast)});`)(busy, localLoading);
    handler();
    assert.equal(isDisabled, busy || localLoading);
    assert.equal(refresh, busy || localLoading ? 0 : 1);
  }
});

test("all three real empty messages require their complete section owners and nonloading; pagination is scope-gated", () => {
  // Inspect actual JSX ancestor guards; this is not React/browser rendering.
  for (const [text, ready] of [["No offline copies yet.", "copiesReady"], ["No pending edits.", "pendingSectionsReady"],
    ["No failed tasks or recorded conflicts.", "failureSectionsReady"]]) {
    const paragraphs = [];
    const collect = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "p"
        && node.getText(ast).includes(text)) paragraphs.push(node);
      ts.forEachChild(node, collect);
    };
    collect(ast);
    assert.equal(paragraphs.length, 1);
    const guards = [];
    for (let parent = paragraphs[0].parent; parent; parent = parent.parent) {
      if (ts.isConditionalExpression(parent)) guards.push(parent.condition.getText(ast));
    }
    assert.ok(guards.some(guard => guard.includes(ready)), text);
    assert.ok(guards.some(guard => guard.includes("!localLoading")), text);
  }
  const pagers = [];
  const collect = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "nav"
      && node.getText(ast).includes('"Offline center pages"')) pagers.push(node);
    ts.forEachChild(node, collect);
  };
  collect(ast);
  assert.equal(pagers.length, 1);
  assert.equal(pagers[0].parent.condition.getText(ast), "pageReady && pages > 1");
});

test("a failed download read does not hide verified Copies or resolve an initial task as missing", async () => {
  const f = fixture({ entryResolved: false, initialJobId: "synthetic-job" });
  try {
    const result = data();
    result.downloadRead = failedRead("downloads");
    f.emit(result);
    await drainMicrotasks();
    assert.equal(f.state.Copies[0].conversation.id, "synthetic-copy");
    assert.equal(f.state.EntryResolved, undefined);
    assert.equal(f.state.EntryDownloadId, undefined);
    const view = sectionViewFor(f.state.LocalRead, f.bindings.readScope, f.state.Loading);
    assert.equal(view.ready("copies"), true);
    assert.equal(view.ready("downloads"), false);
    assert.equal(view.localReadError, "storage");
    assert.equal(view.localLoading, false);
  } finally { f.stop(); }
});

test("failed drafts retain old memory without presenting it as current; readable pending edits still publish", () => {
  const oldDrafts = [{ key: "synthetic-old-draft", value: {} }];
  const f = fixture({ tab: "pending" }, undefined, { Drafts: oldDrafts, DraftCount: 1 });
  try {
    const result = data({ operations: [{ operation_id: "synthetic-edit" }], operationCount: 1 });
    result.draftRead = failedRead("drafts");
    f.emit(result);
    assert.equal(f.state.Pending[0].operation_id, "synthetic-edit");
    assert.equal(f.state.Drafts, oldDrafts);
    const view = sectionViewFor(f.state.LocalRead, f.bindings.readScope, false);
    assert.equal(view.ready("pending"), true);
    assert.equal(view.ready("drafts"), false);
    assert.equal(view.ready("conflicts"), true);
    assert.deepEqual(f.inspections, []);
  } finally { f.stop(); }
});

test("conflict failure keeps successful task and failed-edit sections; a later success clears only local read feedback", () => {
  const f = fixture({ tab: "failures" });
  f.state.Error = "Synthetic independent action failure";
  try {
    const result = data({ tasks: [{ id: "synthetic-task", state: "failed" }],
      failedRows: [{ operation_id: "synthetic-edit" }], failedCount: 1 });
    result.conflictRead = failedRead("conflicts");
    f.emit(result);
    assert.equal(f.state.Downloads[0].id, "synthetic-task");
    assert.equal(f.state.SyncFailures[0].operation_id, "synthetic-edit");
    const view = sectionViewFor(f.state.LocalRead, f.bindings.readScope, false);
    assert.equal(view.ready("downloads"), true);
    assert.equal(view.ready("failures"), true);
    assert.equal(view.ready("conflicts"), false);
    f.emit(data());
    assert.deepEqual(f.state.LocalRead.failed, []);
    assert.equal(f.state.Error, "Synthetic independent action failure");
  } finally { f.stop(); }
});

test("partial reads cannot clamp a shared pending/failures page from incomplete counts", () => {
  for (const [tab, failedKey, section] of [["pending", "draftRead", "drafts"], ["failures", "conflictRead", "conflicts"]]) {
    const f = fixture({ tab, page: 2 });
    try {
      const result = data({ count: 0, rows: [] });
      result[failedKey] = failedRead(section);
      f.emit(result);
      assert.equal(f.state.Page, undefined);
      assert.equal(f.state.LocalRead.scope, scopeFor(tab, 2, "all"));
    } finally { f.stop(); }
  }
});

test("Copies can clamp its own page after a successful count even when download status failed", () => {
  const f = fixture({ page: 3 });
  try {
    const result = data({ count: 21, rows: [] });
    result.downloadRead = failedRead("downloads");
    f.emit(result);
    assert.equal(f.state.Page, 1);
  } finally { f.stop(); }
});

test("asset failure keeps its specific feedback even alongside a download-status failure", async () => {
  const f = fixture({}, async () => { throw Error("Synthetic asset failure"); });
  try {
    const result = data();
    result.downloadRead = failedRead("downloads");
    f.emit(result);
    await drainMicrotasks();
    const view = sectionViewFor(f.state.LocalRead, f.bindings.readScope, false);
    assert.equal(view.localReadError, "assets");
    assert.equal(view.ready("copies"), false);
    assert.equal(view.ready("downloads"), false);
  } finally { f.stop(); }
});

test("each real ledger render is guarded by its own read owner", () => {
  for (const [base, owner] of [["copies", "copiesReady"], ["pending", "pendingReady"], ["drafts", "draftsReady"],
    ["contextDrafts", "draftsReady"], ["failures.slice(", "downloadsReady"], ["conflicts.slice(", "conflictsReady"],
    ["syncFailures", "failuresReady"]]) {
    const maps = [];
    const collect = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "map") {
        const target = node.expression.expression.getText(ast);
        if (target === base || base.endsWith("(") && target.startsWith(base)) maps.push(node);
      }
      ts.forEachChild(node, collect);
    };
    collect(ast);
    assert.equal(maps.length, 1, base);
    const guards = [];
    for (let parent = maps[0].parent; parent; parent = parent.parent) {
      if (ts.isConditionalExpression(parent)) guards.push(parent.condition.getText(ast));
    }
    assert.ok(guards.some(guard => guard.includes(owner)), `${base} needs ${owner}`);
  }
  assert.ok(source.includes("Temporarily unavailable:"));
  const unavailable = declarations.get("unavailableSections").initializer.getText(ast);
  assert.ok(unavailable.includes("localScopeMatches"));
  assert.ok(unavailable.includes("localRead?.failed"));
  assert.ok(unavailable.includes("sectionLabels[section]"));
});

test("a failed lookup no longer continues to announce that the device download is being found", () => {
  const matches = [];
  const collect = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "p"
      && node.getText(ast).includes("Finding this device's download")) matches.push(node);
    ts.forEachChild(node, collect);
  };
  collect(ast);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].parent.condition.getText(ast).includes("!localReadError"));
});

test("cleanup cannot use unread download state and combined export waits for its full read scope", () => {
  const findDisabled = text => {
    const buttons = [];
    const collect = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button"
        && node.getText(ast).includes(`"${text}"`)) buttons.push(node);
      ts.forEachChild(node, collect);
    };
    collect(ast);
    assert.equal(buttons.length, 1, text);
    return buttons[0].openingElement.attributes.properties.find(attr => attr.name?.getText(ast) === "disabled").initializer.expression.getText(ast);
  };
  const cleanupDisabled = findDisabled("Delete copy");
  assert.equal(new Function("busy", "downloadsReady", "activeDownload", `return (${cleanupDisabled});`)(false, false, false), true);
  assert.equal(new Function("busy", "downloadsReady", "activeDownload", `return (${cleanupDisabled});`)(false, true, false), false);
  const exportDisabled = findDisabled("Export local edits and drafts");
  const isExportDisabled = new Function("busy", "pendingSectionsReady", "pendingCount", "draftCount", "contextDraftCount", "conflicts", "preferenceCount", `return (${exportDisabled});`);
  assert.equal(isExportDisabled(false, false, 1, 0, 0, [], 0), true);
  assert.equal(isExportDisabled(false, true, 1, 0, 0, [], 0), false);
});

test("a burst retains only the latest pending page, not an unbounded scan queue", async () => {
  const hold = deferred(), f = fixture({}, id => id === "synthetic-running" ? hold.promise : Promise.resolve(assets));
  try {
    f.emit(data({ rows: [copy("synthetic-running")] }));
    for (let index = 0; index < 40; index += 1) f.emit(data({ rows: [copy(`synthetic-pending-${index}`)] }));
    await drainMicrotasks();
    assert.deepEqual(f.inspections, [["synthetic-running", "all"]]);
    hold.resolve(assets);
    await drainMicrotasks();
    assert.deepEqual(f.inspections, [["synthetic-running", "all"], ["synthetic-pending-39", "all"]]);
    assert.equal(f.state.Copies[0].conversation.id, "synthetic-pending-39");
  } finally { f.stop(); }
});

test("unmount retires the latest queued work without pretending to cancel the started verifier", async () => {
  const hold = deferred(), f = fixture({}, () => hold.promise);
  f.emit(data({ rows: [copy("synthetic-running")] }));
  f.emit(data({ rows: [copy("synthetic-queued")] }));
  f.stop();
  hold.resolve(assets);
  await drainMicrotasks();
  assert.deepEqual(f.inspections, [["synthetic-running", "all"]]);
  assert.equal(f.state.Copies, undefined);
  assert.equal(f.subscriptions[0].stopped, true);
});

test("subscription and copy-read failures both retire queued scans and fence the running result", async () => {
  for (const failure of ["subscription", "copy"]) {
    const hold = deferred(), f = fixture({}, () => hold.promise);
    try {
      f.emit(data({ rows: [copy("synthetic-running")] }));
      f.emit(data({ rows: [copy("synthetic-queued")] }));
      if (failure === "subscription") f.subscriptions[0].observer.error(Error("Synthetic ledger failure"));
      else {
        const result = data();
        result.copyRead = failedRead("copies");
        f.emit(result);
      }
      hold.resolve(assets);
      await drainMicrotasks();
      assert.deepEqual(f.inspections, [["synthetic-running", "all"]]);
      assert.equal(f.state.Copies, undefined);
      assert.equal(sectionViewFor(f.state.LocalRead, f.bindings.readScope, false).ready("copies"), false);
      assert.equal(f.state.Loading, false);
    } finally { f.stop(); }
  }
});

test("one rejected row does not release the active page slot before its still-running sibling settles", async () => {
  const hold = deferred();
  const f = fixture({}, id => id === "synthetic-rejected" ? Promise.reject(Error("Synthetic verifier failure"))
    : id === "synthetic-held" ? hold.promise : Promise.resolve(assets));
  try {
    f.emit(data({ rows: [copy("synthetic-rejected"), copy("synthetic-held")] }));
    f.emit(data({ rows: [copy("synthetic-latest")] }));
    await drainMicrotasks();
    assert.deepEqual(f.inspections, [["synthetic-rejected", "all"], ["synthetic-held", "all"]]);
    assert.equal(f.state.Copies, undefined);
    hold.resolve(assets);
    await drainMicrotasks();
    assert.deepEqual(f.inspections, [["synthetic-rejected", "all"], ["synthetic-held", "all"], ["synthetic-latest", "all"]]);
    assert.equal(f.state.Copies[0].conversation.id, "synthetic-latest");
    assert.equal(f.state.LocalRead.error, null);
  } finally { f.stop(); }
});

test("page clamping retires queued scans before returning to the next scope", async () => {
  const hold = deferred(), f = fixture({ page: 3 }, () => hold.promise);
  try {
    f.emit(data({ count: 81, rows: [copy("synthetic-running")] }));
    f.emit(data({ count: 81, rows: [copy("synthetic-queued")] }));
    f.emit(data({ count: 0, rows: [] }));
    assert.equal(f.state.Page, 0);
    hold.resolve(assets);
    await drainMicrotasks();
    assert.deepEqual(f.inspections, [["synthetic-running", "all"]]);
    assert.equal(f.state.Copies, undefined);
  } finally { f.stop(); }
});
