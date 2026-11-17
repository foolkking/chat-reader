// Actual React/Query disposition controller. Transport is synthetic; this is
// not a worker cancellation or production import acceptance test.
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
const out = join(temp, "import-batch-browser");
mkdirSync(out, { recursive: true });
const modulePath = path => JSON.stringify(join(web, path).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
const adapter = join(out, "adapters.tsx");
writeFileSync(adapter, `
export const usePreferences=()=>({resolvedLocale:window.fixtureLocale});
export const authenticationGeneration=()=>window.fixtureGeneration??1;
export const getCurrentOfflineRuntimeUserId=()=>String(window.fixtureGeneration??1);
export const useInteractionDialog=()=>({confirm:async()=>window.confirmDisposition!==false});
export const useImportDialog=()=>({openImportDialog:()=>{}});
export class ApiRequestError extends Error{constructor(message,status){super(message);this.status=status}}
async function request(path,method="GET"){
 const r=await fetch(path,{method});if(!r.ok)throw new ApiRequestError("synthetic",r.status);return r.status===204?null:r.json();
}
export const getAdaptiveImportSession=id=>request("/api/sessions/"+id);
export const cancelAdaptiveImportSession=(id,version)=>request("/api/sessions/"+id+"?version="+version,"DELETE");
export const cancelTask=id=>request("/api/tasks/"+id+"/stop","POST");
export const retryTask=id=>request("/api/tasks/"+id+"/cleanup","POST");
export const getUnfinishedImports=()=>request("/api/sessions");
`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ImportDisposition} from ${modulePath("features/import/import-batch-manager.tsx")};
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
function Fixture(){const[open,toggle]=useState(true);const[,refresh]=useState(0);
window.refreshFixture=()=>refresh(v=>v+1);
return <main style={{padding:24,maxWidth:720,margin:"auto"}}>
<h1>来源 B.zip</h1><button className="btn-secondary min-h-11" onClick={()=>toggle(!open)}>Toggle batch</button>
{open&&<section className="flex flex-wrap gap-2"><ImportDisposition importId="batch-B" updatedAt="2026-11-17T00:00:00Z"
title="B.zip" taskId="analysis-B" canStop canDiscard onChanged={s=>window.confirmedSession=s}/></section>}</main>}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false }, resolve: {
    extensions: [".tsx", ".ts", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"), "react-dom/client$": require.resolve("react-dom/client") },
  }, plugins: [
    new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|interaction-dialog-provider|import-dialog-provider|auth-client|offline-access|\/lib\/api)$/, resource => { resource.request = adapter; }),
  ], module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const css = await require("postcss")([require("tailwindcss")({ content: [join(web, "features/import/*.tsx"), join(out, "entry.tsx")] })])
  .process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [], errors = [];
try {
  for (const width of [375, 1440]) for (const locale of ["zh-CN", "en-US"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(locale => { window.fixtureLocale = locale; }, locale);
    let state = "READY", cleanup = null, writes = [], reject = false, hold = null;
    await page.route("https://batch.synthetic/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/") && route.request().method() !== "GET") {
        writes.push([path, route.request().method()]);
        if (hold) await hold;
        if (reject) return route.abort("failed");
        return route.fulfill({ status: 204 });
      }
      if (path.startsWith("/api/")) return route.fulfill({ json: {
        import_id: "batch-B", state, source_cleanup: cleanup, updated_at: "2026-11-17T00:00:00Z",
      } });
      return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
        body: path === "/bundle.js" ? bundle : path === "/style.css" ? css.css : html });
    });
    const discard = () => page.getByRole("button", { name: /放弃本次导入|Discard import/, exact: true });
    const check = () => page.getByRole("button", { name: /核对结果|Check result/, exact: true });
    await page.goto("https://batch.synthetic/");
    await page.evaluate(() => { window.confirmDisposition = false; });
    await discard().click();
    assert.equal(writes.length, 0);
    await page.evaluate(() => { window.confirmDisposition = true; });
    state = "CANCELING";
    await discard().click();
    await expect(discard()).toBeDisabled();
    await expect(check()).toBeEnabled();
    assert.equal(await page.evaluate(() => window.confirmedSession?.state), "CANCELING");
    await page.reload();
    await expect(discard()).toBeDisabled(); // reload checks; never resubmits
    assert.equal(writes.length, 1);
    state = "CANCELED"; cleanup = { state: "failed", retryable: true, revision: "synthetic-receipt" };
    await check().click();
    await expect(page.getByRole("button", { name: /仅重试清理|Retry cleanup only/ })).toBeVisible();
    cleanup = { ...cleanup, state: "completed", retryable: false };
    await page.getByRole("button", { name: /仅重试清理|Retry cleanup only/ }).click();
    await expect(page.getByText(/已核对处理结果|Outcome confirmed/)).toBeVisible();
    assert.deepEqual(writes.map(row => row[0]), ["/api/sessions/batch-B", "/api/tasks/batch-B/cleanup"]);
    results.push({ width, locale, case: "confirmation / accepted / reload / cleanup-failed / cleanup-confirmed", pass: true });

    state = "ANALYZING"; cleanup = null; reject = true;
    await page.getByRole("button", { name: /停止并保留|Stop and keep/ }).click();
    await expect(discard()).toBeDisabled();
    await page.getByRole("button", { name: "Toggle batch" }).click();
    await page.getByRole("button", { name: "Toggle batch" }).click();
    await expect(discard()).toBeDisabled();
    assert.equal(writes.length, 3);
    state = "PAUSED";
    await check().click();
    await expect(page.getByText(/已核对处理结果|Outcome confirmed/)).toBeVisible();
    assert.equal(writes.length, 3);
    results.push({ width, locale, case: "lost-retain-response / reopen-read-only / paused", pass: true });
    await page.screenshot({ path: join(out, `retained-${width}-${locale}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    reject = false; state = "READY";
    let release; hold = new Promise(resolve => { release = resolve; });
    await discard().click();
    await expect(check()).toBeDisabled();
    await page.evaluate(() => { window.fixtureGeneration = 2; window.confirmedSession = null; window.refreshFixture(); });
    release(); hold = null;
    await expect(discard()).toBeEnabled();
    assert.equal(await page.evaluate(() => window.confirmedSession), null);
    results.push({ width, locale, case: "late-write-after-account-switch-rejected", pass: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ transport: "synthetic", production: false, results, errors }, null, 2));
  console.log(`Import batch browser: ${results.length} passed; ${out}`);
} catch (error) {
  writeFileSync(join(out, "failure.json"), JSON.stringify({ results, errors, error: error.stack }, null, 2));
  throw error;
} finally { await browser.close(); }
