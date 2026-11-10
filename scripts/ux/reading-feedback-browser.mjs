// Real message actions, copy parser/controller, annotation workspace and timers.
// Synthetic HTTP/annotation repository and content renderer/secondary panels.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), web = join(root, "apps/web");
const require = createRequire(join(web, "package.json"));
const temp = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^c:\/users\/86182\/desktop\/wkkk\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const out = join(temp, "reading-feedback-browser");
mkdirSync(out, { recursive: true });
const path = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
import React from "react";
export const usePreferences=()=>({resolvedLocale:window.gateLocale,resolvedTheme:window.gateTheme,
 annotationDefaultPosition:"floating",setAnnotationDefaultPosition:()=>{},t:key=>key});
export const AssistantMessageRenderer=({message})=><p data-source-text>{message.current_version.display_text}</p>;
export const MarkdownRenderer=({content})=><p>{content}</p>;
export const useMessageVersionHistory=()=>({needsAttention:false});
export const VersionHistoryPanel=()=>null,NotebookView=()=>null,SettingsFocusedDialog=()=>null;
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MessageItem} from ${path("features/conversations/message-item.tsx")};
import {AnnotationWorkspace} from ${path("features/annotations/annotation-workspace.tsx")};
import {InteractionDialogProvider} from ${path("components/interaction-dialog-provider.tsx")};
import {useClipboardCopy} from ${path("components/use-clipboard-copy.ts")};
import {activateProtectedOfflineData} from ${path("lib/offline-db.ts")};
import * as access from ${path("lib/offline-access.ts")};
access.configureOfflineAccess(false);
await activateProtectedOfflineData("synthetic-feedback-owner");
const message={id:"synthetic-message",conversation_id:"synthetic-conversation",role:"assistant",ordinal:1,order_key:"000001",
 current_version:{id:"synthetic-version",display_text:"Synthetic text with a complete tail.",plain_text:"Synthetic text with a complete tail."},
 render_blocks:[],block_count:1};
const records=[];
const repository={mode:"remote",list:async()=>{if(window.failBookmarks)throw Error("Synthetic read failure");return [...records]},
 create:async(id,input)=>{if(window.waitBookmark)await new Promise(resolve=>window.finishBookmark=resolve);
 const saved={...input,id:input.id,conversation_id:id,revision:1,anchor_status:"resolved",comment_markdown:"",is_deleted:false,metadata:input.metadata??{}};
 records.push(saved);return saved;},
 getNotebook:async()=>({id:"synthetic-note",conversation_id:message.conversation_id,blocks:[],revision:1}),
 listNotebookConflicts:async()=>[],update:async()=>{throw Error("Not part of fixture")},delete:async()=>{throw Error("Not part of fixture")}};
function App(){
 const [visible,setVisible]=useState(true),[open,setOpen]=useState(false);
 const copy=useClipboardCopy("Synthetic share link");
 window.gate={records,access,setVisible};
 return <main className="mx-auto max-w-3xl p-4">
 <h1 className="mb-4 text-lg">Synthetic feedback</h1>
 <button id="outside" className="btn-secondary min-h-11 px-3" onClick={()=>void copy.copy()}>{copy.state}</button>
 {copy.state==="failed"?<textarea ref={copy.manualRef} readOnly value="Synthetic share link" aria-label="Manual shared copy"/>:null}
 {visible?<MessageItem message={message} conversationTitle="Synthetic conversation"/>:null}
 <AnnotationWorkspace conversationId={message.conversation_id} messages={[message]} activeMessageId={message.id}
 repository={repository} open={open} onOpenChange={setOpen} onNavigate={()=>({status:"settled"})}/>
 </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
 <InteractionDialogProvider><App/></InteractionDialogProvider></QueryClientProvider>);
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack, adapter = join(out, "adapters.tsx");
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: { extensions: [".tsx", ".ts", ".mjs", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom/client$": require.resolve("react-dom/client") } },
  plugins: [new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|assistant-message-renderer|markdown-renderer|use-message-version-history|version-history-panel|notebook-view|settings-focused-dialog)$/, resource => { resource.request = adapter; })],
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [join(web, "components/**/*.tsx"), join(web, "features/**/*.tsx"), join(out, "entry.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [];
try {
  for (const width of [375, 800, 1440]) for (const locale of ["zh-CN", "en-US"]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, hasTouch: width === 375 });
    const page = await context.newPage(), errors = [];
    let plans = 0, publications = 0, failPlan = false, exportedSelection;
    page.on("pageerror", error => errors.push(String(error)));
    await page.addInitScript(({ locale, theme }) => {
      window.gateLocale = locale; window.gateTheme = theme;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => {
        if (window.clipboardMode === "denied") throw Error("Synthetic denied");
        if (window.clipboardMode === "pending") await new Promise(resolve => window.finishCopy = resolve);
        window.copiedText = text;
      } } });
      document.addEventListener("DOMContentLoaded", () => document.documentElement.dataset.theme = theme);
    }, { locale, theme });
    await page.route("https://feedback.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: styles.css });
      if (url.pathname.endsWith("/markdown-copy") && request.method() === "GET") {
        plans++;
        return failPlan ? route.fulfill({ status: 413, json: { detail: "Synthetic copy limit" } })
          : route.fulfill({ json: { version_id: "synthetic-version", markdown: "Synthetic text with a complete tail.", attachments: [] } });
      }
      if (url.pathname.endsWith("/markdown-copy") && request.method() === "POST") {
        publications++;
        return route.fulfill({ json: { urls: {} } });
      }
      if (url.pathname.endsWith("/exports/markdown")) {
        exportedSelection = url.searchParams.get("message_ids");
        return route.fulfill({ contentType: "text/markdown", body: "Synthetic text with a complete tail.",
          headers: { "content-disposition": 'attachment; filename="synthetic.md"' } });
      }
      throw Error(`Unexpected synthetic endpoint ${request.method()} ${url.pathname}`);
    });
    try {
      await page.goto("https://feedback.test/");
      const zh = locale === "zh-CN";
      const body = page.locator("[data-source-text]");
      await body.waitFor();
      await page.clock.install();
      const outside = page.locator("#outside");
      await outside.click(); await expect(outside).toHaveText("copied");
      await page.clock.runFor(3100); await expect(outside).toHaveText("idle");
      async function actions() {
        if (width === 375) await page.getByTestId("mobile-message-actions-trigger").click();
        else await page.locator("[data-message-meta]").hover();
      }
      const copy = page.getByRole("button", { name: zh ? "复制消息为 Markdown" : "Copy message as Markdown", exact: true });
      const before = await body.boundingBox();
      await actions(); await copy.click();
      await expect(page.locator('[role=status]').filter({ hasText: zh ? "Markdown 已复制" : "Markdown copied" })).toHaveCount(1);
      assert.equal(await page.evaluate(() => window.copiedText), "Synthetic text with a complete tail.");
      await page.clock.runFor(3100);
      await expect(page.locator('[role=status]').filter({ hasText: zh ? "Markdown 已复制" : "Markdown copied" })).toHaveCount(0);
      const after = await body.boundingBox(); assert.ok(Math.abs(before.y - after.y) <= 1);
      // Expiring the receipt does not discard prepared full Markdown or republish images.
      await page.evaluate(() => { window.clipboardMode = "denied"; });
      await actions(); await copy.click();
      const manual = page.getByRole("textbox", { name: zh ? "可手动复制的完整 Markdown" : "Full Markdown for manual copy" });
      await expect(manual).toBeFocused();
      await page.clock.runFor(6000); await expect(manual).toBeVisible();
      assert.equal(plans, 1); assert.equal(publications, 1);
      await page.getByRole("button", { name: zh ? "关闭复制提示" : "Dismiss copy notice" }).click();
      await page.evaluate(() => { window.clipboardMode = "ok"; });
      // Citation success is action-local; denied copy selects a real manual field.
      await actions();
      await body.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
      const cite = page.getByRole("button", { name: zh ? "复制所选内容并附上来源" : "Copy selection with source", exact: true });
      await cite.click();
      const citation = page.locator('[role=status]').filter({ hasText: zh ? "引用已复制" : "Citation copied" });
      await expect(citation).toHaveCount(1);
      assert.equal(await citation.evaluate(element => getComputedStyle(element).position), "absolute");
      await page.clock.runFor(3100); await expect(citation).toHaveCount(0);
      await page.evaluate(() => { window.clipboardMode = "denied"; });
      await actions();
      await body.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
      await cite.click();
      const citationField = page.locator("textarea").filter({ hasText: /Synthetic conversation/ });
      await expect(citationField).toBeFocused();
      await page.clock.runFor(6000); await expect(citationField).toBeVisible();
      // A new message mount clears only ephemeral feedback, not saved annotations.
      await page.evaluate(() => window.gate.setVisible(false)); await body.waitFor({ state: "detached" });
      await page.evaluate(() => window.gate.setVisible(true)); await body.waitFor();
      failPlan = true;
      await actions(); await copy.click();
      await page.getByText(zh ? "内容超出安全复制限制，请使用导出。" : "Content exceeds the safe copy limit. Use export instead.", { exact: true }).waitFor();
      await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-copy-export.png`), fullPage: true });
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: zh ? "下载文件" : "Download file", exact: true }).click();
      const file = await download; const stream = await file.createReadStream(); const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), "Synthetic text with a complete tail.");
      assert.equal(exportedSelection, "synthetic-message");
      await page.getByRole("button", { name: zh ? "关闭复制提示" : "Dismiss copy notice" }).click();
      const bookmark = () => page.evaluate(() => window.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", {
        detail: { conversationId: "synthetic-conversation", messageId: "synthetic-message" } })));
      await bookmark();
      const saved = page.getByText(zh ? "阅读位置已保存" : "Reading position saved", { exact: true });
      await saved.waitFor();
      const notice = saved.locator("..");
      await notice.getByRole("button", { name: zh ? "查看" : "View", exact: true }).focus();
      await page.clock.runFor(6000); await expect(saved).toBeVisible();
      await outside.focus(); await page.clock.runFor(5100); await expect(saved).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.gate.records.length), 1);
      await bookmark(); await saved.waitFor();
      await page.clock.runFor(5100); await expect(saved).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.gate.records.length), 1, "notice expiry does not delete or duplicate a saved reading point");
      await page.evaluate(() => { window.failBookmarks = true; });
      await bookmark();
      const readFailure = page.getByText(zh ? "书签读取失败，尚未保存。请重试保存当前位置。" : "Bookmarks could not be read. Nothing saved; try Save reading position again.", { exact: true });
      await readFailure.waitFor(); await page.clock.runFor(6000); await expect(readFailure).toBeVisible();
      const failureRect = await readFailure.boundingBox();
      assert.ok(failureRect.width >= 180, "mobile recovery prose must not collapse into a narrow column");
      await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-recovery.png`), fullPage: true });
      await page.evaluate(() => {
        window.failBookmarks = false; window.waitBookmark = true;
        window.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", { detail: {
          conversationId: "synthetic-conversation", messageId: "synthetic-message",
          position: { anchor_data: { block_offset: 0.5 } },
        } }));
      });
      const pendingBookmark = page.getByText(zh ? "书签保存中或待核对" : "Bookmark saving or awaiting verification", { exact: true });
      await pendingBookmark.waitFor(); await page.clock.runFor(6000); await expect(pendingBookmark).toBeVisible();
      await page.evaluate(() => window.finishBookmark());
      await saved.waitFor();
      assert.equal(await page.evaluate(() => window.gate.records.length), 2);
      await page.clock.runFor(5100); await expect(saved).toHaveCount(0);
      failPlan = false;
      await page.evaluate(() => { window.clipboardMode = "pending"; });
      await actions(); await copy.click();
      await page.waitForFunction(() => Boolean(window.finishCopy));
      await page.evaluate(() => window.gate.access.lockOfflineAccess(false));
      await page.evaluate(() => window.finishCopy());
      await page.clock.runFor(100);
      assert.equal(await page.locator('[role=status]').filter({ hasText: /Markdown (?:已复制|copied)/ }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      results.push({ width, locale, theme, copy_expiry: true, prepared_retained: true, success_reflow: after.y - before.y,
        citation_manual_selection: true, copy_limit_full_export: true, bookmark_focus_pause: true, failure_persistent: true,
        pending_bookmark_persistent: true, retired_copy_fenced: true });
    } catch (error) {
      writeFileSync(join(out, "failure.json"), JSON.stringify({ width, locale, theme, error: String(error), errors }, null, 2));
      await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  writeFileSync(join(out, "result.json"), JSON.stringify({ passed: results.length, cases: results,
    limitations: "Real controls/hooks/parser/CSS, controlled presentation clock and synthetic HTTP/repository. Content and unrelated secondary panels adapted; not full Reader stability." }, null, 2));
  console.log(JSON.stringify({ passed: results.length, output: out }));
} finally { await browser.close(); }
