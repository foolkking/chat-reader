// Mounted files workspace, actual API/XHR, Dexie receipts and focus.
// HTTP outcomes and unrelated preview/export UI are synthetic. No user files.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), web = join(root, "apps/web");
const require = createRequire(join(web, "package.json"));
const temp = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const out = join(temp, "attachment-recovery-browser");
mkdirSync(out, { recursive: true });
const modulePath = path => JSON.stringify(join(web, path).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
export const usePreferences=()=>({resolvedLocale:window.locale,readerWidthMode:"comfortable",sectionTocMode:"collapsed"});
export const usePathname=()=>"/synthetic";
export const AttachmentPreviewDialog=()=>null,ExportArtifactDelivery=()=>null;
export const readableBytes=value=>value+" B";
`);
writeFileSync(join(out, "entry.tsx"), `
import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ConversationFilesPanel} from ${modulePath("features/attachments/conversation-files-panel.tsx")};
import {InteractionDialogProvider} from ${modulePath("components/interaction-dialog-provider.tsx")};
import {configureOfflineAccess} from ${modulePath("lib/offline-access.ts")};
import {offlineDb,activateProtectedOfflineData} from ${modulePath("lib/offline-db.ts")};
async function main(){
 configureOfflineAccess(false); await activateProtectedOfflineData("synthetic-attachment-owner");
 window.db=offlineDb;
 if(window.denyStorage) offlineDb.settings.put=async()=>{throw Error("Synthetic quota refusal");};
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><InteractionDialogProvider>
 <main style={{maxWidth:720,margin:"12px auto",padding:12}}><ConversationFilesPanel conversationId="synthetic-conversation"
 onLocate={()=>{throw Error("Unexpected navigation");}} onInsert={()=>{throw Error("Unexpected insertion");}}/></main>
 </InteractionDialogProvider></QueryClientProvider>);
}
main().catch(error=>{throw error;});
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack, adapter = join(out, "adapters.tsx");
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: { extensions: [".tsx", ".ts", ".mjs", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom/client$": require.resolve("react-dom/client"), "next/navigation$": adapter } },
  plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_PWA_ENABLED": JSON.stringify("0") }),
    new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|attachment-block|export-artifact-delivery)$/, resource => { resource.request = adapter; })],
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [join(web, "components/**/*.tsx"), join(web, "features/**/*.tsx"), join(out, "entry.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [], errors = [];
try {
  for (const width of [375, 800, 1440]) for (const scenario of ["upload-receipt", "finalize-receipt", "storage-refusal", "replace-rejected"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const locale = width === 375 ? "zh-CN" : "en-US";
    await page.addInitScript(({ locale, scenario }) => {
      window.locale = locale; window.denyStorage = scenario === "storage-refusal";
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = locale === "zh-CN" ? "dark" : "light"; });
    }, { locale, scenario });
    const events = [], sessions = new Map(), items = new Map(), attachments = [];
    let failOnce = true;
    await page.route("https://attachments.synthetic/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
      if (path === "/api/capabilities") return route.fulfill({ json: { attachments: { upload_enabled: true, scanner_provider: "disabled" } } });
      if (path.endsWith("/attachment-upload-sessions") && method === "POST") {
        const body = request.postDataJSON(), session = { id: body.request_id, status: "open", expires_at: "2099-01-01T00:00:00Z", items: [] };
        events.push({ action: "session", id: session.id }); sessions.set(session.id, session);
        return route.fulfill({ json: session });
      }
      if (path.includes("/attachment-upload-sessions/")) {
        const sessionId = path.split("/")[3], session = sessions.get(sessionId);
        assert.ok(session);
        if (method === "GET") { events.push({ action: "check", id: sessionId }); return route.fulfill({ json: session }); }
        if (method === "DELETE" && scenario === "replace-rejected") {
          const item = items.get(path.split("/").at(-1)); assert.equal(item.validation_status, "rejected");
          item.validation_status = "abandoned"; events.push({ action: "abandon", id: item.id });
          return route.fulfill({ status: 204 });
        }
        assert.equal(method, "POST", "Closing/reloading must not DELETE an upload");
        const id = url.searchParams.get("request_id"), multipart = request.postDataBuffer().toString();
        const filename = multipart.match(/filename="([^"]+)"/)?.[1];
        assert.ok(id && filename);
        const item = { id, validation_status: scenario === "replace-rejected" && filename === "first.txt" ? "rejected" : "ready", original_filename: filename };
        session.items.push(item); items.set(id, item); events.push({ action: "upload", id, filename });
        if (scenario === "upload-receipt" && failOnce) {
          failOnce = false;
          return route.fulfill({ status: 503, json: { detail: "Synthetic response lost after upload" } });
        }
        return route.fulfill({ json: item });
      }
      if (path.endsWith("/attachments")) {
        if (method === "GET") return route.fulfill({ json: { items: attachments } });
        assert.equal(method, "POST");
        const ids = request.postDataJSON().upload_item_ids;
        assert.equal(ids.length, 1, "One file must finish processing before the next upload");
        const item = items.get(ids[0]); assert.ok(item);
        events.push({ action: "finalize", id: item.id, filename: item.original_filename });
        item.validation_status = "committed";
        const attachment = { id: "attachment-" + item.id, source_attachment_id: item.id,
          display_name: item.original_filename, original_filename: item.original_filename,
          detected_mime_type: "text/plain", declared_mime_type: "text/plain", asset_object: { id: "asset-" + item.id, byte_size: 9 },
          status: "available", resolution_status: "resolved", scan_status: "unscanned", occurrences: [], occurrence_count: 0, is_used: false,
          content_url: null, download_url: null, created_at: "2026-11-12T00:00:00Z" };
        attachments.push(attachment);
        if (scenario === "finalize-receipt" && failOnce) {
          failOnce = false;
          return route.fulfill({ status: 503, json: { detail: "Synthetic response lost after commit" } });
        }
        return route.fulfill({ json: { items: [attachment] } });
      }
      if (path === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (path === "/style.css") return route.fulfill({ contentType: "text/css", body: styles.css });
      if (path === "/") return route.fulfill({ contentType: "text/html", body: html });
      throw Error(`Unexpected synthetic request ${method} ${path}`);
    });
    try {
      await page.goto("https://attachments.synthetic/");
      const uploadButton = page.getByRole("button", { name: /^(上传|Upload)$/ });
      await expect(uploadButton).toBeEnabled();
      await page.getByTestId("conversation-files-upload-input").setInputFiles(["first.txt", "second.txt"].map(name => ({
        name, mimeType: "text/plain", buffer: Buffer.from("synthetic"),
      })));
      await expect.poll(() => attachments.some(item => item.display_name === "second.txt")).toBe(true);
      await expect(uploadButton).toBeEnabled();
      assert.deepEqual(events.filter(event => event.action === "upload").map(event => event.filename), ["first.txt", "second.txt"]);
      if (scenario !== "upload-receipt" && scenario !== "replace-rejected") {
        assert.ok(events.findIndex(event => event.action === "finalize" && event.filename === "first.txt")
          < events.findIndex(event => event.action === "upload" && event.filename === "second.txt"));
      }
      if (scenario === "replace-rejected") {
        const picker = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: /替换源文件|Replace source file/ }).click();
        await (await picker).setFiles({ name: "corrected.txt", mimeType: "text/plain", buffer: Buffer.from("corrected source") });
        await expect.poll(() => attachments.some(item => item.display_name === "corrected.txt")).toBe(true);
        assert.equal(events.filter(event => event.action === "upload").length, 3);
        assert.equal(events.filter(event => event.action === "session").length, 3);
        assert.equal(events.filter(event => event.action === "finalize").length, 2);
        assert.equal(events.filter(event => event.action === "abandon").length, 1);
      } else if (scenario !== "storage-refusal") {
        const writesBefore = events.filter(event => event.action !== "check").length;
        await page.reload();
        await expect(uploadButton).toBeEnabled();
        assert.equal(events.filter(event => event.action !== "check").length, writesBefore);
        await page.getByRole("button", { name: /核对提交结果|Check result/ }).click();
        if (scenario === "upload-receipt") {
          await expect(page.getByRole("button", { name: /将已上传|Add 1 uploaded/ })).toBeVisible();
          assert.equal(events.filter(event => event.action !== "check").length, writesBefore, "Checking must be read-only");
          await page.getByRole("button", { name: /将已上传|Add 1 uploaded/ }).click();
        }
        await expect(page.getByRole("button", { name: /核对提交结果|Check result/ })).toHaveCount(0);
        await expect.poll(() => attachments.length).toBe(2);
        assert.equal(events.filter(event => event.action === "session").length, 2);
        assert.equal(events.filter(event => event.action === "upload").length, 2);
        assert.equal(events.filter(event => event.action === "finalize").length, 2);
      }
      assert.equal(attachments.length, 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
      await page.screenshot({ path: join(out, `${width}-${scenario}.png`), fullPage: true });
      results.push({ width, scenario, events });
    } catch (error) {
      await page.screenshot({ path: join(out, `${width}-${scenario}-failure.png`), fullPage: true });
      writeFileSync(join(out, "failure.json"), JSON.stringify({ width, scenario, error: String(error), events, errors }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "passed", results }, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: results.length, out }));
} finally { await browser.close(); }
