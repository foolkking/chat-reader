import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const { QueryClient, QueryObserver } = require("@tanstack/react-query");
const hookSource = readFileSync(new URL("../../apps/web/features/editing/use-message-version-history.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../../apps/web/features/editing/version-history-panel.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../apps/web/lib/api.ts", import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const apiAst = ts.createSourceFile("api.ts", apiSource, ts.ScriptTarget.Latest, true);
const apiModule = { exports: {} };
new Function("exports", compile(apiAst.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "ApiRequestError").getText(apiAst)))(apiModule.exports);
const { ApiRequestError } = apiModule.exports;
const failure = status => new ApiRequestError("SYNTHETIC_GATEWAY_TEXT", status, "/api/messages/synthetic");
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const version = (id, number, head) => ({
  id, version_number: number, is_current: id === head, can_delete: number > 1,
  is_initial: number === 1, created_at: "2026-10-14T00:00:00Z", edit_type: "manual",
  display_text: `Synthetic ${id}`, content_hash: `synthetic-${id}`,
});
const history = (head = "v2", ids = ["v1", "v2"]) => ({
  message_id: "synthetic-message", current_version_id: head,
  items: ids.map(id => version(id, Number(id.slice(1)), head)),
});
const message = (head = "v2") => ({
  id: "synthetic-message", conversation_id: "synthetic-conversation", role: "assistant",
  order_key: "synthetic-order", ordinal: 7, current_version: { id: head, display_text: `Synthetic ${head}` },
  render_blocks: [], block_count: 0, char_count: 12, is_heavy: false,
});
const response = head => ({
  message_id: "synthetic-message", current_version_id: head, message: message(head),
  conversation_revision: 9, derived_status: "ready",
});
const unit = (name, body) => test(name, { timeout: 1500 }, body);

// Actual hook + installed QueryClient/QueryObserver; React scheduling, route,
// account, confirmation, transport and message replacement are controlled.
// Observers do not auto-fetch/poll here: tests invoke reads explicitly and inspect
// the hook's real options. This is not React mounting, DOM, browser or timing QA.
function fixture({ enabled = true, cached = history(), onChanged } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const hooks = [], effects = new Map(), observers = [], listeners = new Map(), calls = [], applied = [], invalidations = [];
  let cursor = 0, controller, epoch = 1, pathname = "/synthetic-reader", disposed = false, retiredWrites = 0, refreshFailure = false;
  let props = { message: message(), enabled, zh: false };
  let serverHistory = history(), serverMessage = message(), confirm = async () => true;
  let write = async (kind, id, target) => kind === "select" ? response(target) : {
    ...response("v1"), deleted_version_id: target,
  };
  let readTask = async id => ({ job_id: id, status: "processing" });
  const hook = initialize => { const index = cursor++; return hooks[index] ??= initialize(); };
  const memo = (fn, deps) => {
    const state = hook(() => ({}));
    if (!same(state.deps, deps)) Object.assign(state, { value: fn(), deps });
    return state.value;
  };
  const react = { ...React,
    useMemo: memo,
    useRef: initial => hook(() => ({ current: initial })),
    useState: initial => {
      const state = hook(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [state.value, next => {
        if (disposed) retiredWrites++;
        state.value = typeof next === "function" ? next(state.value) : next;
      }];
    },
    useEffect: (fn, deps) => {
      const index = cursor, state = hook(() => ({}));
      if (!same(state.deps, deps)) { state.deps = deps; effects.set(index, fn); }
    },
  };
  const api = {
    ApiRequestError,
    selectMessageVersion: (id, target, signal) => { calls.push({ kind: "select", id, target, signal }); return write("select", id, target); },
    deleteMessageVersion: (id, target, signal) => { calls.push({ kind: "delete", id, target, signal }); return write("delete", id, target); },
    getMessageVersions: async (id, signal) => { calls.push({ kind: "history", id, signal }); return typeof serverHistory === "function" ? serverHistory() : serverHistory; },
    getMessage: async (id, signal) => { calls.push({ kind: "message", id, signal }); return typeof serverMessage === "function" ? serverMessage() : serverMessage; },
    getConversation: async (id, signal) => { calls.push({ kind: "conversation", id, signal }); return { id, offline_revision: 11 }; },
    getTask: (id, signal) => { calls.push({ kind: "task", id, signal }); return readTask(id); },
  };
  const window = {
    addEventListener: (name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
  };
  const originalInvalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = input => { invalidations.push(input.queryKey); return originalInvalidate(input); };
  const mocks = {
    react,
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useQuery: options => {
        const state = hook(() => {
          if (cached && options.queryKey[0] === "message-versions" && options.queryKey[1] !== "inactive") client.setQueryData(options.queryKey, cached);
          const observer = new QueryObserver(client, { ...options, enabled: false, refetchInterval: false });
          const stop = observer.subscribe(() => {});
          const result = { observer, stop, options };
          observers.push(result);
          return result;
        });
        state.options = options;
        state.observer.setOptions({ ...options, enabled: false, refetchInterval: false });
        return state.observer.getCurrentResult();
      },
    },
    "next/navigation": { usePathname: () => pathname },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: input => { calls.push({ kind: "confirm", input }); return confirm(input); } }) },
    "../../lib/api": api,
    "../../lib/archive-task-state": { archiveRequestSignal: signal => signal },
    "../../lib/offline-access": {
      authenticationGeneration: () => epoch,
      AUTH_UNAUTHORIZED_EVENT: "synthetic-unauthorized", OFFLINE_ACCESS_LOCKED_EVENT: "synthetic-locked",
    },
  };
  const module = { exports: {} };
  new Function("require", "exports", "window", compile(hookSource))(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected dependency ${name}`);
    return require(name);
  }, module.exports, window);
  const render = () => {
    cursor = 0;
    controller = module.exports.useMessageVersionHistory({ ...props, onChanged: async (next, revision, isCurrent) => {
      if (isCurrent && !isCurrent()) return;
      if (refreshFailure) throw new Error("SYNTHETIC_REFRESH_TEXT");
      if (onChanged) return onChanged(next, revision, isCurrent);
      applied.push({ message: next, revision, isCurrent });
      props = { ...props, message: next };
      render(); flush();
    } });
    return controller;
  };
  const flush = () => {
    for (const [index, fn] of effects) { hooks[index].cleanup?.(); hooks[index].cleanup = fn(); }
    effects.clear();
  };
  render(); flush();
  return {
    client, calls, applied, invalidations, observers, exports: module.exports,
    render, flush, get controller() { return controller; },
    setWrite: fn => { write = fn; }, setConfirm: fn => { confirm = fn; },
    setServer: (nextHistory, nextMessage) => { serverHistory = nextHistory; serverMessage = nextMessage; },
    failRefresh: value => { refreshFailure = value; },
    setTask: fn => { readTask = fn; },
    key: () => observers[0].options.queryKey,
    change: patch => { props = { ...props, ...patch }; render(); flush(); },
    account: () => { epoch++; render(); flush(); },
    route: next => { pathname = next; render(); flush(); },
    emit: name => { for (const listener of listeners.get(name) ?? []) listener(); render(); flush(); },
    get retiredWrites() { return retiredWrites; },
    dispose: () => {
      disposed = true;
      for (const state of hooks) state?.cleanup?.();
      for (const { stop, observer } of observers) { stop(); observer.destroy(); }
      client.clear();
    },
  };
}
const writes = f => f.calls.filter(call => ["select", "delete"].includes(call.kind));

unit("desktop/mobile representations share the synchronous lock before deletion confirmation", async () => {
  const f = fixture(), confirmation = deferred();
  try {
    f.setConfirm(() => confirmation.promise);
    const desktop = f.controller, mobile = f.controller;
    const pending = desktop.remove();
    await mobile.remove(); await mobile.select(0);
    assert.equal(f.calls.filter(call => call.kind === "confirm").length, 1);
    assert.equal(writes(f).length, 0);
    assert.equal(f.render().phase, "confirming");
    confirmation.resolve(false); await pending;
    assert.equal(f.render().phase, "idle");
    assert.equal(writes(f).length, 0);
  } finally { f.dispose(); }
});

unit("a confirmed delete is not submitted after the visible head changes", async () => {
  const f = fixture(), confirmation = deferred();
  try {
    f.setConfirm(() => confirmation.promise);
    const pending = f.controller.remove();
    f.change({ message: message("v1") });
    confirmation.resolve(true); await pending;
    assert.equal(writes(f).length, 0);
    assert.equal(f.render().feedback.kind, "stale");
  } finally { f.dispose(); }
});

for (const retirement of ["account", "route", "unauthorized", "unmount"]) unit(`${retirement}: pending confirmation and late callbacks cannot write`, async () => {
  const f = fixture(), confirmation = deferred(), old = f.controller;
  try {
    f.setConfirm(() => confirmation.promise);
    const pending = old.remove();
    if (retirement === "account") f.account();
    else if (retirement === "route") { f.route("/synthetic-other"); f.route("/synthetic-reader"); }
    else if (retirement === "unauthorized") f.emit("synthetic-unauthorized");
    else f.dispose();
    confirmation.resolve(true); await pending;
    await old.select(0);
    assert.equal(writes(f).length, 0);
    assert.equal(f.retiredWrites, 0);
  } finally { if (retirement !== "unmount") f.dispose(); }
});

for (const kind of ["select", "delete"]) unit(`${kind}: lost response requires reads and explicit current-state acknowledgement, never a replay`, async () => {
  const f = fixture();
  try {
    f.setWrite(async () => { throw failure(502); });
    await (kind === "select" ? f.controller.select(0) : f.controller.remove());
    assert.equal(f.render().feedback.kind, "unconfirmed");
    assert.equal(f.controller.canWrite, false);
    assert.equal(f.observers[0].options.enabled, false);
    await f.controller.select(0);
    assert.equal(writes(f).length, 1);
    f.setServer(history("v1", kind === "delete" ? ["v1"] : ["v1", "v2"]), message("v1"));
    await f.controller.checkCurrent();
    assert.equal(f.render().feedback.kind, "checked");
    assert.equal(f.controller.canWrite, false);
    assert.deepEqual(f.calls.filter(call => ["history", "message", "conversation"].includes(call.kind)).map(call => call.kind), ["history", "message"]);
    assert.equal(f.applied[0].message.ordinal, 7);
    // Independent history/body reads are not an atomic conversation snapshot:
    // do not advance the Reader revision using unrelated metadata.
    assert.equal(f.applied[0].revision, undefined);
    f.controller.continueAfterCheck();
    assert.equal(f.render().feedback, null);
    assert.equal(f.controller.canWrite, true);
    assert.equal(writes(f).length, 1);
  } finally { f.dispose(); }
});

unit("acknowledged write and failed body refresh remain separate; recovery performs only reads", async () => {
  const f = fixture();
  try {
    f.failRefresh(true);
    await f.controller.remove();
    assert.equal(f.render().feedback.kind, "refresh-failed");
    assert.equal(f.client.getQueryData(f.key()).current_version_id, "v1");
    assert.deepEqual(f.client.getQueryData(f.key()).items.map(item => item.id), ["v1"]);
    assert.equal(writes(f).length, 1);
    f.failRefresh(false); f.setServer(history("v1", ["v1"]), message("v1"));
    await f.controller.checkCurrent();
    assert.equal(f.render().feedback, null);
    assert.equal(f.controller.canWrite, true);
    assert.equal(writes(f).length, 1);
  } finally { f.dispose(); }
});

unit("a read mismatch or subsequent read failure retains the unknown-write fence", async () => {
  const f = fixture();
  try {
    f.setWrite(async () => { throw Error("SYNTHETIC_NETWORK_TEXT"); });
    await f.controller.select(0); f.render();
    f.setServer(history("v1"), message("v2"));
    await f.controller.checkCurrent();
    assert.equal(f.render().feedback.kind, "stale");
    assert.equal(f.controller.feedback.unknown, true);
    assert.equal(f.applied.length, 0);
    f.setServer(async () => { throw failure(503); }, message("v2"));
    await f.controller.checkCurrent();
    assert.equal(f.render().feedback.kind, "read-error");
    assert.equal(f.controller.feedback.unknown, true);
    assert.equal(f.controller.canWrite, false);
    assert.equal(writes(f).length, 1);
  } finally { f.dispose(); }
});

unit("changed checked head cannot be acknowledged as the current state", async () => {
  const f = fixture();
  try {
    f.setWrite(async () => { throw failure(408); });
    await f.controller.select(0); f.render();
    await f.controller.checkCurrent(); f.render();
    f.client.setQueryData(f.key(), history("v1"));
    f.controller.continueAfterCheck();
    assert.equal(f.render().feedback.kind, "stale");
    assert.equal(f.controller.canWrite, false);
  } finally { f.dispose(); }
});

unit("a retired response/finally cannot replace the message or release a newer operation", async () => {
  const f = fixture(), first = deferred(), second = deferred();
  const firstStarted = deferred(), secondStarted = deferred();
  try {
    f.setWrite(() => { firstStarted.resolve(); return first.promise; });
    const old = f.controller, pending = old.select(0);
    await firstStarted.promise;
    assert.equal(writes(f).length, 1);
    f.route("/synthetic-other");
    f.setWrite(() => { secondStarted.resolve(); return second.promise; });
    const next = f.controller.select(0);
    await secondStarted.promise;
    assert.equal(writes(f).length, 2);
    first.resolve(response("v1")); await pending;
    assert.equal(f.render().phase, "writing");
    assert.equal(f.applied.length, 0);
    second.resolve(response("v1")); await next;
    assert.equal(f.render().phase, "idle");
    assert.equal(f.applied.length, 1);
  } finally { f.dispose(); }
});

unit("missing history head is not treated as the initial version; initial read error remains recoverable", async () => {
  const f = fixture({ cached: history("missing") });
  try {
    assert.equal(f.controller.currentIndex, -1);
    assert.equal(f.controller.current, undefined);
    assert.equal(f.controller.canWrite, false);
    await f.controller.remove();
    assert.equal(writes(f).length, 0);
    f.setServer(history(), message());
    await f.controller.checkCurrent();
    assert.equal(f.render().canWrite, true);
    f.setServer(async () => { throw failure(503); }, message());
    await f.observers[0].observer.refetch();
    assert.equal(f.render().readFailed, true);
    assert.equal(f.controller.canWrite, false);
    assert.equal(f.controller.versions.length, 2);
  } finally { f.dispose(); }
});

unit("a canonical head change invalidates the history once, not on disclosure renders", () => {
  const f = fixture();
  try {
    f.change({ message: message("v1") });
    const count = f.invalidations.filter(key => key[0] === "message-versions").length;
    assert.equal(count, 1);
    f.render(); f.flush(); f.render(); f.flush();
    assert.equal(f.invalidations.filter(key => key[0] === "message-versions").length, count);
    assert.equal(f.controller.canWrite, false);
  } finally { f.dispose(); }
});

unit("derived status read failure retains the job, stops interval and offers GET-only checking", async () => {
  const f = fixture();
  try {
    f.setWrite(async () => ({ ...response("v1"), derived_status: "queued", derived_job_id: "synthetic-job" }));
    await f.controller.select(0); f.render(); f.flush();
    f.setTask(async () => { throw failure(503); });
    await f.observers[1].observer.refetch();
    f.render(); f.flush(); f.render();
    assert.equal(f.controller.derivedJobId, "synthetic-job");
    assert.equal(f.controller.derivedReadFailed, true);
    assert.equal(f.observers[1].options.enabled, false);
    assert.equal(f.observers[1].options.refetchInterval({ state: { error: failure(503) } }), false);
    f.setTask(async id => ({ job_id: id, status: "failed" }));
    await f.controller.checkDerived(); f.render(); f.flush(); f.render();
    assert.equal(f.controller.derivedTerminal, "failed");
    assert.equal(f.controller.derivedJobId, "synthetic-job");
    assert.equal(writes(f).length, 1);
    assert.equal(f.calls.filter(call => call.kind === "task").length, 2);
  } finally { f.dispose(); }
});

unit("readonly readers do not use private cache keys or issue reads/writes/listeners", async () => {
  const f = fixture({ enabled: false });
  try {
    assert.deepEqual(f.key(), ["message-versions", "inactive"]);
    assert.equal(f.controller.active, false);
    await f.controller.select(0); await f.controller.remove(); await f.controller.checkCurrent(); await f.controller.checkDerived();
    assert.deepEqual(f.calls, []);
    assert.ok(f.observers.every(observer => observer.options.enabled === false));
  } finally { f.dispose(); }
});

unit("write classification preserves definite 4xx and treats timeout/server/transport as unconfirmed", () => {
  const f = fixture();
  try {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(f.exports.versionWriteIsUnconfirmed(failure(status)), false);
    for (const status of [408, 500, 502, 503, 504]) assert.equal(f.exports.versionWriteIsUnconfirmed(failure(status)), true);
    assert.equal(f.exports.versionWriteIsUnconfirmed(Error("SYNTHETIC_GATEWAY_TEXT")), true);
    assert.equal(f.exports.versionIssue(failure(409)), "conflict");
    assert.equal(f.exports.versionIssue(failure(429)), "limited");
  } finally { f.dispose(); }
});

const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  return predicate(node) ? node : find(node.props?.children, predicate);
}
for (const locale of ["en-US", "zh-CN"]) unit(`${locale}: initial read failure opens real localized recovery without raw response text`, () => {
  let cursor = 0, tree;
  const values = [], effects = [];
  const hook = init => { const index = cursor++; return values[index] ??= init(); };
  const calls = [];
  const controller = {
    scope: {}, active: true, versions: [], currentIndex: -1, readFailed: true, readIssue: "service",
    feedback: null, phase: "idle", needsAttention: true, canWrite: false, loading: false,
    checkCurrent: () => calls.push("read"),
  };
  const module = { exports: {} };
  new Function("require", "exports", "window", "document", compile(panelSource))(name => {
    if (name === "react") return { ...React, useId: () => "synthetic-panel",
      useRef: init => hook(() => ({ current: init })),
      useState: init => { const value = hook(() => ({ current: init })); return [value.current, next => { value.current = next; }]; },
      useEffect: fn => effects.push(fn),
    };
    if (name === "lucide-react") return { ChevronLeft: "left", ChevronRight: "right", History: "history", Trash2: "trash", X: "close" };
    if (name === "../../components/preferences-provider") return { usePreferences: () => ({ resolvedLocale: locale }) };
    if (name.startsWith(".")) throw Error(`Unexpected dependency ${name}`);
    return require(name);
  }, module.exports, { addEventListener() {}, removeEventListener() {} }, { activeElement: null });
  const render = () => { cursor = 0; return tree = module.exports.VersionHistoryPanel({ controller, mobile: true }); };
  render();
  find(tree, node => node.type === "button" && node.props["aria-expanded"] !== undefined).props.onClick();
  render();
  assert.match(text(tree), locale === "en-US" ? /Versions could not be fully read/ : /版本未能完整读取/);
  assert.doesNotMatch(text(tree), /SYNTHETIC_GATEWAY_TEXT|No version history is available|没有可用的版本历史/);
  find(tree, node => node.type === "button" && text(node) === (locale === "en-US" ? "Check current state" : "核对当前状态")).props.onClick();
  assert.deepEqual(calls, ["read"]);
  assert.ok(find(tree, node => node.type === "section").props.className.includes("basis-full"));
});
