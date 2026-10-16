import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { QueryClient, MutationObserver } = require("@tanstack/react-query");
const source = readFileSync(new URL("../../apps/web/features/conversations/cleanup-review-workspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("cleanup-review-workspace.tsx", source, ts.ScriptTarget.Latest, true);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
const declaration = find(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "decisions");
const callback = declaration.initializer.arguments[0].properties.find(node => node.name?.getText(ast) === "onSuccess").initializer;
const compiled = ts.transpileModule(`exports.onSuccess = ${callback.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

for (const zh of [false, true]) test(`${zh ? "zh" : "en"}: confirmed choice releases the actual mutation while metadata reads wait`, async () => {
  const client = new QueryClient();
  const saved = { id: "synthetic-scan", delete_count: 1 };
  const messages = [];
  let release, reads = 0, writes = 0;
  const held = new Promise(resolve => { release = resolve; });
  const exports = {};
  new Function("exports", "client", "scan", "generation", "authenticationGeneration", "mounted", "setFeedback", "zh", "refresh", compiled)(
    exports, client, saved, { current: 7 }, () => 7, { current: true },
    value => messages.push(value), zh, () => { reads++; return held; },
  );
  const observer = new MutationObserver(client, {
    mutationFn: async () => { writes++; return saved; }, onSuccess: exports.onSuccess,
  });
  const pending = observer.mutate();
  try {
    const result = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve("still pending")))]);
    assert.equal(result, saved);
    assert.equal(observer.getCurrentResult().status, "success");
    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.deepEqual(client.getQueryData(["content-cleanup-scan", saved.id]), saved);
    assert.deepEqual(messages, [zh ? "选择已保存，关闭后可继续审查。" : "Selection saved. You can close and resume this review."]);
  } finally { release(); await pending; client.clear(); }
});
