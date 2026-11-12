// Actual ImportPanel/React Query with synthetic transport, account and secondary
// surfaces. No application service, real import or canonical write is used.
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
const out = join(temp, "import-source-repair-browser");
mkdirSync(out, { recursive: true });
const modulePath = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.tsx"), `
import React from "react";
import {sendUpload} from ${modulePath("lib/upload-transport.ts")};
export const usePreferences=()=>({resolvedLocale:window.gateLocale,readerWidthMode:"standard",sectionTocMode:"visible"});
export const authenticationGeneration=()=>window.authGeneration??1;
export const AUTH_GENERATION_CHANGED_EVENT="synthetic-auth-change";
export const getActiveOfflineStorageContext=()=>({userId:"synthetic-owner"});
export const useRouter=()=>({push:path=>window.navigationAttempt=path});
export const readAccountCapabilities=async()=>({allow_user_import:true,maximum_import_size_mb:500,maximum_import_total_mb:512});
export const getProjects=async()=>[];
export const getUnfinishedImports=async()=>({items:[],has_more:false});
export class ApiRequestError extends Error{constructor(message,status){super(message);this.name="ApiRequestError";this.status=status}}
async function request(url,init={}){
 const response=await fetch(url,init);
 if(!response.ok)throw new ApiRequestError("Synthetic response",response.status);
 return response.json();
}
export const getAdaptiveImportSession=(id,signal)=>request("/api/adaptive-import/sessions/"+id,{signal});
export const replaceAdaptiveImportArtifact=(id,artifact,file,revision)=>{
 const body=new FormData();body.append("file",file);body.append("expected_updated_at",revision);
 return request("/api/adaptive-import/sessions/"+id+"/artifacts/"+artifact,{method:"PUT",body});
};
export const excludeAdaptiveImportSource=(id,artifact,revision)=>request("/api/adaptive-import/sessions/"+id+"/artifacts/"+artifact,
 {method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_updated_at:revision})});
export const createAdaptiveImportSession=async(files,profile,project,options)=>{
 const body=new FormData();files.forEach(file=>body.append("files",file));
 if(profile)body.append("repair_profile_id",profile);if(project)body.append("target_project_id",project);
 const response=await sendUpload("/api/adaptive-import/sessions",body,{headers:{"Idempotency-Key":options.requestId},signal:options.signal,onProgress:options.onProgress});
 if(!response.ok)throw new ApiRequestError("Synthetic response",response.status);
 return response.json();
};
export const getAdaptiveUploadReceipt=key=>request("/api/adaptive-import/requests/"+key);
const forbidden=()=>{throw Error("Unexpected mutation or secondary workflow")};
export const commitImport=id=>request("/api/imports/"+id+"/commit",{method:"POST"});
export const getImportStatus=(id,signal)=>request("/api/imports/"+id+"/status",{signal});
export const retryTask=id=>request("/api/tasks/"+id+"/retry",{method:"POST"});
export const previewImport=files=>{const body=new FormData();files.forEach(file=>body.append("files",file));return request("/api/imports/preview",{method:"POST",body})};
export const cancelAdaptiveImportSession=forbidden,cancelTask=forbidden,
resumeAdaptiveImportSession=forbidden,updateAdaptiveImportDestination=forbidden;
export const AdaptiveImportWorkspace=({onImport,importing,onRetryImport,retryingImport,statusError,onRetryStatus,statusRetrying})=><>
 <button data-testid="commit-import-button" disabled={importing} onClick={onImport}>Synthetic confirm</button>
 {onRetryImport&&<button data-testid="canonical-retry" disabled={retryingImport} onClick={onRetryImport}>Synthetic retry original task</button>}
 {statusError&&<button data-testid="canonical-read-retry" disabled={statusRetrying} onClick={onRetryStatus}>Synthetic read original result</button>}
</>;
export const SupportLimitAction=()=>null,ImportPreviewCard=()=>null,
FormatConversionGuide=()=>null,ImportNoiseReview=()=>null;
export default ({href,children,...props})=><a href={href} {...props}>{children}</a>;
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ImportPanel} from ${modulePath("features/import/import-panel.tsx")};
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:15000},mutations:{retry:false}}});
function Fixture(){const[open,setOpen]=useState(true);return <main style={{maxWidth:720,margin:"24px auto",padding:12}}>
 <button className="btn-secondary min-h-11 px-3 mb-4" onClick={()=>setOpen(!open)}>Toggle import</button>
 {open&&<ImportPanel initialMode={location.search.includes("archive")?"archive":"adaptive"}
 resumeImportId={location.search.includes("selection")?undefined:"synthetic-import"}/>}
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
      "react-dom/client$": require.resolve("react-dom/client"), "next/link$": adapter, "next/navigation$": adapter },
  },
  plugins: [
    new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|auth-client|offline-access|offline-db|support-limit-action|import-preview-card|adaptive-import-workspace|format-conversion-guide|import-noise-review|\/lib\/api)$/, resource => { resource.request = adapter; }),
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
      if (location.search.includes("storage-failure")) {
        if (theme === "dark") Object.defineProperty(window, "sessionStorage", {
          configurable: true, get() { throw new DOMException("Synthetic storage disabled", "SecurityError"); },
        });
        else Storage.prototype.removeItem = () => { throw new DOMException("Synthetic cleanup denied", "SecurityError"); };
      }
    }, { locale, theme });
    const session = { import_id: "synthetic-import", analysis_task_id: "old-analysis", updated_at: "2026-11-10T00:00:00Z",
      state: theme === "light" ? "FAILED" : "PAUSED", phase: theme === "light" ? "analysis_failed" : "paused",
      file_count: 2, total_bytes: 200, progress: 0, groups: [], families: [], warnings: [], analysis_summary: {},
      sources: ["synthetic-report-with-a-long-file-name.zip", "synthetic-notes.json"].map((filename, index) =>
        ({ artifact_id: "source-" + index, filename, byte_size: 100, extension: index ? ".json" : ".zip", source_revision: 0 })),
      can_import: false, source_status: "available" };
    const writes = []; let reads = 0, lateReplacement = null;
    await page.route("https://source-repair.synthetic/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (["PUT", "DELETE"].includes(route.request().method())) {
        writes.push({ path, body: route.request().postData(), method: route.request().method() });
        if (lateReplacement) return route.fulfill({ json: await lateReplacement });
        return route.abort("failed");
      }
      if (path.startsWith("/api/adaptive-import/sessions/")) { reads++; return route.fulfill({ json: session }); }
      return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
        body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : html });
    });
    try {
      await page.goto("https://source-repair.synthetic/");
      await page.bringToFront();
      const pane = page.getByTestId("import-analysis-status"), input = pane.locator('input[type="file"]').first();
      await expect(input).toBeEnabled();
      await page.evaluate(() => {
        window.chooserEvents = [];
        for (const type of ["keydown", "keyup", "click", "focusin", "focusout"]) document.addEventListener(type, event => {
          if (window.chooserEvents.length < 30) window.chooserEvents.push({
            type, key: event.key, target: event.target.tagName, inputType: event.target.type,
            focused: document.hasFocus(), disabled: event.target.disabled,
          });
        }, true);
      });
      await input.focus(); await expect(input).toBeFocused();
      const chooserOpened = page.waitForEvent("filechooser");
      if (width === 375) await pane.locator('label:has(input[type="file"])').first().tap();
      else await input.press("Enter");
      const chooser = await chooserOpened;
      await chooser.setFiles({ name: "replacement.json", mimeType: "application/json", buffer: Buffer.from('{"synthetic":true}') });
      const unknown = locale === "zh-CN" ? "替换结果尚未确认" : "The replacement result is unconfirmed";
      await expect(pane).toContainText(unknown);
      await expect(input).toBeDisabled();
      assert.equal(writes.length, 1);
      assert.ok(writes[0].path.endsWith("/source-0"));
      assert.match(writes[0].body, /expected_updated_at/);
      assert.match(writes[0].body, /2026-11-10T00:00:00Z/);
      await page.getByRole("button", { name: "Toggle import" }).click();
      await page.getByRole("button", { name: "Toggle import" }).click();
      await expect(pane).toContainText(unknown);
      await expect(pane.locator('input[type="file"]').first()).toBeDisabled();
      const check = pane.getByRole("button", { name: /核对状态|Check status/ });
      await check.focus(); await page.keyboard.press("Enter");
      await expect(pane).toContainText(unknown);
      assert.equal(writes.length, 1);
      const geometry = await pane.evaluate(node => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        actions: [...node.querySelectorAll('button,label:has(input[type="file"])')].map(el => {
          const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right };
        }),
      }));
      assert.ok(geometry.overflow <= 1);
      assert.ok(geometry.actions.every(action => action.width >= 44 && action.height >= 44 && action.left >= 0 && action.right <= width));
      const filename = `source-repair-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, filename), fullPage: true });
      session.state = "ANALYZING"; session.phase = "analyzing"; session.analysis_task_id = "new-analysis";
      session.analysis_progress = { stage: "validation", unit_index: 2, unit_total: 2, completed: false };
      await check.click();
      await expect(pane).toContainText(locale === "zh-CN" ? "验证内容" : "Validating content");
      await expect(pane.locator('input[type="file"]')).toHaveCount(0);
      assert.equal(writes.length, 1);
      // Whole-source exclusion is explicit, versioned, and recoverable after
      // a lost response. The real backend tests prove the transaction/security
      // boundary; this mounted fixture proves presentation and request ownership.
      session.state = "PAUSED"; session.phase = "paused"; session.updated_at = "2026-11-10T00:01:00Z";
      await page.getByRole("button", { name: "Toggle import" }).click();
      await page.getByRole("button", { name: "Toggle import" }).click();
      const exclude = pane.getByRole("button", { name: /移出本次导入：|Exclude from this import:/ }).first();
      await exclude.click();
      assert.equal(writes.length, 1);
      const confirm = pane.getByRole("button", { name: /确认移出|Confirm exclusion/ });
      await confirm.focus(); await page.keyboard.press("Enter");
      const excludeUnknown = locale === "zh-CN" ? "移出结果尚未确认" : "The exclusion result is unconfirmed";
      await expect(pane).toContainText(excludeUnknown);
      assert.equal(writes.length, 2);
      assert.equal(writes[1].method, "DELETE");
      assert.deepEqual(JSON.parse(writes[1].body), { expected_updated_at: session.updated_at });
      await page.getByRole("button", { name: "Toggle import" }).click();
      await page.getByRole("button", { name: "Toggle import" }).click();
      await expect(pane).toContainText(excludeUnknown);
      await expect(pane.locator('input[type="file"]').first()).toBeDisabled();
      const exclusionScreenshot = `source-exclusion-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, exclusionScreenshot), fullPage: true });
      // A legacy synchronous operation keeps the job ID: absence of the exact
      // excluded identity is also sufficient for a fresh read to release locks.
      session.sources = session.sources.slice(1); session.file_count = 1;
      await pane.getByRole("button", { name: /核对状态|Check status/ }).click();
      await expect(pane).not.toContainText(excludeUnknown);
      await expect(pane.locator('input[type="file"]')).toBeEnabled();
      await expect(pane.getByRole("button", { name: /移出本次导入：|Exclude from this import:/ })).toHaveCount(0);
      await pane.locator('input[type="file"]').setInputFiles({
        name: "replacement.json", mimeType: "application/json", buffer: Buffer.from('{"synthetic":true}'),
      });
      await expect(pane).toContainText(unknown);
      session.sources[0].source_revision++;
      await pane.getByRole("button", { name: /核对状态|Check status/ }).click();
      await expect(pane).not.toContainText(unknown);
      await expect(pane.locator('input[type="file"]')).toBeEnabled();
      assert.equal(writes.length, 3);
      let acknowledge;
      lateReplacement = new Promise(resolve => { acknowledge = resolve; });
      await pane.locator('input[type="file"]').setInputFiles({
        name: "late-replacement.json", mimeType: "application/json", buffer: Buffer.from('{"synthetic":true}'),
      });
      await expect(pane).toContainText(locale === "zh-CN" ? "正在上传替换来源" : "Uploading replacement source");
      await page.getByRole("button", { name: "Toggle import" }).click();
      await page.getByRole("button", { name: "Toggle import" }).click();
      await expect(pane).toContainText(unknown);
      // No polling read happens here: the acknowledged response must reach
      // the new pane through the existing, account-scoped query cache.
      const acknowledged = { ...session, updated_at: "2026-11-10T00:02:00Z",
        sources: [{ ...session.sources[0], filename: "late-replacement.json", source_revision: 2 }] };
      acknowledge(acknowledged);
      await expect(pane).toContainText("late-replacement.json");
      await expect(pane).not.toContainText(unknown);
      await expect(pane.locator('input[type="file"]')).toBeEnabled();
      assert.equal(writes.length, 4);
      // Independent entry: no private input, and no real upload or app service.
      const selectionWrites = [];
      let releaseUpload;
      const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
      await page.unroute("https://source-repair.synthetic/**");
      await page.route("https://source-repair.synthetic/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() === "POST") {
          selectionWrites.push(route.request().postData());
          await uploadGate;
          return route.fulfill({ json: { ...session, state: "ANALYZING", phase: "queued", analysis_task_id: "selection-analysis" } });
        }
        if (path.startsWith("/api/")) return route.fulfill({ json: { ...session, state: "ANALYZING", phase: "queued", analysis_task_id: "selection-analysis" } });
        return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
          body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : html });
      });
      await page.goto("https://source-repair.synthetic/?selection");
      const selectInput = page.getByTestId("import-file-input");
      const selected = page.getByTestId("import-selected-files");
      const sourceChoice = page.getByRole("group", { name: locale === "zh-CN" ? "导入来源" : "Import source", exact: true });
      await expect(sourceChoice.getByRole("button", { name: locale === "zh-CN" ? "选择文件" : "Choose files", exact: true })).toBeVisible();
      await sourceChoice.getByRole("button", { name: locale === "zh-CN" ? "粘贴文本" : "Paste text", exact: true }).click();
      await expect(page.getByTestId("pasted-transcript-input")).toHaveAttribute("placeholder",
        locale === "zh-CN" ? "在此处粘贴文本；点击“分析并继续”后才会上传。" : "Paste text here. It is uploaded only after you choose Analyze & continue.");
      assert.equal(selectionWrites.length, 0);
      await sourceChoice.getByRole("button", { name: locale === "zh-CN" ? "选择文件" : "Choose files", exact: true }).click();
      const selectedFiles = names => names.map((name, index) => ({ name, mimeType: "application/json", buffer: Buffer.from(`{"synthetic":${index}}`) }));
      await selectInput.setInputFiles(selectedFiles(["02.json", "invalid.exe", "01.json"]));
      await expect(page.getByTestId("preview-import-button")).toBeDisabled();
      await expect(selected.getByRole("alert")).toHaveCount(1);
      await expect(selected.getByRole("alert")).toBeVisible();
      await selected.getByRole("button", { name: /(?:移除文件：|Remove file: )invalid.exe/ }).focus();
      await page.keyboard.press("Enter");
      await expect(selected.getByRole("button", { name: /(?:移除文件：|Remove file: )01.json/ })).toBeFocused();
      await expect(page.getByTestId("preview-import-button")).toBeEnabled();
      await expect(selected.getByRole("alert")).toHaveCount(0);
      await selectInput.setInputFiles(selectedFiles(["01.json"])); // Same name ≠ same source.
      await expect(selected.locator('input[type="file"]')).toHaveCount(3);
      await selected.locator('input[type="file"]').first().setInputFiles(selectedFiles(["replacement.json"]));
      const names = await selected.locator('li input[type="file"]').evaluateAll(inputs => inputs.map(input => input.getAttribute("aria-label")));
      assert.deepEqual(names.map(name => name.split(/：|: /).at(-1)), ["replacement.json", "01.json", "01.json"]);
      const selectionGeometry = await selected.evaluate(node => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        actions: [...node.querySelectorAll('button,label')].map(el => {
          const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right };
        }),
      }));
      assert.ok(selectionGeometry.overflow <= 1);
      assert.ok(selectionGeometry.actions.every(action => action.width >= 44 && action.height >= 44 && action.left >= 0 && action.right <= width));
      const selectionScreenshot = `source-selection-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, selectionScreenshot), fullPage: true });
      assert.equal(selectionWrites.length, 0);
      await page.getByTestId("preview-import-button").click();
      await expect(selectInput).toBeDisabled();
      await expect(selected.getByRole("button").first()).toBeDisabled();
      await expect(page.getByRole("button", { name: /粘贴文本|Paste text/, exact: true })).toBeDisabled();
      assert.equal(selectionWrites.length, 1);
      assert.deepEqual([...selectionWrites[0].matchAll(/filename="([^"]+)"/g)].map(match => match[1]), ["replacement.json", "01.json", "01.json"]);
      // Playwright holds the network request before upload completion events;
      // this proves the in-flight UI, not real server receipt or wire progress.
      await expect(page.getByTestId("import-upload-status")).toContainText(locale === "zh-CN" ? "正在上传文件" : "Uploading files");
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      await expect(page.getByTestId("import-upload-status")).toBeVisible();
      await expect(selected.locator('input[type="file"]')).toHaveCount(3);
      assert.equal(selectionWrites.length, 1, "Reopening an in-flight upload must not repeat POST");
      releaseUpload();
      await expect(page.getByTestId("import-analysis-status")).toBeVisible();
      // Unknown admission uses the real retained hook and upload transport.
      // A server receipt and its failing follow-up read are separate states.
      await page.unroute("https://source-repair.synthetic/**");
      let initialPosts = 0, receiptReads = 0, initialReads = 0, receiptFound = false, viewFails = true, viewMissing = false;
      const initialKeys = [], initialBodies = [];
      await page.route("https://source-repair.synthetic/**", route => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/adaptive-import/sessions" && route.request().method() === "POST") {
          initialPosts++; initialKeys.push(route.request().headers()["idempotency-key"]);
          initialBodies.push(route.request().postData());
          return route.abort("failed");
        }
        if (path.startsWith("/api/adaptive-import/requests/")) {
          receiptReads++;
          return route.fulfill({ json: { receipt: receiptFound ? {
            import_id: "synthetic-import", task_id: "selection-analysis", status: "queued",
          } : null } });
        }
        if (path.startsWith("/api/adaptive-import/sessions/")) {
          initialReads++;
          return route.fulfill(viewMissing ? { status: 404, json: { detail: "synthetic import unavailable" } }
            : viewFails ? { status: 503, json: { detail: "synthetic read unavailable" } } : {
            json: { ...session, state: "ANALYZING", phase: "queued", analysis_task_id: "selection-analysis" },
          });
        }
        return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
          body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : html });
      });
      await page.goto("https://source-repair.synthetic/?selection");
      await page.getByTestId("import-file-input").setInputFiles(selectedFiles(["02.json", "01.json"]));
      await page.getByTestId("preview-import-button").click();
      const uploadCheck = page.getByRole("button", { name: locale === "zh-CN" ? "核对上传结果" : "Check upload receipt", exact: true });
      await expect(uploadCheck).toBeVisible();
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      await expect(uploadCheck).toBeVisible(); await expect(page.getByTestId("preview-import-button")).toBeDisabled();
      assert.equal(initialPosts, 1);
      await page.getByRole("button", { name: locale === "zh-CN" ? "保留待核对，处理其他文件" : "Keep pending; work on other files", exact: true }).click();
      await expect(page.getByTestId("import-file-input")).toBeEnabled();
      await expect(uploadCheck).toHaveCount(0);
      await page.locator("summary").filter({ hasText: locale === "zh-CN" ? "待核对上传" : "Unconfirmed uploads" }).click();
      await page.getByRole("button", { name: locale === "zh-CN" ? "继续核对" : "Resume checking", exact: true }).click();
      await expect(uploadCheck).toBeVisible();
      assert.equal(initialPosts, 1);
      await uploadCheck.click();
      const retryUpload = page.getByRole("button", { name: locale === "zh-CN" ? "重试原上传" : "Retry original upload", exact: true });
      await expect(retryUpload).toBeVisible();
      assert.equal(initialPosts, 1);
      const uploadScreenshot = `upload-recovery-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, uploadScreenshot), fullPage: true });
      await retryUpload.click(); await expect(uploadCheck).toBeVisible();
      assert.equal(initialPosts, 2); assert.equal(initialKeys[0], initialKeys[1]);
      assert.match(initialKeys[0], /^[a-f0-9-]{36}$/);
      for (const body of initialBodies) assert.deepEqual([...body.matchAll(/filename="([^"]+)"/g)].map(match => match[1]), ["02.json", "01.json"]);
      receiptFound = true;
      await uploadCheck.click();
      const reopenUpload = page.getByRole("button", { name: locale === "zh-CN" ? "打开原导入" : "Open original import", exact: true });
      await expect(page.getByTestId("import-upload-recovery").getByRole("alert")).toBeVisible();
      await expect(reopenUpload).toBeVisible(); await expect(retryUpload).toHaveCount(0);
      assert.equal(initialPosts, 2); assert.equal(receiptReads, 2); assert.equal(initialReads, 1);
      viewFails = false; await reopenUpload.click();
      await expect(page.getByTestId("import-analysis-status")).toBeVisible();
      assert.equal(initialPosts, 2); assert.equal(receiptReads, 2);
      // Separate admission: a known import that is no longer available must
      // not strand the whole picker, or reupload merely to refresh a view.
      viewMissing = true;
      await page.goto("https://source-repair.synthetic/?selection");
      await page.getByTestId("import-file-input").setInputFiles(selectedFiles(["unavailable.json"]));
      await page.getByTestId("preview-import-button").click();
      await expect(uploadCheck).toBeVisible(); await uploadCheck.click();
      await expect(page.getByTestId("import-upload-recovery")).toContainText(
        locale === "zh-CN" ? "原导入当前不可用" : "original import is no longer available");
      await expect(reopenUpload).toHaveCount(0);
      await expect(page.getByTestId("import-selected-files")).toHaveCount(0);
      assert.equal(initialPosts, 3); assert.equal(receiptReads, 3);
      const endCheck = page.getByTestId("import-upload-end-check");
      await endCheck.locator("summary").click();
      await expect(endCheck).toContainText(locale === "zh-CN" ? "不会停止后台任务或删除服务器文件" : "does not stop background work or delete server files");
      assert.equal(initialPosts, 3); // Expanding the explanation is not consent.
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      const unavailableReads = initialReads;
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      await expect(endCheck).toBeVisible(); await expect(endCheck).not.toHaveAttribute("open", "");
      assert.equal(initialReads, unavailableReads, "Reopening does not loop on a known missing import");
      await endCheck.locator("summary").click();
      await endCheck.getByRole("button", { name: locale === "zh-CN" ? "确认结束本页核对" : "Confirm ending this page's check", exact: true }).click();
      await expect(page.getByTestId("import-upload-recovery")).toHaveCount(0);
      await expect(page.getByTestId("import-file-input")).toBeEnabled();
      await expect(page.getByTestId("import-file-input")).toBeFocused();
      assert.equal(initialPosts, 3); assert.equal(receiptReads, 3);
      await page.unroute("https://source-repair.synthetic/**");
      let pastePosts = 0, pasteReads = 0;
      const pasteKeys = [], pasteBodies = [];
      const originalPaste = "# Synthetic pasted input\n\nUser: Please keep this editable.";
      const correctedPaste = "# Synthetic corrected input\n\nUser: A shorter editable message.";
      await page.route("https://source-repair.synthetic/**", route => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/adaptive-import/sessions" && route.request().method() === "POST") {
          pastePosts++; pasteKeys.push(route.request().headers()["idempotency-key"]);
          pasteBodies.push(route.request().postData());
          if (pastePosts === 1) return route.fulfill({ status: 413, json: { detail: "Synthetic explicit rejection" } });
          if (pastePosts === 2) return route.abort("failed");
          return route.fulfill({ json: { ...session, state: "ANALYZING", phase: "queued", analysis_task_id: "paste-analysis" } });
        }
        if (path.startsWith("/api/adaptive-import/requests/")) {
          pasteReads++; return route.fulfill({ json: { receipt: null } });
        }
        if (path.startsWith("/api/")) return route.fulfill({
          json: { ...session, state: "ANALYZING", phase: "queued", analysis_task_id: "paste-analysis" },
        });
        return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
          body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : html });
      });
      await page.goto("https://source-repair.synthetic/?selection");
      await page.getByRole("button", { name: locale === "zh-CN" ? "粘贴文本" : "Paste text", exact: true }).click();
      const pasteInput = page.getByTestId("pasted-transcript-input");
      await pasteInput.fill(originalPaste);
      await page.getByTestId("preview-import-button").click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("alert")).toContainText(locale === "zh-CN"
        ? "所选文件超过当前导入限制，请分批导入。" : "The selected files exceed the current import limit. Import them in smaller batches.");
      await expect(pasteInput).toHaveValue(originalPaste); await expect(pasteInput).toHaveJSProperty("readOnly", false);
      assert.equal(pastePosts, 1);
      const pasteScreenshot = `paste-recovery-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, pasteScreenshot), fullPage: true });
      await pasteInput.fill(correctedPaste);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.getByTestId("preview-import-button").click();
      await expect(uploadCheck).toBeVisible(); await expect(pasteInput).toHaveJSProperty("readOnly", true);
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      await page.getByRole("button", { name: "Toggle import", exact: true }).click();
      await expect(pasteInput).toHaveValue(correctedPaste); await expect(pasteInput).toHaveJSProperty("readOnly", true);
      await pasteInput.focus(); await page.keyboard.press("ControlOrMeta+A");
      assert.deepEqual(await pasteInput.evaluate(input => [input.selectionStart, input.selectionEnd]), [0, correctedPaste.length],
        "Uncertain input is still focusable and selectable for copying.");
      assert.equal(pastePosts, 2); assert.notEqual(pasteKeys[0], pasteKeys[1]);
      await uploadCheck.click(); await expect(retryUpload).toBeVisible();
      assert.equal(pastePosts, 2); assert.equal(pasteReads, 1);
      await retryUpload.click(); await expect(page.getByTestId("import-analysis-status")).toBeVisible();
      assert.equal(pastePosts, 3); assert.equal(pasteKeys[1], pasteKeys[2]);
      assert.ok(pasteBodies[0].includes(originalPaste));
      assert.ok(pasteBodies[1].includes(correctedPaste)); assert.ok(pasteBodies[2].includes(correctedPaste));
      await page.unroute("https://source-repair.synthetic/**");
      let commitPosts=0,commitReads=0;
      await page.route("https://source-repair.synthetic/**",route=>{
        const path=new URL(route.request().url()).pathname;
        if(path.endsWith("/commit")){commitPosts++;return route.abort("failed");}
        if(path.endsWith("/status")){
          commitReads++;
          return route.fulfill({json:{import_id:"synthetic-import",status:"committed",conversation_ids:["synthetic-result"],
            conversation_count:1,message_count:2,warnings:[]}});
        }
        if(path.startsWith("/api/"))return route.fulfill({json:{...session,state:"READY",phase:"ready",can_import:true}});
        return route.fulfill({contentType:path==="/bundle.js"?"text/javascript":path==="/style.css"?"text/css":"text/html",
          body:path==="/bundle.js"?bundle:path==="/style.css"?styles.css:html});
      });
      await page.goto("https://source-repair.synthetic/");
      const commitButton=page.getByTestId("commit-import-button");
      await expect(commitButton).toBeEnabled();await commitButton.click();
      const checkCommit=page.getByRole("button",{name:locale==="zh-CN"?"核对导入结果":"Check import result",exact:true});
      await expect(checkCommit).toBeVisible();await expect(commitButton).toBeDisabled();
      await page.getByRole("button",{name:"Toggle import",exact:true}).click();
      await page.getByRole("button",{name:"Toggle import",exact:true}).click();
      await expect(checkCommit).toBeVisible();await expect(commitButton).toBeDisabled();
      assert.equal(commitPosts,1);
      await checkCommit.click();await expect(page.getByTestId("import-completion-summary")).toBeVisible();
      assert.equal(commitReads,1);assert.equal(commitPosts,1);
      // The real QueryClient uses the production freshness window. A failed
      // canonical attempt must not be reused immediately after same-ID retry.
      // Secondary workspace buttons are explicit adapters, not full-site UI.
      await page.unroute("https://source-repair.synthetic/**");
      let canonicalPosts=0,canonicalRetries=0,canonicalReads=0;
      await page.route("https://source-repair.synthetic/**",route=>{
        const path=new URL(route.request().url()).pathname;
        const result={import_id:"synthetic-import",status:"queued",phase:"queued",conversation_ids:[],
          conversation_count:0,message_count:0,warnings:[]};
        if(path.endsWith("/commit")){canonicalPosts++;return route.fulfill({json:result});}
        if(path.endsWith("/retry")){canonicalRetries++;return route.fulfill({json:{job_id:"synthetic-import",status:"queued"}});}
        if(path.endsWith("/status")){
          canonicalReads++;
          if(canonicalReads===1)return route.fulfill({json:{...result,status:theme==="light"?"failed":"cancelled"}});
          if(canonicalReads===2)return route.fulfill({status:503,json:{detail:"Synthetic current read interruption"}});
          return route.fulfill({json:{...result,status:"committed",conversation_ids:["synthetic-result"],conversation_count:1}});
        }
        if(path.startsWith("/api/"))return route.fulfill({json:{...session,state:"READY",phase:"ready",can_import:true}});
        return route.fulfill({contentType:path==="/bundle.js"?"text/javascript":path==="/style.css"?"text/css":"text/html",
          body:path==="/bundle.js"?bundle:path==="/style.css"?styles.css:html});
      });
      await page.goto("https://source-repair.synthetic/");
      await page.getByTestId("commit-import-button").click();
      await expect(page.getByTestId("canonical-retry")).toBeVisible();
      assert.equal(canonicalReads,1);
      await page.getByTestId("canonical-retry").focus();await page.keyboard.press("Enter");
      await expect(page.getByTestId("canonical-read-retry")).toBeVisible();
      await expect(page.getByTestId("canonical-retry")).toHaveCount(0);
      await expect(page.getByTestId("commit-import-button")).toBeDisabled();
      assert.equal(canonicalReads,2);assert.equal(canonicalRetries,1);assert.equal(canonicalPosts,1);
      const canonicalScreenshot=`canonical-read-recovery-${width}-${locale}-${theme}.png`;
      await page.screenshot({path:join(out,canonicalScreenshot),fullPage:true});
      await page.getByTestId("canonical-read-retry").focus();await page.keyboard.press("Enter");
      await expect(page.getByTestId("import-completion-summary")).toBeVisible();
      assert.equal(canonicalReads,3);assert.equal(canonicalRetries,1);assert.equal(canonicalPosts,1);
      // The archive path renders the actual Panel buttons and ErrorLine, not
      // the secondary workspace adapter, for touch/layout review.
      await page.unroute("https://source-repair.synthetic/**");
      let archivePreviews=0,archivePosts=0,archiveReads=0;
      await page.route("https://source-repair.synthetic/**",route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==="/api/imports/preview"){
          archivePreviews++;return route.fulfill({json:{import_id:"synthetic-archive",can_commit:true}});
        }
        const result={import_id:"synthetic-archive",status:"queued",phase:"queued",conversation_ids:[],
          conversation_count:0,message_count:0,warnings:[]};
        if(path.endsWith("/commit")){archivePosts++;return route.fulfill({json:result});}
        if(path.endsWith("/status")){
          archiveReads++;
          return route.fulfill(archiveReads===1?{status:503,json:{detail:"Synthetic read interruption"}}:
            {json:{...result,status:"committed",conversation_ids:["synthetic-result"],conversation_count:1}});
        }
        return route.fulfill({contentType:path==="/bundle.js"?"text/javascript":path==="/style.css"?"text/css":"text/html",
          body:path==="/bundle.js"?bundle:path==="/style.css"?styles.css:html});
      });
      await page.goto("https://source-repair.synthetic/?selection&archive&storage-failure");
      await page.getByTestId("import-file-input").setInputFiles({name:"synthetic-restoration.cr",
        mimeType:"application/octet-stream",buffer:Buffer.from("Synthetic transport only; not a valid archive.")});
      await page.getByTestId("preview-import-button").click();
      const archiveRestore=page.getByTestId("commit-import-button");
      await expect(archiveRestore).toBeEnabled();await archiveRestore.click();
      await expect(archiveRestore).toBeDisabled();
      await expect(archiveRestore).toHaveText(locale==="zh-CN"?"进度待核对":"Progress unconfirmed");
      await expect(page.getByTestId("preview-import-button")).toHaveCount(0);
      await expect(page.getByRole("button",{name:locale==="zh-CN"?"进度待核对":"Progress unconfirmed",exact:true})).toHaveCount(1);
      const archiveRetry=page.getByRole("alert").getByRole("button",{name:locale==="zh-CN"?"重试":"Retry",exact:true});
      await expect(archiveRetry).toBeVisible();await expect(archiveRetry).toBeEnabled();
      const archiveGeometry=await archiveRetry.evaluate(el=>{const r=el.getBoundingClientRect();return{
        width:r.width,height:r.height,left:r.left,right:r.right,overflow:document.documentElement.scrollWidth-innerWidth}});
      assert.ok(archiveGeometry.width>=44&&archiveGeometry.height>=44&&archiveGeometry.left>=0&&archiveGeometry.right<=width&&archiveGeometry.overflow<=1);
      const archiveScreenshot=`archive-read-recovery-${width}-${locale}-${theme}.png`;
      await page.screenshot({path:join(out,archiveScreenshot),fullPage:true});
      assert.equal(archivePreviews,1);assert.equal(archivePosts,1);assert.equal(archiveReads,1);
      await archiveRetry.focus();await page.keyboard.press("Enter");
      await expect(page.getByTestId("import-completion-summary")).toBeVisible();
      await expect(page.getByTestId("commit-import-button")).toHaveCount(0);
      await expect(page.getByTestId("preview-import-button")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      assert.equal(archivePreviews,1);assert.equal(archivePosts,1);assert.equal(archiveReads,2);
      results.push({ width, locale, theme, state: theme === "light" ? "FAILED" : "PAUSED", writes: writes.length, reads, geometry,
        screenshot: filename, exclusionScreenshot, selectionScreenshot, selectionGeometry, selectedUploadCount: selectionWrites.length,
        unknownCommitRecovered:true,commitPosts,commitReads,uploadScreenshot,
        initialPosts,receiptReads,initialReads,uploadIdentityRetained:true,unavailableLocalRelease:true,
        pastePosts,pasteReads,pasteScreenshot,pastedSourceRetained:true,
        canonicalPosts,canonicalRetries,canonicalReads,canonicalScreenshot,canonicalAttemptIsolated:true,
        archivePreviews,archivePosts,archiveReads,archiveGeometry,archiveScreenshot,
        archiveStorageRejection:theme==="light"?"removeItem":"getter",archiveOneProgressAction:true });
    } catch (error) {
      await page.screenshot({ path: join(out, `failure-${width}-${locale}-${theme}.png`), fullPage: true }).catch(() => {});
      const chooserEvents = await page.evaluate(() => window.chooserEvents).catch(() => null);
      writeFileSync(join(out, "failure.json"), JSON.stringify({ width, locale, theme, error: String(error), errors, chooserEvents, completed: results }, null, 2));
      throw error;
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({
    scope: "Production ImportPanel/React Query; synthetic transport/account/secondary surfaces, no real import",
    results, errors,
  }, null, 2));
  console.log(`Import source repair browser: ${results.length} passed; ${out}`);
} finally { await browser.close(); }
