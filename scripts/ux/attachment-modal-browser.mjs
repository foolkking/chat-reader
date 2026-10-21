// Mounted, service-free regression for the actual Viewer/Vaul/Reader Escape
// lifecycle. API data and unrelated renderers are explicit synthetic adapters.
// No account, database, server process or production data is used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "apps/web");
const appRequire = createRequire(join(web, "package.json"));
const tempRoot = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") {
  assert.match(tempRoot.toLowerCase().replaceAll("\\", "/"), /^c:\/users\/86182\/desktop\/wkkk\/[^/]+/);
} else {
  assert.ok(process.env.RUNNER_TEMP || process.env.TEMP, "An explicit task temporary directory is required");
}
const phase = (process.env.ATTACHMENT_MODAL_PHASE ?? "final").replace(/[^a-z0-9-]/gi, "-");
const out = join(tempRoot, `attachment-modal-${phase}`);
mkdirSync(out, { recursive: true });
const resultPath = join(out, "result.json");
const startedAt = new Date().toISOString();
const results = [];
const sources = Object.fromEntries([
  "apps/web/features/attachments/attachment-viewer.tsx",
  "apps/web/features/conversations/conversation-reader.tsx",
  "apps/web/components/mobile-reader-sheet.tsx",
  "apps/web/components/use-dialog-focus.ts",
  "scripts/ux/attachment-modal-browser.mjs",
].map(path => [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]));
writeFileSync(resultPath, JSON.stringify({ startedAt, status: "not_completed", phase }, null, 2));
const ts = appRequire("typescript");
const readerSource = ts.createSourceFile("conversation-reader.tsx",
  readFileSync(join(web, "features/conversations/conversation-reader.tsx"), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let escapeEffect;
const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(readerSource) === "useEffect"
    && node.arguments[0]?.getText(readerSource).includes("const closeTopSurface =")) escapeEffect = node;
  ts.forEachChild(node, visit);
};
visit(readerSource);
assert.ok(escapeEffect, "Use the actual Reader Escape owner, not a parallel implementation");
writeFileSync(join(out, "ts-loader.cjs"), `
const ts = require(${JSON.stringify(appRequire.resolve("typescript"))});
module.exports = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX
}}).outputText;`);
writeFileSync(join(out, "adapters.mjs"), `
import React from "react";
const outsideScope=()=>{throw Error("Unexpected mutation or renderer in the modal gate");};
export const usePreferences=()=>({resolvedLocale:window.gateLocale??"en-US",t:key=>key});
export const useInteractionDialog=()=>({confirm:outsideScope,prompt:outsideScope});
export const getAttachment=async()=>window.syntheticAttachment;
export const getConversationAttachments=async()=>[window.syntheticAttachment];
export const getCapabilities=async()=>({attachments:{upload_enabled:false}});
export const getOfflineAttachment=outsideScope,releaseOfflineAttachmentUrls=outsideScope;
export const createAttachmentUploadSession=outsideScope,deleteConversationAttachment=outsideScope,
  finalizeConversationAttachments=outsideScope,updateConversationAttachment=outsideScope,
  uploadAttachmentItem=outsideScope,loadPdfJs=outsideScope;
export const MarkdownRenderer=outsideScope,ComplexAttachmentViewer=outsideScope;
export default outsideScope;`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MobileReaderSheet} from ${JSON.stringify(join(web, "components/mobile-reader-sheet.tsx"))};
import {ConversationFilesPanel} from ${JSON.stringify(join(web, "features/attachments/conversation-files-panel.tsx"))};
import {AttachmentViewerProvider} from ${JSON.stringify(join(web, "features/attachments/attachment-viewer.tsx"))};
window.syntheticAttachment={
  id:"synthetic-empty",display_name:"empty.txt",original_filename:"empty.txt",
  detected_mime_type:"text/plain",declared_mime_type:"text/plain",
  asset_object:{id:"synthetic-object",byte_size:0},resolution_status:"resolved",
  content_url:"/synthetic-empty",download_url:null,status:"available",
  scan_status:"unscanned",created_at:"2026-10-21T00:00:00Z",
  occurrences:[],is_used:false,occurrence_count:0
};
function Files(){
  const [utilityPanel,updateUtilityPanel]=useState(null);
  const setUtilityPanel=value=>{window.modalEvents?.push({kind:"set-panel",value});updateUtilityPanel(value);};
  const conversationId="synthetic-conversation",showFiles=false;
  const showExport=false,showSearch=false,showShare=false;
  const desktopActionsExpanded=false,mobileActionsExpanded=false;
  const setShowFiles=()=>{throw Error("Unexpected desktop close");};
  const setDesktopActionsExpanded=()=>{},setMobileActionsExpanded=()=>{};
  const releaseExportScope=()=>{throw Error("Unexpected export close");};
  ${escapeEffect.getText(readerSource)};
  return <main>
    <button id="open-files" data-reader-focus-fallback onClick={()=>setUtilityPanel("files")}>Open files</button>
    <MobileReaderSheet open={utilityPanel==="files"} title="Synthetic files"
      onOpenChange={open=>{window.modalEvents?.push({kind:"drawer-open-change",open});if(!open)setUtilityPanel(null);}}
      restoreFocus={()=>document.getElementById("open-files")}>
      <ConversationFilesPanel conversationId={conversationId}
        onLocate={()=>{throw Error("Unexpected navigation");}}
        onInsert={()=>{throw Error("Unexpected insertion");}}/>
    </MobileReaderSheet>
  </main>;
}
const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById("root")).render(<React.StrictMode>
  <QueryClientProvider client={queryClient}>
    <AttachmentViewerProvider><Files/></AttachmentViewerProvider>
  </QueryClientProvider>
</React.StrictMode>);`);
const webpack = appRequire("next/dist/compiled/webpack/webpack").webpack;
const adapters = join(out, "adapters.mjs");
await new Promise((yes, no) => webpack({
  mode: "production",
  context: root,
  entry: join(out, "entry.tsx"),
  output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: {
    extensions: [".tsx", ".ts", ".mjs", ".js"],
    modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: {
      "react$": appRequire.resolve("react"),
      "react/jsx-runtime$": appRequire.resolve("react/jsx-runtime"),
      "react-dom$": appRequire.resolve("react-dom"),
      "react-dom/client$": appRequire.resolve("react-dom/client"),
      "../../components/preferences-provider$": adapters,
      "../../components/interaction-dialog-provider$": adapters,
      "../../lib/api$": adapters,
      "../../lib/offline-db$": adapters,
      "../conversations/markdown-renderer$": adapters,
      "./pdfjs-runtime$": adapters,
      "./complex-attachment-viewer$": adapters,
    },
  },
  module: {
    parser: { javascript: { dynamicImportMode: "eager" } },
    rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "ts-loader.cjs") }],
  },
}, (error, stats) => error || stats.hasErrors()
  ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const postcss = appRequire("postcss");
const tailwind = appRequire("tailwindcss");
const styles = await postcss([tailwind({
  content: [
    join(web, "components/mobile-reader-sheet.tsx"),
    join(web, "features/attachments/conversation-files-panel.tsx"),
    join(web, "features/attachments/attachment-viewer.tsx"),
  ],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"),
  { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"), "utf8");
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = appRequire("@playwright/test");
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? { channel: "chromium" } : { channel: "chrome" }),
  });
  for (const locale of ["zh-CN", "en-US"]) {
    const page = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(locale => {
      window.gateLocale = locale;
      window.modalEvents = [];
      for (const kind of ["pointerdown", "pointerup", "click", "focusin", "keydown"]) {
        for (const capture of [true, false]) document.addEventListener(kind, event => {
          window.modalEvents.push({ kind, capture, key: event.key, prevented: event.defaultPrevented,
            target: event.target?.getAttribute?.("aria-label") ?? event.target?.tagName });
        }, capture);
      }
    }, locale);
    await page.route("http://modal.synthetic/**", route => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({
        contentType: pathname === "/bundle.js" ? "text/javascript" : pathname === "/style.css" ? "text/css" : "text/html",
        body: pathname === "/bundle.js" ? bundle : pathname === "/style.css" ? styles.css : html,
      });
    });
    await page.goto("http://modal.synthetic/");
    const panel = page.getByTestId("conversation-files-panel");
    const viewer = page.getByTestId("attachment-viewer-shell");
    const preview = panel.getByRole("button", { name: /^(Preview|预览)$/ });
    const selected = panel.getByRole("checkbox", { name: /^(Select|选择) empty.txt$/ });
    const search = panel.getByPlaceholder(/^(Search files|搜索文件)$/);
    const run = async (name, action) => {
      try { await action(); }
      catch (error) {
        writeFileSync(resultPath, JSON.stringify({ startedAt, phase, sources, status: "failed", passed: results, failed: `${locale}: ${name}`, errors,
          diagnostic: await page.locator("body").innerText(),
          events: await page.evaluate(() => window.modalEvents.slice(-50)),
        }, null, 2));
        await page.screenshot({ path: join(out, `${locale}-failed.png`) });
        throw error;
      }
      results.push(`${locale}: ${name}`);
      console.log("PASS " + results.at(-1));
    };
    let originalPanel;
    await run("mount actual mobile files sheet and viewer", async () => {
      await page.locator("#open-files").click();
      await expect(panel).toBeVisible();
      originalPanel = await panel.evaluateHandle(node => node);
      await search.fill("empty", { timeout: 5_000 });
      await selected.check();
      await preview.click();
    });
    const close = viewer.getByRole("button", { name: /^(Close attachment viewer|关闭附件查看器)$/ });
    await expect(close).toBeFocused();
    await run("Escape closes only Viewer and restores retained panel, filter and selection", async () => {
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0, { timeout: 5_000 });
      await expect(panel).toBeVisible({ timeout: 5_000 });
      await expect(preview).toBeFocused();
      assert.equal(await panel.evaluate((node, original) => node === original, originalPanel), true);
      await expect(search).toHaveValue("empty");
      await expect(selected).toBeChecked();
      await expect(page.locator("[data-vaul-overlay]")).toHaveCount(1);
    });
    await run("second Escape closes the returned sheet and restores its opener", async () => {
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0, { timeout: 5_000 });
      await expect(page.locator("#open-files")).toBeFocused();
    });
    await page.locator("#open-files").click();
    await preview.click();
    await expect(close).toBeFocused();
    await run("composing and child-handled Escape do not close either modal", async () => {
      await close.dispatchEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
      await expect(viewer).toBeVisible();
      await close.dispatchEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true, cancelable: true });
      await expect(viewer).toBeVisible();
      await close.evaluate(node => node.addEventListener("keydown", event => {
        if (event.key === "Escape") event.preventDefault();
      }, { once: true }));
      await page.keyboard.press("Escape");
      await expect(viewer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0, { timeout: 5_000 });
      await expect(preview).toBeFocused();
    });
    await run("close button returns to the same preview without remounting the panel", async () => {
      const retainedPanel = await panel.evaluateHandle(node => node);
      await preview.click();
      await expect(close).toBeFocused();
      await close.click();
      await expect(viewer).toHaveCount(0);
      await expect(preview).toBeFocused();
      assert.equal(await panel.evaluate((node, original) => node === original, retainedPanel), true);
      await retainedPanel.dispose();
      const drawer = page.locator("[data-vaul-drawer]").filter({ has: panel });
      await expect(drawer).toHaveJSProperty("inert", false);
      await page.screenshot({ path: join(out, `${locale}-returned.png`) });
    });
    await run("touch close does not deliver a deferred outside click to the drawer", async () => {
      const retainedPanel = await panel.evaluateHandle(node => node);
      await preview.tap();
      await expect(close).toBeFocused();
      await close.tap();
      await expect(viewer).toHaveCount(0);
      await expect(preview).toBeFocused();
      assert.equal(await panel.evaluate((node, original) => node === original, retainedPanel), true);
      await retainedPanel.dispose();
    });
    assert.deepEqual(errors, []);
    await originalPanel.dispose();
    await page.close();
  }
  writeFileSync(resultPath, JSON.stringify({ startedAt, completedAt: new Date().toISOString(),
    phase, sources, status: "passed", passed: results, count: results.length,
    boundary: "Mounted Chromium/React/Vaul/Viewer with synthetic query data; not API/auth/offline-package acceptance.",
  }, null, 2));
} finally {
  await browser?.close();
}
