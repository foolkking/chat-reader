// Native extension UI with synthetic Reader responses, not an authorization or backend test.
// No real devices, capture, login, cookies, upstream data or network requests are needed.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const {chromium}=require("../../apps/web/node_modules/@playwright/test");
const [binary,build,parent,label]=process.argv.slice(2);
const origin="http://127.0.0.1:18383",site="https://chatgpt.com",source="/c/synthetic-device-test";
const base="chrome-extension://gihbiofiiflkckcmomddkkjkoifkddfi";
const cid="00000000-0000-4000-8000-000000000123";
assert.ok(/^(?:chrome-zh|edge-en)-[a-z0-9-]+$/.test(label));
const dir=path.resolve(parent,label);
assert.ok(["e:\\chat-reader-temp\\","c:\\users\\86182\\desktop\\wkkk\\"].some(root=>dir.toLowerCase().startsWith(root)));
const report={scope:"native desktop browser, real packaged source UI and worker; Reader responses and devices are synthetic",
  build:JSON.parse(execFileSync("python",["-I","-B",path.join(__dirname,"verify_extension_build.py"),path.resolve(build),origin,
    process.env.READER_TEST_EXTENSION_SHA256||""],{encoding:"utf8"})),steps:[]};
fs.mkdirSync(dir);
const cap={protocol:1,capture:true,catalog_details:true,source_lookup:true},pause=ms=>new Promise(r=>setTimeout(r,ms));
const save=/^(保存到 Reader|Save to Reader)$/,old=/^(打开已存版本|Open saved version)$/;
let ctx,step="install",outbound=0;
async function main(){
  ctx=await chromium.launchPersistentContext(path.join(dir,"new-profile"),{executablePath:binary,headless:false,
    locale:label.startsWith("chrome-zh")?"zh-CN":"en-US",viewport:{width:375,height:700},
    args:["--headless=new","--disable-sync","--disable-background-networking","--no-first-run","--no-proxy-server",
      "--host-resolver-rules=MAP * ~NOTFOUND","--disable-extensions-except="+build,"--load-extension="+build]});
  report.browser=ctx.browser().version();
  await ctx.route("**/*",async r=>{
    const u=new URL(r.request().url()),json=data=>r.fulfill({json:data});
    if(u.protocol==="chrome-extension:"||u.protocol==="data:"||u.protocol==="blob:")return r.continue();
    if(u.origin===site&&u.pathname===source)return r.fulfill({contentType:"text/html",
      body:"<!doctype html><title>Fixture</title><main><p data-message-id='fixture-line'>Synthetic coastal survey</p></main>"});
    if(u.origin===origin&&u.pathname==="/conversations/"+cid)return r.fulfill({contentType:"text/html",body:"<!doctype html><title>Fixture destination</title>"});
    if(u.origin===origin&&r.request().method()==="GET"&&u.pathname.startsWith("/api/extension/v1/")){
      const key=u.pathname.slice("/api/extension/v1/".length);
      if(key==="capabilities")return json(cap);
      if(key==="projects")return json([]);
      if(key==="conversations")return json({items:[],has_more:false,next_cursor:null});
    }
    outbound++;return r.abort(); // Source bodies, real login, tokens and unknown calls are never forwarded.
  });
  let panel=await ctx.newPage();await panel.goto(base+"/panel.html");await panel.locator("#connect").waitFor();
  const worker=ctx.serviceWorkers().find(w=>w.url().startsWith(base))||await ctx.waitForEvent("serviceworker",{timeout:10000});
  await worker.evaluate(async({cap,cid,origin,source})=>{
    await ReaderClient.trust;
    globalThis.fixtureLookups=[];
    ReaderClient.request=async(device,key,options)=>{
      if(key==="capabilities")return {json:async()=>cap};
      if(key!=="sources/status"||options?.method!=="POST"||
         JSON.stringify(JSON.parse(options.body))!==JSON.stringify({source_id:source.split("/").at(-1)}))throw Error("Unexpected fixture operation");
      fixtureLookups.push(device);return {json:async()=>({conversation_id:device==="fixture-a"?cid:null})};
    };
    globalThis.fixtureBind=async id=>{
      await chrome.storage.session.set({access:{origin,device:id,token:"synthetic-no-authority",until:Date.now()+300000}});
      await chrome.storage.local.set({device:{id,user:id,origin,name:"Synthetic account"},destination:{device:id,project:null},jobs:[]});
    };
    await fixtureBind("fixture-a");
  },{cap,cid,origin,source});
  await panel.reload();await panel.locator("#q").waitFor();
  const chat=await ctx.newPage();await chat.goto(site+source);await chat.bringToFront();
  const ax=await ctx.newCDPSession(chat);
  async function button(re,click=false){
    const end=Date.now()+6000;
    do{
      const {nodes}=await ax.send("Accessibility.getFullAXTree");
      const n=nodes.find(x=>x.role?.value==="button"&&re.test(x.name?.value||""));
      if(n){if(click){const {model}=await ax.send("DOM.getBoxModel",{backendNodeId:n.backendDOMNodeId});
        const p=model.content;await chat.mouse.click((p[0]+p[4])/2,(p[1]+p[5])/2);}return;}
      await pause(75);
    }while(Date.now()<end);
    throw Error("Expected source control unavailable");
  }
  const lookups=()=>worker.evaluate(()=>[...fixtureLookups]);
  step="private-by-default";await button(save);assert.deepEqual(await lookups(),[]);report.steps.push(step);
  step="manual";await button(/其他操作|Other actions/,true);await button(/查找已存版本|Find saved version/,true);
  await button(old);assert.deepEqual(await lookups(),["fixture-a"]);report.steps.push(step);
  step="same-document-new-account";
  // Do not reload, navigate or blur the source tab. The server would not bind this source in B.
  await worker.evaluate(()=>fixtureBind("fixture-b"));
  await button(save);assert.deepEqual(await lookups(),["fixture-a"]);report.steps.push(step);
  step="explicit-negative";await button(/其他操作|Other actions/,true);await button(/查找已存版本|Find saved version/,true);
  // "Save" itself was already present before this click; require the acknowledged not-found text as well.
  await button(/^(?:保存到 Reader|Save to Reader) · (?:没有可打开的已存版本。|No accessible saved version\.)$/);
  assert.deepEqual(await lookups(),["fixture-a","fixture-b"]);report.steps.push(step);
  step="open-fresh-settings";await panel.close();await worker.evaluate(()=>fixtureBind("fixture-a"));
  panel=await ctx.newPage();await panel.goto(base+"/panel.html");await panel.bringToFront();
  await panel.locator("#q").waitFor();await panel.locator("#settings-label").click();const check=panel.locator("#source-lookup");
  assert.equal(await check.isChecked(),false);
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await panel.screenshot({path:path.join(dir,"lookup-settings-375.png")});
  step="set-device-preference";await check.check();await panel.waitForFunction(async()=>{const o=await chrome.storage.local.get(["device","sourceLookupDevice"]);return o.sourceLookupDevice===o.device.id;});
  step="opt-in-control";
  await panel.locator("#settings .dismiss").click();await chat.bringToFront();await chat.reload();await button(old);
  assert.ok((await lookups()).slice(2).includes("fixture-a"));report.steps.push(step);
  step="open-target";const opened=ctx.waitForEvent("page");await button(old,true);const result=await opened;
  await result.waitForURL(origin+"/conversations/"+cid);await result.close();report.steps.push(step);
  step="opt-out";await panel.bringToFront();await panel.locator("#settings-label").click();await check.uncheck();
  await panel.waitForFunction(async()=>!(await chrome.storage.local.get("sourceLookupDevice")).sourceLookupDevice);
  await panel.locator("#settings .dismiss").click();const before=(await lookups()).length;
  await chat.bringToFront();await chat.reload();await button(save);assert.equal((await lookups()).length,before);
  assert.equal(outbound,0);report.steps.push(step);report.passed=true;
}
main().catch(error=>{report.passed=false;report.failedAt=step;report.errorClass=error?.name||"unknown";
  const msg=String(error?.message||"");report.diagnostic=/net::ERR_([A-Z_]+)/.exec(msg)?.[1]||
    (/Content Security Policy|unsafe-eval/i.test(msg)?"browser-policy":/not a function|undefined/i.test(msg)?"test-binding":
      /navigation|destroyed|detached/i.test(msg)?"document-replaced":/timeout|timed out/i.test(msg)?"timeout":"other");
  const line=/source-state-browser\.cjs:(\d+):\d+/.exec(String(error?.stack||""));if(line)report.testLine=Number(line[1]);
  process.exitCode=1;}).finally(async()=>{
  if(ctx)await ctx.close().catch(()=>{});
  fs.writeFileSync(path.join(dir,"receipt.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report));
});
