import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/editing/source-editor-workspace.tsx");
const hook = read("components/use-dialog-focus.ts");
const ast = ts.createSourceFile("source-editor-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const picker = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationAttachmentPicker");
assert.ok(picker);
const text = picker.getText(ast);
assert.match(source, /from ["']\.\.\/\.\.\/components\/use-dialog-focus["']/);
assert.match(text, /const rootRef = useRef<HTMLElement|HTMLDivElement/);
assert.match(text, /const searchRef = useRef<HTMLInputElement/);
assert.match(text, /useDialogFocus\(\{ open: true, rootRef, initialFocusRef: searchRef, onClose \}\)/);
assert.match(text, /<div ref=\{rootRef\} tabIndex=\{-1\}[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(text, /data-dialog-backdrop/);
assert.match(text, /ref=\{searchRef\} data-dialog-initial-focus/);
assert.doesNotMatch(text, /autoFocus/);
assert.match(hook, /event\.key === "Escape"/);
assert.match(hook, /event\.key !== "Tab"/);
assert.match(hook, /event\.shiftKey/);
assert.match(hook, /restoreFocusRef/);

test("source-editor attachment picker uses the shared modal focus contract", () => {
  assert.ok(true);
});
