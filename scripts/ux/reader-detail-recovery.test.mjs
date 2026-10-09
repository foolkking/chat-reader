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
const declarations = new Set(["conversationReadUnavailable", "retainReaderOnReadError", "retryConversationControl", "conversationReadNotice"]);
const selected = reader.body.statements.filter(node => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(item => declarations.has(item.name.getText(ast)));
  if (ts.isFunctionDeclaration(node)) return ["ownsReaderReadRecovery", "retryConversationRead"].includes(node.name?.text);
  if (ts.isIfStatement(node)) return node.expression.getText(ast).includes("conversationQuery.is") || node.expression.getText(ast) === "!conversation";
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
  const name = node.expression.expression.getText(ast);
  return name === "useEffect" && node.getText(ast).includes("document.title")
    || name === "useLayoutEffect" && node.getText(ast).includes("readRetryFocusRef");
});
assert.equal(selected.filter(node => ts.isIfStatement(node) && node.expression.getText(ast).includes("conversationQuery.isError")).length, 1);
const state = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ReaderState");
const hasNotice = selected.some(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === "conversationReadNotice"));
// Execute exact early returns, title effect, recovery JSX and callbacks extracted
// from the Reader. The rest of the Reader is an explicit retained-surface marker,
// NOT a mounted Reader/DOM/lifecycle test. Real QueryObserver drives read state;
// hook scheduling, ownership/auth, document/focus and transport are doubles.
const compiled = ts.transpileModule(`function InspectReader(input) {
  const { conversationQuery, queryClient, conversationId, dataSource, resolvedLocale, mergedIntoConversationId,
    recentOwner, recentOwnerRef, readRetryButtonRef, readRetryFocusRef, scrollContainerRef, router } = input;
  const conversation = conversationQuery.data, isOffline = dataSource.mode === "offline";
  const loadingProgress = 10, libraryMode = false;
  ${selected.map(node => node.getText(ast)).join("\n")}
  return <section data-synthetic-retained-reader="true">${hasNotice ? "{conversationReadNotice}" : ""}<p>Synthetic already loaded text</p></section>;
}
${state.getText(ast)}
module.exports = InspectReader;`, { fileName: "reader-detail-test.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

class ApiRequestError extends Error { constructor(status) { super("Synthetic raw upstream detail"); this.status = status; } }
const flush = async () => { await setImmediate(); await setImmediate(); };
const known = { id: "synthetic-reader-detail", title: "Synthetic private title", offline_revision: 9 };

async function fixture({ cached = true, error = new ApiRequestError(503), mode = "remote", locale = "en-US", wrongId = false, merged = null, startRead = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const key = ["conversation", mode, known.id];
  const retained = wrongId ? { ...known, id: "synthetic-different" } : known;
  const unrelatedKeys = [["reading-position", mode, known.id], ["reader-turn-window", mode, known.id, null], ["recent-items"], ["conversations"], ["projects"]];
  for (const item of unrelatedKeys) client.setQueryData(item, { synthetic: item[0] });
  let currentError = error, held = null, reads = 0, epoch = 1, rejectRetry = false;
  const main = new QueryObserver(client, { queryKey: key, enabled: false, initialData: cached ? retained : undefined,
    queryFn: async () => { reads += 1; if (held) await held; if (currentError) throw currentError; return known; } });
  const unsubscribe = main.subscribe(() => {});
  if (startRead) await main.refetch();
  const owner = { conversationId: known.id, dataSource: mode, active: true, epoch: 1 }, ownerRef = { current: owner };
  const body = { isConnected: true }, document = { body, activeElement: body, title: "" };
  const root = { isConnected: true, focusCalls: [], focus(options) { this.focusCalls.push(options); document.activeElement = this; } };
  const retryButton = { isConnected: false, disabled: false, focusCalls: [], focus(options) { this.focusCalls.push(options); document.activeElement = this; } };
  const readRetryButtonRef = { current: null }, readRetryFocusRef = { current: null }, scrollContainerRef = { current: root };
  const buttons = [], layouts = [], effects = [], retryOptions = [], navigation = [], pending = [], unexpectedFailures = [];
  const translations = { conversationUnavailable: "Conversation unavailable", noConversationPayload: "No conversation payload" };
  const Button = props => {
    buttons.push(props);
    if (props["data-reader-read-retry"]) {
      retryButton.isConnected = true; retryButton.disabled = Boolean(props.disabled);
      if (props.ref) props.ref.current = retryButton;
    }
    return React.createElement("button", props);
  };
  const capture = factory => (type, props, key) => factory(type === "button" ? Button : type, props, key);
  const module = { exports: {} };
  new Function("require", "module", "exports", "React", "ApiRequestError", "useEffect", "useLayoutEffect", "authenticationGeneration",
    "document", "APP_TITLE", "formatConversationTitle", "t", "ReaderLoadingShell", compiled)(
    name => name === "react/jsx-runtime" ? { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) } : appRequire(name),
    module, module.exports, React, ApiRequestError, operation => effects.push(operation), operation => layouts.push(operation),
    () => epoch, document, "Chat Reader", item => item.title + " · Chat Reader", name => translations[name] ?? name,
    () => React.createElement("div", { "data-synthetic-loading-shell": true }, "Synthetic loading"),
  );
  const render = () => {
    buttons.length = 0; layouts.length = 0; effects.length = 0;
    const wasConnected = retryButton.isConnected; retryButton.isConnected = false; readRetryButtonRef.current = null;
    const result = main.getCurrentResult();
    const html = renderToStaticMarkup(React.createElement(module.exports, {
      conversationQuery: { ...result, refetch: options => {
        retryOptions.push(options);
        const request = rejectRetry ? Promise.reject(new Error("Synthetic rejecting retry")) : main.refetch(options);
        pending.push(request.catch(() => undefined)); return request;
      } },
      queryClient: client, conversationId: known.id, dataSource: { mode }, resolvedLocale: locale, mergedIntoConversationId: merged,
      recentOwner: owner, recentOwnerRef: ownerRef, readRetryButtonRef, readRetryFocusRef, scrollContainerRef, router: { push: value => navigation.push(value) },
    }));
    scrollContainerRef.current = html.includes("data-synthetic-retained-reader") ? root : null;
    if (wasConnected && !retryButton.isConnected && document.activeElement === retryButton) document.activeElement = body;
    for (const operation of layouts) operation();
    for (const operation of effects) operation();
    return html;
  };
  const control = () => buttons.find(button => button["data-reader-read-retry"]);
  const retry = () => {
    const button = control(); assert.ok(button, "expected a rendered detail Retry control");
    document.activeElement = retryButton;
    const returned = button.onClick();
    if (returned?.then) returned.catch(error => unexpectedFailures.push(error));
    return button;
  };
  return { client, key, main, owner, ownerRef, render, retry, control, buttons, retryOptions, navigation, document, root, retryButton, unrelatedKeys, unexpectedFailures,
    reads: () => reads, recover: () => { currentError = null; }, fail: next => { currentError = next; },
    changeAccount: () => { epoch += 1; }, replaceOwner: () => { ownerRef.current = { ...owner }; },
    rejectRetry: () => { rejectRetry = true; },
    hold: () => { let release; held = new Promise(resolve => { release = resolve; }); return () => { held = null; release(); }; },
    settle: async () => { await flush(); await Promise.all(pending); await flush(); },
    dispose: () => { unsubscribe(); main.destroy(); client.clear(); },
  };
}

for (const error of [new ApiRequestError(503), new Error("Synthetic network unavailable")]) {
  test(error instanceof ApiRequestError ? "cached detail survives a 503 with a compact read retry" : "cached detail survives a transport error without raw details", async () => {
    const f = await fixture({ error }); try { const html = f.render();
      assert.match(html, /data-synthetic-retained-reader/); assert.match(html, /Previously loaded content/);
      assert.match(html, /role="alert"/); assert.ok(f.control()); assert.doesNotMatch(html, /Synthetic (raw|network)/);
    } finally { f.dispose(); }
  });
}
test("Retry reads only the existing detail query and leaves other caches unchanged", async () => {
  const f = await fixture(); try { const cached = f.client.getQueryData(f.key); f.render(); f.recover(); f.retry(); await f.settle();
    assert.equal(f.reads(), 2); assert.equal(f.retryOptions.length, 1); assert.deepEqual(f.retryOptions[0], { cancelRefetch: false });
    assert.match(f.render(), /data-synthetic-retained-reader/); assert.equal(f.control(), undefined); assert.equal(f.navigation.length, 0);
    assert.equal(f.client.getQueryData(f.key), cached);
    for (const key of f.unrelatedKeys) { assert.deepEqual(f.client.getQueryData(key), { synthetic: key[0] }); assert.equal(f.client.getQueryState(key).isInvalidated, false); }
  } finally { f.dispose(); }
});
test("held Retry keeps the surface, disables its own control and ignores repeated activation", async () => {
  const f = await fixture(); let release = () => {}; try { f.render(); release = f.hold(); f.recover(); const button = f.retry(); button.onClick(); await flush();
    const html = f.render(); assert.equal(f.reads(), 2); assert.equal(f.retryOptions.length, 1);
    assert.match(html, /data-synthetic-retained-reader/); assert.match(html, /aria-busy="true"/); assert.equal(f.control().disabled, true);
  } finally { release(); await f.settle(); f.dispose(); }
});
test("a repeated read failure remains recoverable without a raw error or fabricated success", async () => {
  const f = await fixture(); try { f.render(); f.retry(); await f.settle(); const html = f.render();
    assert.match(html, /Previously loaded content/); assert.ok(f.control()); assert.equal(f.control().disabled, false);
    assert.doesNotMatch(html, /Synthetic raw upstream/); assert.equal(f.main.getCurrentResult().isError, true);
  } finally { f.dispose(); }
});
test("initial failure offers a detail-only Retry instead of fabricating a reading surface", async () => {
  const f = await fixture({ cached: false }); try { const html = f.render(); assert.doesNotMatch(html, /data-synthetic-retained-reader|Synthetic raw upstream/);
    assert.ok(f.control()); f.recover(); f.retry(); await f.settle(); assert.match(f.render(), /data-synthetic-retained-reader/);
  } finally { f.dispose(); }
});
for (const status of [401, 403, 404]) {
  test("HTTP " + status + " hides cached content and document title while retaining a safe access recheck", async () => {
    const f = await fixture({ error: new ApiRequestError(status) }); try { const html = f.render();
      assert.doesNotMatch(html, /data-synthetic-retained-reader|Synthetic private title|Synthetic raw upstream/);
      assert.equal(f.document.title, "Chat Reader"); assert.ok(f.control()); assert.match(html, /unavailable for your account/);
    } finally { f.dispose(); }
  });
}
test("offline detail errors keep their original boundary and gain no remote Retry (control)", async () => {
  const f = await fixture({ mode: "offline" }); try { const html = f.render(); assert.doesNotMatch(html, /data-synthetic-retained-reader/);
    assert.match(html, /Synthetic raw upstream/); assert.equal(f.control(), undefined);
  } finally { f.dispose(); }
});
test("known merged conversations keep their existing destination instead of retained stale reading (control)", async () => {
  const f = await fixture({ merged: "synthetic-merge-target" }); try { const html = f.render(); assert.match(html, /This conversation was merged/);
    assert.doesNotMatch(html, /data-synthetic-retained-reader/); assert.equal(f.control(), undefined);
    assert.equal(f.buttons.length, 1); f.buttons[0].onClick(); assert.deepEqual(f.navigation, ["/conversations/synthetic-merge-target"]);
  } finally { f.dispose(); }
});
test("a different cached conversation cannot become a retained current Reader (control)", async () => {
  const f = await fixture({ wrongId: true }); try { assert.doesNotMatch(f.render(), /data-synthetic-retained-reader/); } finally { f.dispose(); }
});
test("successful reading has no new failure UI (control)", async () => {
  const f = await fixture({ error: null }); try { assert.match(f.render(), /data-synthetic-retained-reader/); assert.equal(f.control(), undefined); }
  finally { f.dispose(); }
});
test("transient errors retain the known title as well as the cached snapshot (control)", async () => {
  const f = await fixture(); try { f.render(); assert.equal(f.document.title, "Synthetic private title · Chat Reader");
    assert.equal(f.client.getQueryData(f.key), known);
  } finally { f.dispose(); }
});
for (const retire of ["unmount", "route", "account"]) {
  test(retire + " retires a previously captured Retry callback", async () => {
    const f = await fixture(); try { f.render(); const button = f.control(); assert.ok(button);
      if (retire === "unmount") f.owner.active = false; else if (retire === "route") f.replaceOwner(); else f.changeAccount();
      button.onClick(); await f.settle(); assert.equal(f.reads(), 1); assert.equal(f.retryOptions.length, 0);
    } finally { f.dispose(); }
  });
}
test("successful Retry restores only lost focus to the existing scroll region without scrolling", async () => {
  const f = await fixture(); try { f.render(); f.recover(); f.retry(); await f.settle(); f.render();
    assert.equal(f.document.activeElement, f.root); assert.deepEqual(f.root.focusCalls, [{ preventScroll: true }]);
  } finally { f.dispose(); }
});
test("a control the person selected during Retry keeps focus", async () => {
  const f = await fixture(); try { f.render(); f.recover(); f.retry(); const chosen = { isConnected: true }; f.document.activeElement = chosen;
    await f.settle(); f.render(); assert.equal(f.document.activeElement, chosen); assert.equal(f.root.focusCalls.length, 0);
  } finally { f.dispose(); }
});
test("an old owner cannot restore focus into a later Reader", async () => {
  const f = await fixture(); try { f.render(); f.recover(); f.retry(); f.replaceOwner(); await f.settle(); f.render(); assert.equal(f.root.focusCalls.length, 0); }
  finally { f.dispose(); }
});
test("Chinese read recovery uses the same single explicit action", async () => {
  const f = await fixture({ locale: "zh-CN" }); try { const html = f.render(); assert.match(html, /仍显示上次读取的内容/); assert.match(html, /重试读取对话/);
    assert.doesNotMatch(html, /Previously loaded content|Synthetic raw upstream/); assert.ok(f.control());
  } finally { f.dispose(); }
});
test("a rejecting detached refetch promise remains handled", async () => {
  const f = await fixture(); try { f.render(); f.rejectRetry(); f.retry(); await f.settle(); assert.equal(f.unexpectedFailures.length, 0); }
  finally { f.dispose(); }
});

test("initial pending retry shows the loading branch without a cached-content claim", async () => {
  const f = await fixture({ cached: false }); let release = () => {}; try { f.render(); release = f.hold(); f.recover(); f.retry(); await flush();
    const html = f.render(); assert.match(html, /data-synthetic-loading-shell/); assert.doesNotMatch(html, /data-synthetic-retained-reader|Previously loaded content/);
    release(); await f.settle(); f.render(); assert.equal(f.document.activeElement, f.root);
  } finally { release(); await f.settle(); f.dispose(); }
});
test("lost focus after another failed Retry returns to the current Retry control", async () => {
  const f = await fixture(); try { f.render(); f.retry(); f.document.activeElement = f.document.body; await f.settle(); f.render();
    assert.equal(f.document.activeElement, f.retryButton); assert.deepEqual(f.retryButton.focusCalls, [{ preventScroll: true }]);
  } finally { f.dispose(); }
});
test("an account change during Retry cannot reclaim focus", async () => {
  const f = await fixture(); try { f.render(); f.recover(); f.retry(); f.changeAccount(); await f.settle(); f.render(); assert.equal(f.root.focusCalls.length, 0); }
  finally { f.dispose(); }
});
test("a wrong-id cached snapshot is never used as the document title", async () => {
  const f = await fixture({ wrongId: true }); try { f.render(); assert.equal(f.document.title, "Chat Reader"); } finally { f.dispose(); }
});
test("actual Reader JSX places one recovery notice outside scroll/header content and labels the existing focus region", () => {
  const uses = [], scrollRoots = [];
  const attribute = (opening, name) => opening.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(ast) === name);
  function walk(node) {
    if (ts.isJsxExpression(node) && node.expression?.getText(ast) === "conversationReadNotice") uses.push(node);
    if (ts.isJsxOpeningElement(node) && attribute(node, "data-testid")?.initializer?.getText(ast) === '"reader-scroll-root"') scrollRoots.push(node);
    ts.forEachChild(node, walk);
  }
  walk(reader);
  assert.equal(uses.length, 1); assert.equal(scrollRoots.length, 1);
  const section = uses[0].parent;
  assert.equal(section.openingElement.tagName.getText(ast), "section");
  assert.ok(attribute(section.openingElement, "data-reader-main-section"));
  assert.equal(attribute(scrollRoots[0], "role").initializer.getText(ast), '"region"');
  assert.equal(attribute(scrollRoots[0], "tabIndex").initializer.getText(ast), "{-1}");
  assert.ok(attribute(scrollRoots[0], "aria-label")); assert.equal(attribute(scrollRoots[0], "key"), undefined);
});
