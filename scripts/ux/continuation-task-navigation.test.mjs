import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url)), ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "openContinuation") handler = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(handler, "Use the actual Reader callback, not a duplicate recovery implementation");
const compiled = ts.transpileModule("const handler = " + handler + ";", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ canManageCanonical = true, mode = "remote" } = {}) {
  let generation = 1, checks = 0, finish;
  const opened = [], guide = [];
  const open = new Function("canManageCanonical", "dataSource", "conversationId", "closeSourceEditorForWorkspace",
    "authenticationGeneration", "setContinuationGuideRequested", "setContinuationOpen", compiled + "\nreturn handler;")(
    canManageCanonical, { mode }, "synthetic-owner-target",
    () => { checks++; return new Promise(resolve => { finish = resolve; }); },
    () => generation, value => guide.push(value), value => opened.push(value));
  return { open, opened, guide, get checks() { return checks; }, finish: value => finish(value), switchAccount: () => generation++ };
}
const event = (id = "synthetic-owner-target") => {
  const value = new Event("chat-reader:open-continuation", { cancelable: true });
  value.detail = { conversationId: id }; return value;
};
test("same-page recovery waits for the existing unsaved-source guard; decline cannot navigate or open", async () => {
  const f = fixture(), request = event();
  f.open(request);
  assert.equal(request.defaultPrevented, true);
  assert.equal(f.checks, 1);
  assert.deepEqual(f.opened, []);
  f.finish(false); await Promise.resolve();
  assert.deepEqual(f.opened, []);
  f.open(event()); f.finish(true); await Promise.resolve();
  assert.deepEqual(f.opened, [true]);
  assert.deepEqual(f.guide, [false]);
});
test("account retirement while the confirmation is pending cannot open a private workspace", async () => {
  const f = fixture();
  f.open(event()); f.switchAccount(); f.finish(true); await Promise.resolve();
  assert.deepEqual(f.opened, []);
});
for (const configuration of [{ mode: "offline" }, { mode: "share" }, { canManageCanonical: false }, { target: "other-target" }]) {
  test(`a nonmatching Reader never intercepts recovery: ${JSON.stringify(configuration)}`, () => {
    const f = fixture(configuration), request = event(configuration.target);
    f.open(request);
    assert.equal(request.defaultPrevented, false);
    assert.equal(f.checks, 0);
    assert.deepEqual(f.opened, []);
  });
}
