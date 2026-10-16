import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const workspaceSource = read("features/import/adaptive-import-workspace.tsx");
const mappingSource = read("features/import/mapping-workspace.tsx");
const healthSource = read("features/import/format-health-check.tsx");
const workspaceAst = ts.createSourceFile("adaptive-import-workspace.tsx", workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const functions = new Map();
const walk = node => {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
  ts.forEachChild(node, walk);
};
walk(workspaceAst);

assert.ok(functions.has("useAdaptiveSessionAction"));
assert.ok(functions.has("AdaptiveImportWorkspace"));
assert.ok(functions.has("GroupResolver"));

const text = name => functions.get(name).getText(workspaceAst);
const helper = text("useAdaptiveSessionAction");
const workspace = text("AdaptiveImportWorkspace");
const grouping = text("GroupResolver");

assert.match(helper, /const token = controls\.begin\(\)/);
assert.match(helper, /controls\.apply\(token, next\)/);
assert.match(helper, /controls\.finish\(token\)/);
assert.match(workspace, /activeToken !== null\) return null/);
assert.match(workspace, /activeToken !== token \|\| next\.import_id !== currentImportIdRef\.current/);
assert.match(workspace, /disabled=\{!session\.can_import \|\| importing \|\| sessionActionBusy\}/);
assert.match(workspace, /disabled=\{importing \|\| sessionActionBusy\}/);
assert.match(grouping, /artifactSignature/);
assert.match(grouping, /useEffect\(\(\) => \{\s*setAssignments\(initial\)/);
assert.match(grouping, /disabled=\{sessionActionBusy \|\| mutation\.isPending\}/);
assert.doesNotMatch(workspaceSource, /onSuccess:\s*onSession/);
assert.match(mappingSource, /sessionAction\.begin\(\)/);
assert.match(mappingSource, /sessionAction\.apply\(token, next\)/);
assert.match(mappingSource, /sessionAction\.finish\(token\)/);
assert.match(healthSource, /disabled \|\| check\.isPending/);

test("adaptive import session action ownership and grouping resync are source-covered", () => {
  assert.ok(true);
});
