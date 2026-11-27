// Real React/QueryClient/TaskContent mounted in Chromium. All tasks, identity,
// transport and adjacent dialogs are synthetic; no server/production claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "apps/web"), require = createRequire(join(web, "package.json"));
const temp = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") assert.match(temp.replaceAll("\\", "/").toLowerCase(),
  /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const out = join(temp, "merge-attachment-result-browser");
mkdirSync(out, { recursive: true });
const monitorPath = join(web, "features/import/import-task-monitor.tsx");
const sources = Object.fromEntries([monitorPath, join(web, "lib/types.ts"), fileURLToPath(import.meta.url)]
  .map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const startedAt = new Date().toISOString();
writeFileSync(join(out, "result.json"), JSON.stringify({ status: "not_completed", startedAt, sources }, null, 2));
writeFileSync(join(out, "loader.cjs"), `
const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=function(source){
 if(this.resourcePath===${JSON.stringify(monitorPath)}) source+="\\nexport {TaskContent};";
 return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
};`);
const adapter = join(out, "adapters.tsx");
writeFileSync(adapter, `
import React from "react";
export const usePreferences=()=>({resolvedLocale:window.gateLocale});
export const useTranslations=()=>key=>({tasks:"Tasks",noActiveTasks:"No active tasks"}[key]??key);
export const useImportDialog=()=>({openImportDialog:()=>{throw Error("Unexpected import");}});
export const authenticationGeneration=()=>1;
export const getActiveTasks=async()=>window.gateTasks;
export const getPendingCleanupScans=async()=>[];
export const getTask=async id=>window.gateTasks.find(row=>row.job_id===id);
export const retryTask=async id=>{window.gateWrites.push(["retry",id]);throw Error("Unexpected retry");};
export const cancelTask=async id=>{window.gateWrites.push(["cancel",id]);throw Error("Unexpected cancel");};
export const ImportBatchManager=()=>null,ContentCleanupDialog=()=>null,CleanupDismissAction=()=>null,
 CleanupScanCancelAction=()=>null,SettingsFocusedDialog=()=>null,ExportArtifactDelivery=()=>null;
export const cleanupScanLabel=()=> "Synthetic scan";
export default ({href,children,...props})=><a href={href} {...props}>{children}</a>;
`);
writeFileSync(join(out, "entry.tsx"), `
import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ImportTaskMonitor,TaskContent} from ${JSON.stringify(monitorPath.replaceAll("\\", "/"))};
const root=createRoot(document.getElementById("root"));
window.gateWrites=[];
let client;
let revision=0;
window.mountTasks=({rows,locale,compact})=>{
 client?.clear();
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
 client.setQueryData(["active-tasks"],rows);
 client.setQueryData(["content-cleanup-pending"],[]);
 window.gateLocale=locale;window.gateTasks=rows;
 root.render(<QueryClientProvider client={client} key={++revision}>
 <main className="mx-auto max-w-xl p-3" data-fixture={compact?"compact":"center"}>
 {compact?<TaskContent task={rows[0]} compact onRetry={()=>window.gateWrites.push(["retry"])}
 onCancel={()=>window.gateWrites.push(["cancel"])}/>:<ImportTaskMonitor placement="center" forceVisible/>}
 </main></QueryClientProvider>);
};
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"),
  output: { path: out, filename: "bundle.js" }, optimization: { minimize: false },
  resolve: {
    extensions: [".tsx", ".ts", ".mjs", ".js"],
    modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom/client$": require.resolve("react-dom/client"), "next/link$": adapter },
  },
  plugins: [
    new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(
      /(?:preferences-provider|import-dialog-provider|offline-access|import-batch-manager|content-cleanup-panel|cleanup-dismiss-action|cleanup-scan-progress|settings-focused-dialog|export-artifact-delivery|\/lib\/api)$/,
      resource => { resource.request = adapter; }),
  ],
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors()
  ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [monitorPath, join(out, "entry.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : process.env.MERGE_UI_BROWSER_CHANNEL ?? "msedge",
});
const results = [], errors = [];
let current;
const task = (id, result = {}, options = {}) => ({
  job_id: id, job_type: "conversation_merge", status: "committed", phase: "committed",
  progress: 100, processed_items: 2, total_items: 2, label: "Synthetic merge",
  queued_at: "2026-11-25T10:00:00Z", started_at: "2026-11-25T10:00:00Z",
  completed_at: "2026-11-25T10:00:01Z", heartbeat_at: null, attempt_count: 1,
  error_message: null, cancellable: false, result: { conversation_id: "synthetic-target", ...result }, ...options,
});
try {
  for (const width of [320, 375]) for (const locale of ["zh-CN", "en-US"])
    for (const theme of ["light", "dark"]) for (const compact of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      current = page;
      page.on("pageerror", error => errors.push(String(error)));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, "http://merge-ui.synthetic", "No external requests are allowed");
        assert.ok(["/", "/bundle.js", "/style.css"].includes(url.pathname), "No API or navigation request is expected");
        return route.fulfill({
          contentType: url.pathname === "/bundle.js" ? "text/javascript" : url.pathname === "/style.css" ? "text/css" : "text/html",
          body: url.pathname === "/bundle.js" ? bundle : url.pathname === "/style.css" ? styles.css : html,
        });
      });
      await page.goto("http://merge-ui.synthetic/");
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const zh = locale === "zh-CN";
      const mount = async row => {
        await page.evaluate(args => window.mountTasks(args), { rows: [row], locale, compact });
        await expect(page.getByTestId(`task-${row.job_type}-${row.status}`)).toBeVisible();
        return page.getByTestId(`task-${row.job_type}-${row.status}`);
      };
      const cases = [
        ["missing", { missing_attachments: 2, unlocated_occurrences: 0, repaired_occurrences: 0 }],
        ["unlocated", { missing_attachments: 0, unlocated_occurrences: 3, repaired_occurrences: 0 }],
        ["mixed", { missing_attachments: 2, unlocated_occurrences: 3, repaired_occurrences: 4 }],
        ["repaired", { missing_attachments: 0, unlocated_occurrences: 0, repaired_occurrences: 4 }],
      ];
      for (const [name, recovery] of cases) {
        const row = await mount(task(name, { attachment_recovery: recovery }));
        const review = recovery.missing_attachments > 0 || recovery.unlocated_occurrences > 0;
        const notice = row.getByTestId("task-merge-attachment-recovery");
        await expect(notice).toBeVisible();
        await expect(row).toContainText(review ? (zh ? "已合并，附件待核对" : "Merged; attachments need review") : (zh ? "处理完成" : "Completed"));
        if (review) await expect(notice).toContainText(zh ? "正文和原对话均已保留" : "Message content and original conversations are retained");
        if (recovery.missing_attachments) await expect(notice).toContainText(zh ? "缺失附件 2 个" : "Missing attachments: 2");
        if (recovery.unlocated_occurrences) await expect(notice).toContainText(zh ? "未定位附件关联 3 处" : "Unlocated attachment references: 3");
        if (recovery.repaired_occurrences) await expect(notice).toContainText(zh ? "已修复 4 处附件关联" : "Attachment references repaired: 4");
        await expect(row.getByRole("button", { name: /重试|Retry/i })).toHaveCount(0);
        await expect(row.getByRole("alert")).toHaveCount(0);
        await expect(row).not.toContainText(zh ? "项失败" : "failed");
        const link = row.getByTestId("task-result-conversation");
        await expect(link).toHaveAttribute("href", "/conversations/synthetic-target");
        await expect(link).toHaveText(zh ? "打开合并后的对话" : "Open merged conversation");
        await link.focus();
        await expect(link).toBeFocused();
        if (!compact) await expect(page.getByRole("region", { name: zh ? "已完成" : "Completed", exact: true })).toContainText(await notice.textContent());
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const geometry = await notice.evaluate(element => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, height: box.height, overflow: element.scrollWidth > element.clientWidth };
        });
        assert.ok(geometry.left >= 0 && geometry.right <= width && !geometry.overflow);
        if (name === "mixed") await page.screenshot({ path: join(out, `${width}-${locale}-${theme}-${compact ? "compact" : "center"}.png`) });
        results.push({ width, locale, theme, compact, case: name, geometry });
      }
      for (const [name, result, options] of [
        ["legacy", {}, {}],
        ["zero", { attachment_recovery: { missing_attachments: 0, unlocated_occurrences: 0, repaired_occurrences: 0 } }, {}],
        ["import", { attachment_recovery: cases[2][1] }, { job_type: "import" }],
        ["failed", { attachment_recovery: cases[2][1] }, { status: "failed", phase: "failed" }],
        ["processing", { attachment_recovery: cases[2][1] }, { status: "processing", phase: "copying", progress: 50 }],
        ["cancelled", { attachment_recovery: cases[2][1] }, { status: "cancelled", phase: "cancelled" }],
      ]) {
        const row = await mount(task(name, result, options));
        await expect(row.getByTestId("task-merge-attachment-recovery")).toHaveCount(0);
        await expect(row).not.toContainText(zh ? "已合并，附件待核对" : "Merged; attachments need review");
        if (name === "failed") await expect(row.getByRole("button", { name: zh ? "重试" : "Retry", exact: true })).toBeVisible();
        results.push({ width, locale, theme, compact, case: name });
      }
      const batch = await mount(task("batch", { failed: [{ id: "synthetic-failed", error: "Synthetic failure" }], deleted_ids: ["synthetic-deleted"],
        attachment_recovery: cases[2][1] }, { job_type: "conversation_batch_delete" }));
      await expect(batch).toContainText(zh ? "部分完成" : "Partially completed");
      await expect(batch).toContainText(zh ? "1 项完成 · 1 项失败" : "1 completed · 1 failed");
      await expect(batch.getByTestId("task-merge-attachment-recovery")).toHaveCount(0);
      assert.deepEqual(await page.evaluate(() => window.gateWrites), []);
      results.push({ width, locale, theme, compact, case: "batch-semantics" });
      await page.close();
    }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "passed", startedAt, browser: browser.version(), sources, results, errors }, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: results.length, layouts: 16, out }));
} catch (error) {
  if (current && !current.isClosed()) await current.screenshot({ path: join(out, "failure.png") });
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "failed", startedAt, sources, results, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
