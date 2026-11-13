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
if (process.platform === "win32") assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const out = join(temp, "import-recovery-browser");
mkdirSync(out, { recursive: true });
const modulePath = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
import React from "react";
import {ContinuationDocument as ActualDocument} from ${modulePath("features/exporting/continuation-document.tsx")};
import {ContinuationHistory as ActualHistory} from ${modulePath("features/exporting/continuation-history.tsx")};
import {CleanupScanCancelAction as ActualScanCancel,cleanupScanLabel as actualScanLabel} from ${modulePath("features/conversations/cleanup-scan-progress.tsx")};
import {translate} from ${modulePath("lib/i18n.ts")};
import {withRequestDeadline} from ${modulePath("lib/request-deadline.ts")};
export const usePreferences=()=>{
 const [locale,setLocale]=React.useState(window.gateLocale);
 React.useEffect(()=>{const sync=()=>setLocale(window.gateLocale);window.addEventListener("synthetic-locale",sync);
 return ()=>window.removeEventListener("synthetic-locale",sync);},[]);
 return {resolvedLocale:locale};
};
export const useTranslations=()=>key=>translate(window.gateLocale,key);
export const authenticationGeneration=()=>window.authGeneration??1;
export const AUTH_GENERATION_CHANGED_EVENT="synthetic-auth";
export class ApiRequestError extends Error {constructor(message,status,path,code){super(message);Object.assign(this,{status,path,code});}}
export const useImportDialog=()=>({openImportDialog:options=>window.openedImport=options});
const request=(url,init={})=>withRequestDeadline(async signal=>{
  const response=await fetch(url,{...init,signal});
  if(!response.ok) {const body=await response.json();throw new ApiRequestError(body.detail?.code??"Synthetic response",response.status,url,body.detail?.code);}
  return response.json();
},init.signal);
export const getActiveTasks=signal=>request("/api/tasks/active",{signal});
export const getPendingCleanupScans=async()=>[];
export const getTask=(id,signal)=>request("/api/tasks/"+id,{signal});
export const getCleanupScan=(id,signal)=>request("/api/content-cleanup/scans/"+id,{signal});
export const retryTask=id=>request("/api/tasks/"+id+"/retry",{method:"POST"});
export const cancelTask=(id,signal,source_disposition)=>request("/api/tasks/"+id+"/cancel",{
  method:"POST",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({source_disposition})});
export const continuationApi={
 state:(id,signal)=>request("/api/conversations/"+id+"/continuation",{signal}),
 revisions:(id,offset=0,signal)=>request("/api/conversations/"+id+"/continuation/revisions",{signal}),
 updateFiles:(id,body)=>request("/api/conversations/"+id+"/continuation/files",{method:"PUT",body}),
 returnPackage:(id,body)=>request("/api/conversations/"+id+"/continuation/returns",{method:"POST",body}),
 returnReceipt:(id,key)=>request("/api/conversations/"+id+"/continuation/returns/by-request/"+encodeURIComponent(key)),
 member:(id,kind,revision,member)=>withRequestDeadline(async signal=>{
  const response=await fetch("/api/conversations/"+id+"/continuation/revisions/"+revision+"/members/"+member,{signal});
  if(!response.ok)throw Error("Synthetic member read");return response.text();}),
 memberBytes:(id,revision,member)=>withRequestDeadline(async signal=>{
  const response=await fetch("/api/conversations/"+id+"/continuation/revisions/"+revision+"/members/"+member,{signal});
  if(!response.ok)throw Error("Synthetic member read");return new Uint8Array(await response.arrayBuffer());}),
};
export const ContinuationDocument=props=>window.gateActualContinuation?<ActualDocument {...props}/>:<article>Retained synthetic continuation</article>;
export const ContinuationDropTarget=({children})=> <div>{children}</div>;
export const ContinuationHistory=props=>window.gateActualContinuation?<ActualHistory {...props}/>:null;
export const MarkdownRenderer=({text})=><div data-synthetic-renderer>{text}</div>;
export const ContinuationFind=({children})=><div>{children}</div>;
export const IndexReading=({text})=><div>{text}</div>;
export const useContinuationDraft=()=>{
 const original=React.useRef(null);
 return {list:{data:[],refetch:async()=>{}},status:"saved",begin:()=>{},
 retain:text=>{original.current=text;window.syntheticDraft=text;},
 discard:async()=>{window.syntheticDraft=null;original.current=null;},remove:async()=>{}};
};
export const ContentCleanupDialog=()=>null,CleanupDismissAction=()=>null;
export const CleanupScanCancelAction=ActualScanCancel,cleanupScanLabel=actualScanLabel;
export const SettingsFocusedDialog=()=>null,ExportArtifactDelivery=()=>null;
export default ({href,children,...props})=><a href={href} {...props}>{children}</a>;
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider,useQuery} from "@tanstack/react-query";
import {ImportTaskMonitor} from ${modulePath("features/import/import-task-monitor.tsx")};
import {ContinuationPanel} from ${modulePath("features/exporting/continuation-panel.tsx")};
import {CleanupScanProgress} from ${modulePath("features/conversations/cleanup-scan-progress.tsx")};
import {getCleanupScan} from "./adapters.tsx";
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
function ScanFixture(){const scan=useQuery({queryKey:["content-cleanup-scan","synthetic-scan"],
 queryFn:({signal})=>getCleanupScan("synthetic-scan",signal)});
 return <section data-cleanup-scan-id="synthetic-scan">
 <button type="button" className="btn-secondary min-h-11 px-3" data-testid="scan-task-progress">View progress</button>
 {scan.data&&<CleanupScanProgress scan={scan.data}/>}</section>}
function Fixture(){const [open,setOpen]=useState(true);const continuation=new URL(location.href).searchParams.has("continuation");
const scanning=new URL(location.href).searchParams.has("scan");
return <main style={{maxWidth:720,margin:"24px auto",padding:12}}>
 {scanning?<><button className="btn-secondary min-h-11 px-3 mb-4" onClick={()=>setOpen(!open)}>Toggle scan</button>
 {open&&<ScanFixture/>}</>:continuation?<><button className="btn-secondary min-h-11 px-3 mb-4" onClick={()=>setOpen(!open)}>Toggle continuation</button>
 {open&&<ContinuationPanel conversationId="synthetic-context-source"/>}</>:<>
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
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|import-dialog-provider|offline-access|content-cleanup-panel|cleanup-dismiss-action|cleanup-scan-progress|settings-focused-dialog|export-artifact-delivery|continuation-document|continuation-drop-target|continuation-history|use-continuation-draft|continuation-find|continuation-index|markdown-renderer|\/lib\/api|^\.\/api)$/, resource => { resource.request = adapter; }),
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
      window.gateActualContinuation = new URL(location.href).searchParams.has("actual");
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
    const supervised = { ...row("supervised", "conversation_export", "processing"),
      result: { conversation_id: "synthetic-export-source" }, execution_state: "stopping",
      stop_requested_at: now };
    const scanTask = { ...row("scan-execution", "content_noise_scan", "processing"),
      result: { scan_id: "synthetic-scan" }, execution_state: "running" };
    const scan = { id: "synthetic-scan", source: "READER", status: "SCANNING",
      scope_type: "CURRENT_CONVERSATION", background_job_id: scanTask.job_id, background_job_status: "processing",
      execution_state: "running", stop_requested_at: null, progress: 24,
      processed_messages: 1, total_messages: 4, excluded_archived_count: 0, target_count: 1,
      project_target_count: 0, unassigned_target_count: 1, occurrence_count: 1, delete_count: 0,
      keep_count: 1, protected_count: 0, created_at: now, completed_at: null, error_message: null };
    let stopMoment = now, scanReadFailed = false, legacyScan = false;
    let continuationState = { generation: 0, adopted_revision_id: null, pending_return_task_id: null };
    let continuationReadFailed = false;
    let actual = false, writeMode = "ok", packageMode = "ok", packageReceipt = null;
    let snapshots = [], packageAttempts = [];
    const applyFiles = async request => {
      const form = await new Response(request.postDataBuffer(), { headers: { "content-type": request.headers()["content-type"] } }).formData();
      if (Number(form.get("base_generation")) !== continuationState.generation) return null;
      const prior = snapshots[0]?.contents ?? {};
      const contents = { ...prior };
      for (const name of ["current", "index"]) if (form.get(name)) contents[name] = Buffer.from(await form.get(name).arrayBuffer()).toString("utf8");
      const revision = { id: `synthetic-snapshot-${continuationState.generation + 1}`, created_at: now,
        members: { current: "current" in contents, index: "index" in contents }, contents };
      snapshots = [revision, ...snapshots].slice(0, 3);
      continuationState = { generation: continuationState.generation + 1, adopted_revision_id: revision.id, pending_return_task_id: null };
      return { generation: continuationState.generation, revision_id: revision.id };
    };
    let releaseCancel, retryFailed = false, taskReads = 0;
    const cancellation = new Promise(resolve => { releaseCancel = resolve; });
    await page.route("https://import-recovery.synthetic/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/tasks/active") return route.fulfill({ json: rows });
      if (path === "/api/content-cleanup/scans/synthetic-scan") return route.fulfill(scanReadFailed
        ? { status: 503, json: {} } : { json: scan });
      if (path === "/api/content-cleanup/scans/pending") return route.fulfill({ json: [scan] });
      if (path === "/api/tasks/supervised/cancel") {
        writes.push({ path });
        supervised.execution_state = "stopping"; supervised.stop_requested_at = stopMoment;
        return route.abort("failed");
      }
      if (path === "/api/tasks/scan-execution/cancel") {
        writes.push({ path });
        if (legacyScan) {
          scanTask.status = scan.background_job_status = "cancelling";
          scanTask.execution_state = scan.execution_state = null;
          return route.abort("failed");
        }
        scanTask.execution_state = scan.execution_state = "stopping";
        scanTask.stop_requested_at = scan.stop_requested_at = stopMoment;
        return route.fulfill({ json: scanTask });
      }
      if (path === "/api/tasks/scan-execution") {
        taskReads++;
        return route.fulfill(scanReadFailed ? { status: 503, json: {} } : { json: scanTask });
      }
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
      if (path.endsWith("/continuation/revisions")) return route.fulfill(actual
        ? continuationReadFailed ? { status: 503, json: {} } : { json: snapshots }
        : { json: [] });
      if (actual && /\/continuation\/revisions\/[^/]+\/members\/(current|index)$/.test(path)) {
        const parts = path.split("/"), value = snapshots.find(row => row.id === parts.at(-3))?.contents[parts.at(-1)];
        return route.fulfill(value === undefined ? { status: 404, json: {} } : { contentType: "text/plain; charset=utf-8", body: value });
      }
      if (path.endsWith("/continuation/files")) {
        writes.push({ path, body: route.request().postData() });
        if (actual) {
          const saved = await applyFiles(route.request());
          if (!saved) return route.fulfill({ status: 409, json: { detail: { code: "CONTEXT_BASE_CHANGED" } } });
          if (writeMode === "ack-lost") return route.abort("failed");
          if (writeMode === "refresh-failed") continuationReadFailed = true;
          return route.fulfill({ json: saved });
        }
        continuationState = { generation: 1, adopted_revision_id: null, pending_return_task_id: null };
        return route.fulfill({ json: { generation: 1, revision_id: "synthetic-new-revision" } });
      }
      if (path.includes("/continuation/returns/by-request/")) return route.fulfill({ json: { task: packageReceipt } });
      if (path.endsWith("/continuation/returns")) {
        if (actual) {
          writes.push({ path });
          const form = await new Response(route.request().postDataBuffer(), { headers: { "content-type": route.request().headers()["content-type"] } }).formData();
          packageAttempts.push({ key: form.get("idempotency_key"), base: form.get("base_generation"), bytes: await form.get("file").text() });
          if (packageMode === "not-admitted") return route.abort("failed");
          packageReceipt = { task_id: "synthetic-new-return", status: "committed" };
          rows.push({ ...row(packageReceipt.task_id, "context_return", "committed"), result: {} });
          return route.fulfill({ status: 202, json: packageReceipt });
        }
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
      for (const nextLocale of [locale === "zh-CN" ? "en-US" : "zh-CN", locale]) {
        const expectedTime = await page.evaluate(({ nextLocale, value }) => {
          window.gateLocale = nextLocale; window.dispatchEvent(new Event("synthetic-locale"));
          return new Intl.DateTimeFormat(nextLocale, { dateStyle: "full", timeStyle: "medium" }).format(new Date(value));
        }, { nextLocale, value: now });
        await expect(a.locator("time")).toHaveAttribute("datetime", now);
        await expect(a.locator("time")).toHaveAttribute("title", expectedTime);
        await expect(a.locator("time")).toHaveAttribute("aria-label", `${nextLocale === "zh-CN" ? "提交于" : "Submitted"} ${expectedTime}`);
      }
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
      const beforeHide = writes.length;
      await page.evaluate(theme => {
        if (theme === "dark") Object.defineProperty(window, "localStorage", {
          configurable: true, get() { throw new DOMException("Synthetic storage disabled", "SecurityError"); },
        });
        else Storage.prototype.setItem = () => { throw new DOMException("Synthetic quota", "QuotaExceededError"); };
      }, theme);
      await cleanupRow.getByRole("button", { name: /关闭任务提示|Dismiss task/ }).focus();
      await page.keyboard.press("Enter");
      await expect(cleanupRow).toHaveCount(0);
      assert.equal(writes.length, beforeHide, "Hiding a prompt cannot cancel, retry or delete its task.");
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
      // Same production panel with actual editor/history and retained-operation
      // hook. Markdown painting and local draft persistence are explicit adapters.
      actual = true;
      snapshots = [2, 1].map(n => ({ id: `synthetic-snapshot-${n}`, created_at: now,
        members: { current: true, index: true }, contents: { current: `# Synthetic current ${n}`, index: `{"note":"Synthetic index ${n}"}` } }));
      continuationState = { generation: 2, adopted_revision_id: snapshots[0].id, pending_return_task_id: null };
      await page.goto("https://import-recovery.synthetic/conversations/synthetic-context-source?continuation=current&actual=1");
      const editor = page.getByRole("region", { name: /上下文接续|Context continuation/ });
      await expect(editor.locator("[data-synthetic-renderer]")).toHaveText("# Synthetic current 2");
      const originalWriteCount = writes.length;
      await editor.getByRole("button", { name: /^编辑$|^Edit$/ }).click();
      await editor.getByRole("textbox").fill("# Synthetic verified edit");
      writeMode = "ack-lost";
      await editor.getByRole("button", { name: /^保存$|^Save$/ }).click();
      const recovery = page.getByTestId("continuation-write-recovery");
      await expect(recovery).toContainText(locale === "zh-CN" ? "提交结果待核对" : "Submission is unconfirmed");
      await expect(editor.getByRole("textbox")).toHaveValue("# Synthetic verified edit");
      await expect(editor.getByRole("textbox")).toBeDisabled();
      await recovery.getByRole("button", { name: /^核对结果$|^Check result$/ }).click();
      await expect(recovery).toHaveCount(0);
      await expect(editor.locator("[data-synthetic-renderer]")).toHaveText("# Synthetic verified edit");
      assert.equal(writes.length, originalWriteCount + 1);
      assert.equal(continuationState.generation, 3);
      writeMode = "refresh-failed";
      await editor.getByRole("button", { name: /^编辑$|^Edit$/ }).click();
      await editor.getByRole("textbox").fill("# Synthetic confirmed despite refresh");
      await editor.getByRole("button", { name: /^保存$|^Save$/ }).click();
      await expect(editor).toContainText(locale === "zh-CN" ? "文件已保存，但" : "File saved, but");
      await expect(editor).not.toContainText(locale === "zh-CN" ? "保存失败" : "Save failed");
      continuationReadFailed = false; writeMode = "ok";
      await editor.getByRole("button", { name: /^刷新已保存文件$|^Refresh saved files$/ }).click();
      await expect(editor).not.toContainText(locale === "zh-CN" ? "文件已保存，但" : "File saved, but");
      assert.equal(writes.length, originalWriteCount + 2);
      // Restore an actual older member, then lose the PUT response.
      snapshots[1].contents.current = "\ufeff# Synthetic verified edit\r\n";
      await editor.getByRole("button", { name: /^历史$|^History$/ }).click();
      await editor.getByRole("button", { name: /^查看 current$|^View current$/ }).nth(1).click();
      writeMode = "ack-lost"; page.once("dialog", dialog => dialog.accept());
      await editor.getByRole("button", { name: /^仅恢复 Current$|^Restore Current only$/ }).click();
      await expect(recovery).toBeVisible();
      await recovery.getByRole("button", { name: /^核对结果$|^Check result$/ }).click();
      await expect(editor.locator("[data-synthetic-renderer]")).toHaveText("# Synthetic verified edit");
      assert.equal(writes.length, originalWriteCount + 3);
      assert.equal(continuationState.generation, 5);
      assert.equal(snapshots[0].contents.current, "\ufeff# Synthetic verified edit\r\n", "Restore must preserve the stored BOM and CRLF bytes");
      // Unknown package admission survives an actual panel unmount/remount.
      await editor.getByRole("button", { name: /^更新文件$|^Update files$/ }).click();
      await editor.getByText(/^(从 Context Package 更新|Update from Context Package)$/).click();
      await editor.getByLabel("Context Package (.context.zip)").setInputFiles({
        name: "synthetic.context.zip", mimeType: "application/zip", buffer: Buffer.from("Synthetic package transport"),
      });
      packageMode = "not-admitted";
      await editor.getByRole("button", { name: /^上传并更新文件$|^Upload and update files$/ }).click();
      await expect(recovery).toBeVisible();
      await page.getByRole("button", { name: "Toggle continuation" }).click();
      await page.getByRole("button", { name: "Toggle continuation" }).click();
      await expect(recovery).toBeVisible();
      await expect(editor.getByRole("button", { name: /^(下载文件|Download file)$/ })).toBeEnabled();
      await expect(editor.getByRole("button", { name: /^(编辑|Edit)$/ })).toBeDisabled();
      await editor.getByRole("button", { name: /^(原文|Source)$/ }).click();
      await expect(editor.locator("pre")).toHaveText("# Synthetic verified edit\r\n");
      await editor.getByRole("button", { name: /^(阅读|Read)$/ }).click();
      assert.equal(packageAttempts.length, 1);
      await recovery.getByRole("button", { name: /^核对结果$|^Check result$/ }).click();
      await expect(recovery.getByRole("button", { name: /按原请求重试|Retry the original request/ })).toBeVisible();
      assert.equal(packageAttempts.length, 1);
      const writeScreenshot = `context-write-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, writeScreenshot), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
      for (const bounds of await recovery.locator("button").evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(); return { width: box.width, height: box.height };
      }))) assert.ok(bounds.width >= 44 && bounds.height >= 44);
      packageMode = "ok";
      await recovery.getByRole("button", { name: /按原请求重试|Retry the original request/ }).click();
      await expect(recovery).toHaveCount(0);
      assert.equal(packageAttempts.length, 2); assert.deepEqual(packageAttempts[1], packageAttempts[0]);
      // The independent execution control does not rewrite the locked canonical
      // task to "cancelling". Re-entry must still have a read-only stop check.
      supervised.stop_requested_at = await page.evaluate(() => new Date(Date.now() - 31_000).toISOString());
      rows.push(supervised);
      await page.goto("https://import-recovery.synthetic/");
      const supervisedRow = page.locator("#task-row-supervised");
      await expect(supervisedRow).toContainText(locale === "zh-CN" ? "停止尚未确认" : "Stopping is not yet confirmed");
      await expect(supervisedRow.getByRole("button", { name: /核对状态|Check status/ })).toBeVisible();
      await expect(supervisedRow.getByRole("button", { name: /^取消任务$|^Cancel task$/ })).toHaveCount(0);
      assert.equal(supervised.status, "processing");
      supervised.execution_state = "running"; supervised.stop_requested_at = null;
      await page.goto("https://import-recovery.synthetic/");
      stopMoment = await page.evaluate(() => new Date().toISOString());
      await supervisedRow.getByRole("button", { name: /^取消任务$|^Cancel task$/ }).click();
      await expect(supervisedRow).toContainText(locale === "zh-CN" ? "操作结果尚未确认" : "The result is unconfirmed");
      const supervisedCheck = supervisedRow.getByRole("button", { name: /核对状态|Check status/ });
      await supervisedCheck.focus(); await page.keyboard.press("Enter");
      await expect(supervisedRow).not.toContainText(locale === "zh-CN" ? "操作结果尚未确认" : "The result is unconfirmed");
      assert.equal(writes.filter(item => item.path === "/api/tasks/supervised/cancel").length, 1);
      await page.clock.fastForward(30_100);
      await expect(supervisedRow.getByRole("button", { name: /核对状态|Check status/ })).toBeVisible();
      await supervisedRow.getByRole("button", { name: /核对状态|Check status/ }).click();
      assert.equal(writes.filter(item => item.path === "/api/tasks/supervised/cancel").length, 1);
      const supervisedScreenshot = `task-execution-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, supervisedScreenshot), fullPage: true });
      // Actual scan controls: acknowledge the independent stop, fail its read,
      // re-enter, then read a confirmed exit. Never offer another cancel POST.
      await page.goto("https://import-recovery.synthetic/?scan=1");
      const scanProgress = page.getByTestId("cleanup-scan-progress");
      stopMoment = await page.evaluate(() => new Date().toISOString());
      const scanCancel = scanProgress.getByRole("button", { name: /取消扫描|Cancel scan/ });
      await scanCancel.focus(); await page.keyboard.press("Enter");
      await expect(scanProgress).toContainText(locale === "zh-CN" ? "正在停止扫描" : "Stopping scan");
      await expect(scanCancel).toHaveCount(0);
      const scanCheck = scanProgress.getByRole("button", { name: /核对扫描状态|Check scan status/ });
      await expect(scanCheck).toBeVisible();
      await expect(scanCheck).toBeFocused();
      scanReadFailed = true;
      await scanCheck.click();
      await expect(scanProgress.getByRole("alert")).toContainText(locale === "zh-CN" ? "核对失败" : "The check failed");
      await expect(scanCancel).toHaveCount(0);
      await page.clock.fastForward(3_100);
      await expect(scanProgress.getByRole("alert")).toBeVisible();
      scanReadFailed = false;
      await page.getByRole("button", { name: "Toggle scan" }).click();
      await page.getByRole("button", { name: "Toggle scan" }).click();
      await expect(scanCheck).toBeVisible();
      await expect(scanCancel).toHaveCount(0);
      const scanScreenshot = `scan-execution-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, scanScreenshot), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
      for (const bounds of await scanProgress.locator("button").evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(); return { width: box.width, height: box.height };
      }))) assert.ok(bounds.width >= 44 && bounds.height >= 44);
      scanTask.status = scanTask.phase = "cancelled"; scanTask.execution_state = null; scanTask.stop_requested_at = null;
      scan.status = "CANCELLED"; scan.background_job_status = "cancelled"; scan.execution_state = null; scan.stop_requested_at = null;
      await scanCheck.click();
      await expect(scanProgress).toContainText(locale === "zh-CN" ? "扫描已取消" : "Scan cancelled");
      await expect(scanCancel).toHaveCount(0);
      assert.equal(writes.filter(item => item.path === "/api/tasks/scan-execution/cancel").length, 1);
      // Existing canonical cancelling rows have no independent control record.
      // A lost response's check disappears after GET confirmation, so focus
      // must return to the surviving row action, not a removed/disabled node.
      legacyScan = true;
      scanTask.status = scan.background_job_status = "processing";
      scan.status = "SCANNING";
      scanTask.execution_state = scan.execution_state = null;
      await page.goto("https://import-recovery.synthetic/?scan=1");
      await scanCancel.focus(); await page.keyboard.press("Enter");
      await expect(scanCheck).toBeVisible();
      scanReadFailed = true;
      await scanCheck.click();
      await expect(scanProgress.getByRole("alert")).toContainText(locale === "zh-CN" ? "核对失败" : "The check failed");
      scanReadFailed = false;
      await scanCheck.focus(); await page.keyboard.press("Enter");
      await expect(scanCheck).toHaveCount(0);
      await expect(page.getByTestId("scan-task-progress")).toBeFocused();
      assert.equal(writes.filter(item => item.path === "/api/tasks/scan-execution/cancel").length, 2);
      results.push({ width, locale, theme, writes: writes.length, taskReads, geometry, screenshot: filename,
        taskDismissStorageRejection:theme==="light"?"setItem":"getter",
        sourceCleanup: "cancelled → explicit cleanup retry → unknown response → read-only confirmation",
        contextRecovery: "expired/conflict/missing target never requeue; transient retry once; explicit reselection then save",
        contextRead: "failed navigation retains the old document; read-only retry works; confirmed save supersedes old failure; success clears after 3s, failure does not",
        contextScreenshot, writeScreenshot, supervisedScreenshot, scanScreenshot,
        supervisedStop: "processing + independent stopping → re-entry/read-only check; lost acknowledgement → stop confirmed by GET without another POST",
        scanStop: "independent stop → check only → failed read → re-entry → confirmed cancellation; legacy lost response → failed GET → cancelling confirmed → surviving row focus; one POST per original stop",
        continuationWrites: "actual editor and historical restore lost acknowledgement → byte check, no second PUT; acknowledged PUT + failed refresh → read-only retry; package unknown survives panel remount → absent receipt → explicit same-key/base/source retry" });
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
    scope: "Production Task Center + CleanupScanProgress/cancel controls + ContinuationPanel/editor/history/recovery hook + React Query; synthetic network/account/Reader route, Markdown-paint and local-draft-storage adapters; actual persisted draft guards are separate tests",
    results, errors,
  }, null, 2));
  console.log(`Task recovery browser: ${results.length} passed; ${out}`);
} finally { await browser.close(); }
