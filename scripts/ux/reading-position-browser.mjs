// Actual reading sync, Dexie and status controls in two isolated browser stores.
// Synthetic same-origin transport implements revision/CAS receipts. The small
// body is a navigation adapter, not evidence of the full Reader's virtualizer.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),web=join(root,"apps/web");
const require=createRequire(join(web,"package.json"));
const temp=resolve(process.env.RUNNER_TEMP??process.env.TEMP??"");
if(process.platform==="win32")assert.match(temp.replaceAll("\\","/").toLowerCase(),/^c:\/users\/86182\/desktop\/wkkk\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP||process.env.TEMP);
const out=join(temp,"reading-position-browser");mkdirSync(out,{recursive:true});
const path=file=>JSON.stringify(join(web,file).replaceAll("\\","/"));
writeFileSync(join(out,"loader.cjs"),`const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
writeFileSync(join(out,"preferences.tsx"),`export const usePreferences=()=>({resolvedLocale:window.gateLocale});`);
writeFileSync(join(out,"entry.tsx"),`
import React from "react";import {createRoot} from "react-dom/client";
import {ReadingPositionSyncStatus} from ${path("components/reading-position-sync-status.tsx")};
import * as sync from ${path("lib/reading-position-sync.ts")};
import {offlineDb,activateProtectedOfflineData} from ${path("lib/offline-db.ts")};
import * as access from ${path("lib/offline-access.ts")};
access.configureOfflineAccess(false);await activateProtectedOfflineData("synthetic-reading-owner");
const id="synthetic-reading",point=block=>({message_id:"synthetic-message",block_index:block,scroll_offset:12,anchor_data:{ordinal:2}});
window.gate={point,sync,db:offlineDb,
 read:()=>sync.readSyncedReadingPosition(id,true),observe:()=>sync.readSyncedReadingPosition(id,true,false,true),
 save:block=>sync.saveLocalReadingPosition(id,point(block)),
 flush:()=>sync.flushReadingPositionBatch(offlineDb,access.captureOfflineAccess()),
 snapshot:async()=>({local:await offlineDb.readingPositions.get(id),state:(await offlineDb.settings.get(sync.readingSyncKey(id)))?.value,
   pending:await offlineDb.outbox.toArray(),conflict:!!await offlineDb.settings.get(sync.readingConflictKey(id))})};
await window.gate.read();
createRoot(document.getElementById("root")).render(<main className="relative mx-auto max-w-3xl p-4">
 <h1 className="mb-4 text-lg">Synthetic reading handoff</h1>
 <ReadingPositionSyncStatus floating conversationId={id} onUseServer={async position=>{
   window.located=position; if(window.failLocate)throw Error("Synthetic target unavailable");
   document.getElementById("body").scrollTop=position.block_index*30;
 }}/>
 <div id="body" tabIndex={0} className="h-96 overflow-auto border border-ui">
  {Array.from({length:80},(_,i)=><p key={i} className="h-[30px]">Synthetic paragraph {i}</p>)}
 </div><button id="outside" className="btn-secondary min-h-11 px-3">Continue reading</button>
 </main>);
`);
const webpack=require("next/dist/compiled/webpack/webpack").webpack;
await new Promise((yes,no)=>webpack({
  mode:"production",context:root,entry:join(out,"entry.tsx"),output:{path:out,filename:"bundle.js"},optimization:{minimize:false},
  resolve:{extensions:[".tsx",".ts",".mjs",".js"],modules:["node_modules",join(web,"node_modules"),join(root,"node_modules")],
    alias:{"react$":require.resolve("react"),"react/jsx-runtime$":require.resolve("react/jsx-runtime"),"react-dom/client$":require.resolve("react-dom/client")}},
  plugins:[new webpack.ProvidePlugin({process:require.resolve("next/dist/build/polyfills/process")}),
    new webpack.NormalModuleReplacementPlugin(/preferences-provider$/,resource=>{resource.request=join(out,"preferences.tsx");})],
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(out,"loader.cjs")}]},
},(error,stats)=>error||stats.hasErrors()?no(error??Error(stats.toString({all:false,errors:true}))):yes()));
const styles=await require("postcss")([require("tailwindcss")({content:[join(web,"components/**/*.tsx"),join(out,"entry.tsx")]})])
  .process(readFileSync(join(web,"app/globals.css"),"utf8"),{from:join(web,"app/globals.css")});
const bundle=readFileSync(join(out,"bundle.js"));
const html='<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const {chromium,expect}=require("@playwright/test");
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==="1"?"chromium":"chrome"});
const results=[],errors=[];let current;
try {
 for(const width of [375,800,1440])for(const locale of ["zh-CN","en-US"])for(const theme of ["light","dark"]){
  let remote={id:"synthetic-position",conversation_id:"synthetic-reading",message_id:"synthetic-message",block_index:2,scroll_offset:12,
    anchor_data:{ordinal:2},revision:1,created_at:"2026-11-10T00:00:00Z",updated_at:"2026-11-10T00:01:00Z"};
  const posts=[],receipts=new Map(),contexts=[];
  const open=async()=>{
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,hasTouch:width<1440});contexts.push(context);
   const page=await context.newPage();current=page;page.on("pageerror",error=>errors.push(error.message));
   await page.addInitScript(({locale,theme})=>{window.gateLocale=locale;document.addEventListener("DOMContentLoaded",()=>document.documentElement.dataset.theme=theme);},{locale,theme});
   await page.route("https://progress.synthetic/**",route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname.endsWith("/reading-position/sync")){
     const operation=route.request().postDataJSON();posts.push(operation);
     let receipt=receipts.get(operation.operation_id);
     if(!receipt){
      const status=operation.base_revision===remote.revision?"applied":"conflict";
      if(status==="applied")remote={...remote,...operation.position,revision:remote.revision+1};
      receipt={operation_id:operation.operation_id,status,position:{...remote}};receipts.set(operation.operation_id,receipt);
     }
     return route.fulfill({contentType:"application/json",body:JSON.stringify(receipt)});
    }
    if(pathname.endsWith("/reading-position"))return route.fulfill({contentType:"application/json",body:JSON.stringify({conversation_id:"synthetic-reading",position:remote})});
    assert.ok(!pathname.startsWith("/api/"),pathname);
    return route.fulfill({contentType:pathname==="/bundle.js"?"text/javascript":pathname==="/style.css"?"text/css":"text/html",
      body:pathname==="/bundle.js"?bundle:pathname==="/style.css"?styles.css:html});
   });
   await page.goto("https://progress.synthetic/");await expect(page.locator("#body")).toBeVisible();return page;
  };
  try{
   const a=await open(),b=await open();current=a;
   await a.locator("#body").evaluate(node=>node.scrollTop=210);
   const bodyBefore=await a.locator("#body").boundingBox();
   await b.evaluate(async()=>{await window.gate.save(20);await window.gate.flush();});
   assert.equal(remote.revision,2);
   await a.evaluate(()=>window.dispatchEvent(new Event("focus")));
   const status=a.getByRole("region",{name:locale==="zh-CN"?"阅读进度同步":"Reading progress sync"});
   const other=locale==="zh-CN"?"使用另一设备位置":"Use other device position",here=locale==="zh-CN"?"继续本机位置":"Continue here";
   await expect(status.getByRole("button",{name:other,exact:true})).toBeVisible();
   assert.equal(await a.locator("#body").evaluate(node=>node.scrollTop),210);
   assert.deepEqual(await a.locator("#body").boundingBox(),bodyBefore,"The handoff notice must not reflow the reading body.");
   const snapshot=await a.evaluate(()=>window.gate.snapshot());
   assert.equal(snapshot.local.block_index,2);assert.equal(snapshot.state.server.block_index,20);
   assert.equal(posts.length,1);assert.equal(snapshot.pending.length,0);
   await status.getByRole("button",{name:locale==="zh-CN"?"稍后处理":"Later",exact:true}).click();
   await expect(status).toHaveCount(0);
   assert.equal((await a.evaluate(()=>window.gate.snapshot())).state.incoming,true);
   await a.getByRole("button",{name:locale==="zh-CN"?"阅读进度 · 待处理":"Reading progress · Needs attention",exact:true}).click();
   await expect(status).toBeVisible();
   await a.screenshot({path:join(out,`incoming-${width}-${locale}-${theme}.png`)});
   assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   // A chosen target failure keeps the exact target/retry, not a false success.
   await a.evaluate(()=>window.failLocate=true);
   await status.getByRole("button",{name:other,exact:true}).click();
   await expect(status.getByRole("alert")).toBeVisible();
   assert.equal(posts.length,1);
   await a.evaluate(()=>window.failLocate=false);
   await status.getByRole("button",{name:locale==="zh-CN"?"重新定位已选位置":"Retry locating the chosen position"}).click();
   await expect(status).toHaveCount(0);
   assert.equal(await a.locator("#body").evaluate(node=>node.scrollTop),600);
   // Two independent offline edits: a later GET followed by coalescing must
   // not turn A's stale base into a last-writer-wins overwrite.
   await a.evaluate(()=>window.gate.save(25));
   await b.evaluate(async()=>{await window.gate.save(30);await window.gate.flush();});
   assert.equal(remote.block_index,30);
   await a.evaluate(async()=>{await window.gate.observe();await window.gate.save(26);await window.gate.flush();});
   assert.equal(remote.block_index,30);
   await expect(status.getByRole("button",{name:here,exact:true})).toBeVisible();
   const conflict=await a.evaluate(()=>window.gate.snapshot());
   assert.equal(conflict.conflict,true);assert.equal(conflict.local.block_index,26);
   await status.getByRole("button",{name:here,exact:true}).focus();await a.keyboard.press("Enter");
   await expect.poll(()=>a.evaluate(async()=>(await window.gate.snapshot()).conflict)).toBe(false);
   await a.evaluate(()=>window.gate.flush());assert.equal(remote.block_index,26);assert.equal(remote.revision,4);
   // A clean new entry follows the server; merely reopening creates no write.
   const count=posts.length;await b.reload();await expect(b.locator("#body")).toBeVisible();
   assert.equal((await b.evaluate(()=>window.gate.snapshot())).local.block_index,26);assert.equal(posts.length,count);
   results.push({width,locale,theme,cleanHandoff:true,noPassiveScroll:true,exactLocateRetry:true,coalescedConflict:true,explicitLocal:true,reentry:true,posts:count});
  }finally{for(const context of contexts)await context.close();}
 }
 assert.deepEqual(errors,[]);writeFileSync(join(out,"result.json"),JSON.stringify({status:"passed",results,errors},null,2));
 console.log(JSON.stringify({status:"passed",cases:results.length,out}));
}catch(error){
 if(current&&!current.isClosed()){await current.screenshot({path:join(out,"failure.png")});writeFileSync(join(out,"failure.txt"),await current.locator("body").innerText());}
 writeFileSync(join(out,"result.json"),JSON.stringify({status:"failed",error:String(error),results,errors},null,2));throw error;
}finally{await browser.close();}
