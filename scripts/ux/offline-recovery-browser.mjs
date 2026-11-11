// Real queue/API client, Dexie, package import, Web Locks, recovery UI and
// confirmation/focus. Only HTTP, preference/identity setup and unrelated
// secondary panels are synthetic. No user archives or production services.
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
const out = join(temp, "offline-recovery-browser");
mkdirSync(out, { recursive: true });
const modulePath = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
export const usePreferences=()=>({resolvedLocale:window.gateLocale,preferenceSync:{changes:{}}});
export const usePathname=()=>"/library";
export const offlineLeaseExpiresAt=()=>Infinity;
export const OfflineConflictReview=()=>null, PendingChangesPanel=()=>null, PreferenceSyncStatus=()=>null,
ReadingPositionSyncStatus=()=>null, OfflineChecklistsPanel=()=>null;
`);
writeFileSync(join(out, "entry.tsx"), `
import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {OfflineSyncCenter} from ${modulePath("components/offline-sync-center.tsx")};
import {InteractionDialogProvider} from ${modulePath("components/interaction-dialog-provider.tsx")};
import {configureOfflineAccess} from ${modulePath("lib/offline-access.ts")};
import * as storage from ${modulePath("lib/offline-db.ts")};
import * as downloads from ${modulePath("lib/offline-downloads.ts")};
async function main(){
 configureOfflineAccess(false);
 await storage.activateProtectedOfflineData("synthetic-recovery-owner");
 window.gate={...downloads,storage,snapshot:async()=>({
   downloads:await downloads.listOfflineDownloads(),messages:await storage.offlineDb.messages.toArray(),
   conversations:await storage.offlineDb.conversations.toArray()
 }),seed:async(id)=>storage.importOfflinePackage("seed-"+id,await fetch("/seed/"+id))};
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><InteractionDialogProvider>
 <main style={{maxWidth:720,margin:"20px auto",padding:12}}><OfflineSyncCenter/></main>
 </InteractionDialogProvider></QueryClientProvider>);
}
main().catch(error=>{window.gateError=String(error);throw error;});
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack, adapter = join(out, "adapters.tsx");
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: { extensions: [".tsx", ".ts", ".mjs", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom/client$": require.resolve("react-dom/client"), "next/navigation$": adapter } },
  plugins: [new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|auth-client|offline-conflict-review|pending-changes-panel|preference-sync-status|reading-position-sync-status|offline-checklists-panel)$/, resource => { resource.request = adapter; })],
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [join(web, "components/**/*.tsx"), join(web, "features/**/*.tsx"), join(out, "entry.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { zipSync, strToU8 } = require("fflate");
function archive(id, revision = 2, version = 3, assetMode = "all") {
  const text = `Synthetic retained message ${id} revision ${revision}`;
  return Buffer.from(zipSync({ "package.json": strToU8(JSON.stringify({
    format: "chat-reader-offline-package", version, update_mode: "conversation-delta",
    catalog_revision: "synthetic", scope: "conversation", scope_id: id, asset_mode: assetMode,
    conversations: [{ id, title: `Synthetic ${id}`, display_title: `Synthetic ${id}`,
      message_count: 1, turn_count: 1, offline_revision: revision, messages: [{
        id: "message-" + id, conversation_id: id, role: "user", order_key: "000001", turn_index: 1,
        current_version: { id: "version-" + id, version_number: revision, plain_text: text, display_text: text },
        render_blocks: [], block_count: 0, char_count: text.length, is_heavy: false,
      }], headings: [], search_documents: [], annotations: [], notebook: null, reading_position: null, attachments: [] }],
  })) }));
}
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [], errors = [];
try {
  for (const width of [375, 800, 1440]) for (const locale of ["zh-CN", "en-US"]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.addInitScript(({ locale, theme }) => {
      window.gateLocale = locale;
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; });
    }, { locale, theme });
    let broken = true, interrupted = true;
    const admissions = [], jobs = new Map();
    const conversations = Array.from({ length: 6 }, (_, i) => ({
      id: `synthetic-${i + 1}`, display_title: `Synthetic research conversation ${i + 1}`,
      revision: 2, estimated_bytes: 4096, project_id: i < 5 ? "project-synthetic" : null,
    }));
    const catalog = { revision: "synthetic", conversations,
      projects: [{ id: "project-synthetic", name: "Synthetic reading archive", conversation_ids: conversations.slice(0, 5).map(item => item.id) }] };
    await page.route("https://offline-recovery.synthetic/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === "/api/offline/catalog") return route.fulfill({ json: catalog });
      if (path === "/api/offline/packages") {
        const body = request.postDataJSON(), key = request.headers()["idempotency-key"];
        admissions.push({ body, key }); jobs.set(key, body);
        assert.equal(body.scope, "conversation");
        return route.fulfill({ status: 202, json: { job_id: key, package_id: key, status: "queued" } });
      }
      if (path.startsWith("/api/tasks/")) {
        const key = path.split("/").at(-1);
        return route.fulfill({ json: { status: "committed", progress: 100, result: { package_id: key } } });
      }
      if (path.endsWith("/download")) {
        const key = path.split("/").at(-2), input = jobs.get(key), id = input.conversation_id;
        if (id === "synthetic-5" && interrupted) return route.fulfill({ status: 503, body: "Synthetic interruption" });
        if (id === "synthetic-2" && broken) return route.fulfill({ contentType: "application/zip", body: "not a package" });
        if (id === "synthetic-3" && input.include_assets !== "none") {
          return route.fulfill({ headers: { "content-type": "application/zip", "content-length": String(512 * 1024 * 1024 + 1) }, body: "bounded synthetic header" });
        }
        return route.fulfill({ contentType: "application/zip", body: archive(id, 2, 3, input.include_assets) });
      }
      if (path.startsWith("/seed/")) {
        const id = path.split("/").at(-1);
        return route.fulfill({ contentType: "application/zip", body: archive(id, 1, id === "synthetic-2" ? 1 : 2, "none") });
      }
      if (path.startsWith("/api/")) return route.fulfill({ status: 404, json: { detail: "Synthetic unused API" } });
      return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
        body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : html });
    });
    try {
      await page.goto("https://offline-recovery.synthetic/");
      await page.bringToFront();
      await expect.poll(() => page.evaluate(() => Boolean(window.gate))).toBe(true);
      const ids = await page.evaluate(async () => {
        await window.gate.seed("synthetic-2"); await window.gate.seed("synthetic-3");
        const first = await window.gate.enqueueOfflineDownload({ scope: "project", scopeId: "project-synthetic", assetMode: "all" });
        const later = await window.gate.enqueueOfflineDownload({ scope: "conversation", scopeId: "synthetic-6", assetMode: "all" });
        await window.gate.resumeOfflineDownloads(new AbortController().signal);
        await window.gate.resumeOfflineDownloads(new AbortController().signal);
        return { first: first.id, later: later.id };
      });
      const snapshot = () => page.evaluate(() => window.gate.snapshot());
      let state = await snapshot(), row = state.downloads.find(item => item.id === ids.first);
      assert.equal(row.queuePaused, true); assert.equal(row.error, "NETWORK");
      assert.equal(row.conversationCursor, 4); assert.equal(row.conversationResults["synthetic-2"].error, "MALFORMED");
      assert.equal(row.conversationResults["synthetic-3"].error, "CAPACITY");
      assert.equal(state.downloads.find(item => item.id === ids.later).state, "queued");
      for (const id of ["synthetic-2", "synthetic-3"]) assert.equal(state.conversations.find(item => item.id === id).offline_revision, 1);
      // A real navigation reload preserves the receipt and paused queue.
      await page.reload(); await expect.poll(() => page.evaluate(() => Boolean(window.gate))).toBe(true);
      await page.evaluate(() => window.gate.resumeOfflineDownloads(new AbortController().signal));
      assert.equal(admissions.length, 5);
      const attention = page.getByRole("button", { name: /downloads need attention|项下载需要处理/ });
      await expect(attention).toBeVisible();
      if (width === 375) await attention.tap(); else { await attention.focus(); await attention.press("Enter"); }
      const failed = page.locator(`[data-offline-download-id="${ids.first}"]`);
      await expect(failed).toContainText(locale === "zh-CN" ? "已完成 2/5" : "2/5 completed");
      const details = failed.locator("summary");
      await details.focus(); await details.press("Enter");
      await expect(failed).toContainText("Synthetic research conversation 2");
      await expect(failed).toContainText("Synthetic research conversation 3");
      await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-paused.png`), fullPage: true });
      const retry = failed.getByRole("button", { name: /仅重试未完成项|Retry unfinished only/ });
      interrupted = false;
      await retry.focus(); await retry.press("Enter");
      await expect.poll(async () => (await snapshot()).downloads.find(item => item.id === ids.first).state).toBe("queued");
      await page.evaluate(() => window.gate.resumeOfflineDownloads(new AbortController().signal));
      state = await snapshot(); row = state.downloads.find(item => item.id === ids.first);
      assert.equal(row.error, "PARTIAL"); assert.equal(row.queuePaused, false);
      await page.evaluate(() => window.gate.resumeOfflineDownloads(new AbortController().signal));
      assert.equal((await snapshot()).downloads.find(item => item.id === ids.later).state, "completed");
      // Retry repairs the damaged package, not capacity and not completed rows.
      broken = false;
      await retry.click();
      await expect.poll(async () => (await snapshot()).downloads.find(item => item.id === ids.first).state).toBe("queued");
      await page.evaluate(() => window.gate.resumeOfflineDownloads(new AbortController().signal));
      state = await snapshot(); row = state.downloads.find(item => item.id === ids.first);
      assert.equal(row.error, "CAPACITY"); assert.equal(row.state, "failed");
      assert.equal(admissions.length, 7);
      assert.equal(state.conversations.find(item => item.id === "synthetic-3").offline_revision, 1);
      await expect(retry).toHaveCount(0);
      const reduce = failed.getByRole("button", { name: /改为正文与附件信息|Use text and file metadata/ });
      await reduce.focus(); await reduce.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(locale === "zh-CN" ? "不下载附件文件" : "without attachment files");
      await expect(reduce).toHaveAttribute("aria-disabled", "true");
      assert.equal(await reduce.getAttribute("disabled"), null, "Confirmation must not natively blur its real opener");
      assert.equal(admissions.length, 7, "Opening a confirmation must not submit a download");
      await page.keyboard.press("Escape"); await expect(reduce).toBeFocused();
      await expect(reduce).not.toHaveAttribute("aria-disabled", "true");
      assert.equal(admissions.length, 7);
      await reduce.click();
      await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-policy.png`), fullPage: true });
      await dialog.getByRole("button", { name: /按此选项继续|Continue with this option/ }).click();
      await expect.poll(async () => (await snapshot()).downloads.find(item => item.id === ids.first).state).toBe("queued");
      await page.evaluate(() => window.gate.resumeOfflineDownloads(new AbortController().signal));
      state = await snapshot(); row = state.downloads.find(item => item.id === ids.first);
      assert.equal(row.state, "completed"); assert.equal(row.error, null);
      assert.equal(admissions.length, 8);
      assert.equal(admissions.at(-1).body.conversation_id, "synthetic-3");
      assert.equal(admissions.at(-1).body.include_assets, "none");
      assert.equal(state.conversations.length, 6); assert.equal(state.messages.length, 6);
      assert.ok(state.conversations.every(item => item.offline_revision === 2));
      assert.equal(row.conversationResults["synthetic-1"].assetMode, "all");
      assert.equal(row.conversationResults["synthetic-3"].assetMode, "none");
      await expect(page.getByRole("tab", { name: /失败与冲突|Failures & conflicts/ })).toBeFocused();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `horizontal overflow: ${overflow}`);
      results.push({ width, locale, theme, admissions: admissions.length, retained_old_v1_v2: true, queue_pause: true,
        scoped_retries: true, actual_dexie_and_package_import: true, focus_return: true });
    } catch (error) {
      await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-failure.png`), fullPage: true });
      writeFileSync(join(out, "failure.json"), JSON.stringify({ width, locale, theme, message: error.stack, errors,
        snapshot: await page.evaluate(() => window.gate?.snapshot()).catch(() => null) }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ passed: results.length, cases: results, limitations:
    "Synthetic HTTP/preferences/identity setup and secondary panes; real API client/queue, package decode, Dexie, Web Locks, UI and focus. Not authenticated server/PWA shell or physical device acceptance." }, null, 2));
  console.log(JSON.stringify({ passed: results.length, output: out }));
} finally { await browser.close(); }
