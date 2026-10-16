import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(new URL("../../apps/web/features/sharing/share-readonly-reader.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("share-readonly-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ShareReadonlyReader");
const names = new Set(["navigationVisit", "unlockPassword", "unlockBusy", "unlockError",
  "unlockAttemptRef", "refetchShare", "handleUnlockPasswordChange", "handleUnlock"]);
const declares = node => ts.isIdentifier(node) ? names.has(node.text)
  : ts.isArrayBindingPattern(node) && node.elements.some(item => ts.isBindingElement(item) && declares(item.name));
const selected = reader.body.statements.filter(node =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => declares(item.name)))
  || (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "useLayoutEffect"
    && (node.getText(ast).includes("navigationVisit.active = true;")
      || node.getText(ast).includes("setUnlockPassword(\"\");"))));
assert.equal(selected.length, names.size + 2);
const gate = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SharePasswordGate");
let gateCall;
const findGate = node => {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "SharePasswordGate") gateCall = node;
  ts.forEachChild(node, findGate);
};
findGate(reader);
assert.ok(gate && gateCall);
const inputs = ["token", "shareQuery", "zh", "windowGenerationRef", "navigationTokenRef", "loadedWindowRef",
  "initialWindowAppliedRef", "loadingPreviousRef", "loadingNextRef", "edgeTransitionRef", "userScrollIntentRef",
  "scrollDirectionRef", "scrollIntentSequenceRef", "previousTurnAnchorRef", "nextTurnAnchorRef",
  "restoreAttemptedRef", "latestStablePositionRef", "targetHighlightTimerRef", "setLoadedWindow",
  "setEdgeLoading", "setEdgeError", "setPositionReady", "setActiveMessageId", "setNavigationTargetMessageId",
  "setActiveBlockId", "setTargetHighlightId", "setMobileNavigation"];
const compiled = ts.transpileModule(`function renderUnlock(input) {
  const { ${inputs.join(", ")} } = input;
  ${selected.map(node => node.getText(ast)).join("\n")}
  return { submit: handleUnlock, change: handleUnlockPasswordChange,
    visit: navigationVisit, password: unlockPassword, busy: unlockBusy, error: unlockError,
    gate: ${gateCall.getText(ast)} };
}
${gate.getText(ast)}
exports.renderUnlock = renderUnlock;
exports.gate = SharePasswordGate;`, { fileName: "share-unlock-harness.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class ApiRequestError extends Error {
  constructor(status) { super("Synthetic private failure must not appear"); this.status = status; }
}
const genericError = zh => zh ? "密码不正确，或暂时无法解锁分享。"
  : "The password was incorrect, or the share could not be unlocked right now.";
const limitedError = zh => zh ? "尝试次数过多，请稍后再试。" : "Too many attempts. Please try again later.";

// Actual extracted visit factory, complete visit layout lifecycle, unlock
// state/ref/callbacks/reset and password-gate JSX. Hook scheduling, transport,
// query outcomes and unrelated Reader resets are controlled adapters. These
// assertions are not mounted React, browser, password-manager or auth evidence.
function fixture({ zh = false } = {}) {
  const calls = { posts: [], reads: [], writes: [] }, handlers = {};
  const states = [], refs = [], memos = [], layouts = new Map(), readFunctions = new Map();
  let stateCursor, refCursor, memoCursor, layoutCursor, pending, dirty, current;
  const input = { token: "synthetic-share-A", zh };
  for (const name of inputs.filter(name => name.endsWith("Ref"))) input[name] = { current: null };
  input.windowGenerationRef.current = 0;
  input.navigationTokenRef.current = 0;
  input.scrollIntentSequenceRef.current = 0;
  for (const name of inputs.filter(name => name.startsWith("set"))) input[name] = () => undefined;
  const memo = (factory, deps) => {
    const index = memoCursor++, previous = memos[index];
    if (!previous || !same(previous.deps, deps)) memos[index] = { deps, value: factory() };
    return memos[index].value;
  };
  const exports = {};
  const dependencies = { exports, require, ApiRequestError,
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useState: initial => {
      const index = stateCursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => {
        calls.writes.push({ index, value });
        if (!Object.is(value, states[index])) dirty = true;
        states[index] = value;
      }];
    },
    useRef: initial => {
      const index = refCursor++;
      return refs[index] ?? (refs[index] = { current: initial });
    },
    useLayoutEffect: (effect, deps) => pending.set(layoutCursor++, { effect, deps }),
    unlockSharedConversation: async (token, password) => {
      calls.posts.push({ token, password });
      return handlers.unlock?.(token, password);
    },
    emptyLoadedWindow: generation => ({ items: [], generation }),
    window: { clearTimeout: () => undefined },
  };
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const render = () => {
    do {
      dirty = false; stateCursor = 0; refCursor = 0; memoCursor = 0; layoutCursor = 0;
      pending = new Map();
      const token = input.token;
      if (!readFunctions.has(token)) readFunctions.set(token, async () => {
        calls.reads.push(token);
        return handlers.refetch ? handlers.refetch(token) : { isSuccess: true };
      });
      input.shareQuery = { refetch: readFunctions.get(token) };
      current = exports.renderUnlock(input);
      const changed = [...pending].filter(([index, next]) => !same(layouts.get(index)?.deps, next.deps));
      for (const [index] of changed) layouts.get(index)?.cleanup?.();
      for (const [index, next] of changed) layouts.set(index, { ...next, cleanup: next.effect() });
    } while (dirty);
  };
  render();
  return { calls, handlers, render,
    get current() { return current; },
    get state() { return { password: states[0], busy: states[1], error: states[2] }; },
    get attempt() { return refs[0].current; },
    edit(value) { current.change(value); render(); },
    switchVisit() { input.token = "synthetic-share-B"; render(); },
    replayLayout() {
      for (const entry of layouts.values()) entry.cleanup?.();
      for (const entry of layouts.values()) entry.cleanup = entry.effect();
      render();
    },
    dispose() { for (const entry of layouts.values()) entry.cleanup?.(); },
    markup() { return renderToStaticMarkup(current.gate); },
    form() { return exports.gate(current.gate.props).props.children; },
  };
}

test("rapid submit is coalesced before rendering busy; pending edits cannot change its raw password", async () => {
  const f = fixture(), hold = deferred();
  f.handlers.unlock = () => hold.promise;
  try {
    assert.equal(await f.current.submit(), undefined);
    assert.equal(f.calls.posts.length, 0);
    f.edit("  synthetic password  ");
    const oldChange = f.current.change, oldSubmit = f.current.submit;
    const first = oldSubmit();
    await oldSubmit();
    oldChange("synthetic replacement");
    assert.deepEqual(f.calls.posts, [{ token: "synthetic-share-A", password: "  synthetic password  " }]);
    assert.deepEqual(f.state, { password: "  synthetic password  ", busy: true, error: null });
    f.render();
    assert.equal(f.current.gate.props.onSubmit, f.current.submit);
    assert.equal(f.current.gate.props.onPasswordChange, f.current.change);
    assert.match(f.markup(), /<form[^>]*aria-busy="true"/);
    assert.match(f.markup(), /<input[^>]*disabled=""/);
    assert.match(f.markup(), /Checking…/);
    hold.resolve();
    await first;
    assert.deepEqual(f.calls.reads, ["synthetic-share-A"]);
    assert.deepEqual(f.state, { password: "", busy: false, error: null });
    assert.equal(f.attempt, null);
  } finally { f.dispose(); }
});

for (const zh of [false, true]) {
  for (const status of [401, 429, 500]) {
    test(`current ${status} failure retains input and finite ${zh ? "Chinese" : "English"} feedback; edit/retry clears it`, async () => {
      const f = fixture({ zh });
      f.handlers.unlock = () => { throw new ApiRequestError(status); };
      try {
        f.edit("synthetic retry password");
        await f.current.submit();
        assert.deepEqual(f.state, { password: "synthetic retry password", busy: false,
          error: status === 429 ? limitedError(zh) : genericError(zh) });
        assert.equal(f.calls.reads.length, 0);
        assert.equal(f.attempt, null);
        f.render();
        assert.match(f.markup(), /role="alert"/);
        assert.doesNotMatch(f.markup(), /Synthetic private failure/);
        f.edit(" synthetic corrected ");
        assert.equal(f.state.error, null);
        assert.doesNotMatch(f.markup(), /role="alert"/);
        f.handlers.unlock = () => undefined;
        await f.current.submit();
        assert.equal(f.calls.posts[1].password, " synthetic corrected ");
        assert.equal(f.state.password, "");
        assert.equal(f.calls.reads.length, 1);
      } finally { f.dispose(); }
    });
  }
}

for (const throws of [false, true]) {
  test(`failed follow-up read ${throws ? "rejects" : "returns an error result"} without clearing the submitted password`, async () => {
    const f = fixture();
    f.handlers.refetch = () => {
      if (throws) throw new Error("Synthetic private read failure");
      return { isSuccess: false, isError: true };
    };
    try {
      f.edit("synthetic retained password");
      await f.current.submit();
      assert.equal(f.state.password, "synthetic retained password");
      assert.equal(f.state.busy, false);
      assert.equal(f.state.error, throws ? genericError(false) : null);
      assert.equal(f.attempt, null);
    } finally { f.dispose(); }
  });
}

test("the owned attempt remains busy and coalesced while metadata refetch is pending", async () => {
  const f = fixture(), read = deferred();
  f.handlers.refetch = () => read.promise;
  try {
    f.edit("synthetic waiting password");
    const first = f.current.submit();
    await setImmediate();
    f.render();
    await f.current.submit();
    f.current.change("synthetic premature edit");
    assert.equal(f.calls.posts.length, 1);
    assert.equal(f.calls.reads.length, 1);
    assert.deepEqual(f.state, { password: "synthetic waiting password", busy: true, error: null });
    read.resolve({ isSuccess: true });
    await first;
    assert.deepEqual(f.state, { password: "", busy: false, error: null });
  } finally { f.dispose(); }
});

for (const stage of ["unlock", "refetch"]) {
  for (const retirement of ["visit", "dispose", "replay"]) {
    for (const rejects of [false, true]) {
      test(`${stage} ${rejects ? "rejection" : "completion"} after ${retirement} cannot publish, follow up or clear a new pending attempt`, async () => {
        const f = fixture(), old = deferred(), newer = deferred();
        try {
          f.handlers[stage] = () => old.promise;
          f.edit("synthetic old password");
          const retained = f.current, older = retained.submit();
          await setImmediate();
          assert.equal(f.calls.posts.length, 1);
          assert.equal(f.calls.reads.length, stage === "refetch" ? 1 : 0);
          if (retirement === "visit") f.switchVisit();
          else if (retirement === "replay") f.replayLayout();
          else f.dispose();
          let newPending;
          if (retirement !== "dispose") {
            assert.deepEqual(f.state, { password: "", busy: false, error: null });
            f.handlers.unlock = () => newer.promise;
            f.handlers.refetch = () => ({ isSuccess: true });
            f.edit("synthetic new password");
            newPending = f.current.submit();
            f.render();
          }
          const before = { writes: f.calls.writes.length, posts: f.calls.posts.length,
            reads: f.calls.reads.length, attempt: f.attempt, state: f.state };
          if (retirement !== "replay") {
            retained.change("synthetic stale edit");
            await retained.submit();
          }
          if (rejects) old.reject(new ApiRequestError(429));
          else old.resolve(stage === "refetch" ? { isSuccess: true } : undefined);
          await older;
          assert.deepEqual({ writes: f.calls.writes.length, posts: f.calls.posts.length,
            reads: f.calls.reads.length, attempt: f.attempt, state: f.state }, before);
          if (newPending) {
            assert.equal(f.state.busy, true);
            newer.resolve();
            await newPending;
            assert.deepEqual(f.state, { password: "", busy: false, error: null });
          }
        } finally { f.dispose(); }
      });
    }
  }
}

test("a failed gate resets error/password on token change and the native form still prevents default and submits once", async () => {
  const f = fixture(), hold = deferred();
  try {
    f.handlers.unlock = () => { throw new ApiRequestError(401); };
    f.edit("synthetic failed password");
    await f.current.submit();
    f.switchVisit();
    assert.deepEqual(f.state, { password: "", busy: false, error: null });
    f.edit("synthetic next password");
    assert.match(f.markup(), /for="share-password"/);
    assert.match(f.markup(), /type="password"/);
    assert.match(f.markup(), /autoComplete="current-password"/i);
    f.handlers.unlock = () => hold.promise;
    let prevented = 0;
    const form = f.form();
    form.props.onSubmit({ preventDefault() { prevented++; } });
    form.props.onSubmit({ preventDefault() { prevented++; } });
    assert.equal(prevented, 2);
    assert.equal(f.calls.posts.length, 2); // One earlier failed attempt, one new form attempt.
    hold.resolve();
    await setImmediate();
    assert.equal(f.calls.reads.at(-1), "synthetic-share-B");
    assert.equal(f.state.busy, false);
  } finally { f.dispose(); }
});
