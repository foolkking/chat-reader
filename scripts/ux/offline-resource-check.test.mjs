import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/offline/library-shell.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("library-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ["LibrarySidebar", "summarizeScope", "formatBytes"].includes(n.name?.text));
assert.equal(declarations.length, 3);
const imports = ast.statements.filter(n => ts.isImportDeclaration(n) && ["react", "lucide-react"].includes(n.moduleSpecifier.text));
const compiled = ts.transpileModule([...imports, ...declarations].map(n => n.getText(ast)).join("\n") + "\nexport { LibrarySidebar };", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const noop = () => {};
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const textOf = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(textOf).join("") : textOf(node.props?.children);
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  return predicate(node) ? node : find(node.props?.children, predicate);
}

// Extracted, unmodified actual sidebar and summary functions. React lifecycle,
// inspection/storage and unrelated children are controlled doubles. Tests cover
// state/callback ordering, not browser layout, real IndexedDB or resource usage.
function fixture(locale = "en-US") {
  const hooks = [], effects = new Map(), requests = [], downloads = [], removals = [];
  let cursor = 0, tree, writesAfterDispose = 0, disposed = false;
  const props = { online: true, catalog: { projects: [], conversations: [{ id: "synthetic-a", revision: 3, estimated_bytes: 1024 }] },
    conversations: [{ id: "synthetic-a", offline_revision: 2 }], sidebarConversations: [{ id: "synthetic-a" }],
    unclassifiedConversations: [{ id: "synthetic-a" }], selectedId: "synthetic-a", groupedProjects: [], query: "", setQuery: noop,
    searchResults: [], searchState: "ready", onRetrySearch: noop, download: null, storage: null, assetMode: "small",
    offlineShellStatus: {}, error: null, failedDownload: null, suppressDesktopError: false, onClose: noop, onCollapse: noop,
    localRead: { phase: "ready", refreshing: false, refreshError: false }, onRetryLocalRead: noop,
    onOpen: noop, onDownload: (...args) => downloads.push(args), onRetryDownload: noop, onAssetModeChange: noop,
    onRetryShell: noop, onRemove: (...args) => removals.push(args) };
  const hook = init => { const i = cursor++; return hooks[i] ??= init(); };
  const react = { ...React,
    useState: init => { const h = hook(() => ({ value: typeof init === "function" ? init() : init }));
      return [h.value, value => { if (disposed) writesAfterDispose++; h.value = typeof value === "function" ? value(h.value) : value; }]; },
    useEffect: (fn, deps) => { const i = cursor, h = hook(() => ({})); if (!same(h.deps, deps)) { h.deps = deps; effects.set(i, fn); } },
  };
  const module = { exports: {} };
  const deps = { usePreferences: () => ({ resolvedLocale: locale }), usableOfflineRevisions: mode => {
    const d = deferred(); requests.push({ ...d, mode }); return d.promise;
  }, OfflineShellIndicator: "OfflineShellIndicator", SearchResultList: "SearchResultList", ProjectRows: "ProjectRows",
  ConversationRows: "ConversationRows", SidebarPreferences: "SidebarPreferences" };
  new Function("require", "exports", ...Object.keys(deps), compiled)(name => name === "react" ? react : require(name), module.exports, ...Object.values(deps));
  const render = () => { cursor = 0; return tree = module.exports.LibrarySidebar(props); };
  const button = label => { const n = find(tree, node => node.type === "button" && (node.props["aria-label"] ?? textOf(node)) === label); assert.ok(n, `Missing button: ${label}`); return n.props; };
  const flush = () => { for (const [i, fn] of effects) { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); } effects.clear(); };
  const dispose = () => { disposed = true; for (const h of hooks) h.cleanup?.(); };
  render(); flush();
  return { props, requests, downloads, removals, render, button, flush, dispose, writesAfterDispose: () => writesAfterDispose,
    async reject(index = requests.length - 1) { requests[index].reject(new Error("Synthetic private storage detail")); await setImmediate(); return render(); },
    async resolve(revisions, index = requests.length - 1) { requests[index].resolve(revisions); await setImmediate(); return render(); },
  };
}

for (const locale of ["en-US", "zh-CN"]) test(`${locale}: failed inspection ends waiting and exposes read-only retry`, async () => {
  const f = fixture(locale);
  try {
    const tree = await f.reject();
    assert.match(textOf(tree), locale === "en-US" ? /Could not check offline resources/ : /无法检查离线资源/);
    assert.doesNotMatch(textOf(tree), /Checking offline resources|正在检查离线资源|Synthetic private storage detail|library is up to date/);
    const retry = locale === "en-US" ? "Retry resource check" : "重新检查离线资源";
    f.button(retry).onClick(); f.render(); f.flush();
    assert.equal(f.requests.length, 2); assert.deepEqual(f.requests.map(r => r.mode), ["small", "small"]);
    assert.deepEqual(f.downloads, []); assert.deepEqual(f.removals, []);
    assert.equal(f.button(locale === "en-US" ? "Checking offline resources" : "正在检查离线资源").disabled, true);
    await f.resolve({ "synthetic-a": 2 });
    const update = f.button(locale === "en-US" ? "Update 1 conversations · 1.0 KB" : "更新 1 个对话 · 1.0 KB");
    assert.equal(update.disabled, false); assert.deepEqual(f.downloads, []);
    update.onClick(); assert.deepEqual(f.downloads, [["all"]]);
  } finally { f.dispose(); }
});

test("repeated rejection remains retryable and never claims copies are current", async () => {
  const f = fixture();
  try { await f.reject(); f.button("Retry resource check").onClick(); f.render(); f.flush();
    assert.match(textOf(await f.reject()), /Could not check offline resources/); assert.equal(f.requests.length, 2);
    assert.ok(f.button("Retry resource check")); assert.deepEqual(f.downloads, []); }
  finally { f.dispose(); }
});

test("successful current revisions show up-to-date; unknown copies remain downloadable", async () => {
  const f = fixture();
  try {
    await f.resolve({ "synthetic-a": 3 }); assert.equal(f.button("Offline library is up to date").disabled, true);
    f.props.conversations = [...f.props.conversations]; f.render(); f.flush(); await f.resolve({});
    assert.equal(f.button("Update 1 conversations · 1.0 KB").disabled, false);
  } finally { f.dispose(); }
});

for (const scope of ["assetMode", "conversations"]) test(`${scope} change invalidates ready state before effects run`, async () => {
  const f = fixture();
  try {
    await f.resolve({ "synthetic-a": 2 }); assert.equal(f.button("Update 1 conversations · 1.0 KB").disabled, false);
    if (scope === "assetMode") f.props.assetMode = "all"; else f.props.conversations = [...f.props.conversations];
    f.render(); assert.equal(f.button("Checking offline resources").disabled, true);
    f.flush(); await f.resolve({ "synthetic-a": 3 }); assert.equal(f.button("Offline library is up to date").disabled, true);
  } finally { f.dispose(); }
});

for (const stale of ["success", "failure"]) test(`late previous-scope ${stale} cannot replace the latest result`, async () => {
  const f = fixture();
  try {
    f.props.assetMode = "all"; f.render(); f.flush(); await f.resolve({ "synthetic-a": 3 }, 1);
    if (stale === "success") await f.resolve({}, 0); else await f.reject(0);
    assert.equal(f.button("Offline library is up to date").disabled, true); assert.equal(f.requests.length, 2);
  } finally { f.dispose(); }
});

test("closing the sidebar fences late completion", async () => {
  const f = fixture(); f.dispose(); await f.reject(); assert.equal(f.writesAfterDispose(), 0);
});

test("inspection error leaves downloaded conversation rows and selection intact", async () => {
  const f = fixture();
  try {
    const tree = await f.reject(), rows = find(tree, n => n.type === "ConversationRows");
    assert.equal(rows.props.rows, f.props.unclassifiedConversations); assert.equal(rows.props.selectedId, "synthetic-a");
    assert.deepEqual(f.removals, []); assert.deepEqual(f.downloads, []);
    f.props.online = false; assert.doesNotMatch(textOf(f.render()), /Retry resource check/);
  } finally { f.dispose(); }
});
