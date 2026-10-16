import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/sharing/share-readonly-reader.tsx");
const ast = ts.createSourceFile("share-readonly-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ShareReadonlyReader");
const names = new Set(["navigationSheetVisible", "navigationSheetScope", "mobileNavigation", "currentMobileNavigation",
  "retireNavigationSheet", "handleNavigationOpenChange", "handleNavigationTabChange", "navigateFromNavigationSheet"]);
const declares = name => ts.isIdentifier(name) ? names.has(name.text)
  : ts.isArrayBindingPattern(name) && name.elements.some(item => ts.isBindingElement(item) && declares(item.name));
const selected = reader.body.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => declares(item.name)))
  || (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "useLayoutEffect"
    && node.getText(ast).includes("navigationSheetScope.active = navigationSheetVisible;")));
assert.equal(selected.length, names.size + 1);
const compile = text => ts.transpileModule(text, { fileName: "share-sheet-harness.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const inputs = ["navigationOpen", "navigationActivation", "setNavigationActivation",
  "navigationTab", "navigationViewport", "navigationVisit", "shareQuery",
  "storageReady", "storageIsCurrent", "payload", "navigateToTarget", "setNavigationOpen", "setNavigationTab"];
const compiled = compile(`function renderSheet(input) {
  const { ${inputs.join(", ")} } = input;
  ${selected.map(node => node.getText(ast)).join("\n")}
  return { navigate: navigateFromNavigationSheet, open: handleNavigationOpenChange,
    tab: handleNavigationTabChange, scope: navigationSheetScope, feedback: currentMobileNavigation };
}
exports.renderSheet = renderSheet;`);
const all = [];
const walk = node => { all.push(node); ts.forEachChild(node, walk); };
walk(reader);
const tags = all.filter(node => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node));
const attribute = (tag, name) => tag.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);
const expression = item => item?.initializer && ts.isJsxExpression(item.initializer) ? item.initializer.expression : null;
const sheetTags = tags.filter(tag => ["ConversationIndex", "ConversationToc"].includes(tag.tagName.getText(ast))
  && attribute(tag, "mode")?.initializer?.getText(ast) === '"sheet"');
assert.equal(sheetTags.length, 4);
const mobileSheet = tags.find(tag => tag.tagName.getText(ast) === "MobileReaderSheet");
const status = expression(attribute(mobileSheet, "status"));
assert.ok(status);
const tabletStatus = all.find(node => ts.isJsxElement(node)
  && attribute(node.openingElement, "aria-live")?.initializer?.getText(ast) === '"polite"'
  && node.getText(ast).includes("currentMobileNavigation"));
assert.ok(tabletStatus);
const targetSource = read("features/conversations/reader-locator-target.ts");
const targetAst = ts.createSourceFile("reader-locator-target.ts", targetSource, ts.ScriptTarget.Latest, true);
const tocHelper = targetAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "tocNavigationTarget");
const wiring = {};
new Function("exports", "require", compile(`
  ${tocHelper.getText(targetAst)}
  exports.callers = function(navigateFromNavigationSheet) {
    return [${sheetTags.map(tag => expression(attribute(tag, "onNavigate")).getText(ast)).join(",\n")}];
  };
  exports.status = (currentMobileNavigation, t) => [${status.getText(ast)}, ${tabletStatus.getText(ast)}];
`))(wiring, require);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const A = "synthetic-sheet-message-A", B = "synthetic-sheet-message-B";
const located = id => ({ ok: true, targetId: `message-${id}` });

// Exact extracted Share visibility/scope/state/effect/handlers and all four
// JSX callers; the actual TOC target helper and status JSX are also reused.
// Hooks/layout scheduling, parent/activation state and core navigation are controlled
// adapters. This is not mounted React/Vaul, QueryClient, transport or browser
// evidence, and the core navigation is deliberately not physically cancelled.
function fixture() {
  const calls = { navigation: [], feedback: [], open: [], tabs: [] }, handlers = {};
  const state = { navigationOpen: true, navigationActivation: 0, navigationTab: "dialogue", navigationViewport: "mobile",
    navigationVisit: { active: true }, shareQuery: { isSuccess: true }, storageReady: true,
    storageIsCurrent: true, payload: {} };
  state.navigateToTarget = async target => {
    calls.navigation.push(target);
    return handlers.navigate ? handlers.navigate(target) : located(typeof target === "string" ? target : target.messageId);
  };
  state.setNavigationOpen = value => { calls.open.push(value); state.navigationOpen = value; };
  state.setNavigationActivation = update => {
    state.navigationActivation = typeof update === "function" ? update(state.navigationActivation) : update;
  };
  state.setNavigationTab = value => { calls.tabs.push(value); state.navigationTab = value; };
  let cursor = 0, current, pending = new Map();
  const slots = [], effects = new Map();
  const memo = (make, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || !same(previous.deps, deps)) slots[index] = { deps, value: make() };
    return slots[index].value;
  };
  const exports = {};
  const dependencies = { exports, useMemo: memo, useCallback: (value, deps) => memo(() => value, deps),
    useState: initial => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial, set: value => {
        slots[index].value = value; calls.feedback.push(value);
      } };
      return [slots[index].value, slots[index].set];
    },
    useLayoutEffect: (effect, deps) => pending.set(cursor++, { effect, deps }),
  };
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const render = () => {
    cursor = 0; pending = new Map(); current = exports.renderSheet(state);
    const changed = [...pending].filter(([index, next]) => !same(effects.get(index)?.deps, next.deps));
    for (const [index] of changed) effects.get(index)?.cleanup?.();
    for (const [index, next] of changed) effects.set(index, { ...next, cleanup: next.effect() });
  };
  render();
  return { state, calls, handlers, render, get current() { return current; },
    replay() { for (const entry of effects.values()) { entry.cleanup?.(); entry.cleanup = entry.effect(); } },
    dispose() { for (const entry of effects.values()) entry.cleanup?.(); },
  };
}
const snapshot = f => ({ feedback: f.calls.feedback.length, open: f.calls.open.length, navigation: f.calls.navigation.length });

test("all four mobile/tablet index and section callers preserve existing target arguments", async () => {
  const seen = [], callers = wiring.callers(async target => { seen.push(target); });
  for (let index = 0; index < callers.length; index++) {
    await callers[index](index % 2 === 0 ? { messageId: A }
      : { message_id: A, message_version_id: "synthetic-version", render_block_id: "synthetic-heading", block_index: 7 });
  }
  assert.deepEqual(seen, [A, { messageId: A, messageVersionId: "synthetic-version", renderBlockId: "synthetic-heading",
    blockIndex: 7, preferTocPipeline: true, allowMessageFallback: true, source: "section-toc" },
  A, { messageId: A, messageVersionId: "synthetic-version", renderBlockId: "synthetic-heading",
    blockIndex: 7, preferTocPipeline: true, allowMessageFallback: true, source: "section-toc" }]);
  assert.equal(expression(attribute(mobileSheet, "onOpenChange")).getText(ast), "handleNavigationOpenChange");
  for (const tag of tags.filter(tag => tag.tagName.getText(ast) === "NavigationTabs")) {
    assert.equal(expression(attribute(tag, "onTabChange")).getText(ast), "handleNavigationTabChange");
    assert.ok(expression(attribute(tag, "onClose")).getText(ast).includes("handleNavigationOpenChange(false)"));
  }
  const desktop = tags.filter(tag => ["ConversationIndex", "ConversationToc"].includes(tag.tagName.getText(ast))
    && !attribute(tag, "mode"));
  assert.equal(desktop.length, 2);
  assert.ok(desktop.every(tag => !expression(attribute(tag, "onNavigate")).getText(ast).includes("navigateFromNavigationSheet")));
});

for (const viewport of ["mobile", "tablet"]) {
  test(`${viewport}: current activation publishes pending then closes only on confirmed success`, async () => {
    const f = fixture(), hold = deferred();
    f.state.navigationViewport = viewport; f.render();
    f.handlers.navigate = () => hold.promise;
    try {
      const action = f.current.navigate(A); f.render();
      assert.equal(f.current.feedback.pending, true);
      assert.equal(f.current.feedback.error, null);
      assert.equal(f.state.navigationOpen, true);
      hold.resolve(located(A)); await action;
      assert.deepEqual(f.calls.open, [false]);
      assert.equal(f.current.scope.active, false);
      f.render(); assert.equal(f.current.feedback, null);
    } finally { f.dispose(); }
  });
}

for (const outcome of ["failure", "exception", "cancelled"]) {
  test(`current ${outcome} ends pending without closing; cancellation stays neutral and failure allows another choice`, async () => {
    const f = fixture();
    f.handlers.navigate = () => {
      if (outcome === "exception") throw Error("Synthetic private transport detail");
      return { ok: false, targetId: `message-${A}`, reason: outcome === "cancelled" ? "cancelled" : "load-failed" };
    };
    try {
      await f.current.navigate(A); f.render();
      assert.equal(f.current.feedback.pending, false);
      assert.equal(f.current.feedback.error, outcome === "cancelled" ? null : "failed");
      assert.equal(f.current.scope.pendingKey, null);
      assert.deepEqual(f.calls.open, []);
      assert.equal(JSON.stringify(f.calls.feedback).includes("Synthetic private"), false);
      f.handlers.navigate = () => located(B);
      await f.current.navigate(B);
      assert.deepEqual(f.calls.open, [false]);
    } finally { f.dispose(); }
  });
}

test("the same pending target coalesces without clearing its wait; a different target may take over", async () => {
  const f = fixture(), hold = deferred();
  f.handlers.navigate = value => value === A ? hold.promise : located(B);
  try {
    const first = f.current.navigate(A);
    await f.current.navigate({ messageId: A });
    f.render();
    assert.deepEqual(f.calls.navigation, [A]);
    assert.equal(f.current.feedback.pending, true);
    assert.equal((await f.current.navigate(B)), undefined);
    const before = snapshot(f);
    hold.reject(Error("Synthetic old failure")); await first;
    assert.deepEqual(snapshot(f), before);
  } finally { f.dispose(); }
});

for (const outcome of ["success", "failure", "exception"]) {
  test(`an older ${outcome} cannot clear newer pending feedback or close its sheet`, async () => {
    const f = fixture(), old = deferred(), newer = deferred();
    f.handlers.navigate = value => value === A ? old.promise : newer.promise;
    try {
      const first = f.current.navigate(A), second = f.current.navigate(B);
      f.render();
      const before = snapshot(f), key = f.current.scope.pendingKey;
      if (outcome === "exception") old.reject(Error("Synthetic obsolete exception"));
      else old.resolve(outcome === "success" ? located(A) : { ok: false, targetId: A, reason: "load-failed" });
      await first; f.render();
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.current.feedback.pending, true);
      assert.equal(f.current.scope.pendingKey, key);
      newer.resolve({ ok: false, targetId: B, reason: "load-failed" }); await second; f.render();
      assert.equal(f.current.feedback.error, "failed");
      assert.equal(f.current.feedback.pending, false);
      assert.deepEqual(f.calls.open, []);
    } finally { f.dispose(); }
  });
}

for (const retirement of ["close/reopen", "tab", "viewport", "desktop", "visit", "unmount", "effect replay",
  "Share hidden", "storage pending", "storage visit", "missing metadata"]) {
  test(`${retirement} retires the old activation and hides old feedback`, async () => {
    const f = fixture(), hold = deferred();
    f.handlers.navigate = () => hold.promise;
    try {
      const oldCallback = f.current.navigate, action = oldCallback(A), oldScope = f.current.scope;
      f.render(); assert.equal(f.current.feedback.pending, true);
      if (retirement === "close/reopen") {
        f.current.open(false);
        assert.equal(oldScope.active, false); // Before parent render.
        f.render(); f.current.open(true); f.render();
      } else if (retirement === "tab") {
        f.current.tab("sections");
        assert.equal(oldScope.active, false); // Before parent render.
        f.render();
      } else if (retirement === "viewport" || retirement === "desktop") {
        f.state.navigationViewport = retirement === "viewport" ? "tablet" : "desktop"; f.render();
      } else if (retirement === "visit") {
        f.state.navigationVisit.active = false; f.state.navigationVisit = { active: true }; f.render();
      } else if (retirement === "effect replay") f.replay();
      else if (retirement === "Share hidden") { f.state.shareQuery = { isSuccess: false }; f.render(); }
      else if (retirement === "storage pending") { f.state.storageReady = false; f.render(); }
      else if (retirement === "storage visit") { f.state.storageIsCurrent = false; f.render(); }
      else if (retirement === "missing metadata") { f.state.payload = null; f.render(); }
      else f.dispose();
      const before = snapshot(f);
      hold.resolve(located(A)); await action;
      assert.deepEqual(snapshot(f), before);
      if (retirement !== "effect replay") {
        await oldCallback(B);
        assert.deepEqual(snapshot(f), before);
      }
      f.render();
      // Replay retains the scope object; the feedback sequence must also retire.
      assert.equal(f.current.feedback?.pending ?? false, false);
      if (retirement === "effect replay") {
        f.handlers.navigate = () => located(B);
        await f.current.navigate(B);
        assert.deepEqual(f.calls.open, [false]);
      }
    } finally { f.dispose(); }
  });
}

for (const reopen of ["batched close/open", "same-value open"]) {
  for (const viewport of ["mobile", "tablet"]) {
    test(`${viewport}: ${reopen} creates a fresh scope without restoring old callback admission`, async () => {
      const f = fixture(), old = deferred(), newer = deferred();
      f.state.navigationViewport = viewport; f.render();
      f.handlers.navigate = value => value === A ? old.promise : newer.promise;
      try {
        const first = f.current.navigate(A), oldCallback = f.current.navigate, oldScope = f.current.scope;
        const open = f.current.open, activation = f.state.navigationActivation;
        if (reopen === "batched close/open") open(false);
        open(true); // No intermediate parent render.
        assert.equal(f.state.navigationOpen, true);
        assert.equal(f.state.navigationActivation, activation + 1);
        assert.equal(oldScope.active, false);
        await oldCallback(B);
        assert.deepEqual(f.calls.navigation, [A]);
        f.render();
        assert.notEqual(f.current.scope, oldScope);
        assert.equal(f.current.scope.active, true);
        assert.equal(f.current.feedback, null);
        const second = f.current.navigate(B); f.render();
        assert.equal(f.current.feedback.pending, true);
        const before = snapshot(f);
        await oldCallback(B);
        old.resolve(located(A)); await first; f.render();
        assert.deepEqual(snapshot(f), before);
        assert.equal(f.state.navigationOpen, true);
        assert.equal(f.current.feedback.pending, true);
        newer.resolve(located(B)); await second;
        assert.deepEqual(f.calls.navigation, [A, B]);
        assert.deepEqual(f.calls.open, reopen === "batched close/open" ? [false, true, false] : [true, false]);
      } finally { f.dispose(); }
    });
  }
}

test("pressing the already selected tab leaves its current activation intact", async () => {
  const f = fixture(), hold = deferred();
  f.handlers.navigate = () => hold.promise;
  try {
    const action = f.current.navigate(A);
    f.current.tab("dialogue");
    assert.equal(f.current.scope.active, true);
    hold.resolve(located(A)); await action;
    assert.deepEqual(f.calls.tabs, []);
    assert.deepEqual(f.calls.open, [false]);
  } finally { f.dispose(); }
});

test("finite pending/failure status JSX translates at render time in both sheet placements", () => {
  const dictionaries = { en: { locating: "Locating", locateFailed: "Could not locate" },
    zh: { locating: "正在定位", locateFailed: "定位失败" } };
  for (const [locale, copy] of Object.entries(dictionaries)) {
    const t = key => copy[key] ?? key;
    for (const status of wiring.status({ pending: true, error: null }, t)) {
      assert.match(renderToStaticMarkup(status), new RegExp(copy.locating), locale);
    }
    for (const status of wiring.status({ pending: false, error: "failed" }, t)) {
      const html = renderToStaticMarkup(status);
      assert.match(html, new RegExp(copy.locateFailed), locale);
      assert.equal(html.includes(copy.locating), false);
    }
    for (const status of wiring.status(null, t)) {
      const html = renderToStaticMarkup(status);
      assert.equal(html.includes(copy.locating) || html.includes(copy.locateFailed), false);
    }
  }
});
