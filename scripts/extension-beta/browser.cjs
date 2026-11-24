// Local, isolated acceptance only. Never attach to someone's existing browser/profile.
// The source site is synthetic; DNS is blocked even if an interception rule fails.
const { chromium } = require("../../apps/web/node_modules/@playwright/test");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process"), assert = require("node:assert/strict");
const lab = require("./lab-target.cjs"), origin = lab.origin, source = "https://chatgpt.com";
const [binary, build, parent, label] = process.argv.slice(2);
const dir = path.resolve(parent, label);
if (!["E:\\chat-reader-temp\\", "C:\\Users\\86182\\Desktop\\wkkk\\"].some(p => dir.toLowerCase().startsWith(p.toLowerCase()))
    || !/^[a-z0-9-]+$/.test(label)) throw Error("Explicit new rehearsal directory required.");
const extensionBuild=JSON.parse(execFileSync("python",["-I","-B",path.join(__dirname,"verify_extension_build.py"),path.resolve(build),origin,process.env.READER_TEST_EXTENSION_SHA256||""],{encoding:"utf8"}));
fs.mkdirSync(dir);
const base = "chrome-extension://gihbiofiiflkckcmomddkkjkoifkddfi", steps = [];
const wait = ms => new Promise(r => setTimeout(r,ms)), title = "Tide notebook · "+label;
let name = "synthetic-"+crypto.randomUUID();
const sourceMarker = "synthetic-source-only", report = {label,source:"network-isolated synthetic fixture",extensionBuild,steps};
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
  let n=3,changed=false,leaked=false,captures=0,missing=false,delaySource=false,slowRead=false,oversize=false;
  const faults=label.includes("faults");
  const zh=label.includes("zh");
  async function launch(){
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
      if(u.pathname==="/backend-api/conversation/"+name){captures++;if(oversize)return r.fulfill({contentType:"application/json",body:" ".repeat(8*1024*1024+1)});
        return r.fulfill({json:tree(n,changed)});}
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
  }
  await launch();
  // The gateway has separate API and Web upstreams. A healthy API is not a usable login page.
  // Do not revoke any disposable device or create projects when this build cannot even sign in.
  mark("lab-readiness");
  const ready=report.readiness={apiStatus:null,loginStatus:null,loginFormVisible:false,fixtureSetupStarted:false};
  const health=await ctx.request.get(origin+"/api/health",{maxRedirects:0,timeout:8000});
  ready.apiStatus=health.status();assert.equal(ready.apiStatus,200);assert.equal((await health.json()).status,"ok");
  const loginProbe=await ctx.newPage();
  try{
    const response=await loginProbe.goto(origin+"/login",{waitUntil:"domcontentloaded",timeout:12000});
    ready.loginStatus=response?.status()??null;
    assert.equal(ready.loginStatus,200);assert.equal(loginProbe.url(),origin+"/login");
    await Promise.all(['input[type="email"]','input[type="password"]','button[type="submit"]'].map(
      css=>loginProbe.locator(css).waitFor({state:"visible",timeout:12000})));
    ready.loginFormVisible=true;
  }finally{await loginProbe.close();}
  if(!process.env.BETA_TEST_PASSWORD)throw Error("Disposable test login required");
  mark("web-login");
  const signIn=async()=>{
    // An independent-session mutation below still signs in for real. For a
    // continuing account reuse its verified first-party session: sending the
    // password before every assertion can exhaust the genuine login throttle.
    const current=await ctx.request.get(origin+"/api/auth/session");
    assert.equal(current.status(),200);
    const s=await current.json();
    if(s.authenticated){assert.equal(s.email,"browser-beta@example.test");return;}
    assert.equal((await ctx.request.post(origin+"/api/auth/login",{headers:{Origin:origin},data:{
      email:"browser-beta@example.test",password:process.env.BETA_TEST_PASSWORD}})).status(),200);
  };
  ready.fixtureSetupStarted=true;await signIn();
  assert.equal(origin,lab.origin);assert.ok(["reader-ext-beta-1123","reader-scope-1123"].includes(lab.project));
  const oldDevicesResponse=await ctx.request.get(origin+"/api/extension-devices");
  assert.equal(oldDevicesResponse.status(),200);
  const oldDevices=await oldDevicesResponse.json();assert.equal(oldDevices.enabled,true);assert.ok(Array.isArray(oldDevices.items));
  for(const device of oldDevices.items){
    assert.match(device.id,/^[\da-f-]{36}$/i);
    assert.equal((await ctx.request.delete(origin+"/api/extension-devices/"+device.id,{headers:{Origin:origin}})).status(),204);
  }
  const remainingDevices=await ctx.request.get(origin+"/api/extension-devices");
  assert.equal(remainingDevices.status(),200);assert.equal((await remainingDevices.json()).items.length,0);
  report.rehearsalDeviceCleanup={revoked:oldDevices.items.length,remaining:0,scope:lab.project};
  const projectReq=await ctx.request.post(origin+"/api/projects",{headers:{Origin:origin},data:{name:"Tide project "+label}});
  assert.equal(projectReq.status(),201);const pid=(await projectReq.json()).id;
  if(faults)await ctx.clearCookies();
  let panel=await ctx.newPage();
  mark("installed-panel");await panel.goto(base+"/panel.html",{timeout:9000});await panel.locator("#connect").waitFor();
  let worker=ctx.serviceWorkers().find(w=>w.url().startsWith(base))||await ctx.waitForEvent("serviceworker",{timeout:10000});
  assert.equal(await worker.evaluate(()=>chrome.runtime.id),"gihbiofiiflkckcmomddkkjkoifkddfi");
  report.redirectHost=await panel.evaluate(()=>new URL(chrome.identity.getRedirectURL("reader")).hostname);
  await worker.evaluate(()=>chrome.sidePanel.getPanelBehavior()).then(b=>assert.equal(b.openPanelOnActionClick,true));
  steps.push("installed extension, toolbar registered to open side panel");
  const authTick=Date.now(),timings=[];
  const noteAuth=r=>{const u=new URL(r.url());if(u.origin!==origin)return;
    const kind=u.pathname==="/login"?"login-page":u.pathname.startsWith("/extension/connect/")?"consent":
      u.pathname==="/api/extension-devices/authorize"?"device-authorize":
      u.pathname==="/api/auth/session"?"read-session":u.pathname==="/api/auth/login"?"login-api":null;
    if(kind&&timings.length<24)timings.push({kind,status:r.status(),ms:Date.now()-authTick});};
  ctx.on("response",noteAuth);report.nativeAuthorization=timings;
  // Reproduce a passive *anonymous* Reader lookup arriving after the user's login.
  // Forward the actual reply (no fabricated cookies, session or auth success).
  let releaseRead,heldRead=false,delayedPage,observedRead;
  const holdRead=new Promise(done=>{releaseRead=done;});
  const delayedRead=async route=>{
    const reply=await route.fetch();const state=await reply.json();
    assert.equal(state.authenticated,false);assert.equal(reply.status(),200);
    report.anonymousReadSetsCookie=reply.headersArray().some(h=>h.name.toLowerCase()==="set-cookie");
    heldRead=true;await holdRead;await route.fulfill({response:reply});
  };
  if(faults){
    // A second ordinary first-party tab is controllable by Playwright; a native
    // identity window does not inherit context-wide routing in every browser.
    mark("delayed-first-party-read");delayedPage=await ctx.newPage();await delayedPage.goto(origin+"/api/health");
    await delayedPage.route(origin+"/api/auth/session",delayedRead);
    observedRead=delayedPage.evaluate(async()=>(await (await fetch("/api/auth/session",{cache:"no-store"})).json()).authenticated);
    await until(()=>heldRead,12000);
  }
  mark("native-consent");await panel.locator("#connect").click();
  const button=/授权此设备|Authorize this device/i;
  if(faults){
    try{
      const form=await until(()=>ctx.pages().find(p=>p.url().startsWith(origin+"/login")),12000);
      form.on("response",noteAuth);
      await form.locator('input[type="email"]').fill("browser-beta@example.test");
      await form.locator('input[type="password"]').fill(process.env.BETA_TEST_PASSWORD);
      const [reply]=await Promise.all([form.waitForResponse(r=>r.url()===origin+"/api/auth/login"&&r.request().method()==="POST",{timeout:12000}),form.locator('button[type="submit"]').click()]);
      report.authorizationLoginStatus=reply.status();assert.equal(reply.status(),200);assert.equal(report.anonymousReadSetsCookie,false);
    }finally{releaseRead();await observedRead.then(authenticated=>assert.equal(authenticated,false));await delayedPage.close();}
    steps.push("signed-out native authorization and delayed anonymous read did not erase the new login");
  }
  const consent=await until(async()=>{const p=ctx.pages().find(p=>p.url().startsWith(origin+"/extension/connect/"));
    if(p)return p;if(await panel.locator("#error").textContent())throw Error("native identity flow rejected");},12000);
  mark("native-consent-page");
  if(label.includes("device-limit")){
    assert.equal(lab.project,"reader-scope-1123");
    const fixture=path.join(__dirname,"device_limit_fixture.py");
    const fixtureAction=action=>JSON.parse(execFileSync("docker",[...lab.fixtureArgs(),action],
      {input:fs.readFileSync(fixture),encoding:"utf8",stdio:["pipe","pipe","pipe"]}));
    assert.deepEqual(fixtureAction("seed"),{action:"seed",rows:32});
    mark("device-limit-seeded");
    let deviceLimitFailureStep=null;
    try{
      const before=timings.filter(x=>x.kind==="device-authorize").length;
      await consent.getByRole("button",{name:button}).click({timeout:12000});
      mark("device-limit-clicked");
      const expected=zh?"浏览器插件授权已达上限":"The browser extension limit has been reached";
      await until(()=>consent.locator('[role="alert"]').first().evaluate((el,needle)=>el.textContent?.includes(needle),expected).catch(()=>false));
      mark("device-limit-message");
      const denied=await until(()=>{const rows=timings.filter(x=>x.kind==="device-authorize");return rows.length>before&&rows.at(-1).status===409?rows.at(-1):null;});
      mark("device-limit-409");
      const openReader=consent.getByRole("link",{name:/打开 Reader|Open Reader/});
      assert.equal(await openReader.getAttribute("href"),"/");assert.equal(await openReader.getAttribute("target"),"_blank");
      mark("device-limit-recovery-link");
      await consent.setViewportSize({width:375,height:820});
      const errorLayout=await consent.evaluate(()=>({
        scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,
        recoveryHeight:[...document.querySelectorAll("a")].find(a=>/open reader|打开 reader/i.test(a.textContent||""))?.getBoundingClientRect().height||0
      }));
      assert.ok(errorLayout.scrollWidth<=errorLayout.clientWidth&&errorLayout.recoveryHeight>=44);
      await consent.screenshot({path:path.join(dir,"authorization-device-limit.png")});
      report.deviceLimitRecovery={httpStatus:denied.status,messageVisible:true,recoveryLink:true,syntheticRows:32,viewport:375,noHorizontalOverflow:true,recoveryHeight:errorLayout.recoveryHeight};
    }catch(error){
      deviceLimitFailureStep=step;throw error;
    }finally{
      try{
        assert.deepEqual(fixtureAction("clear"),{action:"clear",rows:32});
        if(deviceLimitFailureStep)step=deviceLimitFailureStep;else mark("device-limit-cleaned");
      }catch(error){
        mark("device-limit-cleanup-failed");throw error;
      }
    }
    steps.push("device-authorisation limit returned a clear recovery path; synthetic grants removed before retry");
  }
  await consent.getByRole("button",{name:button}).click({timeout:12000});
  mark("native-panel-choose");await panel.locator("#choose").waitFor({timeout:12000});await panel.locator("#choose").click();
  ctx.off("response",noteAuth);
  steps.push("genuine browser PKCE consent and explicit destination");
  // Only after validating the localhost lab identity. No live user data or snapshots in the fixture.
  execFileSync("docker",[...lab.fixtureArgs(),pid,zh?"zh":"en"],{input:fs.readFileSync(path.join(__dirname,"seed_catalog.py")),stdio:["pipe","pipe","pipe"]});
  await panel.locator("#filter").selectOption(pid);await until(()=>panel.locator("#rows li").count().then(n=>n===5));
  await panel.locator("#view").selectOption("pinned");await until(()=>panel.locator("#rows li").count().then(n=>n===1));
  await panel.locator("#view").selectOption("recent");await until(()=>panel.locator("#rows li").count().then(n=>n===5));
  for(const w of [320,375,480])for(const theme of ["light","dark"]){
    await panel.setViewportSize({width:w,height:860});await panel.emulateMedia({colorScheme:theme});
    assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await panel.locator("#view").evaluate(el=>{const css=getComputedStyle(el),ctx=document.createElement("canvas").getContext("2d");
      ctx.font=css.fontWeight+" "+css.fontSize+" "+css.fontFamily;
      return ctx.measureText(el.selectedOptions[0].text).width<=el.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)+1;
    }),"The current view must remain readable next to a long project name");
    assert.ok(await panel.locator("#rows li").first().evaluate(el=>Math.abs(
      el.querySelector("time").getBoundingClientRect().top-el.querySelector(".clip").getBoundingClientRect().top)<=2),
      "A long project label must not push the date or attachment count onto a separate line");
    if(w===375&&theme==="light"){report.resting=await panel.evaluate(()=>({
      searchTop:Math.round(document.querySelector("#q").getBoundingClientRect().top),firstRowTop:Math.round(document.querySelector("#rows li").getBoundingClientRect().top),
      actionWidth:Math.round(document.querySelector(".row-more").getBoundingClientRect().width)}));
      assert.ok(report.resting.searchTop<=96&&report.resting.firstRowTop<=200&&report.resting.actionWidth>=44);}
    await panel.screenshot({path:path.join(dir,`library-${w}-${theme}.png`)});
  }
  await panel.setViewportSize({width:375,height:680});await panel.emulateMedia({colorScheme:"light"});
  const zoom=await panel.addStyleTag({content:"html { zoom: 2; }"});assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await panel.evaluate(()=>document.querySelector("#view").getBoundingClientRect().bottom<=
    document.querySelector("#filter").getBoundingClientRect().top+1),"Magnified filter labels must get their own line");
  await panel.screenshot({path:path.join(dir,"library-text-200.png")});await zoom.evaluate(el=>el.remove());
  await panel.setViewportSize({width:375,height:860});await panel.locator("#filter").selectOption("");
  steps.push("real recent and project-pinned rows; long localized titles, both themes and 200% CSS magnification without overflow");
  // No Reader webpage or browser cookies needed after explicit device authorization.
  for(const p of ctx.pages())if(p!==panel)await p.close();await ctx.clearCookies();
  let chat=await ctx.newPage();
  const jobs=()=>worker.evaluate(async()=>(await chrome.storage.local.get("jobs")).jobs?.map(j=>({phase:j.phase,key:j.key,cid:j.cid,
    review:j.review?.action,partial:j.review?.partial,result:j.result}))||[]);
  async function sourceButton(re,click=false){
    const ax=await ctx.newCDPSession(chat);
    try{const entry=await until(async()=>(await ax.send("Accessibility.getFullAXTree")).nodes.find(n=>n.role?.value==="button"&&re.test(n.name?.value||"")),10000);
      if(click){const {model}=await ax.send("DOM.getBoxModel",{backendNodeId:entry.backendDOMNodeId});const c=model.content;
        await chat.mouse.click((c[0]+c[4])/2,(c[1]+c[5])/2);}return entry.name.value;
    }finally{await ax.detach();}
  }
  async function beginSource(recheck=false){
    await chat.goto(source+"/c/"+name,{waitUntil:"domcontentloaded"});
    await chat.bringToFront();
    if(recheck){await sourceButton(/打开已存版本|部分已保存|查看保存问题|已另存副本|Open saved version|Partially saved|Review save issue|Copy saved/);
      await sourceButton(/Other actions|其他操作/,true);await sourceButton(/Check and save this version|检查并保存当前版本/,true);}
    else await sourceButton(/Save to Reader|保存到 Reader/,true);
  }
  async function clickSource(stage,recheck=false){
    const before=(await jobs()).at(-1)?.key;await beginSource(recheck);
    const j=await until(async()=>{const v=await jobs(),last=v.at(-1);if(!last||last.key===before)return null;
      if(["check","attention","upload-rejected","reconnect"].includes(last.phase)||stage==="done"&&last.phase==="review")throw Error("job phase: "+last.phase);
      return last.phase===stage?last:null;},75000);
    return j;
  }
  if(label.includes("-excerpt-only")){
    await chat.goto(source+"/c/"+name,{waitUntil:"domcontentloaded"});
    await require("./selective-append.cjs").check({ctx,chat,origin,sourceButton,signIn,until,mark,dir,label,report,steps});
    assert.equal(leaked,false);report.scope="selective append only; not full extension acceptance";report.result="pass";return;
  }
  mark("capture-import");const first=await clickSource("done");assert.ok(first.cid);steps.push("real capture, ZIP and committed file import");
  assert.equal(first.result.action,"created");assert.equal(first.result.completeness,"complete");await sourceButton(/已存入 Reader|Saved to Reader/);
  await chat.screenshot({path:path.join(dir,"source-committed.png")});
  mark("source-open");const prior=captures,openResult=ctx.waitForEvent("page");await sourceButton(/已存入 Reader|Saved to Reader/,true);
  const savedTab=await openResult;await savedTab.waitForLoadState("domcontentloaded");await savedTab.close();assert.equal(captures,prior);
  await chat.bringToFront();
  // Exercise the same document: changes on screen can invalidate a green check, not prove a new snapshot.
  mark("source-message-edit");await chat.evaluate(()=>document.querySelector("[data-message-id]").setAttribute("data-message-id","fixture-after-edit"));
  await sourceButton(/打开已存版本|Open saved version/);
  const originalPath=new URL(chat.url()).pathname,otherPath="/c/synthetic-unseen-"+crypto.randomUUID();
  // Log only booleans about this synthetic document. Never record a tab URL or message body.
  await worker.evaluate(()=>{chrome.runtime.onMessage.addListener((m,s)=>{
    if(m?.kind!=="source-state"||!s.tab||s.frameId!==0)return;
    const docPath=new URL(s.url).pathname;
    chrome.tabs.get(s.tab.id).then(t=>{globalThis.betaPathProof={documentMatches:docPath===m.path,
      currentTabMatches:!!t.url&&new URL(t.url).pathname===m.path,documentIdentified:!!s.documentId};}).catch(()=>{});
  });});
  const switchPath=p=>chat.evaluate(p=>{history.pushState(null,"",p);document.querySelector("main p").textContent="Synthetic navigation";},p);
  mark("source-spa-new");await switchPath(otherPath);await sourceButton(/^(保存到 Reader|Save to Reader)$/);
  report.sourceNavigationProof=await worker.evaluate(()=>globalThis.betaPathProof);
  mark("source-spa-back");await switchPath(originalPath);await sourceButton(/打开已存版本|Open saved version/);
  assert.equal(captures,prior);steps.push("same-document navigation and a changed message invalidate the previous check without recapturing");
  await chat.reload();await sourceButton(/打开已存版本|Open saved version/);steps.push("committed page button opens without capturing and revisiting distinguishes a historical save");
  mark("source-bound-lookup");
  await worker.evaluate(()=>{
    const request=ReaderClient.request;
    globalThis.betaSourceLookups=0;
    ReaderClient.request=async(...args)=>{if(args[1]==="sources/status")globalThis.betaSourceLookups++;return request(...args);};
  });
  const removed=await worker.evaluate(async cid=>{
    const {jobs=[]}=await chrome.storage.local.get("jobs"),remaining=jobs.filter(j=>j.cid!==cid);
    await chrome.storage.local.set({jobs:remaining});return jobs.length-remaining.length;
  },first.cid);
  assert.equal(removed,1);
  const beforeLookup=captures;await chat.reload();await sourceButton(/^(保存到 Reader|Save to Reader)$/);
  const lookups=()=>worker.evaluate(()=>globalThis.betaSourceLookups);
  assert.equal(await lookups(),0,"Browsing a chat is not permission to send its source ID to Reader");
  await sourceButton(/其他操作|Other actions/,true);await sourceButton(/查找已存版本|Find saved version/,true);
  await sourceButton(/打开已存版本|Open saved version/);assert.equal(await lookups(),1);
  await panel.bringToFront();await panel.locator("#settings-label").click();
  const opt=panel.locator("#source-lookup");assert.equal(await opt.isChecked(),false);
  await opt.check();await until(()=>worker.evaluate(async()=>{const v=await chrome.storage.local.get(["device","sourceLookupDevice"]);return v.sourceLookupDevice===v.device.id;}));
  await panel.locator("#settings .dismiss").click();await chat.bringToFront();const since=await lookups();
  await chat.reload();await sourceButton(/打开已存版本|Open saved version/);assert.ok(await lookups()>since);
  assert.equal(captures,beforeLookup,"Source lookup must not read or upload the conversation");
  await chat.screenshot({path:path.join(dir,"source-bound-lookup.png")});
  const sourceResult=ctx.waitForEvent("page");await sourceButton(/打开已存版本|Open saved version/,true);
  const sourceResultTab=await sourceResult;await sourceResultTab.waitForLoadState("domcontentloaded");
  const sourceResultUrl=new URL(sourceResultTab.url());
  assert.equal(sourceResultUrl.origin,origin);assert.equal(sourceResultUrl.pathname,"/conversations/"+first.cid);
  await sourceResultTab.close();await chat.bringToFront();
  steps.push("without a local receipt: no automatic source disclosure by default; manual lookup and explicit device opt-in each found the owned Reader record without recapture");
  mark("duplicate");const dupe=await clickSource("done",true);assert.equal(dupe.cid,first.cid);assert.equal(dupe.result.action,"unchanged");steps.push("identical import returns same conversation");
  mark("append");n=4;const appended=await clickSource("done",true);assert.equal(appended.cid,first.cid);assert.equal(appended.result.added_messages,1);steps.push("suffix appended to same conversation");
  mark("branch-conflict");changed=true;assert.equal((await clickSource("review",true)).review,"conflict");steps.push("branch conflict requests review");
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
    if(w===375&&theme==="light"){report.geometry=await panel.evaluate(()=>({searchTop:Math.round(document.querySelector("#q").getBoundingClientRect().top),
      firstRowTop:Math.round(document.querySelector("#rows li").getBoundingClientRect().top)}));assert.ok(report.geometry.searchTop<=96&&report.geometry.firstRowTop<=280);}
    await panel.screenshot({path:path.join(dir,`panel-${w}-${theme}.png`)});
  }
  mark("catalog-navigation-recovery");
  await require("./panel-navigation.cjs").checkPanelNavigation({ctx,panel,base,origin,dir,pid,title,cid:first.cid,zh,report});
  steps.push("catalog boot retries the failed read without a new grant; empty search keeps the query, project and pin scope; magnified rows yield space to titles");
  mark("project-operation-find-unclassified");await panel.locator("#filter").selectOption("unclassified");await row.waitFor({timeout:8000});
  const rowActions=row.getByRole("button",{name:(zh?"更多：":"More: ")+title,exact:true});
  mark("project-operation-open-menu");await rowActions.click();
  const menu=panel.locator("#row-menu");await menu.getByRole("button",{name:/Move to project|移到项目/}).click();
  await menu.locator("select").selectOption(pid);mark("project-operation-move");await menu.getByRole("button",{name:/^(移动|Move)$/}).click();
  mark("project-operation-reload");await row.waitFor({state:"detached",timeout:8000});await panel.locator("#filter").selectOption(pid);await row.waitFor();
  await rowActions.click();
  mark("project-pin-pending");await require("./panel-navigation.cjs").holdPinReply(panel,origin,first.cid);
  await menu.getByRole("button",{name:/^(项目置顶|Pin in project)$/i}).click();
  await panel.waitForFunction(()=>typeof window.releaseLabPin==="function",null,{timeout:7000});
  try{
    report.pinPending={oldActionsClosed:!await menu.isVisible(),duplicateActionDisabled:await row.locator(".row-more").isDisabled(),
      actionsMarkedBusy:await row.locator(".row-more").getAttribute("aria-busy")==="true",
      pendingStatusVisible:await row.getByRole("status").filter({hasText:/Updating…|正在更新…/}).isVisible(),
      menuActionsLocked:await menu.getByRole("button").count()===0,
      triggerLocked:!await row.locator(".row-more").isEnabled()};
    await panel.screenshot({path:path.join(dir,"pin-pending.png")});
    assert.ok(Object.values(report.pinPending).every(Boolean),
      "Do not offer the old action while the real pin result is pending");
  }finally{await panel.evaluate(()=>{window.releaseLabPin();delete window.releaseLabPin;});}
  await row.locator(".pinned").waitFor({state:"visible"}); // the old, not-yet-acknowledged row is still visible
  report.pinPending.returnedFocus=await row.locator(".row-more").evaluate(el=>el===document.activeElement);
  assert.ok(report.pinPending.returnedFocus,"Return focus to the row action after the confirmed update");
  mark("project-pin-failure-recovery");await rowActions.click();
  await require("./panel-navigation.cjs").failOnePin(panel,origin,first.cid);
  await menu.getByRole("button",{name:/取消项目置顶|Unpin in project/}).click();
  const failure=row.getByRole("alert");
  await failure.filter({hasText:/操作结果尚未确认|result is unconfirmed/i}).waitFor();
  report.pinFailure={explainsUnconfirmedResult:/尚未确认|unconfirmed/i.test(await failure.innerText()),
   focusableError:await failure.evaluate(el=>el===document.activeElement),
   oldWriteLocked:await row.locator(".row-more").isDisabled()};
  const reload=failure.getByRole("button",{name:/重新读取列表|Reload list/});
  await reload.focus();await reload.press("Enter");await row.locator(".row-more:enabled").waitFor();
  assert.ok(await row.locator(".row-more").evaluate(el=>el===document.activeElement));
  mark("project-pin-reopen");
  await rowActions.click();await menu.getByRole("button",{name:/取消项目置顶|Unpin in project/i}).waitFor();
  report.pinFailure.existingPinActionRetained=true;assert.ok(Object.values(report.pinFailure).every(Boolean),
    "A read-only recovery must keep the actually committed pin");
  await panel.keyboard.press("Escape");assert.ok(await row.locator(".row-more").evaluate(el=>el===document.activeElement));
  steps.push("move, scoped conversation search and project pin persisted");
  // Resolve the deliberate divergence without rebinding its original, then recheck the moved original.
  const reviewBox=panel.locator("#jobs details").first();await reviewBox.locator("summary").click();
  await reviewBox.getByRole("button",{name:/另存一份|Save separate copy/}).click();
  await until(async()=>(await jobs()).at(-1)?.result?.action==="separate_copy");assert.notEqual((await jobs()).at(-1).cid,first.cid);
  changed=false;await chat.bringToFront();const moved=await clickSource("done",true);
  assert.equal(moved.cid,first.cid);assert.equal(moved.result.saved_project.id,pid);assert.equal(moved.result.action,"unchanged");
  steps.push("separate outcome retains original binding; unchanged receipt reports actual moved project");
  mark("file-directory");await panel.locator("#q").fill("tide.csv");await panel.locator("#find").click();
  mark("grouped-file-hit");await row.locator(".hit").waitFor();assert.equal(await panel.locator("#rows li").count(),1);assert.ok(!(await row.innerText()).includes("tide.csv"));
  await row.locator(".row-more").click();const fa=menu.getByRole("link",{name:/在 Reader 查看附件|View files in Reader/});
  const fl=await fa.getAttribute("href");assert.ok(fl.startsWith(origin+"/conversations/"+first.cid+"?files=open"));
  mark("open-reader-files");await signIn();const fp=ctx.waitForEvent("page");await fa.click();const filesPage=await fp;
  const fileRow=filesPage.locator('[data-testid="conversation-file-row"]:visible').filter({hasText:"tide.csv"});
  mark("reader-file-actions");await fileRow.getByRole("button",{name:/更多文件操作|More file actions/}).click();
  mark("reader-file-menu-rename");
  await fileRow.getByRole("button",{name:/重命名|Rename/}).click();
  const dlg=filesPage.getByRole("dialog").filter({has:filesPage.getByRole("textbox",{name:/显示名称|Display name/})});
  mark("reader-file-rename");await dlg.getByRole("textbox").fill("renamed-tide.csv");await dlg.getByRole("button",{name:/^(保存|Save)$/}).click();
  await filesPage.locator('[data-testid="conversation-file-row"]:visible').filter({hasText:"renamed-tide.csv"}).waitFor();
  const filesDialog=filesPage.getByRole("dialog",{name:/当前对话文件|Conversation files/}).filter({visible:true});
  if(await filesDialog.count()===1)await filesDialog.getByRole("button",{name:/^(关闭|Close)$/}).click();
  await filesPage.close();
  steps.push("file hit returns only its conversation; opened Reader file panel and renamed owned file there");
  mark("context-export");await panel.locator("#q").fill(title);await panel.locator("#find").click();
  await require("./context-exports.cjs").check({ctx,origin,panel,row,menu,worker,signIn,until,mark,dir,label,
    cid:first.cid,csv,png,report,steps});
  mark("verify-postgres-files");const verified=execFileSync("docker",[...lab.fixtureArgs(),first.cid,
      crypto.createHash("sha256").update(csv).digest("hex"),crypto.createHash("sha256").update(png).digest("hex")],
    {input:fs.readFileSync(path.join(__dirname,"verify.py")),encoding:"utf8",stdio:["pipe","pipe","pipe"]});
  report.canonical=JSON.parse(verified);
  mark("selective-append");changed=false;n=3;name="synthetic-"+crypto.randomUUID();
  await chat.goto(source+"/c/"+name,{waitUntil:"domcontentloaded"});
  await require("./selective-append.cjs").check({ctx,chat,origin,sourceButton,signIn,until,mark,dir,label,report,steps});
  if(faults){
    mark("source-close-before-delivery");name="synthetic-"+crypto.randomUUID();changed=false;n=3;delaySource=true;
    await beginSource();await until(()=>slowRead);await chat.close();chat=await ctx.newPage();delaySource=false;
    await until(async()=>(await jobs()).at(-1)?.phase==="capture-interrupted");steps.push("source closed mid-resource: no upload, actionable interruption");
    mark("browser-temp-space");const cdp=await ctx.newCDPSession(panel);
    await cdp.send("Storage.overrideQuotaForOrigin",{origin:base,quotaSize:64*1024});
    try{await clickSource("storage-full",true);}finally{await cdp.send("Storage.overrideQuotaForOrigin",{origin:base});await cdp.detach();}
    steps.push("real OPFS quota override: insufficient temporary space produced no upload");
    mark("bounded-source");oversize=true;
    try{await clickSource("capture-limit",true);}finally{oversize=false;}
    assert.ok(!(await jobs()).at(-1).cid);steps.push("over-limit synthetic source stopped before upload with a distinct recovery state");
    mark("missing-file");missing=true;
    const partial=await clickSource("review",true);assert.equal(partial.partial,true);assert.equal(partial.review,"new");missing=false;
    steps.push("disconnected resource requires review before any publication");
    await panel.bringToFront();const issue=panel.locator("#jobs details").first();await issue.locator("summary").click();
    await issue.getByRole("button",{name:/只保存可用内容|Save available content/}).click();
    await until(async()=>(await jobs()).at(-1)?.phase==="done");
    assert.equal((await jobs()).at(-1).result.completeness,"partial");
    await panel.locator("#jobs summary").filter({hasText:/部分已保存|Partially saved/}).waitFor();
    await panel.screenshot({path:path.join(dir,"partial-terminal.png")});
    mark("partial-source-return");await chat.bringToFront();await sourceButton(/部分已保存|Partially saved/);steps.push("acknowledged partial save remains partial in the durable receipt, panel and page button");
    name="synthetic-"+crypto.randomUUID();
    const workerName=lab.container("worker");
    mark("worker-restart");execFileSync("docker",["stop","--time","15",workerName],{stdio:"ignore"});
    try{
      await beginSource();
      await until(async()=>["received","processing"].includes((await jobs()).at(-1)?.phase),30000);
      await chat.close();await panel.reload();
      const procId=async()=>{const c=await ctx.browser().newBrowserCDPSession();try{return (await c.send("SystemInfo.getProcessInfo")).processInfo.find(p=>p.type==="browser").id;}finally{await c.detach();}};
      const previousPid=await procId(),accepted=(await jobs()).at(-1).key;
      await ctx.close();await launch();assert.notEqual(await procId(),previousPid);
      panel=await ctx.newPage();await panel.goto(base+"/panel.html");await panel.locator("#q").waitFor();
      worker=ctx.serviceWorkers().find(w=>w.url().startsWith(base))||await ctx.waitForEvent("serviceworker",{timeout:10000});
      assert.equal((await jobs()).at(-1).key,accepted);steps.push("terminated browser, opened same disposable profile in a different browser process: original accepted receipt persisted");
    }finally{execFileSync("docker",["start",workerName],{stdio:"ignore"});}
    await until(async()=>(await jobs()).at(-1)?.phase==="done",90000);steps.push("durable received job finished after source closed, panel reloaded and worker restarted");
    mark("lost-upload-reply");chat=await ctx.newPage();const original=(await jobs()).at(-1).cid,checkDropped=await dropOneLocalReceipt();
    const same=await clickSource("done",true);
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
  // Do not persist exception URLs, headers, input values or locator text. These numeric
  // diagnostics identify rendering/focus/layering failures in the isolated Reader.
  if(ctx&&(step==="partial-source-return"||step.startsWith("source-spa-")||step==="source-message-edit")){
    const worker=ctx.serviceWorkers().find(w=>w.url().startsWith(base));if(worker)report.sourceNavigationProof=await worker.evaluate(()=>globalThis.betaPathProof).catch(()=>null);
    const page=ctx.pages().find(p=>p.url().startsWith(source+"/c/"));
    if(page){const c=await ctx.newCDPSession(page);try{
      const nodes=(await c.send("Accessibility.getFullAXTree")).nodes.filter(x=>x.role?.value==="button").map(x=>x.name?.value||"");
      report.sourceReturn={visible:await page.evaluate(()=>document.visibilityState==="visible"),
        focused:await page.evaluate(()=>document.hasFocus()),buttons:nodes.length,
        partial:nodes.some(x=>/部分已保存|Partially saved/.test(x)),review:nodes.some(x=>/需要确认|Review save/.test(x)),
        saving:nodes.some(x=>/正在保存|Saving…/.test(x)),failed:nodes.some(x=>/保存问题|save issue/.test(x)),
        checking:nodes.some(x=>/正在核对|Checking…/.test(x)),previous:nodes.some(x=>/打开已存版本|Open saved version/.test(x)),
        saved:nodes.some(x=>/已存入 Reader|Saved to Reader/.test(x)),save:nodes.some(x=>/^(保存到 Reader|Save to Reader)$/.test(x))};
    }finally{await c.detach();}}
  }
  if(ctx&&step.startsWith("reader-file")||ctx&&step==="web-quick-context"){
    const page=ctx.pages().filter(p=>p.url().startsWith(origin+"/conversations/")).at(-1);
    if(page){report.readerControls=await page.evaluate(()=>({
      menus:document.querySelectorAll('[data-reader-header-more-actions]').length,
      quick:[...document.querySelectorAll('[data-reader-header-action="quick-context"]')].map(x=>[x.getBoundingClientRect().width,x.matches(":disabled")]),
      fileRows:document.querySelectorAll("[data-attachment-id]").length,dialogs:document.querySelectorAll('[role="dialog"],dialog[open]').length,
      promptFields:document.querySelectorAll('[role="dialog"] input:not([type="checkbox"])').length})).catch(()=>null);
      await page.screenshot({path:path.join(dir,"reader-issue.png"),timeout:3000}).catch(()=>{});}
  }
  if(ctx&&step.startsWith("native-")){
    report.consentPages=ctx.pages().map(p=>{try{const u=new URL(p.url());return u.pathname.startsWith("/extension/connect/")?"consent":u.pathname==="/login"?"login":u.protocol;}catch{return "other";}});
    const consent=ctx.pages().find(p=>p.url().startsWith(origin+"/extension/connect/"));
    if(consent){report.consentSummary=await consent.evaluate(()=>({buttons:document.querySelectorAll("button").length,
      authorizeButton:[...document.querySelectorAll("button")].some(b=>/authorize this device|授权此设备/i.test(b.getAttribute("aria-label")||b.textContent||"")),
      emailFields:document.querySelectorAll('input[type="email"]').length,passwordFields:document.querySelectorAll('input[type="password"]').length,
      alert:document.querySelectorAll('[role="alert"]').length})).catch(()=>({evaluationFailed:true}));
      await consent.screenshot({path:path.join(dir,"native-consent-failure.png")}).catch(()=>{});}
    const p=ctx.pages().find(p=>p.url().startsWith(base));if(p)report.panelErrorClass=await p.locator("#error").innerText().then(t=>
      !t?"none":t.includes("403")?"http-403":/could not|load|redirect|canceled|not supported|approval/i.test(t)?"browser-auth":"other").catch(()=>"unavailable");
  }
  process.exitCode=1;
}).finally(async()=>{if(ctx)await ctx.close().catch(()=>{});fs.writeFileSync(path.join(dir,"receipt.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
