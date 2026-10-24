// Local component gate: actual code-block functions, shared clipboard hook,
// React and DOM. Preferences/highlighting/device clipboard are explicit adapters.
// No API, authentication, real clipboard write, external research or production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), web = join(root, "apps/web");
const require = createRequire(join(web, "package.json")), ts = require("typescript");
const temp = resolve(process.env.TEMP ?? "");
assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^c:\/users\/86182\/desktop\/wkkk\/[^/]+/);
const out = join(temp, "code-copy-browser"); mkdirSync(out, { recursive: true });
writeFileSync(join(out, "result.json"), JSON.stringify({ status: "not_completed", date: "2026-10-24" }));
const rendererPath = join(web, "features/conversations/markdown-renderer.tsx");
const hookPath = join(web, "components/use-clipboard-copy.ts");
const source = readFileSync(rendererPath, "utf8");
const ast = ts.createSourceFile(rendererPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const bodies = ["ShikiCodeBlock", "CodeAction"].map(name => {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, "Missing actual component " + name);
  return declaration.getText(ast);
}).join("\n");
const normalized = path => path.replaceAll("\\", "/");
writeFileSync(join(out, "entry.tsx"), `
import React,{useState,useEffect,useRef} from "react";
import {createRoot} from "react-dom/client";
import {Check,Copy,WrapText,Minimize2,Maximize2} from "lucide-react";
import {useClipboardCopy} from ${JSON.stringify(normalized(hookPath))};
const usePreferences=()=>({resolvedTheme:"light",resolvedLocale:window.gateLocale??"en-US"});
const normalizeLanguage=()=>null; // Highlighting is outside this clipboard gate.
${bodies}
window.copyMode="ok";window.copyWrites=[];
window.setCopyMode=mode=>{
 window.copyMode=mode;
 Object.defineProperty(navigator,"clipboard",{configurable:true,value:mode==="missing"?undefined:{writeText:async text=>{
  if(window.copyMode==="deny")throw Error("synthetic private denial");
  if(window.copyMode==="held")await new Promise(resolve=>window.releaseCopy=resolve);
  window.copyWrites.push(text);
 }}});
};
window.setCopyMode("ok");
function Root(){
 const [code,setCode]=useState("initial synthetic code"),[locale,setLocale]=useState("en-US");
 window.codeGate={setCode,setLocale};
 window.gateLocale=locale;
 return <main className="mx-auto max-w-4xl p-4"><ShikiCodeBlock language="text" code={code}/></main>;
}
createRoot(document.getElementById("root")).render(<Root/>);`);
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=source=>ts.transpileModule(source,{compilerOptions:{
target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"),
  output: { path: out, filename: "bundle.js" }, optimization: { minimize: false },
  resolve: {
    extensions: [".tsx", ".ts", ".mjs", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom/client$": require.resolve("react-dom/client") },
  },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [rendererPath, join(out, "entry.tsx")], theme: { extend: {} }, plugins: [],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
writeFileSync(join(out, "style.css"), styles.css);
const server = createServer((request, response) => {
  if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  const file = request.url === "/bundle.js" ? "bundle.js" : request.url === "/style.css" ? "style.css" : null;
  response.setHeader("Content-Type", (file === "bundle.js" ? "application/javascript" : file ? "text/css" : "text/html") + "; charset=utf-8");
  response.end(file ? readFileSync(join(out, file)) : '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(yes => server.listen(0, "127.0.0.1", yes));
let browser, page;
const cases = [], errors = [];
try {
  const { chromium, expect } = require("@playwright/test");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.codeGate);
  const code = Array.from({ length: 100 }, (_, index) => `const 行${index} = "synthetic <code> ${index}";`).join("\n") + "\nTAIL\n";
  await page.evaluate(code => window.codeGate.setCode(code), code);
  await expect(page.locator("pre code")).toHaveText(code);
  await page.evaluate(() => window.setCopyMode("deny"));
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Code for manual copy" });
  await expect(field).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Select and copy below");
  assert.equal(await field.inputValue(), code);
  assert.ok(await field.evaluate(node => node.readOnly && document.activeElement === node
    && node.selectionEnd - node.selectionStart === node.value.length
    && node.closest('[data-markdown-copy-ignore="true"]')));
  await page.screenshot({ path: join(out, "desktop-denied.png"), fullPage: true });
  cases.push("desktop denial preserves, focuses and selects full long source");
  await page.evaluate(() => window.setCopyMode("ok"));
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await expect(field).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => window.copyWrites), [code]);
  cases.push("successful retry removes fallback and writes exact source to adapter");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => { window.codeGate.setLocale("zh-CN"); window.setCopyMode("missing"); });
  await page.getByRole("button", { name: "已复制", exact: true }).click();
  const chineseField = page.getByRole("textbox", { name: "可手动复制的代码" });
  await expect(chineseField).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("剪贴板不可用");
  assert.equal(await chineseField.inputValue(), code);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(out, "mobile-unavailable.png"), fullPage: true });
  cases.push("375px Chinese missing Clipboard API replaces earlier success");

  await page.evaluate(() => window.setCopyMode("held"));
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  const pending = page.getByRole("button", { name: "正在复制代码…", exact: true });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => window.releaseCopy());
  await expect(page.getByRole("button", { name: "已复制", exact: true })).toBeEnabled();
  cases.push("pending device request is disabled/busy and completes truthfully");
  await page.evaluate(() => window.codeGate.setCode("new synthetic source"));
  await expect(page.getByRole("button", { name: "复制代码", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  cases.push("new source retires old success feedback");
  assert.deepEqual(errors, []);
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  writeFileSync(join(out, "result.json"), JSON.stringify({
    status: "passed", date: "2026-10-24", cases, pageErrors: errors,
    sourceSha256: hash(rendererPath), clipboardHookSha256: hash(hookPath),
    evidenceLimits: "Extracted actual component functions; preferences/highlighting/device clipboard adapters. Not full Reader/Share/Offline, real clipboard permission, OS or cross-browser acceptance.",
  }, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: cases.length, evidenceDirectory: out }));
} catch (error) {
  if (page) {
    writeFileSync(join(out, "failure.html"), await page.content());
    await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
    console.error(JSON.stringify(await page.evaluate(() => ({
      locale: window.gateLocale, buttons: Array.from(document.querySelectorAll("button")).map(node => node.getAttribute("aria-label")),
    }))));
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(yes => server.close(yes));
}
