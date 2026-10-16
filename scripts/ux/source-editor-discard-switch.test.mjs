import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const workspaceSource = read("features/editing/source-editor-workspace.tsx");
const readerSource = read("features/conversations/conversation-reader.tsx");
const workspaceAst = ts.createSourceFile("source-editor-workspace.tsx", workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = workspaceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SourceEditorWorkspace");
assert.ok(workspace);
const functions = new Map();
const jsx = [];
const walk = node => {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) jsx.push(node);
  ts.forEachChild(node, walk);
};
walk(workspace);
for (const name of ["cancelAttachmentJobs", "handleAttachmentCancel", "discardAndSwitch"]) {
  assert.ok(functions.has(name), `missing extracted ${name}`);
}
const text = name => functions.get(name).getText(workspaceAst);
assert.match(text("cancelAttachmentJobs"), /job\.cancelled\s*=\s*true/);
assert.match(text("cancelAttachmentJobs"), /job\.cancel\?\.\(\)/);
assert.match(text("cancelAttachmentJobs"), /deleteConversationAttachment/);
assert.match(text("cancelAttachmentJobs"), /deleteAttachmentUploadItem/);
assert.match(text("cancelAttachmentJobs"), /invalidateQueries/);
assert.match(text("cancelAttachmentJobs"), /uploadJobsRef\.current\.clear\(\)/);
assert.match(text("handleAttachmentCancel"), /await cancelAttachmentJobs\(preserve\)/);
assert.match(text("handleAttachmentCancel"), /onClose\(\)/);
assert.match(text("discardAndSwitch"), /discardSwitchBusyRef\.current/);
assert.match(text("discardAndSwitch"), /await cancelAttachmentJobs\(false\)/);
assert.match(text("discardAndSwitch"), /await onDiscardAndSwitch\(\)/);
assert.match(text("discardAndSwitch"), /setDiscardSwitchError/);

const cleanupEffects = [];
const collectEffects = node => {
  if (ts.isCallExpression(node) && node.expression.getText(workspaceAst) === "useEffect"
    && node.getText(workspaceAst).includes("uploadJobsRef.current.values()")) cleanupEffects.push(node);
  ts.forEachChild(node, collectEffects);
};
collectEffects(workspace);
assert.equal(cleanupEffects.length, 1);
const pendingBanner = jsx.find(node => node.getText(workspaceAst).includes("discardAndSwitch()"));
assert.ok(pendingBanner);
const bannerText = pendingBanner.getText(workspaceAst);
assert.match(bannerText, /disabled=\{discardSwitchBusy\}/);
assert.match(bannerText, /role="alert"/);
assert.match(bannerText, /Cleaning up/);

const parentHandler = readerSource.match(/onDiscardAndSwitch=\{\(\) => \{[\s\S]*?\}\}/)?.[0];
assert.ok(parentHandler);
assert.match(parentHandler, /setSourceEditorDirty\(false\)/);
assert.match(parentHandler, /setSourceEditorTarget\(pendingSourceEditorTarget\)/);
assert.match(parentHandler, /setPendingSourceEditorTarget\(null\)/);

test("source-editor discard-and-switch owns cleanup before switching and retires old upload jobs", () => {
  assert.ok(true);
});
