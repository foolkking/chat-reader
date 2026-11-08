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
 window.display={...window.display,configured:true,scale_percent:percent,width:Math.max(1,Math.round(window.display.original_width*percent/100)),height:Math.max(1,Math.round(window.display.original_height*percent/100))};
 if(window.failNext){window.failNext=false;window.writeResults.push({percent,status:"unconfirmed"});throw Error("Lost response after write");}
 window.writeResults.push({percent,status:"acknowledged"});
 return {...window.display};
}
export const uploadMessageCopyPreview=()=>{throw Error("PNG fixture must not rasterize");};
export const rasterizeCopySvg=uploadMessageCopyPreview;`);
writeFileSync(join(out, "entry.tsx"), `
import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ImageDisplayControls} from ${JSON.stringify(path(join(web, "features/attachments/image-display-controls.tsx")))};
import {AttachmentAccessProvider} from ${JSON.stringify(path(join(web, "features/attachments/attachment-access.tsx")))};
window.reads=0;window.writes=[];window.writeResults=[];window.display={source_sha256:"f".repeat(64),scale_percent:100,original_width:400,original_height:240,width:400,height:240,configured:true};
const attachment={id:"11111111-1111-4111-8111-111111111111",metadata:{image_display_v1:{...window.display}},asset_object:{sha256:"f".repeat(64),detected_mime_type:"image/png"}};
function Controls(){
 const [surface,setSurface]=useState("owner");window.setSurface=setSurface;
 const [legacy,setLegacy]=useState(false);
 window.useLegacy=()=>{window.display={source_sha256:"a".repeat(64),scale_percent:100,original_width:1200,original_height:800,width:1200,height:800,configured:false};setLegacy(true);};
 const shown=legacy?{...attachment,id:"22222222-2222-4222-8222-222222222222",metadata:{image_geometry_v1:{source_sha256:"a".repeat(64),original_width:1200,original_height:800}},asset_object:{...attachment.asset_object,sha256:"a".repeat(64)}}:attachment;
 const access=surface==="share"?{kind:"share",token:"synthetic-share"}:surface==="admin"?{kind:"admin",userId:"synthetic-admin"}:surface==="compare"?{kind:"owner",readOnly:true}:{kind:surface};
 return <AttachmentAccessProvider access={access}><ImageDisplayControls attachment={shown} zh={window.zh??false} compact={surface!=="owner"} laneWidth={720} bodySize={{width:400,height:240}}/></AttachmentAccessProvider>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}>
 <style>{".synthetic-reader-toc{display:block!important}.synthetic-reader-content{padding:24px;box-sizing:border-box;width:calc(100% - 264px);transform:translate(12px,16px)}@media(max-width:639px){.synthetic-reader-toc{display:none!important}.synthetic-reader-content{width:calc(100% - 24px)}}"}</style>
 <aside className="reader-toc-column synthetic-reader-toc" style={{position:"fixed",right:0,top:0,bottom:0,width:240,zIndex:20,background:"var(--surface)"}}>Synthetic sticky section contents</aside>
 <main className="synthetic-reader-content"><figure style={{position:"relative",width:76,margin:"0 0 0 auto",background:"var(--subtle)",border:"1px solid var(--border)"}}>
 <div aria-hidden="true" style={{height:180}}/><Controls/></figure><button style={{marginTop:180}}>Outside</button></main>
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
let activePage, activeCase, activeStep;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
try {
  for (const width of [1440, 800, 375]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: true });
    activePage = page; activeCase = { width, theme };
    activeStep = "open disclosure";
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ theme }) => {
      window.zh = theme === "dark";
      window.inputEvents = [];
      document.addEventListener("DOMContentLoaded", () => document.documentElement.dataset.theme = theme);
      for (const type of ["keydown", "keyup", "pointerdown", "pointerup", "pointercancel", "focusin", "focusout"]) {
        document.addEventListener(type, event => {
          const target = event.target;
          if (!(target instanceof HTMLElement) || !target.matches(".image-scale-range, .image-display-trigger")) return;
          window.inputEvents.push({ type, key: event.key, value: target.value,
            disabled: target.disabled, trusted: event.isTrusted, at: Math.round(performance.now()) });
          if (window.inputEvents.length > 160) window.inputEvents.shift();
        }, true);
      }
    }, { theme });
    await page.route("http://image-scale.synthetic/**", route => {
      const name = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: name === "/bundle.js" ? "text/javascript" : name === "/style.css" ? "text/css" : "text/html",
        body: name === "/bundle.js" ? bundle : name === "/style.css" ? styles.css : html });
    });
    await page.goto("http://image-scale.synthetic/");
    const trigger = page.getByRole("button", { name: /Image display scale:|图片展示比例：/ });
    const slider = page.getByRole("slider");
    const acknowledged = async (percent, count) => {
      // Query notifications and the disabled attribute are asynchronous. An
      // enabled snapshot immediately after keyup can still precede "saving".
      // Wait for this exact write's acknowledgement before the next gesture.
      await expect.poll(() => page.evaluate(() => window.writeResults)).toHaveLength(count);
      assert.deepEqual(await page.evaluate(() => window.writeResults.at(-1)), { percent, status: "acknowledged" });
      assert.equal(await page.evaluate(() => window.writes.length), count, "one gesture must submit exactly once");
      assert.equal(await page.evaluate(() => window.display.scale_percent), percent);
      await expect(page.getByRole("status")).toHaveText(theme === "dark" ? "已保存" : "Saved");
      await expect(trigger).toHaveAccessibleName(theme === "dark" ? `图片展示比例：${percent}%` : `Image display scale: ${percent}%`);
    };
    const choose = async (percent, outcome = "acknowledged") => {
      await expect(slider).toBeEnabled(); await slider.focus();
      const before = await page.evaluate(() => window.writes.length);
      const endpoint = percent === 100 ? "End" : "Home";
      await page.keyboard.down(endpoint);
      if (percent < 100) for (let step = 1; step < percent; step++) await page.keyboard.down("ArrowRight");
      await expect(slider).toHaveValue(String(percent));
      assert.equal(await page.evaluate(() => window.writes.length), before, "keyboard repeats change only the draft");
      if (percent > 1 && percent < 100) await page.keyboard.up("ArrowRight");
      await page.keyboard.up(endpoint);
      await expect.poll(() => page.evaluate(() => window.writes.length)).toBe(before + 1);
      if (outcome === "acknowledged") {
        await acknowledged(percent, before + 1);
        await expect(slider).toBeEnabled();
        await expect(slider).toHaveValue(String(percent));
      } else {
        assert.ok(["unconfirmed", "pending"].includes(outcome));
        await expect(slider).toBeDisabled();
        if (outcome === "unconfirmed") {
          await expect.poll(() => page.evaluate(() => window.writeResults)).toHaveLength(before + 1);
          assert.deepEqual(await page.evaluate(() => window.writeResults.at(-1)), { percent, status: "unconfirmed" });
        } else assert.equal(await page.evaluate(() => window.writeResults.length), before);
      }
    };
    // Reserve the sticky rail's column as Reader does. Keep the obstacle and
    // real pointer hit-testing rather than force-clicking an occluded trigger.
    await expect(trigger).toBeVisible();
    const rail = page.locator(".synthetic-reader-toc");
    if (await rail.isVisible()) {
      const triggerBox = await trigger.boundingBox(), railBox = await rail.boundingBox();
      assert.ok(triggerBox.x + triggerBox.width <= railBox.x, "Reader content must not extend underneath the contents rail");
    }
    await trigger.click();
    await expect(slider).toBeEnabled();
    const panel = await page.locator(".image-scale-disclosure").boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width && panel.y >= 0 && panel.y + panel.height <= 801);
    assert.ok(panel.height <= 64, "only a compact slider, never a dialog/sheet");
    const triggerBox = await trigger.boundingBox();
    assert.ok(panel.y + panel.height <= triggerBox.y, "the ordinary image footer leaves room for the upward disclosure");
    if (await rail.isVisible()) {
      const railBox = await rail.boundingBox();
      assert.ok(panel.x + panel.width <= railBox.x || panel.x >= railBox.x + railBox.width, "the disclosure must avoid the sticky contents rail");
    }
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.getByRole("spinbutton").count(), 0);
    assert.ok((await slider.boundingBox()).height >= 44);
    activeStep = "keyboard draft and column fit";
    await choose(50);
    const beforeFit = await page.evaluate(() => window.writes.length);
    await page.getByRole("button", { name: /Fit column|适应栏宽/ }).click();
    await acknowledged(100, beforeFit + 1);
    await trigger.click();
    await expect(slider).toBeEnabled();
    activeStep = "consecutive keyboard saves 50 then 51";
    await choose(50);
    const beforeArrow = await page.evaluate(() => window.writes.length);
    await slider.press("ArrowRight");
    await acknowledged(51, beforeArrow + 1);
    await expect(slider).toBeEnabled();
    await page.mouse.click(4, 8);
    await expect(page.locator(".image-scale-disclosure")).toHaveCount(0);
    await trigger.click();
    await expect(slider).toHaveValue("51");
    const box = await slider.boundingBox(), y = box.y + box.height / 2;
    const x = percent => box.x + 12 + (percent - 1) / 99 * (box.width - 24);
    activeStep = "pointer magnet, fine adjustment and cancellation";
    const before = await page.evaluate(() => window.writes.length);
    await page.mouse.move(x(35), y); await page.mouse.down();
    await page.mouse.move(x(47), y);
    await expect(slider).toHaveValue("50");
    assert.equal(await page.evaluate(() => window.writes.length), before, "drag must not write per movement");
    await page.waitForTimeout(150); // A pause on a magnet must not undo it on release.
    await page.mouse.up();
    await acknowledged(50, before + 1);
    await expect(slider).toBeEnabled();
    await page.mouse.move(x(50), y); await page.mouse.down();
    await page.waitForTimeout(150); // Explicitly exercise slow fine adjustment.
    await page.mouse.move(x(51), y);
    await expect(slider).toHaveValue("51");
    await page.mouse.up();
    await acknowledged(51, before + 2);
    await expect(slider).toBeEnabled();
    const cancelledBefore = await page.evaluate(() => window.writes.length);
    await page.mouse.move(x(35), y); await page.mouse.down(); await page.mouse.move(x(40), y);
    await page.keyboard.press("Escape"); await page.mouse.up();
    await expect(slider).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.equal(await page.evaluate(() => window.writes.length), cancelledBefore);
    await trigger.click();
    await expect(slider).toHaveValue("51");
    await expect(slider).toBeEnabled();
    activeStep = "uncertain write and authority isolation";
    await page.evaluate(() => window.failNext = true);
    await choose(75, "unconfirmed");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(slider).toBeDisabled();
    const failedWrites = await page.evaluate(() => window.writes.length);
    const failedReads = await page.evaluate(() => window.reads);
    await trigger.click();
    await trigger.click();
    await expect(slider).toBeDisabled();
    assert.equal(await page.evaluate(() => window.reads), failedReads, "reopening must not silently resolve an uncertain write");
    await trigger.click();
    for (const surface of ["offline", "share", "admin", "compare"]) {
      await page.evaluate(surface => window.setSurface(surface), surface);
      await expect(page.getByRole("slider")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Check result|核对结果/ })).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.reads), failedReads, "read-only scope must not consult the owner endpoint");
      assert.equal(await page.evaluate(() => window.writes.length), failedWrites);
    }
    await page.evaluate(() => window.setSurface("owner"));
    await trigger.click();
    await expect(page.getByRole("alert")).toBeVisible();
    assert.equal(await page.evaluate(() => window.reads), failedReads, "owner uncertainty survives authority remounts without an automatic read");
    await page.getByRole("button", { name: /Check result|核对结果/ }).click();
    await trigger.click();
    await expect(slider).toHaveValue("75");
    await expect(slider).toBeEnabled();
    assert.equal(await page.evaluate(() => window.writes.length), failedWrites, "unknown write recovery reads only");
    activeStep = "touch commit and cancellation";
    const touchBox = await slider.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = percent => [{ x: touchBox.x + 12 + (percent - 1) / 99 * (touchBox.width - 24), y: touchBox.y + touchBox.height / 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(35) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(47) });
    await expect(slider).toHaveValue("50");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await acknowledged(50, failedWrites + 1);
    await expect(slider).toBeEnabled();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(60) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(64) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(slider).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.writes.length), failedWrites + 1);
    await trigger.click();
    await expect(slider).toHaveValue("50");
    await choose(100);
    await expect(slider).toHaveAttribute("aria-valuetext", "100%");
    activeStep = "pending save close and reopen";
    await page.evaluate(() => window.holdSave = true);
    const pendingWrites = await page.evaluate(() => window.writes.length);
    await choose(25, "pending");
    await expect(slider).toBeDisabled();
    await trigger.click();
    await trigger.click();
    await expect(slider).toBeDisabled();
    await expect.poll(() => page.evaluate(() => typeof window.releaseSave)).toBe("function");
    await page.evaluate(() => { window.holdSave = false; window.releaseSave(); });
    await acknowledged(25, pendingWrites + 1);
    await expect(slider).toHaveValue("25");
    await expect(slider).toBeEnabled();
    assert.equal(await page.evaluate(() => window.writes.length), pendingWrites + 1, "closing/reopening pending save cannot resend or cancel it");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(out, `${width}-${theme}.png`) });
    activeStep = "bottom-edge disclosure";
    await trigger.click();
    await page.locator(".synthetic-reader-toc").evaluate(node => node.remove());
    await page.locator("figure").evaluate(node => node.style.marginTop = "540px");
    await trigger.click();
    await expect(slider).toBeEnabled();
    const edge = await page.locator(".image-scale-disclosure").boundingBox();
    assert.ok(edge.y >= 0 && edge.y + edge.height <= 801, "bottom-edge controls must remain reachable");
    await page.locator("figure").evaluate(node => node.style.marginTop = "0px");
    activeStep = "legacy default fit first save";
    const legacyWrites = await page.evaluate(() => window.writes.length);
    await page.evaluate(() => window.useLegacy());
    await expect(trigger).toHaveAccessibleName(/Default fit.*60%|默认适应栏宽.*60%/);
    await trigger.click();
    await expect(slider).toHaveValue("60");
    assert.equal(await page.evaluate(() => window.writes.length), legacyWrites, "reading a default never writes historical images");
    await choose(59);
    await expect.poll(() => page.evaluate(() => window.display.width)).toBe(708);
    await expect(trigger).toHaveAccessibleName(/59%/);
    assert.equal(await page.evaluate(() => window.writes.length), legacyWrites + 1);
    await page.screenshot({ path: join(out, `${width}-${theme}-legacy-default-fit.png`) });
    assert.deepEqual(errors, []);
    results.push({ width, theme, status: "passed", checks: ["upward compact disclosure", "no dialog or numeric duplicate", "44px slider", "column fit beside trigger", "one keyboard gesture/one write", "consecutive acknowledged keyboard saves", "draft zero writes", "fast magnet", "one write on release", "slow adjustment", "Escape cancellation", "read-only authority isolation", "read-only unknown-write check", "trusted touch commit/cancel", "100% original", "pending close/reopen without resend", "no overflow/errors", "edge visibility", "legacy default fit reads without writes", "first legacy adjustment starts at fitted ratio"] });
    await page.close();
  }
  writeFileSync(join(out, "result.json"), JSON.stringify({ status: "passed", results, adapters: ["API persistence", "surrounding image/Reader"] }, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: results.length, out }));
} catch (error) {
  // Preserve bounded synthetic-only evidence before closing Chromium. Never
  // turn an incomplete case into a passed result or suppress its original error.
  const geometry = await activePage?.evaluate(() => Object.fromEntries(
    [".synthetic-reader-toc", "figure", ".image-display-trigger", ".image-scale-disclosure"].map(selector => {
      const node = document.querySelector(selector), rect = node?.getBoundingClientRect();
      return [selector, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        display: getComputedStyle(node).display } : null];
    }),
  )).catch(() => null);
  const interaction = await activePage?.evaluate(() => ({
    writes: window.writes, results: window.writeResults, reads: window.reads,
    confirmedPercent: window.display?.scale_percent, inputEvents: window.inputEvents,
    slider: (() => { const node = document.querySelector(".image-scale-range");
      return node ? { value: node.value, disabled: node.disabled, focused: document.activeElement === node } : null; })(),
  })).catch(() => null);
  await activePage?.screenshot({ path: join(out, "failure.png") }).catch(() => undefined);
  writeFileSync(join(out, "failure.json"), JSON.stringify({
    status: "failed", ...activeCase, step: activeStep, error: String(error).slice(0, 8000), geometry, interaction, completedCases: results.length,
  }, null, 2));
  throw error;
} finally { await browser.close(); }
