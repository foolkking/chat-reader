import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url)), ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/compare/conversation-compare.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("together.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TogetherWorkspace");
const functions = ["beforeLeaving", "activate", "choose", "closeTab"].map(name => {
  const node = workspace.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name); return node.getText(ast);
}).join("\n");
const close = workspace.body.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(ast) === "closeWorkspace");
assert.ok(close);

// Execute the actual coordinator callbacks, with explicit React-state and
// confirmation adapters. This is not browser focus/durability evidence.
function fixture() {
  let resolve;
  const decision = new Promise(yes => { resolve = yes; });
  let confirms = 0;
  const code = `
    let activeId="a", tabs=[{id:"a"},{id:"b"}], visible=["a","b"], annotationTarget=null, choosing=true, notice="";
    const active={current:activeId}, mounted={current:true}, leaving={current:false};
    const focusAfterLeave={current:false};
    const snapshots={current:new Map()}, handles={current:new Map()}, closed={current:new Set()};
    const document={querySelector:()=>null};
    const leaveGuard={current:{needsConfirmation:()=>true,confirm:()=>{recordConfirm();return decision;}}};
    const TOGETHER_MAX_TABS=8, zh=false, params=new URLSearchParams(), initial={current:["a"]}, routes=[];
    const router={push:href=>routes.push(href)}, togetherTarget=()=>undefined;
    const setActiveId=id=>{activeId=id;active.current=id;};
    const setVisible=fn=>{visible=typeof fn==="function"?fn(visible):fn;};
    const setTabs=fn=>{tabs=typeof fn==="function"?fn(tabs):fn;};
    const setPaneStates=()=>{}, setAnnotationsOpen=()=>{}, setAnnotationTarget=value=>{annotationTarget=value;};
    const setChoosing=value=>{choosing=value;}, setNotice=value=>{notice=value;};
    ${functions}
    const ${close.getText(ast)};
    exports.actions={activate,choose,closeTab,closeWorkspace,beforeLeaving};
    exports.state=()=>({activeId,tabs,visible,routes,choosing,notice});
    exports.retire=()=>{mounted.current=false;};
  `;
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "decision", "recordConfirm", output)(exports, decision, () => confirms++);
  return { ...exports, resolve, get confirms() { return confirms; } };
}

const cases = {
  tab: f => f.actions.activate("b"),
  pane: f => f.actions.activate("b"),
  chooser: f => f.actions.choose({ conversationId: "b", title: "B", href: "/conversations/b" }),
  close: f => f.actions.closeTab("a"),
  back: f => f.actions.closeWorkspace(),
  external: f => f.actions.beforeLeaving(() => { throw new Error("Cancelled departure must not navigate"); }),
};
for (const [name, action] of Object.entries(cases)) test(`${name} cannot retire unsaved notes before confirmation`, async () => {
  const f = fixture(), before = f.state();
  action(f); action(f);
  assert.equal(f.confirms, 1);
  assert.deepEqual(f.state(), before);
  f.resolve(false); await setImmediate();
  assert.deepEqual(f.state(), before);
});
test("accepted switching changes the owner once, while auth/unmount retires delayed consent", async () => {
  const f = fixture(); f.actions.activate("b"); f.resolve(true); await setImmediate();
  assert.equal(f.state().activeId, "b"); assert.deepEqual(f.state().visible, ["a", "b"]);
  const retired = fixture(); retired.actions.activate("b"); retired.retire(); retired.resolve(true); await setImmediate();
  assert.equal(retired.state().activeId, "a");
});
