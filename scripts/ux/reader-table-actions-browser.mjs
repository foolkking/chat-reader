// Mounted Reader renderer/table controls with the real Markdown/math/CSS core.
// Only assistant-ui plumbing, preferences, unused attachments and browser IO are
// adapted. The oversized AST case is a controlled boundary, not a 50k-cell render
// performance claim. No user sources or application service are used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), web = join(root, "apps/web");
const require = createRequire(join(web, "package.json"));
const temp = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const out = join(temp, "reader-table-actions-browser");
mkdirSync(out, { recursive: true });
const modulePath = file => JSON.stringify(join(web, file).replaceAll("\\", "/"));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=function(s){
 if(this.resourcePath.endsWith("markdown-renderer.tsx"))s+="\\nexport {ShikiCodeBlock};";
 if(this.resourcePath.endsWith("attachment-block.tsx"))s+="\\nexport {InlineTextPreview};";
 return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
};`);
writeFileSync(join(out, "adapters.tsx"), `
import React,{createContext,useContext} from "react";
import ReactMarkdown from "react-markdown";
export const usePreferences=()=>({resolvedLocale:window.gateLocale,resolvedTheme:window.gateTheme});
const Source=createContext("");
export const TextMessagePartProvider=({text,children})=><Source.Provider value={text}>{children}</Source.Provider>;
export const MarkdownTextPrimitive=({preprocess,componentsByLanguage,className,...props})=>
 <div className={className}><ReactMarkdown {...props}>{preprocess(useContext(Source))}</ReactMarkdown></div>;
export const useImageSource=()=>({onDecoded:()=>{}});
export const AttachmentBlock=()=>null;
export const AttachmentPreviewDialog=()=>null,useAttachmentViewer=()=>({}),retryableUrl=url=>url;
`);
// Observe the actual helper calls without replacing their implementation.
writeFileSync(join(out, "instrument.ts"), `
import * as real from ${modulePath("features/conversations/markdown-table-export.ts")};
export * from ${modulePath("features/conversations/markdown-table-export.ts")};
export const readMarkdownTableData=(...args)=>{window.tableReads++;return real.readMarkdownTableData(...args)};
export const serializeTableData=(...args)=>{window.tableSerializations++;return real.serializeTableData(...args)};
`);
const source = "# Reading sample\n\nBefore the table:\n\n\\[\na^2+b^2=c^2\n\\]\n\n| Item | Value | Notes |\n| --- | ---: | --- |\n| Fraction | $\\frac{x}{2}$ | first<br>second, with \"quotes\" |\n| Text | =1+1 | keep as text |\n| Number | -12.5 | not a formula |\n\nAfter the table — preserved source.\n";
const oversizedSource = "Original segment\n\n| Name |\n| --- |\n" + "| synthetic |\n".repeat(50_001) + "\nComplete final line.\n";
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {MarkdownRenderer,ShikiCodeBlock} from ${modulePath("features/conversations/markdown-renderer.tsx")};
import {InlineTextPreview} from ${modulePath("features/attachments/attachment-block.tsx")};
import {ReaderMarkdownTable,MarkdownTableSourceContext} from ${modulePath("features/conversations/markdown-table-export-actions.tsx")};
const source=${JSON.stringify(source)},oversizedSource=${JSON.stringify(oversizedSource)};
const oversized={tagName:"table",children:[{tagName:"tr",children:Array.from({length:50001},()=>({tagName:"td",get children(){throw Error("Oversized cells were extracted")}}))}]};
const code=Array.from({length:90},(_,i)=>"line "+i+" — original source").join("\\n");
const attachment={id:"synthetic-text",display_name:"Notes.txt",content_url:"/preview.txt",download_url:"/preview.txt",
 asset_object:{id:"synthetic-asset",byte_size:999999,sha256:"a".repeat(64)}};
const onRuntime=state=>window.previewState=state,onOpen=()=>window.fullPreviewOpened=true;
window.tableReads=0;window.tableSerializations=0;window.clipboardWrites=[];
Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{
 window.clipboardWrites.push(text);
 if(window.deferCopy)await new Promise(resolve=>window.finishCopy=resolve);
 if(window.denyCopy)throw Error("Synthetic clipboard denial");
}}});
const createObjectURL=URL.createObjectURL.bind(URL);
URL.createObjectURL=blob=>{if(window.denyDownload)throw Error("Synthetic download denial");return createObjectURL(blob)};
function Fixture(){const[variant,setVariant]=useState("ordinary"),[key,setKey]=useState(0);
 window.setVariant=setVariant;window.remount=()=>setKey(value=>value+1);
 return <main style={{maxWidth:720,margin:"32px auto",padding:16}} className="reader-frame text-primary">
 <h1 className="text-lg font-semibold mb-4">Table reading / 表格阅读</h1>
 <div className="reader-content-inner" key={key}>{variant==="density"?<>
 <ShikiCodeBlock code={code} language=""/><p id="code-after">After complete code</p>
 <InlineTextPreview attachment={attachment} kind="text" locator={{attachmentId:attachment.id}} zh={window.gateLocale==="zh-CN"}
 presentation="reading" onRuntime={onRuntime} onOpen={onOpen}/></>:variant==="limit"?
  <MarkdownTableSourceContext.Provider value={oversizedSource}><ReaderMarkdownTable node={oversized}>
   <table><tbody><tr><td>Controlled oversized export boundary — source retained</td></tr></tbody></table>
  </ReaderMarkdownTable></MarkdownTableSourceContext.Provider>:
  <MarkdownRenderer text={source} scopeId="synthetic-table" preserveSourceOffsets/>}</div>
 </main>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
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
      "react-dom$": require.resolve("react-dom"), "react-dom/client$": require.resolve("react-dom/client"),
      "@assistant-ui/react$": adapter, "@assistant-ui/react-markdown$": adapter },
  },
  plugins: [
    new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|image-presentation|attachment-block|attachment-viewer)$/, resource => { resource.request = adapter; }),
    new webpack.NormalModuleReplacementPlugin(/^\.\/markdown-table-export$/, resource => { resource.request = join(out, "instrument.ts"); }),
  ],
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [join(web, "components/**/*.tsx"), join(web, "features/**/*.tsx"), join(out, "entry.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const katexPath = require.resolve("katex/dist/katex.min.css");
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/katex.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [], errors = [];
try {
  for (const width of [375, 800, 1440]) for (const locale of ["zh-CN", "en-US"]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 375, isMobile: width === 375 });
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.clock.install();
    await page.addInitScript(({ locale, theme }) => {
      window.gateLocale = locale; window.gateTheme = theme;
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; });
    }, { locale, theme });
    await page.route("https://reader-table.synthetic/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/preview.txt") {
        const body = "First visible line\n" + "Synthetic record\n".repeat(40);
        return route.fulfill({ status: 206, body, headers: { "content-range": `bytes 0-${Buffer.byteLength(body) - 1}/999999` } });
      }
      if (/^\/fonts\/[\w.-]+\.woff2?$/.test(path)) return route.fulfill({ contentType: "font/woff2", body: readFileSync(join(dirname(katexPath), "fonts", basename(path))) });
      return route.fulfill({ contentType: path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
        body: path === "/bundle.js" ? bundle : path === "/style.css" ? styles.css : path === "/katex.css" ? readFileSync(katexPath) : html });
    });
    try {
      await page.goto("https://reader-table.synthetic/");
      const table = page.locator(".reader-table-export"), rail = table.locator(".reader-table-actions");
      const copy = rail.getByRole("button", { name: /复制表格|Copy table/ });
      const download = rail.getByRole("button", { name: /下载表格|Download table/ });
      await expect(copy).toHaveCount(1);
      await expect(table.locator('input[type="checkbox"]')).toHaveCount(0);
      await expect(table.locator(".katex-mathml")).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      const initial = await table.boundingBox();
      assert.deepEqual(await page.evaluate(() => [window.tableReads, window.tableSerializations]), [0, 0]);
      if (width !== 375) {
        await expect(rail).toHaveCSS("opacity", "0");
        await table.hover();
      }
      await expect(rail).toHaveCSS("opacity", "1");
      assert.deepEqual(await page.evaluate(() => [window.tableReads, window.tableSerializations]), [0, 0]);
      const geometry = await table.evaluate(element => {
        const scroll = element.querySelector(".markdown-table").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - innerWidth,
          buttons: [...element.querySelectorAll("button")].map(button => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height, outsideCells: rect.left >= scroll.right, right: rect.right };
          }) };
      });
      assert.ok(geometry.overflow <= 1);
      assert.ok(geometry.buttons.every(button => button.width >= 44 && button.height >= 44 && button.outsideCells && button.right <= width));
      if (width === 375) await copy.tap();
      else { await copy.focus(); await page.keyboard.press("Enter"); }
      await expect(table.getByRole("status")).toContainText(locale === "zh-CN" ? "已复制" : "copied");
      assert.equal(await page.evaluate(() => window.tableReads), 1);
      assert.equal(await page.evaluate(() => window.tableSerializations), 1);
      const copied = await page.evaluate(() => window.clipboardWrites[0]);
      assert.ok(copied.startsWith("Item\tValue\tNotes\r\n"));
      assert.equal(copied.match(/\\frac\{x\}\{2\}/g)?.length, 1);
      assert.ok(copied.includes("'=1+1"));
      assert.ok(copied.includes("-12.5"));
      assert.ok(copied.includes('"first\nsecond, with ""quotes"""'));
      const afterCopy = await table.boundingBox();
      assert.ok(Math.abs(initial.height - afterCopy.height) <= 1 && Math.abs(initial.y - afterCopy.y) <= 1);
      await page.clock.runFor(3100);
      await expect(table.getByRole("status")).toBeEmpty();
      const screenshot = `table-${width}-${locale}-${theme}.png`;
      await page.screenshot({ path: join(out, screenshot), fullPage: true });
      const csvEvent = page.waitForEvent("download");
      await download.click();
      const csvDownload = await csvEvent;
      assert.equal(csvDownload.suggestedFilename(), "reader-table.csv");
      const csvPath = join(out, `table-${width}-${locale}-${theme}.csv`);
      await csvDownload.saveAs(csvPath);
      const csv = readFileSync(csvPath, "utf8");
      assert.ok(csv.startsWith("\uFEFFItem,Value,Notes\r\n"));
      assert.ok(csv.includes('"first\nsecond, with ""quotes"""'));
      await page.evaluate(() => { window.denyCopy = true; });
      await copy.click();
      const dialog = page.getByRole("dialog");
      const field = dialog.getByRole("textbox");
      // Textarea values normalize CRLF to LF; the actual CSV/source downloads
      // below still require exact bytes, and no cell/quote is discarded.
      const manualText = copied.replaceAll("\r\n", "\n");
      await expect(field).toHaveValue(manualText);
      await expect(field).toBeFocused();
      assert.deepEqual(await field.evaluate(input => [input.selectionStart, input.selectionEnd]), [0, manualText.length]);
      await page.clock.runFor(3100);
      await expect(dialog).toBeVisible();
      const sourceEvent = page.waitForEvent("download");
      await dialog.getByRole("button", { name: /下载原始 Markdown|Download original Markdown/ }).click();
      const sourceDownload = await sourceEvent, sourcePath = join(out, "source.md");
      await sourceDownload.saveAs(sourcePath);
      assert.equal(readFileSync(sourcePath, "utf8"), source);
      await expect(dialog).toHaveCount(0);
      await page.clock.runFor(10);
      await page.evaluate(() => { window.denyCopy = false; window.denyDownload = true; });
      await download.click();
      await expect(dialog).toContainText(locale === "zh-CN" ? "未能发起下载" : "could not be started");
      await page.keyboard.press("Escape");
      await page.clock.runFor(10);
      await expect(download).toBeFocused();
      // A delayed old copy result must not reappear in a new virtualization mount.
      await page.evaluate(() => { window.denyDownload = false; window.deferCopy = true; });
      await copy.click();
      await expect(copy).toBeDisabled();
      await expect(copy).toBeFocused();
      const pendingWrites = await page.evaluate(() => window.clipboardWrites.length);
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.clipboardWrites.length), pendingWrites, "a focused pending action must not resubmit");
      await page.evaluate(() => { window.remount(); });
      await expect(copy).toBeEnabled();
      await page.evaluate(() => { window.finishCopy(); window.deferCopy = false; });
      await expect(table.getByRole("status")).toBeEmpty();
      await page.evaluate(() => { window.setVariant("limit"); });
      const before = await page.evaluate(() => [window.tableSerializations, window.clipboardWrites.length]);
      await copy.focus(); await page.keyboard.press("Enter");
      await expect(dialog).toContainText("50,000");
      assert.deepEqual(await page.evaluate(() => [window.tableSerializations, window.clipboardWrites.length]), before);
      if (width === 375) await page.screenshot({ path: join(out, `table-recovery-${locale}-${theme}.png`), fullPage: true });
      const fallbackEvent = page.waitForEvent("download");
      await dialog.getByRole("button", { name: /下载原始 Markdown|Download original Markdown/ }).click();
      const fallback = await fallbackEvent, fallbackPath = join(out, "oversized-source.md");
      await fallback.saveAs(fallbackPath);
      assert.equal(readFileSync(fallbackPath, "utf8"), oversizedSource);
      await page.evaluate(() => { window.setVariant("density"); window.denyCopy = false; });
      const codeBlock = page.locator(".reader-code-block"), codeRail = codeBlock.locator(".reader-code-actions");
      const codeCopy = codeRail.getByRole("button", { name: /复制代码|Copy code/ });
      await expect(codeCopy).toHaveCount(1);
      await expect(codeBlock.getByText("text", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/部分内容预览|Partial content preview/, { exact: true })).toBeVisible();
      assert.equal(await page.locator(".attachment-preview").getByRole("button", { name: /打开|Open/ }).count(), 1);
      await page.getByRole("button", { name: /打开完整预览|Open full preview/ }).click();
      assert.equal(await page.evaluate(() => window.fullPreviewOpened), true);
      await codeBlock.scrollIntoViewIfNeeded();
      const beforeCode = await page.locator("#code-after").boundingBox();
      if (width !== 375) {
        await page.mouse.move(0, 0);
        await expect(codeRail).toHaveCSS("opacity", "0");
        await codeBlock.hover();
      }
      await expect(codeRail).toHaveCSS("opacity", "1");
      for (const target of await codeRail.getByRole("button").all()) {
        const rect = await target.boundingBox(); assert.ok(rect.width >= 44 && rect.height >= 44);
      }
      assert.ok(Math.abs((await page.locator("#code-after").boundingBox()).y - beforeCode.y) <= 1);
      await codeCopy.focus(); await page.keyboard.press("Enter");
      await expect(codeRail.getByRole("button", { name: /已复制|Copied/ })).toHaveCount(1);
      assert.equal(await page.evaluate(() => window.clipboardWrites.at(-1).split("\n").length), 90);
      await page.clock.runFor(3100); await expect(codeCopy).toHaveCount(1);
      await codeRail.getByRole("button", { name: /展开代码|Expand code/ }).click();
      assert.ok((await page.locator("#code-after").boundingBox()).y > beforeCode.y);
      await codeRail.getByRole("button", { name: /收起代码|Collapse code/ }).click();
      await page.evaluate(() => { window.denyCopy = true; });
      await codeCopy.click();
      const manualCode = codeBlock.getByRole("textbox");
      await expect(manualCode).toBeFocused();
      assert.equal((await manualCode.inputValue()).split("\n").length, 90);
      await page.clock.runFor(3100); await expect(manualCode).toBeVisible();
      await page.screenshot({ path: join(out, `density-${width}-${locale}-${theme}.png`), fullPage: true });
      results.push({ width, locale, theme, geometry, hoverHeightChange: afterCopy.height - initial.height, screenshot,
        code_hover_geometry: true, complete_code_manual_copy: true, single_attachment_open: true, partial_preview_disclosed: true });
    } catch (error) {
      await page.screenshot({ path: join(out, `failure-${width}-${locale}-${theme}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(out, "failure.json"), JSON.stringify({ width, locale, theme, error: String(error), errors, completed: results }, null, 2));
      throw error;
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({
    scope: "Actual Reader renderer, math, table actions and CSS; synthetic clipboard/download faults and oversized AST; controlled clock, no real user data",
    results, errors,
  }, null, 2));
  console.log(`Reader table actions browser: ${results.length} passed; ${out}`);
} finally { await browser.close(); }
