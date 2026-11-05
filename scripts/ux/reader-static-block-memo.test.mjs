import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/assistant-message-renderer.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("assistant-message-renderer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["BlockSlot", "BlockElement", "slotGapStyle", "blockGapVariable", "isDividerBlock", "isRichBlock", "markdownForBlock", "readBlockText"]);
const declarations = ast.statements.filter(node => (
  ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(ast)))
) || (ts.isFunctionDeclaration(node) && names.has(node.name?.text)));
assert.equal(declarations.length, names.size);
const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n")
  + "\nexports.BlockSlot = BlockSlot; exports.BlockElement = BlockElement;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {}, registrations = [], BlockRenderer = () => null;
// Actual slot/element bodies and memo comparators; controlled JSX/hooks/ref
// adapters only. This tests parser invalidation, not React timing or DOM layout.
new Function("exports", "require", "memo", "useRef", "useCallback", "BlockRenderer",
  "registerRenderedBlock", "stripLeadingTimestamp", compiled)(
  exports, require, (type, compare) => ({ type, compare }), value => ({ current: value }), callback => callback,
  BlockRenderer, (...args) => { registrations.push(args); return () => {}; }, text => text,
);
const { BlockSlot, BlockElement } = exports;
const block = { id: "synthetic-block", block_index: 3, block_type: "paragraph", plain_text: "Synthetic plain text.", data: {} };
const props = () => ({
  messageId: "synthetic-message", block, previousBlock: null, hasLeadingContent: false,
  isAssistant: true, highlightTargetId: null,
  pendingTaskKeys: new Set(), onTaskToggle: () => {},
});
function elementProps(input) {
  const slot = BlockSlot.type(input);
  assert.equal(slot.props.children.type, BlockElement);
  return slot.props.children.props;
}

test("ordinary blocks retain their memo boundary across 100 unrelated task-handler updates", () => {
  const first = elementProps(props());
  assert.equal(first.pendingTaskKeys, undefined);
  assert.equal(first.onTaskToggle, undefined);
  for (let index = 0; index < 100; index++) {
    const next = elementProps(props());
    assert.equal(BlockElement.compare(first, next), true);
  }
});

test("non-task content, highlight and identity changes still invalidate the actual block", () => {
  const first = elementProps(props());
  for (const change of [
    { block: { ...block, plain_text: "Synthetic changed text." } },
    { highlightTargetId: "block-synthetic-message-3" },
    { messageId: "synthetic-other-message" },
  ]) assert.equal(BlockElement.compare(first, elementProps({ ...props(), ...change })), false);
});

test("task-bearing blocks retain current callbacks, pending state and checked values", () => {
  const calls = [];
  const taskItems = [{ taskKey: "synthetic-task", checked: false, checkedOffset: 3, label: "Synthetic task", ordinal: 0 }];
  const original = { ...props(), taskItems, onTaskToggle: () => calls.push("old") };
  const first = elementProps(original);
  assert.equal(first.pendingTaskKeys, original.pendingTaskKeys);
  assert.equal(first.onTaskToggle, original.onTaskToggle);
  const handlerChanged = elementProps({ ...original, onTaskToggle: () => calls.push("current") });
  assert.equal(BlockElement.compare(first, handlerChanged), false);
  handlerChanged.onTaskToggle("synthetic-task", true);
  assert.deepEqual(calls, ["current"]);
  for (const change of [
    { pendingTaskKeys: new Set(["synthetic-task"]) },
    { taskItems: [{ ...taskItems[0], checked: true }] },
  ]) assert.equal(BlockElement.compare(first, elementProps({ ...original, ...change })), false);
});

test("adding or removing task items cannot reuse stale interactive controls", () => {
  const plain = elementProps(props());
  const interactive = elementProps({ ...props(), taskItems: [{ taskKey: "synthetic-task", checked: false }] });
  assert.equal(BlockElement.compare(plain, interactive), false);
  assert.equal(BlockElement.compare(interactive, plain), false);
  assert.equal(typeof interactive.onTaskToggle, "function");
  assert.equal(plain.onTaskToggle, undefined);
});

test("the unchanged real block still owns its canonical DOM anchor and renderer props", () => {
  const input = elementProps(props());
  const element = BlockElement.type(input);
  assert.equal(element.props.id, "block-synthetic-message-3");
  assert.equal(element.props["data-block-index"], 3);
  assert.equal(element.props.children.type, BlockRenderer);
  assert.equal(element.props.children.props.block, block);
  assert.equal(element.props.children.props.messageId, "synthetic-message");
  const node = { id: element.props.id };
  element.props.ref(node);
  assert.deepEqual(registrations.at(-1), ["synthetic-message", 3, node, "Synthetic plain text."]);
});
