import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript"), noop = () => {};
const { QueryClient, QueryObserver } = require("@tanstack/react-query");
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

test("source repair has a required mounted CI gate and retained screenshots", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/build-release-images.yml", import.meta.url), "utf8");
  const step = workflow.split("- name: Failed and paused import source repair")[1]?.split("- name:")[0];
  assert.match(step ?? "", /run: node scripts\/ux\/import-source-repair-browser\.mjs/);
  assert.doesNotMatch(step, /continue-on-error|if:/);
  assert.match(workflow, /import-source-repair-browser\/result\.json/);
  assert.match(workflow, /import-source-repair-browser\/\*\.png/);
});

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
function fixture({ resumeImportId, storedId, locale = "en-US", initialRead, laneWidth = 720, cache = new Map(), initialMode = "adaptive" } = {}) {
  const runtime = hooksRuntime(), calls = [], mutations = [], queries = new Map(), storage = new Map(), events = new EventTarget();
  if (storedId) storage.set("chat-reader:adaptive-import-session", storedId);
  let generation = 1, read = initialRead ?? (async () => session()), upload = async () => session(), receipt = async () => ({ receipt: null }), tree, mutationCursor = 0;
  let stop = async id => ({ job_id: id, status: "cancelling" });
  let replace = async () => ({ ...session(), analysis_task_id: "replacement-analysis" });
  let exclude = async () => ({ ...session(), analysis_task_id: "exclusion-analysis" });
  let commit = async id => ({ ...completion, import_id: id, status: "queued" });
  let status = async () => completion;
  const window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    dispatchEvent: event => { calls.push(["event", event.type]); return events.dispatchEvent(event); } };
  const uploadOptions = [];
  const api = { ApiRequestError: class extends Error {
    constructor(message, status, path, code) { super(message); Object.assign(this, { status, path, code, name: "ApiRequestError" }); }
  },
    createAdaptiveImportSession: (files, profile, project, options) => {
      calls.push(["upload", files]); uploadOptions.push({ profile, project, ...options }); return upload(options);
    },
    getAdaptiveUploadReceipt: key => { calls.push(["uploadReceipt", key]); return receipt(key); },
    getAdaptiveImportSession: (id, signal) => { calls.push(["read", id, signal]); return read(id, signal); },
    cancelAdaptiveImportSession: async id => { calls.push(["cancel", id]); },
    cancelTask: (id, signal, disposition) => { calls.push(["stop", id, disposition, signal]); return stop(id); },
    resumeAdaptiveImportSession: async (id, updatedAt) => {
      calls.push(["resume", id, updatedAt]); return { ...session(), analysis_task_id: "new-analysis" };
    },
    replaceAdaptiveImportArtifact: (id, artifact, file, updatedAt) => {
      calls.push(["replace", id, artifact, file, updatedAt]); return replace(id, artifact, file, updatedAt);
    },
    excludeAdaptiveImportSource: (id, artifact, updatedAt) => {
      calls.push(["exclude", id, artifact, updatedAt]); return exclude(id, artifact, updatedAt);
    },
    retryTask: async id => { calls.push(["retry", id]); return { job_id: id, status: "queued" }; },
    getImportStatus: async id => { calls.push(["result", id]); return status(); },
    previewImport: async () => ({ import_id: "synthetic-archive", can_commit: true }),
    commitImport: (id, options) => { calls.push(["commit", id, options]); return commit(id, options); },
  };
  const mocks = { react: runtime.react,
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale, readerWidthMode: "standard", sectionTocMode: "visible" }) },
    "../../lib/api": api, "../../lib/offline-access": { authenticationGeneration: () => generation, AUTH_GENERATION_CHANGED_EVENT: "synthetic-auth-change" },
    "../../lib/auth-client": { readAccountCapabilities: noop },
    "../../lib/offline-db": { getActiveOfflineStorageContext: () => ({ userId: null }) },
    "../../components/support-limit-action": { SupportLimitAction: "SupportLimitAction" },
    "./import-preview-card": { ImportPreviewCard: "ImportPreviewCard" },
    "./adaptive-import-workspace": { AdaptiveImportWorkspace: "AdaptiveImportWorkspace" },
    "./format-conversion-guide": { FormatConversionGuide: "FormatConversionGuide" },
    "./import-noise-review": { ImportNoiseReview: "ImportNoiseReview" },
    // Geometry is an explicit adapter, not evidence of real DOM measurement.
    "./image-import-lane": { measureImportImageLane: options => { calls.push(["measure", options, laneWidth]); return laneWidth; } },
    "next/navigation": { useRouter: () => ({ push: value => calls.push(["navigate", value]) }) }, "next/link": { default: "a" },
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useQuery: options => {
        const key = options.queryKey[0], previous = queries.get(key) ?? {};
        const sameKey = JSON.stringify(previous.options?.queryKey) === JSON.stringify(options.queryKey);
        const result = (sameKey ? previous.result : undefined) ?? (key === "account-capabilities" ? {
          data: { allow_user_import: true, maximum_import_size_mb: 500, maximum_import_total_mb: 512 },
        } : {});
        queries.set(key, { options, result });
        return { ...result, ...(["import-source-repair", "import-commit-control", "adaptive-import-upload", "adaptive-import-upload-retained"].includes(key) ? { data: cache.get(JSON.stringify(options.queryKey)) } : {}),
          refetch: async () => { calls.push(["refetch", key]); return options.queryFn({}); } };
      },
      useMutation: options => {
        const i = mutationCursor++, item = mutations[i] ??= { isPending: false, isError: false, error: null };
        item.reset = () => { item.isPending = false; item.isError = false; item.error = null; };
        item.options = options;
        item.run = async value => {
          item.variables = value;
          const operation = item.options, context = operation.onMutate?.(value);
          item.isPending = true; item.isError = false; item.error = null;
          try {
            const result = await operation.mutationFn(value);
            operation.onSuccess?.(result, value, context);
            return result;
          } catch (error) {
            item.error = error; item.isError = true;
            operation.onError?.(error, value, context); throw error;
          } finally { item.isPending = false; }
        };
        item.mutate = value => { void item.run(value).catch(noop); };
        return item;
      },
    },
  };
  const queryClient = {
    invalidateQueries: options => { calls.push(["invalidate", options.queryKey]); return Promise.resolve(); },
    getQueryData: key => cache.get(JSON.stringify(key)),
    removeQueries: ({ queryKey }) => cache.delete(JSON.stringify(queryKey)),
    setQueryData: (key, value) => {
      const id = JSON.stringify(key);
      cache.set(id, typeof value === "function" ? value(cache.get(id)) : value);
    },
  };
  const pastedTranscript = load("features/import/pasted-transcript.ts", mocks, window);
  mocks["./pasted-transcript"] = { ...pastedTranscript,
    pastedTranscriptByteLength: value => { calls.push(["pasteBytes"]); return pastedTranscript.pastedTranscriptByteLength(value); } };
  mocks["./import-workspace-copy"] = load("features/import/import-workspace-copy.ts", mocks, window);
  const uploadHook = load("features/import/use-import-upload.ts", mocks, window);
  let actualUpload;
  mocks["./use-import-upload"] = { useImportUpload: (...args) => actualUpload = uploadHook.useImportUpload(...args) };
  mocks["./import-upload-feedback"] = { ImportUploadFeedback: "ImportUploadFeedback" };
  const { ImportPanel } = load("features/import/import-panel.tsx", mocks, window);
  const props = { resumeImportId, initialMode, onImportCommitted: () => calls.push(["close"]),
    onMappingStateChange: state => calls.push(["mapping", state]) };
  const render = () => { runtime.reset(); mutationCursor = 0; return tree = ImportPanel(props); };
  render(); runtime.flush();
  return { calls, storage, mutations, queries, render, ...runtime,
    setRead: fn => { read = fn; }, setUpload: fn => { upload = fn; }, changeAccount: () => { generation++; window.dispatchEvent(new Event("synthetic-auth-change")); },
    setReceipt: fn => { receipt = fn; }, uploadOptions, api,
    submitUpload: files => actualUpload.submit({ files }),
    uploadControl: () => find(tree, node => node.type === "ImportUploadFeedback")?.props.control,
    setStop: fn => { stop = fn; },
    setReplace: fn => { replace = fn; },
    setExclude: fn => { exclude = fn; },
    setCommit: fn => { commit = fn; },
    setStatus: fn => { status = fn; },
    resize: width => { laneWidth = width; window.dispatchEvent(new Event("resize")); },
    async settle() { for (let i = 0; i < 4; i++) { await setImmediate(); render(); runtime.flush(); } return render(); },
    publish(value, epoch = generation, analysisTaskId = queries.get("adaptive-import-analysis").options.queryKey[3]) {
      queries.get("adaptive-import-analysis").result = { data: { value, generation: epoch, analysisTaskId } };
      render(); runtime.flush(); return render();
    },
    tree: () => tree,
  };
}

test("selected files can be removed and replaced without losing siblings or filename duplicates", async () => {
  const f = fixture();
  try {
    const input = () => find(f.tree(), node => node.props?.["data-testid"] === "import-file-input");
    const choose = files => input().props.onChange({ currentTarget: { files, value: "synthetic" } });
    const first = { name: "02.json", size: 8 }, bad = { name: "bad.exe", size: 10 }, last = { name: "01.json", size: 12 };
    choose([first, bad, last]); await f.settle();
    assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "preview-import-button").props.disabled, true);
    find(f.tree(), node => node.props?.["aria-label"] === "Remove file: bad.exe").props.onClick();
    await f.settle();
    const duplicate = { name: last.name, size: 25 };
    choose([duplicate]); await f.settle();
    const replacement = { name: "replacement.json", size: 18 };
    find(f.tree(), node => node.props?.["aria-label"] === "Replace file: 02.json").props.onChange({
      currentTarget: { files: [replacement], value: "synthetic" },
    });
    await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 0);
    find(f.tree(), node => node.props?.["data-testid"] === "preview-import-button").props.onClick();
    await f.settle();
    assert.deepEqual(f.calls.filter(row => row[0] === "upload"), [["upload", [replacement, last, duplicate]]]);
  } finally { f.dispose(); }
});

test("an uncertain commit locks only its original import, survives reopen and checks the receipt without POST replay", async () => {
  const cache = new Map(), ready = { ...session("READY"), updated_at: "2026-11-10T00:00:00Z" };
  const f = fixture({ cache, resumeImportId: ready.import_id, initialRead: async () => ready });
  await f.settle();
  f.setCommit(async () => { throw Error("CONNECTION_FAILED"); });
  find(f.tree(), node => node.type === "AdaptiveImportWorkspace").props.onImport();
  await f.settle();
  assert.match(text(f.tree()), /submission is unconfirmed/);
  assert.equal(find(f.tree(), node => node.type === "AdaptiveImportWorkspace").props.importing, true);
  assert.equal(f.calls.filter(row => row[0] === "commit").length, 1);
  const report = find(f.tree(), node => node.type === "AdaptiveImportWorkspace").props.onMappingStateChange;
  report({ dirty: false, busy: true });
  assert.deepEqual(f.calls.at(-1), ["mapping", { dirty: false, busy: true, background: true }], "An unknown acknowledgement must not trap the whole dialog.");
  report({ dirty: true, busy: true });
  assert.deepEqual(f.calls.at(-1), ["mapping", { dirty: true, busy: true }], "Actual unsaved mapping still needs its existing protection.");
  f.dispose();
  const reopened = fixture({ cache, resumeImportId: ready.import_id, initialRead: async () => ready });
  try {
    await reopened.settle();
    assert.equal(find(reopened.tree(), node => node.type === "AdaptiveImportWorkspace").props.importing, true);
    find(reopened.tree(), node => node.type === "button" && text(node) === "Check import result").props.onClick();
    await reopened.settle();
    assert.equal(reopened.calls.filter(row => row[0] === "result").length, 1);
    assert.equal(reopened.calls.filter(row => row[0] === "commit").length, 0);
    assert.equal(find(reopened.tree(), node => node.type === "AdaptiveImportWorkspace"), undefined);
    assert.equal(cache.get(JSON.stringify(["import-commit-control", 1, ready.import_id])), null);
  } finally { reopened.dispose(); }
});

test("a previewed archive read is not proof that an unknown restoration can be safely replayed", async () => {
  const f = fixture({ initialMode: "archive" });
  try {
    await f.mutations[1].run([]); await f.settle();
    f.setCommit(async () => { throw Error("CONNECTION_FAILED"); });
    find(f.tree(), node => node.props?.["data-testid"] === "commit-import-button").props.onClick();
    await f.settle();
    f.setStatus(async () => ({ ...completion, import_id: "synthetic-archive", status: "previewed" }));
    find(f.tree(), node => node.type === "button" && text(node) === "Check import result").props.onClick();
    await f.settle();
    assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Retry original submission (same options)"), undefined);
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 1);
    assert.match(text(f.tree()), /Check again or open Tasks/);
  } finally { f.dispose(); }
});

test("source exclusion needs explicit confirmation and locks uncertain writes across remount", async () => {
  const cache = new Map(), stopped = { ...session("PAUSED", "paused"), updated_at: "2026-11-10T00:00:00Z",
    sources: [{ artifact_id: "one", filename: "one.zip" }, { artifact_id: "two", filename: "two.json" }] };
  const f = fixture({ cache, resumeImportId: stopped.import_id, initialRead: async () => stopped });
  await f.settle();
  f.setExclude(async () => { throw Error("Unconfirmed"); });
  find(f.tree(), node => node.props?.["aria-label"] === "Exclude from this import: one.zip").props.onClick();
  await f.settle();
  assert.equal(f.calls.filter(row => row[0] === "exclude").length, 0);
  const confirm = find(f.tree(), node => node.type === "button" && text(node) === "Confirm exclusion");
  confirm.props.onClick(); confirm.props.onClick();
  await f.settle();
  assert.match(text(f.tree()), /exclusion result is unconfirmed/);
  assert.deepEqual(f.calls.filter(row => row[0] === "exclude"), [["exclude", stopped.import_id, "one", stopped.updated_at]]);
  f.dispose();
  const next = fixture({ cache, resumeImportId: stopped.import_id, initialRead: async () => stopped });
  try {
    await next.settle();
    assert.equal(find(next.tree(), node => node.type === "button" && text(node) === "Continue analysis").props.disabled, true);
    next.publish({ ...stopped, sources: stopped.sources.slice(1) });
    await next.settle();
    assert.doesNotMatch(text(next.tree()), /exclusion result is unconfirmed/);
    assert.equal(find(next.tree(), node => node.type === "button" && text(node) === "Continue analysis").props.disabled, false);
    assert.equal(next.calls.filter(row => ["exclude", "replace", "resume", "commit"].includes(row[0])).length, 0);
  } finally { next.dispose(); }
});

test("legacy replacement acknowledgement can be checked by server source revision, not only task identity", async () => {
  const stopped = { ...session("PAUSED", "paused"), updated_at: "2026-11-10T00:00:00Z",
    sources: [{ artifact_id: "one", filename: "same.json", source_revision: 0 }] };
  const f = fixture({ resumeImportId: stopped.import_id, initialRead: async () => stopped });
  try {
    await f.settle();
    f.setReplace(async () => { throw Error("Lost acknowledgement"); });
    find(f.tree(), node => node.type === "input" && node.props.type === "file").props.onChange({
      currentTarget: { files: [{ name: "same.json", size: 20 }], value: "synthetic" },
    });
    await f.settle();
    f.publish({ ...stopped, updated_at: "2026-11-10T00:01:00Z" });
    await f.settle();
    assert.match(text(f.tree()), /replacement result is unconfirmed/);
    f.publish({ ...stopped, sources: [{ ...stopped.sources[0], source_revision: 1 }] });
    await f.settle();
    assert.doesNotMatch(text(f.tree()), /replacement result is unconfirmed/);
    assert.equal(f.calls.filter(row => row[0] === "replace").length, 1);
  } finally { f.dispose(); }
});

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: failed source replacement preserves session and requires review`, async () => {
  const paused = { ...session("PAUSED", "paused"), updated_at: "2026-11-10T00:00:00Z",
    sources: [{ artifact_id: "source-one", filename: "Synthetic source.json", byte_size: 100, extension: ".json" }] };
  const f = fixture({ locale, resumeImportId: paused.import_id, initialRead: async () => paused });
  try {
    await f.settle();
    const input = find(f.tree(), node => node.type === "input" && node.props.type === "file");
    assert.ok(input);
    assert.match(input.props["aria-label"], /Synthetic source/);
    const file = { name: "Replacement.json", size: 20 };
    input.props.onChange({ currentTarget: { files: [file], value: "synthetic" } });
    input.props.onChange({ currentTarget: { files: [file], value: "synthetic" } });
    await f.settle();
    assert.deepEqual(f.calls.filter(row => row[0] === "replace"), [
      ["replace", paused.import_id, "source-one", file, paused.updated_at],
    ]);
    assert.equal(f.queries.get("adaptive-import-analysis").options.queryKey[3], "replacement-analysis");
    assert.equal(f.calls.filter(row => ["commit", "cancel", "resume", "retry", "upload"].includes(row[0])).length, 0);
  } finally { f.dispose(); }
});

test("unknown source replacement locks conflicting writes and offers only a status check", async () => {
  const stopped = { ...session("FAILED", "analysis_failed"), updated_at: "2026-11-10T00:00:00Z",
    sources: [{ artifact_id: "source-one", filename: "Synthetic source.json", byte_size: 100, extension: ".json" }] };
  const f = fixture({ resumeImportId: stopped.import_id, initialRead: async () => stopped });
  try {
    await f.settle();
    f.setReplace(async () => { throw Error("Transport interrupted"); });
    find(f.tree(), node => node.type === "input" && node.props.type === "file").props.onChange({
      currentTarget: { files: [{ name: "replacement.json", size: 20 }], value: "synthetic" },
    });
    await f.settle();
    assert.match(text(f.tree()), /replacement result is unconfirmed/);
    assert.equal(find(f.tree(), node => node.type === "input" && node.props.type === "file").props.disabled, true);
    assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Retry analysis").props.disabled, true);
    find(f.tree(), node => node.type === "button" && text(node) === "Check status").props.onClick();
    await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "replace").length, 1);
    assert.equal(f.calls.filter(row => row[0] === "retry").length, 0);
  } finally { f.dispose(); }
});

test("source replacement uncertainty survives closing and reopening without repeating the upload", async () => {
  const cache = new Map();
  const stopped = { ...session("PAUSED", "paused"), updated_at: "2026-11-10T00:00:00Z",
    sources: [{ artifact_id: "source-one", filename: "Synthetic.json", byte_size: 100, extension: ".json" }] };
  const first = fixture({ cache, resumeImportId: stopped.import_id, initialRead: async () => stopped });
  await first.settle();
  first.setReplace(async () => { throw Error("Unknown response"); });
  find(first.tree(), node => node.type === "input" && node.props.type === "file").props.onChange({
    currentTarget: { files: [{ name: "replacement.json", size: 20 }], value: "synthetic" },
  });
  await first.settle(); first.dispose();
  const next = fixture({ cache, resumeImportId: stopped.import_id, initialRead: async () => stopped });
  try {
    await next.settle();
    assert.match(text(next.tree()), /replacement result is unconfirmed/);
    assert.equal(find(next.tree(), node => node.type === "input" && node.props.type === "file").props.disabled, true);
    assert.equal(find(next.tree(), node => node.type === "button" && text(node) === "Continue analysis").props.disabled, true);
    assert.equal(next.calls.filter(row => ["replace", "resume", "retry"].includes(row[0])).length, 0);
    next.publish({ ...session(), analysis_task_id: "replacement-analysis" });
    await next.settle();
    assert.equal(cache.get(JSON.stringify(["import-source-repair", 1, stopped.import_id])), null);
  } finally { next.dispose(); }
});

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: upload acknowledgement releases files and offers background tasks, not premature import`, async () => {
  const f = fixture({ locale });
  try {
    await f.submitUpload([{ name: "synthetic-a.json", size: 10 }]); await f.settle();
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
    await f.submitUpload([]); await f.settle();
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
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 0);
  } finally { f.dispose(); }
});

for (const state of ["RESOLVING", "READY", "BLOCKED"]) test(`${state}: a queued replacement starts a new query despite a fresh terminal analysis cache`, async () => {
  const f = fixture(), client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } });
  let observer, unsubscribe;
  try {
    await f.submitUpload([]); await f.settle();
    const previous = session(state, "input_recovery");
    const workspace = find(f.publish(previous), node => node.type === "AdaptiveImportWorkspace");
    assert.ok(workspace);
    const oldOptions = f.queries.get("adaptive-import-analysis").options;
    const oldData = { value: previous, generation: 1, analysisTaskId: previous.analysis_task_id };
    client.setQueryData(oldOptions.queryKey, oldData);
    observer = new QueryObserver(client, oldOptions);
    unsubscribe = observer.subscribe(noop);
    assert.equal(observer.getCurrentResult().fetchStatus, "idle");
    assert.equal(oldOptions.refetchInterval({ state: { data: oldData } }), false);

    const replacement = { ...session(), analysis_task_id: "synthetic-replacement" };
    workspace.props.onSession(replacement); await f.settle();
    const options = f.queries.get("adaptive-import-analysis").options;
    assert.notDeepEqual(options.queryKey, oldOptions.queryKey, "task identity is part of the query, not just the import ID");
    assert.equal(options.enabled, true);
    const finished = { ...replacement, state: "READY", phase: "ready", can_import: true };
    f.setRead(async () => finished);
    observer.setOptions(options);
    await f.settle();
    const result = observer.getCurrentResult();
    assert.equal(result.status, "success");
    assert.equal(result.data.value, finished);
    assert.equal(f.calls.filter(row => row[0] === "read").length, 1, "re-enabling naturally fetches; the test never forces refetch");
    assert.deepEqual(client.getQueryData(oldOptions.queryKey), oldData, "old completed cache remains isolated");
    f.publish(result.data.value, result.data.generation, result.data.analysisTaskId);
    assert.equal(find(f.tree(), node => node.type === "AdaptiveImportWorkspace").props.session, finished);
    assert.equal(f.queries.get("adaptive-import-analysis").options.enabled, false);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1, "replacement recovery cannot reupload the batch");
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 0);
  } finally { unsubscribe?.(); observer?.destroy(); client.clear(); f.dispose(); }
});

test("retry of the same failed task re-enables an immediate GET inside the provider freshness window", async () => {
  const f = fixture(), client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } });
  let observer, unsubscribe;
  try {
    await f.submitUpload([]); await f.settle();
    const failed = session("FAILED", "analysis_failed");
    f.publish(failed);
    const oldOptions = f.queries.get("adaptive-import-analysis").options;
    client.setQueryData(oldOptions.queryKey, { value: failed, generation: 1, analysisTaskId: failed.analysis_task_id });
    observer = new QueryObserver(client, oldOptions); unsubscribe = observer.subscribe(noop);
    await f.mutations[4].run(failed.analysis_task_id); await f.settle();
    const options = f.queries.get("adaptive-import-analysis").options;
    assert.deepEqual(options.queryKey, oldOptions.queryKey);
    f.setRead(async () => session());
    observer.setOptions(options); await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "read").length, 1);
    assert.equal(observer.getCurrentResult().data.value.state, "ANALYZING");
    assert.equal(options.refetchInterval({ state: { data: observer.getCurrentResult().data } }), 1500);
    assert.deepEqual(f.calls.filter(row => row[0] === "retry"), [["retry", failed.analysis_task_id]]);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 0);
  } finally { unsubscribe?.(); observer?.destroy(); client.clear(); f.dispose(); }
});

test("late completion of an older analysis cannot overwrite a queued replacement for the same import", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    const oldOptions = f.queries.get("adaptive-import-analysis").options, held = deferred();
    f.setRead(() => held.promise);
    const lateRead = oldOptions.queryFn({ signal: new AbortController().signal });
    const workspace = find(f.publish(session("RESOLVING", "input_recovery")), node => node.type === "AdaptiveImportWorkspace");
    workspace.props.onSession({ ...session(), analysis_task_id: "synthetic-replacement" }); await f.settle();
    held.resolve(session("READY", "ready"));
    const late = await lateRead;
    f.publish(late.value, late.generation, late.analysisTaskId);
    assert.ok(find(f.tree(), node => node.props?.["data-testid"] === "import-analysis-status"));
    assert.equal(find(f.tree(), node => node.type === "AdaptiveImportWorkspace"), undefined);
    assert.equal(f.queries.get("adaptive-import-analysis").options.queryKey[3], "synthetic-replacement");
  } finally { f.dispose(); }
});

test("image-lane resize follows reader preferences and unsubscribes when the import pane closes", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    f.publish(session("READY", "ready"));
    assert.deepEqual(f.calls.filter(row => row[0] === "measure"), [
      ["measure", { readerWidthMode: "standard", sectionTocMode: "visible" }, 720],
    ]);
    assert.match(text(f.tree()), /720px reading column/);
    f.resize(840); await f.settle();
    assert.match(text(f.tree()), /840px reading column/);
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 0);
    f.dispose(); f.resize(960);
    assert.equal(f.calls.filter(row => row[0] === "measure").length, 2);
    assert.equal(f.retiredWrites(), 0);
  } finally { f.dispose(); }
});

test("explicit commit retry preserves its first lane snapshot after an unknown response and resize", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    f.publish(session("READY", "ready"));
    f.setCommit(async () => { throw new Error("Synthetic unknown commit response"); });
    const request = { importId: "synthetic-import", policy: "clone" };
    await assert.rejects(f.mutations[2].run(request), /Synthetic unknown commit response/);
    f.resize(960); await f.settle();
    assert.match(text(f.tree()), /720px reading column/);
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 1, "resize/polling never replays the write");
    f.setStatus(async () => ({ ...completion, status: "previewed" }));
    find(f.tree(), node => node.type === "button" && text(node) === "Check import result").props.onClick();
    await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 1, "A read-only check never sends another commit.");
    f.setCommit(async id => ({ ...completion, import_id: id, status: "queued" }));
    find(f.tree(), node => node.type === "button" && text(node) === "Retry original submission (same options)").props.onClick();
    await f.settle();
    const writes = f.calls.filter(row => row[0] === "commit");
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], ["commit", "synthetic-import", { duplicatePolicy: "clone", projectId: null, imageLaneWidth: 720 }]);
    assert.deepEqual(writes[1], writes[0]);
    assert.equal(f.calls.filter(row => row[0] === "measure").length, 3, "retry reuses the snapshot, not a fresh measurement");
  } finally { f.dispose(); }
});

test("a resumed commit uses its server-owned lane rather than the current viewport", async () => {
  const ready = { ...session("READY", "ready"), analysis_summary: { commit_options: { image_lane_width: 512 } } };
  const f = fixture({ resumeImportId: "synthetic-import", initialRead: async () => ready, laneWidth: 960 });
  try {
    await f.settle();
    assert.match(text(f.tree()), /512px reading column/);
    await f.mutations[2].run({ importId: "synthetic-import", policy: "clone" }); await f.settle();
    assert.deepEqual(f.calls.filter(row => row[0] === "commit"), [
      ["commit", "synthetic-import", { duplicatePolicy: "clone", projectId: null, imageLaneWidth: 512 }],
    ]);
    assert.equal(f.calls.filter(row => row[0] === "measure").length, 1, "server snapshot needs no commit-time measurement");
  } finally { f.dispose(); }
});

test("closing while upload response is in flight cannot publish or implicitly cancel the queued task", async () => {
  const f = fixture(), held = deferred();
  f.setUpload(() => held.promise);
  const pending = f.submitUpload([]);
  f.dispose(); held.resolve(session()); await pending;
  assert.equal(f.retiredWrites(), 0);
  assert.equal(f.calls.filter(row => row[0] === "cancel").length, 0);
  assert.equal(f.storage.size, 0);
});

test("unknown initial upload survives remount, checks read-only then explicitly retries identical identity and File order", async () => {
  const cache = new Map(), files = [new File(["first"], "same.json"), new File(["second"], "same.json")];
  const first = fixture({ cache });
  first.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
  await first.submitUpload(files); await first.settle();
  const requestId = first.uploadOptions[0].requestId;
  assert.equal(first.uploadControl().receipt.phase, "unknown");
  first.dispose();
  const second = fixture({ cache });
  try {
    await second.settle();
    assert.equal(second.uploadControl().locked, true);
    assert.equal(second.calls.filter(row => row[0] === "upload").length, 0);
    await second.uploadControl().check(); await second.settle();
    assert.deepEqual(second.calls.filter(row => row[0] === "uploadReceipt"), [["uploadReceipt", requestId]]);
    assert.equal(second.calls.filter(row => row[0] === "upload").length, 0);
    assert.equal(second.uploadControl().receipt.notFound, true);
    await second.uploadControl().retry(); await second.settle();
    const uploaded = second.calls.find(row => row[0] === "upload")[1];
    assert.equal(uploaded[0], files[0]); assert.equal(uploaded[1], files[1]);
    assert.equal(second.uploadOptions[0].requestId, requestId);
    assert.ok(find(second.tree(), node => node.props?.["data-testid"] === "import-analysis-status"));
  } finally { second.dispose(); }
});

test("two synchronous initial submissions share one upload and one saved operation", async () => {
  const f = fixture(), held = deferred();
  try {
    f.setUpload(() => held.promise);
    const one = f.submitUpload([]), two = f.submitUpload([]);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
    held.resolve(session()); await Promise.all([one, two]); await f.settle();
    assert.equal(f.uploadOptions.length, 1);
  } finally { f.dispose(); }
});

test("a late upload acknowledgement reaches a reopened pane without retaining File objects or replaying POST", async () => {
  const cache = new Map(), held = deferred(), f = fixture({ cache });
  f.setUpload(() => held.promise);
  const pending = f.submitUpload([new File(["synthetic"], "sample.md")]);
  await f.settle(); f.dispose();
  const next = fixture({ cache });
  try {
    await next.settle();
    assert.equal(next.uploadControl().receipt.phase, "uploading");
    held.resolve(session()); await pending;
    assert.equal(cache.get(JSON.stringify(["adaptive-import-upload", 1])).intent, undefined);
    await next.settle();
    assert.ok(find(next.tree(), node => node.props?.["data-testid"] === "import-analysis-status"));
    assert.equal(next.calls.filter(row => row[0] === "upload").length, 0);
    assert.equal(f.retiredWrites(), 0);
  } finally { next.dispose(); }
});

test("late adaptive acknowledgement cannot erase a separate CR archive selection", async () => {
  const cache = new Map(), held = deferred(), first = fixture({ cache });
  first.setUpload(() => held.promise);
  const uploading = first.submitUpload([new File(["synthetic"], "original.md")]);
  await first.settle(); first.dispose();
  const archive = fixture({ cache, initialMode: "archive" });
  try {
    const file = new File(["synthetic archive"], "saved.cr");
    find(archive.tree(), node => node.props?.["data-testid"] === "import-file-input").props.onChange({
      currentTarget: { files: [file], value: "synthetic" },
    });
    await archive.settle();
    held.resolve(session()); await uploading; await archive.settle();
    assert.match(text(find(archive.tree(), node => node.props?.["data-testid"] === "import-selected-files")), /saved\.cr/);
    assert.equal(find(archive.tree(), node => node.props?.["data-testid"] === "preview-import-button").props.disabled, false);
    assert.equal(archive.calls.filter(row => row[0] === "upload" || row[0] === "read").length, 0);
    assert.equal(cache.get(JSON.stringify(["adaptive-import-upload", 1])).phase, "confirmed");
    assert.equal(cache.get(JSON.stringify(["adaptive-import-upload", 1])).intent, undefined);
  } finally { archive.dispose(); }
});

test("known upload receipt with a failed view read cannot enable another upload", async () => {
  const f = fixture();
  try {
    f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
    await f.submitUpload([]); await f.settle();
    f.setReceipt(async () => ({ receipt: { import_id: "synthetic-import", task_id: "synthetic-analysis", status: "queued" } }));
    f.setRead(async () => { throw Error("synthetic view unavailable"); });
    await f.uploadControl().check(); await f.settle();
    assert.equal(f.uploadControl().receipt.phase, "confirmed");
    assert.equal(f.uploadControl().receipt.intent, undefined);
    assert.equal(f.uploadControl().receipt.checkFailed, true);
    await f.uploadControl().retry();
    f.setRead(async () => session());
    await f.uploadControl().check(); await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
    assert.equal(f.calls.filter(row => row[0] === "uploadReceipt").length, 1);
    assert.equal(f.calls.filter(row => row[0] === "read").length, 2);
  } finally { f.dispose(); }
});

test("rejection of a repeated uncertain upload does not erase the first uncertain request", async () => {
  const f = fixture();
  try {
    f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
    await f.submitUpload([]); await f.settle();
    await f.uploadControl().check(); await f.settle();
    f.setUpload(async () => { throw new f.api.ApiRequestError("synthetic limit", 413); });
    await f.uploadControl().retry(); await f.settle();
    assert.equal(f.uploadControl().receipt.phase, "unknown");
    assert.equal(f.uploadControl().locked, true);
    assert.equal(f.uploadControl().receipt.notFound, undefined);
    assert.equal(f.uploadOptions[0].requestId, f.uploadOptions[1].requestId);
  } finally { f.dispose(); }
});

test("stopping local transmission creates uncertainty, not a server cancellation or auto-retry", async () => {
  const f = fixture();
  try {
    f.setUpload(options => new Promise((_resolve, reject) => options.signal.addEventListener("abort",
      () => reject(Error("UPLOAD_STOPPED")), { once: true })));
    const pending = f.submitUpload([]); await f.settle();
    f.uploadControl().receipt.cancel(); await pending; await f.settle();
    assert.equal(f.uploadControl().receipt.phase, "unknown");
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
    assert.equal(f.calls.filter(row => row[0] === "cancel" || row[0] === "stop").length, 0);
  } finally { f.dispose(); }
});

test("authentication change aborts and retires an in-flight upload without refilling the old cache", async () => {
  const cache = new Map(), f = fixture({ cache }), held = deferred();
  try {
    f.setUpload(() => held.promise);
    const pending = f.submitUpload([]); await f.settle();
    f.changeAccount();
    assert.equal(f.uploadOptions[0].signal.aborted, true);
    held.resolve(session()); await pending; await f.settle();
    assert.equal(cache.has(JSON.stringify(["adaptive-import-upload", 1])), false);
    assert.equal(f.uploadControl().receipt, null);
    assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "import-analysis-status"), undefined);
  } finally { f.dispose(); }
});

test("only a first explicit rejection unlocks source adjustment; malformed success stays unconfirmed", async () => {
  for (const malformed of [false, true]) {
    const f = fixture();
    try {
      f.setUpload(async () => { if (malformed) return {}; throw new f.api.ApiRequestError("synthetic limit", 413); });
      await f.submitUpload([]); await f.settle();
      assert.equal(f.uploadControl().receipt.phase, malformed ? "unknown" : "rejected");
      assert.equal(f.uploadControl().locked, malformed);
    } finally { f.dispose(); }
  }
});

async function selectPastedText(f, value) {
  find(f.tree(), node => node.type === "button" && /^(Paste text|粘贴文本)$/.test(text(node))).props.onClick();
  await f.settle();
  find(f.tree(), node => node.props?.["data-testid"] === "pasted-transcript-input").props.onChange({
    currentTarget: { value },
  });
  await f.settle();
}
const pasteInput = f => find(f.tree(), node => node.props?.["data-testid"] === "pasted-transcript-input");
const analyzeInput = f => find(f.tree(), node => node.props?.["data-testid"] === "preview-import-button");

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: rejected pasted input remains editable and an explicit corrected submission uses a new identity`, async () => {
  const f = fixture({ locale });
  const original = "# Synthetic paste\r\n\r\n用户：修改前 & <safe>\r\n";
  const corrected = "# Synthetic correction\n\n用户：修改后\n";
  try {
    f.setUpload(async () => { throw new f.api.ApiRequestError("synthetic limit", 413); });
    await selectPastedText(f, original);
    analyzeInput(f).props.onClick(); await f.settle();
    assert.ok(pasteInput(f), "A rejected paste must not silently become a file-only input.");
    assert.equal(pasteInput(f).props.value, original);
    assert.equal(pasteInput(f).props.readOnly, false);
    assert.equal(f.uploadControl().receipt.phase, "rejected");
    assert.equal(await f.calls.find(row => row[0] === "upload")[1][0].text(), original);
    const requestId = f.uploadOptions[0].requestId;
    pasteInput(f).props.onChange({ currentTarget: { value: corrected } }); await f.settle();
    assert.equal(f.uploadControl().receipt, null, "Editing retires the old explicit rejection, not an unknown write.");
    assert.equal(pasteInput(f).props.value, corrected);
    f.setUpload(async () => session());
    analyzeInput(f).props.onClick(); await f.settle();
    const posts = f.calls.filter(row => row[0] === "upload");
    assert.equal(posts.length, 2);
    assert.notEqual(f.uploadOptions[1].requestId, requestId);
    assert.notEqual(posts[1][1][0], posts[0][1][0]);
    assert.equal(await posts[1][1][0].text(), corrected);
    assert.equal(f.uploadControl(), undefined, "Confirmed upload leaves the source input.");
    assert.ok(find(f.tree(), node => node.props?.["data-testid"] === "import-analysis-status"));
  } finally { f.dispose(); }
});

test("unknown pasted upload restores the exact text read-only after reopening and retries the original File only", async () => {
  const cache = new Map(), original = "# Synthetic paste\n\n用户：不能丢失的输入\n";
  const first = fixture({ cache });
  first.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
  await selectPastedText(first, original);
  analyzeInput(first).props.onClick(); await first.settle();
  const file = first.calls.find(row => row[0] === "upload")[1][0], requestId = first.uploadOptions[0].requestId;
  first.dispose();
  const next = fixture({ cache });
  try {
    await next.settle();
    assert.ok(pasteInput(next), "Reopening an unresolved paste preserves its source type.");
    assert.equal(pasteInput(next).props.value, original);
    assert.equal(pasteInput(next).props.readOnly, true);
    assert.equal(analyzeInput(next).props.disabled, true);
    assert.equal(next.calls.filter(row => row[0] === "upload").length, 0);
    await next.uploadControl().check(); await next.settle();
    assert.equal(pasteInput(next).props.value, original);
    assert.equal(pasteInput(next).props.readOnly, true);
    await next.uploadControl().retry(); await next.settle();
    assert.equal(next.calls.find(row => row[0] === "upload")[1][0], file);
    assert.equal(next.uploadOptions[0].requestId, requestId);
    assert.equal(cache.get(JSON.stringify(["adaptive-import-upload", 1])), null);
    assert.equal(next.calls.filter(row => row[0] === "upload").length, 1);
  } finally { next.dispose(); }
});

test("upload progress does not re-encode retained paste or accept editing while its result is uncertain", async () => {
  const f = fixture(), held = deferred(), original = "# Synthetic paste\n\n".repeat(1024);
  try {
    f.setUpload(() => held.promise);
    await selectPastedText(f, original);
    const edits = f.calls.filter(row => row[0] === "pasteBytes").length;
    analyzeInput(f).props.onClick(); await f.settle();
    assert.equal(pasteInput(f).props.value, original);
    assert.equal(pasteInput(f).props.readOnly, true);
    for (const percent of [10, 25, 50, 100]) {
      f.uploadOptions[0].onProgress({ stage: "uploading", percent }); await f.settle();
    }
    assert.equal(f.calls.filter(row => row[0] === "pasteBytes").length, edits,
      "A progress update must not allocate another UTF-8 copy of the paste.");
    held.reject(Error("CONNECTION_FAILED")); await f.settle();
    const requestId = f.uploadControl().receipt.requestId;
    pasteInput(f).props.onChange({ currentTarget: { value: "synthetic attempted edit while locked" } });
    await f.settle();
    assert.equal(pasteInput(f).props.value, original);
    assert.equal(f.uploadControl().receipt.requestId, requestId);
    assert.equal(f.uploadControl().receipt.intent.pastedText, original);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
  } finally { held.resolve(session()); f.dispose(); }
});

test("parked pasted source reopens without decoding or resending and explicit local release drops its text", async () => {
  const cache = new Map(), f = fixture({ cache }), original = "# Synthetic parked paste\n\n用户：保留\n";
  try {
    f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
    await selectPastedText(f, original);
    analyzeInput(f).props.onClick(); await f.settle();
    const requestId = f.uploadControl().receipt.requestId;
    find(f.tree(), node => node.type === "ImportUploadFeedback").props.leavePending(); await f.settle();
    assert.equal(pasteInput(f), undefined);
    assert.equal(f.uploadControl().retained[0].intent.pastedText, original);
    f.uploadControl().reopen(requestId); await f.settle();
    assert.equal(pasteInput(f).props.value, original);
    assert.equal(pasteInput(f).props.readOnly, true);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
    find(f.tree(), node => node.type === "ImportUploadFeedback").props.endCheck(); await f.settle();
    assert.equal(pasteInput(f), undefined);
    assert.equal(f.uploadControl().receipt, null);
    assert.deepEqual(f.uploadControl().retained, []);
    assert.equal(cache.get(JSON.stringify(["adaptive-import-upload", 1])), null);
    assert.deepEqual(cache.get(JSON.stringify(["adaptive-import-upload-retained", 1])), []);
    assert.equal(f.calls.filter(row => row[0] === "cancel" || row[0] === "stop").length, 0);
  } finally { f.dispose(); }
});

test("a selected file named pasted-transcript is not treated as text pasted through the editor", async () => {
  const f = fixture(), file = new File(["synthetic file only"], "pasted-transcript.md");
  try {
    f.setUpload(async () => { throw new f.api.ApiRequestError("synthetic limit", 413); });
    await f.submitUpload([file]); await f.settle();
    assert.equal(pasteInput(f), undefined);
    assert.equal(f.uploadControl().receipt.intent.pastedText, undefined);
    assert.match(text(find(f.tree(), node => node.props?.["data-testid"] === "import-selected-files")), /pasted-transcript\.md/);
  } finally { f.dispose(); }
});

test("rate-limited or still-pending admission retains original request identity rather than inventing a new upload", async () => {
  for (const [status, code] of [[429, undefined], [409, "IMPORT_UPLOAD_REQUEST_PENDING"]]) {
    const f = fixture();
    try {
      f.setUpload(async () => { throw new f.api.ApiRequestError("synthetic temporary response", status, "", code); });
      await f.submitUpload([]); await f.settle();
      assert.equal(f.uploadControl().receipt.phase, "unknown");
      assert.equal(f.uploadControl().locked, true);
      assert.equal(f.uploadOptions.length, 1);
    } finally { f.dispose(); }
  }
});

test("an unconfirmed initial upload can be retained without blocking another batch and reopened without replay", async () => {
  const f = fixture(), originalFile = new File(["synthetic first"], "first.md");
  try {
    f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
    await f.submitUpload([originalFile]); await f.settle();
    const key = f.uploadControl().receipt.requestId;
    find(f.tree(), node => node.type === "ImportUploadFeedback").props.leavePending();
    await f.settle();
    assert.equal(f.uploadControl().locked, false);
    assert.equal(f.uploadControl().retained.length, 1);
    assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "import-selected-files"), undefined);
    await f.submitUpload([new File(["synthetic second"], "second.md")]); await f.settle();
    assert.notEqual(f.uploadControl().receipt.requestId, key);
    f.uploadControl().reopen(key); await f.settle();
    assert.equal(f.uploadControl().receipt.requestId, key);
    assert.equal(f.uploadControl().receipt.intent.files[0], originalFile);
    assert.equal(f.uploadControl().retained[0].intent.files[0].name, "second.md");
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 2);
    await f.uploadControl().check(); await f.settle();
    assert.deepEqual(f.calls.filter(row => row[0] === "uploadReceipt"), [["uploadReceipt", key]]);
  } finally { f.dispose(); }
});

test("pending retention is bounded but older checks remain reachable by swapping, including at the cap", async () => {
  const f = fixture();
  try {
    f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
    for (let i = 0; i < 3; i++) {
      await f.submitUpload([new File(["synthetic"], `${i}.md`)]); await f.settle();
      assert.equal(f.uploadControl().detach(), true); await f.settle();
    }
    await f.submitUpload([new File(["synthetic"], "current.md")]); await f.settle();
    assert.equal(f.uploadControl().canDetach, false);
    assert.equal(f.uploadControl().detach(), false);
    const key = f.uploadControl().retained[0].requestId;
    f.uploadControl().reopen(key); await f.settle();
    assert.equal(f.uploadControl().receipt.requestId, key);
    assert.equal(f.uploadControl().retained.length, 3);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 4);
    f.changeAccount(); await f.settle();
    assert.equal(f.uploadControl().retained.length, 0);
  } finally { f.dispose(); }
});

test("an unavailable receipt or known missing import ends futile reads, drops File references, and offers local release", async () => {
  for (const missingReceipt of [true, false]) {
    const f = fixture();
    try {
      f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
      await f.submitUpload([new File(["synthetic"], "sample.md")]); await f.settle();
      f.setReceipt(async () => {
        if (missingReceipt) throw new f.api.ApiRequestError("Unavailable", 410, "", "IMPORT_UPLOAD_RECEIPT_UNAVAILABLE");
        return { receipt: { import_id: "synthetic-import" } };
      });
      f.setRead(async () => { throw new f.api.ApiRequestError("Not found", 404); });
      await f.uploadControl().check(); await f.settle();
      assert.equal(f.uploadControl().receipt.phase, "confirmed");
      assert.equal(f.uploadControl().receipt.unavailable, true);
      assert.equal(f.uploadControl().receipt.intent, undefined);
      assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "import-selected-files"), undefined);
      await f.uploadControl().check(); await f.uploadControl().retry(); await f.settle();
      assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
      assert.equal(f.calls.filter(row => row[0] === "uploadReceipt").length, 1);
      assert.equal(f.calls.filter(row => row[0] === "read").length, missingReceipt ? 0 : 1);
      find(f.tree(), node => node.type === "ImportUploadFeedback").props.endCheck(); await f.settle();
      assert.equal(f.uploadControl().locked, false);
      assert.equal(f.calls.filter(row => row[0] === "cancel" || row[0] === "stop").length, 0);
    } finally { f.dispose(); }
  }
});

test("a generic receipt 404 is still uncertain, not evidence of missing server work", async () => {
  const f = fixture(), file = new File(["synthetic"], "sample.md");
  try {
    f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
    await f.submitUpload([file]); await f.settle();
    f.setReceipt(async () => { throw new f.api.ApiRequestError("Not found", 404); });
    await f.uploadControl().check(); await f.settle();
    assert.equal(f.uploadControl().receipt.phase, "unknown");
    assert.equal(f.uploadControl().receipt.intent.files[0], file);
    assert.equal(f.uploadControl().receipt.unavailable, undefined);
    assert.equal(f.uploadControl().receipt.checkFailed, true);
  } finally { f.dispose(); }
});

test("local release cannot clear an in-flight upload, a changed receipt, or a retired account", async () => {
  const f = fixture(), held = deferred(), checkHeld = deferred();
  try {
    f.setUpload(() => held.promise);
    const pending = f.submitUpload([]); await f.settle();
    assert.equal(f.uploadControl().dismiss(f.uploadControl().receipt), false);
    held.reject(Error("CONNECTION_FAILED")); await pending; await f.settle();
    const original = f.uploadControl().receipt;
    f.setReceipt(() => checkHeld.promise);
    const checking = f.uploadControl().check(); await f.settle();
    assert.equal(f.uploadControl().dismiss(original), false);
    assert.equal(f.uploadControl().dismiss(f.uploadControl().receipt), false);
    checkHeld.resolve({ receipt: null }); await checking; await f.settle();
    assert.equal(f.uploadControl().dismiss(original), false);
    const fresh = f.uploadControl().receipt, oldControl = f.uploadControl();
    f.changeAccount();
    assert.equal(oldControl.dismiss(fresh), false);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 1);
    assert.equal(f.calls.filter(row => row[0] === "cancel" || row[0] === "stop").length, 0);
  } finally { f.dispose(); }
});

test("explicit local release frees only the current pending selection, preserving parked checks", async () => {
  const f = fixture();
  try {
    f.setUpload(async () => { throw Error("CONNECTION_FAILED"); });
    await f.submitUpload([new File(["synthetic"], "parked.md")]); await f.settle();
    const parkedId = f.uploadControl().receipt.requestId;
    f.uploadControl().detach(); await f.settle();
    await f.submitUpload([new File(["synthetic"], "current.md")]); await f.settle();
    const stale = find(f.tree(), node => node.type === "ImportUploadFeedback").props.endCheck;
    stale(); await f.settle();
    assert.equal(f.uploadControl().receipt, null);
    assert.equal(f.uploadControl().retained[0].requestId, parkedId);
    assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "import-selected-files"), undefined);
    f.uploadControl().reopen(parkedId); await f.settle();
    stale(); await f.settle();
    assert.equal(f.uploadControl().receipt.requestId, parkedId);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 2);
  } finally { f.dispose(); }
});

test("old-account analysis reads cannot publish a workspace or result", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle(); f.changeAccount();
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
    await f.mutations[4].run("synthetic-analysis"); await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 0);
    assert.deepEqual(f.calls.find(row => row[0] === "retry"), ["retry", "synthetic-analysis"]);
    assert.equal(f.queries.get("adaptive-import-analysis").options.enabled, true);
    assert.equal(f.storage.get("chat-reader:adaptive-import-session"), "synthetic-import");
  } finally { f.dispose(); }
});

test("canonical commit failure is not mislabelled as initial analysis failure", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    const tree = f.publish(session("FAILED", "failed"));
    assert.ok(find(tree, node => node.type === "AdaptiveImportWorkspace"));
    assert.doesNotMatch(text(tree), /Initial analysis failed/);
  } finally { f.dispose(); }
});

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: reopening a memory failure offers original-task retry without reupload or corruption claims`, async () => {
  const failed = { ...session("FAILED", "analysis_failed"), failure: {
    code: "UPLOAD_MEMORY_PRESSURE", stage: "admission", retryable: true,
  }, error_message: "/private/synthetic-source" };
  const f = fixture({ locale, resumeImportId: "synthetic-import", initialRead: async () => failed });
  try {
    await f.settle();
    assert.match(text(f.tree()), locale === "zh-CN" ? /可用内存不足/ : /not enough available memory/);
    assert.match(text(f.tree()), locale === "zh-CN" ? /无需重新上传/ : /without uploading again/);
    assert.doesNotMatch(text(f.tree()), /private|文件损坏|damaged|自动重试|will retry automatically/);
    const retry = find(f.tree(), node => node.type === "button" && /^(重试分析|Retry analysis)$/.test(text(node)));
    assert.ok(retry);
    retry.props.onClick(); await f.settle();
    assert.deepEqual(f.calls.filter(row => row[0] === "retry"), [["retry", "synthetic-analysis"]]);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 0);
    assert.equal(f.storage.get("chat-reader:adaptive-import-session"), "synthetic-import");
  } finally { f.dispose(); }
});

test("explicit confirmed disposal resets this pane; closing/unmounting alone does not", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    await f.mutations[0].run("synthetic-import"); await f.settle();
    assert.deepEqual(f.calls.find(row => row[0] === "cancel"), ["cancel", "synthetic-import"]);
    assert.equal(f.storage.size, 0);
    assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "import-analysis-status"), undefined);
  } finally { f.dispose(); }
});

test("ordinary new import does not auto-resume a saved cancelling task", async () => {
  const f = fixture({ storedId: "old-cancelling", initialRead: async () => session("CANCELING") });
  try {
    await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "read").length, 0);
    assert.ok(find(f.tree(), node => node.props?.["data-testid"] === "preview-import-button"));
    const resume = find(f.tree(), node => node.type === "button" && text(node) === "View the last retained import");
    assert.ok(resume);
    resume.props.onClick(); await f.settle();
    assert.equal(f.calls.find(row => row[0] === "read")[1], "old-cancelling");
  } finally { f.dispose(); }
});

test("stopping retains sources and waits for acknowledgement before offering explicit resume", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    find(f.tree(), node => node.type === "button" && text(node) === "Stop and retain").props.onClick();
    await f.settle();
    assert.deepEqual(f.calls.find(row => row[0] === "stop").slice(0, 3), ["stop", "synthetic-analysis", "retain"]);
    assert.match(text(f.tree()), /Stopping import analysis/);
    assert.equal(f.calls.filter(row => row[0] === "cancel").length, 0);
    assert.equal(f.storage.get("chat-reader:adaptive-import-session"), "synthetic-import");
    assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Continue analysis"), undefined);
    f.publish({ ...session("PAUSED", "paused"), source_status: "available", updated_at: "2026-11-10T00:00:00Z" });
    const resume = find(f.tree(), node => node.type === "button" && text(node) === "Continue analysis");
    assert.ok(resume);
    assert.equal(f.calls.filter(row => row[0] === "resume").length, 0);
    resume.props.onClick(); await f.settle();
    assert.deepEqual(f.calls.find(row => row[0] === "resume"), ["resume", "synthetic-import", "2026-11-10T00:00:00Z"]);
    assert.equal(f.calls.filter(row => row[0] === "commit").length, 0);
  } finally { f.dispose(); }
});

test("an unknown stop has a read-only check and leaving does not let its late response reclaim the new pane", async () => {
  const held = deferred(), f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    f.setStop(() => held.promise);
    find(f.tree(), node => node.type === "button" && text(node) === "Stop and retain").props.onClick();
    await f.settle();
    find(f.tree(), node => node.type === "button" && text(node) === "Back to file selection").props.onClick();
    await f.settle();
    held.resolve({ job_id: "synthetic-analysis", status: "cancelled" }); await f.settle();
    assert.equal(find(f.tree(), node => node.props?.["data-testid"] === "import-analysis-status"), undefined);
    assert.ok(find(f.tree(), node => node.props?.["data-testid"] === "preview-import-button"));
    assert.equal(f.calls.filter(row => row[0] === "cancel").length, 0);
  } finally { held.resolve({ status: "cancelled" }); f.dispose(); }
});

test("stop transport uncertainty never enables an automatic repeated write", async () => {
  const f = fixture();
  try {
    await f.submitUpload([]); await f.settle();
    f.setStop(async () => { throw Error("REQUEST_TIMEOUT"); });
    find(f.tree(), node => node.type === "button" && text(node) === "Stop and retain").props.onClick();
    await f.settle();
    assert.match(text(f.tree()), /Check the original task/);
    assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Stop and retain").props.disabled, true);
    find(f.tree(), node => node.type === "button" && text(node) === "Check status").props.onClick();
    await f.settle();
    assert.equal(f.calls.filter(row => row[0] === "stop").length, 1);
    assert.ok(f.calls.some(row => row[0] === "read"));
  } finally { f.dispose(); }
});

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: durable resource waiting is not failure or fake completion`, async () => {
  const waiting = { ...session("ANALYZING", "waiting_resources"), resource_wait: {
    reason: "UPLOAD_MEMORY_PRESSURE", next_retry_at: "2026-11-08T00:00:15Z", remaining_seconds: 1785,
  } };
  const f = fixture({ locale, resumeImportId: "synthetic-import", initialRead: async () => waiting });
  try {
    await f.settle();
    assert.match(text(f.tree()), locale === "zh-CN" ? /等待.*资源/ : /Waiting for.*resources/i);
    assert.doesNotMatch(text(f.tree()), /Initial analysis failed|首轮分析失败|100%|damaged|文件损坏/);
    assert.equal(f.queries.get("adaptive-import-analysis").options.enabled, true);
    assert.equal(f.calls.filter(row => ["upload", "retry", "cancel"].includes(row[0])).length, 0);
  } finally { f.dispose(); }
});

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: exhausted resource wait requires explicit original-job continuation`, async () => {
  const paused = { ...session("FAILED", "analysis_failed"), error_message: "IMPORT_RESOURCE_WAIT_EXPIRED",
    failure: { code: "IMPORT_RESOURCE_WAIT_EXPIRED", stage: "analysis", retryable: true } };
  const f = fixture({ locale, resumeImportId: "synthetic-import", initialRead: async () => paused });
  try {
    await f.settle();
    assert.match(text(f.tree()), /30/);
    assert.match(text(f.tree()), locale === "zh-CN" ? /暂停/ : /paused/);
    assert.equal(f.calls.filter(row => row[0] === "retry").length, 0);
    await f.mutations[4].run("synthetic-analysis"); await f.settle();
    assert.deepEqual(f.calls.filter(row => row[0] === "retry"), [["retry", "synthetic-analysis"]]);
    assert.equal(f.calls.filter(row => row[0] === "upload").length, 0);
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

test("acknowledged background work can detach, but unsaved mapping still needs confirmation", async () => {
  const f = dialogFixture();
  try {
    await f.open("first-import");
    f.panel().props.onMappingStateChange({ dirty: false, busy: true, background: true }); f.render();
    await f.open("second-import");
    assert.equal(f.panel().props.resumeImportId, "second-import");
    f.panel().props.onMappingStateChange({ dirty: true, busy: true, background: true }); f.render();
    f.setAnswer(async () => false); await f.open("third-import");
    assert.equal(f.panel().props.resumeImportId, "second-import");
    assert.equal(f.prompts.length, 1);
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
