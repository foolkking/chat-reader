import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const read = path => ts.createSourceFile(path, readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const createSource = read("features/conversations/new-conversation-dialog.tsx");
const insertSource = read("features/conversations/message-insert-dialog.tsx");
const editSource = read("features/editing/edit-message-form.tsx");
function find(source, predicate) {
  let result;
  const visit = node => { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); };
  visit(source); assert.ok(result, "production AST fragment must exist"); return result;
}
function compile(source, name, scope) {
  const fn = find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const js = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), js + "\nreturn " + name)(...Object.values(scope));
}
const unchangedExpression = find(editSource, node => ts.isVariableDeclaration(node) && node.name.getText(editSource) === "isUnchanged").initializer.getText(editSource);
const unchanged = (text, baselineText) => new Function("text", "baselineText", "trimmedText", "return " + unchangedExpression)(text, baselineText, text.trim());
const noop = () => {};
const event = { preventDefault: noop };

// Execute actual production submit/dirty/close AST fragments, not a duplicate
// implementation. Hooks, network, CodeMirror and attachment parsing are doubles.
function createFixture(userText, assistantText = "  Synthetic answer\n") {
  const calls = [], scope = { userText, assistantText, title: "  Synthetic title  ", defaultTitle: "New conversation",
    projectId: "", submitting: { current: false }, setPending: noop, setError: noop, zh: false,
    createConversation: async payload => { calls.push(payload); return { synthetic: true }; }, onCreated: noop };
  return { calls, scope, submit: compile(createSource, "submit", scope) };
}
function editFixture(text, baselineText = "Synthetic original", { authoritative = text, fail = false, canonical, drafts = {} } = {}) {
  const saved = [], updates = {}, scope = { text, baselineText, reason: "  Synthetic reason  ", attachmentDrafts: drafts,
    editorViewRef: { current: { state: { doc: { toString: () => authoritative } } } }, saveRequestRef: { current: 0 },
    editorRevisionRef: { current: 9 }, zh: false, removedActions: {},
    findTransientUploadReferences: () => [], removedAttachmentIds: () => [], isRevisionConflictMessage: () => false,
    t: key => key, onDirtyChange: value => { updates.dirty = value; },
    onSave: async (...args) => { saved.push(args); if (fail) throw new Error("Synthetic offline"); return canonical === undefined ? undefined : { canonicalText: canonical }; },
  };
  for (const name of ["Error", "RevisionConflict", "ReloadStatus", "IsSaving", "BaselineText", "EditorDocument", "Text", "Reason", "ShowClosePrompt", "AttachmentDrafts", "RemovedConfirmMode", "RemovedActions"]) {
    scope["set" + name] = value => { updates[name] = value; };
  }
  return { saved, updates, scope, submit: compile(editSource, "submit", scope) };
}
const bodies = ["    Synthetic code", "\tSynthetic tab\n", "\n\nSynthetic paragraph\n\n", "```text\n  Synthetic line\n    ", "  合成内容🙂  \n"];
for (const [index, body] of bodies.entries()) {
  test(`create preserves exact Markdown body ${index}`, async () => {
    const f = createFixture(body); await f.submit(event);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].messages[0].content_markdown, body);
    assert.equal(f.calls[0].messages[1].content_markdown, "  Synthetic answer\n");
    assert.equal(f.calls[0].title, "Synthetic title");
  });
  for (const mode of ["create_version", "replace_current"]) test(`${mode} preserves source and accepted baseline ${index}`, async () => {
    const f = editFixture(body); await f.submit(mode);
    assert.equal(f.saved.length, 1); assert.equal(f.saved[0][0], body);
    assert.equal(f.saved[0][1], "Synthetic reason"); assert.equal(f.saved[0][2], mode); assert.equal(f.saved[0][4], 9);
    assert.equal(f.updates.BaselineText, body); assert.equal(f.updates.EditorDocument, body); assert.equal(f.updates.Text, body);
  });
}
for (const body of ["    Synthetic original", "Synthetic original  ", "\nSynthetic original\n"]) {
  test("whitespace-only source changes remain dirty: " + JSON.stringify(body), async () => {
    assert.equal(unchanged(body, "Synthetic original"), false);
    const f = editFixture(body); await f.submit("create_version"); assert.equal(f.saved[0]?.[0], body);
    let cancelled = false, prompted = false;
    compile(editSource, "requestClose", { isUnchanged: unchanged(body, "Synthetic original"), hasAttachmentWork: false,
      onCancel: () => { cancelled = true; }, setShowClosePrompt: value => { prompted = value; } })();
    assert.equal(cancelled, false); assert.equal(prompted, true);
  });
}
test("exact unchanged source is a no-op", async () => {
  const body = "    Synthetic same\n";
  assert.equal(unchanged(body, body), true);
  const f = editFixture(body, body); await f.submit("create_version"); assert.equal(f.saved.length, 0);
});
for (const blank of ["", " \n\t"]) test("empty source is rejected without a write: " + JSON.stringify(blank), async () => {
  const create = createFixture(blank); await create.submit(event); assert.equal(create.calls.length, 0);
  const edit = editFixture(blank); await edit.submit("create_version"); assert.equal(edit.saved.length, 0);
});
test("submission takes exact current CodeMirror source, not a lagging state value", async () => {
  const body = "    Synthetic live document\n";
  const f = editFixture("Synthetic old render", "Synthetic old render", { authoritative: body });
  await f.submit("create_version"); assert.equal(f.saved[0][0], body);
});
test("failed edit does not reset its draft or baseline", async () => {
  const f = editFixture("    Synthetic draft\n", "Synthetic original", { fail: true });
  await f.submit("create_version"); assert.equal(f.updates.Error, "Synthetic offline");
  assert.equal("BaselineText" in f.updates, false); assert.equal("Text" in f.updates, false);
});
test("explicit canonical reply, including whitespace, is the new baseline", async () => {
  const f = editFixture("Synthetic draft", "Synthetic original", { canonical: "  Synthetic server source\n" });
  await f.submit("create_version"); assert.equal(f.updates.BaselineText, "  Synthetic server source\n");
});
test("unresolved attachment still blocks an edit", async () => {
  const f = editFixture("    Synthetic source", "Synthetic original", { drafts: { upload: { status: "uploading", displayName: "synthetic.txt" } } });
  await f.submit("create_version"); assert.equal(f.saved.length, 0); assert.match(f.updates.Error, /not ready/);
});
test("insert continues to submit exact bodies, revision and anchor", async () => {
  const calls = [], first = "    Synthetic first\n", second = "\nSynthetic second  ";
  const submit = compile(insertSource, "submit", { first, second, mode: "pair", role: "user", position: "after", revision: 12,
    anchorMessageId: "synthetic-anchor", conversationId: "synthetic-conversation", submitting: { current: false },
    setPending: noop, setError: noop, zh: false, onSubmitted: noop, insertConversationMessages: async (...args) => { calls.push(args); return {}; } });
  await submit(event); assert.equal(calls.length, 1); assert.equal(calls[0][1].messages[0].content_markdown, first);
  assert.equal(calls[0][1].messages[1].content_markdown, second); assert.equal(calls[0][1].expected_offline_revision, 12);
  assert.equal(calls[0][1].anchor_message_id, "synthetic-anchor");
});
