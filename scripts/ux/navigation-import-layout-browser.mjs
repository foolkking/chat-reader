// Real product components, synthetic adapters/transport. This verifies layout
// and interactions, not a full running API/worker/Next deployment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "apps/web"), require = createRequire(join(web, "package.json"));
const temp = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const out = join(temp, "navigation-import-layout-browser");
mkdirSync(out, { recursive: true });
const modulePath = path => JSON.stringify(join(web, path).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
const adapter = join(out, "adapters.tsx");
writeFileSync(adapter, `
import React,{useSyncExternalStore} from "react";
const subscribe=callback=>{window.addEventListener("preferences",callback);return()=>window.removeEventListener("preferences",callback)};
const publish=()=>{window.preferenceVersion=(window.preferenceVersion??0)+1;window.dispatchEvent(new Event("preferences"));};
export const recommendedNavigation={all:{mode:"content_updated",direction:"desc"},project_default:{mode:"imported",direction:"desc"},unclassified:{mode:"imported",direction:"desc"},blocks:"projects_first"};
export function usePreferences(){
 useSyncExternalStore(subscribe,()=>window.preferenceVersion??0,()=>0);
 window.fixtureNavigation??=structuredClone(recommendedNavigation);
 return {resolvedLocale:window.fixtureLocale,navigationSort:window.fixtureNavigation,projectSortMode:window.projectMode??"custom",projectSortDirection:"asc",
 setNavigationSort:async next=>{window.fixtureNavigation=next;publish()},
 setProjectSort:async mode=>{window.projectMode=mode;publish()}};
}
export const authenticationGeneration=()=>1;
export const getCurrentOfflineRuntimeUserId=()=>"synthetic-layout";
export const useInteractionDialog=()=>({confirm:async()=>true});
export const useImportDialog=()=>({openImportDialog:args=>{window.openedImport=args}});
export class ApiRequestError extends Error {}
export const getUnfinishedImports=async()=>window.batches;
export const getImportSourcePreview=async()=>{window.previewReads=(window.previewReads??0)+1;return window.preview};
export const getAdaptiveImportSession=async()=>window.session;
export const cancelAdaptiveImportSession=async()=>{};
export const cancelTask=async()=>{};
export const retryTask=async()=>{};
export const getProjects=async()=>[];
export const getConversationOrder=async()=>({initialized:true,version:"synthetic-order",count:2});
export const changeConversationOrder=async value=>{window.orderWrite=value};
export const updateProject=async()=>{};
export const searchConversations=async()=>({items:window.hits,has_more:false});
const forbidden=()=>{throw Error("Unexpected import mutation")};
export const excludeAdaptiveImportGroup=forbidden,getAdaptiveImportArchive=forbidden,reanalyzeAdaptiveImportSession=forbidden,
rebuildAdaptiveImportPreview=forbidden,replaceAdaptiveImportArtifact=forbidden,resolveAdaptiveImportGroups=forbidden,
selectAdaptiveFamilyProfile=forbidden,updateAdaptiveImportArchive=forbidden,checkAdaptiveFamilyHealth=forbidden;
export const MappingWorkspace=()=>{throw Error("Unexpected mapping workspace")};
export const FormatConversionDialog=()=>null;
export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}
`);
writeFileSync(join(out, "entry.tsx"), `
import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {NavigationSortSettings} from ${modulePath("components/navigation-sort-settings.tsx")};
import {ImportBatchManager} from ${modulePath("features/import/import-batch-manager.tsx")};
import {ImportSourcePreview} from ${modulePath("features/import/import-source-preview.tsx")};
import {AdaptiveImportWorkspace} from ${modulePath("features/import/adaptive-import-workspace.tsx")};
import {SearchResults} from ${modulePath("features/search/search-results.tsx")};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
window.refreshBatches=()=>client.invalidateQueries({queryKey:["unfinished-imports"]});
function Fixture(){const zh=window.fixtureLocale==="zh-CN";const section=location.pathname.slice(1);
return <main className="mx-auto max-w-3xl space-y-5 bg-page p-4 text-primary sm:p-6">
<header className="border-b border-ui pb-4"><h1 className="text-lg font-semibold">{zh?"对话资料库":"Conversation library"}</h1></header>
{section==="sorting"?<NavigationSortSettings/>:section==="imports"?<ImportBatchManager/>:section==="overview"||section.startsWith("invalid")?
<AdaptiveImportWorkspace session={window.session} onSession={()=>{}} onBack={()=>{}} onImport={()=>{window.importClicked=true}} importing={false} error={null}/>:
section==="preview"?
<section><h2 className="break-words text-sm font-semibold">{window.group.files[0].filename}</h2><ImportSourcePreview session={window.session} group={window.group} showSourceName={false}/></section>:
<SearchResults items={window.searchItems} query="排序" selectedConversationIds={new Set()} onConversationSelectionChange={id=>{window.selectedId=id}}/>}
</main>}
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
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|interaction-dialog-provider|import-dialog-provider|auth-client|offline-access|\/lib\/api|next\/link|mapping-workspace|format-conversion-guide)$/, resource => { resource.request = adapter; }),
  ], module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const css = await require("postcss")([require("tailwindcss")({ content: [join(web, "components/*.tsx"), join(web, "features/import/*.tsx"), join(web, "features/search/*.tsx"), join(out, "entry.tsx")] })])
  .process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [], errors = [];
try {
  for (const width of [375, 1440]) for (const locale of ["zh-CN", "en-US"]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: true });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(locale => {
      window.fixtureLocale = locale;
      window.session = { import_id: "batch-B", updated_at: "2026-11-17T00:00:00Z", state: "READY",
        group_count: 1, family_count: 1, conversation_count: 1, message_count: 2, can_import: true, draft_status: "ready",
        archives: [], allowed_actions: ["rebuild_preview"] };
      window.group = { id: "group-B", family_id: "family-B", artifact_ids: ["source-B"],
        files: [{ filename: "本次课程资料/排序与检索说明.md" }] };
      window.session.groups = [window.group];
      window.session.families = [{ id: "family-B", group_ids: ["group-B"], group_count: 1,
        display_name: "旧文件 A 的格式", source_mode: "MARKDOWN", handling_class: "SUPPORTED",
        resolution_status: "EXACT_MATCH", matched_revision_id: "format-revision", diagnostics: [], match_evidence: {} }];
      window.preview = { import_id: "batch-B", group_id: "group-B", family_id: "family-B",
        sources: [{ artifact_id: "source-B" }], conversation_count: 1,
        preview: { title: "本次课程：排序与检索", messages: [
          { role: "user", content: "项目内对话如何保持稳定的排序？" },
          { role: "assistant", content: "导入时间和最近阅读分别展示；手动顺序单独保留。" }] } };
      window.batches = { total: 2, has_more: false, items: [
        { import_id: "batch-B", title: "本次课程资料.zip", state: "READY", source_available: true, draft_status: "ready",
          updated_at: "2026-11-17T00:00:00Z", created_at: "2026-11-16T23:50:00Z", target_project_name: "课程归档",
          allowed_actions: ["discard"] },
        { import_id: "batch-old", title: "上周研讨记录及补充资料.zip", state: "FAILED", source_available: true, draft_status: "expired",
          updated_at: "2026-11-16T00:00:00Z", created_at: "2026-11-15T00:00:00Z", target_project_name: null,
          error_message: "来源已保留，请重建预览后继续。", allowed_actions: ["discard"] }] };
      const first = { document_id: "document-B", document_type: "message", conversation_id: "conversation-B",
        conversation_title: "项目排序与阅读笔记", project_name: "课程归档", conversation_status: "active",
        snippet: "目录按导入时间排序，最近阅读不会改变手动整理的位置。", message_id: "message-B", role: "assistant",
        occurrence_count: 1, hit_count: 3 };
      window.searchItems = [first, { ...first, document_id: "document-C", conversation_id: "conversation-C",
        conversation_title: "相同正文也应可发现", project_name: null, hit_count: 1 }];
      window.hits = [first, { ...first, document_id: "hit-2", snippet: "第二条排序命中", message_id: "message-2" },
        { ...first, document_id: "hit-3", snippet: "第三条排序命中", message_id: "message-3" }];
      if (location.pathname.startsWith("/invalid")) {
        window.session.state = "BLOCKED"; window.session.can_import = false;
        window.session.allowed_actions = [];
        window.group.files = [{ artifact_id: "source-B", filename: "synthetic-invalid.json", extension: ".json", byte_size: 120 }];
        window.group.diagnostics = [];
        const family = window.session.families[0];
        Object.assign(family, { display_name: "Unknown JSON", handling_class: "NOT_MAPPABLE", source_mode: "JSON",
          matched_revision_id: null, resolution_status: "INVALID", handling_reason: { title: "Cannot parse JSON",
            detail: "Field mapping cannot fix syntax or encoding errors." } });
        if (location.pathname === "/invalid-multiple") window.group.files.push({
          artifact_id: "source-C", filename: "synthetic-second.json", extension: ".json", byte_size: 150 });
      }
    }, locale);
    await page.route("https://layout.synthetic/**", route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html",
        body: path === "/bundle.js" ? bundle : path === "/style.css" ? css.css : html });
    });
    for (const section of ["imports", "overview", "preview", "sorting", "search", "invalid-single", "invalid-multiple"]) {
      await page.goto(`https://layout.synthetic/${section}`);
      if (section === "imports") {
        await expect(page.getByRole("heading", { name: "本次课程资料.zip" })).toBeVisible();
        await expect(page.getByText(/预览需重建|Preview needs rebuilding/)).toBeVisible();
        await page.getByRole("button", { name: /查看详情|View details/ }).first().click();
        assert.equal(await page.evaluate(() => window.openedImport.resumeImportId), "batch-B");
      } else if (section === "overview") {
        await expect(page.getByRole("heading", { name: "本次课程资料/排序与检索说明.md", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "旧文件 A 的格式", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /重新生成预览|Rebuild preview/, exact: true })).not.toBeVisible();
        await expect(page.getByRole("button", { name: /导入 1 个对话|Import 1 conversations/, exact: true })).toBeEnabled();
        await expect(page.getByText(/可设置格式 0|Cannot be mapped yet 0|Can be mapped 0/)).toHaveCount(0);
        await page.getByRole("button", { name: /来源与预览|Source & preview/ }).click();
        await expect(page.getByText("本次课程：排序与检索", { exact: true })).toBeVisible();
      } else if (section === "preview") {
        assert.equal(await page.evaluate(() => window.previewReads ?? 0), 0, "No hidden preview parsing/request");
        await page.getByRole("button", { name: /来源与预览|Source & preview/ }).click();
        await expect(page.getByText("本次课程：排序与检索", { exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => window.previewReads), 1);
        await expect(page.getByText("A-only secret text", { exact: true })).toHaveCount(0);
      } else if (section === "sorting") {
        await page.getByText(/排序与导航|Sorting & navigation/, { exact: true }).click();
        const sectionButton = page.getByRole("button", { name: /未归类 → 项目|Unclassified → Projects/, exact: true });
        await sectionButton.click();
        await expect(sectionButton).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: /对话排序|Sort conversations/, exact: true }).nth(1).click();
        await page.getByRole("menuitem", { name: /标题|Title/, exact: true }).click();
        assert.deepEqual(await page.evaluate(() => [window.fixtureNavigation.all.mode, window.fixtureNavigation.project_default.mode]),
          ["title", "imported"]);
      } else if (section.startsWith("invalid")) {
        const article = page.locator("article");
        await expect(article).toHaveCount(1);
        await expect(article.getByText("synthetic-invalid.json", { exact: true })).toHaveCount(1);
        await expect(article.getByRole("button", { name: /^(替换|Replace) synthetic-invalid.json$/ })).toBeEnabled();
        await expect(article.getByText(/使用的导入格式|Using import format/)).toHaveCount(0);
        if (section === "invalid-multiple") {
          await expect(article.getByText("synthetic-second.json", { exact: true })).toBeVisible();
          await expect(article.getByRole("button", { name: /^(替换|Replace) synthetic-second.json$/ })).toBeEnabled();
        }
      } else {
        await expect(page.getByRole("link", { name: "相同正文也应可发现", exact: true })).toBeVisible();
        await page.getByRole("button", { name: /另有 2 条命中|2 more hits/ }).click();
        await expect(page.getByRole("link").filter({ hasText: "第二条排序命中" })).toHaveAttribute("href", /message-2/);
        const select = page.getByRole("button", { name: /选择对话|Select conversation/, exact: true }).first();
        assert.ok((await select.boundingBox()).height >= 44);
        await select.click();
        assert.equal(await page.evaluate(() => window.selectedId), "conversation-B");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, section);
      await page.screenshot({ path: join(out, `${section}-${width}-${locale}.png`), fullPage: true });
      results.push({ width, locale, section, pass: true });
      if (section === "imports") {
        await page.getByRole("button", { name: /查看详情|View details/ }).first().focus();
        await page.evaluate(async () => { window.batches.items = window.batches.items.slice(1); window.batches.total = 1; await window.refreshBatches(); });
        await expect(page.getByRole("button", { name: /查看详情|View details/ }).first()).toBeFocused();
        results.push({ width, locale, section: "removed-batch-focus-recovery", pass: true });
      }
    }
    // A foreign sidecar is rejected before displaying any of its body.
    await page.goto("https://layout.synthetic/preview");
    await page.evaluate(() => { window.preview.import_id = "batch-A"; window.preview.preview.messages[0].content = "A-only secret text"; });
    await page.getByRole("button", { name: /来源与预览|Source & preview/ }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("A-only secret text", { exact: true })).toHaveCount(0);
    results.push({ width, locale, section: "foreign-preview-rejected", pass: true });
    // Old batches without a version must not spin forever or issue an unbound read.
    await page.goto("https://layout.synthetic/preview");
    await page.evaluate(() => { delete window.session.updated_at; });
    await page.getByRole("button", { name: /来源与预览|Source & preview/ }).click();
    await expect(page.getByRole("alert")).toHaveText(/批次信息不完整|Batch details are incomplete/);
    await expect(page.getByText(/正在读取预览|Loading preview/)).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.previewReads ?? 0), 0);
    results.push({ width, locale, section: "missing-preview-version-rejected", pass: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ realComponents: true, adapters: "synthetic", fullSite: false, results, errors }, null, 2));
  console.log(`Navigation/import layout browser: ${results.length} passed; ${out}`);
} catch (error) {
  writeFileSync(join(out, "failure.json"), JSON.stringify({ results, errors, error: error.stack }, null, 2));
  throw error;
} finally { await browser.close(); }
