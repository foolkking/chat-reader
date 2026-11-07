// Actual owner control, slider, snap policy, query cache and CSS.
// API persistence/SVG conversion are explicit adapters; no server or user data.
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
const out = join(temp, "image-scale-slider-browser");
mkdirSync(out, { recursive: true });
const path = value => value.replaceAll("\\", "/");
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out, "adapters.mjs"), `
export class ApiRequestError extends Error {}
export const getAttachment=()=>{throw Error("No geometry reads in this control-only fixture");};
export async function getImageDisplay(){window.reads++;return {...window.display};}
export async function setImageDisplay(id,current,percent){
 if(current.scale_percent!==window.display.scale_percent)throw Error("Stale scale");
 window.writes.push(percent);
 await new Promise(resolve=>setTimeout(resolve,25));
 if(window.holdSave)await new Promise(resolve=>window.releaseSave=resolve);
 window.display={...window.display,scale_percent:percent,width:Math.max(1,Math.round(400*percent/100)),height:Math.max(1,Math.round(240*percent/100))};
 if(window.failNext){window.failNext=false;throw Error("Lost response after write");}
 return {...window.display};
}
export const uploadMessageCopyPreview=()=>{throw Error("PNG fixture must not rasterize");};
export const rasterizeCopySvg=uploadMessageCopyPreview;`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ImageDisplayControls} from ${JSON.stringify(path(join(web, "features/attachments/image-display-controls.tsx")))};
import {AttachmentAccessProvider} from ${JSON.stringify(path(join(web, "features/attachments/attachment-access.tsx")))};
window.reads=0;window.writes=[];window.display={source_sha256:"f".repeat(64),scale_percent:100,original_width:400,original_height:240,width:400,height:240,configured:true};
const attachment={id:"11111111-1111-4111-8111-111111111111",metadata:{image_display_v1:{...window.display}},asset_object:{sha256:"f".repeat(64),detected_mime_type:"image/png"}};
function Controls(){
 const [surface,setSurface]=useState("owner");window.setSurface=setSurface;
 const access=surface==="share"?{kind:"share",token:"synthetic-share"}:surface==="admin"?{kind:"admin",userId:"synthetic-admin"}:surface==="compare"?{kind:"owner",readOnly:true}:{kind:surface};
 return <AttachmentAccessProvider access={access}><ImageDisplayControls attachment={attachment} zh={window.zh??false} compact={surface!=="owner"} laneWidth={720} bodySize={{width:400,height:240}}/></AttachmentAccessProvider>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}>
 <style>{".synthetic-reader-toc{display:block!important}@media(max-width:639px){.synthetic-reader-toc{display:none!important}}"}</style>
 <aside className="reader-toc-column synthetic-reader-toc" style={{position:"fixed",right:0,top:0,bottom:0,width:240,zIndex:20,background:"var(--surface)"}}>Synthetic sticky section contents</aside>
 <main style={{padding:24,boxSizing:"border-box",width:"calc(100% - 24px)",transform:"translate(12px, 16px)"}}><figure style={{position:"relative",width:76,height:180,margin:"0 0 0 auto",background:"var(--subtle)",border:"1px solid var(--border)"}}>
 <Controls/></figure><button style={{marginTop:180}}>Outside</button></main>
</QueryClientProvider>);`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
const adapters = join(out, "adapters.mjs");
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"),
  output: { path: out, filename: "bundle.js" }, optimization: { minimize: false },
  resolve: {
    extensions: [".tsx", ".ts", ".mjs", ".js"],
    modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: {
      "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom$": require.resolve("react-dom"), "react-dom/client$": require.resolve("react-dom/client"),
      "../../lib/api$": adapters, "../conversations/message-markdown-copy-prepare$": adapters,
    },
  },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [join(web, "features/attachments/image-display-controls.tsx"), join(web, "features/attachments/image-scale-slider.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const { chromium, expect } = require("@playwright/test");
const results = [];
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
try {
  for (const width of [1440, 800, 375]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ theme }) => { window.zh = theme === "dark"; document.addEventListener("DOMContentLoaded", () => document.documentElement.dataset.theme = theme); }, { theme });
    await page.route("http://image-scale.synthetic/**", route => {
      const name = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: name === "/bundle.js" ? "text/javascript" : name === "/style.css" ? "text/css" : "text/html",
        body: name === "/bundle.js" ? bundle : name === "/style.css" ? styles.css : html });
    });
    await page.goto("http://image-scale.synthetic/");
    const trigger = page.getByRole("button", { name: /Image display scale:|图片展示比例：/ });
    const slider = page.getByRole("slider");
    const preset = percent => page.getByRole("button", { name: `${percent}%`, exact: true });
    // Keep the trigger exposed but put the wider menu in the sticky rail's
    // default footprint. The real Reader CI trace reproduced this occlusion.
    if (width >= 640) await page.locator(".synthetic-reader-toc").evaluate(node => node.style.top = "208px");
    await trigger.click();
    await expect(slider).toHaveValue("100");
    const panel = await page.locator(".image-display-menu").boundingBox();
    const anchor = await trigger.boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width && panel.y >= 0 && panel.y + panel.height <= 801);
    if (width >= 640) {
      const rail = await page.locator(".synthetic-reader-toc").boundingBox();
      assert.ok(panel.x + panel.width <= rail.x, "sticky TOC must not intercept menu clicks");
    }
    for (const percent of [25, 50, 75, 100]) {
      const box = await preset(percent).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    await preset(50).click();
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(50);
    await expect(slider).toBeEnabled();
    const numeric = page.getByRole("spinbutton");
    for (const method of ["click", "tap"]) {
      const count = await page.evaluate(() => window.writes.length);
      await numeric.fill("30");
      await expect(page.locator(".image-save-status")).toContainText(/not saved|尚未保存/);
      await preset(75)[method]();
      await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(75);
      await expect(slider).toBeEnabled();
      assert.equal(await page.evaluate(() => window.writes.length), count + 1, "number blur must not submit before a clicked/tapped preset");
      await preset(50).click();
      await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(50);
      await expect(slider).toBeEnabled();
    }
    const beforeKeyboard = await page.evaluate(() => window.writes.length);
    await numeric.fill("31");
    for (let step = 0; step < 4; step++) await page.keyboard.press("Tab");
    await expect(preset(75)).toBeFocused();
    assert.equal(await page.evaluate(() => window.writes.length), beforeKeyboard, "keyboard hand-off must not commit the abandoned number");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(75);
    await expect(slider).toBeEnabled();
    assert.equal(await page.evaluate(() => window.writes.length), beforeKeyboard + 1);
    const beforeBlur = await page.evaluate(() => window.writes.length);
    await numeric.fill("60");
    await page.getByRole("button", { name: /Close image size|关闭尺寸面板/ }).click();
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(60);
    assert.equal(await page.evaluate(() => window.writes.length), beforeBlur + 1, "leaving the size choices still commits once");
    await trigger.click();
    await expect(slider).toBeEnabled();
    const beforeFit = await page.evaluate(() => window.writes.length);
    await numeric.fill("33");
    await page.getByRole("button", { name: /Fit current column|适合当前栏宽/ }).click();
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(100);
    await expect(slider).toBeEnabled();
    assert.equal(await page.evaluate(() => window.writes.length), beforeFit + 1);
    const beforeNumber = await page.evaluate(() => window.writes.length);
    await numeric.fill("50"); await numeric.press("Enter");
    await expect(slider).toBeEnabled(); await numeric.press("Tab");
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(50);
    assert.equal(await page.evaluate(() => window.writes.length), beforeNumber + 1, "Enter then blur must not submit twice");
    await slider.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(51);
    await expect(slider).toBeEnabled();
    // On mobile the bottom sheet deliberately covers the lower page. Use a
    // real exposed outside point, not an auto-scrolling covered page button.
    await page.mouse.click(4, 8);
    await expect(page.locator(".image-display-menu")).toHaveCount(0);
    await trigger.click();
    await expect(slider).toHaveValue("51");
    const box = await slider.boundingBox(), y = box.y + box.height / 2;
    const x = percent => box.x + 12 + (percent - 1) / 99 * (box.width - 24);
    const before = await page.evaluate(() => window.writes.length);
    await numeric.fill("33");
    await page.mouse.move(x(35), y); await page.mouse.down();
    await page.mouse.move(x(47), y);
    await expect(slider).toHaveValue("50");
    await expect(page.locator(".image-save-status")).toContainText(/not saved|尚未保存/);
    assert.equal(await page.evaluate(() => window.writes.length), before, "drag must not write per movement");
    await page.waitForTimeout(150); // A pause on a magnet must not undo it on release.
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.writes.length)).toBe(before + 1);
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(50);
    await expect(slider).toBeEnabled();
    await page.mouse.move(x(50), y); await page.mouse.down();
    await page.waitForTimeout(150); // Explicitly exercise slow fine adjustment.
    await page.mouse.move(x(51), y);
    await expect(slider).toHaveValue("51");
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(51);
    await expect(slider).toBeEnabled();
    const cancelledBefore = await page.evaluate(() => window.writes.length);
    await page.mouse.move(x(35), y); await page.mouse.down(); await page.mouse.move(x(40), y);
    await page.keyboard.press("Escape"); await page.mouse.up();
    await expect(slider).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.equal(await page.evaluate(() => window.writes.length), cancelledBefore);
    await trigger.click();
    await expect(slider).toHaveValue("51");
    await page.evaluate(() => window.failNext = true);
    await preset(75).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(slider).toBeDisabled();
    const failedWrites = await page.evaluate(() => window.writes.length);
    const failedReads = await page.evaluate(() => window.reads);
    await page.getByRole("button", { name: /Close image size|关闭尺寸面板/ }).click();
    await trigger.click();
    await expect(slider).toBeDisabled();
    assert.equal(await page.evaluate(() => window.reads), failedReads, "reopening must not silently resolve an uncertain write");
    await page.getByRole("button", { name: /Close image size|关闭尺寸面板/ }).click();
    for (const surface of ["offline", "share", "admin", "compare"]) {
      await page.evaluate(surface => window.setSurface(surface), surface);
      await page.getByRole("button", { name: /Image options|图片选项/ }).click();
      await expect(page.getByRole("slider")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Check result|核对结果/ })).toHaveCount(0);
      await expect(page.locator(".image-save-status")).toBeEmpty();
      // Compare is the same owner read authority and may use the last confirmed
      // 51%; it still must never inherit writable recovery. Other scopes use
      // their own immutable 100% snapshot, not the owner cache.
      await expect(page.locator(".image-dimensions dd").nth(1)).toHaveText(surface === "compare" ? "204 × 122" : "400 × 240");
      assert.equal(await page.evaluate(() => window.reads), failedReads, "read-only scope must not consult the owner endpoint");
      assert.equal(await page.evaluate(() => window.writes.length), failedWrites);
      await page.getByRole("button", { name: /Close image size|关闭尺寸面板/ }).click();
    }
    await page.evaluate(() => window.setSurface("owner"));
    await trigger.click();
    await expect(page.getByRole("alert")).toBeVisible();
    assert.equal(await page.evaluate(() => window.reads), failedReads, "owner uncertainty survives authority remounts without an automatic read");
    await page.getByRole("button", { name: /Check result|核对结果/ }).click();
    await expect(slider).toHaveValue("75");
    assert.equal(await page.evaluate(() => window.writes.length), failedWrites, "unknown write recovery reads only");
    const touchBox = await slider.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = percent => [{ x: touchBox.x + 12 + (percent - 1) / 99 * (touchBox.width - 24), y: touchBox.y + touchBox.height / 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(35) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(47) });
    await expect(slider).toHaveValue("50");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(50);
    assert.equal(await page.evaluate(() => window.writes.length), failedWrites + 1);
    await expect(slider).toBeEnabled();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(60) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(64) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(slider).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.writes.length), failedWrites + 1);
    await trigger.click();
    await expect(slider).toHaveValue("50");
    await preset(100).click();
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(100);
    await expect(slider).toBeEnabled();
    await expect(slider).toHaveAttribute("aria-valuetext", "100%");
    await page.evaluate(() => window.holdSave = true);
    const pendingWrites = await page.evaluate(() => window.writes.length);
    await preset(25).click();
    await expect(slider).toBeDisabled();
    await page.getByRole("button", { name: /Close image size|关闭尺寸面板/ }).click();
    await trigger.click();
    await expect(slider).toBeDisabled();
    await expect.poll(() => page.evaluate(() => typeof window.releaseSave)).toBe("function");
    await page.evaluate(() => { window.holdSave = false; window.releaseSave(); });
    await expect(slider).toHaveValue("25");
    await expect(slider).toBeEnabled();
    assert.equal(await page.evaluate(() => window.writes.length), pendingWrites + 1, "closing/reopening pending save cannot resend or cancel it");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(out, `${width}-${theme}.png`) });
    await trigger.click();
    await page.locator(".synthetic-reader-toc").evaluate(node => node.remove());
    await page.locator("figure").evaluate(node => node.style.marginTop = "540px");
    await trigger.click();
    await expect(slider).toBeEnabled();
    const edge = await page.locator(".image-display-menu").boundingBox();
    assert.ok(edge.y >= 0 && edge.y + edge.height <= 801, "bottom-edge controls must remain reachable");
    results.push({ width, theme, status: "passed", checks: ["downward/clamped panel", "translated containing block", "sticky rail avoidance", "44px stops", "preset persistence", "number to mouse/touch preset", "number to column fit", "Enter/blur deduplication", "number to slider hand-off", "draft is not saved", "1% keyboard", "fast magnet", "one write on release", "slow escape", "Escape cancellation", "read-only scope isolation", "read-only unknown-write recovery", "trusted touch commit/cancel", "100% original", "pending close/reopen without resend", "no overflow/errors", "bottom-edge visibility"] });
    await page.close();
  }
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "passed", results, adapters: ["API persistence", "surrounding image/Reader"] }, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: results.length, out }));
} finally { await browser.close(); }
