import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/conversations/conversation-reader.tsx");
const ast = ts.createSourceFile("conversation-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const names = new Set(["navigationSheetScopeRef", "retireNavigationSheet", "setUtilityPanel", "navigationSheetVisible",
  "navigationSheetScope", "mobileNavigation", "currentMobileNavigation", "handleNavigationTabChange", "navigateFromNavigationSheet"]);
const declares = name => ts.isIdentifier(name) ? names.has(name.text)
  : ts.isArrayBindingPattern(name) && name.elements.some(item => ts.isBindingElement(item) && declares(item.name));
const selected = reader.body.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => declares(item.name)))
  || (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "useLayoutEffect"
    && node.getText(ast).includes("navigationSheetScope.active = navigationSheetVisible;")));
const guard = reader.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ownsReaderReadRecovery");
assert.equal(selected.length, names.size + 1);
assert.ok(guard);
const compile = text => ts.transpileModule(text, { fileName: "reader-sheet-harness.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const inputs = ["utilityPanel", "setUtilityPanelState", "navigationTab", "setNavigationTab", "navigationViewport",
  "navigationActivation", "setNavigationActivation", "sourceEditorTarget", "readerSurfaceAvailable",
  "recentOwner", "recentOwnerRef", "navigateToTarget"];
const compiled = compile(`function renderSheet(input) {
  const { ${inputs.join(", ")} } = input;
  ${guard.getText(ast)}
  ${selected.map(node => node.getText(ast)).join("\n")}
  return { navigate: navigateFromNavigationSheet, utility: setUtilityPanel, tab: handleNavigationTabChange,
    scope: navigationSheetScope, scopeRef: navigationSheetScopeRef, feedback: currentMobileNavigation };
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
const statusTags = tags.filter(tag => ["MobileReaderSheet", "TabletReaderNavigationDrawer"].includes(tag.tagName.getText(ast))
  && attribute(tag, "status"));
assert.equal(sheetTags.length, 2); // Shared content, used by both responsive placements.
assert.equal(statusTags.length, 2);
const targetSource = read("features/conversations/reader-locator-target.ts");
const targetAst = ts.createSourceFile("reader-locator-target.ts", targetSource, ts.ScriptTarget.Latest, true);
const tocHelper = targetAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "tocNavigationTarget");
const wiring = {};
new Function("exports", "require", compile(`
  ${tocHelper.getText(targetAst)}
  exports.callers = navigateFromNavigationSheet => [
    ${sheetTags.map(tag => expression(attribute(tag, "onNavigate")).getText(ast)).join(",\n")}
  ];
  exports.status = (currentMobileNavigation, t) => [
    ${statusTags.map(tag => expression(attribute(tag, "status")).getText(ast)).join(",\n")}
  ];
`))(wiring, require);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const A = { messageId: "synthetic-reader-sheet-A", messageVersionId: "synthetic-version-A", source: "dialogue-index" };
const B = { messageId: "synthetic-reader-sheet-B", messageVersionId: "synthetic-version-B", source: "dialogue-index" };
const located = target => ({ ok: true, targetId: `message-${target.messageId}` });

// Actual extracted Reader scope/ref/state/effect/utility/tab/action callbacks
// and visit/account guard. Core positioning, hook scheduling and parent state
// are adapters. Actual caller, locator-helper and status fragments are reused;
// no mounted React, real remote/offline reads, geometry or browser is asserted.
function fixture({ mode = "remote", viewport = "mobile" } = {}) {
  const calls = { navigation: [], feedback: [], utility: [], tabs: [], activations: [] }, handlers = {};
  let epoch = 1, cursor = 0, current, pending = new Map();
  const state = { utilityPanel: "navigation", navigationActivation: 0, navigationTab: "dialogue", navigationViewport: viewport,
    sourceEditorTarget: null, readerSurfaceAvailable: true,
    recentOwner: { conversationId: "synthetic-reader-sheet", dataSource: { mode }, active: true, epoch } };
  state.recentOwnerRef = { current: state.recentOwner };
  state.setUtilityPanelState = value => { state.utilityPanel = value; calls.utility.push(value); };
  state.setNavigationActivation = update => {
    state.navigationActivation = update(state.navigationActivation); calls.activations.push(state.navigationActivation);
  };
  state.setNavigationTab = value => { state.navigationTab = value; calls.tabs.push(value); };
  state.navigateToTarget = async target => {
    calls.navigation.push(target);
    return handlers.navigate ? handlers.navigate(target) : located(target);
  };
  const slots = [], effects = new Map();
  const memo = (make, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || !same(previous.deps, deps)) slots[index] = { deps, value: make() };
    return slots[index].value;
  };
  const exports = {};
  const dependencies = { exports, authenticationGeneration: () => epoch,
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useRef: initial => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
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
    accountChange() { epoch++; },
    switchVisit(kind) {
      state.recentOwner.active = false;
      state.recentOwner = { ...state.recentOwner, active: true,
        conversationId: kind === "conversation" ? "synthetic-other-reader" : state.recentOwner.conversationId,
        dataSource: kind === "source" ? { mode: mode === "remote" ? "offline" : "remote" } : state.recentOwner.dataSource };
      state.recentOwnerRef.current = state.recentOwner; render();
    },
    replay() { for (const entry of effects.values()) { entry.cleanup?.(); entry.cleanup = entry.effect(); } },
    dispose() { for (const entry of effects.values()) entry.cleanup?.(); },
  };
}
const snapshot = f => ({ navigation: f.calls.navigation.length, feedback: f.calls.feedback.length,
  utility: f.calls.utility.length, activations: f.calls.activations.length });

test("shared index/TOC callers preserve versions/locators and inherited remote/offline query wiring", async () => {
  const seen = [], callers = wiring.callers(async target => { seen.push(target); });
  await callers[0]({ messageId: A.messageId, messageVersionId: A.messageVersionId });
  await callers[1]({ message_id: A.messageId, message_version_id: A.messageVersionId,
    render_block_id: "synthetic-heading", block_index: 4 });
  assert.deepEqual(seen, [A, { messageId: A.messageId, messageVersionId: A.messageVersionId,
    renderBlockId: "synthetic-heading", blockIndex: 4, preferTocPipeline: true,
    allowMessageFallback: true, source: "section-toc" }]);
  for (const tag of sheetTags) assert.equal(expression(attribute(tag, "networkMode")).getText(ast), "readerQueryNetworkMode");
  const desktopTags = tags.filter(tag => ["ConversationIndex", "ConversationToc"].includes(tag.tagName.getText(ast))
    && !sheetTags.includes(tag));
  assert.equal(desktopTags.length, 2);
  assert.ok(desktopTags.every(tag => !expression(attribute(tag, "onNavigate")).getText(ast).includes("navigateFromNavigationSheet")));
  const rawSetterCalls = all.filter(node => ts.isCallExpression(node)
    && node.expression.getText(ast) === "setUtilityPanelState");
  assert.equal(rawSetterCalls.length, 1); // Existing paths cannot bypass the common intent fence.
});

for (const mode of ["remote", "offline"]) {
  for (const viewport of ["mobile", "tablet"]) {
    test(`${mode}/${viewport}: current pending navigation closes only after success`, async () => {
      const f = fixture({ mode, viewport }), hold = deferred();
      f.handlers.navigate = () => hold.promise;
      try {
        const action = f.current.navigate(A); f.render();
        assert.equal(f.current.feedback.pending, true);
        assert.equal(f.state.utilityPanel, "navigation");
        hold.resolve(located(A)); await action; f.render();
        assert.deepEqual(f.calls.utility, [null]);
        assert.equal(f.current.feedback, null);
      } finally { f.dispose(); }
    });
  }
}

for (const outcome of ["failure", "exception", "cancelled"]) {
  test(`current ${outcome} ends pending without closing or storing raw exceptions`, async () => {
    const f = fixture();
    f.handlers.navigate = () => {
      if (outcome === "exception") throw Error("Synthetic private transport detail");
      return { ok: false, targetId: A.messageId, reason: outcome === "cancelled" ? "cancelled" : "load-failed" };
    };
    try {
      await f.current.navigate(A); f.render();
      assert.equal(f.current.feedback.pending, false);
      assert.equal(f.current.feedback.error, outcome === "cancelled" ? null : "failed");
      assert.equal(f.current.scope.pendingKey, null);
      assert.deepEqual(f.calls.utility, []);
      assert.equal(JSON.stringify(f.calls.feedback).includes("private transport"), false);
      f.handlers.navigate = target => located(target);
      await f.current.navigate(B);
      assert.deepEqual(f.calls.utility, [null]);
    } finally { f.dispose(); }
  });
}

test("same-pending-target coalescing does not block a different target or let an older rejection publish", async () => {
  const f = fixture(), hold = deferred();
  f.handlers.navigate = target => target.messageId === A.messageId ? hold.promise : located(target);
  try {
    const first = f.current.navigate(A);
    await f.current.navigate({ ...A }); f.render();
    assert.deepEqual(f.calls.navigation, [A]);
    assert.equal(f.current.feedback.pending, true);
    await f.current.navigate(B);
    const before = snapshot(f);
    hold.reject(Error("Synthetic obsolete failure")); await first;
    assert.deepEqual(snapshot(f), before);
  } finally { f.dispose(); }
});

test("a changed version or block in the same message is a different pending target", async () => {
  for (const change of [{ messageVersionId: "synthetic-other-version" }, { blockIndex: 7 }]) {
    const f = fixture(), hold = deferred(), changed = { ...A, ...change };
    f.handlers.navigate = target => target === A ? hold.promise : located(target);
    try {
      const first = f.current.navigate(A);
      await f.current.navigate(changed);
      assert.deepEqual(f.calls.navigation, [A, changed]);
      const before = snapshot(f);
      hold.resolve(located(A)); await first;
      assert.deepEqual(snapshot(f), before);
    } finally { f.dispose(); }
  }
});

for (const outcome of ["success", "failure", "exception"]) {
  test(`older ${outcome} cannot replace the newer pending/failure state or auto-close`, async () => {
    const f = fixture(), old = deferred(), newer = deferred();
    f.handlers.navigate = target => target.messageId === A.messageId ? old.promise : newer.promise;
    try {
      const first = f.current.navigate(A), second = f.current.navigate(B); f.render();
      const before = snapshot(f), key = f.current.scope.pendingKey;
      if (outcome === "exception") old.reject(Error("Synthetic old detail"));
      else old.resolve(outcome === "success" ? located(A) : { ok: false, targetId: A.messageId, reason: "load-failed" });
      await first; f.render();
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.current.feedback.pending, true);
      assert.equal(f.current.scope.pendingKey, key);
      newer.resolve({ ok: false, targetId: B.messageId, reason: "load-failed" }); await second; f.render();
      assert.equal(f.current.feedback.error, "failed");
      assert.deepEqual(f.calls.utility, []);
    } finally { f.dispose(); }
  });
}

for (const panel of [null, "search", "files", "share", "export"]) {
  test(`switching to ${panel ?? "closed"} synchronously retires an old jump and protects the selected surface`, async () => {
    const f = fixture(), hold = deferred();
    f.handlers.navigate = () => hold.promise;
    try {
      const action = f.current.navigate(A), oldCallback = f.current.navigate;
      f.current.utility(panel);
      assert.equal(f.current.scope.active, false); // No parent render yet.
      const before = snapshot(f);
      hold.resolve(located(A)); await action;
      await oldCallback(B);
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.state.utilityPanel, panel);
      f.render(); assert.equal(f.current.feedback, null);
    } finally { f.dispose(); }
  });
}

test("batched close/reopen keeps the transition callback stable but requires a fresh activation scope", async () => {
  const f = fixture(), old = deferred(), newer = deferred();
  f.handlers.navigate = target => target.messageId === A.messageId ? old.promise : newer.promise;
  try {
    const first = f.current.navigate(A), oldCallback = f.current.navigate, oldScope = f.current.scope, transition = f.current.utility;
    transition(null); transition("navigation");
    assert.equal(oldScope.active, false);
    await oldCallback(B);
    assert.deepEqual(f.calls.navigation, [A]);
    f.render();
    assert.notEqual(f.current.scope, oldScope);
    assert.equal(f.current.utility, transition);
    const second = f.current.navigate(B); f.render();
    assert.equal(f.current.feedback.pending, true);
    const before = snapshot(f);
    await oldCallback(B);
    old.resolve(located(A)); await first;
    assert.deepEqual(snapshot(f), before);
    newer.resolve(located(B)); await second;
    assert.deepEqual(f.calls.utility, [null, "navigation", null]);
  } finally { f.dispose(); }
});

for (const retirement of ["reopen", "tab", "viewport", "desktop", "source editor", "Reader hidden",
  "source", "conversation", "account", "unmount", "effect replay"]) {
  test(`${retirement} retires pending completion and its displayed wait`, async () => {
    const f = fixture(), hold = deferred();
    f.handlers.navigate = () => hold.promise;
    try {
      const action = f.current.navigate(A), oldCallback = f.current.navigate;
      f.render(); assert.equal(f.current.feedback.pending, true);
      if (retirement === "reopen") {
        f.current.utility(null); f.render(); f.current.utility("navigation"); f.render();
      } else if (retirement === "tab") {
        f.current.tab("sections"); assert.equal(f.current.scope.active, false); f.render();
      } else if (retirement === "viewport" || retirement === "desktop") {
        f.state.navigationViewport = retirement === "viewport" ? "tablet" : "desktop"; f.render();
      } else if (retirement === "source editor") { f.state.sourceEditorTarget = {}; f.render(); }
      else if (retirement === "Reader hidden") { f.state.readerSurfaceAvailable = false; f.render(); }
      else if (retirement === "source" || retirement === "conversation") f.switchVisit(retirement);
      else if (retirement === "account") f.accountChange();
      else if (retirement === "effect replay") f.replay();
      else f.dispose();
      const before = snapshot(f);
      hold.resolve(located(A)); await action;
      assert.deepEqual(snapshot(f), before);
      if (retirement !== "effect replay") {
        await oldCallback(B); assert.deepEqual(snapshot(f), before);
      }
      f.render(); assert.equal(f.current.feedback, null);
      if (retirement === "effect replay") {
        f.handlers.navigate = target => located(target);
        await f.current.navigate(B);
        assert.deepEqual(f.calls.utility, [null]);
      }
    } finally { f.dispose(); }
  });
}

test("selecting the active tab keeps its activation; both status placements translate finite flags on render", async () => {
  const f = fixture(), hold = deferred();
  f.handlers.navigate = () => hold.promise;
  try {
    const action = f.current.navigate(A);
    f.current.tab("dialogue"); assert.equal(f.current.scope.active, true);
    hold.resolve(located(A)); await action;
    assert.deepEqual(f.calls.tabs, []);
    const copies = [{ locating: "Locating", locateFailed: "Could not locate" },
      { locating: "正在定位", locateFailed: "定位失败" }];
    for (const copy of copies) {
      for (const state of [{ pending: true, error: null }, { pending: false, error: "failed" }, null]) {
        for (const status of wiring.status(state, key => copy[key] ?? key)) {
          const html = renderToStaticMarkup(status);
          assert.equal(html.includes(copy.locating), Boolean(state?.pending));
          assert.equal(html.includes(copy.locateFailed), Boolean(state?.error));
        }
      }
    }
  } finally { f.dispose(); }
});
