import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/offline/library-shell.tsx");
const ast = ts.createSourceFile("library-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const list = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SearchResultList");
const metadata = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "metadataNumber");
const shell = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LibraryShell");
const opener = shell.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "openSearchResult");
assert.ok(list && metadata && opener);
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const compiled = compile(`${list.getText(ast)} ${metadata.getText(ast)} ${opener.getText(ast)}
  exports.list = SearchResultList; exports.open = openSearchResult;`);
const targets = {};
new Function("exports", compile(read("features/search/search-result-target.ts")))(targets);
const same = (left, right) => left && right && left.length === right.length
  && left.every((value, index) => Object.is(value, right[index]));
const walk = node => Array.isArray(node) ? node.flatMap(walk)
  : !node || typeof node !== "object" || !node.props ? [] : [node, ...walk(node.props.children)];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const item = id => ({ id, conversation_id: "synthetic-conversation", message_id: `message-${id}`,
  document_type: "message", title: `Synthetic ${id}`, plain_text: "needle body", metadata: {} });
const A = item("A"), B = item("B");
const projected = item => ({ ...item, document_id: item.id, message_version_id: `version-${item.id}`,
  matches: [{ block_index: 2, render_block_id: `block-${item.id}`, match_start: 14, match_end: 20, quote: "needle" }] });

// Actual list/activation and parent opener. Hooks/layout, routing/storage and
// asynchronous canonical projection are controlled adapters, not mounted DOM.
// Real projection/ranges and real FlexSearch have separate regression files.
function fixture({ project = async item => projected(item), locale = "en-US" } = {}) {
  const slots = [], layouts = [];
  const calls = { projects: [], routes: [], replays: [], legacy: [], selected: [], mobile: [], storage: [], writes: 0 };
  let replay = null;
  let cursor = 0, tree, route = "conversationId=synthetic-conversation";
  let props = { items: [A, B], query: "needle", conversations: [] };
  const slot = make => { const index = cursor++; return slots[index] ?? (slots[index] = make()); };
  const useState = initial => {
    const state = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
    return [state.value, next => { calls.writes++; state.value = typeof next === "function" ? next(state.value) : next; }];
  };
  const useMemo = (make, deps) => {
    const state = slot(() => ({}));
    if (!same(state.deps, deps)) Object.assign(state, { deps, value: make() });
    return state.value;
  };
  const useLayoutEffect = (effect, deps) => {
    const state = slot(() => ({}));
    if (!same(state.deps, deps)) {
      state.deps = deps;
      layouts.push(() => { state.cleanup?.(); state.cleanup = effect(); });
    }
  };
  const exports = {};
  new Function("require", "exports", "usePreferences", "useSearchParams", "useMemo", "useLayoutEffect", "useState",
    "resolveOfflineSearchResult", "setSelectedId", "setMobileOpen", "window", "LAST_LIBRARY_CONVERSATION_KEY",
    "router", "searchResultHref", "matchesLibrarySearchTarget", "searchParams", "setSearchReplay", compiled)(name => {
    assert.equal(name, "react/jsx-runtime"); return require(name);
  }, exports, () => ({ resolvedLocale: locale }), () => ({ toString: () => route }), useMemo, useLayoutEffect, useState,
  (item, query) => { calls.projects.push({ item, query }); return project(item, query); },
  value => calls.selected.push(value), value => calls.mobile.push(value),
  { localStorage: { setItem: (...args) => calls.storage.push(args) } }, "synthetic-last-library-key",
  { replace: href => calls.routes.push(href) }, targets.searchResultHref, targets.matchesLibrarySearchTarget,
  { toString: () => route }, next => { replay = next(replay); calls.replays.push(replay); });
  props.onOpen = (...args) => calls.legacy.push(args);
  props.onOpenSearchResult = exports.open;
  const render = () => {
    cursor = 0; tree = exports.list(props);
    for (const layout of layouts.splice(0)) layout();
  };
  const buttons = () => walk(tree).filter(node => node.type === "button");
  render();
  return {
    calls, render,
    click(index, { renderAfter = true } = {}) { buttons()[index].props.onClick(); if (renderAfter) render(); },
    change(patch) { props = { ...props, ...patch }; render(); },
    route(value) { route = value; render(); },
    failures() { return walk(tree).filter(node => node.props.role === "alert").map(node => node.props.children); },
    busy() { return buttons().filter(node => node.props["aria-busy"]).length; },
    dispose() { for (const state of slots) state.cleanup?.(); },
  };
}

test("a body result projects its current query and routes exact identity/range through /library", async () => {
  const f = fixture();
  try {
    f.click(0); await setImmediate(); f.render();
    assert.deepEqual(f.calls.projects, [{ item: A, query: "needle" }]);
    const url = new URL(f.calls.routes[0], "https://example.invalid");
    assert.equal(url.pathname, "/library");
    assert.equal(url.searchParams.get("conversationId"), A.conversation_id);
    assert.equal(url.searchParams.get("renderBlockId"), "block-A");
    assert.equal(url.searchParams.get("characterOffset"), "14");
    assert.equal(url.searchParams.get("endCharacterOffset"), "20");
    assert.equal(url.searchParams.has("quote"), false);
    assert.deepEqual(f.calls.selected, [A.conversation_id]);
    assert.deepEqual(f.calls.mobile, [false]);
  } finally { f.dispose(); }
});

test("a repeated click cannot start a second read even before React commits pending feedback", async () => {
  const held = deferred(), f = fixture({ project: () => held.promise });
  try {
    f.click(0, { renderAfter: false }); f.click(0, { renderAfter: false }); f.render();
    assert.equal(f.calls.projects.length, 1);
    assert.equal(f.busy(), 1);
    held.resolve(projected(A)); await setImmediate(); f.render();
    assert.equal(f.calls.routes.length, 1);
    assert.equal(f.busy(), 0);
  } finally { f.dispose(); }
});

test("after completing a navigation, the same target can replay without a URL nonce", async () => {
  const f = fixture();
  try {
    f.click(0); await setImmediate(); f.render();
    assert.deepEqual(f.calls.replays, []);
    const href = f.calls.routes[0];
    // Noncanonical parameter order and an expanded annotation panel do not
    // change the actual destination.
    const params = new URLSearchParams(href.split("?")[1]);
    const reordered = new URLSearchParams([...params].reverse());
    reordered.set("annotation_layout", "expanded");
    reordered.set("annotations", "open");
    f.route(reordered.toString());
    f.click(0); await setImmediate(); f.render();
    f.route(href.split("?")[1]);
    f.click(0); await setImmediate(); f.render();
    assert.deepEqual(f.calls.replays, [{ href, sequence: 1 }, { href, sequence: 2 }]);
    assert.deepEqual(f.calls.routes, [href], "equivalent targets must not request routing/RSC again");
    f.click(1); await setImmediate(); f.render();
    assert.equal(f.calls.replays.length, 2, "a different target uses the URL effect, not the previous replay");
    assert.equal(f.calls.routes.length, 2);
    assert.equal(new URL(f.calls.routes[1], "https://example.invalid").searchParams.get("messageId"), B.message_id);
  } finally { f.dispose(); }
});

for (const kind of ["attachment", "annotation"]) {
  test(`the same ${kind} result reopens its target in memory without another route request`, async () => {
    const f = fixture({ project: async item => ({
      ...projected(item), document_type: kind,
      ...(kind === "attachment" ? { attachment_id: "synthetic-attachment" } : { annotation_id: "synthetic-annotation" }),
    }) });
    try {
      f.click(0); await setImmediate(); f.render();
      const href = f.calls.routes[0];
      const params = new URLSearchParams(href.split("?")[1]);
      params.set("annotation_layout", "expanded");
      f.route(params.toString());
      f.click(0); await setImmediate(); f.render();
      assert.deepEqual(f.calls.routes, [href]);
      assert.deepEqual(f.calls.replays, [{ href, sequence: 1 }]);
      assert.deepEqual(f.calls.mobile, [false, false]);
      assert.deepEqual(f.calls.selected, [A.conversation_id, A.conversation_id]);
    } finally { f.dispose(); }
  });
}

test("only the latest deliberately selected result can publish its navigation", async () => {
  const first = deferred(), second = deferred();
  const f = fixture({ project: item => item.id === A.id ? first.promise : second.promise });
  try {
    f.click(0); f.click(1);
    second.resolve(projected(B)); await setImmediate();
    first.resolve(projected(A)); await setImmediate(); f.render();
    assert.equal(f.calls.routes.length, 1);
    assert.equal(new URL(f.calls.routes[0], "https://example.invalid").searchParams.get("messageId"), B.message_id);
    assert.deepEqual(f.failures(), []);
  } finally { f.dispose(); }
});

for (const transition of ["query", "items", "route", "unmount"]) {
  for (const outcome of ["success", "failure"]) {
    test(`${transition} retires a late ${outcome} without reopening a result or publishing feedback`, async () => {
      const held = deferred(), f = fixture({ project: () => held.promise });
      try {
        f.click(0);
        if (transition === "query") f.change({ query: "different" });
        if (transition === "items") f.change({ items: [B] });
        if (transition === "route") f.route("conversationId=synthetic-other");
        if (transition === "unmount") f.dispose();
        const writes = f.calls.writes;
        if (outcome === "success") held.resolve(projected(A)); else held.reject(Error("Synthetic unavailable read"));
        await setImmediate();
        assert.equal(f.calls.writes, writes);
        assert.deepEqual(f.calls.routes, []);
      } finally { f.dispose(); }
    });
  }
}

test("a failed projection retains the result and can be retried explicitly", async () => {
  let fail = true;
  const f = fixture({ project: async item => { if (fail) throw Error("Synthetic unavailable read"); return projected(item); } });
  try {
    f.click(0); await setImmediate(); f.render();
    assert.match(f.failures()[0], /local copy is retained/);
    assert.equal(f.calls.routes.length, 0);
    fail = false; f.click(0); await setImmediate(); f.render();
    assert.deepEqual(f.failures(), []);
    assert.equal(f.calls.routes.length, 1);
  } finally { f.dispose(); }
});

test("description and notebook results preserve their old opening behavior and retire a pending body result", async () => {
  const held = deferred(), f = fixture({ project: () => held.promise });
  try {
    const description = { ...item("description"), document_type: "description", message_id: null, metadata: {} };
    f.change({ items: [A, description] });
    f.click(0); f.click(1);
    held.resolve(projected(A)); await setImmediate();
    assert.deepEqual(f.calls.legacy, [[description.conversation_id, null, null, null]]);
    assert.deepEqual(f.calls.routes, []);
    const notebook = { ...description, id: "notebook", document_type: "notebook" };
    f.change({ items: [notebook] }); f.click(0);
    assert.equal(f.calls.legacy.length, 2);
    assert.equal(f.calls.projects.length, 1);
  } finally { f.dispose(); }
});
