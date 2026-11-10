// Mounted ExportPanel, real request client/query cache/retention controls/CSS.
// Synthetic HTTP and secondary preference/Skill surfaces only.
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
const out = join(temp, "export-recovery-browser");
mkdirSync(out, { recursive: true });
const modulePath = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
export const usePreferences=()=>({resolvedLocale:window.gateLocale});
export const MaintenanceHint=()=>null;
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ExportPanel} from ${modulePath("features/exporting/export-panel.tsx")};
import * as access from ${modulePath("lib/offline-access.ts")};
access.configureOfflineAccess(false);
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
function App(){
 const [visible,setVisible]=useState(true);
 const [selection,setSelection]=useState(["synthetic-message-1","synthetic-message-2"]);
 const stateRef=useRef({format:"markdown",includeAttachments:false,includeContinuation:false,
 includeDescription:true,includeAnnotations:true,includeNotebook:true,includeSourceRefs:false,jobId:null,jobKey:null});
 window.gate={client,access,setVisible,stateRef,setSelection};
 return <main className="mx-auto max-w-xl p-4"><h1 className="mb-4 text-lg">Synthetic export recovery</h1>
 {visible?<ExportPanel conversationId="synthetic-conversation" selectedMessageIds={selection} stateRef={stateRef} sourceRevision={1}/>:null}</main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack, adapter = join(out, "adapters.tsx");
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: { extensions: [".tsx", ".ts", ".mjs", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom/client$": require.resolve("react-dom/client") } },
  plugins: [new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|maintenance-hint)$/, resource => { resource.request = adapter; })],
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [join(web, "features/exporting/**/*.tsx"), join(out, "entry.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [];
try {
  for (const width of [375, 800, 1440]) for (const locale of ["zh-CN", "en-US"]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: theme, hasTouch: width === 375 });
    const page = await context.newPage(), errors = [], submissions = [], directReads = [];
    const receipts = new Map(), tasks = new Map(), presets = [];
    let presetWrites = 0;
    let mode = "lost-accepted", deferred, release, artifactReads = 0, directStatus = 404;
    page.on("pageerror", error => errors.push(String(error)));
    await page.addInitScript(({ locale, theme }) => {
      window.gateLocale = locale;
      document.addEventListener("DOMContentLoaded", () => document.documentElement.dataset.theme = theme);
    }, { locale, theme });
    const job = key => ({ job_id: key, job_type: "conversation_export", status: "queued", phase: "queued",
      progress: 0, total_items: 2, processed_items: 0, result: {}, label: "Synthetic export", export_format: "markdown_v2" });
    await page.route("https://export-recovery.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: styles.css });
      if (url.pathname.endsWith("/attachments")) return route.fulfill({ json: { items: [] } });
      if (url.pathname.startsWith("/api/skills/resolve")) return route.fulfill({ json: {
        name: "Synthetic context guidance", bundle_url: "/synthetic-guidance.zip",
      } });
      if (url.pathname === "/api/user-feature-entries/export-preset") return route.fulfill({ json: presets });
      if (url.pathname.startsWith("/api/user-feature-entries/export-preset/") && request.method() === "PUT") {
        presetWrites++;
        presets.push({ id: url.pathname.split("/").at(-1), collection: "export-preset", revision: 1,
          value: request.postDataJSON().value, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
        return route.abort("failed");
      }
      if (/\/exports\/(markdown|canjson)$/.test(url.pathname)) {
        if (directStatus !== 200) return route.fulfill({ status: directStatus, json: { detail: "Synthetic server rejection" } });
        directReads.push(url);
        return route.fulfill({ body: "Synthetic", headers: {
          "content-type": url.pathname.endsWith("markdown") ? "text/markdown" : "application/x-ndjson",
          "content-length": String(64 * 1024 * 1024 + 1),
        } });
      }
      if (url.pathname.endsWith("/exports") && request.method() === "POST") {
        const key = request.headers()["idempotency-key"], payload = request.postDataJSON();
        submissions.push({ key, payload }); assert.equal(url.searchParams.get("background"), "true");
        const task = job(`task-${key}`);
        if (mode !== "lost-absent") { receipts.set(key, task); tasks.set(task.job_id, task); }
        if (mode === "deferred") {
          deferred?.();
          await new Promise(resolve => { release = resolve; });
          return route.fulfill({ json: task, status: 202 });
        }
        if (mode.startsWith("lost")) return route.abort("failed");
        return route.fulfill({ json: task, status: 202 });
      }
      if (url.pathname.includes("/by-request/")) return route.fulfill({ json: { task: receipts.get(url.pathname.split("/").at(-1)) ?? null } });
      if (url.pathname.startsWith("/api/tasks/")) return route.fulfill({ json: tasks.get(url.pathname.split("/").at(-1)) });
      if (url.pathname.startsWith("/api/exports/")) {
        artifactReads++;
        return route.fulfill({ json: { artifact_id: "synthetic-artifact", status: "available",
          retention_seconds: 180, release_on_close: true, expires_at: new Date(Date.now() + 180000).toISOString(),
          server_now: new Date().toISOString(), download_url: "/api/exports/synthetic-artifact/download" } });
      }
      if (url.pathname === "/api/tasks/active") return route.fulfill({ json: [] });
      throw Error(`Unexpected synthetic endpoint ${request.method()} ${url.pathname}`);
    });
    try {
      await page.goto("https://export-recovery.test/");
      const zh = locale === "zh-CN";
      const button = (chinese, english) => page.getByRole("button", { name: zh ? chinese : english, exact: true });
      await page.getByText(zh ? "0 个文件，0 个缺失或不可用" : "0 files, 0 missing or unavailable", { exact: true }).waitFor();
      const presetSummary = page.locator("summary").filter({ hasText: zh ? "导出预设" : "Export presets" });
      assert.equal(await button("保存当前", "Save current").isVisible(), false);
      assert.ok((await presetSummary.boundingBox()).y > (await button("下载文件", "Download file").boundingBox()).y);
      await presetSummary.focus(); await page.keyboard.press("Enter");
      await button("保存当前", "Save current").click();
      await page.getByRole("textbox", { name: zh ? "预设名称" : "Preset name" }).fill("Synthetic reusable options");
      await button("保存", "Save").click();
      await button("只读核对当前状态", "Check current state").waitFor();
      await presetSummary.click();
      await presetSummary.filter({ hasText: zh ? "需处理" : "Needs attention" }).waitFor();
      await presetSummary.click();
      await button("只读核对当前状态", "Check current state").click();
      await button("接受已核对结果", "Accept checked result").click();
      await page.getByText("Synthetic reusable options", { exact: true }).waitFor();
      assert.equal(presetWrites, 1);
      for (const target of await presetSummary.locator("..").getByRole("button").all()) {
        if (!await target.isVisible()) continue;
        const rect = await target.boundingBox(); assert.ok(rect.width >= 44 && rect.height >= 44);
      }
      await presetSummary.click();
      await button("下载文件", "Download file").click();
      await page.getByRole("alert").filter({ hasText: zh ? "对话已不可用" : "conversation is unavailable" }).waitFor();
      assert.equal(await button("按原选项在后台生成 ZIP", "Generate a ZIP with these options").count(), 0);
      directStatus = 403;
      await button("重试下载", "Retry download").click();
      await page.getByRole("alert").filter({ hasText: zh ? "当前登录或权限" : "session or permissions" }).waitFor();
      assert.equal(await button("按原选项在后台生成 ZIP", "Generate a ZIP with these options").count(), 0);
      directStatus = 413;
      await button("重试下载", "Retry download").click();
      await button("调整内容后再下载", "Adjust content before downloading").waitFor();
      assert.equal(await button("调整内容后再下载", "Adjust content before downloading").isDisabled(), true);
      assert.equal(await button("按原选项在后台生成 ZIP", "Generate a ZIP with these options").count(), 0);
      directStatus = 200;
      await page.getByRole("radio", { name: zh ? "所选 2 条消息" : "2 selected messages", exact: true }).check();
      await page.evaluate(() => window.gate.setSelection([]));
      await page.getByRole("radio", { name: zh ? "所选 0 条消息" : "0 selected messages", exact: true }).waitFor();
      assert.equal(await button("下载文件", "Download file").isDisabled(), true);
      assert.equal(submissions.length, 0);
      await page.evaluate(() => window.gate.setSelection(["synthetic-message-1", "synthetic-message-2"]));
      await button("下载文件", "Download file").click();
      await page.getByRole("alert").filter({ hasText: zh ? "浏览器直接下载预算" : "browser download budget" }).waitFor();
      assert.equal(directReads.length, 1);
      const start = button("按原选项在后台生成 ZIP", "Generate a ZIP with these options");
      await start.focus(); await page.keyboard.press("Enter");
      await button("核对结果", "Check result").waitFor();
      const rect = await button("核对结果", "Check result").boundingBox();
      assert.ok(rect.width >= 44 && rect.height >= 44);
      await expect(page.locator("[data-testid=recoverable-export]")).toBeFocused();
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].payload.format, "markdown_v2");
      assert.equal(submissions[0].payload.include_description, directReads[0].searchParams.get("include_description") === "true");
      assert.equal(submissions[0].payload.annotation_scope, "all");
      assert.equal(submissions[0].payload.notebook_scope, "current");
      assert.equal(submissions[0].payload.include_source_refs, false);
      assert.deepEqual(submissions[0].payload.message_ids, directReads[0].searchParams.get("message_ids").split(","));
      assert.equal(await button("按原请求重试", "Retry the original request").count(), 0);
      await page.evaluate(() => window.gate.setVisible(false));
      await page.locator("[data-testid=recoverable-export]").waitFor({ state: "detached" });
      await page.evaluate(() => window.gate.setVisible(true));
      await button("核对结果", "Check result").waitFor();
      assert.equal(submissions.length, 1);
      await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-unknown.png`), fullPage: true });
      await button("核对结果", "Check result").click();
      await page.getByText(zh ? "生成进度 0%" : "Progress 0%", { exact: true }).waitFor();
      assert.equal(submissions.length, 1, "read-only reconciliation never resubmits");
      const first = receipts.get(submissions[0].key);
      tasks.set(first.job_id, { ...first, status: "committed", phase: "committed", progress: 100,
        result: { artifact_id: "synthetic-artifact" } });
      await page.evaluate(async id => window.gate.client.invalidateQueries({ queryKey: ["task", id] }), first.job_id);
      await button("下载导出包", "Download export").waitFor();
      assert.ok(artifactReads > 0);
      // A new format is a different intent. A lost, not-yet-visible receipt
      // can only be explicitly retried with the same key and identical options.
      await button("CanJSON", "CanJSON").click();
      mode = "lost-absent";
      await button("下载文件", "Download file").click();
      await button("按原选项在后台生成 ZIP", "Generate a ZIP with these options").click();
      await button("核对结果", "Check result").click();
      await button("按原请求重试", "Retry the original request").waitFor();
      mode = "ack";
      await button("按原请求重试", "Retry the original request").click();
      await page.getByText(zh ? "生成进度 0%" : "Progress 0%", { exact: true }).waitFor();
      assert.equal(submissions.length, 3);
      assert.deepEqual(submissions[1], submissions[2]);
      const second = receipts.get(submissions[2].key);
      tasks.set(second.job_id, { ...second, status: "failed", phase: "failed", error_message: "PLAIN_EXPORT_LIMIT" });
      await page.evaluate(async id => window.gate.client.invalidateQueries({ queryKey: ["task", id] }), second.job_id);
      await page.getByRole("alert").filter({ hasText: zh ? "服务器大小限制" : "server limit" }).waitFor();
      assert.equal(await button("生成导出包", "Generate export").count(), 0, "unchanged limit failures do not offer a futile retry");
      assert.equal(await page.locator("[data-testid=export-artifact-delivery]").count(), 0);
      const more = page.locator("summary").filter({ hasText: zh ? "更多内容选项" : "More content options" });
      await more.click();
      await page.getByRole("checkbox", { name: zh ? "包含笔记" : "Include notebook", exact: true }).uncheck();
      await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-adjusted.png`), fullPage: true });
      const includeAttachments = page.getByRole("checkbox", { name: zh ? "包含附件" : "Include attachments" });
      if (width === 375) await includeAttachments.tap(); else await includeAttachments.check();
      await button("生成导出包", "Generate export").click();
      await page.getByText(zh ? "生成进度 0%" : "Progress 0%", { exact: true }).waitFor();
      assert.equal(submissions[3].payload.format, "canjson_bundle");
      assert.equal(submissions[3].payload.notebook_scope, "none");
      assert.equal(submissions[3].payload.annotation_scope, "all");
      await button("交给 AI", "For AI").click();
      await button("生成导出包", "Generate export").click();
      await page.getByText(zh ? "生成进度 0%" : "Progress 0%", { exact: true }).waitFor();
      assert.equal(submissions[4].payload.format, "context_package");
      assert.equal(submissions[4].payload.context_attachment_policy, "include");
      assert.equal(submissions[4].payload.continuation_policy, "raw_only");
      const contextJob = receipts.get(submissions[4].key);
      tasks.set(contextJob.job_id, { ...contextJob, status: "committed", phase: "committed", progress: 100,
        result: { artifact_id: "synthetic-artifact" } });
      await page.evaluate(async id => window.gate.client.invalidateQueries({ queryKey: ["task", id] }), contextJob.job_id);
      await expect(page.getByTestId("context-package-delivery")
        .getByRole("button", { name: zh ? "下载上下文包" : "Download Context Package", exact: true })).toBeEnabled();
      await button("CanJSON", "CanJSON").click();
      await includeAttachments.uncheck();
      // Late acknowledgement after an account epoch changes must never bind
      // a task or output into the new account's visible controls or query cache.
      mode = "deferred";
      const observed = new Promise(resolve => { deferred = resolve; });
      await button("下载文件", "Download file").click();
      await button("按原选项在后台生成 ZIP", "Generate a ZIP with these options").click();
      await observed;
      assert.equal(submissions[5].payload.notebook_scope, "none");
      await page.evaluate(() => window.gate.access.lockOfflineAccess(false));
      release();
      await page.locator("[data-testid=recoverable-export]").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => window.gate.client.getQueryCache().findAll({ queryKey: ["export-request"] })
        .filter(q => q.state.data?.job?.job_id?.includes("task-export-")).length), 4);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      results.push({ width, locale, theme, original_options: true, remount_receipt: true, check_read_only: true,
        explicit_same_key_retry: true, adjustment_retained: true, empty_selection_blocked: true, server_limit_not_bypassed: true,
        bundle_context_options: true, context_delivery_named: true, account_retirement: true, collapsed_presets_preserve_recovery: true,
        unavailable_or_denied_not_backgrounded: true });
    } catch (error) {
      writeFileSync(join(out, "failure.json"), JSON.stringify({ width, locale, theme, error: String(error), errors, submissions }, null, 2));
      await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  writeFileSync(join(out, "result.json"), JSON.stringify({ passed: results.length, cases: results,
    limitations: "Synthetic HTTP and preferences/Skill surfaces; real React Query, API client, export/preset controls, retention and CSS. Not full-app or production acceptance." }, null, 2));
  console.log(JSON.stringify({ passed: results.length, output: out }));
} finally { await browser.close(); }
