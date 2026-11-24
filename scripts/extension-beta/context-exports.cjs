// Reader-only part of the loopback rehearsal. Download from both surfaces, without remounting Reader.
const fs=require("node:fs"), path=require("node:path"), crypto=require("node:crypto");
const {execFileSync}=require("node:child_process"), assert=require("node:assert/strict");
const fixture=path.join(__dirname,"context_fixture.py");
exports.check=async({ctx,origin,panel,row,menu,worker,signIn,until,mark,dir,label,cid,csv,png,report,steps})=>{
  const lab=require("./lab-target.cjs");assert.equal(origin,lab.origin);
  const evidence=report.contextDownloads={samples:[],rejected:{},webRequests:0};
  const hashes=[csv,png].map(b=>crypto.createHash("sha256").update(b).digest("hex"));
  evidence.seed=JSON.parse(execFileSync("docker",[...lab.fixtureArgs(),"seed",cid,label],{
    input:fs.readFileSync(fixture),encoding:"utf8",stdio:["pipe","pipe","pipe"]}));
  const verify=(file,policy,surface)=>{
    const result=execFileSync("python",[fixture,"check",file,cid,label,policy,...hashes],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
    evidence.samples.push({surface,...JSON.parse(result)});
  };
  await signIn();
  const pref=origin+"/api/preferences/context-quick-preset", headers={Origin:origin};
  const saved=await ctx.request.get(pref);assert.equal(saved.status(),200);
  const original=(await saved.json()).preset_id;
  assert.equal(original,null,"The disposable account must start with the standard Context preset");
  const id=crypto.randomUUID(),entry=origin+"/api/user-feature-entries/export-preset/"+id;
  let created=false,removed=false,revision;
  const set=async preset_id=>assert.equal((await ctx.request.put(pref,{headers,data:{preset_id}})).status(),200);
  const remove=async()=>{assert.equal((await ctx.request.delete(entry,{headers,params:{expected_revision:revision}})).status(),204);removed=true;};
  const reader=await ctx.newPage(),webPath=`/api/conversations/${cid}/quick-context`;
  reader.on("request",r=>{if(new URL(r.url()).pathname===webPath&&r.method()==="POST")evidence.webRequests++;});
  const webAction=reader.locator('[data-reader-header-action="quick-context"]:visible');
  const panelAction=menu.getByRole("button",{name:/Export context|导出上下文/i});
  const downloads=()=>worker.evaluate(async()=>(await chrome.downloads.search({state:"complete"})).map(d=>({id:d.id,file:d.filename})));
  async function panelExport(policy){
    const known=new Set((await downloads()).map(d=>d.id));
    const prev=await worker.evaluate(async()=>(await chrome.storage.local.get("exportJob")).exportJob?.aid);
    await row.locator(".row-more").click();
    await menu.locator(".menu-note").filter({hasText:policy==="include"?/包含附件文件|includes attachment files/i:/仅附件信息|attachment metadata only/i}).waitFor();
    await panelAction.click();
    await until(()=>worker.evaluate(async last=>{const j=(await chrome.storage.local.get("exportJob")).exportJob;return !!j?.aid&&j.aid!==last;},prev??null),45000);
    const file=await until(async()=>(await downloads()).find(d=>!known.has(d.id)),20000);
    verify(file.file,policy,"panel");
  }
  async function webExport(policy){
    const count=evidence.webRequests;
    await reader.locator("[data-reader-header-more-actions]").click();
    const [d]=await Promise.all([reader.waitForEvent("download",{timeout:45000}),webAction.click()]);
    const file=path.join(dir,`web-${policy}.context.zip`);
    await d.saveAs(file);verify(file,policy,"web");
    assert.equal(evidence.webRequests,count+1,"Each new export must resolve the current preset");
  }
  try{
    const resp=await ctx.request.put(entry,{headers,data:{expected_revision:0,value:{
      name:"Synthetic Context export",format:"context",include_attachments:true,include_continuation:false}}});
    assert.equal(resp.status(),200);revision=(await resp.json()).revision;created=true;
    await reader.setViewportSize({width:1280,height:820});
    await reader.goto(origin+"/conversations/"+cid);
    for(const policy of ["include","metadata_only"]){
      await set(policy==="include"?id:null);
      mark(`context-panel-${policy}`);await panelExport(policy);
      mark(`context-web-${policy}`);await webExport(policy);
    }
    steps.push("panel and same Reader document: verified both ZIP policies, attachment ownership, own private notes and exclusion of another subject");
    await set(id);await remove();
    const before=(await downloads()).length;
    const observe=(page,pathname)=>page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()==="POST",{timeout:15000});
    mark("context-unavailable-preset");
    await reader.locator("[data-reader-header-more-actions]").click();
    const [rejected]=await Promise.all([observe(reader,webPath),webAction.click()]);assert.equal(rejected.status(),409);
    await reader.getByRole("alert").filter({hasText:/预设|preset/i}).waitFor();evidence.rejected.web=409;
    await row.locator(".row-more").click();
    const [extRejected]=await Promise.all([observe(panel,`/api/extension/v1/conversations/${cid}/context`),panelAction.click()]);
    assert.equal(extRejected.status(),409);
    await panel.locator("#error").filter({hasText:/预设|preset/i}).waitFor();evidence.rejected.panel=409;
    assert.equal((await downloads()).length,before);
    steps.push("removed preset: both quick actions returned 409 rather than downloading a previous package");
  }finally{
    await set(original);
    if(created&&!removed)await remove();
    await reader.close();
  }
};
