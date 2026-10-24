// Actual code-block component and clipboard hook; controlled React scheduling
// and device clipboard. Not browser permission/layout/OS clipboard acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const renderer = readFileSync(new URL("../../apps/web/features/conversations/markdown-renderer.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("renderer.tsx", renderer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const blocks = ["ShikiCodeBlock", "CodeAction"].map(name => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `${name} must remain an actual component, not a test reimplementation`);
  return node.getText(ast);
}).join("\n");
const componentSource = `
import {useState,useEffect,useRef} from "react";
import {useClipboardCopy} from "../../components/use-clipboard-copy";
import {usePreferences} from "../../components/preferences-provider";
const Check="Check",Copy="Copy",WrapText="WrapText",Minimize2="Minimize2",Maximize2="Maximize2";
${blocks}
export {ShikiCodeBlock,CodeAction};`;
const hookSource = readFileSync(new URL("../../apps/web/components/use-clipboard-copy.ts", import.meta.url), "utf8");
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };

function fixture({ locale = "en-US", missing = false, source = "const 原文 = 'synthetic';\n", write = async () => {} } = {}) {
  let code = source, cursor = 0, tree;
  const slots = [], effects = new Map(), selected = [];
  const slot = initialize => slots[cursor++] ??= initialize();
  const react = {
    ...React,
    useState: initial => {
      const row = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [row.value, value => { row.value = typeof value === "function" ? value(row.value) : value; }];
    },
    useRef: initial => slot(() => ({ current: initial })),
    useCallback: (callback, deps) => {
      const row = slot(() => ({}));
      if (!same(row.deps, deps)) Object.assign(row, { deps, callback });
      return row.callback;
    },
    useEffect: (callback, deps) => {
      const index = cursor, row = slot(() => ({}));
      if (!same(row.deps, deps)) { row.deps = deps; effects.set(index, callback); }
    },
  };
  const navigator = missing ? {} : { clipboard: { writeText: value => write(value) } };
  const imports = { react,
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedTheme: "light", resolvedLocale: locale }) },
  };
  function load(source) {
    const exports = {};
    const compiled = ts.transpileModule(source, { fileName: "fixture.tsx", compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function("require", "exports", "navigator", "window", compiled)(name => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name.startsWith(".")) throw Error("Unexpected clipboard dependency " + name);
      return require(name);
    }, exports, navigator, { setTimeout: () => 1 });
    return exports;
  }
  imports["../../components/use-clipboard-copy"] = load(hookSource);
  const { ShikiCodeBlock, CodeAction } = load(componentSource);
  const render = () => {
    cursor = 0;
    tree = ShikiCodeBlock({ language: "text", code });
    for (const node of nodes(tree)) if (node.type === "textarea" && node.props.ref) {
      node.props.ref.current = { focus: () => selected.push("focus"), scrollIntoView: () => {}, select: () => selected.push("select") };
    }
    for (const [index, callback] of effects) { slots[index].cleanup?.(); slots[index].cleanup = callback(); }
    effects.clear();
    return tree;
  };
  render();
  return {
    render, selected, setCode: value => { code = value; },
    field: () => nodes(tree).find(node => node.type === "textarea"),
    alert: () => nodes(tree).find(node => node.props?.role === "alert"),
    button: () => {
      const action = nodes(tree).find(node => node.type === CodeAction && /Copy code|Copied|Copying|复制/.test(node.props.title));
      assert.ok(action, "code copy action must remain available");
      return CodeAction(action.props);
    },
    async click() {
      const action = nodes(tree).find(node => node.type === CodeAction && /Copy code|Copied|Copying|复制/.test(node.props.title));
      assert.ok(action);
      await action.props.onClick();
      return render();
    },
  };
}

test("successful copying uses the complete source and only then confirms", async () => {
  const writes = [], source = "\tconst 原文 = '<tag>';\r\n\n";
  const f = fixture({ source, write: async value => writes.push(value) });
  await f.click();
  assert.deepEqual(writes, [source]);
  assert.equal(f.button().props["aria-label"], "Copied");
  assert.equal(f.field(), undefined);
});

for (const locale of ["en-US", "zh-CN"]) for (const missing of [false, true]) {
  test(`${locale}: ${missing ? "absent" : "denied"} clipboard has handled complete manual recovery`, async () => {
    const source = "synthetic long code\n".repeat(100);
    const f = fixture({ locale, missing, source, write: async () => { throw Error("synthetic-private-reason"); } });
    await f.click();
    assert.ok(f.alert(), "clipboard failures must have in-context feedback");
    assert.equal(f.field().props.value, source);
    assert.equal(f.field().props.readOnly, true);
    assert.ok(f.field().props["aria-label"]);
    assert.deepEqual(f.selected, ["focus", "select"]);
    assert.doesNotMatch(JSON.stringify(f.alert().props.children), /synthetic-private-reason/);
    assert.notEqual(f.button().props["aria-label"], "Copied");
    assert.equal(f.button().props.disabled, false);
  });
}

test("a failed copy can be retried, and a later denial replaces prior success", async () => {
  let fail = true;
  const f = fixture({ write: async () => { if (fail) throw Error("synthetic denied"); } });
  await f.click(); assert.ok(f.field());
  fail = false; await f.click(); assert.equal(f.field(), undefined);
  assert.equal(f.button().props["aria-label"], "Copied");
  fail = true; await f.click(); assert.ok(f.field());
  assert.notEqual(f.button().props["aria-label"], "Copied");
});

test("pending copying is busy and disables duplicate requests", async () => {
  const request = defer(), f = fixture({ write: () => request.promise });
  const copied = f.click();
  f.render();
  assert.equal(f.button().props.disabled, true);
  assert.equal(f.button().props["aria-busy"], true);
  request.resolve(); await copied;
  assert.equal(f.button().props.disabled, false);
});

test("changing source hides old failure and fences a late old success", async () => {
  const first = defer();
  let requests = 0;
  const f = fixture({ write: async () => { if (++requests === 1) await first.promise; else throw Error("synthetic denial"); } });
  const old = f.click();
  f.setCode("new synthetic source\n"); f.render();
  assert.equal(f.button().props["aria-label"], "Copy code");
  await f.click();
  assert.equal(f.field().props.value, "new synthetic source\n");
  first.resolve(); await old;
  assert.equal(f.field().props.value, "new synthetic source\n");
  assert.notEqual(f.button().props["aria-label"], "Copied");
  f.setCode("third synthetic source\n"); f.render();
  assert.equal(f.field(), undefined);
  assert.equal(f.button().props["aria-label"], "Copy code");
});
