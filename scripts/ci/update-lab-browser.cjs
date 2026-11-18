// Real browser, root login, real host sockets/maintenance fence/DB; no mocked HTTP.
const { createRequire } = require("node:module");
const path = require("node:path"), fs = require("node:fs"), assert = require("node:assert/strict");
const { chromium } = createRequire(path.resolve(__dirname, "../../apps/web/package.json"))("@playwright/test");
const origin="https://localhost:32481", args=process.argv.slice(2);
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
    console.log("prepare metrics: "+JSON.stringify(measured.at(-1)));await restart.click();
   }
   else await panel.getByRole("button",{name:/Roll back to|回滚到/}).click();
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
  if(process.env.UPDATE_LAB_METRICS)fs.writeFileSync(process.env.UPDATE_LAB_METRICS,JSON.stringify(measured,null,2));
 } finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
