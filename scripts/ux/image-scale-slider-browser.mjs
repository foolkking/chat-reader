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
export async function getImageDisplay(){window.reads++;return {...window.display};}
export async function setImageDisplay(id,current,percent){
 if(current.scale_percent!==window.display.scale_percent)throw Error("Stale scale");
 window.writes.push(percent);
 await new Promise(resolve=>setTimeout(resolve,25));
 window.display={...window.display,scale_percent:percent,width:Math.max(1,Math.round(400*percent/100)),height:Math.max(1,Math.round(240*percent/100))};
 if(window.failNext){window.failNext=false;throw Error("Lost response after write");}
 return {...window.display};
}
export const uploadMessageCopyPreview=()=>{throw Error("PNG fixture must not rasterize");};
export const rasterizeCopySvg=uploadMessageCopyPreview;`);
writeFileSync(join(out, "entry.tsx"), `
import React from "react";import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ImageDisplayControls} from ${JSON.stringify(path(join(web, "features/attachments/image-display-controls.tsx")))};
window.reads=0;window.writes=[];window.display={source_sha256:"f".repeat(64),scale_percent:100,original_width:400,original_height:240,width:400,height:240,configured:true};
const attachment={id:"11111111-1111-4111-8111-111111111111",metadata:{},asset_object:{sha256:"f".repeat(64),detected_mime_type:"image/png"}};
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}>
 <main style={{padding:24}}><figure style={{position:"relative",width:76,height:180,margin:0,background:"var(--subtle)",border:"1px solid var(--border)"}}>
 <ImageDisplayControls attachment={attachment} zh={window.zh??false}/></figure><button style={{marginTop:180}}>Outside</button></main>
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
  for (const width of [1440, 375]) for (const theme of ["light", "dark"]) {
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
    await trigger.click();
    await expect(slider).toHaveValue("100");
    const panel = await page.locator(".image-display-menu").boundingBox();
    const anchor = await trigger.boundingBox();
    assert.ok(panel.x >= 16 && panel.x + panel.width <= width - 16 && panel.y >= anchor.y + anchor.height);
    for (const percent of [25, 50, 75, 100]) {
      const box = await preset(percent).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    await preset(50).click();
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(50);
    await expect(slider).toBeEnabled();
    await slider.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => window.display.scale_percent)).toBe(51);
    await expect(slider).toBeEnabled();
    await page.getByRole("button", { name: "Outside" }).click();
    await trigger.click();
    await expect(slider).toHaveValue("51");
    const box = await slider.boundingBox(), y = box.y + box.height / 2;
    const x = percent => box.x + 12 + (percent - 1) / 99 * (box.width - 24);
    const before = await page.evaluate(() => window.writes.length);
    await page.mouse.move(x(35), y); await page.mouse.down();
    await page.mouse.move(x(47), y);
    await expect(slider).toHaveValue("50");
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
    await expect(slider).toHaveCount(0);
    const failedWrites = await page.evaluate(() => window.writes.length);
    await page.getByRole("button", { name: /Retry|重试/ }).click();
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
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(out, `${width}-${theme}.png`) });
    await trigger.click();
    await page.locator("figure").evaluate(node => node.style.marginTop = "540px");
    await trigger.click();
    await expect(slider).toBeEnabled();
    const edge = await page.locator(".image-display-menu").boundingBox();
    assert.ok(edge.y >= 16 && edge.y + edge.height <= 784, "bottom-edge controls must remain reachable");
    results.push({ width, theme, status: "passed", checks: ["downward/clamped panel", "44px stops", "preset persistence", "1% keyboard", "fast magnet", "one write on release", "slow escape", "Escape cancellation", "read-only unknown-write recovery", "trusted touch commit/cancel", "100% restore", "no overflow/errors", "bottom-edge visibility"] });
    await page.close();
  }
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "passed", results, adapters: ["API persistence", "surrounding image/Reader"] }, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: results.length, out }));
} finally { await browser.close(); }
