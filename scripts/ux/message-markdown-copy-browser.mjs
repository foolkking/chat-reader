// Explicit local gate: real MessageItem/copy/parser/canvas/client/API/storage;
// preferences, body display and unrelated version-history hook are adapters.
// Synthetic SQLite data only; not a production or PostgreSQL browser acceptance.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), web = join(root, "apps/web");
const require = createRequire(join(web, "package.json"));
const task = resolve(process.env.TEMP ?? "");
assert.match(task.replaceAll("\\", "/").toLowerCase(), /^c:\/users\/86182\/desktop\/wkkk\/[^/]+/);
const out = join(task, `copy-browser-${Date.now()}`); mkdirSync(out, { recursive: true });
const normalized = path => path.replaceAll("\\", "/");
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.mjs"), `
import React from "react"; import ReactMarkdown from "react-markdown";
export const usePreferences=()=>({resolvedLocale:window.copyLocale??"en-US",t:key=>key});
export const useMessageVersionHistory=()=>({active:false,needsAttention:false});
export const AssistantMessageRenderer=({message})=>React.createElement(ReactMarkdown,{skipHtml:true},
 message.current_version.display_text.replace(/!?\\[[^\\]]*\\]\\(cr-asset:\\/\\/[^)]+\\)/g,"[attachment]"));
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react"; import {createRoot} from "react-dom/client";
import {MessageItem} from ${JSON.stringify(normalized(join(web, "features/conversations/message-item.tsx")))};
import {safeCopySvg} from ${JSON.stringify(normalized(join(web, "features/conversations/message-markdown-copy-prepare.tsx")))};
import {configureOfflineAccess} from ${JSON.stringify(normalized(join(web, "lib/offline-access.ts")))};
window.safeCopySvg=safeCopySvg; window.copiedValues=[];
Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{
 if(window.denyClipboard) throw Error("synthetic clipboard denied");
 window.copiedValues.push(value);
}}});
function Root(){
 const [message,setMessage]=useState(null),[mode,setMode]=useState("owner");
 window.copyGate={setMessage,setMode,changeAuth:()=>configureOfflineAccess(false)};
 if(!message)return null;
 return <main className="mx-auto max-w-4xl p-4"><MessageItem message={message} readOnly={mode!=="owner"}
 attachmentAccess={mode==="owner"?{kind:"owner"}:mode==="offline"?{kind:"offline"}:{kind:"share",token:"synthetic-not-real"}}
 onBookmark={()=>{}} onEdit={()=>{}} onInsert={()=>{}} onDelete={()=>{}} /></main>;
}
createRoot(document.getElementById("root")).render(<Root/>);`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"),
  output: { path: out, filename: "bundle.js" }, optimization: { minimize: false },
  resolve: {
    extensions: [".tsx", ".ts", ".mjs", ".js"],
    modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: {
      "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom$": require.resolve("react-dom"), "react-dom/client$": require.resolve("react-dom/client"),
      "../../components/preferences-provider$": join(out, "adapters.mjs"),
      "../editing/use-message-version-history$": join(out, "adapters.mjs"),
      "./assistant-message-renderer$": join(out, "adapters.mjs"),
    },
  },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const postcss = require("postcss"), tailwind = require("tailwindcss");
const styles = await postcss([tailwind({
  content: [join(web, "features/conversations/message-item.tsx"), join(web, "features/conversations/use-message-markdown-copy.tsx"), join(out, "entry.tsx")],
  theme: { extend: {} }, plugins: [],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
writeFileSync(join(out, "style.css"), styles.css);

const portProbe = createServer();
await new Promise(yes => portProbe.listen(0, "127.0.0.1", yes));
const apiPort = portProbe.address().port;
await new Promise(yes => portProbe.close(yes));
writeFileSync(join(out, "fixture.py"), `
import os,json
from pathlib import Path
from pytest import MonkeyPatch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.core.database import Base,get_db
from app.models.message import Message
from app.models.message_version import MessageVersion
from test_message_markdown_copy import seed
root=Path(os.environ['COPY_BROWSER_ROOT'])
factory=sessionmaker(bind=create_engine('sqlite:///'+str(root/'fixture.db')),autoflush=False)
Base.metadata.create_all(factory.kw['bind'])
def override():
 with factory() as db: yield db
app.dependency_overrides[get_db]=override
case=seed(MonkeyPatch(),root)
with factory() as db:
 m=db.get(Message,__import__('uuid').UUID(case['message']))
 v=db.get(MessageVersion,m.current_version_id)
 fixture={'message':{'id':str(m.id),'conversation_id':str(m.conversation_id),'role':m.role,
 'order_key':m.order_key,'ordinal':1,'current_version':{'id':str(v.id),'display_text':v.display_text,'plain_text':v.plain_text},
 'render_blocks':[],'block_count':0,'char_count':len(v.display_text)},'case':case}
@app.get('/_copy_fixture')
def fixture_read():return fixture
import uvicorn
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['COPY_API_PORT']),access_log=False,log_level='warning')
`);
const logFd = openSync(join(out, "api.log"), "w");
const api = spawn("python", [join(out, "fixture.py")], {
  cwd: join(root, "apps/api"), windowsHide: true, stdio: ["ignore", logFd, logFd],
  env: { ...process.env, PYTHONPATH: join(root, "apps/api") + ";" + join(root, "apps/api/tests"),
    APP_ENV: "test", AUTH_ENABLED: "false", COPY_BROWSER_ROOT: out, COPY_API_PORT: String(apiPort) },
});
let browser, server;
const results = [], errors = [], consoles = [], startedAt = new Date().toISOString();
try {
  let fixture;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/_copy_fixture`);
      if (response.ok) { fixture = await response.json(); break; }
    } catch {}
    if (api.exitCode !== null) throw Error("Synthetic API failed; see task-local api.log");
    await new Promise(yes => setTimeout(yes, 200));
  }
  assert.ok(fixture, "Synthetic API did not become ready");
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      if (path.startsWith("/api/")) {
        const pieces = []; for await (const piece of request) pieces.push(piece);
        const upstream = await fetch(`http://127.0.0.1:${apiPort}${request.url}`, {
          method: request.method, headers: { "Content-Type": request.headers["content-type"] ?? "application/json", ...(request.headers.range ? { Range: request.headers.range } : {}) },
          ...(["GET", "HEAD"].includes(request.method) ? {} : { body: Buffer.concat(pieces) }),
        });
        response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
        response.end(Buffer.from(await upstream.arrayBuffer())); return;
      }
      const asset = path === "/bundle.js" || path === "/style.css" ? path.slice(1) : null;
      response.setHeader("Content-Type", asset?.endsWith(".js") ? "text/javascript; charset=utf-8" : asset ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
      response.end(asset ? readFileSync(join(out, asset)) : '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    } catch { response.statusCode = 500; response.end(); }
  });
  await new Promise(yes => server.listen(0, "127.0.0.1", yes));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium, expect } = require("@playwright/test");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoles.push(message.text()); });
  const reset = async (message = fixture.message, locale = "en-US") => {
    await page.goto(origin); await page.waitForFunction(() => window.copyGate);
    await page.evaluate(({ message, locale }) => { window.copyLocale = locale; window.copyGate.setMessage(message); }, { message, locale });
    await page.locator("article").waitFor();
  };
  const click = async () => {
    if (page.viewportSize().width < 640) await page.getByTestId("mobile-message-actions-trigger").click();
    else await page.locator("article").hover();
    await page.getByTestId("message-markdown-copy").filter({ visible: true }).click();
  };
  const run = async (name, work) => { await work(); results.push(name); console.log("PASS " + name); };
  await run("desktop copies complete canonical source through real API; image links serve inert bytes", async () => {
    await reset(); await click();
    await expect.poll(() => page.evaluate(() => window.copiedValues.length)).toBe(1);
    const copied = await page.evaluate(() => window.copiedValues[0]);
    assert.ok(copied.endsWith("**Tail retained**"));
    assert.ok(!copied.includes("cr-asset://") && !copied.includes("[file]"));
    const urls = [...copied.matchAll(/!\[[^\]]*\]\((http[^)]+)\)/g)].map(match => match[1]);
    assert.equal(urls.length, 2);
    const anonymous = await browser.newContext();
    for (const url of urls) {
      const response = await anonymous.request.get(url);
      assert.equal(response.status(), 200);
      assert.equal(response.headers()["content-type"], "image/png");
      assert.equal(response.headers()["cache-control"], "no-store");
      assert.ok((await response.body()).subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])));
    }
    const external = await anonymous.newPage();
    await external.setContent(urls.map(url => `<img referrerpolicy="no-referrer" src="${url}" alt="synthetic external image">`).join(""));
    await external.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
    await anonymous.close();
    await page.screenshot({ path: join(out, "desktop.png"), fullPage: true });
    const button = page.getByTestId("message-markdown-copy").first();
    const bookmark = page.getByRole("button", { name: "Bookmark message" }).first();
    assert.ok((await button.boundingBox()).x < (await bookmark.boundingBox()).x);
  });
  await run("375px Chinese touch-style actions close before feedback without horizontal overflow", async () => {
    await page.setViewportSize({ width: 375, height: 812 }); await reset(fixture.message, "zh-CN"); await click();
    await expect(page.getByRole("status")).toContainText("Markdown 已复制");
    await expect(page.getByTestId("mobile-message-actions-sheet")).toHaveCount(0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(out, "mobile.png"), fullPage: true });
  });
  await run("clipboard rejection keeps full selectable Markdown and a direct retry", async () => {
    await reset(fixture.message, "zh-CN");
    await page.evaluate(() => window.denyClipboard = true); await click();
    const manual = page.getByRole("textbox", { name: "可手动复制的完整 Markdown" });
    await expect(manual).toBeVisible();
    assert.ok((await manual.inputValue()).endsWith("**Tail retained**"));
    assert.ok(await manual.evaluate(node => node.selectionEnd - node.selectionStart === node.value.length));
    await page.evaluate(() => window.denyClipboard = false); await click();
    await expect(page.getByRole("status")).toContainText("Markdown 已复制");
    await expect(manual).toHaveCount(0);
  });
  await run("a denied repeat copy replaces earlier success with selectable fallback", async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await reset(); await click();
    await expect.poll(() => page.evaluate(() => window.copiedValues.length)).toBe(1);
    await page.evaluate(() => window.denyClipboard = true); await click();
    await expect(page.getByRole("status")).toContainText("Clipboard unavailable");
    const manual = page.getByRole("textbox", { name: "Full Markdown for manual copy" });
    await expect(manual).toBeVisible();
    assert.ok((await manual.inputValue()).endsWith("**Tail retained**"));
    assert.equal(await page.evaluate(() => window.copiedValues.length), 1);
    await page.evaluate(() => window.denyClipboard = false); await click();
    await expect.poll(() => page.evaluate(() => window.copiedValues.length)).toBe(2);
    await expect(manual).toHaveCount(0);
    await page.getByRole("button", { name: "Dismiss copy notice" }).click();
    await page.evaluate(() => window.denyClipboard = true); await click();
    await expect(page.getByRole("status")).toContainText("Clipboard unavailable");
    await expect(manual).toBeVisible();
    assert.equal(await page.evaluate(() => window.copiedValues.length), 2);
  });
  await run("version retirement during pending source read prevents publication and clipboard writes", async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await reset();
    let release, entered;
    const enteredPromise = new Promise(yes => entered = yes), releasePromise = new Promise(yes => release = yes);
    await page.route("**/markdown-copy", async route => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch(); entered(); await releasePromise; await route.fulfill({ response });
    });
    await click(); await enteredPromise;
    await page.evaluate(message => window.copyGate.setMessage({ ...message, current_version: { ...message.current_version, id: "different-version" } }), fixture.message);
    release(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.copiedValues.length), 0);
    await page.unroute("**/markdown-copy");
  });
  await run("Share and offline representations never offer publication", async () => {
    await reset();
    for (const mode of ["share", "offline"]) {
      await page.evaluate(mode => window.copyGate.setMode(mode), mode);
      await expect(page.getByTestId("message-markdown-copy")).toHaveCount(0);
    }
  });
  await run("authentication retirement clears prepared text and prevents stale retries", async () => {
    await reset(); await page.evaluate(() => window.denyClipboard = true); await click();
    await expect(page.getByRole("textbox", { name: "Full Markdown for manual copy" })).toBeVisible();
    await page.evaluate(() => window.copyGate.changeAuth());
    await expect(page.getByRole("textbox", { name: "Full Markdown for manual copy" })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.copiedValues.length), 0);
  });
  await run("authentication retirement during pending source read prevents publication", async () => {
    await reset();
    let release, entered, publications = 0;
    const enteredPromise = new Promise(yes => entered = yes), releasePromise = new Promise(yes => release = yes);
    await page.route("**/markdown-copy", async route => {
      if (route.request().method() !== "GET") { publications++; return route.continue(); }
      const response = await route.fetch(); entered(); await releasePromise; await route.fulfill({ response });
    });
    await click(); await enteredPromise;
    await page.evaluate(() => window.copyGate.changeAuth());
    release(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.copiedValues.length), 0);
    assert.equal(publications, 0);
    await page.unroute("**/markdown-copy");
  });
  await run("unsafe SVG fails without publishing a partial selection", async () => {
    await reset(); let publications = 0;
    await page.route("**/api/attachments/*/content", async route => route.fulfill({
      status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://external.invalid/a"/></svg>',
    }));
    await page.route("**/markdown-copy", async route => {
      if (route.request().method() === "POST") publications++;
      await route.continue();
    });
    await click();
    await expect(page.getByRole("alert")).toContainText("could not be converted safely");
    assert.equal(publications, 0);
    assert.equal(await page.evaluate(() => window.copiedValues.length), 0);
    await page.unroute("**/api/attachments/*/content"); await page.unroute("**/markdown-copy");
  });
  await run("SVG safety rejects executable, external, entity and excessive-decoder content", async () => {
    const blocked = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://external.invalid/a"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg xmlns="http://www.w3.org/2000/svg"/>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000000" height="1000000"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://external.invalid"</style></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
    ];
    for (const svg of blocked) assert.equal(await page.evaluate(svg => { try { window.safeCopySvg(svg); return false; } catch { return true; } }, svg), true);
    assert.ok(await page.evaluate(() => window.safeCopySvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><style>.shape{fill:green}</style><rect class="shape" width="20" height="20"/></svg>').includes("width=")));
  });
  await run("keyboard copy target is 44px and has a visible focus indicator", async () => {
    await reset(); await page.getByTestId("message-markdown-copy").first().focus();
    const target = page.getByTestId("message-markdown-copy").first();
    const box = await target.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.copiedValues.length)).toBe(1);
  });
  assert.deepEqual(errors, []);
  // A deliberately blocked clipboard does not emit browser errors.
  assert.deepEqual(consoles, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({
    status: "passed", startedAt, passed: results, browser: browser.version(),
    boundary: "Synthetic SQLite FastAPI, actual MessageItem/copy hook/ReactMarkdown parser/canvas/client. Body/preferences/history adapters; clipboard API is deterministic test adapter, not OS clipboard or installed Obsidian.",
    pageErrors: errors, consoleErrors: consoles,
  }, null, 2));
  console.log(`PASS ${results.length} browser scenarios; ${out}`);
} finally {
  await browser?.close();
  if (server) await new Promise(yes => server.close(yes));
  api.kill(); closeSync(logFd);
}
