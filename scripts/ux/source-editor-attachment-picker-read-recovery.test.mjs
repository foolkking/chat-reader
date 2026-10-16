import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const source = await readFile(
  new URL("../../apps/web/features/editing/source-editor-workspace.tsx", import.meta.url),
  "utf8",
);
const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const ast = ts.createSourceFile("source-editor-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function picker() {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationAttachmentPicker");
  assert.ok(declaration, "missing attachment picker");
  return declaration.getText(ast);
}

test("attachment picker distinguishes query error from successful empty data", () => {
  const view = picker();
  assert.match(view, /query\.isError \?/);
  assert.match(view, /query\.refetch\(\)/);
  assert.match(view, /!query\.isLoading && !query\.isError && items\.length === 0/);
});

test("attachment picker preserves stale items while explaining refresh failure", () => {
  const view = picker();
  assert.match(view, /items\.length \?/);
  assert.match(view, /Previously loaded files are shown/);
  assert.match(view, /仍显示上次读取的结果/);
  assert.match(view, /role="alert"/);
});

test("attachment picker retry is read-only", () => {
  const view = picker();
  const alert = view.slice(view.indexOf("query.isError ?"));
  assert.match(alert, /onClick=\{\(\) => void query\.refetch\(\)\}/);
  assert.doesNotMatch(alert, /uploadAttachmentItem|finalizeConversationAttachments|deleteConversationAttachment/);
});
