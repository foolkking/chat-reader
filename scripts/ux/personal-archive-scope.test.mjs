import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const { QueryClient, QueryObserver, InfiniteQueryObserver } = require("@tanstack/react-query");
const noop = () => {};
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const compiled = compile("../../apps/web/components/personal-backup-panel.tsx");
function pureModule(path) {
  const module = { exports: {} };
  new Function("require", "exports", compile(path))(require, module.exports);
  return module.exports;
}
const archiveState = pureModule("../../apps/web/lib/archive-task-state.ts");
const archiveRecovery = pureModule("../../apps/web/lib/archive-recovery.ts");
const archiveUi = pureModule("../../apps/web/components/archive-ui.tsx");
const task = (kind = "export", status = "queued", extra = {}) => ({
  job_id: `synthetic-${kind}`, job_type: `personal_archive_${kind}`, status, phase: "", progress: 0,
  queued_at: "2026-10-14T00:00:00Z", started_at: null, heartbeat_at: null, completed_at: null,
  cancellable: ["queued", "processing"].includes(status), result: {}, ...extra,
});
const preview = () => task("preflight", "committed", { result: {
  content_digest: "synthetic-digest", artifact_available: true, expires_at: "2099-01-01T00:00:00Z",
} });
const textOf = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(textOf).join("") : textOf(node.props?.children);
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  return predicate(node) ? node : find(node.props?.children, predicate);
}

// Real transpiled panel, archive helpers and installed query cache/observers.
// Hooks, DOM, confirmation, transport and frame scheduling are controlled
// doubles: these are not browser lifecycle or backend acceptance tests.
function fixture({ selected, locale = "en-US", caps = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity } } });
  const limit = { maximum_upload_bytes: 1024 * 1024, upload_lifetime_hours: 24 };
  if (caps) client.setQueryData(["personal-archive-capabilities"], limit);
  client.setQueryData(["personal-archive-tasks"], { pages: [selected ? [selected] : []], pageParams: [undefined] });
  if (selected) client.setQueryData(["task", selected.job_id], selected);
  const hooks = [], effects = new Map(), observers = new Map(), frames = [], writes = [], invalidations = [];
  const releases = [], confirmations = [], uploads = [], dirty = [];
  let cursor = 0, tree, generation = 1, disposed = false, writesAfterDispose = 0, capabilityReads = 0;
  let confirmWork = async () => true, capabilityWork = async () => limit;
  const work = new Map();
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = options => { invalidations.push(options.queryKey); return invalidate(options); };
  const hook = init => { const index = cursor++; return hooks[index] ??= init(); };
  const schedule = (fn, deps) => {
    const index = cursor, h = hook(() => ({}));
    if (!same(h.deps, deps)) { h.deps = deps; effects.set(index, fn); }
  };
  const react = { ...React,
    useCallback: (fn, deps) => {
      const h = hook(() => ({}));
      if (!same(h.deps, deps)) Object.assign(h, { value: fn, deps });
      return h.value;
    },
    useRef: init => hook(() => ({ current: init })),
    useState: init => {
      const h = hook(() => ({ value: typeof init === "function" ? init() : init }));
      return [h.value, next => { if (disposed) writesAfterDispose++; h.value = typeof next === "function" ? next(h.value) : next; }];
    },
    useEffect: schedule, useLayoutEffect: schedule,
  };
  const request = (kind, args) => { writes.push({ kind, args }); return (work.get(kind) ?? (async () => task()))(...args); };
  const api = {
    getPersonalArchiveCapabilities: () => { capabilityReads++; return capabilityWork(); },
    getPersonalArchiveTasks: async () => selected ? [selected] : [],
    getTask: async () => selected,
    queuePersonalArchiveExport: (...args) => request("backup", args),
    confirmPersonalArchiveRestore: (...args) => request("restore", args),
    retryTask: (...args) => request("retry", args),
    cancelTask: (...args) => request("cancel", args),
    discardPersonalArchiveUpload: (...args) => request("discard", args),
    uploadPersonalArchive: (...args) => {
      const entry = { args, cancelled: false, promise: request("upload", args), cancel() { this.cancelled = true; } };
      uploads.push(entry); return entry;
    },
  };
  const queryHook = (options, infinite = false) => {
    const key = JSON.stringify(options.queryKey);
    if (!observers.has(key)) {
      const Observer = infinite ? InfiniteQueryObserver : QueryObserver;
      const observer = new Observer(client, { ...options, enabled: false });
      const stop = observer.subscribe(noop); observers.set(key, { observer, stop });
    }
    return observers.get(key).observer.getCurrentResult();
  };
  const mocks = {
    react,
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: options => queryHook(options),
      useInfiniteQuery: options => queryHook(options, true) },
    "../lib/api": api,
    "../lib/offline-access": { authenticationGeneration: () => generation },
    "../lib/archive-task-state": archiveState, "../lib/archive-recovery": archiveRecovery,
    "./archive-ui": archiveUi,
    "./preferences-provider": { usePreferences: () => ({ resolvedLocale: locale, retryPreferenceSync: noop }) },
    "./interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: options => {
      confirmations.push(options); return confirmWork();
    } }) },
    "../lib/export-usage": { releaseExportScope: scope => releases.push(scope) },
    "../features/exporting/export-artifact-delivery": { ExportArtifactDelivery: "ExportArtifactDelivery" },
  };
  const listeners = new Map();
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const navigator = { onLine: true }, document = { body: {}, activeElement: null }, module = { exports: {} };
  new Function("require", "exports", "window", "navigator", "document", "requestAnimationFrame", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw Error(`Unexpected dependency ${name}`);
    return require(name);
  }, module.exports, window, navigator, document, fn => frames.push(fn));
  const render = () => {
    cursor = 0;
    return tree = module.exports.DataBackupPanel({ focused: true, initialTaskId: selected?.job_id, onDirtyChange: value => dirty.push(value) });
  };
  const flush = () => { for (const [index, fn] of effects) { hooks[index].cleanup?.(); hooks[index].cleanup = fn(); } effects.clear(); };
  const button = label => {
    const node = find(tree, node => node.type === "button" && textOf(node) === label);
    assert.ok(node, `Missing button: ${label}`); return node;
  };
  const changeFile = file => {
    const input = find(tree, node => node.type === "input" && node.props.type === "file");
    assert.ok(input, "Missing archive file input"); input.props.onChange({ target: { files: file ? [file] : [] } });
  };
  render(); flush();
  return { client, document, writes, invalidations, frames, releases, confirmations, uploads, dirty, render, flush, button, changeFile,
    setWork: (kind, fn) => work.set(kind, fn), setConfirm: fn => { confirmWork = fn; },
    setCapabilityWork: fn => { capabilityWork = fn; }, changeAccount: () => { generation++; },
    offline() { navigator.onLine = false; listeners.get("offline")(); render(); flush(); },
    async failCapabilities() {
      capabilityWork = async () => { throw Error("Synthetic capability failure"); };
      await observers.get(JSON.stringify(["personal-archive-capabilities"])).observer.refetch(); render(); flush();
    },
    async settle() { await setImmediate(); render(); flush(); return render(); },
    capabilityReads: () => capabilityReads,
    unmount() { disposed = true; for (const h of hooks) h.cleanup?.(); effects.clear(); },
    dispose() { if (!disposed) this.unmount(); for (const { observer, stop } of observers.values()) { stop(); observer.destroy(); } client.clear(); },
    writesAfterDispose: () => writesAfterDispose,
  };
}

for (const retired of ["unmount", "account"]) test(`late backup acknowledgement cannot publish after ${retired}`, async () => {
  const f = fixture(), response = deferred();
  try {
    f.setWork("backup", () => response.promise); f.button("Create personal archive (.cr)").props.onClick();
    if (retired === "unmount") f.unmount(); else f.changeAccount();
    f.client.clear(); response.resolve(task()); await setImmediate();
    assert.equal(f.client.getQueryData(["task", "synthetic-export"]), undefined);
    assert.equal(f.invalidations.length + f.frames.length + f.releases.length, 0);
    if (retired === "unmount") assert.equal(f.writesAfterDispose(), 0);
  } finally { f.dispose(); }
});

for (const kind of ["restore", "retry", "cancel"]) test(`late ${kind} acknowledgement cannot refill a retired task cache`, async () => {
  const selected = kind === "restore" ? preview() : task("export", kind === "retry" ? "failed" : "processing");
  const f = fixture({ selected }), response = deferred();
  try {
    f.setWork(kind, () => response.promise);
    f.button({ restore: "Restore these materials", retry: "Retry task", cancel: "Cancel task" }[kind]).props.onClick();
    f.unmount(); f.client.clear(); response.resolve(task(kind === "restore" ? "restore" : "export")); await setImmediate();
    assert.equal(f.client.getQueryCache().getAll().length, 0);
    assert.equal(f.invalidations.length + f.frames.length + f.releases.length, 0);
    assert.equal(f.writesAfterDispose(), 0);
  } finally { f.dispose(); }
});

test("a pending remove-upload confirmation cannot submit after the panel closes", async () => {
  const f = fixture({ selected: preview() }), confirmation = deferred();
  try {
    f.setConfirm(() => confirmation.promise); f.button("Remove uploaded file").props.onClick();
    f.unmount(); confirmation.resolve(true); await setImmediate();
    assert.equal(f.writes.length, 0); assert.equal(f.writesAfterDispose(), 0);
  } finally { f.dispose(); }
});

test("a retired mode-change confirmation cannot alter the panel", async () => {
  const f = fixture();
  try {
    f.button("Restore archive").props.onClick(); await f.settle();
    f.changeFile({ name: "synthetic.cr", size: 42 }); f.render(); f.flush();
    const confirmation = deferred(); f.setConfirm(() => confirmation.promise);
    const before = f.releases.length;
    f.button("Back up my data").props.onClick(); f.unmount(); confirmation.resolve(true); await setImmediate();
    assert.equal(f.releases.length, before); assert.equal(f.writesAfterDispose(), 0);
  } finally { f.dispose(); }
});

test("an upload acknowledgement also belongs to its original authentication generation", async () => {
  const f = fixture(), response = deferred();
  try {
    f.button("Restore archive").props.onClick(); await f.settle();
    f.changeFile({ name: "synthetic.cr", size: 42 }); f.render(); f.flush();
    f.setWork("upload", () => response.promise); f.button("Upload & preview").props.onClick();
    f.changeAccount(); f.client.clear(); const before = f.releases.length;
    response.resolve(preview()); await setImmediate();
    assert.equal(f.client.getQueryCache().getAll().length, 0); assert.equal(f.invalidations.length + f.frames.length, 0);
    assert.equal(f.releases.length, before);
  } finally { f.dispose(); }
});

for (const locale of ["en-US", "zh-CN"]) test(`${locale}: failed upload-limit reads do not claim to be loading`, async () => {
  const f = fixture({ caps: false, locale });
  try {
    f.button(locale === "en-US" ? "Restore archive" : "恢复归档").props.onClick(); await f.settle(); await f.failCapabilities();
    const copy = textOf(f.render());
    assert.doesNotMatch(copy, /Loading upload limits|正在读取上传限制/);
    assert.match(copy, locale === "en-US" ? /Unable to load upload limits/ : /无法读取上传限制/);
    assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("an acknowledged backup still publishes immediately in its live panel", async () => {
  const f = fixture();
  try {
    f.button("Create personal archive (.cr)").props.onClick(); await f.settle();
    assert.equal(f.client.getQueryData(["task", "synthetic-export"]).status, "queued");
    assert.equal(f.writes.length, 1); assert.equal(f.frames.length, 1); assert.equal(f.invalidations.length, 3);
    assert.equal(f.button("Back to options").props.disabled, false);
  } finally { f.dispose(); }
});

for (const retired of ["unmount", "account"]) test(`a late failure after ${retired} cannot publish feedback or refresh`, async () => {
  const f = fixture(), response = deferred();
  try {
    f.setWork("backup", () => response.promise); f.button("Create personal archive (.cr)").props.onClick();
    if (retired === "unmount") f.unmount(); else f.changeAccount();
    response.reject(Error("Synthetic retired failure")); await setImmediate();
    assert.equal(f.invalidations.length, 0); assert.equal(f.writesAfterDispose(), 0);
    if (retired === "account") assert.doesNotMatch(textOf(f.render()), /Synthetic retired failure/);
  } finally { f.dispose(); }
});

test("a frame queued by a valid acknowledgement cannot steal focus after its owner retires", async () => {
  const f = fixture();
  try {
    f.button("Create personal archive (.cr)").props.onClick(); await f.settle();
    let focused = 0;
    find(f.render(), node => node.type === "h3" && node.props.ref).props.ref.current = {
      focus: () => { focused++; }, scrollIntoView: () => { focused++; },
    };
    f.changeAccount(); for (const frame of f.frames) frame();
    assert.equal(focused, 0);
  } finally { f.dispose(); }
});

test("two captured backup activations reserve only one in-flight request", async () => {
  const f = fixture(), response = deferred();
  try {
    f.setWork("backup", () => response.promise);
    const activate = f.button("Create personal archive (.cr)").props.onClick;
    activate(); activate(); assert.equal(f.writes.length, 1);
    response.resolve(task()); await f.settle();
    assert.equal(f.button("Back to options").props.disabled, false);
  } finally { f.dispose(); }
});

test("a failed backup retains the original key for an explicit same-options retry", async () => {
  const f = fixture();
  try {
    f.setWork("backup", async () => { throw Error("Synthetic uncertain response"); });
    f.button("Create personal archive (.cr)").props.onClick(); await f.settle();
    f.setWork("backup", async () => task()); f.button("Create personal archive (.cr)").props.onClick(); await f.settle();
    assert.equal(f.writes.length, 2); assert.ok(f.writes[0].args[1]);
    assert.equal(f.writes[1].args[1], f.writes[0].args[1]);
    assert.equal(f.writes[1].args[0], true);
  } finally { f.dispose(); }
});

test("changing backup options after failure deliberately starts a different request key", async () => {
  const f = fixture();
  try {
    f.setWork("backup", async () => { throw Error("Synthetic uncertain response"); });
    f.button("Create personal archive (.cr)").props.onClick(); await f.settle();
    find(f.render(), node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: false } });
    f.render(); f.setWork("backup", async () => task()); f.button("Create personal archive (.cr)").props.onClick(); await f.settle();
    assert.notEqual(f.writes[1].args[1], f.writes[0].args[1]); assert.equal(f.writes[1].args[0], false);
  } finally { f.dispose(); }
});

test("a failed upload retains its File and idempotency key until explicit retry", async () => {
  const f = fixture(), file = { name: "synthetic.cr", size: 42 };
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); f.changeFile(file); f.render();
    f.setWork("upload", async () => { throw Error("Archive upload interrupted. Reconnect and retry."); });
    f.button("Upload & preview").props.onClick(); await f.settle();
    assert.equal(f.writes.length, 1); assert.equal(f.button("Upload & preview").props.disabled, false);
    f.setWork("upload", async () => preview()); f.button("Upload & preview").props.onClick(); await f.settle();
    assert.equal(f.writes.length, 2); assert.equal(f.writes[0].args[0], file); assert.equal(f.writes[1].args[0], file);
    assert.equal(f.writes[1].args[1], f.writes[0].args[1]); assert.ok(f.writes[0].args[1]);
    assert.ok(f.button("Restore these materials"));
  } finally { f.dispose(); }
});

test("an upload cancelled on unmount cannot publish subsequent progress", async () => {
  const f = fixture(), response = deferred();
  try {
    f.button("Restore archive").props.onClick(); await f.settle();
    f.changeFile({ name: "synthetic.cr", size: 42 }); f.render(); f.setWork("upload", () => response.promise);
    f.button("Upload & preview").props.onClick(); f.unmount();
    assert.equal(f.uploads[0].cancelled, true); f.uploads[0].args[2](60);
    response.reject(new DOMException("Upload cancelled.", "AbortError")); await setImmediate();
    assert.equal(f.writesAfterDispose(), 0);
  } finally { f.dispose(); }
});

test("the user's explicit upload cancellation remains neutral and retains the file", async () => {
  const f = fixture(), response = deferred();
  try {
    f.button("Restore archive").props.onClick(); await f.settle();
    f.changeFile({ name: "synthetic.cr", size: 42 }); f.render(); f.setWork("upload", () => response.promise);
    f.button("Upload & preview").props.onClick(); f.render(); f.button("Cancel upload").props.onClick();
    response.reject(new DOMException("Upload cancelled.", "AbortError")); await f.settle();
    assert.match(textOf(f.render()), /Upload stopped; your file selection is retained/);
    assert.equal(f.button("Upload & preview").props.disabled, false); assert.equal(f.writes.length, 1);
  } finally { f.dispose(); }
});

test("the known size limit prevents an upload without discarding the chosen file", async () => {
  const f = fixture();
  try {
    f.button("Restore archive").props.onClick(); await f.settle();
    f.changeFile({ name: "synthetic-too-large.cr", size: 2 * 1024 * 1024 }); f.render();
    f.button("Upload & preview").props.onClick(); await f.settle();
    assert.equal(f.writes.length, 0); assert.match(textOf(f.render()), /exceeds the 1.0 MB upload limit/);
    assert.equal(f.button("Upload & preview").props.disabled, false);
  } finally { f.dispose(); }
});

test("declining removal leaves the preview and server untouched", async () => {
  const f = fixture({ selected: preview() });
  try {
    f.setConfirm(async () => false); f.button("Remove uploaded file").props.onClick(); await f.settle();
    assert.equal(f.writes.length, 0); assert.ok(f.button("Restore these materials"));
  } finally { f.dispose(); }
});

test("two removal activations share one confirmation, with no premature DELETE", async () => {
  const f = fixture({ selected: preview() }), confirmation = deferred();
  try {
    f.setConfirm(() => confirmation.promise); const activate = f.button("Remove uploaded file").props.onClick;
    activate(); activate(); assert.equal(f.confirmations.length, 1); assert.equal(f.writes.length, 0);
    confirmation.resolve(true); await f.settle(); assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].kind, "discard");
  } finally { f.dispose(); }
});

test("an accepted removal confirmation cannot cross an authentication generation", async () => {
  const f = fixture({ selected: preview() }), confirmation = deferred();
  try {
    f.setConfirm(() => confirmation.promise); f.button("Remove uploaded file").props.onClick(); f.changeAccount();
    confirmation.resolve(true); await setImmediate(); assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("declining a mode change preserves the selected File without submitting it", async () => {
  const f = fixture(), file = { name: "synthetic.cr", size: 42 };
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); f.changeFile(file); f.render();
    f.setConfirm(async () => false); f.button("Back up my data").props.onClick(); await f.settle();
    f.setWork("upload", async () => preview()); f.button("Upload & preview").props.onClick(); await f.settle();
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].args[0], file);
  } finally { f.dispose(); }
});

test("a failed upload-limit read retries only the metadata and retains the selected File", async () => {
  const f = fixture({ caps: false }), file = { name: "synthetic.cr", size: 42 }, response = deferred();
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); f.changeFile(file); f.render(); await f.failCapabilities();
    assert.equal(f.button("Upload & preview").props.disabled, true);
    f.setCapabilityWork(() => response.promise); f.button("Retry loading upload limits").props.onClick(); f.render();
    assert.equal(f.button("Retry loading upload limits").props.disabled, true);
    assert.match(textOf(f.render()), /Loading upload limits/);
    response.resolve({ maximum_upload_bytes: 1024 * 1024, upload_lifetime_hours: 24 }); await f.settle();
    assert.equal(f.capabilityReads(), 2); assert.equal(f.writes.length, 0);
    assert.equal(f.button("Upload & preview").props.disabled, false);
    f.setWork("upload", async () => preview()); f.button("Upload & preview").props.onClick(); await f.settle();
    assert.equal(f.writes[0].args[0], file);
  } finally { f.dispose(); }
});

test("offline limit recovery is paused, not mislabeled as a running read", async () => {
  const f = fixture({ caps: false });
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); await f.failCapabilities(); f.offline();
    assert.match(textOf(f.render()), /Reconnect to load upload limits/);
    assert.doesNotMatch(textOf(f.render()), /Loading upload limits/);
    assert.equal(f.button("Retry loading upload limits").props.disabled, true); assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("a cached upload limit remains usable after a failed refresh", async () => {
  const f = fixture();
  try {
    f.button("Restore archive").props.onClick(); await f.settle();
    f.changeFile({ name: "synthetic.cr", size: 42 }); f.render(); await f.failCapabilities();
    assert.match(textOf(f.render()), /Upload limit 1.0 MB/); assert.doesNotMatch(textOf(f.render()), /Loading upload limits/);
    assert.equal(f.button("Upload & preview").props.disabled, false); assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

for (const focus of ["retry", "body", "chosen"]) test(`successful limit recovery respects ${focus} focus`, async () => {
  const f = fixture({ caps: false }), response = deferred();
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); await f.failCapabilities();
    const retry = f.button("Retry loading upload limits"), control = {}, chosen = {}, options = [];
    const input = find(f.render(), node => node.type === "input" && node.props.type === "file");
    const fileControl = { focus: value => { options.push(value); f.document.activeElement = fileControl; } };
    input.props.ref.current = fileControl; retry.props.ref.current = control; f.document.activeElement = control;
    f.setCapabilityWork(() => response.promise); retry.props.onClick(); f.render();
    if (focus === "body") f.document.activeElement = f.document.body;
    if (focus === "chosen") f.document.activeElement = chosen;
    response.resolve({ maximum_upload_bytes: 1024 * 1024, upload_lifetime_hours: 24 }); await f.settle();
    assert.equal(f.document.activeElement, focus === "chosen" ? chosen : fileControl);
    assert.deepEqual(options, focus === "chosen" ? [] : [{ preventScroll: true }]);
  } finally { f.dispose(); }
});

test("a captured metadata retry cannot start duplicate reads before render", async () => {
  const f = fixture({ caps: false }), response = deferred();
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); await f.failCapabilities();
    f.setCapabilityWork(() => response.promise);
    const retry = f.button("Retry loading upload limits").props.onClick;
    retry(); retry(); assert.equal(f.capabilityReads(), 2);
    response.resolve({ maximum_upload_bytes: 1024 * 1024, upload_lifetime_hours: 24 }); await f.settle();
    assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("a retired metadata retry cannot start a new request", async () => {
  const f = fixture({ caps: false });
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); await f.failCapabilities();
    const retry = f.button("Retry loading upload limits").props.onClick;
    f.changeAccount(); retry(); await setImmediate();
    assert.equal(f.capabilityReads(), 1); assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("a metadata retry settling after unmount cannot update feedback or focus", async () => {
  const f = fixture({ caps: false }), response = deferred();
  try {
    f.button("Restore archive").props.onClick(); await f.settle(); await f.failCapabilities();
    f.setCapabilityWork(() => response.promise); f.button("Retry loading upload limits").props.onClick();
    f.unmount(); response.resolve({ maximum_upload_bytes: 1024 * 1024, upload_lifetime_hours: 24 }); await setImmediate();
    assert.equal(f.writesAfterDispose(), 0); assert.equal(f.frames.length, 0);
  } finally { f.dispose(); }
});

test("an acknowledged remove-upload result cannot change an already closed panel", async () => {
  const f = fixture({ selected: preview() }), response = deferred();
  try {
    f.setWork("discard", () => response.promise); f.button("Remove uploaded file").props.onClick(); await f.settle();
    assert.equal(f.writes.length, 1); f.unmount(); response.resolve(); await setImmediate();
    assert.equal(f.writesAfterDispose(), 0); assert.equal(f.invalidations.length, 0);
  } finally { f.dispose(); }
});

test("old controls cannot start mutations after their panel closes", async () => {
  const f = fixture();
  try {
    const backup = f.button("Create personal archive (.cr)").props.onClick;
    f.unmount(); backup(); await setImmediate(); assert.equal(f.writes.length, 0); assert.equal(f.writesAfterDispose(), 0);
  } finally { f.dispose(); }
});
