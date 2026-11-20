import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/message-item.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("message-item.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "MessageItemComponent");
const update = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "replaceMessagePreservingAnchor");
assert.ok(update);
const compiled = ts.transpileModule(`${update.getText(ast)}; exports.replace = replaceMessagePreservingAnchor;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// Real callback, controlled async commit. Browser gestures/ranges are separately
// exercised by the delayed-message-refresh and full viewport matrix.
test("a delayed message commit never writes back a captured old scroll coordinate", async () => {
  let release, top = 800, calls = 0;
  const committed = new Promise(resolve => { release = resolve; });
  const exports = {};
  new Function("exports", "onChanged", "visibleBlockAnchor", "afterLayout", "window", compiled)(
    exports, async () => { calls++; await committed; },
    () => { throw new Error("Competing anchor capture"); },
    () => { throw new Error("Competing delayed writer"); },
    { scrollBy: () => { throw new Error("Competing scroll write"); } },
  );
  const pending = exports.replace({ id: "synthetic" }, 8);
  top += 240;
  release(); await pending;
  assert.equal(top, 1040);
  assert.equal(calls, 1);
});

test("retired message version work cannot commit at all", async () => {
  const exports = {};
  new Function("exports", "onChanged", compiled)(exports, () => { throw new Error("Retired commit"); });
  await exports.replace({ id: "synthetic" }, 9, () => false);
});
