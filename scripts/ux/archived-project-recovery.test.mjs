import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = appRequire("react"), jsx = appRequire("react/jsx-runtime"), ts = appRequire("typescript");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { QueryClient, QueryObserver, MutationObserver } = appRequire("@tanstack/react-query");
const noop = () => {};
const project = (id = "synthetic-archive-a", archived = true) => ({ id, name: `Synthetic project ${id}`, description: "Synthetic description",
  color: null, icon: null, is_default: false, is_archived: archived, conversation_count: 2, pinned_count: 0 });
class ApiRequestError extends Error { constructor(status) { super("Synthetic upstream detail"); this.status = status; } }
const source = readFileSync(new URL("../../apps/web/features/projects/archived-project-list.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("archived-project-list.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ArchivedProjectList");
const stateNames = [], refNames = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
    const call = node.initializer.expression.getText(ast);
    if (call === "useState" && ts.isArrayBindingPattern(node.name)) stateNames.push(node.name.elements[0].name.getText(ast));
    if (call === "useRef" && ts.isIdentifier(node.name)) refNames.push(node.name.text);
  }
  ts.forEachChild(node, visit);
}
visit(component);
const compiled = ts.transpileModule(source, { fileName: "archived-project-list.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const batchCode = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/batch-selection.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const batch = { exports: {} };
new Function("module", "exports", batchCode)(batch, batch.exports);

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

// Actual compiled component callbacks/JSX, QueryObserver, MutationObserver and
// batch runner. State/ref scheduling, transport/server rows, focus and unrelated
// children are controlled doubles, not React lifecycle/browser/backend evidence.
async function fixture({ rows = [project()], cached = true, initialFetch = true, error = null, selected = false,
  locale = "en-US", notice = null, outcomes = {}, confirm = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const keys = [["projects", "archived"], ["projects", "custom", "asc"], ["projects", "search-filter"]];
  let server = structuredClone(rows), readError = error, readHold = null, writeHold = null, mutation = null, pending = null;
  let reads = 0, confirms = 0, stateIndex = 0, refIndex = 0;
  const states = new Map([["selectionMode", selected], ["selectedProjectIds", new Set(selected ? rows.filter(item => item.is_archived).map(item => item.id) : [])], ["batchNotice", notice]]);
  const refs = new Map(), writes = [], deletes = [], signals = [], buttons = [], effects = [];
  const queryFn = async ({ signal }) => {
    reads += 1; signals.push(signal);
    const snapshot = structuredClone(server), failure = readError, held = readHold;
    if (held) await held;
    if (failure) throw failure;
    return snapshot;
  };
  for (const key of keys) if (cached) client.setQueryData(key, structuredClone(rows));
  const observer = new QueryObserver(client, { queryKey: keys[0], queryFn, enabled: false, staleTime: Infinity });
  const stop = observer.subscribe(noop);
  if (initialFetch) await observer.refetch();
  const capturedButton = props => { buttons.push(props); const { ref: _ref, ...rest } = props; return React.createElement("button", rest); };
  const capture = factory => (type, props, key) => type === "button" ? factory(capturedButton, props, key) : factory(type, props, key);
  const mocks = {
    react: { ...React,
      useState: initial => {
        const key = stateNames[stateIndex++];
        if (!states.has(key)) states.set(key, typeof initial === "function" ? initial() : initial);
        return [states.get(key), value => states.set(key, typeof value === "function" ? value(states.get(key)) : value)];
      },
      useRef: initial => { const key = refNames[refIndex++]; if (!refs.has(key)) refs.set(key, { current: initial }); return refs.get(key); },
      useEffect: effect => { effects.push(effect); },
    },
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "@tanstack/react-query": {
      useQueryClient: () => client, useQuery: () => observer.getCurrentResult(),
      useMutation: options => {
        if (!mutation) mutation = new MutationObserver(client, options); else mutation.setOptions(options);
        return { ...mutation.getCurrentResult(), mutate: value => { pending = mutation.mutate(value); void pending.catch(noop); }, reset: () => mutation.reset() };
      },
    },
    "../../lib/api": { ApiRequestError,
      getProjects: async () => queryFn({ signal: new AbortController().signal }),
      updateProject: async (id, patch) => {
        writes.push({ id, patch }); if (writeHold) await writeHold;
        if (outcomes[id] === "rejected") throw new ApiRequestError(503);
        const saved = { ...server.find(item => item.id === id), ...patch, description: "Synthetic canonical description" };
        server = server.map(item => item.id === id ? saved : item);
        if (outcomes[id] === "lost") throw new Error("Synthetic lost acknowledgement");
        return saved;
      },
      deleteProject: async id => { deletes.push(id); server = server.filter(item => item.id !== id); },
    },
    "../../components/selection-toolbar": {
      SelectionModeButton: ({ active, onClick }) => jsx.jsx("button", { onClick, children: active ? "Done" : "Manage projects" }),
      SelectionToolbar: ({ selectedCount, busy, children }) => React.createElement("aside", { "data-selection-count": selectedCount, "aria-busy": busy }, children),
    },
    "../../components/use-linear-selection": { useLinearSelection: () => ({ itemHandlers: () => ({}), checkboxClass: () => "flex" }) },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async () => { confirms += 1; return confirm; } }) },
    "./project-symbol": { ProjectSymbol: () => null },
    "../../lib/batch-selection": batch.exports,
  };
  const module = { exports: {} };
  const document = { activeElement: null, body: {} };
  new Function("require", "module", "exports", "document", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected component dependency: ${name}`);
    return appRequire(name);
  }, module, module.exports, document);
  const render = () => { stateIndex = 0; refIndex = 0; buttons.length = 0; effects.length = 0;
    return renderToStaticMarkup(React.createElement(module.exports.ArchivedProjectList)); };
  const button = label => {
    const found = buttons.find(item => (item["aria-label"] ?? textOf(item.children).trim()) === label);
    assert.ok(found, `Missing rendered button: ${label}`); return found;
  };
  render();
  return { client, observer, keys, states, refs, writes, deletes, signals, buttons, button, render, document,
    runEffects: () => effects.map(effect => effect()).filter(cleanup => typeof cleanup === "function"),
    get mutation() { return mutation; }, get pending() { return pending; }, reads: () => reads, confirms: () => confirms, server: () => server,
    activate: () => observer.setOptions({ queryKey: keys[0], queryFn, enabled: true, staleTime: Infinity }),
    setReadError: value => { readError = value; }, setServer: value => { server = structuredClone(value); },
    holdRead: () => { let release; readHold = new Promise(resolve => { release = resolve; }); return () => { readHold = null; release(); }; },
    allowNewReads: () => { readHold = null; },
    holdWrite: () => { let release; writeHold = new Promise(resolve => { release = resolve; }); return () => { writeHold = null; release(); }; },
    dispose: () => { stop(); observer.destroy(); client.clear(); },
  };
}

test("a transient archived-project refresh retains rows and localized read-only retry", async () => {
  const f = await fixture({ error: new ApiRequestError(503) });
  try { const html = f.render(); assert.match(html, /Synthetic project/); assert.match(html, /Previously loaded projects are shown/); assert.match(html, /role="alert"/); assert.doesNotMatch(html, /Synthetic upstream detail/); }
  finally { f.dispose(); }
});

test("failed refresh retains selected archived projects and retry only reads", async () => {
  const f = await fixture({ selected: true, error: new ApiRequestError(503) });
  try {
    assert.match(f.render(), /data-selection-count="1"/); f.setReadError(null); const before = f.reads();
    await f.button("Retry").onClick(); await setImmediate();
    assert.equal(f.reads(), before + 1); assert.equal(f.writes.length + f.deletes.length, 0); assert.match(f.render(), /checked=""/);
  } finally { f.dispose(); }
});

test("held archived-project Retry preserves content and disables the Retry control", async () => {
  const f = await fixture({ error: new ApiRequestError(503) }); let release = noop;
  try {
    release = f.holdRead(); f.setReadError(null); f.button("Retry").onClick(); await setImmediate();
    assert.match(f.render(), /Synthetic project/); assert.equal(f.button("Retry").disabled, true); assert.equal(f.observer.getCurrentResult().isFetching, true);
  } finally { release(); await setImmediate(); f.dispose(); }
});

for (const cached of [false, true]) {
  test(`${cached ? "empty-cache" : "initial"} archived-project error remains an explicit retryable error`, async () => {
    const f = await fixture({ cached, rows: [], error: new ApiRequestError(503) });
    try { assert.match(f.render(), /Could not load archived projects/); assert.ok(f.button("Retry")); }
    finally { f.dispose(); }
  });
}
for (const status of [401, 403, 404]) {
  test(`archived-project HTTP ${status} hides retained private rows and selection`, async () => {
    const f = await fixture({ error: new ApiRequestError(status), selected: true });
    try { assert.doesNotMatch(f.render(), /Synthetic project|data-selection-count|checked=""/); assert.ok(f.button("Retry")); }
    finally { f.dispose(); }
  });
}

test("a successful empty archive without a notice stays compact", async () => {
  const f = await fixture({ rows: [] });
  try { assert.equal(f.render(), ""); } finally { f.dispose(); }
});
test("active projects never appear as archived rows", async () => {
  const f = await fixture({ rows: [project(), project("synthetic-active", false)] });
  try { const html = f.render(); assert.match(html, /synthetic-archive-a/); assert.doesNotMatch(html, /synthetic-active/); }
  finally { f.dispose(); }
});
test("Chinese archived-project read recovery stays localized", async () => {
  const f = await fixture({ locale: "zh-CN", error: new ApiRequestError(503) });
  try { assert.match(f.render(), /项目更新失败，仍显示上次内容/); assert.ok(f.button("重试")); }
  finally { f.dispose(); }
});

for (const state of ["empty", "loading", "error"]) {
  test(`an acknowledged batch notice survives the ${state} content branch`, async () => {
    const f = await fixture({ rows: [], cached: state !== "loading", initialFetch: state !== "loading", notice: "Synthetic acknowledged completion",
      error: state === "error" ? new ApiRequestError(503) : null });
    let release = noop;
    try {
      if (state === "loading") { release = f.holdRead(); f.observer.refetch(); await setImmediate(); assert.equal(f.observer.getCurrentResult().isLoading, true); }
      assert.match(f.render(), /Synthetic acknowledged completion/); assert.match(f.render(), /role="status"/);
    } finally { release(); await setImmediate(); f.dispose(); }
  });
}

test("confirmed single restore settles and acknowledges before an actual held query refresh", async () => {
  const f = await fixture(); let release = noop;
  try {
    f.activate(); release = f.holdRead(); f.button("Restore").onClick(); await setImmediate();
    assert.equal(f.writes.length, 1); assert.equal(f.observer.getCurrentResult().isFetching, true);
    assert.equal(f.mutation.getCurrentResult().status, "success"); assert.match(f.render(), /Project restored/);
  } finally { release(); await f.pending; await setImmediate(); f.dispose(); }
});

test("ordinary invalidateQueries read failure does not invoke mutation onError (control)", async () => {
  const f = await fixture();
  try {
    f.activate(); f.setReadError(new ApiRequestError(503)); f.button("Restore").onClick(); await f.pending; await setImmediate();
    assert.equal(f.mutation.getCurrentResult().status, "success"); assert.doesNotMatch(f.render(), /Restore failed/);
  } finally { f.dispose(); }
});

test("confirmed restore publishes the canonical response to every existing project cache", async () => {
  const rows = [project(), project("synthetic-other")], f = await fixture({ rows });
  try {
    f.button("Restore").onClick(); await f.pending; await setImmediate();
    for (const key of f.keys) assert.deepEqual(f.client.getQueryData(key), [f.server()[0], rows[1]]);
    assert.deepEqual(f.writes, [{ id: rows[0].id, patch: { is_archived: false } }]);
  } finally { f.dispose(); }
});

test("restoring the last project keeps an acknowledgement when the archive is empty", async () => {
  const f = await fixture();
  try { f.activate(); f.button("Restore").onClick(); await f.pending; await setImmediate(); assert.match(f.render(), /Project restored/); assert.doesNotMatch(f.render(), /Synthetic project/); }
  finally { f.dispose(); }
});

test("bulk restore acknowledges and releases busy state before a held refresh", async () => {
  const f = await fixture({ selected: true }); let release = noop;
  try {
    f.activate(); release = f.holdRead(); f.button("Restore selected").onClick(); await setImmediate();
    assert.equal(f.writes.length, 1); assert.equal(f.states.get("bulkBusy"), false); assert.match(f.render(), /1 project.*restored/);
  } finally { release(); await setImmediate(); f.dispose(); }
});

test("partial bulk restore publishes confirmed rows and retains unconfirmed selection", async () => {
  const rows = [project(), project("synthetic-rejected")];
  const f = await fixture({ rows, selected: true, outcomes: { "synthetic-rejected": "rejected" } });
  try {
    f.button("Restore selected").onClick(); await setImmediate();
    assert.deepEqual([...f.states.get("selectedProjectIds")], [rows[1].id]);
    assert.equal(f.client.getQueryData(f.keys[0])[0].is_archived, false);
    assert.match(f.render(), /could not be confirmed/); assert.ok(f.button("Check restore result"));
  } finally { f.dispose(); }
});

test("a lost restore acknowledgement is uncertain, not proof that the project is still archived", async () => {
  const f = await fixture({ outcomes: { "synthetic-archive-a": "lost" } });
  try {
    f.button("Restore").onClick(); await f.pending.catch(noop); await setImmediate();
    assert.equal(f.server()[0].is_archived, false); const html = f.render();
    assert.doesNotMatch(html, /The project is still archived/); assert.match(html, /could not be confirmed/);
    assert.ok(f.button("Check restore result")); assert.equal(f.button("Restore").disabled, true);
  } finally { f.dispose(); }
});

test("checking a lost acknowledgement performs one read, confirms restore and never repeats PATCH", async () => {
  const f = await fixture({ outcomes: { "synthetic-archive-a": "lost" } });
  try {
    f.button("Restore").onClick(); await f.pending.catch(noop); f.render(); const before = f.reads();
    await f.button("Check restore result").onClick(); await setImmediate();
    assert.equal(f.reads(), before + 1); assert.equal(f.writes.length, 1); assert.match(f.render(), /1 project.*restored/);
    assert.doesNotMatch(f.render(), /Synthetic project/);
  } finally { f.dispose(); }
});

test("a failed explicit restore check keeps uncertainty and prevents a blind retry", async () => {
  const f = await fixture({ outcomes: { "synthetic-archive-a": "lost" } });
  try {
    f.button("Restore").onClick(); await f.pending.catch(noop); f.setReadError(new ApiRequestError(503)); f.render();
    await f.button("Check restore result").onClick(); await setImmediate();
    assert.match(f.render(), /Could not check the restore result/); assert.equal(f.button("Restore").disabled, true);
    f.button("Restore").onClick(); await setImmediate(); assert.equal(f.writes.length, 1); assert.ok(f.button("Check restore result"));
  } finally { f.dispose(); }
});

test("a successful check of still-archived projects enables only an explicit retry", async () => {
  const outcomes = { "synthetic-archive-a": "rejected" }, f = await fixture({ outcomes });
  try {
    f.button("Restore").onClick(); await f.pending.catch(noop); f.render();
    await f.button("Check restore result").onClick(); await setImmediate();
    assert.match(f.render(), /1 still archived/); assert.equal(f.writes.length, 1); assert.equal(f.button("Restore").disabled, false);
    outcomes["synthetic-archive-a"] = "ok"; f.button("Restore").onClick(); await f.pending;
    assert.equal(f.writes.length, 2);
  } finally { f.dispose(); }
});

test("a missing project in a successful restore check is unavailable, not a claimed restore", async () => {
  const f = await fixture({ outcomes: { "synthetic-archive-a": "lost" } });
  try {
    f.button("Restore").onClick(); await f.pending.catch(noop); f.setServer([]); f.render();
    await f.button("Check restore result").onClick(); await setImmediate();
    assert.match(f.render(), /1 unavailable/); assert.doesNotMatch(f.render(), /1 project.*restored/); assert.equal(f.writes.length, 1);
  } finally { f.dispose(); }
});

test("same-turn duplicate Restore callbacks admit one write", async () => {
  const f = await fixture(); let release = noop;
  try {
    release = f.holdWrite(); const restore = f.button("Restore"); restore.onClick(); restore.onClick(); await setImmediate();
    assert.equal(f.writes.length, 1);
  } finally { release(); await f.pending; await setImmediate(); f.dispose(); }
});

test("single restore pending also disables project deletion", async () => {
  const f = await fixture(); let release = noop;
  try {
    release = f.holdWrite(); f.button("Restore").onClick(); await setImmediate(); f.render();
    const remove = f.button(`Permanently delete project ${project().name}`); assert.equal(remove.disabled, true);
    remove.onClick(); await setImmediate(); assert.equal(f.deletes.length, 0);
  } finally { release(); await f.pending; await setImmediate(); f.dispose(); }
});

test("cancelling permanent deletion keeps the original projects and performs no reads or writes", async () => {
  const f = await fixture({ selected: true, confirm: false });
  try {
    const before = f.reads(); f.button("Delete selected").onClick(); await setImmediate();
    assert.equal(f.confirms(), 1); assert.equal(f.reads(), before); assert.equal(f.deletes.length, 0); assert.deepEqual(f.server(), [project()]);
  } finally { f.dispose(); }
});

test("confirmed final project-container deletion keeps its result and conversation-preservation copy", async () => {
  const f = await fixture({ selected: true });
  try {
    f.activate(); f.button("Delete selected").onClick(); await setImmediate(); await setImmediate();
    const html = f.render(); assert.match(html, /1 project.*deleted/); assert.match(html, /conversations remain in Unclassified/);
    assert.deepEqual(f.deletes, [project().id]);
  } finally { f.dispose(); }
});

for (const mode of ["single", "bulk"]) {
  for (const refresh of ["held", "failed"]) {
    test(`${mode} deletion acknowledges and invalidates all affected lists without waiting for a ${refresh} refresh`, async () => {
      const rows = mode === "bulk" ? [project(), project("synthetic-other")] : [project()];
      const f = await fixture({ rows, selected: mode === "bulk" });
      const affectedKeys = [["sidebar-conversations", "synthetic-scope"], ["conversations", "synthetic-scope"]];
      let release = noop;
      try {
        for (const key of affectedKeys) f.client.setQueryData(key, { synthetic: true });
        f.activate();
        if (refresh === "held") release = f.holdRead();
        else f.setReadError(new ApiRequestError(503));
        const before = f.reads();
        f.button(mode === "bulk" ? "Delete selected" : `Permanently delete project ${rows[0].name}`).onClick();
        await setImmediate();
        await setImmediate();

        assert.equal(f.confirms(), 1);
        assert.deepEqual(f.deletes, rows.map(row => row.id));
        assert.equal(f.writes.length, 0);
        assert.equal(f.reads(), before + 1);
        assert.equal(f.states.get("bulkBusy"), false);
        assert.equal(f.refs.get("actionBusy").current, false);
        assert.deepEqual([...f.states.get("selectedProjectIds")], []);
        for (const key of f.keys) assert.deepEqual(f.client.getQueryData(key), []);
        for (const key of [...f.keys, ...affectedKeys]) assert.equal(f.client.getQueryState(key).isInvalidated, true);

        const html = f.render();
        assert.match(html, new RegExp(`${rows.length} projects? deleted, 0 failed`));
        assert.match(html, /conversations remain in Unclassified/);
        assert.doesNotMatch(html, /Synthetic project/);
        assert.equal(f.observer.getCurrentResult().isFetching, refresh === "held");
        assert.equal(f.observer.getCurrentResult().isError, refresh === "failed");
        if (refresh === "failed") {
          assert.ok(f.button("Retry"));
          assert.match(html, /Could not load archived projects/);
        }
      } finally { release(); await setImmediate(); f.dispose(); }
    });
  }
}

test("old cancelled reads cannot replace a confirmed restored project", async () => {
  const f = await fixture(); let release = noop;
  try {
    f.activate(); release = f.holdRead(); const old = f.observer.refetch(); await setImmediate(); const oldSignal = f.signals.at(-1);
    f.button("Restore").onClick(); await setImmediate();
    assert.equal(oldSignal.aborted, true); assert.equal(f.client.getQueryData(f.keys[0])[0].is_archived, false);
    release(); await old; await f.pending; await setImmediate();
    assert.equal(f.client.getQueryData(f.keys[0])[0].is_archived, false);
  } finally { release(); await f.pending; await setImmediate(); f.dispose(); }
});

test("acknowledgement region is not inside a fetch-busy section during held refresh", async () => {
  const f = await fixture(); let release = noop;
  try {
    f.activate(); release = f.holdRead(); f.button("Restore").onClick(); await setImmediate();
    const html = f.render(); assert.match(html, /Project restored/);
    assert.doesNotMatch(html, /^<section[^>]*aria-busy="true"/);
  } finally { release(); await f.pending; await setImmediate(); f.dispose(); }
});

test("explicit check cancels an older background read instead of remaining disabled behind it", async () => {
  const f = await fixture({ outcomes: { "synthetic-archive-a": "lost" } }); let release = noop;
  try {
    f.button("Restore").onClick(); await f.pending.catch(noop);
    release = f.holdRead(); const previous = f.observer.refetch(); await setImmediate(); const signal = f.signals.at(-1);
    f.render(); const check = f.button("Check restore result"); assert.equal(check.disabled, false);
    f.allowNewReads(); check.onClick(); await setImmediate();
    assert.equal(signal.aborted, true); assert.match(f.render(), /1 project.*restored/); assert.equal(f.writes.length, 1);
    release(); await previous;
  } finally { release(); await setImmediate(); f.dispose(); }
});

test("delayed row removal retains the logical focus owner until focus is actually lost", async () => {
  const f = await fixture(); let focused = 0;
  const original = { isConnected: true };
  try {
    f.document.activeElement = original;
    f.button("Restore").onClick(); await f.pending; f.render();
    f.refs.get("noticeRef").current = { focus: () => { focused += 1; } };
    f.runEffects(); assert.equal(focused, 0);
    original.isConnected = false; f.document.activeElement = f.document.body;
    f.render(); f.runEffects(); assert.equal(focused, 1);
  } finally { f.dispose(); }
});

test("result focus never steals a later chosen control", async () => {
  const f = await fixture(); let focused = 0;
  const original = { isConnected: true }, chosen = { isConnected: true };
  try {
    f.document.activeElement = original; f.button("Restore").onClick(); await f.pending;
    original.isConnected = false; f.document.activeElement = chosen; f.render();
    f.refs.get("noticeRef").current = { focus: () => { focused += 1; } };
    f.runEffects(); assert.equal(focused, 0);
    f.document.activeElement = f.document.body; f.render(); f.runEffects(); assert.equal(focused, 0);
  } finally { f.dispose(); }
});

test("unmount before the restore response prevents later cache and notice publication", async () => {
  const f = await fixture(); let release = noop;
  try {
    const cleanups = f.runEffects(); release = f.holdWrite(); f.button("Restore").onClick(); await setImmediate();
    cleanups.forEach(cleanup => cleanup()); release(); await f.pending;
    assert.equal(f.client.getQueryData(f.keys[0])[0].is_archived, true); assert.equal(f.states.get("batchNotice"), null);
  } finally { release(); await f.pending; f.dispose(); }
});

test("same-turn duplicate Check callbacks issue one read and no extra write", async () => {
  const f = await fixture({ outcomes: { "synthetic-archive-a": "lost" } }); let release = noop;
  try {
    f.button("Restore").onClick(); await f.pending.catch(noop); f.render();
    const check = f.button("Check restore result"), before = f.reads(); release = f.holdRead();
    check.onClick(); check.onClick(); await setImmediate();
    assert.equal(f.reads(), before + 1); assert.equal(f.writes.length, 1);
  } finally { release(); await setImmediate(); f.dispose(); }
});

test("a project leaving the archive no longer counts as a selected actionable row", async () => {
  const original = project(), other = project("synthetic-other"), f = await fixture({ rows: [original, other], selected: true });
  try {
    f.states.set("selectedProjectIds", new Set([original.id]));
    f.setServer([{ ...original, is_archived: false }, other]); await f.observer.refetch();
    assert.match(f.render(), /data-selection-count="0"/); assert.equal(f.button("Delete selected").disabled, true);
    assert.equal(f.writes.length + f.deletes.length, 0);
  } finally { f.dispose(); }
});

test("a captured bulk Restore callback cannot submit a project that left the current archive", async () => {
  const original = project(), other = project("synthetic-other"), f = await fixture({ rows: [original, other], selected: true });
  try {
    f.states.set("selectedProjectIds", new Set([original.id])); f.render(); const restore = f.button("Restore selected");
    f.setServer([{ ...original, is_archived: false }, other]); await f.observer.refetch(); f.render();
    restore.onClick(); await setImmediate(); assert.equal(f.writes.length, 0); assert.equal(f.deletes.length, 0);
  } finally { f.dispose(); }
});

test("deletion rechecks current archive membership after the confirmation dialog", async () => {
  let confirm;
  const answer = new Promise(resolve => { confirm = resolve; });
  const original = project(), other = project("synthetic-other"), f = await fixture({ rows: [original, other], selected: true, confirm: answer });
  try {
    f.states.set("selectedProjectIds", new Set([original.id])); f.render(); f.button("Delete selected").onClick(); await setImmediate();
    assert.equal(f.confirms(), 1);
    f.setServer([{ ...original, is_archived: false }, other]); await f.observer.refetch(); f.render();
    confirm(true); await setImmediate(); assert.equal(f.deletes.length, 0); assert.equal(f.writes.length, 0);
    assert.match(f.render(), /project list changed/i);
  } finally { confirm(false); await setImmediate(); f.dispose(); }
});

test("a captured single Restore callback cannot act after its row has disappeared", async () => {
  const original = project(), f = await fixture();
  try {
    const restore = f.button("Restore"); f.setServer([{ ...original, is_archived: false }]); await f.observer.refetch(); f.render();
    restore.onClick(); await setImmediate(); assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});
