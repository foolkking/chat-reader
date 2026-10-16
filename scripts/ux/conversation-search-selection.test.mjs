import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/search/conversation-search-panel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const match = (name, start = 10) => {
  const quote = `Synthetic match ${name}`;
  return { render_block_id: `synthetic-block-${name}`, block_index: 3,
    match_start: start, match_end: start + quote.length, quote,
    context_before: `Synthetic before ${name}`, context_after: `Synthetic after ${name}` };
};
const item = name => ({ document_id: `synthetic-document-${name}`, document_type: "message",
  conversation_id: "synthetic-conversation", conversation_title: "Synthetic conversation",
  message_id: `synthetic-message-${name}`, message_version_id: `synthetic-version-${name}`,
  role: "assistant", order_key: "0001", block_index: 3, render_block_id: `synthetic-block-${name}`,
  character_offset: 10, snippet: `Synthetic snippet ${name}`, rank: 1, source_profile: null,
  occurrence_count: 1, matches: [match(name)] });
const A = item("A"), B = item("B");
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const walk = node => Array.isArray(node) ? node.flatMap(walk)
  : !node || typeof node !== "object" || !node.props ? [] : [node, ...walk(node.props.children)];
const initial = { query: "synthetic", documentType: "message", role: "all", activeIndex: 0 };

// Actual compiled panel/handlers; hooks, effects, query state, timers and
// navigation are controlled adapters, not mounted React/browser/search evidence.
function fixture({ items = [A, B], locale = "en-US", initialState = initial, navigate, mode = "remote" } = {}) {
  const slots = [], effects = [], layouts = [], timers = new Map();
  const calls = { states: [], navigation: [], owners: [], events: [], closes: 0, writes: 0 };
  let cursor = 0, timer = 0, tree, options, rows = items, queryState = {};
  const slot = make => { const index = cursor++; return slots[index] ?? (slots[index] = make()); };
  const react = {
    useState: make => {
      const state = slot(() => ({ value: typeof make === "function" ? make() : make }));
      return [state.value, next => { calls.writes++; state.value = typeof next === "function" ? next(state.value) : next; }];
    },
    useRef: value => slot(() => ({ current: value })),
    useMemo: (make, deps) => {
      const state = slot(() => ({}));
      if (!same(state.deps, deps)) Object.assign(state, { deps, value: make() });
      return state.value;
    },
    useEffect: (effect, deps) => {
      const state = slot(() => ({}));
      if (!same(state.deps, deps)) {
        state.deps = deps;
        effects.push(() => { state.cleanup?.(); state.cleanup = effect(); });
      }
    },
    useLayoutEffect: (effect, deps) => {
      const state = slot(() => ({}));
      if (!same(state.deps, deps)) {
        state.deps = deps;
        layouts.push(() => { state.cleanup?.(); state.cleanup = effect(); });
      }
    },
  };
  const dataSource = { mode, searchConversation: () => { throw Error("Selection fixture must not issue a search"); } };
  let props = { conversationId: "synthetic-conversation", sourceKey: "synthetic-source", dataSource, initialState,
    onStateChange: state => { calls.states.push(state); calls.events.push(["state", state]); },
    onNavigate: async (target, context, isCurrent) => {
      calls.navigation.push({ target, context }); calls.events.push(["navigate"]);
      calls.owners.push(isCurrent);
      return navigate ? navigate(target, context, isCurrent) : { ok: true, targetId: "synthetic-target" };
    },
    onClose: () => { calls.closes++; calls.events.push(["close"]); },
  };
  const stubs = {
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQuery: next => {
      options = next; return { data: { items: rows }, isError: false, isFetching: false, refetch: async () => {}, ...queryState };
    } },
    "lucide-react": { Search: () => null, X: () => null },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../lib/reader-data-source": { remoteReaderDataSource: dataSource },
    "../../lib/offline-access": { captureOfflineAccess: () => 1, assertOfflineAccess: () => {} },
  };
  const exports = {};
  new Function("require", "exports", "window", compiled)(name => {
    assert.ok(Object.hasOwn(stubs, name), `Unexpected import ${name}`); return stubs[name];
  }, exports, {
    setTimeout: callback => { const id = ++timer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const render = () => {
    cursor = 0; tree = exports.ConversationSearchPanel(props);
    for (const layout of layouts.splice(0)) layout();
    for (const effect of effects.splice(0)) effect();
  };
  const input = () => walk(tree).find(node => node.type === "input").props;
  const resultRows = () => walk(tree).filter(node => node.type === "button" && node.props.onMouseEnter);
  const rowMatch = node => walk(node).find(child => typeof child.props.match === "string")?.props.match;
  const timersRun = () => {
    const callbacks = [...timers.values()]; timers.clear();
    for (const callback of callbacks) callback(); render();
  };
  render();
  return {
    calls, render, get options() { return options; },
    change(patch) { props = { ...props, ...patch }; render(); },
    setItems(next) { rows = next; render(); },
    setQueryState(next) { queryState = next; render(); },
    type(value, { debounce = true } = {}) {
      input().onChange({ target: { value } }); render(); if (debounce) timersRun();
    },
    filter(index, value) {
      walk(tree).filter(node => node.type === "select")[index].props.onChange({ target: { value } }); render();
    },
    key(key, extra = {}) {
      input().onKeyDown({ key, keyCode: 0, nativeEvent: { isComposing: false }, preventDefault() {}, ...extra }); render();
    },
    hover(index) { resultRows()[index].props.onMouseEnter(); render(); },
    click(index, { renderAfter = true } = {}) { resultRows()[index].props.onClick(); if (renderAfter) render(); },
    close() { walk(tree).find(node => node.type === "button" && /^(Close|关闭)$/.test(node.props["aria-label"])).props.onClick(); },
    pending() { return walk(tree).some(node => node.props.role === "status"
      && typeof node.props.children === "string" && /Locating match|正在定位匹配/.test(node.props.children)); },
    failure() { return walk(tree).filter(node => node.props.role === "alert")
      .map(node => node.props.children).filter(value => typeof value === "string").join(" "); },
    busy() { return resultRows().filter(node => node.props["aria-busy"]).map(rowMatch); },
    selected() { return resultRows().filter(node => /(?:^|\s)bg-subtle(?:\s|$)/.test(node.props.className)).map(rowMatch); },
    missingNotice() { return walk(tree).some(node => node.props.role === "status"
      && typeof node.props.children === "string" && /selected match|此前选中的匹配/.test(node.props.children)); },
    dispose() { for (const state of slots) state.cleanup?.(); timers.clear(); },
  };
}

test("first-result and legacy numeric state remain supported, with arrows based on the visible clamped row", async () => {
  for (const activeIndex of [0, 99]) {
    const f = fixture({ initialState: { ...initial, activeIndex } });
    try {
      assert.deepEqual(f.selected(), [activeIndex ? "Synthetic match B" : "Synthetic match A"]);
      if (activeIndex) f.key("ArrowUp");
      f.key("Enter"); await setImmediate();
      assert.equal(f.calls.navigation[0].target.messageId, A.message_id);
      assert.equal(f.calls.closes, 1);
    } finally { f.dispose(); }
  }
});

for (const locale of ["en-US", "zh-CN"]) {
  for (const method of ["keyboard", "hover"]) {
    test(`${locale}: ${method} selection follows an exact occurrence through document reorder`, async () => {
      const f = fixture({ locale });
      try {
        if (method === "keyboard") f.key("ArrowDown"); else f.hover(1);
        f.setItems([B, A]);
        assert.deepEqual(f.selected(), ["Synthetic match B"]);
        assert.equal(f.calls.states.at(-1).activeIndex, 0);
        f.key("Enter"); await setImmediate();
        const expectedB = {
          messageId: B.message_id, messageVersionId: B.message_version_id, renderBlockId: B.matches[0].render_block_id,
          blockIndex: 3, characterOffset: 10, endCharacterOffset: 10 + B.matches[0].quote.length, quote: B.matches[0].quote,
          prefix: B.matches[0].context_before, suffix: B.matches[0].context_after,
        };
        const expectedA = {
          messageId: A.message_id, messageVersionId: A.message_version_id, renderBlockId: A.matches[0].render_block_id,
          blockIndex: 3, characterOffset: 10, endCharacterOffset: 10 + A.matches[0].quote.length, quote: A.matches[0].quote,
          prefix: A.matches[0].context_before, suffix: A.matches[0].context_after,
        };
        assert.deepEqual(f.calls.navigation[0], { target: expectedB,
          context: { query: "synthetic", index: 0, targets: [expectedB, expectedA] } });
      } finally { f.dispose(); }
    });
  }
}

test("two matches in the same document keep separate identities when their order changes", async () => {
  const first = match("first", 10), second = match("second", 50);
  const f = fixture({ items: [{ ...A, matches: [first, second], occurrence_count: 2 }] });
  try {
    f.key("ArrowDown");
    f.setItems([{ ...A, matches: [second, first], occurrence_count: 2 }]);
    assert.deepEqual(f.selected(), [second.quote]);
    f.key("Enter"); await setImmediate();
    assert.equal(f.calls.navigation[0].target.characterOffset, 50);
    assert.equal(f.calls.navigation[0].context.index, 0);
  } finally { f.dispose(); }
});

test("a removed selection has no replacement highlight or Enter navigation and exposes a neutral recovery notice", async () => {
  const f = fixture();
  try {
    f.hover(1); f.setItems([A]);
    assert.deepEqual(f.selected(), []);
    assert.equal(f.missingNotice(), true);
    f.key("Enter"); await setImmediate();
    assert.deepEqual(f.calls.navigation, []);
    assert.equal(f.calls.closes, 0);
  } finally { f.dispose(); }
});

test("the missing-selection notice waits for confirmed non-fetching search results", () => {
  const f = fixture();
  try {
    f.hover(1); f.setQueryState({ isFetching: true }); f.setItems([A]);
    assert.equal(f.missingNotice(), false);
    f.setQueryState({ isError: true });
    assert.equal(f.missingNotice(), false);
    f.setQueryState({});
    assert.equal(f.missingNotice(), true);
  } finally { f.dispose(); }
});

for (const arrow of ["ArrowUp", "ArrowDown"]) {
  test(`${arrow} starts at a real row after an eight-to-two shrink removes the selected match`, async () => {
    const items = Array.from({ length: 8 }, (_, index) => item(String(index)));
    const f = fixture({ items });
    try {
      f.hover(7); f.setItems(items.slice(0, 2)); f.key(arrow);
      assert.deepEqual(f.selected(), [items[0].matches[0].quote]);
      assert.equal(f.missingNotice(), false);
      f.key("Enter"); await setImmediate();
      assert.equal(f.calls.navigation[0].target.messageId, items[0].message_id);
    } finally { f.dispose(); }
  });
}

test("activation publishes its identity before navigation or a later effect, and a remount restores it after reorder", async () => {
  const f = fixture(), restored = [];
  try {
    f.click(1, { renderAfter: false });
    const state = f.calls.states.at(-1);
    assert.ok(state.activeOccurrenceKey);
    assert.equal(state.activeIndex, 1);
    assert.equal(f.calls.events.at(-2)[0], "state");
    assert.equal(f.calls.events.at(-1)[0], "navigate");
    await setImmediate();
    assert.equal(f.calls.closes, 1);
    const returned = fixture({ items: [B, A], initialState: state }); restored.push(returned);
    assert.deepEqual(returned.selected(), ["Synthetic match B"]);
    returned.key("Enter"); await setImmediate();
    assert.equal(returned.calls.navigation[0].target.messageId, B.message_id);
  } finally { f.dispose(); for (const f of restored) f.dispose(); }
});

test("query and role/type edits clear explicit identity while stale debounced results remain non-navigable", async () => {
  const f = fixture();
  try {
    f.hover(1); f.type("different", { debounce: false });
    assert.equal(f.calls.states.at(-1).activeOccurrenceKey, null);
    f.key("Enter"); await setImmediate();
    assert.deepEqual(f.calls.navigation, []);
    f.type("different");
    assert.deepEqual(f.selected(), ["Synthetic match A"]);
    f.hover(1); f.filter(0, "user");
    assert.equal(f.calls.states.at(-1).activeOccurrenceKey, null);
    assert.deepEqual(f.selected(), ["Synthetic match A"]);
    f.hover(1); f.filter(1, "code");
    assert.equal(f.calls.states.at(-1).activeOccurrenceKey, null);
    assert.deepEqual(f.selected(), ["Synthetic match A"]);
    assert.deepEqual(f.options.queryKey, ["conversation-search", "synthetic-source", "synthetic-conversation", "different", "code", "user"]);
  } finally { f.dispose(); }
});

test("IME composition keeps selection and navigation unchanged", async () => {
  const f = fixture();
  try {
    f.key("ArrowDown", { nativeEvent: { isComposing: true } });
    f.key("Enter", { keyCode: 229 }); await setImmediate();
    assert.deepEqual(f.selected(), ["Synthetic match A"]);
    assert.deepEqual(f.calls.navigation, []);
  } finally { f.dispose(); }
});

test("changed version/range/quote is not substituted for the selected occurrence; context-only refresh remains navigable", async () => {
  const variants = [
    { ...B, message_version_id: "synthetic-new-version" },
    { ...B, matches: [{ ...B.matches[0], match_start: 11, match_end: 11 + B.matches[0].quote.length }] },
    { ...B, matches: [{ ...B.matches[0], quote: "Synthetic match C" }] },
  ];
  for (const changed of variants) {
    const f = fixture();
    try {
      f.hover(1); f.setItems([A, changed]); f.key("Enter"); await setImmediate();
      assert.deepEqual(f.selected(), []);
      assert.deepEqual(f.calls.navigation, []);
    } finally { f.dispose(); }
  }
  const f = fixture();
  try {
    f.hover(1);
    f.setItems([A, { ...B, matches: [{ ...B.matches[0], context_before: "Synthetic refreshed prefix" }] }]);
    assert.deepEqual(f.selected(), ["Synthetic match B"]);
    f.key("Enter"); await setImmediate();
    assert.equal(f.calls.navigation[0].target.prefix, "Synthetic refreshed prefix");
  } finally { f.dispose(); }
});

test("fallback matches retain exact existing locator fields; title-only documents do not become navigable occurrences", async () => {
  const f = fixture({ mode: "offline", items: [{ ...A, message_id: null }, { ...B, matches: [] }] });
  try {
    f.key("Enter"); await setImmediate();
    const { target, context } = f.calls.navigation[0];
    assert.equal(target.messageId, B.message_id);
    assert.equal(target.characterOffset, 10);
    assert.equal(target.endCharacterOffset, 10 + B.snippet.length);
    assert.equal(target.quote, B.snippet);
    assert.equal(context.targets.length, 1);
    assert.equal(f.options.networkMode, "always");
    assert.equal(f.options.enabled, true);
  } finally { f.dispose(); }
});

test("same pending occurrence is admitted once across repeated clicks, Enter and result reorder", async () => {
  const hold = deferred(), f = fixture({ navigate: () => hold.promise });
  try {
    f.click(0, { renderAfter: false }); f.click(0, { renderAfter: false });
    f.key("Enter");
    assert.equal(f.calls.navigation.length, 1);
    assert.equal(f.pending(), true);
    assert.deepEqual(f.busy(), ["Synthetic match A"]);
    f.setItems([B, A]); f.click(1);
    assert.equal(f.calls.navigation.length, 1);
    assert.deepEqual(f.busy(), ["Synthetic match A"]);
    hold.resolve({ ok: false, targetId: "synthetic-target", reason: "cancelled" });
    await setImmediate(); f.render();
    assert.equal(f.pending(), false);
    assert.deepEqual(f.busy(), []);
    assert.equal(f.failure(), "");
    assert.equal(f.calls.closes, 0);
  } finally { f.dispose(); }
});

for (const completion of ["success", "failure", "reject"]) {
  test(`a superseded ${completion} cannot close, report failure or clear the newer activation`, async () => {
    const first = deferred(), second = deferred();
    const f = fixture({ navigate: target => target.messageId === A.message_id ? first.promise : second.promise });
    try {
      f.click(0); f.click(1);
      assert.equal(f.calls.navigation.length, 2);
      assert.equal(f.calls.owners[0](), false);
      assert.equal(f.calls.owners[1](), true);
      const writes = f.calls.writes;
      if (completion === "reject") first.reject(Error("Synthetic private failure detail"));
      else first.resolve({ ok: completion === "success", targetId: "synthetic-A", reason: "load-failed" });
      await setImmediate(); f.render();
      assert.equal(f.calls.writes, writes);
      assert.equal(f.calls.closes, 0);
      assert.equal(f.failure(), "");
      assert.equal(f.pending(), true);
      assert.deepEqual(f.busy(), ["Synthetic match B"]);
      second.resolve({ ok: true, targetId: "synthetic-B" });
      await setImmediate(); f.render();
      assert.equal(f.calls.closes, 1);
      assert.equal(f.pending(), false);
      assert.equal(f.calls.owners[1](), false);
      assert.equal(f.calls.states.at(-1).activeIndex, 1);
    } finally { f.dispose(); }
  });
}

const retirements = [
  ["raw query before debounce", f => f.type("new synthetic query", { debounce: false })],
  ["role", f => f.filter(0, "user")],
  ["document type", f => f.filter(1, "code")],
  ["conversation", f => f.change({ conversationId: "synthetic-other-conversation" })],
  ["source key", f => f.change({ sourceKey: "synthetic-other-source" })],
  ["data source", f => f.change({ dataSource: { mode: "offline" } })],
  ["hidden desktop panel", f => f.change({ active: false })],
  ["local close", f => f.close()],
  ["Escape", f => f.key("Escape")],
  ["unmount", f => f.dispose()],
];
for (const [name, retire] of retirements) {
  for (const rejects of [false, true]) {
    test(`${name} retires a later ${rejects ? "rejection" : "success"} without completion writes or another close`, async () => {
      const hold = deferred(), f = fixture({ navigate: () => hold.promise });
      try {
        f.click(0); retire(f);
        assert.equal(f.calls.owners[0](), false);
        const writes = f.calls.writes, closes = f.calls.closes;
        if (rejects) hold.reject(Error("Synthetic private failure detail"));
        else hold.resolve({ ok: true, targetId: "synthetic-target" });
        await setImmediate();
        assert.equal(f.calls.writes, writes);
        assert.equal(f.calls.closes, closes);
      } finally { f.dispose(); }
    });
  }
}

test("hiding and reopening desktop search permits a fresh intent without reviving the old one", async () => {
  const first = deferred(), second = deferred();
  let attempt = 0;
  const f = fixture({ navigate: () => ++attempt === 1 ? first.promise : second.promise });
  try {
    f.click(0); f.change({ active: false }); f.click(0);
    assert.equal(attempt, 1);
    assert.equal(f.pending(), false);
    f.change({ active: true }); f.click(0);
    assert.equal(attempt, 2);
    first.resolve({ ok: true, targetId: "synthetic-old" }); await setImmediate(); f.render();
    assert.equal(f.calls.closes, 0);
    assert.equal(f.pending(), true);
    second.resolve({ ok: true, targetId: "synthetic-current" }); await setImmediate(); f.render();
    assert.equal(f.calls.closes, 1);
  } finally { f.dispose(); }
});

for (const locale of ["en-US", "zh-CN"]) {
  for (const kind of ["failure", "reject"]) {
    test(`${locale}: current ${kind} ends busy state, uses finite feedback and permits an explicit retry`, async () => {
      let attempt = 0;
      const f = fixture({ locale, navigate: async () => {
        if (++attempt > 1) return { ok: true, targetId: "synthetic-target" };
        if (kind === "reject") throw Error("Synthetic private failure detail");
        return { ok: false, targetId: "synthetic-target", reason: "target-not-mounted" };
      } });
      try {
        f.click(0); await setImmediate(); f.render();
        assert.equal(f.pending(), false);
        assert.deepEqual(f.busy(), []);
        assert.equal(f.failure(), locale === "zh-CN"
          ? "暂时无法打开此匹配，请重试或选择其他结果。"
          : "Could not open this match. Try again or choose another result.");
        assert.equal(f.calls.closes, 0);
        f.key("Enter"); await setImmediate(); f.render();
        assert.equal(attempt, 2);
        assert.equal(f.failure(), "");
        assert.equal(f.calls.closes, 1);
      } finally { f.dispose(); }
    });
  }
}

// Extract the actual Reader adapter without importing/mounting the full Reader.
// Only the underlying navigation and publication setters are controlled.
const readerSource = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const readerAst = ts.createSourceFile("conversation-reader.tsx", readerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let readerCallback;
const findReaderCallback = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(readerAst) === "handleSearchNavigate") {
    assert.ok(ts.isCallExpression(node.initializer));
    readerCallback = node.initializer.arguments[0].getText(readerAst);
  }
  ts.forEachChild(node, findReaderCallback);
};
findReaderCallback(readerAst);
assert.ok(readerCallback, "Reader search navigation adapter must remain covered");
const readerCompiled = ts.transpileModule(`exports.navigate = ${readerCallback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function readerAdapter(navigate) {
  const calls = { targets: [], contexts: [], highlights: [] }, exports = {};
  new Function("navigateToTarget", "publishSearchNavigation", "setSearchHighlight", "exports", readerCompiled)(
    target => { calls.targets.push(target); return navigate(target); },
    context => calls.contexts.push(context), highlight => calls.highlights.push(highlight), exports);
  return { navigate: exports.navigate, calls };
}

test("actual Reader adapter skips retired admission and preserves optional two-argument callers and exact locators", async () => {
  const adapter = readerAdapter(async () => ({ ok: true, targetId: "synthetic-target" }));
  const target = { messageId: A.message_id, messageVersionId: A.message_version_id, renderBlockId: "synthetic-block",
    blockIndex: 3, characterOffset: 10, endCharacterOffset: 20, quote: "Synthetic", prefix: "before", suffix: "after" };
  const context = { query: "synthetic", index: 0, targets: [target] };
  const retired = await adapter.navigate(target, context, () => false);
  assert.equal(retired.ok, false); assert.equal(retired.reason, "cancelled");
  assert.deepEqual(adapter.calls.targets, []);
  const result = await adapter.navigate(target, context);
  assert.equal(result.ok, true);
  assert.deepEqual(adapter.calls.targets, [{ ...target, source: "search" }]);
  assert.deepEqual(adapter.calls.contexts, [context]);
  assert.deepEqual(adapter.calls.highlights, [{ targetId: "synthetic-target", quote: "Synthetic",
    start: 10, end: 20, prefix: "before", suffix: "after" }]);
});

test("actual Reader adapter and actual panel suppress late search publication after query retirement", async () => {
  const hold = deferred(), adapter = readerAdapter(() => hold.promise);
  const f = fixture({ navigate: adapter.navigate });
  try {
    f.click(0); f.type("new query", { debounce: false });
    hold.resolve({ ok: true, targetId: "synthetic-old-target" }); await setImmediate(); f.render();
    assert.equal(adapter.calls.targets.length, 1); // Begun navigation was not physically cancelled.
    assert.deepEqual(adapter.calls.contexts, []);
    assert.deepEqual(adapter.calls.highlights, []);
    assert.equal(f.calls.closes, 0);
  } finally { f.dispose(); }
});

test("actual Reader adapter publishes only the latest panel activation despite reversed completion", async () => {
  const first = deferred(), second = deferred();
  const adapter = readerAdapter(target => target.messageId === A.message_id ? first.promise : second.promise);
  const f = fixture({ navigate: adapter.navigate });
  try {
    f.click(0); f.click(1);
    second.resolve({ ok: true, targetId: "synthetic-B" }); await setImmediate();
    first.resolve({ ok: true, targetId: "synthetic-A" }); await setImmediate();
    assert.equal(f.calls.closes, 1);
    assert.deepEqual(adapter.calls.contexts, [f.calls.navigation[1].context]);
    assert.equal(adapter.calls.highlights.length, 1);
    assert.equal(adapter.calls.highlights[0].targetId, "synthetic-B");
  } finally { f.dispose(); }
});

test("desktop caller passes drawer visibility to its search panel while mobile retains unmount ownership", () => {
  const panels = [];
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(readerAst) === "ConversationSearchPanel") {
      panels.push(new Map(node.attributes.properties.filter(ts.isJsxAttribute)
        .map(attribute => [attribute.name.getText(readerAst), attribute.initializer?.getText(readerAst)])));
    }
    ts.forEachChild(node, visit);
  };
  visit(readerAst);
  assert.equal(panels.length, 2);
  assert.equal(panels[0].get("showHeader"), "{false}");
  assert.equal(panels[1].get("active"), "{!sourceEditorTarget}");
  for (const attributes of panels) assert.equal(attributes.get("onNavigate"), "{handleSearchNavigate}");
});
