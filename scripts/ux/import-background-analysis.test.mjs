import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript"), noop = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const value = find(child, predicate); if (value) return value; } return; }
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const session = (state = "ANALYZING", phase = "queued") => ({
  import_id: "synthetic-import", analysis_task_id: "synthetic-analysis", state, phase, progress: 0,
  file_count: 3, families: [], groups: [], warnings: [], can_import: state === "READY",
});
const completion = { import_id: "synthetic-import", status: "committed", conversation_ids: ["synthetic-conversation"],
  conversation_count: 1, message_count: 2, warnings: [] };

// Execute actual component/formatter code with controlled hook scheduling and
// transport. This does not substitute for the mounted browser/polling cases.
function hooksRuntime() {
  const slots = [], pending = new Map();
  let cursor = 0, disposed = false, retiredWrites = 0;
  const slot = init => slots[cursor++] ??= init();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (fn, deps) => { const h = slot(() => ({})); if (!same(h.deps, deps)) Object.assign(h, { value: fn(), deps }); return h.value; };
  return {
    react: { ...React, useRef: value => slot(() => ({ current: value })), useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
      useId: () => slot(() => "synthetic-id"),
      useState: initial => { const h = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
        return [h.value, next => { if (disposed) retiredWrites++; h.value = typeof next === "function" ? next(h.value) : next; }]; },
      useEffect: (fn, deps) => { const i = cursor, h = slot(() => ({})); if (!same(h.deps, deps)) { h.deps = deps; pending.set(i, fn); } },
    },
    reset: () => { cursor = 0; },
    flush: () => { for (const [i, fn] of pending) { slots[i].cleanup?.(); slots[i].cleanup = fn(); } pending.clear(); },
    dispose: () => { disposed = true; for (const h of slots) h.cleanup?.(); pending.clear(); },
    retiredWrites: () => retiredWrites,
  };
}
function load(path, mocks, window) {
  const source = readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "window", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw Error(`Unexpected component dependency ${name}`);
    return require(name);
  }, module.exports, window);
  return module.exports;
}
function fixture({ resumeImportId, storedId, locale = "en-US", initialRead } = {}) {
  const runtime = hooksRuntime(), calls = [], mutations = [], queries = new Map(), storage = new Map();
  if (storedId) storage.set("chat-reader:adaptive-import-session", storedId);
  let generation = 1, read = initialRead ?? (async () => session()), upload = async () => session(), tree, mutationCursor = 0;
  const window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    dispatchEvent: event => calls.push(["event", event.type]) };
  const api = { ApiRequestError: class extends Error {},
    createAdaptiveImportSession: files => { calls.push(["upload", files]); return upload(); },
    getAdaptiveImportSession: (id, signal) => { calls.push(["read", id, signal]); return read(id, signal); },
    cancelAdaptiveImportSession: async id => { calls.push(["cancel", id]); },
    retryTask: async id => { calls.push(["retry", id]); return { job_id: id, status: "queued" }; },
    getImportStatus: async id => { calls.push(["result", id]); return completion; },
    previewImport: noop, commitImport: noop,
  };
  const mocks = { react: runtime.react,
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../lib/api": api, "../../lib/offline-access": { authenticationGeneration: () => generation },
    "../../lib/auth-client": { readAccountCapabilities: noop },
    "../../components/support-limit-action": { SupportLimitAction: "SupportLimitAction" },
    "./import-preview-card": { ImportPreviewCard: "ImportPreviewCard" },
    "./adaptive-import-workspace": { AdaptiveImportWorkspace: "AdaptiveImportWorkspace" },
    "./format-conversion-guide": { FormatConversionGuide: "FormatConversionGuide" },
    "./import-noise-review": { ImportNoiseReview: "ImportNoiseReview" },
    "next/navigation": { useRouter: () => ({ push: value => calls.push(["navigate", value]) }) }, "next/link": { default: "a" },
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useQuery: options => {
        const key = options.queryKey[0], previous = queries.get(key) ?? {};
        const result = previous.result ?? (key === "account-capabilities" ? {
          data: { allow_user_import: true, maximum_import_size_mb: 500, maximum_import_total_mb: 512 },
        } : {});
        queries.set(key, { options, result });
        return { ...result, refetch: async () => { calls.push(["refetch", key]); return options.queryFn({}); } };
      },
      useMutation: options => {
        const i = mutationCursor++, item = mutations[i] ??= { isPending: false, error: null, reset: noop };
        item.options = options;
        item.run = async value => { const result = await item.options.mutationFn(value); item.options.onSuccess?.(result); return result; };
        item.mutate = value => { void item.run(value); };
        return item;
      },
    },
  };
  const queryClient = { invalidateQueries: options => { calls.push(["invalidate", options.queryKey]); return Promise.resolve(); } };
  mocks["./import-workspace-copy"] = load("features/import/import-workspace-copy.ts", mocks, window);
  const { ImportPanel } = load("features/import/import-panel.tsx", mocks, window);
  const props = { resumeImportId, onImportCommitted: () => calls.push(["close"]) };
  const render = () => { runtime.reset(); mutationCursor = 0; return tree = ImportPanel(props); };
  render(); runtime.flush();
  return { calls, storage, mutations, queries, render, ...runtime,
    setRead: fn => { read = fn; }, setUpload: fn => { upload = fn; }, changeAccount: () => { generation++; },
    async settle() { for (let i = 0; i < 4; i++) { await setImmediate(); render(); runtime.flush(); } return render(); },
    publish(value, epoch = generation) { queries.get("adaptive-import-analysis").result = { data: { value, generation: epoch } }; render(); runtime.flush(); return render(); },
    tree: () => tree,
  };
}

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: upload acknowledgement releases files and offers background tasks, not premature import`, async () => {
  const f = fixture({ locale });
  try {
    await f.mutations[0].run([{ name: "synthetic-a.json", size: 10 }]); await f.settle();
    assert.ok(find(f.tree(), node => node.props?.["data-testid"] === "import-analysis-status"));
    assert.equal(find(f.tree(), node => node.type === "AdaptiveImportWorkspace"), undefined);
    assert.match(text(f.tree()), locale === "zh-CN" ? /3 个文件已保存在服务器/ : /batch of 3 files is saved on the server/);
    const action = find(f.tree(), node => node.type === "button" && /查看后台任务|View background tasks/.test(text(node)));
    action.props.onClick();
    assert.deepEqual(f.calls.filter(row => ["close", "event"].includes(row[0])), [["close"], ["event", "chat-reader:open-task-center"]]);
    assert.equal(f.storage.get("chat-reader:adaptive-import-session"), "synthetic-import");
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
  } finally { f.dispose(); }
});

test("polling uses an abortable GET; a ready result opens the existing review, never canonical commit", async () => {
  const f = fixture();
  try {
    await f.mutations[0].run([]); await f.settle();
    const query = f.queries.get("adaptive-import-analysis").options;
    assert.equal(query.enabled, true);
    assert.equal(query.refetchInterval({ state: { data: { value: session() } } }), 1500);
    assert.equal(query.refetchInterval({ state: { data: { value: session("READY", "ready") } } }), false);
    const controller = new AbortController();
    await query.queryFn({ signal: controller.signal });
    assert.equal(f.calls.find(row => row[0] === "read")[2], controller.signal);
    const tree = f.publish(session("READY", "ready"));
    assert.ok(find(tree, node => node.type === "AdaptiveImportWorkspace"));
    assert.equal(f.queries.get("adaptive-import-analysis").options.enabled, false);
    assert.equal(f.calls.filter(row => row[0] === "cancel").length, 0);
  } finally { f.dispose(); }
});

test("closing while upload response is in flight cannot publish or implicitly cancel the queued task", async () => {
  const f = fixture(), held = deferred();
  f.setUpload(() => held.promise);
  const pending = f.mutations[0].run([]);
  f.dispose(); held.resolve(session()); await pending;
  assert.equal(f.retiredWrites(), 0);
  assert.equal(f.calls.filter(row => row[0] === "cancel").length, 0);
  assert.equal(f.storage.size, 0);
});

test("old-account analysis reads cannot publish a workspace or result", async () => {
  const f = fixture();
  try {
    await f.mutations[0].run([]); await f.settle(); f.changeAccount();
    const tree = f.publish(session("READY", "ready"), 1);
    assert.equal(find(tree, node => node.type === "AdaptiveImportWorkspace"), undefined);
  } finally { f.dispose(); }
});

test("task resume outranks a local pointer; failure keeps the saved source reachable and retry reuses the job", async () => {
  const f = fixture({ resumeImportId: "synthetic-import", storedId: "older-import",
    initialRead: async () => session("FAILED", "analysis_failed") });
  try {
    await f.settle();
    assert.equal(f.calls.find(row => row[0] === "read")[1], "synthetic-import");
    assert.match(text(f.tree()), /Source files are retained/);
    await f.mutations[5].run("synthetic-analysis"); await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 0);
    assert.deepEqual(f.calls.find(row => row[0] === "retry"), ["retry", "synthetic-analysis"]);
    assert.equal(f.queries.get("adaptive-import-analysis").options.enabled, true);
    assert.equal(f.storage.get("chat-reader:adaptive-import-session"), "synthetic-import");
  } finally { f.dispose(); }
});

test("canonical commit failure is not mislabelled as initial analysis failure", async () => {
  const f = fixture();
  try {
    await f.mutations[0].run([]); await f.settle();
    const tree = f.publish(session("FAILED", "failed"));
    assert.ok(find(tree, node => node.type === "AdaptiveImportWorkspace"));
    assert.doesNotMatch(text(tree), /Initial analysis failed/);
  } finally { f.dispose(); }
});

test("explicit cancellation resets this pane; closing/unmounting alone does not", async () => {
  const f = fixture();
  try {
    await f.mutations[0].run([]); await f.settle();
    await f.mutations[1].run("synthetic-import"); await f.settle();
    assert.deepEqual(f.calls.find(row => row[0] === "cancel"), ["cancel", "synthetic-import"]);
    assert.equal(f.storage.size, 0);
    assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "import-analysis-status"), undefined);
  } finally { f.dispose(); }
});

test("an aborted resume read cannot restore a closed pane", async () => {
  const held = deferred(), f = fixture({ resumeImportId: "synthetic-import", initialRead: () => held.promise });
  try {
    const signal = f.calls.find(row => row[0] === "read")[2];
    f.dispose();
    assert.equal(signal.aborted, true);
    held.resolve(session());
    await setImmediate();
    assert.equal(f.retiredWrites(), 0);
  } finally { held.resolve(session()); }
});

test("reopening a completed analysis reads the saved canonical result instead of showing an empty file picker", async () => {
  const f = fixture({ resumeImportId: "synthetic-import", initialRead: async () => session("COMPLETED", "committed") });
  try {
    await f.settle();
    const summary = find(f.tree(), node => node.type?.name === "ImportCompletionSummary");
    assert.ok(summary);
    assert.equal(summary.props.result, completion);
    assert.deepEqual(f.calls.find(row => row[0] === "result"), ["result", "synthetic-import"]);
    assert.equal(f.storage.size, 0);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 0);
  } finally { f.dispose(); }
});

function dialogFixture() {
  const runtime = hooksRuntime(), window = new EventTarget(), prompts = [];
  let generation = 1, answer = async () => true, tree;
  const t = key => ({ settings: "Settings", importData: "Import data" })[key] ?? key;
  const { ImportDialogProvider } = load("components/import-dialog-provider.tsx", {
    react: runtime.react,
    "../features/import/import-panel": { ImportPanel: "ImportPanel" },
    "./preferences-provider": { useTranslations: () => t },
    "./use-dialog-focus": { useDialogFocus: noop },
    "./interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async prompt => { prompts.push(prompt); return answer(); } }) },
    "../lib/offline-access": { authenticationGeneration: () => generation, AUTH_GENERATION_CHANGED_EVENT: "synthetic-auth-change" },
  }, window);
  const render = () => { runtime.reset(); tree = ImportDialogProvider({ children: "Synthetic page" }); runtime.flush(); return tree; };
  render();
  return { ...runtime, prompts, render,
    panel: () => find(tree, node => node.type === "ImportPanel"),
    setAnswer: fn => { answer = fn; },
    async open(id) { tree.props.value.openImportDialog({ resumeImportId: id }); await setImmediate(); render(); },
    async switchAccount() { generation++; window.dispatchEvent(new Event("synthetic-auth-change")); await setImmediate(); render(); },
    async settle() { await setImmediate(); return render(); },
  };
}

test("opening a task cannot silently discard another session's dirty mapping", async () => {
  const f = dialogFixture();
  try {
    await f.open("first-import");
    const firstKey = f.panel().key;
    f.panel().props.onMappingStateChange({ dirty: true, busy: false }); f.render();
    f.setAnswer(async () => false); await f.open("second-import");
    assert.equal(f.panel().props.resumeImportId, "first-import");
    assert.equal(f.prompts.length, 1);
    f.setAnswer(async () => true); await f.open("second-import");
    assert.equal(f.panel().props.resumeImportId, "second-import");
    assert.notEqual(f.panel().key, firstKey, "Confirmed discard remounts the workspace, not just its dirty flag.");
  } finally { f.dispose(); }
});

test("a busy or changed mapping invalidates a pending task-switch confirmation", async () => {
  const f = dialogFixture(), held = deferred();
  try {
    await f.open("first-import");
    f.panel().props.onMappingStateChange({ dirty: true, busy: true }); f.render();
    await f.open("second-import");
    assert.equal(f.prompts.length, 0);
    f.panel().props.onMappingStateChange({ dirty: true, busy: false }); f.render();
    f.setAnswer(() => held.promise);
    const switchPending = f.open("second-import");
    f.panel().props.onMappingStateChange({ dirty: true, busy: true }); f.render();
    held.resolve(true); await switchPending; await f.settle();
    assert.equal(f.panel().props.resumeImportId, "first-import");
  } finally { held.resolve(false); f.dispose(); }
});

test("an old account's confirmation cannot reopen import after identity changes or unmount", async () => {
  const f = dialogFixture(), held = deferred();
  try {
    await f.open("first-import");
    f.panel().props.onMappingStateChange({ dirty: true, busy: false }); f.render();
    f.setAnswer(() => held.promise);
    const pending = f.open("second-import");
    await f.switchAccount();
    assert.equal(f.panel(), undefined);
    f.dispose(); held.resolve(true); await pending; await setImmediate();
    assert.equal(f.retiredWrites(), 0);
  } finally { held.resolve(false); }
});
