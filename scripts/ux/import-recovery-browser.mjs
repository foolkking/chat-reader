// Mounted production Task Center, ContinuationPanel and query cache. Transport,
// Reader routing, account identity and adjacent documents/dialogs are synthetic.
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
const out = join(temp, "import-recovery-browser");
mkdirSync(out, { recursive: true });
const modulePath = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
import React from "react";
import {translate} from ${modulePath("lib/i18n.ts")};
import {withRequestDeadline} from ${modulePath("lib/request-deadline.ts")};
export const usePreferences=()=>({resolvedLocale:window.gateLocale});
export const useTranslations=()=>key=>translate(window.gateLocale,key);
export const authenticationGeneration=()=>window.authGeneration??1;
export const useImportDialog=()=>({openImportDialog:options=>window.openedImport=options});
const request=(url,init={})=>withRequestDeadline(async signal=>{
  const response=await fetch(url,{...init,signal});
  if(!response.ok) throw Object.assign(Error("Synthetic response"),{status:response.status});
  return response.json();
},init.signal);
export const getActiveTasks=()=>request("/api/tasks/active");
export const getPendingCleanupScans=async()=>[];
export const getTask=id=>request("/api/tasks/"+id);
export const retryTask=id=>request("/api/tasks/"+id+"/retry",{method:"POST"});
export const cancelTask=(id,signal,source_disposition)=>request("/api/tasks/"+id+"/cancel",{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source_disposition})});
export const continuationApi={
 state:(id,signal)=>request("/api/conversations/"+id+"/continuation",{signal}),
 revisions:(id,offset=0,signal)=>request("/api/conversations/"+id+"/continuation/revisions",{signal}),
 updateFiles:(id,body)=>request("/api/conversations/"+id+"/continuation/files",{method:"PUT",body}),
 returnPackage:(id,body)=>request("/api/conversations/"+id+"/continuation/returns",{method:"POST",body}),
};
export const ContinuationDocument=()=> <article>Retained synthetic continuation</article>;
export const ContinuationDropTarget=({children})=> <div>{children}</div>;
export const ContinuationHistory=()=>null;
export const ContentCleanupDialog=()=>null,CleanupDismissAction=()=>null,CleanupScanCancelAction=()=>null;
export const cleanupScanLabel=()=>"",SettingsFocusedDialog=()=>null,ExportArtifactDelivery=()=>null;
export default ({href,children,...props})=><a href={href} {...props}>{children}</a>;
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ImportTaskMonitor} from ${modulePath("features/import/import-task-monitor.tsx")};
import {ContinuationPanel} from ${modulePath("features/exporting/continuation-panel.tsx")};
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
function Fixture(){const [open,setOpen]=useState(true);const continuation=new URL(location.href).searchParams.has("continuation");
return <main style={{maxWidth:720,margin:"24px auto",padding:12}}>
 {continuation?<ContinuationPanel conversationId="synthetic-context-source"/>:<>
 <button className="btn-secondary min-h-11 px-3 mb-4" onClick={()=>setOpen(!open)}>Toggle tasks</button>
 {open&&<ImportTaskMonitor placement="center" forceVisible/>}
 </>}
</main>}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
const adapter = join(out, "adapters.tsx");
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: {
    extensions: [".tsx", ".ts", ".mjs", ".js"],
    modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom/client$": require.resolve("react-dom/client"), "next/link$": adapter },
  },
  plugins: [
    new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|import-dialog-provider|offline-access|content-cleanup-panel|cleanup-dismiss-action|cleanup-scan-progress|settings-focused-dialog|export-artifact-delivery|continuation-document|continuation-drop-target|continuation-history|\/lib\/api)$/, resource => { resource.request = adapter; }),
  ],
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
  for (const width of [375, 800, 1440]) for (const locale of ["zh-CN", "en-US"]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true });
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.addInitScript(({ locale, theme }) => {
      window.gateLocale = locale;
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; });
    }, { locale, theme });
    const now = new Date().toISOString();
    const row = (id, type, status) => ({ job_id: id, job_type: type, status, phase: status === "processing" ? "analyzing" : status,
      progress: 24, processed_items: 1, total_items: 4, source_label: "Synthetic source archive.zip", result: { import_id: "synthetic-import" },
      queued_at: now, started_at: now, attempt_count: 1, cancellable: status === "processing" });
    const analysis = row("analysis", "adaptive_import_analysis", "processing"), other = row("other", "conversation_merge", "failed");
    const limited = { ...row("limited", "conversation_export", "failed"), error_message: "PLAIN_EXPORT_LIMIT",
      result: { conversation_id: "synthetic-export-source" } };
    const invalid = { ...row("invalid", "adaptive_import_analysis", "failed"),
      error_message: "ZIP_PATH_UNSAFE", failure: { code: "ZIP_PATH_UNSAFE", stage: "analysis", retryable: false } };
    const sourceCleanup = { ...row("source-cleanup", "import", "cancelled"),
      result: { source_cleanup: { state: "failed", revision: "synthetic-cleanup-before", retryable: true } } };
    const contextRow = (id, action, reason, conversation_id = "synthetic-context-source") => ({
      ...row(id, "context_return", "failed"), error_message: "TASK_FAILED",
      result: { context_return_recovery: { action, reason, conversation_id } },
    });
    const expired = contextRow("context-expired", "update_files", "CONTEXT_RETURN_EXPIRED");
    const conflict = contextRow("context-conflict", "update_files", "CONTEXT_BASE_CHANGED");
    const unavailable = contextRow("context-missing", "open_list", "CONTEXT_NOT_FOUND", null);
    const transient = contextRow("context-transient", "retry", "CONTEXT_RETURN_FAILED");
    const rows = [analysis, other, limited, invalid, sourceCleanup, expired, conflict, unavailable, transient], writes = [];
    let continuationState = { generation: 0, adopted_revision_id: null, pending_return_task_id: null };
    let continuationReadFailed = false;
    let releaseCancel, retryFailed = false, taskReads = 0;
    const cancellation = new Promise(resolve => { releaseCancel = resolve; });
    await page.route("https://import-recovery.synthetic/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/tasks/active") return route.fulfill({ json: rows });
      if (path.endsWith("/cancel")) {
        writes.push({ path, body: route.request().postDataJSON() });
        await cancellation;
        analysis.status = analysis.phase = "cancelling"; analysis.cancellation_requested_at = new Date().toISOString();
        return route.fulfill({ json: analysis });
      }
      if (path.endsWith("/retry")) {
        writes.push({ path });
        if (path.endsWith("/source-cleanup/retry")) {
          sourceCleanup.result.source_cleanup = { state: "completed", revision: "synthetic-cleanup-after", retryable: false };
        } else if (path.endsWith("/context-transient/retry")) {
          transient.status = transient.phase = "queued"; transient.result = {};
          return route.fulfill({ json: transient });
        } else retryFailed = true;
        return route.abort("failed");
      }
      if (path.startsWith("/api/tasks/")) { taskReads++; return route.fulfill({ json: rows.find(row => path.endsWith("/" + row.job_id)) ?? analysis }); }
      if (path.endsWith("/continuation")) return route.fulfill(continuationReadFailed
        ? { status: 503, json: { detail: "Synthetic read failure" } } : { json: continuationState });
      if (path.endsWith("/continuation/revisions")) return route.fulfill({ json: [] });
      if (path.endsWith("/continuation/files")) {
        writes.push({ path, body: route.request().postData() });
        continuationState = { generation: 1, adopted_revision_id: null, pending_return_task_id: null };
        return route.fulfill({ json: { generation: 1, revision_id: "synthetic-new-revision" } });
      }
      if (path.endsWith("/continuation/returns")) {
        writes.push({ path }); return route.fulfill({ status: 500, json: {} });
      }
      return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
        body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : html });
    });
    try {
      await page.clock.install();
      await page.goto("https://import-recovery.synthetic/");
      const a = page.locator("#task-row-analysis"), b = page.locator("#task-row-other");
      const limitRow = page.locator("#task-row-limited"), invalidRow = page.locator("#task-row-invalid");
      await expect(limitRow).toBeVisible();
      await expect(limitRow.getByRole("button", { name: /^重试$|^Retry$/ })).toHaveCount(0);
      await expect(limitRow.getByRole("link", { name: /返回对话调整导出|Return to the conversation to adjust export/ }))
        .toHaveAttribute("href", "/conversations/synthetic-export-source");
      await expect(invalidRow.getByRole("button", { name: /^重试$|^Retry$/ })).toHaveCount(0);
      await expect(invalidRow.getByRole("button", { name: /查看导入分析|View import analysis/ })).toBeVisible();
      for (const id of [expired.job_id, conflict.job_id, unavailable.job_id]) {
        await expect(page.locator("#task-row-" + id).getByRole("button", { name: /^重试$|^Retry$/ })).toHaveCount(0);
      }
      const expiredRow = page.locator("#task-row-context-expired");
      await expect(expiredRow).toContainText(locale === "zh-CN" ? "临时上传已过期" : "The temporary upload expired");
      await expect(page.locator("#task-row-context-conflict")).toContainText(locale === "zh-CN" ? "先核对当前内容" : "Review the current files");
      await expect(expiredRow.getByRole("link", { name: /打开接续文件|Open continuation files/ }))
        .toHaveAttribute("href", "/conversations/synthetic-context-source?continuation=current");
      await expect(page.locator("#task-row-context-missing").getByRole("link", { name: /返回对话列表|Return to conversations/ }))
        .toHaveAttribute("href", "/");
      assert.equal(writes.length, 0, "Reading recovery hints must not replay uploads");
      const stop = a.getByRole("button", { name: /停止并保留|Stop and retain/ });
      await stop.click();
      await expect(stop).toBeDisabled();
      const retry = b.getByRole("button", { name: /^重试$|^Retry$/ });
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(b).toContainText(locale === "zh-CN" ? "操作结果尚未确认" : "The result is unconfirmed");
      assert.ok(retryFailed);
      assert.deepEqual(writes[0].body, { source_disposition: "retain" });
      releaseCancel();
      await expect(a).toContainText(locale === "zh-CN" ? "正在等待安全停止" : "Waiting for a safe stop");
      await page.getByRole("button", { name: "Toggle tasks" }).click();
      await page.getByRole("button", { name: "Toggle tasks" }).click();
      await expect(b.getByRole("button", { name: /^重试$|^Retry$/ })).toBeDisabled();
      const check = b.getByRole("button", { name: /核对状态|Check status/ });
      await check.focus(); await page.keyboard.press("Enter");
      await expect(b).toContainText(locale === "zh-CN" ? "操作结果尚未确认" : "The result is unconfirmed");
      assert.equal(writes.length, 2);
      assert.ok(taskReads > 0);
      // Advance the presentation clock only, not the controlled network. The
      // server-provided cancellation timestamp prevents remount from restarting it.
      await page.clock.fastForward(30_100);
      await expect(a).toContainText(locale === "zh-CN" ? "停止尚未确认" : "Stopping is not yet confirmed");
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        actions: [...document.querySelectorAll("[data-task-row] button, [data-task-row] a")].map(node => {
          const r = node.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right };
        }),
      }));
      assert.ok(geometry.overflow <= 1, `horizontal overflow: ${geometry.overflow}`);
      for (const action of geometry.actions) {
        assert.ok(action.width >= 44 && action.height >= 44 && action.left >= 0 && action.right <= width);
      }
      const filename = `tasks-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, filename), fullPage: true });
      const cleanupRow = page.locator("#task-row-source-cleanup");
      await expect(cleanupRow).toContainText(locale === "zh-CN" ? "临时来源仍待清理" : "temporary sources still need cleanup");
      await expect(cleanupRow.getByRole("button", { name: /关闭任务提示|Dismiss task/ })).toHaveCount(0);
      const cleanupRetry = cleanupRow.getByRole("button", { name: /重试文件清理|Retry file cleanup/ });
      await cleanupRetry.focus(); await page.keyboard.press("Enter");
      await expect(cleanupRow).toContainText(locale === "zh-CN" ? "操作结果尚未确认" : "The result is unconfirmed");
      await expect(cleanupRetry).toBeDisabled();
      await cleanupRow.getByRole("button", { name: /核对状态|Check status/ }).click();
      await expect(cleanupRow.getByRole("button", { name: /重试文件清理|Retry file cleanup/ })).toHaveCount(0);
      await expect(cleanupRow.getByRole("button", { name: /关闭任务提示|Dismiss task/ })).toBeVisible();
      assert.equal(writes.filter(item => item.path.endsWith("/source-cleanup/retry")).length, 1);
      const transientRow = page.locator("#task-row-context-transient");
      await transientRow.getByRole("button", { name: /^重试$|^Retry$/ }).click();
      await expect(transientRow.getByRole("button", { name: /^重试$|^Retry$/ })).toHaveCount(0);
      assert.equal(writes.filter(item => item.path.endsWith("/context-transient/retry")).length, 1);
      const beforeReselection = writes.length;
      const link = expiredRow.getByRole("link", { name: /打开接续文件|Open continuation files/ });
      await link.focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/conversations\/synthetic-context-source\?continuation=current$/);
      const continuation = page.getByRole("region", { name: /上下文接续|Context continuation/ });
      await expect(continuation.getByText("Retained synthetic continuation")).toBeVisible();
      await expect(continuation).not.toContainText(locale === "zh-CN" ? "临时上传已过期" : "The temporary upload expired");
      await expect(continuation.getByRole("button", { name: /更新文件|Update files/ })).toBeVisible();
      // Separate the fresh-link path above from an observed active task which
      // finishes just after the state snapshot. Only that snapshot binds its id.
      continuationState = { ...continuationState, pending_return_task_id: expired.job_id };
      await page.clock.fastForward(5100);
      await expect(continuation).toContainText(locale === "zh-CN" ? "临时上传已过期" : "The temporary upload expired");
      const reselect = continuation.getByRole("button", { name: /重新选择文件|Select files again/ });
      continuationReadFailed = true;
      await reselect.click();
      await expect(continuation.getByRole("alert")).toContainText(locale === "zh-CN" ? "编辑和选择已保留" : "Edits and selections are retained");
      await expect(continuation.getByText("Retained synthetic continuation")).toBeVisible();
      await page.clock.fastForward(3100);
      await expect(continuation.getByRole("alert")).toBeVisible();
      continuationReadFailed = false;
      await reselect.focus(); await page.keyboard.press("Enter");
      await expect(continuation.getByRole("heading", { name: /更新接续文件|Update continuation files/ })).toBeVisible();
      await continuation.getByLabel("Current (.md, 1 MiB)", { exact: true }).setInputFiles({
        name: "current.md", mimeType: "text/markdown", buffer: Buffer.from("# Newly selected synthetic continuation"),
      });
      assert.equal(writes.length, beforeReselection, "Navigation and file selection cannot replay the old input");
      const contextScreenshot = `context-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, contextScreenshot), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
      await continuation.getByRole("button", { name: /保存上传文件|Save uploaded files/ }).click();
      const savedNotice = continuation.getByRole("status").filter({ hasText: locale === "zh-CN" ? "文件已更新。" : "Files updated." });
      await expect(savedNotice).toBeVisible();
      await expect(continuation).not.toContainText(locale === "zh-CN" ? "临时上传已过期" : "The temporary upload expired");
      await page.clock.fastForward(2800);
      await expect(savedNotice).toBeVisible();
      await page.clock.fastForward(300);
      await expect(savedNotice).toHaveCount(0);
      await expect(continuation.getByRole("heading", { name: /更新接续文件|Update continuation files/ })).toBeVisible();
      assert.equal(writes.length, beforeReselection + 1);
      assert.match(writes.at(-1).body, /Newly selected synthetic continuation/);
      assert.equal(writes.filter(item => /\/context-(expired|conflict|missing)\/retry|\/continuation\/returns$/.test(item.path)).length, 0);
      results.push({ width, locale, theme, writes: writes.length, taskReads, geometry, screenshot: filename,
        sourceCleanup: "cancelled → explicit cleanup retry → unknown response → read-only confirmation",
        contextRecovery: "expired/conflict/missing target never requeue; transient retry once; explicit reselection then save",
        contextRead: "failed navigation retains the old document; read-only retry works; confirmed save supersedes old failure; success clears after 3s, failure does not",
        contextScreenshot });
    } catch (error) {
      await page.screenshot({ path: join(out, `failure-${width}-${locale}-${theme}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(out, "failure.json"), JSON.stringify({
        width, locale, theme, error: String(error), errors, completed: results,
      }, null, 2));
      throw error;
    } finally { releaseCancel(); await page.close(); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({
    scope: "Production Task Center + ContinuationPanel + React Query; synthetic network/account/Reader-route/adjacent-document adapters; actual editor draft protection is covered separately",
    results, errors,
  }, null, 2));
  console.log(`Task recovery browser: ${results.length} passed; ${out}`);
} finally { await browser.close(); }
