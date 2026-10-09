import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript"), React = appRequire("react"), jsx = appRequire("react/jsx-runtime");
const { QueryClient, QueryObserver } = appRequire("@tanstack/react-query");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const source = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const declarations = new Map(reader.body.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations].map(item => [item.name.getText(ast), item])));
const queryOptions = declarations.get("windowQuery").initializer.arguments[0].getText(ast);
const stateFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ReaderState");
const selected = reader.body.statements.filter(node => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(item => ["initialWindowReadUnavailable", "initialWindowRetryControl"].includes(item.name.getText(ast)));
  if (ts.isFunctionDeclaration(node)) return ["ownsReaderReadRecovery", "ownsInitialWindowReadRecovery", "retryInitialWindowRead"].includes(node.name?.text);
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
  const name = node.expression.expression.getText(ast);
  return name === "useEffect" && node.getText(ast).includes("if (!windowQuery.isSuccess || initialWindowAppliedRef.current)")
    || name === "useLayoutEffect" && node.getText(ast).includes("initialWindowRetryFocusRef");
});
const stateExpressions = [];
function findStates(node) {
  if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression)
    && /windowQuery\.is(?:Loading|Error|Success)/.test(node.expression.condition.getText(ast))
    && node.expression.getText(ast).includes("<ReaderState")) stateExpressions.push(node.expression.getText(ast));
  ts.forEachChild(node, findStates);
}
findStates(reader);
assert.equal(stateExpressions.length, 3, "extract only the three actual initial-window states");
const compile = text => ts.transpileModule(text, { fileName: "reader-initial-window-test.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const windowModule = { exports: {} };
new Function("require", "module", "exports", compile(readFileSync(new URL("../../apps/web/features/conversations/reader-window.ts", import.meta.url), "utf8")))(
  appRequire, windowModule, windowModule.exports,
);
const { loadCompleteTurnWindow: loadTurnNeighborhood, emptyLoadedWindow, replaceLoadedWindow, INITIAL_WINDOW_TURNS } = windowModule.exports;
const wrappers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["loadCompleteTurnWindow", "loadCompleteTurnWindowWithAnchorFallback", "isMissingReaderAnchorError"].includes(node.name?.text));
const queryModule = { exports: {} };
new Function("module", "loadTurnNeighborhood", "INITIAL_WINDOW_TURNS", compile(`
${wrappers.map(node => node.getText(ast)).join("\n")}
module.exports = ({ dataSource, conversationId, initialAnchorMessageId, canLoadInitialWindow, conversationQuery }) => (${queryOptions});
`))(queryModule, loadTurnNeighborhood, INITIAL_WINDOW_TURNS);
const buildOptions = queryModule.exports;
// Only real initial-state JSX, its retry/focus callbacks and apply-once effect
// run here. The rest of Reader is NOT mounted. Transport, hook scheduling,
// owner/auth, navigation state and DOM focus are explicit doubles.
const compiled = compile(`function InspectInitialWindow(input) {
  const { windowQuery, queryClient, conversationId, dataSource, resolvedLocale, initialAnchorMessageId,
    recentOwner, recentOwnerRef, initialWindowReadScope, initialWindowReadScopeRef, initialWindowAppliedRef,
    loadedWindowRef, navigationInProgressRef, navigationTokenRef, navigationStatus, initialWindowRetryButtonRef,
    initialWindowRetryFocusRef, scrollContainerRef, previousTurnAnchorRef, nextTurnAnchorRef, windowGenerationRef, setLoadedWindow } = input;
  const isOffline = dataSource.mode === "offline", messages = loadedWindowRef.current.items;
  ${selected.map(node => node.getText(ast)).join("\n")}
  return <section data-synthetic-reader-region="true">${stateExpressions.map(text => "{" + text + "}").join("\n")}</section>;
}
${stateFunction.getText(ast)}
module.exports = InspectInitialWindow;`);

class ApiRequestError extends Error { constructor(status) { super("Synthetic raw body read failure"); this.status = status; } }
const flush = async () => { await setImmediate(); await setImmediate(); };
const conversationId = "synthetic-initial-reader";
const makeTurns = () => Array.from({ length: 5 }, (_, index) => ({
  turn_key: "synthetic-turn-" + index, start_offset: index * 2, total_messages: 10,
  previous_anchor_message_id: index ? `synthetic-message-${index - 1}-user` : null,
  next_anchor_message_id: index < 4 ? `synthetic-message-${index + 1}-user` : null,
  items: ["user", "assistant"].map((role, part) => ({ id: `synthetic-message-${index}-${role}`, role,
    order_key: String(index * 2 + part).padStart(4, "0"), content: "Synthetic complete-turn text" })),
}));

async function fixture({ mode = "remote", locale = "en-US", anchor = null, error = new ApiRequestError(503), empty = false } = {}) {
  const turns = makeTurns(), reads = [], unexpected = [], retryOptions = [], pending = [];
  let currentError = error, held = null, epoch = 1, rejectRetry = false;
  const dataSource = { mode, getReaderTurn: async (id, requestedAnchor) => {
    reads.push({ id, anchor: requestedAnchor });
    if (held) await held;
    if (currentError) throw currentError;
    if (empty) return { ...turns[0], items: [], total_messages: 0, next_anchor_message_id: null };
    const turn = requestedAnchor ? turns.find(item => item.items.some(message => message.id === requestedAnchor)) : turns[0];
    if (!turn) throw new Error("Anchor message not found");
    return turn;
  } };
  const options = buildOptions({ dataSource, conversationId, initialAnchorMessageId: anchor, canLoadInitialWindow: true, conversationQuery: { isSuccess: true } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const key = options.queryKey;
  const unrelatedKeys = [["conversation", mode, conversationId], ["reading-position", mode, conversationId], ["recent-items"], ["conversations"], ["projects"]];
  for (const item of unrelatedKeys) client.setQueryData(item, { synthetic: item[0] });
  const observer = new QueryObserver(client, { ...options, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  const owner = { conversationId, dataSource, active: true, epoch: 1 }, ownerRef = { current: owner };
  const scope = { visit: owner, anchor }, scopeRef = { current: scope };
  const initialWindowAppliedRef = { current: false }, loadedWindowRef = { current: emptyLoadedWindow(3) };
  const navigationInProgressRef = { current: false }, navigationTokenRef = { current: 7 };
  const previousTurnAnchorRef = { current: null }, nextTurnAnchorRef = { current: null }, windowGenerationRef = { current: 3 };
  const body = { isConnected: true }, document = { body, activeElement: body };
  const root = { isConnected: true, focusCalls: [], focus(options) { this.focusCalls.push(options); document.activeElement = this; } };
  const retryButton = { isConnected: false, focusCalls: [], focus(options) { this.focusCalls.push(options); document.activeElement = this; } };
  const initialWindowRetryButtonRef = { current: null }, initialWindowRetryFocusRef = { current: null }, scrollContainerRef = { current: root };
  const buttons = [], layouts = [], effects = [];
  const Button = props => {
    buttons.push(props);
    if (props["data-reader-initial-read-retry"]) { retryButton.isConnected = true; if (props.ref) props.ref.current = retryButton; }
    return React.createElement("button", props);
  };
  const capture = factory => (type, props, key) => factory(type === "button" ? Button : type, props, key);
  const translations = { loadFailed: "Failed to load", loadingMessages: "Loading messages", loadingInitialMessages: "Loading initial messages",
    noMessagesTitle: "No messages", noConversationMessages: "This conversation has no messages" };
  const module = { exports: {} };
  new Function("require", "module", "exports", "React", "ApiRequestError", "useEffect", "useLayoutEffect", "authenticationGeneration",
    "document", "replaceLoadedWindow", "t", compiled)(
    name => name === "react/jsx-runtime" ? { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) } : appRequire(name), module, module.exports,
    React, ApiRequestError, operation => effects.push(operation), operation => layouts.push(operation), () => epoch,
    document, replaceLoadedWindow, name => translations[name] ?? name,
  );
  const render = () => {
    buttons.length = 0; layouts.length = 0; effects.length = 0;
    const wasConnected = retryButton.isConnected; retryButton.isConnected = false; initialWindowRetryButtonRef.current = null;
    const html = renderToStaticMarkup(React.createElement(module.exports, {
      windowQuery: { ...observer.getCurrentResult(), refetch: config => {
        retryOptions.push(config);
        const request = rejectRetry ? Promise.reject(new Error("Synthetic detached refetch rejection")) : observer.refetch(config);
        pending.push(request.catch(() => undefined)); return request;
      } }, queryClient: client, conversationId, dataSource, resolvedLocale: locale, initialAnchorMessageId: anchor,
      recentOwner: owner, recentOwnerRef: ownerRef, initialWindowReadScope: scope, initialWindowReadScopeRef: scopeRef,
      initialWindowAppliedRef, loadedWindowRef, navigationInProgressRef, navigationTokenRef,
      navigationStatus: navigationInProgressRef.current ? "loading" : "idle", initialWindowRetryButtonRef, initialWindowRetryFocusRef,
      scrollContainerRef, previousTurnAnchorRef, nextTurnAnchorRef, windowGenerationRef,
      setLoadedWindow: value => { loadedWindowRef.current = value; },
    }));
    if (wasConnected && !retryButton.isConnected && document.activeElement === retryButton) document.activeElement = body;
    for (const operation of layouts) operation();
    for (const operation of effects) operation();
    return html;
  };
  const control = () => buttons.find(button => button["data-reader-initial-read-retry"]);
  const retry = () => {
    const button = control(); assert.ok(button, "expected a rendered initial body Retry control"); document.activeElement = retryButton;
    const result = button.onClick(); if (result?.then) result.catch(error => unexpected.push(error)); return button;
  };
  return { client, key, options, observer, owner, ownerRef, scope, scopeRef, render, retry, control, retryButton, document, root,
    reads, retryOptions, initialWindowAppliedRef, loadedWindowRef, navigationInProgressRef, navigationTokenRef, unexpected, unrelatedKeys,
    previousTurnAnchorRef, nextTurnAnchorRef, turns, recover: () => { currentError = null; }, changeAccount: () => { epoch += 1; },
    changeAnchor: () => { scopeRef.current = { ...scope, anchor: "synthetic-later-anchor" }; },
    rejectRetry: () => { rejectRetry = true; },
    hold: () => { let release; held = new Promise(resolve => { release = resolve; }); return () => { held = null; release(); }; },
    acceptTarget: () => { navigationTokenRef.current += 1; initialWindowAppliedRef.current = true;
      loadedWindowRef.current = { ...emptyLoadedWindow(8), items: [{ id: "synthetic-navigated-message" }], total: 1 }; return loadedWindowRef.current; },
    settle: async () => { await flush(); await Promise.all(pending); await flush(); },
    dispose: () => { unsubscribe(); observer.destroy(); client.clear(); },
  };
}

test("initial body failure has localized recovery instead of raw upstream text", async () => {
  const f = await fixture(); try { const html = f.render(); assert.match(html, /Could not read the messages/);
    assert.match(html, /role="alert"/); assert.doesNotMatch(html, /Synthetic raw body/); assert.ok(f.control());
  } finally { f.dispose(); }
});
test("Chinese initial recovery offers the same explicit body read", async () => {
  const f = await fixture({ locale: "zh-CN" }); try { const html = f.render(); assert.match(html, /暂时无法读取正文/);
    assert.match(html, /重试读取正文/); assert.doesNotMatch(html, /Synthetic raw body/);
  } finally { f.dispose(); }
});
for (const status of [401, 403, 404]) {
  test("initial HTTP " + status + " offers a safe access recheck without a success/empty claim", async () => {
    const f = await fixture({ error: new ApiRequestError(status) }); try { const html = f.render();
      assert.match(html, /Messages are unavailable for your account/); assert.doesNotMatch(html, /Synthetic raw body|This conversation has no messages/);
      assert.ok(f.control()); assert.equal(f.loadedWindowRef.current.items.length, 0);
    } finally { f.dispose(); }
  });
}
test("Retry preserves the exact saved-anchor query key and loads whole turns without touching other queries", async () => {
  const anchor = "synthetic-message-2-user", f = await fixture({ anchor }); try {
    assert.deepEqual(f.key, ["reader-turn-window", "remote", conversationId, anchor]);
    f.render(); f.recover(); f.retry(); await f.settle(); f.render();
    assert.deepEqual(f.retryOptions, [{ cancelRefetch: false }]); assert.equal(f.reads[1].anchor, anchor);
    assert.equal(f.reads.length, 6); assert.equal(f.loadedWindowRef.current.items.length, 10);
    assert.equal(f.loadedWindowRef.current.turns.length, 5); assert.equal(f.initialWindowAppliedRef.current, true);
    assert.deepEqual(f.loadedWindowRef.current.items.map(item => item.id), f.turns.flatMap(turn => turn.items).map(item => item.id));
    for (const key of f.unrelatedKeys) { assert.deepEqual(f.client.getQueryData(key), { synthetic: key[0] }); assert.equal(f.client.getQueryState(key).isInvalidated, false); }
    assert.equal(f.previousTurnAnchorRef.current, null); assert.equal(f.nextTurnAnchorRef.current, null);
  } finally { f.dispose(); }
});
test("pending initial Retry has loading feedback and rejects repeated captured activation", async () => {
  const f = await fixture(); let release = () => {}; try { f.render(); f.recover(); release = f.hold(); const button = f.retry(); button.onClick(); await flush();
    const html = f.render(); assert.equal(f.retryOptions.length, 1); assert.equal(f.reads.length, 2);
    assert.match(html, /Loading initial messages/); assert.doesNotMatch(html, /This conversation has no messages/);
  } finally { release(); await f.settle(); f.dispose(); }
});
test("another failed retry stays recoverable and never invents a complete or empty body", async () => {
  const f = await fixture(); try { f.render(); f.retry(); await f.settle(); const html = f.render();
    assert.ok(f.control()); assert.match(html, /Could not read the messages/); assert.doesNotMatch(html, /This conversation has no messages/);
    assert.equal(f.loadedWindowRef.current.items.length, 0); assert.equal(f.initialWindowAppliedRef.current, false);
  } finally { f.dispose(); }
});
test("a loaded target retires the stale initial error surface", async () => {
  const f = await fixture(); try { f.acceptTarget(); const html = f.render(); assert.doesNotMatch(html, /Failed to load|Synthetic raw body|data-reader-initial-read-recovery/);
    assert.equal(f.control(), undefined);
  } finally { f.dispose(); }
});
test("a previously captured Retry cannot read after a target window was accepted", async () => {
  const f = await fixture(); try { f.render(); const button = f.control(); assert.ok(button); f.acceptTarget(); button.onClick(); await f.settle(); assert.equal(f.reads.length, 1); }
  finally { f.dispose(); }
});
test("a navigation already in progress owns the body instead of a newly clicked initial retry", async () => {
  const f = await fixture(); try { f.render(); const button = f.control(); assert.ok(button); f.navigationInProgressRef.current = true;
    button.onClick(); await f.settle(); assert.equal(f.reads.length, 1); f.render(); assert.equal(f.control().disabled, true);
  } finally { f.dispose(); }
});
for (const retire of ["unmount", "route", "account", "anchor"]) {
  test(retire + " retires an initial Retry callback", async () => {
    const f = await fixture(); try { f.render(); const button = f.control(); assert.ok(button);
      if (retire === "unmount") f.owner.active = false;
      else if (retire === "route") f.ownerRef.current = { ...f.owner };
      else if (retire === "account") f.changeAccount();
      else f.changeAnchor();
      button.onClick(); await f.settle(); assert.equal(f.reads.length, 1); assert.equal(f.retryOptions.length, 0);
    } finally { f.dispose(); }
  });
}
test("successful initial Retry restores lost focus to the existing Reader without scrolling", async () => {
  const f = await fixture(); try { f.render(); f.recover(); f.retry(); await f.settle(); f.render();
    assert.equal(f.document.activeElement, f.root); assert.deepEqual(f.root.focusCalls, [{ preventScroll: true }]);
  } finally { f.dispose(); }
});
test("initial read recovery does not reclaim a chosen control's focus", async () => {
  const f = await fixture(); try { f.render(); f.recover(); f.retry(); const chosen = { isConnected: true }; f.document.activeElement = chosen;
    await f.settle(); f.render(); assert.equal(f.document.activeElement, chosen); assert.equal(f.root.focusCalls.length, 0);
  } finally { f.dispose(); }
});
test("a late initial retry cannot replace a newer accepted navigation window or reclaim focus", async () => {
  const f = await fixture(); let release = () => {}; try { f.render(); f.recover(); release = f.hold(); f.retry(); await flush(); f.render();
    const accepted = f.acceptTarget(); release(); await f.settle(); f.render();
    assert.equal(f.loadedWindowRef.current, accepted); assert.equal(f.root.focusCalls.length, 0);
  } finally { release(); await f.settle(); f.dispose(); }
});
test("a detached initial refetch rejection remains handled", async () => {
  const f = await fixture(); try { f.render(); f.rejectRetry(); f.retry(); await f.settle(); assert.equal(f.unexpected.length, 0); }
  finally { f.dispose(); }
});
test("successful initial Query data is applied once with real complete turns (control)", async () => {
  const f = await fixture({ error: null }); try { f.render(); const loaded = f.loadedWindowRef.current;
    assert.equal(loaded.items.length, 10); assert.equal(loaded.turns.length, 5); f.render(); assert.equal(f.loadedWindowRef.current, loaded);
    assert.equal(f.control(), undefined);
  } finally { f.dispose(); }
});
test("genuine empty success is distinct from failure and has no retry (control)", async () => {
  const f = await fixture({ error: null, empty: true }); try { const html = f.render(); assert.match(html, /This conversation has no messages/);
    assert.equal(f.control(), undefined); assert.equal(f.initialWindowAppliedRef.current, true);
  } finally { f.dispose(); }
});
test("offline initial errors retain their existing message and gain no remote retry (control)", async () => {
  const f = await fixture({ mode: "offline" }); try { const html = f.render(); assert.match(html, /Synthetic raw body read failure/); assert.equal(f.control(), undefined); }
  finally { f.dispose(); }
});
test("missing remembered anchor uses the existing first-turn compatibility fallback (control)", async () => {
  const f = await fixture({ anchor: "synthetic-deleted-anchor", error: null }); try { f.render();
    assert.equal(f.reads[0].anchor, "synthetic-deleted-anchor"); assert.equal(f.reads[1].anchor, undefined);
    assert.equal(f.loadedWindowRef.current.items.length, 10); assert.equal(f.control(), undefined);
  } finally { f.dispose(); }
});
test("initial query enablement still waits for the original position/detail decision (control)", () => {
  const input = { dataSource: { mode: "remote" }, conversationId, initialAnchorMessageId: "synthetic-saved-anchor" };
  for (const [canLoadInitialWindow, success, enabled] of [[false, true, false], [true, false, false], [true, true, true]]) {
    const options = buildOptions({ ...input, canLoadInitialWindow, conversationQuery: { isSuccess: success } });
    assert.equal(options.enabled, enabled); assert.deepEqual(options.queryKey, ["reader-turn-window", "remote", conversationId, "synthetic-saved-anchor"]);
  }
});

test("current body items also retire initial recovery before the apply flag settles", async () => {
  const f = await fixture(); try { f.render(); const button = f.control(); assert.ok(button);
    f.loadedWindowRef.current = { ...emptyLoadedWindow(), items: [{ id: "synthetic-current-body" }] };
    button.onClick(); await f.settle(); assert.equal(f.reads.length, 1);
    assert.doesNotMatch(f.render(), /Failed to load|data-reader-initial-read-recovery/); assert.equal(f.control(), undefined);
  } finally { f.dispose(); }
});
test("an accepted empty window also retires a prior initial recovery action", async () => {
  const f = await fixture(); try { f.render(); const button = f.control(); assert.ok(button); f.initialWindowAppliedRef.current = true;
    button.onClick(); await f.settle(); assert.equal(f.reads.length, 1);
    assert.doesNotMatch(f.render(), /Failed to load|data-reader-initial-read-recovery/);
  } finally { f.dispose(); }
});
test("live query success fences a stale Retry before the apply-once effect runs", async () => {
  const f = await fixture(); try { f.render(); const button = f.control(); assert.ok(button); f.recover(); await f.observer.refetch();
    const reads = f.reads.length; assert.equal(f.initialWindowAppliedRef.current, false);
    button.onClick(); await f.settle(); assert.equal(f.reads.length, reads); assert.equal(f.retryOptions.length, 0);
  } finally { f.dispose(); }
});
test("a paused query state disables and rejects an additional initial read", async () => {
  const f = await fixture(); try {
    // Controlled cache-state check, not a browser/network-offline simulation.
    f.client.getQueryCache().find({ queryKey: f.key, exact: true }).setState({ fetchStatus: "paused" });
    f.render(); assert.equal(f.control().disabled, true); f.retry(); await f.settle(); assert.equal(f.reads.length, 1);
  } finally { f.dispose(); }
});
for (const retire of ["account", "anchor"]) {
  test(retire + " change while an initial retry is pending cannot reclaim focus", async () => {
    const f = await fixture(); let release = () => {}; try { f.render(); f.recover(); release = f.hold(); f.retry(); await flush(); f.render();
      if (retire === "account") f.changeAccount(); else f.changeAnchor();
      release(); await f.settle(); f.render(); assert.equal(f.root.focusCalls.length, 0);
    } finally { release(); await f.settle(); f.dispose(); }
  });
}
test("lost focus after another failed initial read returns to the current Retry control", async () => {
  const f = await fixture(); try { f.render(); f.retry(); f.document.activeElement = f.document.body; await f.settle(); f.render();
    assert.equal(f.document.activeElement, f.retryButton); assert.deepEqual(f.retryButton.focusCalls, [{ preventScroll: true }]);
  } finally { f.dispose(); }
});
test("the real initial recovery scope follows both visit ownership and the query's anchor", () => {
  const scope = declarations.get("initialWindowReadScope"); assert.ok(scope);
  assert.equal(scope.initializer.expression.getText(ast), "useMemo");
  assert.match(scope.initializer.arguments[0].getText(ast), /visit:\s*recentOwner/);
  assert.match(scope.initializer.arguments[0].getText(ast), /anchor:\s*initialAnchorMessageId/);
  assert.deepEqual(scope.initializer.arguments[1].elements.map(node => node.getText(ast)).sort(), ["initialAnchorMessageId", "recentOwner"]);
  assert.ok(reader.body.statements.some(node => ts.isExpressionStatement(node)
    && ts.isBinaryExpression(node.expression) && node.expression.left.getText(ast) === "initialWindowReadScopeRef.current"
    && node.expression.right.getText(ast) === "initialWindowReadScope"));
});
