import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/sharing/share-readonly-reader.tsx");
const ast = ts.createSourceFile("share-readonly-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ShareReadonlyReader");
assert.ok(ast.statements.some(node => ts.isImportDeclaration(node)
  && node.moduleSpecifier.text === "../../components/use-dialog-focus"
  && node.importClause?.namedBindings?.elements?.some(item => item.name.text === "useDialogFocus")));
const names = new Set(["tabletNavigationPanelRef", "navigationSheetVisible"]);
const selected = reader.body.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(ast))))
  || (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "useDialogFocus"));
assert.equal(selected.length, names.size + 1);
const nodes = [];
const walk = node => { nodes.push(node); ts.forEachChild(node, walk); };
walk(reader);
const attribute = (tag, name) => tag.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);
const expression = item => item?.initializer && ts.isJsxExpression(item.initializer) ? item.initializer.expression : null;
const panel = nodes.find(node => ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "section"
  && expression(attribute(node, "ref"))?.getText(ast) === "tabletNavigationPanelRef");
assert.ok(panel);
const compile = text => ts.transpileModule(text, { fileName: "share-tablet-focus-harness.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const inputs = ["navigationOpen", "navigationViewport", "shareQuery", "storageReady", "storageIsCurrent",
  "payload", "handleNavigationOpenChange", "t"];
const compiledWiring = compile(`function renderWiring(input) {
  const { ${inputs.join(", ")} } = input;
  ${selected.map(node => node.getText(ast)).join("\n")}
  return { panel: ${panel.getText(ast)}</section>, rootRef: tabletNavigationPanelRef };
}
exports.renderWiring = renderWiring;`);
const compiledHook = compile(read("components/use-dialog-focus.ts"));
const same = (left, right) => left && right && left.length === right.length
  && left.every((value, index) => Object.is(value, right[index]));

// Reuses the actual Share visibility/ref/hook call and section attributes,
// plus the entire existing useDialogFocus module. Layout/ref attachment,
// document geometry, modal ordering, focus, keys and timers are controlled
// adapters. This is not mounted React, Vaul, a browser or assistive technology.
function fixture(overrides = {}) {
  const calls = { close: [], focus: [] }, listeners = new Set(), timers = [];
  const document = {
    activeElement: null, modals: [],
    addEventListener: (name, listener) => { assert.equal(name, "keydown"); listeners.add(listener); },
    removeEventListener: (name, listener) => { assert.equal(name, "keydown"); listeners.delete(listener); },
    querySelectorAll: () => document.modals,
    querySelector: () => trigger,
  };
  class Element {
    constructor(id, parent = null) {
      this.id = id; this.parentElement = parent; this.children = [];
      this.isConnected = true; this.visible = true; this.zIndex = 50; this.modal = false;
      this.disabled = false; this.inert = false; this.ariaHidden = false;
    }
    getClientRects() { return this.isConnected && this.visible ? [{}] : []; }
    matches(selector) { assert.equal(selector, ":disabled"); return this.disabled; }
    getAttribute(name) { return name === "aria-hidden" && this.ariaHidden ? "true" : null; }
    closest(selector) {
      if (selector === "[inert]") return this.inert ? this : this.parentElement?.closest(selector) ?? null;
      return this.modal ? this : this.parentElement?.closest(selector) ?? null;
    }
    querySelectorAll() { return this.children; }
    querySelector() { return null; } // No preferred-focus marker in the actual NavigationTabs.
    contains(element) {
      for (let current = element; current; current = current.parentElement) if (current === this) return true;
      return false;
    }
    compareDocumentPosition(other) { return this.id < other.id ? 4 : 0; }
    focus(options) {
      if (!this.isConnected || !this.visible) return;
      document.activeElement = this; calls.focus.push({ id: this.id, options });
    }
  }
  const trigger = new Element("synthetic-navigation-trigger"), root = new Element("synthetic-navigation-dialog");
  const first = new Element("synthetic-first-control", root), middle = new Element("synthetic-middle-control", root),
    last = new Element("synthetic-last-control", root);
  root.children = [first, middle, last];
  document.activeElement = trigger;
  const state = { navigationOpen: true, navigationViewport: "tablet", shareQuery: { isSuccess: true },
    storageReady: true, storageIsCurrent: true, payload: {},
    handleNavigationOpenChange: value => calls.close.push(value),
    t: key => ({ navigationTitle: "Navigation", close: "Close" })[key] ?? key, ...overrides };
  let cursor = 0, pending = new Map(), options, current;
  const slots = [], effects = new Map();
  const hooks = {
    useRef: initial => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useLayoutEffect: (effect, deps) => pending.set(cursor++, { effect, deps }),
  };
  const hookModule = { exports: {} };
  new Function("require", "exports", "document", "window", "HTMLElement", "Node", "getComputedStyle", compiledHook)(
    name => name === "react" ? hooks : require(name), hookModule.exports, document,
    { setTimeout: (callback, delay) => { assert.equal(delay, 0); timers.push(callback); } },
    Element, { DOCUMENT_POSITION_FOLLOWING: 4 }, element => ({ zIndex: String(element.zIndex) }),
  );
  const wiring = {};
  new Function("exports", "require", "useRef", "useDialogFocus", compiledWiring)(
    wiring, require, hooks.useRef, input => { options = input; hookModule.exports.useDialogFocus(input); },
  );
  const render = () => {
    cursor = 0; pending = new Map(); current = wiring.renderWiring(state);
    assert.equal(current.panel.props.ref, current.rootRef);
    root.modal = current.panel.props.role === "dialog" && current.panel.props["aria-modal"] === "true";
    // Controlled ref attachment follows the extracted call's actual open gate.
    root.isConnected = options.open;
    current.rootRef.current = options.open ? root : null;
    document.modals = options.open ? [root, ...document.modals.filter(item => item !== root)]
      : document.modals.filter(item => item !== root);
    const changed = [...pending].filter(([index, next]) => !same(effects.get(index)?.deps, next.deps));
    for (const [index] of changed) effects.get(index)?.cleanup?.();
    for (const [index, next] of changed) effects.set(index, { ...next, cleanup: next.effect() });
  };
  const key = (value, shiftKey = false) => {
    const event = { key: value, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const listener of [...listeners]) listener(event);
    return event;
  };
  const flush = () => { while (timers.length) timers.shift()(); };
  render();
  return { state, calls, document, root, first, middle, last, trigger, listeners, render, key, flush,
    get options() { return options; }, get panel() { return current.panel; },
    modal() {
      const modal = new Element("synthetic-newer-dialog");
      modal.modal = true; modal.zIndex = 100;
      const control = new Element("synthetic-newer-control", modal);
      modal.children = [control]; document.modals.push(modal);
      return { modal, control };
    },
    dispose() {
      for (const effect of effects.values()) effect.cleanup?.();
      effects.clear(); root.isConnected = false; current.rootRef.current = null;
      document.modals = document.modals.filter(item => item !== root);
    },
  };
}

test("the actual tablet section has a translated modal name, fallback focus target and matching ref", () => {
  const f = fixture();
  try {
    assert.equal(f.panel.props.role, "dialog");
    assert.equal(f.panel.props["aria-modal"], "true");
    assert.equal(f.panel.props["aria-label"], "Navigation");
    assert.equal(f.panel.props.tabIndex, -1);
    assert.equal(f.options.rootRef.current, f.root);
    f.state.t = key => key === "navigationTitle" ? "阅读导航" : key; f.render();
    assert.equal(f.panel.props["aria-label"], "阅读导航");
    assert.deepEqual(f.calls.focus.map(item => item.id), [f.first.id]); // No render-time refocus.
  } finally { f.dispose(); }
});

for (const [name, overrides] of [
  ["closed", { navigationOpen: false }], ["mobile", { navigationViewport: "mobile" }],
  ["desktop", { navigationViewport: "desktop" }], ["metadata failure", { shareQuery: { isSuccess: false } }],
  ["storage pending", { storageReady: false }], ["old storage visit", { storageIsCurrent: false }],
  ["missing payload", { payload: null }],
]) {
  test(`${name}: the tablet hook installs no keyboard owner or focus move`, () => {
    const f = fixture(overrides);
    try {
      assert.equal(f.options.open, false);
      assert.equal(f.listeners.size, 0);
      assert.deepEqual(f.calls.focus, []);
      f.key("Escape"); assert.deepEqual(f.calls.close, []);
    } finally { f.dispose(); }
  });
}

test("opening the actual gated tablet hook focuses inside and wraps only Tab boundaries", () => {
  const f = fixture({ navigationOpen: false });
  try {
    f.state.navigationOpen = true; f.render();
    assert.equal(f.document.activeElement, f.first);
    assert.equal(f.listeners.size, 1);
    f.middle.focus(); assert.equal(f.key("Tab").prevented, false);
    f.last.focus(); assert.equal(f.key("Tab").prevented, true);
    assert.equal(f.document.activeElement, f.first);
    assert.equal(f.key("Tab", true).prevented, true);
    assert.equal(f.document.activeElement, f.last);
    f.root.children = [];
    assert.equal(f.key("Tab").prevented, true);
    assert.equal(f.document.activeElement, f.root);
    assert.equal(f.key("ArrowDown").prevented, false);
    assert.deepEqual(f.calls.close, []);
  } finally { f.dispose(); }
});

test("Escape forwards false to the latest existing close handler without a second listener or focus reset", () => {
  const f = fixture(), latest = [];
  try {
    f.state.handleNavigationOpenChange = value => latest.push(value); f.render();
    assert.equal(f.listeners.size, 1);
    assert.equal(f.calls.focus.length, 1);
    const event = f.key("Escape");
    assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.deepEqual(latest, [false]); assert.deepEqual(f.calls.close, []);
  } finally { f.dispose(); }
});

test("a newer modal keeps Escape and Tab ownership", () => {
  const f = fixture();
  try {
    const { control } = f.modal(); control.focus();
    assert.equal(f.key("Escape").prevented, false);
    assert.equal(f.key("Tab").prevented, false);
    assert.equal(f.document.activeElement, control);
    assert.deepEqual(f.calls.close, []);
  } finally { f.dispose(); }
});

for (const transition of ["close", "mobile", "desktop", "metadata hidden", "unmount"]) {
  test(`${transition}: cleanup removes the listener and restores the opener without scrolling`, () => {
    const f = fixture();
    try {
      if (transition === "unmount") f.dispose();
      else {
        if (transition === "close") f.state.navigationOpen = false;
        else if (transition === "metadata hidden") f.state.shareQuery = { isSuccess: false };
        else f.state.navigationViewport = transition;
        f.render();
      }
      assert.equal(f.listeners.size, 0);
      f.key("Escape"); assert.deepEqual(f.calls.close, []);
      f.flush();
      assert.equal(f.document.activeElement, f.trigger);
      assert.deepEqual(f.calls.focus.at(-1), { id: f.trigger.id, options: { preventScroll: true } });
    } finally { f.dispose(); }
  });
}

test("delayed cleanup cannot restore behind a newly opened modal", () => {
  const f = fixture();
  try {
    f.state.navigationOpen = false; f.render();
    const { control } = f.modal(); control.focus();
    const before = f.calls.focus.length;
    f.flush();
    assert.equal(f.document.activeElement, control);
    assert.equal(f.calls.focus.length, before);
  } finally { f.dispose(); }
});
