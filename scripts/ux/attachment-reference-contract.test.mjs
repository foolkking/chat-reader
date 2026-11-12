import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/editing/source-attachment-drop.ts", import.meta.url), "utf8");
const module = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(require, module, module.exports);
const { findMarkdownAttachmentReferences: scan, replacePendingMarker, removePendingMarker, changeAttachmentReference } = module.exports;
const { EditorState } = require("@codemirror/state");
const { history, undo, redo } = require("@codemirror/commands");

for (const fixture of JSON.parse(readFileSync(new URL("../fixtures/attachment-reference-cases.json", import.meta.url), "utf8"))) {
  test(`shared attachment grammar: ${fixture.name}`, () => {
    assert.equal(scan(fixture.source, fixture.scheme ?? "cr-asset").length, fixture.count);
  });
}

function editor(doc, anchor = 0) {
  // Real CodeMirror state/history transactions; browser suite covers the view.
  const view = { state: EditorState.create({ doc, selection: { anchor }, extensions: [history()] }),
    dispatch(change) { view.state = change.state ?? view.state.update(change).state; } };
  return view;
}
test("one reference removal preserves same-line prose and is undoable", () => {
  const doc = "前🙂 [a](cr-upload://one) 后 [b](cr-upload://one) 尾";
  const view = editor(doc);
  assert.equal(removePendingMarker(view, "one"), "removed");
  assert.equal(view.state.doc.toString(), "前🙂  后 [b](cr-upload://one) 尾");
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), doc);
  assert.equal(redo(view), true);
  assert.equal(scan(view.state.doc.toString(), "cr-upload").length, 1);
});
test("repeated upload resolves every reference, not literal examples", () => {
  const view = editor("![Uploading: a](cr-upload://one) [b](cr-upload://one) `[c](cr-upload://one)`");
  assert.equal(replacePendingMarker(view, "one", "11111111-1111-4111-8111-111111111111"), "replaced");
  assert.equal(scan(view.state.doc.toString(), "cr-asset").length, 2);
  assert.match(view.state.doc.toString(), /`\[c\]\(cr-upload:\/\/one\)`/);
});
test("shared definition gets one destination edit for multiple references", () => {
  const view = editor("[one][x] [x]\n\n[x]: cr-upload://one");
  replacePendingMarker(view, "one", "11111111-1111-4111-8111-111111111111");
  assert.equal(scan(view.state.doc.toString(), "cr-asset").length, 2);
});
for (const scope of ["one", "all"]) test(`explicit ${scope} replacement protects shared-definition neighbours and undo`, () => {
  const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  const doc = `前🙂 [one][x] 后 [x] 尾\n\n[x]: cr-asset://${id}`;
  const view = editor(doc);
  const ref = scan(doc, "cr-asset")[0];
  const target = { identifier: id, from: ref.nodeFrom, to: ref.nodeTo, original: doc.slice(ref.nodeFrom, ref.nodeTo) };
  assert.equal(changeAttachmentReference(view, target, `cr-asset://${other}`, scope), true);
  assert.equal(scan(view.state.doc.toString(), "cr-asset").filter(ref => ref.identifier === other).length, scope === "one" ? 1 : 2);
  assert.match(view.state.doc.toString(), /^前🙂 .+ 后 .+ 尾/);
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), doc);
  view.dispatch({ changes: { from: 0, insert: "changed " } });
  assert.equal(changeAttachmentReference(view, target, `cr-asset://${other}`, scope), false);
});
