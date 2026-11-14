// Actual Reader, Markdown/KaTeX, virtualizer, search, tag editor and focus UI.
// Adapters: Next routing/dynamic/preferences/workspace, synthetic HTTP/data,
// assistant-ui source forwarding to ReactMarkdown; code/Word are outside this fixture.
// No user data, account, local API, CI dispatch, or deployment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), web = join(root, "apps/web");
const require = createRequire(join(web, "package.json"));
const temp = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const out = join(temp, "reader-interaction-browser");
mkdirSync(out, { recursive: true });
const path = value => value.replaceAll("\\", "/");
const modulePath = file => JSON.stringify(path(join(web, file)));
writeFileSync(join(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});
module.exports=function(s){
 return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
writeFileSync(join(out, "adapters.mjs"), `
import React,{createContext,useContext,lazy,Suspense} from "react";
import ReactMarkdown from "react-markdown";
import {translate} from ${modulePath("lib/i18n.ts")};
const source=createContext("");
export const TextMessagePartProvider=({text,children})=><source.Provider value={text}>{children}</source.Provider>;
export const MarkdownTextPrimitive=({preprocess,componentsByLanguage,className,...props})=><div className={className}><ReactMarkdown {...props}>{preprocess(useContext(source))}</ReactMarkdown></div>;
export const createHighlighter=()=>{throw Error("Code highlighting is outside this formula fixture");};
const noop=()=>{};
const t=(key,values)=>translate(window.gateLocale??"en-US",key,values);
export const usePreferences=()=>({t,resolvedLocale:window.gateLocale??"en-US",resolvedTheme:window.gateTheme??"light",
 readerWidthMode:"standard",readerDensityMode:"comfortable",readerFontSizePx:17,readerDefaultFocus:Boolean(window.fixtureDefaultFocus),
 annotationDefaultPosition:"floating",setAnnotationDefaultPosition:noop});
export const useTranslations=()=>t;
const params=new URLSearchParams(location.search);
const router={push:noop,replace:noop,prefetch:noop};
export const useRouter=()=>router,useSearchParams=()=>params,usePathname=()=>"/conversations/synthetic";
const workspace={embedded:true,openMobileSidebar:noop,setReaderProjectContext:noop,setReaderFocus:noop};
export const useWorkspaceShell=()=>workspace;
export default function dynamic(load){const Component=lazy(load);return props=><Suspense fallback={null}><Component {...props}/></Suspense>;}
`);
// JSX adapter uses the same transparent TS loader as actual source.
writeFileSync(join(out, "adapters.tsx"), readFileSync(join(out, "adapters.mjs")));
writeFileSync(join(out, "unused-doc.mjs"), 'export default class UnsupportedFixtureDocument { constructor(){throw Error("Word extraction is outside this formula fixture");} }');
writeFileSync(join(out, "entry.tsx"), `
import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ConversationReader} from ${modulePath("features/conversations/conversation-reader.tsx")};
import {InteractionDialogProvider} from ${modulePath("components/interaction-dialog-provider.tsx")};
import {activateProtectedOfflineData} from ${modulePath("lib/offline-db.ts")};
import {authorizeOfflineAccess} from ${modulePath("lib/offline-access.ts")};
import {remoteReaderDataSource} from ${modulePath("lib/reader-data-source.ts")};
const id="synthetic", retention=window.fixtureKind==="retention", dense=window.fixtureKind!=="short";
const count=retention?(window.fixtureCount??80):36;
const messages=Array.from({length:count},(_,i)=>{
 const parts=retention?(i%2?["Synthetic capacity response "+i+".","Bounded paragraph for tier "+count+"."]:["Synthetic capacity prompt "+i+" seed 20260814."])
   :dense&&i===1?Array.from({length:72},(_,n)=>"Formula "+n+": $x_{"+n+"}^2+y^2=z^2$.\\n\\n$$\\\\sum_{k=1}^{n} k^2=\\\\frac{n(n+1)(2n+1)}{6}$$")
   :[i%2?"Short formula "+i+": $\\\\alpha_i+\\\\beta^2=\\\\gamma$.":"Synthetic prompt "+i];
 const text=parts.join("\\n\\n");
 return {id:"m"+i,conversation_id:id,role:i%2?"assistant":"user",order_key:String(i+1).padStart(6,"0"),ordinal:i+1,turn_index:Math.floor(i/2),
   block_count:parts.length,char_count:text.length,is_heavy:false,
   current_version:{id:"v"+i,version_number:1,display_text:text,plain_text:text},
   render_blocks:parts.map((text,n)=>({id:"b"+i+"-"+n,block_index:n,block_type:"paragraph",plain_text:text,data:{}}))};
});
window.syntheticMessages=messages;
const conversation={id,title:"Synthetic formula reading",display_title:"Synthetic formula reading",message_count:count,turn_count:count/2,
  offline_revision:1,description_markdown:null,project_id:null,status:"active",source_type:"synthetic",source_profile:"synthetic"};
const turn=(anchor="m0")=>{
 (window.turnReads??=[]).push(anchor);
 const start=Math.floor(messages.findIndex(m=>m.id===anchor)/2)*2;
 return {conversation_id:id,turn_key:"turn"+start,start_offset:start,end_offset:start+2,total_messages:count,
   items:messages.slice(start,start+2),previous_anchor_message_id:start?"m"+(start-2):null,next_anchor_message_id:start<count-2?"m"+(start+2):null};
};
window.syntheticTurn=turn;
const index={conversation_id:id,items:messages.map(m=>({message_id:m.id,role:m.role,role_number:Math.floor((m.ordinal+1)/2),ordinal:m.ordinal,
  order_key:m.order_key,preview:"Synthetic message "+m.ordinal,turn_index:m.turn_index})),message_count:count,turn_count:count/2,limit:count,offset:0,total:count,has_previous:false,has_more:false};
const toc={conversation_id:id,items:[],limit:100,offset:0,total:0,has_more:false};
const source={mode:window.fixtureOffline?"offline":"remote",capabilities:{canonicalManagement:Boolean(window.fixtureCanonical),attachments:"read-only",share:false,export:false},
 getConversation:async()=>conversation,getReaderTurn:async(_,anchor)=>window.fixtureRemoteRequests
   ?remoteReaderDataSource.getReaderTurn(id,anchor):turn(anchor),
 getDialogueIndex:async()=>index,getToc:async()=>toc,
 getMessageBlocks:async(id)=>messages.find(m=>m.id===id).render_blocks,
 getMessageWindow:async()=>({items:messages,limit:count,offset:0,total:count,has_previous:false,has_more:false}),
 getReadingPosition:async()=>({position:window.touchAnchor?{conversation_id:id,message_id:window.touchAnchor,block_index:0,scroll_offset:0,anchor_data:{},revision:1}:null}),saveReadingPosition:async()=>{},recordRecent:async()=>conversation,
 searchConversation:async(_,options)=>({query:options.query,items:[{document_id:"search-m1",document_type:"message",conversation_id:id,conversation_title:conversation.title,
 message_id:"m1",message_version_id:"v1",role:"assistant",order_key:"2",block_index:0,render_block_id:"b1-0",snippet:"Synthetic formula",rank:1,occurrence_count:1,matches:[]}],limit:50,offset:0,total:1}),
 getTargetContext:async(_,target)=>{const t=turn(target.messageId),m=messages.find(m=>m.id===target.messageId);return{
 readerTurn:t,messageWindow:{items:t.items,limit:2,offset:t.start_offset,total:count,has_previous:t.start_offset>0,has_more:t.end_offset<count},
 targetMessage:m,targetBlocks:m.render_blocks,dialogueIndex:index,toc,nearestHeading:null};}
};
window.__chatReaderPerfProbe={};
await activateProtectedOfflineData("11111111-1111-4111-8111-111111111111",{openDatabase:false});
authorizeOfflineAccess("11111111-1111-4111-8111-111111111111",Infinity,()=>true);
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
 <InteractionDialogProvider><ConversationReader conversationId={id} dataSource={source}/></InteractionDialogProvider>
</QueryClientProvider>);
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
const adapters = join(out, "adapters.tsx");
await new Promise((yes, no) => webpack({
  mode: "production", context: root, entry: join(out, "entry.tsx"), output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: { extensions: [".tsx", ".ts", ".mjs", ".js"], modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { "react$": require.resolve("react"), "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
      "react-dom$": require.resolve("react-dom"), "react-dom/client$": require.resolve("react-dom/client"),
      "word-extractor/lib/word-ole-extractor$": join(out, "unused-doc.mjs"),
      "word-extractor/lib/buffer-reader$": join(out, "unused-doc.mjs"),
      ...Object.fromEntries(["@assistant-ui/react", "@assistant-ui/react-markdown", "shiki", "next/navigation", "next/dynamic"].map(name => [name+"$",adapters])) } },
  plugins: [
    new webpack.ProvidePlugin({ process: require.resolve("next/dist/build/polyfills/process") }),
    new webpack.NormalModuleReplacementPlugin(/(?:preferences-provider|workspace-shell)$/, resource => { resource.request = adapters; }),
  ],
  module: { parser: { javascript: { dynamicImportMode: "eager" } }, rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "loader.cjs") }] },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));
const styles = await require("postcss")([require("tailwindcss")({
  content: [join(web, "components/**/*.tsx"), join(web, "features/**/*.tsx")],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const bundle = readFileSync(join(out, "bundle.js")), katexRoot = dirname(require.resolve("katex/dist/katex.min.css"));
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/katex/katex.min.css"><link rel="stylesheet" href="/style.css"><style>html,body,#root{height:100%;margin:0}</style><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const {chromium,expect}=require("@playwright/test");
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==="1"?"chromium":"chrome"});
const results=[], errors=[];
const touchOnly=process.env.READER_TOUCH_ONLY==="1";
const requestOnly=process.env.READER_REQUEST_ONLY==="1";
const retentionOnly=process.env.READER_RETENTION_ONLY==="1";
const coordinateOnly=process.env.READER_CAPACITY_COORDINATE_ONLY==="1";
let current;
try {
  for(const width of [1440,800,375]) for(const locale of ["en-US","zh-CN"]) for(const theme of ["light","dark"]) {
    if(requestOnly||retentionOnly||coordinateOnly) continue;
    if(touchOnly&&(width===1440||locale!=="en-US"||theme!=="light")) continue;
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:true});
    current=page;
    page.on("pageerror",error=>errors.push(error.stack??error.message));
    await page.addInitScript(({locale,theme})=>{window.gateLocale=locale;window.gateTheme=theme;
      document.addEventListener("DOMContentLoaded",()=>document.documentElement.dataset.theme=theme);},{locale,theme});
    await page.route("http://reader.synthetic/**",route=>{
      const p=new URL(route.request().url()).pathname;
      if(p.startsWith("/api/")) {
        const tags=["Algebra","Reading","Reference"].map((name,i)=>({id:"t"+i,revision:1,value:{name,conversation_ids:["synthetic"]}}));
        const payload=p.endsWith("/conversation-tag")?tags:p.endsWith("/reading-position")?{position:null}:p.endsWith("/notebook")?{id:"notes",conversation_id:"synthetic",title:"Notes",blocks:[],revision:1,is_conflict:false,conflict_of_id:null,created_at:"2026-11-09T00:00:00Z",updated_at:"2026-11-09T00:00:00Z"}:[];
        return route.fulfill({contentType:"application/json",body:JSON.stringify(payload)});
      }
      if(p.startsWith("/katex/")) { const file=join(katexRoot,p.slice(7)); assert.ok(existsSync(file));return route.fulfill({body:readFileSync(file),contentType:p.endsWith(".css")?"text/css":"font/woff2"}); }
      return route.fulfill({contentType:p==="/bundle.js"?"text/javascript":p==="/style.css"?"text/css":"text/html",body:p==="/bundle.js"?bundle:p==="/style.css"?styles.css:html});
    });
    await page.goto("http://reader.synthetic/");
    const scroller=page.locator('[data-reader-scroll-root="true"]');
    await expect(scroller).toBeVisible();
    assert.ok((await scroller.boundingBox()).height<=900,"The embedded Reader owns a bounded viewport, as in the real app shell.");
    await expect(page.locator(".katex").first()).toBeVisible({timeout:30000});
    await page.waitForTimeout(600);
    if(width!==1440&&locale==="en-US"&&theme==="light") {
      const cdp=await page.context().newCDPSession(page);
      for(const direction of ["down","up"]) {
        await page.addInitScript(()=>{window.fixtureKind="short";window.touchAnchor="m14";});
        await page.reload();
        await expect(scroller).toHaveAttribute("data-navigation-stage",/^settled/,{timeout:15000});
        // Position without user intent, like arriving from a TOC/restore. The
        // sentinel already intersects; a new finger drag cannot cross it again.
        await scroller.evaluate((node,d)=>{node.scrollTop=d==="down"?node.scrollHeight:0;},direction);
        await page.waitForTimeout(500);
        const before=await page.evaluate(()=>({reads:window.turnReads.length,
          ids:[...document.querySelectorAll("article[data-message-id]")].map(n=>n.dataset.messageId)}));
        const box=await scroller.boundingBox(),x=Math.round(box.x+box.width*.5);
        const startY=Math.round(box.y+box.height*(direction==="down"?.72:.25));
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y:startY}]});
        for(let step=1;step<=12;step++) {
          await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:startY+(direction==="down"?-1:1)*step*20}]});
          await page.waitForTimeout(25);
        }
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
        await expect.poll(()=>page.evaluate(()=>window.turnReads.length)).toBeGreaterThan(before.reads);
        await expect.poll(()=>scroller.getAttribute("data-reader-edge-stage")).toMatch(/settled|mounted/);
        const after=await page.evaluate(()=>({reads:window.turnReads.length,
          ids:[...document.querySelectorAll("article[data-message-id]")].map(n=>n.dataset.messageId),
          pointerDragging:document.querySelector("[data-reader-scroll-root]").dataset.readerPointerDragging??null}));
        assert.ok(after.ids.some(id=>!before.ids.includes(id)),"A genuine touch gesture must load readable content beyond the original edge.");
        assert.equal(after.pointerDragging,null);
        results.push({touchBoundary:true,width,direction,before,after});
      }
      // Restore the ordinary fixture for all existing UI/performance gates.
      await page.addInitScript(()=>{window.fixtureKind="dense";window.touchAnchor=null;});
      await page.reload();await expect(page.locator(".katex").first()).toBeVisible();await page.waitForTimeout(600);
      for(const direction of ["down","up"]) {
        await scroller.evaluate(node=>node.scrollTop=1600);await page.waitForTimeout(300);
        await page.evaluate(()=>{
          window.touchTrace=[];window.touchSampling=true;
          const tick=()=>{const root=document.querySelector("[data-reader-scroll-root]");
            window.touchTrace.push({top:root.scrollTop,writer:root.dataset.readerLastScrollWriter});
            if(window.touchSampling)requestAnimationFrame(tick);};tick();
        });
        const box=await scroller.boundingBox(),x=Math.round(box.x+box.width*.5);
        const startY=Math.round(box.y+box.height*(direction==="down"?.72:.25));
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y:startY}]});
        for(let step=1;step<=12;step++){
          await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:startY+(direction==="down"?-1:1)*step*20}]});
          await page.waitForTimeout(25);
        }
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
        await page.waitForTimeout(350);
        const trace=await page.evaluate(()=>{window.touchSampling=false;return window.touchTrace;});
        const sign=direction==="down"?1:-1;
        assert.ok((trace.at(-1).top-trace[0].top)*sign>100,"Dense formula content must move in the finger's reading direction.");
        assert.ok(trace.every((frame,i)=>!i||(frame.top-trace[i-1].top)*sign>=-2),"Geometry must not undo the touch gesture by more than 2px.");
        assert.ok(await page.locator('[data-virtualized-block-list="true"]').count()>0);
        results.push({touchVirtual:true,width,direction,trace});
      }
      await scroller.evaluate(node=>node.scrollTop=0);await page.waitForTimeout(300);
    }
    if(!touchOnly) {
    const title=page.locator("[data-reader-tags-trigger]:visible");
    await expect(title).toHaveCount(1);
    const position=page.locator("[data-reader-current-message]:visible");
    await expect(position).toContainText(/(?:Current message|当前消息).*\/36/);
    assert.equal(await page.locator('nav a[href="/tags"]').count(),0);
    await title.click();
    await expect(page.getByRole("group",{name:locale==="zh-CN"?"对话标签":"Conversation tags"})).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(title).toBeFocused();
    await page.screenshot({path:join(out,`header-${width}-${locale}-${theme}.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    // Real focus action, including the mobile More sheet.
    if(width<1280) {
      await page.locator("[data-reader-more-actions]:visible").click();
    }
    await page.getByRole(width<768?"button":width<1280?"menuitem":"button",{name:locale==="zh-CN"?"专注模式":"Focus mode",exact:true}).click();
    const focus=page.locator('[data-reader-focus="on"]');
    await expect(focus).toBeVisible();
    const helpLabel=locale==="zh-CN"?"阅读快捷键":"Reading keyboard help";
    const helpTrigger=page.locator(`summary[aria-label="${helpLabel}"]:visible`);
    await helpTrigger.click();
    const helpPanel=page.getByRole("dialog",{name:helpLabel,exact:true});
    const checkHelpBounds=async()=>{
      await expect(helpPanel).toBeInViewport();
      const b=await helpPanel.boundingBox(),v=page.viewportSize();
      assert.ok(b.x>=8&&b.y>=8&&b.x+b.width<=v.width-8&&b.y+b.height<=v.height-8,"The complete keyboard help must stay inside the viewport.");
      await helpPanel.getByRole("button",{name:locale==="zh-CN"?"关闭快捷键说明":"Close keyboard help"}).click({trial:true});
      if(v.width<768) {
        const controls=await page.locator("[data-reader-focus-controls]").boundingBox();
        assert.ok(b.y+b.height<=controls.y-4,"Mobile help opens above the whole wrapped toolbar.");
      }
    };
    await checkHelpBounds();
    if(width===375) {
      for(const smallWidth of [320,375]) for(const height of [900,480]) {
        await page.setViewportSize({width:smallWidth,height});
        await checkHelpBounds();
      }
      await page.screenshot({path:join(out,`focus-help-short-${locale}-${theme}.png`)});
      await page.setViewportSize({width,height:900});
      await checkHelpBounds();
    }
    await page.keyboard.press("Escape");
    await expect(helpPanel).toHaveCount(0);
    await expect(helpTrigger).toBeFocused();
    const search=page.locator('[data-reader-focus-controls] button[data-reader-header-action="search"]');
    await search.click();
    const dialog=page.getByRole("dialog",{name:locale==="zh-CN"?"搜索":"Search",exact:true});
    await expect(dialog).toBeVisible();
    await page.screenshot({path:join(out,`focus-search-${width}-${locale}-${theme}.png`)});
    await dialog.getByRole("textbox").fill("formula");
    const match=dialog.getByRole("button",{name:/Synthetic formula/});
    await expect(match).toBeVisible();
    await match.click();
    await expect(scroller).toHaveAttribute("data-navigation-stage",/^settled/,{timeout:15000});
    await expect(focus).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(search).toBeFocused();
    await expect(focus).toBeVisible();
    for(const tool of ["annotations","files"]) {
      const more=page.locator("[data-reader-more-actions]:visible");
      await more.click();
      const menuBox=await page.getByRole("menu").boundingBox();
      assert.ok(menuBox.x>=0&&menuBox.y>=0&&menuBox.x+menuBox.width<=width&&menuBox.y+menuBox.height<=900,"Focus menu stays inside the viewport.");
      const label=tool==="annotations"?(locale==="zh-CN"?"批注":"Annotations"):(locale==="zh-CN"?"当前对话文件":"Conversation files");
      await page.getByRole("menuitem",{name:label,exact:true}).click();
      const panel=page.getByRole("dialog",{name:label,exact:true});
      await expect(panel).toBeVisible();
      await expect(focus).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(more).toBeFocused();
    }
    if(width===375) {
      await page.screenshot({path:join(out,`focus-tools-${width}-${locale}-${theme}.png`)});
      assert.equal(await page.evaluate(()=>{
        const boxes=[...document.querySelectorAll("[data-reader-focus-controls] button,.reader-focus-edge")]
          .filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());
        return boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
      }),false,"Focus actions and navigation edge buttons must not overlap.");
    }
    const copied=await page.evaluate(()=>{
      const first=document.getElementById("block-m1-0"),last=document.getElementById("block-m1-1");
      const selection=getSelection(),range=document.createRange();
      range.setStartBefore(first);range.setEndAfter(last);selection.removeAllRanges();selection.addRange(range);
      const data=new DataTransfer(),event=new ClipboardEvent("copy",{bubbles:true,cancelable:true,clipboardData:data});
      first.dispatchEvent(event);selection.removeAllRanges();
      return {prevented:event.defaultPrevented,text:data.getData("text/markdown"),
        expected:window.syntheticMessages[1].render_blocks.slice(0,2).map(b=>b.plain_text).join("\n\n")};
    });
    assert.equal(copied.prevented,true);assert.equal(copied.text,copied.expected);
    results.push({width,locale,theme,header:true,keyboardHelp:true,helpSmallViewports:width===375?4:0,focusSearch:true,searchNavigation:true,focusTools:true,formulaSelectionCopy:true});
    if(width===1440&&locale==="en-US"&&theme==="light") {
      const cdp=await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      for(const kind of ["dense","short"]) {
        if(kind==="short") {await page.addInitScript(()=>{window.fixtureKind="short";});await page.reload();await expect(page.locator(".katex").first()).toBeVisible();await page.waitForTimeout(600);}
        const box=await scroller.boundingBox();
        for(const gesture of ["pointer","wheel","combined"]) {
          await scroller.evaluate(node=>node.scrollTop=0);await page.waitForTimeout(300);
          const beforeMetrics=(await cdp.send("Performance.getMetrics")).metrics;
          if(process.env.READER_CPU_PROFILE==="1"&&gesture==="wheel") {
            await cdp.send("Profiler.enable");await cdp.send("Profiler.start");
            await cdp.send("Tracing.start",{categories:"devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking",transferMode:"ReturnAsStream"});
          }
          await page.evaluate(()=>{
            window.measure={frames:[],scrolls:[],long:[],start:performance.now(),parses:window.__chatReaderPerfProbe.markdownParseTotal??0};
            let last=performance.now();window.measure.stop=false;
            const frame=now=>{window.measure.frames.push(now-last);window.measure.scrolls.push(document.querySelector("[data-reader-scroll-root]").scrollTop);last=now;if(!window.measure.stop)requestAnimationFrame(frame);};requestAnimationFrame(frame);
            window.longObserver=new PerformanceObserver(list=>window.measure.long.push(...list.getEntries().map(e=>e.duration)));
            window.longObserver.observe({type:"longtask"});
          });
          for(let step=0;step<36;step++) {
            if(gesture!=="wheel") await page.mouse.move(box.x+80+(step%7)*24,box.y+150+(step%11)*34);
            else if(step===0) await page.mouse.move(box.x+160,box.y+220);
            if(gesture!=="pointer") await page.mouse.wheel(0,80);
            await page.waitForTimeout(34);
          }
          const sample=await page.evaluate(()=>{
            window.measure.stop=true;window.longObserver.disconnect();const m=window.measure;
            const sorted=[...m.frames].sort((a,b)=>a-b);
            return {frames:m.frames,scrolls:m.scrolls,longTasks:m.long,p95:sorted[Math.ceil(sorted.length*.95)-1],
              longest:Math.max(0,...m.long),longTotal:m.long.reduce((a,b)=>a+b,0),
              parseDelta:(window.__chatReaderPerfProbe.markdownParseTotal??0)-m.parses,
              mounted:document.querySelectorAll("[data-block-index]").length,
              mathML:document.querySelectorAll(".katex-mathml").length};
          });
          const afterMetrics=(await cdp.send("Performance.getMetrics")).metrics;
          sample.layout=Object.fromEntries(afterMetrics.filter(item=>["LayoutCount","LayoutDuration","RecalcStyleCount","RecalcStyleDuration","ScriptDuration","TaskDuration"].includes(item.name))
            .map(item=>[item.name,item.value-(beforeMetrics.find(old=>old.name===item.name)?.value??0)]));
          if(process.env.READER_CPU_PROFILE==="1"&&gesture==="wheel") {
            writeFileSync(join(out,`${kind}.cpuprofile`),JSON.stringify((await cdp.send("Profiler.stop")).profile));
            const done=new Promise(resolve=>cdp.once("Tracing.tracingComplete",resolve));
            await cdp.send("Tracing.end");const {stream}=await done;let trace="";
            while(true){const part=await cdp.send("IO.read",{handle:stream});trace+=part.data;if(part.eof)break;}
            await cdp.send("IO.close",{handle:stream});writeFileSync(join(out,`${kind}.trace.json`),trace);
          }
          results.push({kind,gesture,...sample});
          writeFileSync(join(out,"result.json"),JSON.stringify({results,errors},null,2));
          if(gesture==="pointer") assert.equal(sample.parseDelta,0,"Pointer movement must not reparse unchanged Markdown.");
          assert.ok(sample.mathML>0);
          assert.ok(sample.p95<=34,`${kind}/${gesture} p95 ${sample.p95}`);
          assert.ok(sample.longest<=150,`${kind}/${gesture} longest ${sample.longest}`);
          assert.ok(sample.longTotal<=250,`${kind}/${gesture} total ${sample.longTotal}`);
          assert.ok(sample.mounted<=120);
          if(gesture!=="pointer") assert.ok(sample.scrolls.every((top,i)=>!i||top>=sample.scrolls[i-1]-2),"Wheel input must not be undone by geometry compensation.");
        }
      }
    }
    if(width===1440&&locale==="en-US"&&theme==="light") {
      // Fresh ordinary Reader and real index navigation/presentation timers.
      // Do not replace an already-running Reader's animation/performance clock.
      await page.reload();await expect(page.locator(".katex").first()).toBeVisible();await page.waitForTimeout(700);
      await page.locator(".dialogue-index").hover();
      await expect(page.locator(".dialogue-index")).toHaveAttribute("data-state","preview");
      const indexTarget=page.locator('button[title$="Synthetic message 5"]').first();
      // Native focus/scroll-into-view can change the viewport before click.
      // Independently sample its actual position immediately before React's
      // navigation handler, not an earlier scrollTop or an internal checkpoint.
      await indexTarget.evaluate(button=>button.addEventListener("click",()=>{
        const r=document.querySelector("[data-reader-scroll-root]");
        window.returnClickOrigin=document.getElementById("block-m0-0").getBoundingClientRect().top-r.getBoundingClientRect().top;
      },{capture:true,once:true}));
      await indexTarget.click();
      const originOffset=await page.evaluate(()=>window.returnClickOrigin);
      const back=page.locator('[data-testid="reader-return-to-toc-origin"]:visible');
      await expect(back).toHaveAttribute("data-return-emphasized","true",{timeout:15000});
      await expect(page.locator("[data-reader-current-message]:visible")).toContainText("5/36");
      await page.waitForTimeout(3100);
      await expect(back).toHaveAttribute("data-return-emphasized","false");
      await back.focus();await page.waitForTimeout(27_000);
      await expect(back).toBeVisible();
      await page.locator('[data-reader-tags-trigger]:visible').focus();
      await expect(back).toHaveCount(0);
      await page.locator('[data-reader-header-action="focus-mode"]:visible').click();
      await expect(page.locator('[data-reader-focus="on"]')).toBeVisible();
      await page.waitForTimeout(800);
      await page.locator("[data-reader-more-actions]:visible").click();
      await page.evaluate(expected=>{
        window.returnTrace=[];window.returnOrigin=expected;
        const until=performance.now()+10000;
        const frame=()=>{const r=document.querySelector("[data-reader-scroll-root]"),b=document.getElementById("block-m0-0");
          window.returnTrace.push({at:performance.now(),scroll:r.scrollTop,rootTop:r.getBoundingClientRect().top,
            offset:b?b.getBoundingClientRect().top-r.getBoundingClientRect().top:null,
            stage:r.dataset.navigationStage,writer:r.dataset.readerLastScrollWriter});
          if(performance.now()<until) requestAnimationFrame(frame);};requestAnimationFrame(frame);
      },originOffset);
      await page.getByRole("menuitem",{name:"Return to reading position"}).click();
      await expect.poll(()=>scroller.evaluate((root,expected)=>Math.abs(document.getElementById("block-m0-0").getBoundingClientRect().top-root.getBoundingClientRect().top-expected),originOffset),{timeout:15000}).toBeLessThanOrEqual(1);
      await expect(scroller).toHaveAttribute("data-navigation-stage","settled");
      results.push({returnCue:true,focusedExpiry:true,focusMoreCheckpoint:true,originOffset});
    }
    }
    await page.close();
  }
  if(!touchOnly&&!retentionOnly&&!coordinateOnly) for(const width of [375,800,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    current=page;
    page.on("pageerror",error=>errors.push(error.stack??error.message));
    await page.clock.install();
    await page.addInitScript(()=>{
      window.fixtureKind="short";window.fixtureRemoteRequests=true;window.hangReaderRequests=true;window.remoteTurnReads=0;
      const fetch=window.fetch;
      window.fetch=(url,options)=>{
        if(String(url).includes("/reader-turn")){
          window.remoteTurnReads++;
          // Non-cooperative transport: the real Reader deadline must settle
          // even if neither the headers nor body ever arrives.
          if(window.hangReaderRequests) return new Promise(()=>{});
        }
        return fetch(url,options);
      };
    });
    await page.route("http://reader.synthetic/**",async route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      if(p.endsWith("/reader-turn")) return route.fulfill({json:await page.evaluate(anchor=>window.syntheticTurn(anchor??"m0"),url.searchParams.get("anchor_message_id"))});
      if(p.startsWith("/api/")) return route.fulfill({json:p.endsWith("/reading-position")?{position:null}:[]});
      if(p.startsWith("/katex/")) {const file=join(katexRoot,p.slice(7));return route.fulfill({body:readFileSync(file),contentType:p.endsWith(".css")?"text/css":"font/woff2"});}
      return route.fulfill({contentType:p==="/bundle.js"?"text/javascript":p==="/style.css"?"text/css":"text/html",body:p==="/bundle.js"?bundle:p==="/style.css"?styles.css:html});
    });
    await page.goto("http://reader.synthetic/");
    const scroller=page.locator('[data-reader-scroll-root="true"]');
    await expect.poll(()=>page.evaluate(()=>window.remoteTurnReads)).toBe(1);
    await page.clock.fastForward(20_001);
    const retry=page.locator("[data-reader-initial-read-retry]");
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    await page.evaluate(()=>{window.hangReaderRequests=false;});
    await retry.click();
    await expect(scroller.locator("article[data-message-id]").first()).toBeVisible();
    const ids=await scroller.locator("article[data-message-id]").evaluateAll(nodes=>nodes.map(n=>n.dataset.messageId));
    await page.evaluate(()=>{window.hangReaderRequests=true;});
    await scroller.evaluate(node=>{node.scrollTop=node.scrollHeight;});
    await scroller.hover();await page.mouse.wheel(0,120);
    await expect(scroller).toHaveAttribute("data-reader-edge-stage","next:loading");
    await page.clock.fastForward(20_001);
    await expect(scroller).toHaveAttribute("data-reader-edge-stage","next:failed");
    await expect(scroller.locator("article[data-message-id]").first()).toBeVisible();
    const edgeRetry=scroller.getByRole("button",{name:"Retry later messages"});
    await expect(edgeRetry).toBeVisible();
    await page.evaluate(()=>{window.hangReaderRequests=false;});
    await edgeRetry.click();
    await expect.poll(()=>scroller.locator("article[data-message-id]").evaluateAll((nodes,old)=>nodes.some(n=>!old.includes(n.dataset.messageId)),ids)).toBe(true);
    await expect(scroller).toHaveAttribute("data-reader-edge-stage",/^next:(settled|mounted)/);
    results.push({requestLifetime:true,width,initialTimeoutRetry:true,edgeTimeoutRetry:true,retainedBody:true});
    await page.close();
  }
  if(!touchOnly&&!requestOnly&&!coordinateOnly) for(const [width,count,offline,protect] of [
    [375,80,false,false],[800,80,false,false],[1440,80,false,false],
    [800,80,true,false],[1440,160,false,false],[1440,80,false,true],
  ]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    current=page;page.on("pageerror",error=>errors.push(error.stack??error.message));
    await page.addInitScript(({count,offline})=>{
      window.fixtureKind="retention";window.fixtureCount=count;window.fixtureOffline=offline;
    },{count,offline});
    await page.route("http://reader.synthetic/**",route=>{
      const p=new URL(route.request().url()).pathname;
      if(p.startsWith("/api/"))return route.fulfill({json:p.endsWith("/reading-position")?{position:null}:[]});
      if(p.startsWith("/katex/"))return route.fulfill({body:readFileSync(join(katexRoot,p.slice(7))),contentType:p.endsWith(".css")?"text/css":"font/woff2"});
      return route.fulfill({contentType:p==="/bundle.js"?"text/javascript":p==="/style.css"?"text/css":"text/html",body:p==="/bundle.js"?bundle:p==="/style.css"?styles.css:html});
    });
    await page.goto("http://reader.synthetic/");
    const scroller=page.locator('[data-reader-scroll-root="true"]');
    await expect(scroller.locator('article').first()).toBeVisible();await scroller.hover();
    if(protect) await page.evaluate(()=>{
      const block=document.getElementById("block-m0-0");
      const selection=getSelection(),range=document.createRange();range.selectNodeContents(block);
      selection.removeAllRanges();selection.addRange(range);window.retainedSelection=selection.toString();
    });
    for(let step=0;step<(count===160?200:100);step++){
      await page.mouse.wheel(0,120);await page.waitForTimeout(34);
    }
    // Allow the final native wheel's compositor movement, not reclamation, to
    // settle. Every following frame (including the removal) is kept unfiltered.
    await page.waitForTimeout(40);
    if(protect) {
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(()=>getSelection().toString()),await page.evaluate(()=>window.retainedSelection));
      await expect(page.locator("#block-m0-0")).toHaveCount(1);
      // Focus protects an offscreen article even after the text range clears.
      await page.evaluate(()=>{
        const button=document.querySelector("#message-m0 button");
        button.focus({preventScroll:true});getSelection().removeAllRanges();window.retainedFocus=button;
      });
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(()=>document.activeElement===window.retainedFocus),true);
      await expect(page.locator("#message-m0")).toHaveCount(1);
    }
    const before=await page.evaluate(()=>{
      const root=document.querySelector("[data-reader-scroll-root]"),line=root.getBoundingClientRect().top+120;
      const articles=[...root.querySelectorAll("article[data-message-id]")];
      const article=articles.find(n=>{const r=n.getBoundingClientRect();return r.top<=line&&r.bottom>line;})
        ??articles.find(n=>n.getBoundingClientRect().bottom>line)??articles.at(-1);
      const block=[...article.querySelectorAll("[data-block-index]")].find(n=>n.getBoundingClientRect().bottom>line)??article;
      const offset=block.getBoundingClientRect().top-root.getBoundingClientRect().top;
      window.retentionTrace=[];window.retentionSampling=true;
      const sample=()=>{
        const target=document.getElementById(block.id);
        window.retentionTrace.push({at:performance.now(),offset:target?target.getBoundingClientRect().top-root.getBoundingClientRect().top:null,
          messages:root.querySelectorAll("article[data-message-id]").length,top:root.scrollTop});
        if(window.retentionSampling)requestAnimationFrame(sample);
      };sample();
      return {id:block.id,offset,ordinal:Number(article.dataset.messageId.slice(1)),messages:articles.length,reads:window.turnReads.length};
    });
    if(protect) await page.evaluate(()=>{
      window.retainedFocus.blur();
      // Releasing a user interaction must retry postponed reclamation without
      // requiring the user to move away from the current reading position.
    });
    await page.waitForTimeout(2500);
    const after=await page.evaluate(()=>{
      window.retentionSampling=false;
      const root=document.querySelector("[data-reader-scroll-root]");
      return {trace:window.retentionTrace,ids:[...root.querySelectorAll("article[data-message-id]")].map(n=>n.dataset.messageId),
        blocks:root.querySelectorAll("[data-block-index]").length,reads:window.turnReads.length};
    });
    results.push({retention:true,width,count,offline,protect,before,after});
    assert.ok(after.trace.length>30);
    assert.ok(after.trace.every(frame=>frame.offset!==null),"The real protected block must never unmount.");
    assert.ok(Math.max(...after.trace.map(frame=>Math.abs(frame.offset-before.offset)))<=2,"Reclamation peak anchor movement must stay within 2 CSS px.");
    assert.ok(Math.abs(after.trace.at(-1).offset-before.offset)<=1,"Settled anchor movement must stay within 1 CSS px.");
    assert.ok(after.ids.length<=40,"An idle small-message Reader must reclaim old complete turns.");
    assert.ok(after.ids.every((id,i)=>!i||Number(id.slice(1))===Number(after.ids[i-1].slice(1))+1),"Retained turns remain contiguous.");
    const idleReads=after.reads;
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(()=>window.turnReads.length),idleReads,"Reclamation must not cause an idle load/trim request loop.");
    // Real wheel direction reversal reloads removed content through the same
    // canonical turn path, not a fabricated anchor or a second message cache.
    const oldest=Number(after.ids[0].slice(1));
    for(let step=0;step<30;step++){await page.mouse.wheel(0,-120);await page.waitForTimeout(34);}
    await expect.poll(()=>scroller.locator("article[data-message-id]").evaluateAll(nodes=>Math.min(...nodes.map(n=>Number(n.dataset.messageId.slice(1)))))).toBeLessThan(oldest);
    await expect(page.locator("[data-reader-current-message]:visible")).toContainText("/"+count);
    await page.close();
  }
  // Controlled coordinate regression, not an alternative capacity workload:
  // execute the actual collector against the mounted Reader. A quiet pause
  // makes reclamation deterministic; neither that pause nor the negative
  // injections exist in reader-capacity.spec.ts's original release workload.
  if(!touchOnly&&!requestOnly&&!retentionOnly) {
    const ts=require("typescript"),capacity=readFileSync(join(web,"e2e/reader-capacity.spec.ts"),"utf8");
    const ast=ts.createSourceFile("reader-capacity.spec.ts",capacity,ts.ScriptTarget.ES2022,true);
    const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="runWheelTelemetry");
    assert.ok(fn);
    const compiled=ts.transpileModule(`export ${fn.getText(ast)}`,{compilerOptions:{
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
    }}).outputText;
    const telemetry={};new Function("exports",compiled)(telemetry);
    for(const scenario of ["quiet-reclamation","actual-reverse-wheel","actual-backward-jump","native-long-task"]) {
      const page=await browser.newPage({viewport:{width:1280,height:720}});
      current=page;page.on("pageerror",error=>errors.push(error.stack??error.message));
      await page.addInitScript(()=>{window.fixtureKind="retention";window.fixtureCount=1000;window.fixtureOffline=false;});
      await page.route("http://reader.synthetic/**",route=>{
        const p=new URL(route.request().url()).pathname;
        if(p.startsWith("/api/"))return route.fulfill({json:p.endsWith("/reading-position")?{position:null}:[]});
        if(p.startsWith("/katex/"))return route.fulfill({body:readFileSync(join(katexRoot,p.slice(7))),contentType:p.endsWith(".css")?"text/css":"font/woff2"});
        return route.fulfill({contentType:p==="/bundle.js"?"text/javascript":p==="/style.css"?"text/css":"text/html",body:p==="/bundle.js"?bundle:p==="/style.css"?styles.css:html});
      });
      await page.goto("http://reader.synthetic/");
      const scroller=page.locator('[data-reader-scroll-root="true"]');
      await expect(scroller.locator("article").first()).toBeVisible();
      await scroller.evaluate(element=>{element.scrollTop=0;});await page.waitForTimeout(150);
      let step=0;
      const driver={
        evaluate:page.evaluate.bind(page),
        mouse:{wheel:async(x,y)=>{
          assert.equal(y,120);
          await page.mouse.wheel(x,step===18&&scenario==="actual-reverse-wheel"?-240:y);
        }},
        waitForTimeout:async ms=>{
          assert.equal(ms,34);
          await page.waitForTimeout(ms);
          if(step===22&&scenario==="quiet-reclamation") {
            // The ordinary edge owner may still be settling. Start the
            // diagnostic quiet period only after it releases; don't change
            // its timing or the product's 250ms reclamation policy.
            await expect.poll(async()=>{
              const stage=await scroller.getAttribute("data-reader-edge-stage");
              return stage===null||/:(settled|failed|cancelled|mount-cancelled)(?::|$)/.test(stage);
            },{timeout:15000}).toBe(true);
            await page.waitForTimeout(400);
          }
          if(step===18&&scenario==="actual-backward-jump") {
            await scroller.evaluate(element=>{element.scrollTop-=120;});
            await page.waitForTimeout(34);
          }
          if(step===18&&scenario==="native-long-task") {
            // Deliberate native timing failure in this diagnostic control
            // only. Never add the busy wait to the release capacity workload.
            // CDP's immediate evaluation is not a native long-task boundary.
            // Schedule real browser animation work; never fabricate an entry.
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(function syntheticNativeLongTask() {
              const started=performance.now();
              while(performance.now()-started<210) { /* deterministic main-thread work */ }
              resolve();
            })));
          }
          step++;
        },
      };
      const result=await telemetry.runWheelTelemetry(driver,scroller,30);
      results.push({capacityCoordinates:true,scenario,fixture:{messages:1000,profile:"plain",width:1280,height:720},
        diagnosticOnly:true,releaseAcceptance:false,quietPauseMs:scenario==="quiet-reclamation"?400:0,...result});
      writeFileSync(join(out,"result.json"),JSON.stringify({results,errors},null,2));
      assert.equal(result.scrollSamples.length,30);
      assert.equal(result.scrollWheelSamples.length,30);
      assert.equal(result.scrollEvidenceComplete,true,"Every frame and wheel sample needs shared real DOM evidence.");
      if(scenario==="quiet-reclamation") {
        assert.equal(result.rawScrollMonotonic,false,"The old raw gate must still be visibly red.");
        assert.equal(result.scrollMonotonic,true,"Legal coordinate rebasing must retain the real reading position.");
        const removal=result.scrollFrames.flatMap((frame,i)=>i&&frame.scrollTop+2<result.scrollFrames[i-1].scrollTop
          &&frame.mountedMessages<result.scrollFrames[i-1].mountedMessages?[frame]:[]);
        assert.ok(removal.length>0);
        assert.ok(removal.every(frame=>frame.anchorKey!==null&&Math.abs(frame.forwardPx)<=2));
      } else if(scenario==="native-long-task") {
        assert.equal(result.scrollMonotonic,true);
        assert.equal(result.longTaskObserverSupported,true);
        assert.ok(result.longestTask>=200,"The real native observer must retain the deliberate >150ms failure.");
        assert.ok(result.longTaskSpans.some(span=>span.duration>=200));
        assert.deepEqual(result.longTaskSpans.map(span=>span.duration),result.longTasks);
        assert.equal(result.longAnimationFrameDiagnostics.supported,true);
        assert.ok(result.longAnimationFrameDiagnostics.frames.some(frame=>frame.duration>=200),
          "Native frame attribution must be collected without enabling a CPU profiler.");
        assert.equal(result.diagnosticTiming,undefined);
      } else {
        assert.equal(result.scrollMonotonic,false,"Real reverse input and backwards jumps must remain failures.");
        assert.ok(result.physicalScrollReversals.some(frame=>frame.phase==="frame"&&frame.forwardPx < -2));
        if(scenario==="actual-backward-jump") {
          assert.ok(result.scrollSamples[18]+2>=result.scrollSamples[17],
            "The original wheel-only comparator misses this between-sample jump.");
        }
      }
      await page.close();
    }
  }
  if(!touchOnly&&!requestOnly&&!retentionOnly&&!coordinateOnly) for(const [width,locale,theme] of [
    [375,"en-US","light"],[800,"zh-CN","light"],[1440,"en-US","dark"],
  ]) {
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:true});
    current=page;page.on("pageerror",error=>errors.push(error.stack??error.message));
    await page.addInitScript(({locale,theme})=>{
      window.fixtureCanonical=true;window.gateLocale=locale;window.gateTheme=theme;
      document.addEventListener("DOMContentLoaded",()=>document.documentElement.dataset.theme=theme);
    },{locale,theme});
    await page.route("https://reader.synthetic/**",route=>{
      const p=new URL(route.request().url()).pathname;
      if(p.startsWith("/api/"))return route.fulfill({json:p.endsWith("/continuation")
        ?{generation:0,adopted_revision_id:null,pending_return_task_id:null}
        :p.endsWith("/reading-position")?{position:null}:[]});
      if(p.startsWith("/katex/"))return route.fulfill({body:readFileSync(join(katexRoot,p.slice(7))),contentType:p.endsWith(".css")?"text/css":"font/woff2"});
      return route.fulfill({contentType:p==="/bundle.js"?"text/javascript":p==="/style.css"?"text/css":"text/html",body:p==="/bundle.js"?bundle:p==="/style.css"?styles.css:html});
    });
    await page.goto("https://reader.synthetic/");
    const scroller=page.locator('[data-reader-scroll-root="true"]');
    await expect(page.locator(".katex").first()).toBeVisible();await page.waitForTimeout(600);
    const open=id=>page.evaluate(conversationId=>!window.dispatchEvent(new CustomEvent(
      "chat-reader:open-continuation",{cancelable:true,detail:{conversationId}})),id);
    const dialog=page.getByRole("dialog",{name:/上下文接续|Context continuation/});
    assert.equal(await open("different-synthetic-conversation"),false);
    await expect(dialog).toHaveCount(0);
    await scroller.evaluate(node=>node.scrollTop=500);await page.waitForTimeout(400);
    const before=await scroller.evaluate(node=>node.scrollTop);
    for(let attempt=0;attempt<2;attempt++){
      assert.equal(await open("synthetic"),true,"The mounted owner Reader must acknowledge repeated task navigation");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button",{name:/更新文件|Update files/})).toBeVisible();
      if(!attempt) await page.screenshot({path:join(out,`context-task-${width}-${locale}-${theme}.png`)});
      await dialog.getByRole("button",{name:/^关闭接续$|^Close continuation$/}).click();
      await expect(dialog).toHaveCount(0);
    }
    assert.ok(Math.abs(await scroller.evaluate(node=>node.scrollTop)-before)<=1,"Opening the existing workspace cannot rebase Reader scroll");
    await page.addInitScript(()=>{window.fixtureDefaultFocus=true;});
    await page.goto("https://reader.synthetic/?continuation=current");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button",{name:/^关闭接续$|^Close continuation$/}).click();
    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(350);
    await expect(dialog).toHaveCount(0);
    await page.addInitScript(()=>{window.fixtureCanonical=false;});
    await page.reload();await expect(page.locator(".katex").first()).toBeVisible();
    assert.equal(await open("synthetic"),false,"Read-only Reader must not intercept a private recovery link");
    await expect(dialog).toHaveCount(0);
    results.push({contextTaskNavigation:true,width,locale,theme,reopened:true,coldFocusedLink:true,targetScoped:true,readOnlyExcluded:true,scrollRetained:true});
    await page.close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,"result.json"),JSON.stringify({status:"passed",results,errors},null,2));
  console.log(JSON.stringify({status:"passed",cases:results.length,out}));
} catch(error) {
  if(current&&!current.isClosed()) {await current.screenshot({path:join(out,"failure.png")});writeFileSync(join(out,"failure.txt"),await current.locator("body").innerText());writeFileSync(join(out,"failure-state.json"),JSON.stringify(await current.evaluate(()=>({root:document.querySelector("[data-reader-scroll-root]")?.dataset,returnOrigin:window.returnOrigin,returnTrace:window.returnTrace,retentionTrace:window.retentionTrace})),null,2));}
  writeFileSync(join(out,"result.json"),JSON.stringify({status:"failed",error:String(error),results,errors},null,2));
  throw error;
} finally {await browser.close();}
