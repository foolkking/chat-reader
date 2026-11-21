// Real browser, root login, real host sockets/maintenance fence/DB; no mocked HTTP.
const { createRequire } = require("node:module");
const path = require("node:path"), fs = require("node:fs"), assert = require("node:assert/strict");
const { chromium } = createRequire(path.resolve(__dirname, "../../apps/web/package.json"))("@playwright/test");
const origin=process.env.UPDATE_LAB_ALTERNATE_PORT==="32482"?"https://localhost:32482":"https://localhost:32481", args=process.argv.slice(2);
const scope=process.env.UPDATE_LAB_PROGRAM, thermal=process.env.UPDATE_LAB_CACHE;
const crypto=require("node:crypto");
const mark=(role,rev)=>crypto.createHash("sha256").update(`reader:${role}:${rev}`).digest("hex");
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function operator(...args){
 const lab=process.env.UPDATE_LAB_CONTAINER;
 assert.match(lab,/^cr-(?:update-lab-[0-9]+-[0-9]+|program-(?:e|final)-20261121)$/);
 return require("node:child_process").execFileSync("docker",["exec",lab,"python3","-B","/lab/source/scripts/ci/update-program-lab.py",...args],{stdio:"pipe"}).toString().trim();
}
async function main(){
 const credential=JSON.parse(fs.readFileSync(process.env.UPDATE_LAB_LOGIN,"utf8"));
 const browser=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {channel:"chromium"});
 try {
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},locale:"en-US",serviceWorkers:"block"});
  const p=await ctx.newPage();p.setDefaultTimeout(20000);
  assert.equal((await ctx.request.get(origin+"/api/admin/updates")).status(),401);
  assert.equal((await ctx.request.get(origin+"/__updates/status")).status(),404);
  await p.goto(origin+"/login");await p.locator("#login-email").fill(credential.email);await p.locator("#login-password").fill(credential.password);
  await p.getByRole("button",{name:/^(Sign in|登录)$/}).click();await p.waitForURL(u=>u.pathname==="/");
  const noOrigin=await ctx.request.post(origin+"/api/admin/updates/check",{headers:{Origin:"https://foreign.example.test"}});assert.equal(noOrigin.status(),403);
  let versionReads=0, checkedSystem=false;
  p.on("request",r=>{if(new URL(r.url()).pathname==="/api/admin/updates")versionReads++;});
  const open=async()=>{const before=versionReads;
    await p.goto(origin+"/");await p.getByRole("button",{name:/^(Settings|设置)$/}).click();
    const admin=p.locator('[aria-labelledby="settings-administration-heading"]');
    if(!checkedSystem){
      await admin.getByRole("button",{name:/^(System|系统)$/}).click();
      const system=p.getByRole("dialog",{name:/^(System|系统)$/});await system.waitFor();
      assert.equal(await system.getByText(/Version updates|版本更新/).count(),0,"no version entry in ordinary System settings");
      await p.keyboard.press("Escape");checkedSystem=true;
    }
    await admin.getByRole("button",{name:/^(Runtime status|运行状态)$/}).click();
    const runtime=p.getByRole("region",{name:/^(Runtime status|运行状态)$/});
    const show=runtime.getByRole("button",{name:/^(Version updates|版本更新)$/});await show.waitFor();
    assert.equal(await show.getAttribute("aria-expanded"),"false");assert.equal(versionReads,before,"no updater access before the explicit runtime disclosure");
    await show.click();
    return runtime.getByRole("region",{name:/Version updates|版本更新/});};
  const measured=[];
  let revisions,writeIds=[];
  const write=async(label)=>{
    const title="program verification "+label+" "+crypto.randomUUID();
    const r=await ctx.request.post(origin+"/api/conversations",{data:{title,messages:[{role:"user",content_markdown:title},{role:"assistant",content_markdown:"preserve this synthetic reply"}]},headers:{Origin:origin}});
    assert.equal(r.status(),201);const id=(await r.json()).conversation.id;writeIds.push(id);
  };
  if(scope){
    assert.ok(["web","api","api+web"].includes(scope)&&["cold","warm"].includes(thermal));
    revisions=JSON.parse(operator("cert",scope));await write("before");
  }
  for(const action of (args.length?args:["apply","rollback"])){
   const panel=await open();
   if(action==="apply"){
    await panel.getByRole("button",{name:/Check for updates|检查更新/}).click();
    const download=panel.getByRole("button",{name:/^Download and verify$|^下载并验证$/});await download.waitFor();
    let stopped=false,observing=false;const begin=performance.now();
    const timer=setInterval(async()=>{if(observing)return;observing=true;try{if((await ctx.request.get(origin+"/api/health")).status()!==200 ||
      (await ctx.request.get(origin+"/login")).status()!==200)stopped=true;}catch{stopped=true;}finally{observing=false;}},350);
    const restart=panel.getByRole("button",{name:/Restart to upgrade|重启并升级/});
    try{await download.click();await restart.waitFor({timeout:240000});}finally{clearInterval(timer);}
    const elapsed=Math.round(performance.now()-begin), state=await (await ctx.request.get(origin+"/api/admin/updates")).json();
    assert.ok(!stopped && state.prepared && state.archive_bytes>0);assert.ok(state.download_ms>0 && state.ready_ms>=state.download_ms);
    measured.push({action:"prepare",archive_bytes:state.archive_bytes,download_ms:state.download_ms,ready_host_ms:state.ready_ms,click_to_ready_ms:elapsed,
      continuous_probes:true,phases_ms:state.job.timings_ms});
    console.log("prepare metrics: "+JSON.stringify(measured.at(-1)));
    if(scope){
      assert.equal(state.plan?.mode,"program");assert.deepEqual(state.plan.roles,scope.split("+"));
      assert.ok(state.plan.recovery_at);operator("cache",scope,thermal);
    }
    await restart.click();
   }
   else await panel.getByRole("button",{name:/Roll back to|回滚到/}).click();
   if(scope) {
    await panel.getByText(/Program-only update|仅换程序/).waitFor();
    if(process.env.UPDATE_LAB_METRICS && action==="apply"){
      const image=path.join(path.dirname(process.env.UPDATE_LAB_METRICS),`confirm-${scope}.png`);
      if(!fs.existsSync(image)) await panel.screenshot({path:image});
    }
    const expected={};
    for(const r of ["api","web"])expected[r]=mark(r,action==="apply"&&scope.split("+").includes(r)?revisions.next:revisions.old);
    const anon=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:"block"});
    let stop=false,outage=0,maxGap=0,firstReady=null,lastGood=performance.now(),wasDown=false,samples=0;
    const start=performance.now();
    const probe=(async()=>{while(!stop){
      const replies=await Promise.all(["/login","/api/health","/api/admin/runtime-status"].map(path=>anon.request.get(origin+path,{timeout:1800}).catch(()=>null)));
      const now=performance.now(),ok=replies.every((x,i)=>x&&x.status()===[200,200,401][i]);
      samples++;
      if(!ok){wasDown=true;firstReady=null;}
      else {
        if(wasDown){outage+=now-lastGood;maxGap=Math.max(maxGap,now-lastGood);wasDown=false;}
        lastGood=now;
        const matched=replies[0].headers()["x-chat-reader-build"]===expected.web&&replies[1].headers()["x-chat-reader-build"]===expected.api;
        if(matched&&firstReady===null)firstReady=now;
        if(!matched)firstReady=null;
      }
      await Promise.all(replies.map(r=>r?.dispose())); if(!stop)await delay(90);
    }})();
    try {
      await panel.getByRole("button",{name:/Confirm restart and view progress|确认重启并查看进度/}).click();
      await p.waitForURL(origin+"/__updates/"); assert.equal((await p.reload()).status(),200);
      let terminal=false,wrote=false;
      for(let i=0;i<600;i++){
        const response=await ctx.request.get(origin+"/__updates/status");assert.equal(response.status(),200);
        const s=await response.json();
        assert.ok(!["fencing","draining","backup","migration"].includes(s.phase),"no full maintenance during program-only update");
        // On a Web-only cutover the still-running real API accepts user writes.
        if(scope==="web"&&!wrote&&s.phase==="program-switch"){await write("during");wrote=true;}
        if(["refused","recovery_required","restored"].includes(s.phase))throw Error(`${action}: ${s.phase} (${s.reason})`);
        if(s.phase==="succeeded"&&firstReady!==null){terminal=true;
          measured.push({action,scope,thermal,click_to_target_ms:Math.round(firstReady-start),
            click_to_confirmed_ms:Math.round(performance.now()-start),observed_outage_upper_ms:Math.round(outage),
            max_observed_gap_ms:Math.round(maxGap),probe_samples:samples,phases_ms:s.timings_ms});break;}
        await delay(80);
      }
      assert.ok(terminal);if(scope==="web")assert.ok(wrote,"concurrent API write while Web switches");
      await write("after");
      for(const id of writeIds)assert.equal((await ctx.request.get(origin+"/api/conversations/"+id)).status(),200);
      console.log("program metrics: "+JSON.stringify(measured.at(-1)));
    } finally {stop=true;await probe;await anon.close();}
    continue;
   }
   const start=performance.now();await panel.getByRole("button",{name:/Confirm restart and view progress|确认重启并查看进度/}).click();
   await p.waitForURL(origin+"/__updates/");
   const phases=new Set();let down=false, refreshed=false, outcome="",downAt=null,returnedAt=null,status={};
   for(let i=0;i<750;i++){
    const resp=await ctx.request.get(origin+"/__updates/status");assert.equal(resp.status(),200);
    status=await resp.json();const phase=status.phase;phases.add(phase);
    const code=(await ctx.request.get(origin+"/login")).status();
    if(!down && code===503){
     down=true;downAt=performance.now();const response=await p.reload();assert.equal(response.status(),200);await p.getByRole("heading",{name:/Version update|版本更新/}).waitFor();refreshed=true;
    }
    if(down && code===200 && returnedAt===null && (await ctx.request.get(origin+"/api/admin/updates")).status()===200)returnedAt=performance.now();
    if(["succeeded","restored","refused","recovery_required"].includes(phase)){outcome=phase;break;}
    await new Promise(r=>setTimeout(r,160));
   }
   console.log(`${action}: ${[...phases].join(" -> ")}; maintenance refresh=${refreshed}`);
   assert.equal(outcome,"succeeded");assert.ok(down&&refreshed);
   const state=await (await ctx.request.get(origin+"/api/admin/updates")).json();assert.equal(state.current,action==="apply"?"v1.1.0":"v1.0.0");
   assert.equal((await ctx.request.get(origin+"/")).status(),200);assert.equal((await ctx.request.get(origin+"/api/health")).status(),200);
   assert.notEqual(returnedAt,null);
   measured.push({action,click_to_healthy_ms:Math.round(returnedAt-start),click_to_confirmed_ms:Math.round(performance.now()-start),observed_outage_ms:Math.round(returnedAt-downAt),maintenance_refresh:refreshed,phases_ms:status.timings_ms});
   console.log(action+" metrics: "+JSON.stringify(measured.at(-1)));
  }
  if(scope)operator("verify",scope);
  if(process.env.UPDATE_LAB_METRICS)fs.writeFileSync(process.env.UPDATE_LAB_METRICS,JSON.stringify(measured,null,2));
 } finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
