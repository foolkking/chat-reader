// Local, isolated acceptance only. Never attach to someone's existing browser/profile.
// The source site is synthetic; DNS is blocked even if an interception rule fails.
const { chromium } = require("../../apps/web/node_modules/@playwright/test");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process"), assert = require("node:assert/strict");
const origin = "http://127.0.0.1:18383", source = "https://chatgpt.com";
const [binary, build, parent, label] = process.argv.slice(2);
const dir = path.resolve(parent, label);
if (!["E:\\chat-reader-temp\\", "C:\\Users\\86182\\Desktop\\wkkk\\"].some(p => dir.toLowerCase().startsWith(p.toLowerCase()))
    || !/^[a-z0-9-]+$/.test(label) || !process.env.BETA_TEST_PASSWORD) throw Error("Explicit new rehearsal directory and disposable account required.");
fs.mkdirSync(dir);
const base = "chrome-extension://gihbiofiiflkckcmomddkkjkoifkddfi", steps = [];
const wait = ms => new Promise(r => setTimeout(r,ms)), title = "Tide notebook · "+label;
let name = "synthetic-"+crypto.randomUUID();
const sourceMarker = "synthetic-source-only", report = {label,source:"network-isolated synthetic fixture",steps};
const csv=Buffer.from("name,depth\n"+"tide,2\n".repeat(110000));
function tallPNG(){
  const chunk=(kind,data)=>{const k=Buffer.from(kind),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);k.copy(out,4);data.copy(out,8);
    let c=0xffffffff;for(const b of Buffer.concat([k,data])){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
    out.writeUInt32BE((c^0xffffffff)>>>0,out.length-4);return out;};
  const h=Buffer.alloc(13);h.writeUInt32BE(8);h.writeUInt32BE(2048,4);h[8]=8;h[9]=2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),chunk("IHDR",h),chunk("IDAT",require("node:zlib").deflateSync(Buffer.alloc(25*2048,0))),chunk("IEND",Buffer.alloc(0))]);
}
const png=tallPNG();
let step="start",ctx;
function mark(s){step=s;console.log(s);}
async function until(fn, ms=25000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await wait(200);}throw Error("wait expired");}
// Fault injection only into OUR own freshly installed offscreen page. Frame routing
// does not cover extension document fetches in all builds; do not infer a lost reply.
async function dropOneLocalReceipt(){
  const c=await ctx.browser().newBrowserCDPSession();
  const {targetInfos}=await c.send("Target.getTargets");
  const target=targetInfos.find(t=>t.url===base+"/host.html");assert.ok(target);
  const {sessionId}=await c.send("Target.attachToTarget",{targetId:target.targetId,flatten:false});
  let seq=10;
  const evaluate=expr=>new Promise((resolve,reject)=>{
    const id=++seq,t=setTimeout(()=>{c.off("Target.receivedMessageFromTarget",on);reject(Error("Offscreen fault setup timed out"));},4000);
    const on=e=>{if(e.sessionId!==sessionId)return;const res=JSON.parse(e.message);if(res.id!==id)return;
      clearTimeout(t);c.off("Target.receivedMessageFromTarget",on);
      if(res.error||res.result?.exceptionDetails)reject(Error("Offscreen test operation unavailable"));else resolve(res.result.result.value);};
    c.on("Target.receivedMessageFromTarget",on);
    c.send("Target.sendMessageToTarget",{sessionId,message:JSON.stringify({id,method:"Runtime.evaluate",params:{expression:expr,returnByValue:true}})}).catch(reject);
  });
  assert.ok(await evaluate(`(()=>{const original=window.fetch;window.__lostReceipt=false;
    window.fetch=async function(url,opts){const r=await original.apply(this,arguments);if(String(url)===${JSON.stringify(origin+"/api/extension/v1/imports")}&&opts?.method==="POST"&&r.status===201){
      window.fetch=original;window.__lostReceipt=true;throw new TypeError("Synthetic lost response after acceptance");}return r;};return true;})()`));
  return async()=>{try{return await evaluate("window.__lostReceipt === true");}finally{await c.detach();}};
}
function tree(n,changed) {
  const mapping={};const body=["A tidal observation","```md\n## User\n```\n\nAdjacent answer","Formula $x^2$","A new observation"];
  for(let i=0;i<n;i++){
    const id="fixture-"+i,role=["user","assistant","assistant","user"][i];
    mapping[id]={id,parent:i?"fixture-"+(i-1):null,children:i+1<n?["fixture-"+(i+1)]:[],
      message:{id,author:{role},content:{content_type:i===1?"multimodal_text":"text",parts:[changed&&i===0?"Different beginning":body[i],
        ...(i===1?[{content_type:"image_asset_pointer",asset_pointer:"file-service://synthetic-long-image",width:8,height:2048}]:[])]},
        create_time:1730000000+i,metadata:i?{}:{attachments:[{id:"synthetic-report",name:"tide.csv",mime_type:"text/csv"}]}}};
  } return {title,conversation_id:name,current_node:"fixture-"+(n-1),mapping};
}
async function main(){
  let n=3,changed=false,leaked=false,captures=0,missing=false,delaySource=false,slowRead=false;
  const faults=label.includes("faults");
  const zh=label.includes("zh");
  ctx=await chromium.launchPersistentContext(path.join(dir,"profile"),{executablePath:binary,headless:false,locale:zh?"zh-CN":"en-US",
    downloadsPath:path.join(dir,"downloads"),acceptDownloads:true,timeout:18000,
    args:["--headless=new","--no-first-run","--no-proxy-server","--disable-background-networking","--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "--disable-extensions-except="+build,"--load-extension="+build]});
  report.browser=ctx.browser()?.version()||"unknown";
  await ctx.route("**/*",async r=>{
    const req=r.request(),u=new URL(req.url());
    if(u.origin===source){
      if(u.pathname==="/c/"+name)return r.fulfill({contentType:"text/html",body:`<!doctype html><html><title>Synthetic Chat</title><body><main><h1>Synthetic conversation</h1><p data-message-id="fixture-${n-1}">Test document</p></main></body></html>`});
      if(u.pathname==="/api/auth/session")return r.fulfill({json:{accessToken:sourceMarker}});
      if(u.pathname==="/backend-api/conversation/"+name){captures++;return r.fulfill({json:tree(n,changed)});}
      if(u.pathname==="/backend-api/files/download/synthetic-report")return r.fulfill({json:{download_url:"/test-only.csv"}});
      if(u.pathname==="/backend-api/files/download/synthetic-long-image")return r.fulfill({json:{download_url:"/test-only.png"}});
      if(u.pathname==="/test-only.csv"){
        if(missing)return r.abort("internetdisconnected");
        if(delaySource){slowRead=true;await wait(900);if(r.request().frame().isDetached())return;}
        return r.fulfill({body:csv,contentType:"text/csv"});}
      if(u.pathname==="/test-only.png")return r.fulfill({body:png,contentType:"image/png"});
      return r.fulfill({status:404,body:""});
    }
    if(u.origin===origin){
      if(Object.values(req.headers()).some(v=>v.includes(sourceMarker))||req.postDataBuffer()?.includes(Buffer.from(sourceMarker)))leaked=true;
      return r.continue();
    }
    if(u.protocol==="chrome-extension:"||u.protocol==="blob:"||u.protocol==="data:")return r.continue();
    return r.abort();
  });
  mark("web-login");
  const signIn=async()=>assert.equal((await ctx.request.post(origin+"/api/auth/login",{headers:{Origin:origin},data:{
    email:"browser-beta@example.test",password:process.env.BETA_TEST_PASSWORD}})).status(),200);
  await signIn();
  const projectReq=await ctx.request.post(origin+"/api/projects",{headers:{Origin:origin},data:{name:"Tide project "+label}});
  assert.equal(projectReq.status(),201);const pid=(await projectReq.json()).id;
  if(faults)await ctx.clearCookies();
  const panel=await ctx.newPage();
  mark("installed-panel");await panel.goto(base+"/panel.html",{timeout:9000});await panel.locator("#connect").waitFor();
  const worker=ctx.serviceWorkers().find(w=>w.url().startsWith(base))||await ctx.waitForEvent("serviceworker",{timeout:10000});
  assert.equal(await worker.evaluate(()=>chrome.runtime.id),"gihbiofiiflkckcmomddkkjkoifkddfi");
  report.redirectHost=await panel.evaluate(()=>new URL(chrome.identity.getRedirectURL("reader")).hostname);
  await worker.evaluate(()=>chrome.sidePanel.getPanelBehavior()).then(b=>assert.equal(b.openPanelOnActionClick,true));
  steps.push("installed extension, toolbar registered to open side panel");
  mark("native-consent");await panel.locator("#connect").click();
  const button=/授权此设备|Authorize this device/i;
  if(faults){
    const form=await until(()=>ctx.pages().find(p=>p.url().startsWith(origin+"/login")),12000);
    await form.locator('input[type="email"]').fill("browser-beta@example.test");
    await form.locator('input[type="password"]').fill(process.env.BETA_TEST_PASSWORD);
    await form.locator('button[type="submit"]').click();steps.push("signed-out native authorization flow returned through Reader login");
  }
  const consent=await until(async()=>{const p=ctx.pages().find(p=>p.url().startsWith(origin+"/extension/connect/"));
    if(p)return p;if(await panel.locator("#error").textContent())throw Error("native identity flow rejected");},12000);
  await consent.getByRole("button",{name:button}).click({timeout:12000});
  await panel.locator("#choose").waitFor({timeout:12000});await panel.locator("#choose").click();
  steps.push("genuine browser PKCE consent and explicit destination");
  // No Reader webpage or browser cookies needed after explicit device authorization.
  for(const p of ctx.pages())if(p!==panel)await p.close();await ctx.clearCookies();
  let chat=await ctx.newPage();
  const jobs=()=>worker.evaluate(async()=>(await chrome.storage.local.get("jobs")).jobs?.map(j=>({phase:j.phase,cid:j.cid,review:j.review?.action,partial:j.review?.partial}))||[]);
  async function beginSource(){
    await chat.goto(source+"/c/"+name,{waitUntil:"domcontentloaded"});
    const host=chat.locator("body > div").last();await host.waitFor();
    const b=await host.boundingBox();assert.ok(b&&b.width>48);await chat.mouse.click(b.x+32,b.y+b.height/2);
  }
  async function clickSource(stage){
    const before=(await jobs()).length;await beginSource();
    const j=await until(async()=>{const v=await jobs(),last=v.at(-1);if(v.length<=before)return null;
      if(["check","attention","upload-rejected","reconnect"].includes(last.phase)||stage==="done"&&last.phase==="review")throw Error("job phase: "+last.phase);
      return last.phase===stage?last:null;},75000);
    return j;
  }
  mark("capture-import");const first=await clickSource("done");assert.ok(first.cid);steps.push("real capture, ZIP and committed file import");
  mark("duplicate");assert.equal((await clickSource("done")).cid,first.cid);steps.push("identical import returns same conversation");
  mark("append");n=4;assert.equal((await clickSource("done")).cid,first.cid);steps.push("suffix appended to same conversation");
  mark("branch-conflict");changed=true;assert.equal((await clickSource("review")).review,"conflict");steps.push("branch conflict requests review");
  mark("keyboard-ime");await panel.locator("#q").focus();const ime=await ctx.newCDPSession(panel);
  await ime.send("Input.imeSetComposition",{text:"潮汐",selectionStart:2,selectionEnd:2});
  await ime.send("Input.insertText",{text:"潮汐"});await ime.detach();
  assert.equal(await panel.locator("#q").inputValue(),"潮汐");await panel.locator("#q").press("Tab");
  assert.equal(await panel.locator("#find").evaluate(el=>el===document.activeElement),true);
  steps.push("browser IME composition and keyboard search focus (not a physical input-method test)");
  mark("metadata-search");await panel.locator("#q").fill(title);await panel.locator("#find").click();
  const row=panel.locator("#rows li").filter({hasText:title}).first();
  const a=row.locator("a.row-title");await a.waitFor();assert.equal(await a.getAttribute("target"),"_blank");
  assert.equal(await a.getAttribute("href"),origin+"/conversations/"+first.cid);
  const opened=ctx.waitForEvent("page");await a.click();const tab=await opened;await tab.waitForLoadState("domcontentloaded");await tab.close();
  steps.push("metadata result opens Reader in a new tab without a device credential in the URL");
  for(const w of [320,375,480])for(const theme of ["light","dark"]){
    await panel.setViewportSize({width:w,height:860});await panel.emulateMedia({colorScheme:theme});
    assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await panel.screenshot({path:path.join(dir,`panel-${w}-${theme}.png`)});
  }
  mark("project-operations");await panel.locator("#filter").selectOption("unclassified");await row.waitFor();
  await row.getByRole("button",{name:/^(更多|More)$/i}).click();
  await row.locator(".actions select").selectOption(pid);await row.getByRole("button",{name:/^(移动|Move)$/}).click();
  await row.waitFor({state:"detached",timeout:8000});await panel.locator("#filter").selectOption(pid);await row.waitFor();
  await row.getByRole("button",{name:/^(更多|More)$/i}).click();
  await row.getByRole("button",{name:/^(项目置顶|Pin in project)$/i}).click();
  await row.getByRole("button",{name:/^(更多|More)$/i}).click();await row.getByRole("button",{name:/取消项目置顶|Unpin in project/i}).waitFor();
  steps.push("move, scoped conversation search and project pin persisted");
  mark("file-directory");await panel.locator("#q").fill("tide.csv");await panel.locator("#files").click();
  const fr=panel.locator("#rows li").filter({hasText:"tide.csv"}).first();await fr.waitFor();
  const fl=await fr.locator("a").getAttribute("href");assert.ok(fl.startsWith(origin+"/conversations/"+first.cid+"?files=open&attachmentId="));
  await fr.getByRole("button",{name:/^(更多|More)$/i}).click();await fr.locator("input").fill("renamed-tide.csv");await fr.getByRole("button",{name:/保存名称|Save name/}).click();
  await panel.locator("#rows .row-title").filter({hasText:"renamed-tide.csv"}).waitFor();steps.push("rename an owned attachment and open the existing Reader file target");
  mark("context-export");await panel.locator("#q").fill(title);await panel.locator("#chats").click();
  await row.getByRole("button",{name:/Export context|导出上下文/i}).click();
  await until(()=>worker.evaluate(async()=>Boolean((await chrome.storage.local.get("exportJob")).exportJob?.aid)),45000);
  steps.push("server generated a new context artifact via the panel");
  const artifact=await until(async()=>{const records=await worker.evaluate(async()=>(await chrome.downloads.search({state:"complete"}))
      .map(d=>({name:d.filename,size:d.fileSize})));return records.find(d=>d.size>100);},14000);
  assert.ok(fs.existsSync(artifact.name));
  // Never dump member contents, cookies, callback parameters, or authorization headers.
  execFileSync("python",["-c","import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;assert {'manifest.json','conversation.canjsonl','annotations.md'}<=set(z.namelist())",artifact.name]);
  steps.push("download bytes: verified context ZIP and canonical members");
  mark("web-quick-context");await signIn();const reader=await ctx.newPage();await reader.setViewportSize({width:1280,height:820});
  await reader.goto(origin+"/conversations/"+first.cid);
  await reader.locator("[data-reader-header-more-actions]").click({timeout:20000});
  const webDownload=reader.waitForEvent("download",{timeout:40000});
  await reader.locator('[data-reader-header-action="quick-context"]:visible').click();
  const d=await webDownload;const target=path.join(dir,"web.context.zip");await d.saveAs(target);
  execFileSync("python",["-c","import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None and 'conversation.canjsonl' in z.namelist()",target]);
  steps.push("Reader webpage: actual quick action downloaded a valid context ZIP");
  mark("verify-postgres-files");const verified=execFileSync("docker",["exec","-i","reader-ext-beta-1123-api-1","python","-",first.cid,
      crypto.createHash("sha256").update(csv).digest("hex"),crypto.createHash("sha256").update(png).digest("hex")],
    {input:fs.readFileSync(path.join(__dirname,"verify.py")),encoding:"utf8",stdio:["pipe","pipe","pipe"]});
  report.canonical=JSON.parse(verified);
  if(faults){
    mark("source-close-before-delivery");name="synthetic-"+crypto.randomUUID();changed=false;n=3;delaySource=true;
    await beginSource();await until(()=>slowRead);await chat.close();chat=await ctx.newPage();delaySource=false;
    await until(async()=>(await jobs()).at(-1)?.phase==="capture-interrupted");steps.push("source closed mid-resource: no upload, actionable interruption");
    mark("browser-temp-space");const cdp=await ctx.newCDPSession(panel);
    await cdp.send("Storage.overrideQuotaForOrigin",{origin:base,quotaSize:64*1024});
    try{await clickSource("storage-full");}finally{await cdp.send("Storage.overrideQuotaForOrigin",{origin:base});await cdp.detach();}
    steps.push("real OPFS quota override: insufficient temporary space produced no upload");
    mark("missing-file");missing=true;
    const partial=await clickSource("review");assert.equal(partial.partial,true);assert.equal(partial.review,"new");missing=false;
    steps.push("disconnected resource requires review before any publication");
    const workerName="reader-ext-beta-1123-worker-1";
    assert.equal(execFileSync("docker",["inspect",workerName,"--format",'{{index .Config.Labels "com.docker.compose.project"}}'],{encoding:"utf8"}).trim(),"reader-ext-beta-1123");
    mark("worker-restart");execFileSync("docker",["stop","--time","15",workerName],{stdio:"ignore"});
    try{
      await beginSource();
      await until(async()=>["received","processing"].includes((await jobs()).at(-1)?.phase),30000);
      await chat.close();await panel.reload();
    }finally{execFileSync("docker",["start",workerName],{stdio:"ignore"});}
    await until(async()=>(await jobs()).at(-1)?.phase==="done",90000);steps.push("durable received job finished after source closed, panel reloaded and worker restarted");
    mark("lost-upload-reply");chat=await ctx.newPage();const original=(await jobs()).at(-1).cid,checkDropped=await dropOneLocalReceipt();
    const same=await clickSource("done");
    assert.ok(await checkDropped());assert.equal(same.cid,original);steps.push("offscreen fault injection dropped a real 201; recovered the same conversation via request receipt");
  }
  mark("native-side-panel");
  // Exercise the native Side Panel API with an actual trusted user click. This is
  // separate from screenshots of the extension document at controlled widths.
  await panel.evaluate(()=>{document.getElementById("settings-label").addEventListener("click",async()=>{
    try{const w=await chrome.windows.getCurrent();await chrome.sidePanel.open({windowId:w.id});document.body.dataset.nativePanel="open";}
    catch{document.body.dataset.nativePanel="unsupported";}},{once:true});});
  await panel.locator("#settings-label").click();
  await until(()=>panel.evaluate(async()=>document.body.dataset.nativePanel==="open"&&(await chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]})).length>0),7000);
  steps.push("browser opened a native SIDE_PANEL context through a trusted gesture");
  assert.equal(leaked,false);assert.ok(captures>=4);report.readerPageTrafficSourceMarker=false;report.result="pass";
}
main().catch(async e=>{
  report.result="failed";report.failure={step,type:e.name,detail:/^job phase: [\w-]+$|^(wait expired|native identity flow rejected)$/.test(e.message)?e.message:"operation failed"};
  if(ctx&&step==="native-consent"){
    report.consentPages=ctx.pages().map(p=>{try{const u=new URL(p.url());return u.pathname.startsWith("/extension/connect/")?"consent":u.pathname==="/login"?"login":u.protocol;}catch{return "other";}});
    const p=ctx.pages().find(p=>p.url().startsWith(base));if(p)report.panelErrorClass=await p.locator("#error").innerText().then(t=>
      !t?"none":t.includes("403")?"http-403":/could not|load|redirect|canceled|not supported|approval/i.test(t)?"browser-auth":"other").catch(()=>"unavailable");
  }
  process.exitCode=1;
}).finally(async()=>{if(ctx)await ctx.close().catch(()=>{});fs.writeFileSync(path.join(dir,"receipt.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
