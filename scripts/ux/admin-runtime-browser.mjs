// Production Runtime panel, query cache, client and deadline. Only preferences,
// authentication identity and HTTP data are synthetic; never contacts a server.
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
const out = join(temp, "admin-runtime-browser");
mkdirSync(out, { recursive: true });
const modulePath = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
export const usePreferences=()=>({resolvedLocale:window.gateLocale});
export const authenticationGeneration=()=>window.authGeneration??1;
export const AUTH_GENERATION_CHANGED_EVENT="chat-reader:auth-generation-changed";
export const notifyAuthenticationFailure=()=>{};
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AdminRuntimePanel} from ${modulePath("components/admin-runtime-panel.tsx")};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function Fixture(){const[open,setOpen]=useState(true);return <main style={{maxWidth:720,margin:"24px auto",padding:12}}>
 <button onClick={()=>setOpen(!open)}>Toggle panel</button>{open&&<AdminRuntimePanel/>}
</main>;}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: { extensions: [".tsx", ".ts", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"), "react-dom/client$": require.resolve("react-dom/client") } },
  plugins: [new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|offline-access)$/, resource => { resource.request = join(out, "adapters.tsx"); })],
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({ content: [join(web, "components/**/*.tsx")] })])
  .process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [], errors = [];
let current;
try {
  for (const width of [375, 800, 1440]) for (const locale of ["zh-CN", "en-US"]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true });
    current = page;
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.clock.install();
    await page.addInitScript(({ locale, theme }) => {
      window.gateLocale = locale;
      window.authGeneration = 1;
      window.runtimeMode = "normal"; window.runtimeReads = 0; window.runtimeWrites = 0;
      window.executionReads = 0; window.executionWrites = 0; window.executionMode = "normal";
      window.execution = {
        identity: { task_kind: "job", task_id: "00000000-0000-4000-8000-000000000001",
          execution_token: "00000000-0000-4000-8000-000000000002", attempt: 1 },
        state: "stalled", canonical_status: "processing", family: "export",
        owner: { id: "00000000-0000-4000-8000-000000000003", label: "Synthetic reader" },
        started_at: "2026-11-12T00:00:00Z", progress_age_seconds: 320, stop_allowed: true,
        stop_requested_at: null, stop_recorded_at: null, source_disposition: null,
      };
      window.lastStop = null;
      const counts = { queued: 0, processing: 0, cancelling: 0, committed: 0, failed: 0, cancelled: 0 };
      const storage = { available: true, bytes: 4096, file_count: 2, complete: true };
      window.snapshot = {
        generated_at: "2026-11-11T00:00:00Z", complete: true,
        worker: { available: true, status: "alive_idle", heartbeat_at: "2026-11-11T00:00:00Z", heartbeat_age_seconds: 3 },
        queue: { available: true, jobs: { ...counts }, imports: { ...counts } },
        storage: Object.fromEntries(["imports", "exports", "offline", "assets"].map(key => [key, { ...storage }])),
        export_cleanup: { available: true, pending_count: 0, pending_bytes: 0, failed_count: 0 },
        source_cleanup: { available: true, pending_count: 0, blocked_count: 0 },
        backup: { available: true, record: { status: "COMPLETED", created_at: "2026-11-10T00:00:00Z", completed_at: "2026-11-10T00:03:00Z" } },
        restore: { available: true, record: null }, mail: { configured: true },
      };
      const realFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (String(url).includes("/api/admin/runtime-execution")) {
          const path = new URL(String(url), location.href).pathname;
          if (path.endsWith("/stop")) {
            window.executionWrites++;
            window.sentIdentity = JSON.parse(options.body);
            if (window.executionMode === "changed") return new Response(JSON.stringify({ detail: { code: "TASK_EXECUTION_CHANGED" } }), { status: 409 });
            window.execution = { ...window.execution, state: "stopping", stop_allowed: false,
              stop_requested_at: "2026-11-12T00:06:00Z", stop_recorded_at: "2026-11-12T00:06:00Z", source_disposition: "retain" };
            window.lastStop = structuredClone(window.execution);
            if (window.executionMode === "lost") throw Error("Synthetic lost acknowledgement");
            if (window.executionMode === "hung") return { ok: true, status: 200, json: () => new Promise(() => {}) };
            if (window.executionMode === "late") return new Promise(resolve => {
              window.releaseOldStop = () => resolve(new Response(JSON.stringify(window.execution)));
            });
            return new Response(JSON.stringify(window.execution));
          }
          window.executionReads++;
          if (window.executionMode === "read-failed") throw Error("Synthetic read failure");
          if (window.executionMode === "denied") return new Response("{}", { status: 403 });
          return new Response(JSON.stringify(path.endsWith("/result") ? window.execution
            : { current: window.execution.state === "finished" ? null : window.execution, last_stop: window.lastStop, untracked: false }));
        }
        if (!String(url).endsWith("/api/admin/runtime-status")) return realFetch(url, options);
        window.runtimeReads++;
        if (options?.method && options.method !== "GET") window.runtimeWrites++;
        if (window.runtimeMode === "error") throw Error("Synthetic transport failure");
        if (window.runtimeMode === "denied") return new Response("{}", { status: 403 });
        const snapshot = structuredClone(window.snapshot);
        if (window.runtimeMode === "late") return new Promise(resolve => {
          window.releaseOldResponse = () => resolve(new Response(JSON.stringify(snapshot)));
        });
        if (window.runtimeMode === "hung-body") return { ok: true, status: 200, json: () => new Promise(() => {}) };
        return new Response(JSON.stringify(snapshot));
      };
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; });
    }, { locale, theme });
    await page.route("http://runtime.synthetic/**", route => {
      const path = new URL(route.request().url()).pathname;
      assert.ok(!path.startsWith("/api/"), "The synthetic fetch must own all API data.");
      return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
        body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : html });
    });
    await page.goto("http://runtime.synthetic/");
    const zh = locale === "zh-CN", panel = page.getByRole("region", { name: zh ? "运行状态" : "Runtime status" });
    const refresh = panel.getByRole("button", { name: zh ? "刷新状态" : "Refresh status", exact: true });
    const queue = panel.getByRole("heading", { name: zh ? "任务队列" : "Task queues" });
    await expect(queue).toBeVisible();
    await expect(panel.getByRole("heading", { name: zh ? "临时文件回收" : "Temporary file cleanup" })).toHaveCount(0);
    await expect(panel.getByText(zh ? "最近系统备份" : "Latest system backup", { exact: true })).toHaveCount(0);
    const details = panel.locator("details"), summary = details.locator("summary");
    await expect(details).not.toHaveAttribute("open");
    await summary.focus(); await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText(zh ? "不包含服务器备份" : "does not include server backups");
    assert.ok((await summary.boundingBox()).height >= 44);
    assert.ok((await refresh.boundingBox()).height >= 44);
    await page.screenshot({ path: join(out, `runtime-${width}-${locale}-${theme}.png`) });
    await page.evaluate(() => { window.runtimeMode = "error"; });
    await refresh.click(); await expect(panel.getByRole("alert")).toContainText(zh ? "上次结果" : "previous result");
    await expect(queue).toBeVisible();
    await page.evaluate(() => { window.runtimeMode = "normal";
      window.snapshot.export_cleanup.pending_count = 2; window.snapshot.export_cleanup.failed_count = 1;
      window.snapshot.source_cleanup.pending_count = 1; window.snapshot.source_cleanup.blocked_count = 1;
      window.snapshot.queue.imports.paused = 3; window.snapshot.storage.imports.complete = false; });
    await refresh.click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: zh ? "临时文件回收" : "Temporary file cleanup" })).toBeVisible();
    await expect(panel).toContainText(zh ? "已暂停 3" : "Paused 3");
    await expect(panel).toContainText(zh ? "仅已统计部分" : "counted portion only");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => {
      window.snapshot.worker.status = "alive_busy";
      window.snapshot.queue.jobs.processing = 1;
      window.snapshot.worker.execution = { state: "stalled", progress_age_seconds: 320 };
      window.snapshot.upload_cleanup = { available: true, pending_count: 2, failed_count: 1, protected_count: 3 };
    });
    await refresh.click();
    await expect(panel.getByRole("status")).toContainText(zh ? "尚未确认退出" : "exit is not confirmed");
    // Real on-demand control UI and client; no automatic writes or cross-account body reads.
    assert.equal(await page.evaluate(() => window.executionReads), 0);
    const recoveryTrigger = panel.getByRole("button", { name: zh ? "处理当前执行" : "Review current execution", exact: true });
    await recoveryTrigger.focus(); await page.keyboard.press("Enter");
    let recovery = panel.getByRole("region", { name: zh ? "执行处理" : "Execution recovery" });
    await expect(recovery).toContainText("Synthetic reader");
    const stopButton = () => recovery.getByRole("button", { name: zh ? "停止并保留来源" : "Stop and retain sources", exact: true });
    const checkResult = () => recovery.getByRole("button", { name: zh ? "核对结果" : "Check result", exact: true });
    const confirmStop = () => recovery.getByRole("button", { name: zh ? "确认停止" : "Confirm stop", exact: true });
    assert.ok((await stopButton().boundingBox()).height >= 44);
    await stopButton().click();
    await expect(confirmStop()).toBeFocused();
    await expect(recovery).toContainText(zh ? "已发出的通知不会回滚" : "sent notifications cannot be undone");
    await recovery.getByRole("button", { name: zh ? "继续等待" : "Keep waiting" }).click();
    assert.equal(await page.evaluate(() => window.executionWrites), 0);
    await page.evaluate(() => { window.executionMode = "lost"; });
    await stopButton().click(); await confirmStop().click();
    await expect(recovery.getByRole("alert")).toContainText(zh ? "结果待确认" : "unconfirmed");
    await expect(checkResult()).toBeFocused();
    await expect(stopButton()).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.executionWrites), 1);
    await page.evaluate(() => { window.executionMode = "read-failed"; });
    await checkResult().click();
    await expect(recovery.getByRole("alert")).toContainText(zh ? "核对失败" : "check failed");
    await expect(stopButton()).toHaveCount(0);
    await page.evaluate(() => { window.executionMode = "normal"; });
    await checkResult().click();
    await expect(recovery.getByRole("status")).toContainText(zh ? "尚未释放队列" : "queue is not released yet");
    assert.equal(await page.evaluate(() => window.executionWrites), 1);
    assert.deepEqual(await page.evaluate(() => window.sentIdentity), await page.evaluate(() => window.execution.identity));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(out, `runtime-recovery-${width}-${locale}-${theme}.png`) });
    await page.keyboard.press("Escape"); await expect(recovery).toHaveCount(0); await expect(recoveryTrigger).toBeFocused();
    await page.evaluate(() => { window.execution = { ...window.execution, state: "finished", canonical_status: "failed" };
      window.lastStop = structuredClone(window.execution); });
    await recoveryTrigger.click();
    await expect(recovery).toContainText(zh ? "执行已结束并完成核对" : "ended and was reconciled");
    await recovery.getByRole("button", { name: zh ? "关闭" : "Close", exact: true }).click();
    // Stale execution, uncooperative response body and retiring authentication.
    for (const mode of ["changed", "hung", "late"]) {
      await page.evaluate(mode => {
        window.executionMode = mode;
        window.execution = { ...window.execution, state: "stalled", canonical_status: "processing",
          stop_allowed: true, stop_requested_at: null, stop_recorded_at: null };
      }, mode);
      await recoveryTrigger.click(); await expect(stopButton()).toBeEnabled();
      await stopButton().click(); await confirmStop().click();
      if (mode === "hung") {
        await page.clock.fastForward(15_001);
        await expect(recovery.getByRole("alert")).toContainText(zh ? "结果待确认" : "unconfirmed");
      } else if (mode === "changed") {
        await expect(recovery.getByRole("alert")).toContainText(zh ? "没有停止新的执行" : "new execution was not stopped");
        await expect(stopButton()).toHaveCount(0);
      } else {
        await page.evaluate(() => { window.authGeneration++; dispatchEvent(new Event("chat-reader:auth-generation-changed")); window.releaseOldStop(); });
        await expect(recovery).toHaveCount(0);
        break;
      }
      await recovery.getByRole("button", { name: zh ? "关闭" : "Close", exact: true }).click();
    }
    await page.evaluate(() => { window.executionMode = "denied"; });
    await recoveryTrigger.click();
    await expect(recovery.getByRole("alert")).toContainText(zh ? "管理权限不可用" : "Administrator access is unavailable");
    await expect(recovery).not.toContainText("Synthetic reader");
    await recovery.getByRole("button", { name: zh ? "关闭" : "Close", exact: true }).click();
    await page.evaluate(() => { window.snapshot.worker.execution.state = "stopping"; });
    await refresh.click();
    await expect(panel.getByRole("status")).toContainText(zh ? "确认退出并核对结果后继续队列" : "after exit and outcome checks");
    await expect(panel).toContainText(zh ? "未完成来源受保护" : "Unfinished sources remain protected");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(out, `runtime-attention-${width}-${locale}-${theme}.png`) });
    await page.evaluate(() => { window.snapshot.worker.execution.state = "reconciling"; });
    await refresh.click();
    await expect(panel.getByRole("status")).toContainText(zh ? "核对上一项执行结果" : "Checking the previous execution");
    await page.evaluate(() => {
      window.snapshot.worker.execution = null;
      window.snapshot.worker.status = "alive_idle";
      window.snapshot.queue.jobs.processing = 0;
      window.snapshot.upload_cleanup.pending_count = 0; window.snapshot.upload_cleanup.failed_count = 0;
    });
    await refresh.click();
    await expect(panel.getByRole("status")).toHaveCount(0);
    await expect(panel).not.toContainText(zh ? "未完成来源受保护" : "Unfinished sources remain protected");
    await page.evaluate(() => { window.runtimeMode = "denied"; });
    await refresh.click(); await expect(refresh).toBeEnabled(); await expect(panel.getByRole("alert")).toBeVisible(); await expect(queue).toHaveCount(0);
    await page.evaluate(() => { window.runtimeMode = "error"; });
    await refresh.click(); await expect(refresh).toBeEnabled();
    await expect(queue).toHaveCount(0); // A transport failure cannot restore denied cached data.
    await page.evaluate(() => { window.runtimeMode = "normal"; }); await refresh.click(); await expect(queue).toBeVisible();
    // A body that ignores AbortSignal must still release the busy state.
    await page.evaluate(() => { window.runtimeMode = "hung-body"; });
    await refresh.click();
    await page.clock.fastForward(15_001);
    await expect(refresh).toBeEnabled(); await expect(panel.getByRole("alert")).toBeVisible(); await expect(queue).toBeVisible();
    await page.evaluate(() => { window.runtimeMode = "normal"; }); await refresh.click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    const before = await page.evaluate(() => window.runtimeReads);
    await page.clock.fastForward(61_000);
    assert.equal(await page.evaluate(() => window.runtimeReads), before);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    await expect.poll(() => page.evaluate(() => window.runtimeReads)).toBeGreaterThan(before);
    // Retired successful bodies cannot populate either the old or new view.
    await page.evaluate(() => { window.runtimeMode = "late"; });
    await refresh.click();
    await page.evaluate(() => {
      window.runtimeMode = "normal"; window.snapshot.queue.imports.paused = 7; window.authGeneration++;
      dispatchEvent(new Event("chat-reader:auth-generation-changed")); window.releaseOldResponse();
    });
    await expect(panel).toContainText(zh ? "已暂停 7" : "Paused 7");
    await expect(panel).not.toContainText(zh ? "已暂停 3" : "Paused 3");
    assert.equal(await page.evaluate(() => window.runtimeWrites), 0);
    results.push({ width, locale, theme, staleSnapshot: true, accessRevocation: true, hungBody: true,
      hiddenPolling: true, authenticationFence: true, quietCleanup: true, archiveScope: true,
      executionStopRecovery: true, noMutationReplay: true, staleExecutionFence: true, stopReceiptReentry: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "passed", results, errors }, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: results.length, out }));
} catch (error) {
  if (current && !current.isClosed()) await current.screenshot({ path: join(out, "failure.png") });
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "failed", error: String(error), results, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
