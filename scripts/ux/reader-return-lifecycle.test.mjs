import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = ts.createSourceFile("reader.tsx", readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const declaration = reader.body.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => item.name.getText(source) === "returnToTocOrigin"));
const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture() {
  const navigation = deferred(), alignment = deferred(), calls = [];
  const anchor = { messageId: "synthetic", messageVersionId: "version", blockIndex: 2, offset: 48 };
  const state = {
    tocReturnPointRef: { current: anchor }, navigationStatus: "idle", tocReturnFlightRef: { current: null },
    tocReturnIdentityRef: { current: { accessGeneration: 1, conversationId: "conversation" } },
    authenticationGeneration: () => 1, setTocReturnPoint: value => calls.push(["checkpoint", value]),
    setTocReturnError: value => calls.push(["error", value]), setTocReturnPending: value => calls.push(["pending", value]),
    navigateToTarget: target => { calls.push(["navigate", target]); return navigation.promise; },
    restoreScrollAnchor: options => { calls.push(["align", options]); return alignment.promise; },
    ownsReaderReadRecovery: () => true, recentOwner: {}, userScrollIntentRef: { current: false },
    navigationTokenRef: { current: 1 }, scrollContainerRef: { current: {} },
    resolvedLocale: "en-US", conversationId: "conversation",
  };
  const run = new Function(...Object.keys(state), `${code};return returnToTocOrigin;`)(...Object.values(state));
  return { state, anchor, navigation, alignment, calls, run };
}
test("Return remains busy through final exact alignment and rejects duplicate activation", async () => {
  const f = fixture(), first = f.run();
  await f.run();
  assert.equal(f.calls.filter(([name]) => name === "navigate").length, 1);
  f.navigation.resolve({ ok: true }); await Promise.resolve();
  assert.deepEqual(f.calls.filter(([name]) => name === "pending"), [["pending", true]]);
  assert.equal(f.state.tocReturnPointRef.current, f.anchor);
  f.alignment.resolve(true); await first;
  assert.equal(f.state.tocReturnPointRef.current, null);
  assert.deepEqual(f.calls.filter(([name]) => name === "pending"), [["pending", true], ["pending", false]]);
});
test("failure preserves the original checkpoint and explains retry", async () => {
  const f = fixture(), work = f.run();
  f.navigation.resolve({ ok: false, reason: "load-failed" }); await work;
  assert.equal(f.state.tocReturnPointRef.current, f.anchor);
  assert.match(f.calls.find(([name, value]) => name === "error" && value)?.[1], /checkpoint is retained/i);
  assert.equal(f.state.tocReturnFlightRef.current, null);
});
test("identity retirement prevents a late Return from clearing or republishing state", async () => {
  const f = fixture(), work = f.run();
  f.navigation.resolve({ ok: true }); await Promise.resolve();
  const next = { messageId: "next", offset: 99 };
  f.state.tocReturnPointRef.current = next;
  f.state.tocReturnFlightRef.current = null;
  const count = f.calls.length;
  f.alignment.resolve(true); await work;
  assert.equal(f.state.tocReturnPointRef.current, next);
  assert.equal(f.calls.length, count);
});
test("explicit locate-message fallback does not invent an exact block restoration", async () => {
  const f = fixture(), work = f.run(true);
  assert.deepEqual(f.calls.find(([name]) => name === "navigate")[1], { messageId: "synthetic", source: "message-action", allowMessageFallback: true });
  f.navigation.resolve({ ok: true }); await work;
  assert.equal(f.calls.some(([name]) => name === "align"), false);
  assert.equal(f.state.tocReturnPointRef.current, null);
});
