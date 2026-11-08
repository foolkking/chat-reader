import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/features/reading/conversation-tag-strip.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Exercise the real effect/handlers with explicit DOM adapters. Native focus
// after disabling a button and nested details are also covered in Playwright.
function fixture() {
  const listeners = new Map(), effects = [], cleanups = [], focused = [];
  class Node {}
  class Element extends Node {
    constructor(parent = null) { super(); this.parent = parent; }
    contains(target) { return target === this || Boolean(target?.parent && this.contains(target.parent)); }
    closest() { return this.open ? this : this.parent?.closest() ?? null; }
  }
  const details = new Element();
  details.open = true;
  details.visible = true;
  details.getClientRects = () => details.visible ? [{}] : [];
  details.removeAttribute = () => { details.open = false; };
  const summary = new Element(details);
  summary.focus = options => focused.push({ target: summary, options });
  details.querySelector = () => summary;
  const root = {
    querySelector: () => details.open ? details : null,
    querySelectorAll: () => details.open ? [details] : [],
  };
  const document = {
    body: new Element(), documentElement: new Element(),
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { assert.equal(listeners.get(type), listener); listeners.delete(type); },
  };
  const modules = {
    react: { useRef: () => ({ current: root }), useState: () => [false, () => {}], useEffect: fn => effects.push(fn) },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { default: "a" },
    "@tanstack/react-query": { useQuery: () => ({ data: [] }) },
    "lucide-react": { Plus: "svg" },
    "../../lib/api": { getUserFeatureEntries() { throw new Error("No transport in this fixture"); } },
    "../../lib/offline-db": { getOfflineConversationTags() { throw new Error("No storage in this fixture"); } },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
    "./conversation-tags-panel": { conversationTagsQueryKey: ["user-feature-entries", "conversation-tag"], ConversationTagsPanel: "div" },
  };
  const api = {};
  new Function("require", "exports", "document", "Node", "Element", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
    return modules[name];
  }, api, document, Node, Element);
  const tree = api.ConversationTagStrip({ conversationId: "synthetic" });
  for (const effect of effects) cleanups.push(effect());
  const event = overrides => ({
    type: "keydown", key: "Escape", target: document.body, defaultPrevented: false, isComposing: false,
    nativeEvent: { isComposing: false }, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...overrides,
  });
  return {
    details, document, focused, Element, summary, tree, event, listeners,
    dispatch(type, overrides) { const e = event({ type, ...overrides }); listeners.get(type)?.(e); return e; },
    dispose() { for (const cleanup of cleanups) cleanup(); assert.equal(listeners.size, 0); },
  };
}

test("tag disclosure handles body-target Escape after disabling its submit button", () => {
  const f = fixture();
  try {
    f.dispatch("focusin"); // Focus lost to body is not deliberate departure.
    assert.equal(f.details.open, true);
    const e = f.dispatch("keydown");
    assert.equal(f.details.open, false);
    assert.equal(e.defaultPrevented, true);
    assert.equal(e.stopped, true);
    assert.deepEqual(f.focused, [{ target: f.summary, options: { preventScroll: true } }]);
  } finally { f.dispose(); }
});

test("tag Escape fallback respects composition, handled events, hidden copies and other focus owners", () => {
  const f = fixture();
  try {
    for (const change of [{ isComposing: true }, { defaultPrevented: true }, { key: "Enter" }, { target: new f.Element() }]) {
      f.dispatch("keydown", change);
      assert.equal(f.details.open, true);
      assert.equal(f.focused.length, 0);
    }
    f.details.visible = false;
    f.dispatch("keydown");
    assert.equal(f.details.open, true);
    assert.equal(f.focused.length, 0);
  } finally { f.dispose(); }
});

test("tag outside pointer/focus closes without taking focus from the selected target", () => {
  const f = fixture();
  try {
    for (const type of ["pointerdown", "focusin"]) {
      f.details.open = true;
      f.dispatch(type, { target: f.summary });
      assert.equal(f.details.open, true);
      f.dispatch(type, { target: new f.Element() });
      assert.equal(f.details.open, false);
      assert.equal(f.focused.length, 0);
    }
  } finally { f.dispose(); }
});

test("tag nested disclosure consumes Escape without dismissing its parent", () => {
  const f = fixture();
  try {
    const nested = new f.Element(f.details), summary = new f.Element(nested);
    nested.open = true;
    nested.removeAttribute = () => { nested.open = false; };
    nested.querySelector = () => summary;
    summary.focus = () => f.focused.push(summary);
    const e = f.event({ target: summary });
    f.tree.props.onKeyDown(e);
    assert.equal(nested.open, false);
    assert.equal(f.details.open, true);
    assert.deepEqual(f.focused, [summary]);
    assert.equal(e.defaultPrevented, true);
    assert.equal(e.stopped, true);
  } finally { f.dispose(); }
});
