import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/search/sidebar-search.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const item = name => ({
  document_id: `synthetic-document-${name}`, conversation_id: `synthetic-conversation-${name}`,
  conversation_title: `Synthetic ${name}`, message_id: `synthetic-message-${name}`,
  block_index: 3, character_offset: 17, document_type: "message", snippet: "Synthetic search snippet",
});
const A = item("A"), B = item("B");
const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...walk(node.props.children)];
}

// Actual compiled component and its event handlers. Hooks, query results,
// timers, routing and refs are explicit synchronous adapters. No query function
// runs here; this is not mounted React, browser focus, timing or network QA.
function fixture({ locale = "en-US" } = {}) {
  const slots = [], pending = [], timers = new Map(), navigation = [];
  let cursor = 0, timerId = 0, tree, rows = [A, B], navigateCount = 0;
  const slot = initialize => {
    const index = cursor++;
    if (!Object.hasOwn(slots, index)) slots[index] = initialize();
    return index;
  };
  const react = {
    useState: initial => {
      const index = slot(() => typeof initial === "function" ? initial() : initial);
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef: initial => slots[slot(() => ({ current: initial }))],
    useEffect: (effect, deps) => {
      const state = slots[slot(() => ({}))];
      if (!same(state.deps, deps)) {
        state.deps = deps;
        pending.push(() => { state.cleanup?.(); state.cleanup = effect(); });
      }
    },
  };
  const window = {
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: () => {}, removeEventListener: () => {},
  };
  const stubs = {
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQuery: () => ({
      data: { items: rows }, isError: false, isFetching: false, refetch: async () => {},
    }) },
    "lucide-react": { Search: () => null, X: () => null },
    "next/navigation": { useRouter: () => ({ push: path => navigation.push(path) }) },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../lib/api": { searchConversations: () => { throw new Error("This fixture must not issue a search request"); } },
  };
  const exports = {};
  new Function("require", "exports", "window", compiled)(name => {
    assert.ok(Object.hasOwn(stubs, name), `Unexpected import ${name}`);
    return stubs[name];
  }, exports, window);
  const render = () => {
    cursor = 0;
    tree = exports.SidebarSearch({ onNavigate: () => { navigateCount++; } });
    for (const effect of pending.splice(0)) effect();
    return tree;
  };
  const input = () => walk(tree).find(node => node.type === "input");
  const flushTimers = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    for (const callback of callbacks) callback();
    render();
  };
  render();
  return {
    navigation, get navigateCount() { return navigateCount; },
    setItems: next => { rows = next; render(); },
    type: (value, { settle = true } = {}) => {
      input().props.onChange({ target: { value } }); render();
      if (settle) flushTimers();
    },
    key: (key, extra = {}) => {
      input().props.onKeyDown({ key, keyCode: 0, nativeEvent: { isComposing: false }, preventDefault() {}, ...extra });
      render();
    },
    hover: documentId => {
      const row = walk(tree).find(node => node.type === "button" && node.key === documentId);
      assert.ok(row, "Hovered result must exist");
      row.props.onMouseEnter(); render();
    },
    selected: () => walk(tree).filter(node => node.type === "button"
      && /(?:^|\s)bg-subtle(?:\s|$)/.test(node.props.className ?? "")).map(node => node.key),
    dispose: () => { for (const state of slots) state?.cleanup?.(); timers.clear(); },
  };
}

for (const locale of ["en-US", "zh-CN"]) {
  test(`${locale}: unselected quick search keeps its first-result Enter behavior and target parameters`, () => {
    const f = fixture({ locale });
    try {
      f.type("synthetic"); f.key("Enter");
      const target = new URL(f.navigation[0], "https://example.invalid");
      assert.equal(target.pathname, "/conversations/" + A.conversation_id);
      assert.equal(target.searchParams.get("messageId"), A.message_id);
      assert.equal(target.searchParams.get("blockIndex"), "3");
      assert.equal(target.searchParams.get("characterOffset"), "17");
      assert.equal(f.navigateCount, 1);
    } finally { f.dispose(); }
  });
  for (const method of ["keyboard", "pointer"]) {
    test(`${locale}: ${method} selection follows document identity through same-query reorder`, () => {
      const f = fixture({ locale });
      try {
        f.type("synthetic");
        if (method === "keyboard") f.key("ArrowDown");
        else f.hover(B.document_id);
        f.setItems([B, A]);
        assert.deepEqual(f.selected(), [B.document_id]);
        f.key("Enter");
        assert.ok(f.navigation[0].startsWith("/conversations/" + B.conversation_id + "?"));
      } finally { f.dispose(); }
    });
  }
}

test("a removed deliberate selection opens all results, never the replacement document", () => {
  const f = fixture();
  try {
    f.type("synthetic"); f.key("ArrowDown");
    f.setItems([A]);
    assert.deepEqual(f.selected(), []);
    f.key("Enter");
    assert.deepEqual(f.navigation, ["/search?q=synthetic"]);
  } finally { f.dispose(); }
});
for (const arrow of ["ArrowDown", "ArrowUp"]) {
  test(`${arrow} restarts from a visible row after an eight-to-two result shrink`, () => {
    const f = fixture(), rows = Array.from({ length: 8 }, (_, index) => item(String(index)));
    try {
      f.setItems(rows); f.type("synthetic"); f.hover(rows[7].document_id);
      f.setItems(rows.slice(0, 2)); f.key(arrow);
      assert.deepEqual(f.selected(), [rows[0].document_id]);
      f.key("Enter");
      assert.ok(f.navigation[0].startsWith("/conversations/" + rows[0].conversation_id + "?"));
    } finally { f.dispose(); }
  });
}
test("typing a new query clears selection and cannot open the previous debounced results", () => {
  const f = fixture();
  try {
    f.type("synthetic"); f.key("ArrowDown");
    f.type("different", { settle: false }); f.key("Enter");
    assert.deepEqual(f.navigation, ["/search?q=different"]);
    f.type("different"); assert.deepEqual(f.selected(), [A.document_id]);
  } finally { f.dispose(); }
});
test("IME confirmation and composition key codes cannot navigate or change selection", () => {
  const f = fixture();
  try {
    f.type("synthetic");
    f.key("ArrowDown", { nativeEvent: { isComposing: true } });
    f.key("Enter", { keyCode: 229 });
    assert.deepEqual(f.selected(), [A.document_id]);
    assert.deepEqual(f.navigation, []);
  } finally { f.dispose(); }
});
test("annotation quick results retain their existing destination parameters", () => {
  const f = fixture();
  try {
    f.setItems([{ ...A, document_type: "annotation", annotation_id: "synthetic-annotation" }]);
    f.type("synthetic"); f.key("Enter");
    const target = new URL(f.navigation[0], "https://example.invalid");
    assert.equal(target.searchParams.get("annotations"), "open");
    assert.equal(target.searchParams.get("annotationId"), "synthetic-annotation");
  } finally { f.dispose(); }
});
