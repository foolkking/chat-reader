import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = appRequire("react"), ts = appRequire("typescript"), noop = () => {};
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const note = title => ({ id: "synthetic-note", conversation_id: "synthetic-a", title, blocks: [], revision: 1 });
const annotation = id => ({ id, conversation_id: "synthetic-a", message_id: "synthetic-message", annotation_type: "highlight", comment_markdown: "" });
class ApiRequestError extends Error { constructor(status) { super("Synthetic private detail"); this.status = status; } }
class OfflineAccessError extends Error {}

// Real compiled hook/components. React scheduling, repository, storage and DOM
// are explicit doubles; these tests do not measure rendered layout or memory.
function runtime(extra = {}, desktop = false, observeWorkspace) {
  let cursor = 0, generation = 1;
  const hooks = [], pending = new Map(), modules = new Map(), events = new EventTarget();
  const hook = init => { const index = cursor++; if (!hooks[index]) hooks[index] = init(); return hooks[index]; };
  const memo = (make, deps) => { const entry = hook(() => ({})); if (!same(entry.deps, deps)) Object.assign(entry, { value: make(), deps }); return entry.value; };
  const react = { ...React,
    useState: init => { const entry = hook(() => ({ value: typeof init === "function" ? init() : init }));
      return [entry.value, value => { entry.value = typeof value === "function" ? value(entry.value) : value; }]; },
    useRef: init => hook(() => ({ current: init })), useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => { const index = cursor, entry = hook(() => ({})); if (!same(entry.deps, deps)) { entry.deps = deps; pending.set(index, fn); } },
  };
  const window = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    location: { search: "", href: "https://synthetic.test/" }, history: { state: null, pushState: noop, replaceState: noop },
    innerWidth: desktop ? 1440 : 375, innerHeight: 900, matchMedia: () => ({ matches: desktop, addEventListener: noop, removeEventListener: noop }),
    localStorage: { getItem: () => null, setItem: noop }, requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
    setTimeout, clearTimeout, getSelection: () => null,
  };
  const document = { addEventListener: noop, removeEventListener: noop, body: { style: {} }, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [] };
  const mocks = {
    "../../lib/api": { ApiRequestError },
    "../../lib/offline-access": { authenticationGeneration: () => generation, OfflineAccessError,
      AUTH_UNAUTHORIZED_EVENT: "auth", OFFLINE_ACCESS_LOCKED_EVENT: "lock" },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US", annotationDefaultPosition: "floating", setAnnotationDefaultPosition: noop }) },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async () => true, prompt: async () => "Synthetic comment" }) },
    "../conversations/markdown-renderer": { MarkdownRenderer: "Markdown" },
    "../conversations/rendered-block-registry": { getRenderedBlocks: () => [], subscribeRenderedBlocks: () => noop },
    "../conversations/reader-locator-target": { annotationNavigationTarget: value => ({ annotationId: value.id }) },
    "../conversations/text-anchor": { resolveTextAnchorRange: () => null },
    "./notebook-view": { NotebookView: "Notebook" },
    "../../components/settings-focused-dialog": { SettingsFocusedDialog: "Settings" },
    "../../lib/offline-conflicts": { ensureNotebookConflict: async () => "synthetic-conflict" },
    "../../lib/annotation-sync": { OFFLINE_SYNC_CHANGED_EVENT: "sync" }, ...extra,
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    let source = readFileSync(new URL(`../../apps/web/features/annotations/${file}`, import.meta.url), "utf8");
    // Observe real closure callbacks without replacing their branches. Selection
    // setters are explicit doubles, not proof of browser DOM selection behavior.
    if (observeWorkspace && file === "annotation-workspace.tsx") source = source.replace("const creationTypes =",
      "observeWorkspace({ setSelection, createTextAnnotation }); const creationTypes =");
    const code = ts.transpileModule(source, { fileName: file, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "window", "document", "ResizeObserver", "CSS", "observeWorkspace", code)(name => {
      if (name === "react") return react;
      if (name === "./use-annotation-workspace-reads") return load("use-annotation-workspace-reads.ts");
      if (name === "./annotation-comment-editor") return load("annotation-comment-editor.tsx");
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".")) throw new Error(`Unexpected dependency ${name}`);
      return appRequire(name);
    }, module, module.exports, window, document, class { observe() {} disconnect() {} }, { highlights: { delete: noop } }, observeWorkspace);
    modules.set(file, module.exports); return module.exports;
  }
  return {
    render(file, name, ...args) { cursor = 0; return load(file)[name](...args); },
    flush() { for (const [index, fn] of pending) { hooks[index].cleanup?.(); hooks[index].cleanup = fn(); } pending.clear(); },
    dispose() { for (const entry of hooks) entry.cleanup?.(); pending.clear(); },
    authorize(value, event) { generation = value; if (event) events.dispatchEvent(new Event(event)); },
    events,
  };
}
function repository(overrides = {}) {
  const calls = { annotations: 0, notebook: 0, conflicts: 0, create: 0 };
  const value = { mode: "remote", list: async () => [annotation("saved")], getNotebook: async () => note("saved"),
    listNotebookConflicts: async () => [], create: async () => annotation("created"), ...overrides };
  for (const [method, kind] of [["list", "annotations"], ["getNotebook", "notebook"], ["listNotebookConflicts", "conflicts"], ["create", "create"]]) {
    const operation = value[method]; value[method] = (...args) => { calls[kind]++; return operation(...args); };
  }
  return { value, calls };
}
function fixture(overrides) {
  const r = runtime(), repo = repository(overrides);
  let id = "synthetic-a", selected = repo.value, open = true, value;
  const render = () => value = r.render("use-annotation-workspace-reads.ts", "useAnnotationWorkspaceReads", id, selected, open);
  render(); r.flush();
  return { r, repo, render, get value() { return value; },
    switch({ conversation = id, repository = selected, opened = open } = {}) { id = conversation; selected = repository; open = opened; return render(); },
    async load(kind) { await value.reload(kind); render(); }, dispose: () => r.dispose() };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) { for (const item of tree) { const found = find(item, predicate); if (found) return found; } return; }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
function text(tree) { return tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children); }
function button(tree, label) { const node = find(tree, item => item.type === "button" && text(item.props.children) === label); assert.ok(node, label); return node.props; }

for (const kind of ["notebook", "conflicts"]) test(`${kind} failure leaves successful annotations usable and retries only that resource`, async () => {
  let failed = true;
  const method = kind === "notebook" ? "getNotebook" : "listNotebookConflicts";
  const f = fixture({ [method]: async () => { if (failed) throw new Error("Synthetic read failure"); return kind === "notebook" ? note("recovered") : []; } });
  try { await f.load(); assert.equal(f.value.annotations[0].id, "saved"); assert.equal(f.value.reads[kind].status, "error"); assert.equal(f.value.canUseNotebook(), false);
    failed = false; await f.load(kind); assert.equal(f.value.canUseNotebook(), true);
    assert.deepEqual(f.repo.calls, { annotations: 1, notebook: kind === "notebook" ? 2 : 1, conflicts: kind === "conflicts" ? 2 : 1, create: 0 });
  } finally { f.dispose(); }
});
test("annotation failure leaves notebook and known conflicts independently readable", async () => {
  const f = fixture({ list: async () => { throw new Error("Synthetic failure"); } });
  try { await f.load(); assert.equal(f.value.reads.annotations.status, "error"); assert.equal(f.value.notebook.title, "saved"); assert.equal(f.value.canUseNotebook(), true); }
  finally { f.dispose(); }
});
for (const kind of ["annotations", "notebook", "conflicts"]) test(`${kind} publishes before an unrelated slow read completes`, async () => {
  const waiting = deferred(); const slow = kind === "notebook" ? "list" : "getNotebook";
  const f = fixture({ [slow]: () => waiting.promise });
  try { const work = f.value.reload(); await setImmediate(); f.render(); assert.equal(f.value.reads[kind].status, "ready");
    waiting.resolve(slow === "list" ? [] : note("late")); await work;
  } finally { f.dispose(); }
});
test("a late older reload cannot replace a newer result", async () => {
  const old = deferred(); let reads = 0;
  const f = fixture({ list: () => ++reads === 1 ? old.promise : Promise.resolve([annotation("newer")]) });
  try { const first = f.value.reload(); await f.load(); old.resolve([annotation("older")]); await first; f.render(); assert.equal(f.value.annotations[0].id, "newer"); }
  finally { f.dispose(); }
});
test("failed refresh preserves current-scope data without claiming the read succeeded", async () => {
  let fail = false; const f = fixture({ list: async () => { if (fail) throw new Error("Synthetic offline"); return [annotation("saved")]; } });
  try { await f.load(); fail = true; await f.load("annotations"); assert.equal(f.value.annotations[0].id, "saved"); assert.equal(f.value.reads.annotations.status, "error"); }
  finally { f.dispose(); }
});
for (const status of [401, 403, 404]) test(`${status} removes inaccessible cached resource data`, async () => {
  let fail = false; const f = fixture({ getNotebook: async () => { if (fail) throw new ApiRequestError(status); return note("saved"); } });
  try { await f.load(); fail = true; await f.load("notebook"); assert.equal(f.value.notebook, null); assert.equal(f.value.reads.notebook.unavailable, true); }
  finally { f.dispose(); }
});
test("an offline access lock drops cached notebook data", async () => {
  let fail = false; const f = fixture({ getNotebook: async () => { if (fail) throw new OfflineAccessError(); return note("saved"); } });
  try { await f.load(); fail = true; await f.load("notebook"); assert.equal(f.value.notebook, null); }
  finally { f.dispose(); }
});
test("closing preserves loaded highlights but rejects a pending panel read", async () => {
  const old = deferred(); let reads = 0; const f = fixture({ list: () => ++reads === 1 ? Promise.resolve([annotation("saved")]) : old.promise });
  try { await f.load(); const work = f.value.reload("annotations"); f.switch({ opened: false });
    assert.equal(f.value.annotations[0].id, "saved"); old.resolve([annotation("late")]); await work; f.render(); assert.equal(f.value.annotations[0].id, "saved"); }
  finally { f.dispose(); }
});
test("closed same-scope confirmed writes remain publishable", async () => {
  const f = fixture(); try { await f.load(); f.switch({ opened: false }); f.value.publishNotebook(note("written")); f.render(); assert.equal(f.value.notebook.title, "written"); }
  finally { f.dispose(); }
});
for (const kind of ["conversation", "repository", "authentication"]) test(`${kind} changes hide old data immediately and reject older callbacks`, async () => {
  const slow = deferred(); const f = fixture({ getNotebook: () => slow.promise });
  try { const stale = f.value, work = stale.reload();
    if (kind === "authentication") { f.r.authorize(2, "lock"); f.render(); }
    else f.switch(kind === "conversation" ? { conversation: "synthetic-b" } : { repository: repository().value });
    assert.equal(f.value.notebook, null); assert.deepEqual(f.value.annotations, []);
    stale.publishNotebook(note("old write")); slow.resolve(note("old read")); await work; f.render(); assert.equal(f.value.notebook, null);
    const before = { ...f.repo.calls }; await stale.reload(); assert.deepEqual(f.repo.calls, before);
  } finally { f.dispose(); }
});
test("authentication changes reject completions even before another render", async () => {
  const slow = deferred(), f = fixture({ getNotebook: () => slow.promise });
  try { const work = f.value.reload(); f.r.authorize(2); slow.resolve(note("stale")); await work; f.r.authorize(1); f.render(); assert.equal(f.value.notebook, null); }
  finally { f.dispose(); }
});
test("confirmed notebook writes retire pending reads before effects or rerender", async () => {
  const slow = deferred(), f = fixture({ getNotebook: () => slow.promise });
  try { const work = f.value.reload(); f.value.publishNotebook(note("written")); slow.resolve(note("older")); await work; f.render(); assert.equal(f.value.notebook.title, "written"); }
  finally { f.dispose(); }
});
test("notebook readiness changes synchronously when conflict checking begins", async () => {
  const f = fixture(); try { await f.load(); assert.equal(f.value.canUseNotebook(), true); const work = f.value.reload("conflicts");
    assert.equal(f.value.canUseNotebook(), false); await work; assert.equal(f.value.canUseNotebook(), true); }
  finally { f.dispose(); }
});
test("unmount ignores pending reads and previously captured publishers", async () => {
  const slow = deferred(), f = fixture({ getNotebook: () => slow.promise });
  const work = f.value.reload(); f.dispose(); f.value.publishNotebook(note("late write")); slow.resolve(note("late read")); await work;
  assert.equal(f.value.canUseNotebook(), false);
});

test("workspace opens with independent error recovery instead of false empty annotations", async () => {
  const r = runtime(), repo = repository({ list: async () => { throw new Error("Synthetic read"); } });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: false, messages: [], activeMessageId: null, onOpenChange: noop, onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  try { render(); r.flush(); await setImmediate(); assert.equal(repo.calls.annotations, 0);
    props.open = true; render(); r.flush(); await setImmediate(); const tree = render();
    const feedback = find(tree, item => item.type?.name === "AnnotationReadFeedback"); assert.ok(feedback); assert.equal(feedback.props.status, "error");
    assert.equal(find(tree, item => item.type?.name === "AnnotationList"), undefined);
    const panel = feedback.type(feedback.props); assert.ok(text(panel).includes("Unable to load annotations")); assert.equal(text(panel).includes("Synthetic read"), false);
    button(panel, "Retry annotations").onClick(); await setImmediate(); assert.equal(repo.calls.annotations, 2); assert.equal(repo.calls.notebook, 1);
  } finally { r.dispose(); }
});
test("a bookmark can still be created from the closed desktop Reader", async () => {
  const r = runtime({}, true), repo = repository(), openings = [];
  const props = { conversationId: "synthetic-a", repository: repo.value, open: false,
    messages: [{ id: "synthetic-message", role: "user", order_key: 1, ordinal: 1 }], activeMessageId: null,
    onOpenChange: value => openings.push(value), onNavigate: noop };
  try { r.render("annotation-workspace.tsx", "AnnotationWorkspace", props); r.flush();
    r.render("annotation-workspace.tsx", "AnnotationWorkspace", props); r.flush();
    r.events.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", { detail: { messageId: "synthetic-message" } }));
    await setImmediate(); assert.equal(repo.calls.create, 1); assert.deepEqual(openings, [true]);
  } finally { r.dispose(); }
});

function notebookFixture(write = async () => 1, remove = async () => {}, locale = "en-US") {
  let allowed = false; const calls = { writes: 0, published: 0, removed: 0 };
  const base = note("saved"), repo = repository().value;
  repo.saveNotebook = async () => { calls.writes++; return note("edited"); };
  const r = runtime({ "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../lib/notebook-drafts": { notebookDraftKey: () => "synthetic-draft", readNotebookDraft: async () => ({ base, title: "edited", blocks: [], version: 1 }),
    writeNotebookDraft: write, removeNotebookDraft: async (...args) => { calls.removed++; await remove(...args); } } });
  const props = { notebook: base, conflicts: [], annotations: [], repository: repo, onSaved: () => calls.published++, onReload: async () => {},
    onResolve: async () => {}, onRiskChange: noop, onNavigate: noop, saveBlocked: true, canSave: () => allowed };
  const render = () => r.render("notebook-view.tsx", "NotebookView", props);
  return { r, calls, render, allow(value) { allowed = value; props.saveBlocked = !value; }, props };
}

test("notebook title accessible name follows the selected interface language", async () => {
  for (const [locale, expected] of [["en-US", "Notebook title"], ["zh-CN", "精选笔记标题"]]) {
    const f = notebookFixture(undefined, undefined, locale);
    try {
      f.render(); f.r.flush(); await setImmediate();
      const title = find(f.render(), item => item.type === "input" && item.props["aria-label"] === expected);
      assert.ok(title, `${locale} title field has localized accessible name`);
    } finally { f.r.dispose(); }
  }
});

test("notebook draft persistence coalesces pending edits and saves only after the latest snapshot", async () => {
  const firstWrite = deferred(), latestWrite = deferred(), writes = [], saves = [];
  const f = notebookFixture(async (_key, expectedVersion, value) => {
    writes.push({ expectedVersion, title: value.title });
    return writes.length === 1 ? firstWrite.promise : latestWrite.promise;
  });
  f.props.repository.saveNotebook = async (base, blocks, title) => {
    saves.push({ title, blocks }); return { ...base, title, blocks, revision: base.revision + 1 };
  };
  try {
    f.allow(true); f.render(); f.r.flush(); await setImmediate();
    let tree = f.render(), title = find(tree, item => item.type === "input");
    title.props.onChange({ target: { value: "first edit" } });
    await setImmediate();
    assert.deepEqual(writes.map(item => item.title), ["first edit"]);
    for (let index = 0; index < 100; index++) {
      title = find(f.render(), item => item.type === "input");
      assert.equal(title.props.disabled, false);
      title.props.onChange({ target: { value: index === 99 ? "latest edit" : `intermediate edit ${index}` } });
    }
    tree = f.render(); button(tree, "Save notebook").onClick();
    assert.equal(saves.length, 0);
    firstWrite.resolve(2);
    await setImmediate();
    assert.deepEqual(writes, [
      { expectedVersion: 1, title: "first edit" },
      { expectedVersion: 2, title: "latest edit" },
    ]);
    assert.equal(saves.length, 0, "remote save still waits for the latest local write");
    latestWrite.resolve(3); await setImmediate();
    assert.deepEqual(saves, [{ title: "latest edit", blocks: [] }]);
    assert.equal(f.calls.removed, 1);
    assert.equal(find(f.render(), item => item.type === "input").props.value, "latest edit");
  } finally { firstWrite.resolve(2); latestWrite.resolve(3); f.r.dispose(); }
});

test("coalesced notebook text retains the latest block contents and order", async () => {
  const first = deferred(), writes = [];
  const f = notebookFixture(async (_key, version, value) => {
    writes.push(value); if (writes.length === 1) await first.promise; return version + 1;
  });
  try {
    f.render(); f.r.flush(); await setImmediate();
    button(f.render(), "Add text block").onClick(); await setImmediate();
    for (const content of ["intermediate text", "latest Markdown\n\n完整草稿"]) {
      const field = find(f.render(), item => item.type === "textarea");
      assert.equal(field.props.disabled, false); field.props.onChange({ target: { value: content } });
    }
    button(f.render(), "Add text block").onClick();
    const expected = find(f.render(), item => item.type === "textarea").props.value;
    first.resolve(); await setImmediate();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].blocks.map(block => block.markdown), [expected, ""]);
    assert.equal(writes[1].blocks[0].id, writes[0].blocks[0].id);
    assert.equal(writes[1].blocks[0].markdown, "latest Markdown\n\n完整草稿");
  } finally { first.resolve(); f.r.dispose(); }
});

test("failed notebook draft writes retain the newest input for explicit retry without advancing its version", async () => {
  const first = deferred(), writes = []; let fail = true;
  const f = notebookFixture(async (_key, version, value) => {
    writes.push({ version, title: value.title });
    if (writes.length === 1) await first.promise;
    if (fail) throw new Error("Synthetic local storage failure");
    return version + 1;
  });
  try {
    f.render(); f.r.flush(); await setImmediate();
    find(f.render(), item => item.type === "input").props.onChange({ target: { value: "older" } });
    find(f.render(), item => item.type === "input").props.onChange({ target: { value: "newest" } });
    first.resolve(); await setImmediate();
    assert.deepEqual(writes, [{ version: 1, title: "older" }, { version: 1, title: "newest" }]);
    assert.match(text(f.render()), /Local draft could not be saved/);
    assert.equal(find(f.render(), item => item.type === "input").props.value, "newest");
    await setImmediate(); assert.equal(writes.length, 2, "no background retry");
    fail = false; button(f.render(), "Retry saving draft").onClick(); await setImmediate();
    assert.deepEqual(writes[2], { version: 1, title: "newest" });
    assert.match(text(f.render()), /Draft saved on this device/);
    assert.equal(f.calls.writes, 0);
    find(f.render(), item => item.type === "input").props.onChange({ target: { value: "later burst" } });
    await setImmediate(); assert.deepEqual(writes[3], { version: 2, title: "later burst" });
  } finally { first.resolve(); f.r.dispose(); }
});

test("a blocked deletion explains recovery and never retries the write automatically", async () => {
  let fail = true, deleted = 0;
  const r = runtime({}, true), repo = repository({ getNotebook: async () => { if (fail) throw new Error("Synthetic notebook read"); return note("saved"); },
    delete: async () => deleted++ });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: true, messages: [], activeMessageId: "synthetic-message", onOpenChange: noop, onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  try { render(); r.flush(); await setImmediate(); let tree = render();
    await find(tree, item => item.type?.name === "AnnotationList").props.onDelete(annotation("saved")); tree = render();
    assert.equal(deleted, 0); assert.ok(text(tree).includes("Annotations were not deleted")); assert.equal(find(tree, item => item.type === "Notebook"), undefined);
    const feedback = find(tree, item => item.type?.name === "AnnotationReadFeedback" && item.props.kind === "notebook");
    fail = false; feedback.props.onRetry(); await setImmediate(); tree = render(); assert.equal(deleted, 0);
    button(tree, "Back to annotations").onClick(); tree = render();
    await find(tree, item => item.type?.name === "AnnotationList").props.onDelete(annotation("saved")); assert.equal(deleted, 1);
  } finally { r.dispose(); }
});
test("a late bookmark completion cannot open a different conversation's workspace", async () => {
  const slow = deferred(), openings = [], r = runtime({}, true), repo = repository({ create: () => slow.promise });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: false,
    messages: [{ id: "synthetic-message", role: "user", order_key: 1 }], activeMessageId: null, onOpenChange: value => openings.push(value), onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  try { render(); r.flush(); render(); r.flush();
    r.events.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", { detail: { messageId: "synthetic-message" } }));
    assert.equal(repo.calls.create, 1); props.conversationId = "synthetic-b"; render(); slow.resolve(annotation("created")); await setImmediate();
    assert.deepEqual(openings, [true]); assert.equal(repo.calls.annotations, 0);
  } finally { r.dispose(); }
});
test("a deletion confirmation that outlives its conversation cannot delete or reopen the new one", async () => {
  const confirmation = deferred(), openings = []; let deleted = 0;
  const r = runtime({ "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: () => confirmation.promise }) } }, true);
  const repo = repository({ delete: async () => deleted++ });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: true, messages: [], activeMessageId: "synthetic-message", onOpenChange: value => openings.push(value), onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  try { render(); r.flush(); await setImmediate(); const tree = render();
    const work = find(tree, item => item.type?.name === "AnnotationList").props.onDelete(annotation("saved"));
    props.conversationId = "synthetic-b"; render(); confirmation.resolve(true); await work;
    assert.equal(deleted, 0); assert.deepEqual(openings, []);
  } finally { r.dispose(); }
});
test("unknown conflict reads preserve the notebook draft and block saving without auto-retry", async () => {
  const f = notebookFixture(); try { f.render(); f.r.flush(); await setImmediate(); let tree = f.render();
    assert.equal(button(tree, "Save notebook").disabled, true); button(tree, "Save notebook").onClick(); await setImmediate(); assert.equal(f.calls.writes, 0);
    assert.equal(find(tree, item => item.type === "input").props.value, "edited");
    f.allow(true); tree = f.render(); await setImmediate(); assert.equal(f.calls.writes, 0);
    button(tree, "Save notebook").onClick(); await setImmediate(); assert.deepEqual(f.calls, { writes: 1, published: 1, removed: 1 });
  } finally { f.r.dispose(); }
});
test("a save waiting for local draft storage rechecks read ownership before writing", async () => {
  const slow = deferred(), f = notebookFixture(() => slow.promise);
  try { f.allow(true); f.render(); f.r.flush(); await setImmediate(); let tree = f.render();
    find(tree, item => item.type === "input").props.onChange({ target: { value: "new draft" } });
    tree = f.render(); button(tree, "Save notebook").onClick(); f.allow(false); f.render(); slow.resolve(2); await setImmediate();
    assert.deepEqual(f.calls, { writes: 0, published: 0, removed: 0 });
    assert.equal(find(f.render(), item => item.type === "input").props.value, "new draft");
  } finally { f.r.dispose(); }
});

function batchFixture(confirm = async () => true) {
  const first = { ...annotation("first"), quote: "shown" }, second = { ...annotation("second"), quote: "hidden" }, bookmark = { ...annotation("bookmark"), quote: "bookmark", annotation_type: "bookmark" };
  let items = [first, second, bookmark], notebook = { ...note("saved"), blocks: [] };
  const updates = [], deletions = [], saves = [], confirmations = [];
  const r = runtime({ "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: args => { confirmations.push(args); return confirm(args); } }) } }, true);
  const repo = repository({ list: async () => items, getNotebook: async () => notebook,
    update: async (item, patch) => { updates.push(item.id); return { ...item, ...patch, revision: (item.revision ?? 0) + 1 }; }, delete: async item => { deletions.push(item.id); },
    saveNotebook: async (base, blocks) => { saves.push({ base, blocks }); return notebook = { ...base, blocks, revision: base.revision + 1 }; } });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: true, messages: [], activeMessageId: "synthetic-message", onOpenChange: noop, onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  const select = (tree, id) => find(tree, item => item.type?.name === "AnnotationList").props.onToggleSelected(id);
  const query = (tree, value) => find(tree, item => item.type === "input" && item.props.placeholder === "Search annotations").props.onChange({ target: { value } });
  return { r, repo, props, render, select, query, updates, deletions, saves, confirmations,
    setItems(value) { items = value; }, setNotebook(value) { notebook = value; },
    async start() { render(); r.flush(); await setImmediate(); let tree = render(); button(tree, "Manage").onClick(); tree = render(); select(tree, "first"); select(tree, "second"); query(tree, "shown"); return render(); },
    async refresh() { r.flush(); r.events.dispatchEvent(new Event("sync")); await setImmediate(); return render(); },
  };
}

for (const action of ["style", "notes", "delete"]) test(`batch ${action} keeps the same two selected targets across filters`, async () => {
  const f = batchFixture(); try { const tree = await f.start();
    assert.ok(text(tree).includes("2 selected; 1 hidden by filters"));
    button(tree, action === "style" ? "Apply style (2)" : action === "notes" ? "Add to notes (2)" : "Delete").onClick(); await setImmediate();
    assert.deepEqual(action === "style" ? f.updates : action === "delete" ? f.deletions : f.saves[0].blocks.map(block => block.annotation_id), ["first", "second"]);
    if (action === "delete") assert.match(f.confirmations[0].description, /1 are hidden/);
  } finally { f.r.dispose(); }
});

test("visible select/invert preserve hidden selections and show-all restores their context", async () => {
  const f = batchFixture(); try { let tree = await f.start(); button(tree, "Invert visible").onClick(); tree = f.render();
    assert.ok(text(tree).includes("1 selected; 1 hidden by filters")); button(tree, "Select visible").onClick(); tree = f.render();
    assert.ok(text(tree).includes("2 selected; 1 hidden by filters")); button(tree, "Show all annotations").onClick(); tree = f.render();
    assert.ok(text(tree).includes("2 selected")); assert.equal(text(tree).includes("hidden by filters"), false);
    button(tree, "Clear").onClick(); assert.ok(text(f.render()).includes("0 selected"));
  } finally { f.r.dispose(); }
});

test("batch counts exclude bookmark styles and already-added references without dropping hidden selections", async () => {
  const f = batchFixture(); try { let tree = await f.start(); f.select(tree, "bookmark");
    f.setNotebook({ ...note("saved"), blocks: [{ id: "existing", type: "annotation_reference", annotation_id: "first" }] });
    tree = await f.refresh(); assert.equal(button(tree, "Apply style (2)").disabled, false);
    button(tree, "Add to notes (2)").onClick(); await setImmediate();
    assert.deepEqual(f.saves[0].blocks.map(block => block.annotation_id), ["first", "second", "bookmark"]);
  } finally { f.r.dispose(); }
});

test("confirmation uses current notebook revision and surviving original targets, preserving newer selections", async () => {
  const pending = deferred(), f = batchFixture(() => pending.promise);
  try { let tree = await f.start(); button(tree, "Delete").onClick();
    f.setItems([annotation("second"), annotation("new")]); f.setNotebook({ ...note("newer"), revision: 7,
      blocks: [{ id: "keep", type: "markdown", markdown: "new writing" }, { id: "reference", type: "annotation_reference", annotation_id: "second" }] });
    tree = await f.refresh(); f.select(tree, "new"); f.render(); pending.resolve(true); await setImmediate();
    assert.deepEqual(f.deletions, ["second"]); assert.equal(f.saves[0].base.revision, 7); assert.equal(f.saves[0].blocks[0].markdown, "new writing");
    assert.ok(text(f.render()).includes("1 selected"));
  } finally { f.r.dispose(); }
});

test("partial style failure publishes confirmed items and requires a read before another write", async () => {
  const f = batchFixture(); let calls = 0;
  f.repo.value.update = async (item, patch) => {
    f.updates.push(item.id); calls++;
    if (calls === 2) throw new Error("Synthetic style failure");
    return { ...item, ...patch, revision: item.revision + 1 };
  };
  try {
    let tree = await f.start(); button(tree, "Apply style (2)").onClick(); await setImmediate(); tree = f.render();
    assert.deepEqual(f.updates, ["first", "second"]); assert.match(text(tree), /1\/2 style changes confirmed/);
    assert.equal(button(tree, "Check current annotations").disabled, false);
    button(tree, "Check current annotations").onClick(); await setImmediate(); tree = f.render();
    assert.equal(text(tree).includes("style changes confirmed"), false);
    assert.equal(calls, 2);
  } finally { f.r.dispose(); }
});

test("delete waits for annotation confirmation before touching notebook references", async () => {
  const events = [], f = batchFixture();
  f.repo.value.delete = async item => { events.push(`delete:${item.id}`); if (item.id === "first") throw new Error("Synthetic unknown delete"); };
  f.repo.value.saveNotebook = async (...args) => { events.push("save-notebook"); return args[0]; };
  try {
    const tree = await f.start(); button(tree, "Delete").onClick(); await setImmediate();
    assert.deepEqual(events, ["delete:first"]); assert.equal(f.saves.length, 0);
    assert.match(text(f.render()), /deletions confirmed/);
  } finally { f.r.dispose(); }
});

test("repeated bookmark events share one stable request and unknown results never auto-repeat", async () => {
  const pending = deferred(), r = runtime({}, true), requests = [], openings = [];
  const repo = repository({ create: (_conversationId, input) => { requests.push(input); return pending.promise; } });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: false,
    messages: [{ id: "synthetic-message", role: "user", order_key: 1 }], activeMessageId: null,
    onOpenChange: value => openings.push(value), onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  try {
    render(); r.flush(); render(); r.flush();
    const event = () => r.events.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", { detail: { messageId: "synthetic-message" } }));
    event(); event(); assert.equal(requests.length, 1); assert.ok(requests[0].id);
    pending.reject(new Error("Synthetic unknown create")); await setImmediate();
    props.open = true;
    let tree = render(); assert.match(text(tree), /Bookmark creation was not confirmed/);
    button(tree, "Check bookmark").onClick(); await setImmediate(); tree = render();
    assert.equal(requests.length, 1); assert.match(text(tree), /bookmark is currently absent/);
    button(tree, "Finish without retrying").onClick(); assert.equal(text(render()).includes("Bookmark creation was not confirmed"), false);
    assert.deepEqual(openings, [true]);
  } finally { r.dispose(); }
});

test("style retry skips matching confirmations and uses the checked revision of remaining items", async () => {
  const f = batchFixture(), calls = [], pending = deferred();
  let items = ["first", "second"].map((id, index) => ({ ...annotation(id), quote: index ? "hidden" : "shown", color: "green", revision: 1 }));
  f.setItems(items);
  f.repo.value.update = async (item, patch) => {
    calls.push([item.id, item.revision]);
    if (calls.length === 1) await pending.promise;
    if (calls.length === 2) throw new Error("Synthetic unknown result");
    const saved = { ...item, ...patch, revision: item.revision + 1 };
    items = items.map(value => value.id === item.id ? saved : value); f.setItems(items); return saved;
  };
  try {
    let tree = await f.start(); const apply = button(tree, "Apply style (2)"); apply.onClick(); apply.onClick();
    assert.deepEqual(calls, [["first", 1]]); pending.resolve(); await setImmediate(); tree = f.render();
    assert.equal(commentList(f).items[0].revision, 2); assert.equal(commentList(f).items[0].color, "yellow");
    apply.onClick(); await setImmediate(); assert.equal(calls.length, 2);
    button(tree, "Check current annotations").onClick(); await setImmediate(); tree = f.render();
    assert.equal(calls.length, 2); button(tree, "Apply style (2)").onClick(); await setImmediate();
    assert.deepEqual(calls, [["first", 1], ["second", 1], ["second", 1]]);
    assert.equal(items.every(item => item.color === "yellow"), true);
  } finally { f.r.dispose(); }
});

test("failed style checks stay recoverable in expanded reading and cannot restart writes", async () => {
  const f = batchFixture(); let writes = 0;
  f.repo.value.update = async () => { writes++; throw new Error("Synthetic unknown style"); };
  try {
    let tree = await f.start(); button(tree, "Apply style (2)").onClick(); await setImmediate(); tree = f.render();
    f.repo.value.list = async () => { throw new Error("Synthetic failed check"); };
    find(tree, item => item.props?.["aria-label"] === "Expand annotation reading").props.onClick(); tree = f.render();
    const check = button(tree, "Check current annotations"); check.onClick(); check.onClick(); await setImmediate(); tree = f.render();
    assert.match(text(tree), /style changes confirmed/); assert.equal(button(tree, "Check current annotations").disabled, false);
    await commentList(f).onStyle(annotation("first"), "highlight", "blue"); assert.equal(writes, 1);
  } finally { f.r.dispose(); }
});

test("partial deletion only cleans absent targets after a read and never resumes deleting", async () => {
  const f = batchFixture(), events = [];
  const first = { ...annotation("first"), quote: "shown", revision: 1 }, second = { ...annotation("second"), quote: "hidden", revision: 1 };
  f.setItems([first, second]);
  f.setNotebook({ ...note("saved"), blocks: [
    { id: "r1", type: "annotation_reference", annotation_id: "first" },
    { id: "r2", type: "annotation_reference", annotation_id: "second" },
    { id: "text", type: "markdown", markdown: "Keep this writing" },
  ] });
  f.repo.value.delete = async item => { events.push(item.id); if (item.id === "second") throw new Error("Synthetic failure"); f.setItems([second]); };
  try {
    let tree = await f.start(); button(tree, "Delete").onClick(); await setImmediate(); tree = f.render();
    assert.deepEqual(events, ["first", "second"]); assert.equal(f.saves.length, 0); assert.match(text(tree), /1\/2 deletions confirmed/);
    assert.equal(commentList(f).items.some(item => item.id === "first"), false);
    button(tree, "Check deletion results").onClick(); await setImmediate(); tree = f.render();
    assert.equal(f.saves.length, 0); assert.deepEqual(events, ["first", "second"]);
    const cleanup = button(tree, "Clean notebook references"); cleanup.onClick(); cleanup.onClick(); await setImmediate();
    assert.equal(f.saves.length, 1); assert.deepEqual(f.saves[0].blocks.map(block => block.id), ["r2", "text"]);
    assert.equal(f.saves[0].blocks[1].markdown, "Keep this writing"); assert.deepEqual(events, ["first", "second"]);
    assert.equal(text(f.render()).includes("deletions confirmed"), false);
  } finally { f.r.dispose(); }
});

test("failed notebook cleanup is checked and retried independently without re-deleting annotations", async () => {
  const f = batchFixture(); let deletes = 0, saves = 0;
  let items = [{ ...annotation("first"), quote: "shown", revision: 1 }];
  f.setItems(items); f.setNotebook({ ...note("saved"), blocks: [{ id: "r1", type: "annotation_reference", annotation_id: "first" }] });
  f.repo.value.delete = async () => { deletes++; items = []; f.setItems(items); };
  const save = f.repo.value.saveNotebook;
  f.repo.value.saveNotebook = async (...args) => { if (++saves === 1) throw new Error("Synthetic cleanup unknown"); return save(...args); };
  try {
    let tree = await f.start(); button(tree, "Delete").onClick(); await setImmediate(); tree = f.render();
    assert.equal(deletes, 1); assert.equal(saves, 1); assert.match(text(tree), /1\/1 deletions confirmed/);
    button(tree, "Check deletion results").onClick(); await setImmediate(); tree = f.render();
    assert.equal(saves, 1); button(tree, "Clean notebook references").onClick(); await setImmediate();
    assert.equal(deletes, 1); assert.equal(saves, 2); assert.deepEqual(f.saves[0].blocks, []);
  } finally { f.r.dispose(); }
});

test("a deletion check that fails does not enable cleanup or repeat writes", async () => {
  const f = batchFixture(); let deletes = 0;
  f.repo.value.delete = async () => { deletes++; throw new Error("Synthetic unknown"); };
  try {
    let tree = await f.start(); button(tree, "Delete").onClick(); await setImmediate(); tree = f.render();
    f.repo.value.list = async () => { throw new Error("Synthetic check failure"); };
    button(tree, "Check deletion results").onClick(); await setImmediate(); tree = f.render();
    assert.ok(button(tree, "Check deletion results")); assert.equal(find(tree, item => item.type === "button" && text(item) === "Clean notebook references"), undefined);
    await commentList(f).onDelete(annotation("first")); assert.equal(deletes, 1); assert.equal(f.saves.length, 0);
  } finally { f.r.dispose(); }
});

test("a missing annotation found by checking is not reported as an acknowledged deletion", async () => {
  const f = batchFixture();
  f.setItems([{ ...annotation("first"), quote: "shown" }]);
  f.setNotebook({ ...note("saved"), blocks: [{ id: "r1", type: "annotation_reference", annotation_id: "first" }] });
  f.repo.value.delete = async () => { f.setItems([]); throw new Error("Synthetic lost response"); };
  f.repo.value.saveNotebook = async () => { throw new Error("Synthetic cleanup failure"); };
  try {
    const tree = await f.start();
    commentList(f).onDraftChange(annotation("first"), "Draft for the annotation being deleted");
    button(tree, "Delete").onClick(); await setImmediate();
    assert.ok(commentList(f).readCommentDraft("first"));
    button(f.render(), "Check deletion results").onClick(); await setImmediate();
    assert.equal(commentList(f).readCommentDraft("first"), undefined);
    button(f.render(), "Clean notebook references").onClick(); await setImmediate();
    assert.match(text(f.render()), /0\/1 deletions confirmed/);
  } finally { f.r.dispose(); }
});

test("a late deletion completion cannot clean or publish into a new conversation", async () => {
  const f = batchFixture(), pending = deferred();
  f.repo.value.delete = () => pending.promise;
  f.setNotebook({ ...note("saved"), blocks: [{ id: "r1", type: "annotation_reference", annotation_id: "first" }] });
  try {
    const tree = await f.start(); button(tree, "Delete").onClick(); await setImmediate();
    f.props.conversationId = "synthetic-b"; f.render(); pending.resolve(); await setImmediate();
    assert.equal(f.saves.length, 0); assert.equal(text(f.render()).includes("deletions confirmed"), false);
  } finally { f.r.dispose(); }
});

for (const exists of [true, false]) test(`bookmark unknown-result check ${exists ? "finds the original id without writing" : "allows an explicit retry using the original id"}`, async () => {
  const r = runtime({}, true), requests = []; let stored = [];
  const repo = repository({ list: async () => stored, create: async (_id, input) => {
    requests.push(input);
    if (requests.length === 1) { if (exists) stored = [{ ...annotation(input.id), annotation_type: "bookmark" }]; throw new Error("Synthetic lost response"); }
    const created = { ...annotation(input.id), ...input }; stored = [created]; return created;
  } });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: true,
    messages: [{ id: "synthetic-message", role: "user", order_key: 1 }], activeMessageId: null, onOpenChange: noop, onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  try {
    render(); r.flush(); await setImmediate(); render(); r.flush();
    const trigger = () => r.events.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", { detail: { messageId: "synthetic-message" } }));
    trigger(); await setImmediate(); trigger(); assert.equal(requests.length, 1);
    button(render(), "Check bookmark").onClick(); await setImmediate(); let tree = render(); assert.equal(requests.length, 1);
    if (exists) assert.equal(text(tree).includes("Bookmark creation was not confirmed"), false);
    else {
      const retry = button(tree, "Retry this bookmark"); retry.onClick(); retry.onClick(); await setImmediate(); tree = render();
      assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0]); assert.equal(text(tree).includes("currently absent"), false);
    }
  } finally { r.dispose(); }
});

test("a new read scope cannot inherit selection even when synthetic repositories reuse IDs", async () => {
  const f = batchFixture(); try { await f.start(); f.props.conversationId = "synthetic-b";
    f.render(); f.r.flush(); await setImmediate(); assert.ok(text(f.render()).includes("0 selected"));
  } finally { f.r.dispose(); }
});

test("late mobile annotation navigation cannot close a newly opened conversation", async () => {
  const pending = deferred(), changes = [], r = runtime(), repo = repository();
  const props = { conversationId: "synthetic-a", repository: repo.value, open: true, messages: [], activeMessageId: "synthetic-message",
    onOpenChange: value => changes.push(value), onNavigate: () => pending.promise };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  try { render(); r.flush(); await setImmediate(); let tree = render();
    const work = find(tree, item => item.type?.name === "AnnotationList").props.onNavigate({ annotationId: "saved" });
    tree = render(); assert.ok(text(tree).includes("正在按对话")); props.conversationId = "synthetic-b";
    tree = render(); assert.equal(text(tree).includes("正在按对话"), false);
    pending.resolve({ ok: true }); await work; assert.deepEqual(changes, []);
  } finally { r.dispose(); }
});

test("notebook cleanup retry deletes only the saved draft without resubmitting the notebook", async () => {
  let removes = 0; const versions = [];
  const f = notebookFixture(async (_key, expected) => { versions.push(expected); return expected + 1; }, async () => {
    if (++removes === 1) throw new Error("Synthetic cleanup failure");
  });
  try { f.allow(true); f.render(); f.r.flush(); await setImmediate(); button(f.render(), "Save notebook").onClick(); await setImmediate();
    let tree = f.render(); assert.ok(text(tree).includes("Notebook saved; local draft cleanup pending"));
    assert.equal(find(tree, item => item.type === "button" && text(item) === "Save notebook"), undefined);
    const retry = button(tree, "Retry clearing saved draft"); retry.onClick(); retry.onClick(); await setImmediate();
    assert.deepEqual(f.calls, { writes: 1, published: 1, removed: 2 }); tree = f.render(); assert.equal(text(tree).includes("cleanup pending"), false);
    find(tree, item => item.type === "input").props.onChange({ target: { value: "new comment after cleanup" } }); await setImmediate(); assert.deepEqual(versions, [0]);
  } finally { f.r.dispose(); }
});

test("an old cleanup action cannot delete a newly edited notebook draft", async () => {
  const f = notebookFixture(async () => 2, async () => { throw new Error("Synthetic cleanup failure"); });
  try { f.allow(true); f.render(); f.r.flush(); await setImmediate(); button(f.render(), "Save notebook").onClick(); await setImmediate();
    const tree = f.render(), oldRetry = button(tree, "Retry clearing saved draft");
    find(tree, item => item.type === "input").props.onChange({ target: { value: "new draft retained" } }); oldRetry.onClick(); await setImmediate();
    assert.equal(f.calls.removed, 1); assert.equal(find(f.render(), item => item.type === "input").props.value, "new draft retained");
    assert.equal(text(f.render()).includes("cleanup pending"), false);
  } finally { f.r.dispose(); }
});

test("cleanup rechecks authorization after waiting and never overwrites another tab's draft version", async () => {
  const seen = [], f = notebookFixture(async () => 1, async (_key, version) => { seen.push(version); throw new Error("Synthetic changed draft version"); });
  try { f.allow(true); f.render(); f.r.flush(); await setImmediate(); button(f.render(), "Save notebook").onClick(); await setImmediate();
    button(f.render(), "Retry clearing saved draft").onClick(); f.allow(false); await setImmediate(); assert.deepEqual(seen, [1]);
    f.allow(true); button(f.render(), "Retry clearing saved draft").onClick(); await setImmediate();
    assert.deepEqual(seen, [1, 1]); assert.equal(f.calls.writes, 1); assert.ok(text(f.render()).includes("Changes made in another tab are protected"));
  } finally { f.r.dispose(); }
});

const commentList = f => find(f.render(), node => node.type?.name === "AnnotationList").props;

const selectedText = (quote = "Synthetic selected source", offset = 0) => ({
  messageId: "synthetic-message", messageVersionId: "synthetic-version", startBlockIndex: 0, startOffset: offset,
  endBlockIndex: 0, endOffset: offset + quote.length, quote, prefix: "", suffix: "", rect: { left: 0, width: 160, top: 180 },
});
function creationFixture({ prompt = async () => "Synthetic initial comment", create, list } = {}) {
  let observed, prompts = 0; const openings = [], requests = [];
  const r = runtime({ "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({
    prompt: (...args) => { prompts++; return prompt(...args); }, confirm: async () => true,
  }) } }, true, value => { observed = value; });
  const repo = repository({ ...(list ? { list } : {}), create: async (_id, input) => {
    requests.push(input); return create ? create(input) : { ...annotation(input.id), ...input };
  } });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: true,
    messages: [{ id: "synthetic-message", role: "user", order_key: 1 }], activeMessageId: "synthetic-message",
    onOpenChange: value => openings.push(value), onNavigate: noop };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  return { r, repo, props, requests, openings, render, get prompts() { return prompts; },
    get observed() { return observed; },
    select(value = selectedText()) { observed.setSelection(value); return render(); },
    async start() { render(); r.flush(); await setImmediate(); render(); return this.select(); } };
}

test("text creation holds one prompt and one stable request through repeated actions", async () => {
  const prompt = deferred(), create = deferred(), f = creationFixture({ prompt: () => prompt.promise, create: () => create.promise });
  try {
    await f.start(); const first = f.observed.createTextAnnotation("comment", "yellow");
    await f.observed.createTextAnnotation("comment", "blue"); assert.equal(f.prompts, 1); assert.equal(f.requests.length, 0);
    prompt.resolve("Synthetic retained comment"); await setImmediate();
    assert.equal(f.requests.length, 1); assert.ok(f.requests[0].id); assert.equal(f.requests[0].comment_markdown, "Synthetic retained comment");
    await f.observed.createTextAnnotation("highlight", "green"); assert.equal(f.requests.length, 1);
    create.resolve({ ...annotation(f.requests[0].id), ...f.requests[0] }); await first;
    assert.equal(find(f.render(), item => item.props?.["aria-label"] === "Create annotation"), undefined);
  } finally { f.r.dispose(); }
});

test("unknown text creation retains quote and comment, checks read-only, and retries the same payload", async () => {
  let attempts = 0;
  const f = creationFixture({ list: async () => [], create: async input => {
    if (++attempts === 1) throw new Error("Synthetic lost creation"); return { ...annotation(input.id), ...input };
  } });
  try {
    await f.start(); await f.observed.createTextAnnotation("comment", "pink"); let tree = f.render();
    assert.match(text(tree), /Annotation creation was not confirmed/); assert.match(text(tree), /Synthetic initial comment/);
    assert.match(text(tree), /Synthetic selected source/); await f.observed.createTextAnnotation("comment", "blue"); assert.equal(f.prompts, 1);
    button(tree, "Check annotation").onClick(); await setImmediate(); tree = f.render(); assert.equal(f.requests.length, 1);
    const retry = button(tree, "Retry this annotation"); retry.onClick(); retry.onClick(); await setImmediate();
    assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1], f.requests[0]); assert.equal(f.prompts, 1);
    assert.equal(text(f.render()).includes("creation was not confirmed"), false);
  } finally { f.r.dispose(); }
});

test("checking an acknowledged-lost text creation finds its exact id without another create", async () => {
  let stored = [];
  const f = creationFixture({ list: async () => stored, create: async input => {
    stored = [{ ...annotation(input.id), ...input }]; throw new Error("Synthetic lost acknowledgement");
  } });
  try {
    await f.start(); await f.observed.createTextAnnotation("underline", "blue");
    button(f.render(), "Check annotation").onClick(); await setImmediate();
    assert.equal(f.requests.length, 1); assert.equal(text(f.render()).includes("creation was not confirmed"), false);
    assert.equal(find(f.render(), item => item.props?.["aria-label"] === "Create annotation"), undefined);
  } finally { f.r.dispose(); }
});

for (const recaptureSame of [true, false]) test(`a late text creation ${recaptureSame ? "clears a recapture of its original selection" : "preserves a newer selection"}`, async () => {
  const pending = deferred(), f = creationFixture({ create: () => pending.promise });
  try {
    await f.start(); const work = f.observed.createTextAnnotation("highlight", "yellow");
    f.select(recaptureSame ? selectedText() : selectedText("Newer selected source", 50));
    pending.resolve({ ...annotation(f.requests[0].id), ...f.requests[0] }); await work;
    assert.equal(Boolean(find(f.render(), item => item.props?.["aria-label"] === "Create annotation")), !recaptureSame);
  } finally { f.r.dispose(); }
});

test("cancelling a comment prompt leaves the selection and releases the creation guard", async () => {
  const f = creationFixture({ prompt: async () => null });
  try {
    await f.start(); await f.observed.createTextAnnotation("comment", "yellow");
    assert.equal(f.requests.length, 0); assert.ok(find(f.render(), item => item.props?.["aria-label"] === "Create annotation"));
    await f.observed.createTextAnnotation("highlight", "green"); assert.equal(f.requests.length, 1);
  } finally { f.r.dispose(); }
});

test("a late comment prompt cannot create in a different conversation", async () => {
  const pending = deferred(), f = creationFixture({ prompt: () => pending.promise });
  try {
    await f.start(); const work = f.observed.createTextAnnotation("comment", "yellow");
    f.props.conversationId = "synthetic-b"; f.render(); pending.resolve("Old prompt content"); await work;
    assert.equal(f.requests.length, 0); assert.deepEqual(f.openings, []);
  } finally { f.r.dispose(); }
});

test("a failed creation check keeps input and cannot enable a blind create retry", async () => {
  const f = creationFixture({ create: async () => { throw new Error("Synthetic unknown create"); } });
  try {
    await f.start(); await f.observed.createTextAnnotation("comment", "yellow");
    f.repo.value.list = async () => { throw new Error("Synthetic failed check"); };
    button(f.render(), "Check annotation").onClick(); await setImmediate();
    assert.match(text(f.render()), /Synthetic initial comment/); assert.ok(button(f.render(), "Check annotation"));
    assert.equal(find(f.render(), item => item.type === "button" && text(item) === "Retry this annotation"), undefined);
    assert.equal(f.requests.length, 1);
  } finally { f.r.dispose(); }
});

test("single and batch note additions share a synchronous pending guard", async () => {
  const pending = deferred(), f = batchFixture(); let saves = 0;
  f.repo.value.saveNotebook = () => { saves++; return pending.promise; };
  try {
    const tree = await f.start(); button(tree, "Add to notes (2)").onClick();
    await commentList(f).onAddToNotebook(annotation("first")); button(tree, "Add to notes (2)").onClick();
    assert.equal(saves, 1); pending.resolve({ ...note("saved"), revision: 2, blocks: [] }); await setImmediate();
    assert.equal(text(f.render()).includes("Adding to notes…"), false);
  } finally { f.r.dispose(); }
});

test("a note addition found by checking does not write again", async () => {
  const f = batchFixture(); let saves = 0;
  f.repo.value.saveNotebook = async (base, blocks) => { saves++; f.setNotebook({ ...base, blocks, revision: base.revision + 1 }); throw new Error("Synthetic lost response"); };
  try {
    button(await f.start(), "Add to notes (2)").onClick(); await setImmediate();
    assert.match(text(f.render()), /Adding to notes was not confirmed/);
    button(f.render(), "Check current notes").onClick(); await setImmediate();
    assert.equal(saves, 1); assert.equal(text(f.render()).includes("Adding to notes was not confirmed"), false);
  } finally { f.r.dispose(); }
});

test("note retry adds only missing original targets to the newest notebook and preserves other blocks", async () => {
  const f = batchFixture(), writes = []; let fails = true;
  f.repo.value.saveNotebook = async (base, blocks) => { writes.push({ base, blocks }); if (fails) throw new Error("Synthetic unknown"); return { ...base, blocks, revision: base.revision + 1 }; };
  try {
    button(await f.start(), "Add to notes (2)").onClick(); await setImmediate();
    const originalSecond = writes[0].blocks.find(item => item.annotation_id === "second");
    f.setNotebook({ ...note("new title"), revision: 9, blocks: [
      { id: "other-text", type: "markdown", markdown: "Newer text must survive" },
      { id: "existing", type: "annotation_reference", annotation_id: "first" },
    ] });
    button(f.render(), "Check current notes").onClick(); await setImmediate(); let tree = f.render();
    f.select(tree, "bookmark"); f.render(); assert.equal(writes.length, 1);
    fails = false; const retry = button(tree, "Add missing references (1)"); retry.onClick(); retry.onClick(); await setImmediate();
    assert.equal(writes.length, 2); assert.equal(writes[1].base.revision, 9);
    assert.equal(writes[1].blocks[0].markdown, "Newer text must survive"); assert.deepEqual(writes[1].blocks[2], originalSecond);
    assert.deepEqual(writes[1].blocks.filter(item => item.annotation_id).map(item => item.annotation_id), ["first", "second"]);
  } finally { f.r.dispose(); }
});

test("failed note checks keep targets without repeating or allowing unrelated notebook writes", async () => {
  const f = batchFixture(); let writes = 0;
  f.repo.value.saveNotebook = async () => { writes++; throw new Error("Synthetic unknown add"); };
  try {
    const tree = await f.start(); button(tree, "Add to notes (2)").onClick(); await setImmediate();
    f.repo.value.getNotebook = async () => { throw new Error("Synthetic failed read"); };
    button(f.render(), "Check current notes").onClick(); await setImmediate();
    assert.ok(button(f.render(), "Check current notes")); assert.equal(find(f.render(), item => item.type === "button" && text(item).startsWith("Add missing references")), undefined);
    await commentList(f).onDelete(annotation("first")); assert.equal(f.deletions.length, 0);
    button(tree, "Add to notes (2)").onClick(); await setImmediate(); assert.equal(writes, 1);
  } finally { f.r.dispose(); }
});

test("missing annotations are disclosed and not silently counted as added references", async () => {
  const f = batchFixture(); let failed = true;
  const save = f.repo.value.saveNotebook;
  f.repo.value.saveNotebook = async (...args) => { if (failed) throw new Error("Synthetic unknown"); return save(...args); };
  try {
    button(await f.start(), "Add to notes (2)").onClick(); await setImmediate();
    f.setItems([{ ...annotation("first"), quote: "shown" }]);
    button(f.render(), "Check current notes").onClick(); await setImmediate();
    assert.match(text(f.render()), /1 annotations are currently unavailable/);
    failed = false; button(f.render(), "Add missing references (1)").onClick(); await setImmediate();
    assert.deepEqual(f.saves[0].blocks.map(item => item.annotation_id), ["first"]);
    assert.match(text(f.render()), /0 original references are missing; 1 annotations are currently unavailable/);
    button(f.render(), "Finish adding to notes").onClick(); assert.equal(text(f.render()).includes("currently unavailable"), false);
  } finally { f.r.dispose(); }
});

test("note capacity is checked without truncating the requested additions", async () => {
  const f = batchFixture(); f.setNotebook({ ...note("full"), blocks: Array.from({ length: 4999 }, (_, index) => ({ id: `synthetic-${index}`, type: "markdown", markdown: "" })) });
  try {
    button(await f.start(), "Add to notes (2)").onClick(); await setImmediate();
    assert.equal(f.saves.length, 0); assert.match(text(f.render()), /5,000-item limit/);
    assert.ok(button(f.render(), "Finish adding to notes"));
  } finally { f.r.dispose(); }
});

test("a captured old add action sees a confirmed notebook before a rerender and avoids a duplicate", async () => {
  const f = batchFixture();
  try {
    await f.start(); const add = commentList(f).onAddToNotebook;
    await add(annotation("first")); await add(annotation("first"));
    assert.equal(f.saves.length, 1); assert.equal(f.saves[0].blocks.length, 1);
  } finally { f.r.dispose(); }
});

test("late note-add completion cannot publish or switch views in another conversation", async () => {
  const pending = deferred(), f = batchFixture(); f.repo.value.saveNotebook = () => pending.promise;
  try {
    button(await f.start(), "Add to notes (2)").onClick(); f.props.conversationId = "synthetic-b"; f.render();
    pending.resolve({ ...note("old acknowledgement"), revision: 8 }); await setImmediate();
    assert.equal(find(f.render(), item => item.type === "Notebook"), undefined); assert.equal(text(f.render()).includes("Adding to notes"), false);
  } finally { f.r.dispose(); }
});

test("a failed comment stays editable through style revisions and read-only checking", async () => {
  const f = batchFixture(); let attempts = 0, fail = true;
  const original = { ...annotation("first"), quote: "shown", revision: 1, comment_markdown: "original" };
  f.setItems([original]); f.repo.value.update = async (item, patch) => { attempts++; if (fail) throw new Error("Synthetic unknown save"); return { ...item, ...patch, revision: item.revision + 1 }; };
  try { await f.start(); let list = commentList(f); list.onDraftChange(original, "my input"); await list.onSaveComment(original);
    list = commentList(f); assert.equal(list.readCommentDraft("first").status, "error"); await list.onSaveComment(original, false, true); assert.equal(attempts, 1);
    f.setItems([{ ...original, revision: 2, color: "green" }]); await list.onCheckComments(); list = commentList(f);
    assert.equal(list.readCommentDraft("first").text, "my input"); assert.equal(attempts, 1);
    fail = false; await list.onSaveComment(original); list = commentList(f); assert.equal(list.readCommentDraft("first"), undefined);
    assert.equal(list.items[0].comment_markdown, "my input"); assert.equal(list.items[0].revision, 3); assert.equal(list.items[0].color, "green");
  } finally { f.r.dispose(); }
});

test("two blur/save events submit once and confirmed saving preserves typing made during the request", async () => {
  const f = batchFixture(), pending = deferred(); let attempts = 0;
  const original = { ...annotation("first"), quote: "shown", revision: 1, comment_markdown: "original" };
  f.setItems([original]); f.repo.value.update = async (item, patch) => ++attempts === 1 ? pending.promise : { ...item, ...patch, revision: item.revision + 1 };
  try { await f.start(); let list = commentList(f); list.onDraftChange(original, "submitted"); const first = list.onSaveComment(original);
    await list.onSaveComment(original); assert.equal(attempts, 1);
    list.onDraftChange(original, "newer typing"); pending.resolve({ ...original, comment_markdown: "submitted", revision: 2 }); await first;
    list = commentList(f); assert.equal(list.readCommentDraft("first").text, "newer typing"); assert.equal(list.readCommentDraft("first").base.revision, 2);
    assert.equal(list.items[0].comment_markdown, "submitted"); await list.onSaveComment(original); assert.equal(attempts, 2);
    assert.equal(commentList(f).items[0].comment_markdown, "newer typing");
  } finally { f.r.dispose(); }
});

test("changed stored comments require explicit confirmation and never overwrite on blur", async () => {
  const f = batchFixture(); let attempts = 0;
  const original = { ...annotation("first"), quote: "shown", revision: 1, comment_markdown: "original" };
  f.setItems([original]); f.repo.value.update = async (item, patch) => { attempts++; return { ...item, ...patch, revision: item.revision + 1 }; };
  try { await f.start(); let list = commentList(f); list.onDraftChange(original, "my input");
    f.setItems([{ ...original, revision: 2, comment_markdown: "someone else's update" }]); await list.onCheckComments(); list = commentList(f);
    await list.onSaveComment(original, false, true); assert.equal(attempts, 0); assert.equal(commentList(f).readCommentDraft("first").status, "conflict");
    await list.onSaveComment(original, true); assert.equal(attempts, 1); assert.equal(f.confirmations.length, 1);
    assert.equal(commentList(f).items[0].comment_markdown, "my input");
  } finally { f.r.dispose(); }
});

test("new typing invalidates a pending comment-overwrite confirmation", async () => {
  const pending = deferred(), f = batchFixture(() => pending.promise); let attempts = 0;
  const original = { ...annotation("first"), quote: "shown", revision: 1, comment_markdown: "original" };
  f.setItems([original]); f.repo.value.update = async () => { attempts++; };
  try { await f.start(); let list = commentList(f); list.onDraftChange(original, "reviewed draft");
    f.setItems([{ ...original, revision: 2, comment_markdown: "other update" }]); await list.onCheckComments(); list = commentList(f);
    const work = list.onSaveComment(original, true); list.onDraftChange(original, "unreviewed newer draft"); pending.resolve(true); await work;
    assert.equal(attempts, 0); assert.equal(commentList(f).readCommentDraft("first").text, "unreviewed newer draft");
  } finally { f.r.dispose(); }
});

test("comment drafts survive filtering and panel closure but cannot cross the read scope", async () => {
  const f = batchFixture(); try { await f.start(); let list = commentList(f); const original = list.items[0];
    list.onDraftChange(original, "retained draft"); f.query(f.render(), "unmatched"); assert.equal(commentList(f).items.length, 0);
    f.props.open = false; f.render(); f.props.open = true; f.render(); f.r.flush(); await setImmediate(); f.query(f.render(), "shown");
    list = commentList(f); assert.equal(list.readCommentDraft(original.id).text, "retained draft"); const oldChange = list.onDraftChange;
    f.props.conversationId = "synthetic-b"; f.render(); f.r.flush(); await setImmediate(); oldChange(original, "stale input");
    assert.equal(commentList(f).readCommentDraft(original.id), undefined);
  } finally { f.r.dispose(); }
});

test("a late comment acknowledgement cannot publish into another conversation", async () => {
  const pending = deferred(), f = batchFixture(); f.repo.value.update = () => pending.promise;
  try { await f.start(); const list = commentList(f), original = list.items[0]; list.onDraftChange(original, "old scope draft");
    const work = list.onSaveComment(original); f.props.conversationId = "synthetic-b"; f.render(); f.r.flush(); await setImmediate();
    pending.resolve({ ...original, comment_markdown: "old scope draft" }); await work;
    assert.equal(commentList(f).readCommentDraft(original.id), undefined); assert.notEqual(commentList(f).items[0].comment_markdown, "old scope draft");
  } finally { f.r.dispose(); }
});

test("the actual comment editor retains the controlled input and checking does not trigger blur saving", async () => {
  const r = runtime(), original = { ...annotation("first"), revision: 1, comment_markdown: "stored" };
  let draft = { base: original, text: "retained draft", status: "error" }, saves = 0, checks = 0;
  const props = { annotation: original, focused: false, zh: false, readDraft: () => draft,
    onChange: (_item, value) => { draft = { ...draft, text: value }; }, onSave: async () => saves++, onDiscard: async () => {}, onCheck: async () => checks++ };
  const render = () => r.render("annotation-comment-editor.tsx", "AnnotationCommentEditor", props);
  try { let tree = render(), input = find(tree, node => node.type === "textarea");
    assert.equal(input.props.value, "retained draft"); input.props.onChange({ target: { value: "newer draft" } });
    props.annotation = { ...original, revision: 2, color: "green" }; tree = render(); input = find(tree, node => node.type === "textarea");
    assert.equal(input.props.value, "newer draft"); input.props.onBlur({ relatedTarget: { closest: () => ({}) } }); button(tree, "Check current comment").onClick(); await setImmediate();
    assert.equal(saves, 0); assert.equal(checks, 1);
  } finally { r.dispose(); }
});
