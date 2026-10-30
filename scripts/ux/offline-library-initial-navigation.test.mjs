import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/offline/library-shell.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("library-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const shell = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LibraryShell");
const effect = shell.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.arguments[0]?.getText(ast).includes("if (requestedId)"));
assert.ok(effect, "the actual URL-to-library selection effect must exist");
const call = effect.expression;
const ready = source.match(/data-library-navigation-ready=\{String\(([^}]+)\)\}/)?.[1];
assert.ok(ready, "library exposes its actual applied-navigation state");
const callback = ts.transpileModule(`exports.apply = ${call.arguments[0].getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test("cached library HTML applies a deep link in layout, before an interactive sidebar can disappear", () => {
  assert.equal(call.expression.getText(ast), "useLayoutEffect");
  let selectedId = null, mobileOpen = true;
  const requestedId = "synthetic-requested-conversation", exports = {};
  new Function("exports", "requestedId", "setSelectedId", "setMobileOpen", callback)(
    exports, requestedId, value => { selectedId = value; }, value => { mobileOpen = value; },
  );
  const isReady = () => new Function("requestedId", "selectedId", `return ${ready}`)(requestedId, selectedId);
  assert.equal(isReady(), false, "the cached, unselected hydration tree is not yet the requested destination");
  exports.apply();
  assert.equal(selectedId, requestedId);
  assert.equal(mobileOpen, false);
  assert.equal(isReady(), true);
});

test("opening /library without a deep link preserves the initial mobile catalog", () => {
  const writes = [], exports = {};
  new Function("exports", "requestedId", "setSelectedId", "setMobileOpen", callback)(
    exports, null, value => writes.push(value), value => writes.push(value),
  );
  exports.apply();
  assert.deepEqual(writes, []);
  assert.equal(new Function("requestedId", "selectedId", `return ${ready}`)(null, null), true);
});
