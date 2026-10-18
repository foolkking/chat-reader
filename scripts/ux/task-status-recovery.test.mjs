import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const { QueryClient, QueryObserver } = require("@tanstack/react-query");
const noop = () => {};
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const task = (id = "synthetic-task", status = "processing") => ({ job_id: id, job_type: "import", status, phase: "parsing",
  progress: 42, processed_items: 0, total_items: 1, result: {}, cancellable: true });
const textOf = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(textOf).join("") : textOf(node.props?.children);
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const source = readFileSync(new URL("../../apps/web/features/import/import-task-monitor.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

// Actual monitor, installed query cache/result lifecycle. Hook scheduling,
// transport, timers, DOM and unrelated children are controlled doubles; no
// browser interaction, polling-timing or backend execution claim.
function fixture({ rows = [task()], locale = "en-US", placement = "center" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(["active-tasks"], rows); client.setQueryData(["content-cleanup-pending"], []);
  const hooks = [], effects = new Map(), observers = new Map(), reads = [], writes = [], timers = [], events = [];
  let cursor = 0, tree, generation = 1, disposed = false, writesAfterDispose = 0;
  let list = rows, listError = null, scanError = null, finalRead = async id => task(id, "committed");
  const hook = init => { const i = cursor++; return hooks[i] ??= init(); };
  const memo = (fn, deps) => { const h = hook(() => ({})); if (!same(h.deps, deps)) Object.assign(h, { value: fn(), deps }); return h.value; };
  const react = { ...React, useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef: init => hook(() => ({ current: init })),
    useState: init => { const h = hook(() => ({ value: typeof init === "function" ? init() : init }));
      return [h.value, next => { if (disposed) writesAfterDispose++; h.value = typeof next === "function" ? next(h.value) : next; }]; },
    useLayoutEffect: () => { hook(() => ({})); },
    useEffect: (fn, deps) => { const i = cursor, h = hook(() => ({})); if (!same(h.deps, deps)) { h.deps = deps; effects.set(i, fn); } },
  };
  const queryRead = async kind => {
    if (kind === "active-tasks") { if (listError) throw listError; return list; }
    if (scanError) throw scanError; return [];
  };
  const api = { authenticationGeneration: () => generation,
    getActiveTasks: () => queryRead("active-tasks"), getPendingCleanupScans: () => queryRead("content-cleanup-pending"),
    getTask: id => { reads.push(id); return finalRead(id); },
    retryTask: id => { writes.push(["retry", id]); throw Error("Unexpected mutation"); },
    cancelTask: id => { writes.push(["cancel", id]); throw Error("Unexpected mutation"); },
  };
  const mocks = {
    react,
    "@tanstack/react-query": { useQueryClient: () => client, useMutation: () => ({ isPending: false, mutate: noop }),
      useQuery: options => {
        const key = options.queryKey[0];
        if (!observers.has(key)) {
          const observer = new QueryObserver(client, { ...options, enabled: false, retryDelay: 0 });
          const stop = observer.subscribe(noop); observers.set(key, { observer, stop });
        }
        return observers.get(key).observer.getCurrentResult();
      } },
    "../../lib/api": api, "../../lib/offline-access": api,
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }),
      useTranslations: () => key => ({ tasks: "Tasks", noActiveTasks: "No active tasks" })[key] ?? key },
    "../../components/import-dialog-provider": { useImportDialog: () => ({ openImportDialog: noop }) },
    "../../lib/activity-time": { fullActivityTime: () => "Synthetic time" },
    "../../lib/offline-download-errors": { offlineDownloadFailureMessage: noop, offlineGenerationFailureCode: noop },
    "../../lib/batch-export-errors": { batchExportError: noop },
    "../../lib/archive-recovery": { archiveUploadRecovery: noop },
    "../../components/archive-ui": { archiveError: noop },
    "../exporting/export-artifact-delivery": { ExportArtifactDelivery: "ExportArtifactDelivery" },
    "../conversations/content-cleanup-panel": { ContentCleanupDialog: "ContentCleanupDialog" },
    "../conversations/cleanup-dismiss-action": { CleanupDismissAction: "CleanupDismissAction" },
    "../conversations/cleanup-scan-progress": { CleanupScanCancelAction: "CleanupScanCancelAction", cleanupScanLabel: () => "Synthetic scan" },
    "../../components/settings-focused-dialog": { SettingsFocusedDialog: "SettingsFocusedDialog" },
    "next/link": { default: "a" },
  };
  const window = { localStorage: { getItem: () => "[]", setItem: noop }, dispatchEvent: event => { events.push(event); },
    setTimeout: fn => { timers.push(fn); return timers.length; } };
  const module = { exports: {} };
  new Function("require", "exports", "window", "document", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw Error(`Unexpected dependency ${name}`);
    return require(name);
  }, module.exports, window, { body: {}, activeElement: null });
  const render = () => { cursor = 0; return tree = module.exports.ImportTaskMonitor({ placement, forceVisible: placement === "center" }); };
  const flush = () => { for (const [i, fn] of effects) { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); } effects.clear(); };
  const retry = () => {
    const button = find(tree, n => n.type === "button" && textOf(n) === (locale === "en-US" ? "Retry" : "重试"));
    assert.ok(button, "Missing read-only Retry"); button.props.onClick();
  };
  render(); flush();
  return { client, reads, writes, timers, events, observers, render, flush, retry,
    setList: value => { list = value; }, setListError: value => { listError = value; }, setScanError: value => { scanError = value; },
    setFinalRead: fn => { finalRead = fn; }, changeAccount: () => { generation++; },
    async refresh(kind = "active-tasks") { await observers.get(kind).observer.refetch(); render(); flush(); await setImmediate(); return render(); },
    dispose() { disposed = true; for (const h of hooks) h.cleanup?.(); for (const { observer, stop } of observers.values()) { stop(); observer.destroy(); } client.clear(); },
    writesAfterDispose: () => writesAfterDispose,
  };
}

test("a failed final GET never appends a stale task to the query-owned list", async () => {
  const f = fixture();
  try {
    const response = [];
    f.setList(response); f.setFinalRead(async () => { throw Error("Synthetic final GET failure"); }); await f.refresh();
    assert.deepEqual(response, []); assert.deepEqual(f.client.getQueryData(["active-tasks"]), []);
    assert.equal(f.reads.length, 1); assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

test("explicit Retry checks an unresolved final result even with an unchanged empty list", async () => {
  const f = fixture();
  try {
    f.setList([]); f.setFinalRead(async () => { throw Error("Synthetic lost final read"); }); await f.refresh();
    f.setFinalRead(async id => task(id, "committed")); f.retry(); f.render(); f.flush(); await setImmediate(); f.render();
    assert.equal(f.reads.length, 2);
    assert.ok(find(f.render(), n => n.type?.name === "TaskContent" && n.props.task.status === "committed"));
    assert.deepEqual(f.writes, []); assert.doesNotMatch(textOf(f.render()), /Could not load task status/);
  } finally { f.dispose(); }
});

for (const placement of ["sidebar", "mobile"]) test(`${placement}: stale progress is not presented as live`, async () => {
  const f = fixture({ placement });
  try {
    f.setListError(Error("Synthetic unavailable list")); await f.refresh();
    assert.match(textOf(f.render()), /Task status unavailable/); assert.doesNotMatch(textOf(f.render()), /42%/);
    const icon = find(f.render(), n => typeof n.props?.className === "string" && n.props.className.includes("h-4 w-4 shrink-0 text-accent"));
    assert.doesNotMatch(icon.props.className, /animate-spin/);
  } finally { f.dispose(); }
});

for (const kind of ["active-tasks", "content-cleanup-pending"]) test(`${kind}: failed cached-empty read is not a confirmed empty state`, async () => {
  const f = fixture({ rows: [] });
  try {
    if (kind === "active-tasks") f.setListError(Error("Synthetic list failure")); else f.setScanError(Error("Synthetic scan failure"));
    await f.refresh(kind);
    assert.doesNotMatch(textOf(f.render()), /No active tasks/); assert.match(textOf(f.render()), /Previous results are shown/);
    const retry = find(f.render(), n => n.type === "button" && textOf(n) === "Retry"); assert.ok(retry);
  } finally { f.dispose(); }
});

for (const locale of ["en-US", "zh-CN"]) test(`${locale}: stale feedback does not promise that tasks are still running`, async () => {
  const f = fixture({ locale });
  try {
    f.setListError(Error("Synthetic unavailable status")); await f.refresh();
    assert.doesNotMatch(textOf(f.render()), /existing tasks continue running|已有任务会继续运行/);
    assert.match(textOf(f.render()), locale === "en-US" ? /current progress is unconfirmed/ : /最新进度尚未确认/);
  } finally { f.dispose(); }
});

test("a late final GET from an old account cannot publish completion", async () => {
  const f = fixture(), held = deferred();
  try {
    f.setList([]); f.setFinalRead(() => held.promise); await f.refresh(); f.changeAccount(); f.render(); f.flush();
    held.resolve(task(undefined, "committed")); await setImmediate();
    assert.equal(find(f.render(), n => n.type?.name === "TaskContent" && n.props.task.status === "committed"), undefined);
  } finally { f.dispose(); }
});

test("repeat final-read failure keeps recovery available without resubmitting work", async () => {
  const f = fixture();
  try {
    f.setList([]); f.setFinalRead(async () => { throw Error("Synthetic repeated GET failure"); }); await f.refresh();
    f.retry(); f.render(); f.flush(); await setImmediate();
    assert.equal(f.reads.length, 2); assert.match(textOf(f.render()), /final result is unconfirmed/);
    assert.deepEqual(f.client.getQueryData(["active-tasks"]), []); assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

test("a held final check is deduplicated and disables repeated user Retry", async () => {
  const f = fixture(), held = deferred();
  try {
    f.setList([]); f.setFinalRead(async () => { throw Error("Synthetic first GET failure"); }); await f.refresh();
    f.setFinalRead(() => held.promise); f.retry(); f.render(); f.flush(); f.render();
    const retry = find(f.render(), n => n.type === "button" && textOf(n) === "Retry");
    // While checking, the old failure is replaced by an honest checking state.
    if (retry) assert.equal(retry.props.disabled, true);
    assert.match(textOf(f.render()), /Checking task results/);
    await f.refresh(); assert.equal(f.reads.length, 2);
    held.resolve(task(undefined, "committed")); await setImmediate(); f.render();
    assert.ok(find(f.render(), n => n.type?.name === "TaskContent" && n.props.task.status === "committed"));
  } finally { held.resolve(task(undefined, "committed")); f.dispose(); }
});

test("multiple unresolved tasks recover independently", async () => {
  const f = fixture({ rows: [task("synthetic-a"), task("synthetic-b")] });
  try {
    f.setList([]); f.setFinalRead(async () => { throw Error("Synthetic GET failure"); }); await f.refresh();
    assert.deepEqual(f.reads, ["synthetic-a", "synthetic-b"]);
    f.setFinalRead(async id => { if (id === "synthetic-b") throw Error("Synthetic remaining failure"); return task(id, "committed"); });
    f.retry(); f.render(); f.flush(); await setImmediate(); f.render();
    assert.match(textOf(f.render()), /final result is unconfirmed/);
    f.setFinalRead(async id => task(id, "committed")); f.retry(); f.render(); f.flush(); await setImmediate(); f.render();
    assert.deepEqual(f.reads, ["synthetic-a", "synthetic-b", "synthetic-a", "synthetic-b", "synthetic-b"]);
    assert.doesNotMatch(textOf(f.render()), /final result is unconfirmed/); assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

test("a confirmed nonterminal GET does not invent completion or discard later checking", async () => {
  const f = fixture();
  try {
    f.setList([]); f.setFinalRead(async id => task(id)); await f.refresh();
    assert.match(textOf(f.render()), /final result is unconfirmed/);
    assert.equal(find(f.render(), n => n.type?.name === "TaskContent" && n.props.task.status === "committed"), undefined);
    f.setFinalRead(async id => task(id, "committed")); f.retry(); f.render(); f.flush(); await setImmediate(); f.render();
    assert.equal(f.reads.length, 2);
    assert.ok(find(f.render(), n => n.type?.name === "TaskContent" && n.props.task.status === "committed"));
  } finally { f.dispose(); }
});

test("unmount fences a held final check's result and notifications", async () => {
  const f = fixture(), held = deferred();
  f.setList([]); f.setFinalRead(() => held.promise); await f.refresh(); f.dispose();
  held.resolve(task(undefined, "committed")); await setImmediate();
  assert.equal(f.writesAfterDispose(), 0); assert.deepEqual(f.timers, []); assert.deepEqual(f.events, []);
});

test("an unresolved final GET can recover even when the task list is still unavailable", async () => {
  const f = fixture();
  try {
    f.setList([]); f.setFinalRead(async () => { throw Error("Synthetic initial final failure"); }); await f.refresh();
    f.setListError(Error("Synthetic list outage")); await f.refresh();
    const before = f.reads.length;
    f.setFinalRead(async id => task(id, "committed")); f.retry(); f.render(); f.flush(); await setImmediate(); f.render();
    assert.ok(f.reads.length > before);
    assert.ok(find(f.render(), n => n.type?.name === "TaskContent" && n.props.task.status === "committed"));
    assert.match(textOf(f.render()), /Previous results are shown/); assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

test("current healthy data still shows genuine live progress", () => {
  const f = fixture({ placement: "sidebar" });
  try { assert.match(textOf(f.render()), /42%/); }
  finally { f.dispose(); }
});

test("a confirmed list result retires an older held lookup without duplicating completion", async () => {
  const f = fixture(), held = deferred();
  try {
    f.setList([]); f.setFinalRead(() => held.promise); await f.refresh();
    f.setList([task(undefined, "committed")]); await f.refresh();
    assert.ok(find(f.render(), n => n.type?.name === "TaskContent" && n.props.task.status === "committed"));
    assert.equal(f.timers.length, 1);
    held.reject(Error("Synthetic obsolete read failure")); await setImmediate();
    assert.equal(f.timers.length, 1);
    assert.doesNotMatch(textOf(f.render()), /final result is unconfirmed|Checking task results/);
  } finally { f.dispose(); }
});

const panelSource = readFileSync(new URL("../../apps/web/features/exporting/continuation-panel.tsx", import.meta.url), "utf8");
const panelAst = ts.createSourceFile("continuation-panel.tsx", panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const stateNames = [];
function collectStates(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(panelAst) === "useState") stateNames.push(node.name.elements[0].name.getText(panelAst));
  ts.forEachChild(node, collectStates);
}
collectStates(panelAst);
const panelCode = ts.transpileModule(panelSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function packageStatus(locale, status) {
  let stateIndex = 0;
  const options = [], apiCalls = [];
  const module = { exports: {} };
  const mocks = {
    react: { ...React, useCallback: fn => fn, useEffect: noop, useRef: initial => ({ current: initial }),
      useState: initial => [stateNames[stateIndex++] === "taskId" ? "synthetic-package-task" : typeof initial === "function" ? initial() : initial, noop] },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: noop }), useQuery: value => {
      options.push(value);
      return value.queryKey[0] === "task" ? { data: status ? { status } : undefined, isError: true }
        : value.queryKey[2] === "state" ? { data: { generation: 1, adopted_revision_id: null } } : { data: [] };
    } },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./continuation-document": { ContinuationDocument: "ContinuationDocument" },
    "./continuation-drop-target": { ContinuationDropTarget: "ContinuationDropTarget" },
    "./continuation-history": { ContinuationHistory: "ContinuationHistory" },
    "../../lib/api": { continuationApi: {}, getTask: id => { apiCalls.push(id); throw Error("Unexpected task GET in source-only rendering"); } },
  };
  new Function("require", "exports", panelCode)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw Error(`Unexpected dependency ${name}`);
    return require(name);
  }, module.exports);
  const tree = module.exports.ContinuationPanel({ conversationId: "synthetic-conversation" });
  return { tree, options, apiCalls };
}

for (const locale of ["en-US", "zh-CN"]) test(`${locale}: failed package progress read says unknown, not still running`, () => {
  const f = packageStatus(locale, "processing");
  assert.match(textOf(f.tree), locale === "en-US" ? /The latest state is unconfirmed/ : /最新状态尚未确认/);
  assert.doesNotMatch(textOf(f.tree), /still running in the background|上传任务仍在后台处理/);
  assert.deepEqual(f.apiCalls, []);
});
for (const status of ["committed", "failed", "cancelled"]) test(`confirmed package ${status} remains visible through a later GET error`, () => {
  const f = packageStatus("en-US", status);
  assert.match(textOf(f.tree), { committed: /Continuation files updated from package/, failed: /Update failed; previous files remain/, cancelled: /Update cancelled/ }[status]);
  assert.doesNotMatch(textOf(f.tree), /latest state is unconfirmed/);
  const taskOptions = f.options.find(value => value.queryKey[0] === "task");
  assert.equal(taskOptions.refetchInterval({ state: { data: { status } } }), false);
});
