// Only the disposable extension/lab from browser.cjs. A failing GET is injected
// once per new panel document. Successful reads and all catalog data are real.
const assert = require("node:assert/strict");
const path = require("node:path");

async function checkPanelNavigation({ctx, panel, base, origin, dir, pid, title, cid, zh, report}) {
  const result=report.panelNavigation={startup:{}, search:{}, magnified:{}}, checks=[];
  const want=(name,value)=>{checks.push([name,!!value]);};
  const copy=(cn,en)=>zh?cn:en;
  const empty=()=>panel.locator("#status").filter({hasText:/没有匹配的对话|No matching conversations/}).waitFor();
  const search=async(value,project,view)=>{
    await panel.locator("#q").fill(value);await panel.locator("#filter").selectOption(project);
    await panel.locator("#view").selectOption(view);await panel.locator("#find").click();
  };
  for(const stage of ["capabilities","projects"]){
    const fresh=await ctx.newPage();
    try{
      await fresh.setViewportSize({width:375,height:680});
      await fresh.addInitScript(({url,stage})=>{
        const real=window.fetch;let failed=false;
        window.fetch=function(input,opts){
          if(!failed&&String(input)===url&&(!opts?.method||opts.method==="GET")){
            failed=true;return stage==="projects"?Promise.resolve(new Response(null,{status:404})):
              Promise.reject(new TypeError("Synthetic interruption on a single catalog read"));
          }
          return real.apply(this,arguments);
        };
      },{url:`${origin}/api/extension/v1/${stage}`,stage});
      await fresh.goto(base+"/panel.html");
      await fresh.locator('[role="alert"],[role="status"]').filter({hasText:stage==="projects"?
        /未提供插件资料接口|extension catalog is unavailable|未提供此功能|feature or item is unavailable/i:
        /连接不到 Reader|Cannot reach Reader/i}).first().waitFor();
      const retry=fresh.getByRole("button",{name:copy("重新读取资料","Retry loading library"),exact:true});
      const state=result.startup[stage]={retry:await retry.isVisible(),catalogHidden:!await fresh.locator("#q").isVisible()};
      if(stage==="projects")state.unsupportedRouteNamed=/未提供插件资料接口|extension catalog is unavailable/i.test(await fresh.locator("#boot-status").innerText());
      if(stage==="capabilities")await fresh.screenshot({path:path.join(dir,"catalog-unavailable.png")});
      await fresh.getByRole("button",{name:copy("设置","Settings"),exact:true}).click();
      state.disconnectAvailable=await fresh.locator("#disconnect").isVisible();
      state.noUnverifiedDestination=!await fresh.locator("#choose").isVisible()||await fresh.locator("#choose").isDisabled();
      // A native close() queues its `close` event. Model the next focus choice
      // made before that event is delivered; its late handler must not steal it.
      if(stage==="projects"&&state.retry){
        await fresh.evaluate(()=>{
          const dlg=document.getElementById("settings"),retry=document.getElementById("boot-retry");
          window.labCloseFocus=new Promise(resolve=>dlg.addEventListener("close",()=>resolve(document.activeElement===retry),{once:true}));
          dlg.querySelector(".dismiss").addEventListener("click",()=>retry.focus(),{once:true});
        });
        await fresh.locator("#settings .dismiss").click();
        state.newFocusSurvivedClose=await fresh.evaluate(()=>window.labCloseFocus);
      }else await fresh.keyboard.press("Escape");
      if(state.retry){
        await retry.focus();await retry.press("Enter");
        await fresh.locator("#filter option").filter({hasText:"Tide project "}).first().waitFor({state:"attached",timeout:5000});
        await fresh.locator("#q").waitFor();
        state.focusedSearch=await fresh.locator("#q").evaluate(el=>el===document.activeElement);
        state.settingsClosed=!await fresh.locator("#settings").isVisible();
        state.retryDismissed=!await retry.isVisible();
        state.recovered=state.focusedSearch&&state.settingsClosed&&state.retryDismissed;
      }else state.recovered=false;
      for(const [key,value] of Object.entries(state))want(stage+"."+key,value);
    }finally{await fresh.close();}
  }

  await panel.bringToFront();await panel.setViewportSize({width:375,height:680});await panel.emulateMedia({colorScheme:"light"});
  await search(title,pid,"pinned");await empty();
  // The query belongs to a real, unclassified record. Remove one constraint
  // at a time; neither action is allowed to wipe the text or another filter.
  const unpin=panel.getByRole("button",{name:copy("包含未置顶对话","Include unpinned conversations"),exact:true});
  if(await unpin.isVisible()){await unpin.click();await empty();}
  else{
    // Measure the old action's actual consequence, not just a missing label.
    const old=panel.getByRole("button",{name:copy("清除筛选","Clear filters"),exact:true});
    if(await old.isVisible())await old.click();
  }
  result.search.keptQueryAndProject=await panel.locator("#q").inputValue()===title&&
    await panel.locator("#filter").inputValue()===pid&&await panel.locator("#view").inputValue()==="recent";
  result.search.removedOnlyPinScope=await panel.locator("#view").inputValue()==="recent";
  want("search.keptQueryAndProject",result.search.keptQueryAndProject);
  await search(title,pid,"recent");await empty();
  await panel.screenshot({path:path.join(dir,"empty-in-project.png")});
  const wider=panel.getByRole("button",{name:copy("搜索所有项目","Search all projects"),exact:true});
  if(await wider.isVisible()){
    await wider.click();
    const found=panel.locator(`#rows li[data-cid="${cid}"] a.row-title`);await found.waitFor({timeout:6000});
    const [tab]=await Promise.all([ctx.waitForEvent("page"),found.click()]);await tab.waitForLoadState("domcontentloaded");
    const opened=new URL(tab.url()); // this profile is signed out of Reader Web at this point
    await tab.close();await panel.bringToFront();
    result.search.returnsToSameResult=opened.origin===origin&&await panel.locator("#q").inputValue()===title&&
      await panel.locator("#filter").inputValue()===""&&await found.isVisible();
  }else result.search.returnsToSameResult=false;
  want("search.returnsToSameResult",result.search.returnsToSameResult);

  await search("",pid,"recent");await panel.locator("#rows li .clip").first().waitFor();
  const zoom=await panel.addStyleTag({content:"html { zoom: 2; }"});
  try{
    result.magnified=await panel.locator("#rows li").first().evaluate(li=>{
      const el=s=>li.querySelector(s),box=e=>e.getBoundingClientRect(),header=document.querySelector(".mast h1");
      const range=document.createRange(),text=[...header.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
      range.selectNodeContents(text);
      return {headerLines:range.getClientRects().length,decorativeGutter:el(".lead").getClientRects().length!==0,
        titleWidth:Math.round(box(el(".name")).width),actionsWidth:Math.round(box(el(".row-more")).width),
        horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
        searchTop:Math.round(box(document.querySelector("#q")).top),
        firstRowTop:Math.round(box(document.querySelector("#rows li")).top)};
    });
    await panel.screenshot({path:path.join(dir,"catalog-magnified.png")});
    want("magnified.headerFits",result.magnified.headerLines===1);
    want("magnified.titleGetsGutter",!result.magnified.decorativeGutter);
    want("magnified.actionTargetAndNoOverflow",result.magnified.actionsWidth>=88&&!result.magnified.horizontalOverflow);
    const pin=panel.locator("#rows .pinned").first();
    want("magnified.meaningfulPinVisible",await pin.isVisible());
  }finally{await zoom.evaluate(el=>el.remove());}
  await panel.setViewportSize({width:375,height:860});await search(title,"","recent");
  await panel.locator(`#rows li[data-cid="${cid}"]`).waitFor();
  result.failed=checks.filter(([,pass])=>!pass).map(([name])=>name);
  assert.deepEqual(result.failed,[],"The catalog must recover in place and remain readable under magnification");
}
// Hold ONLY acknowledgement of one real lab pin write. Do not print/store its URL
// or headers. The server has committed, but the panel has not yet received it.
async function holdPinReply(panel,origin,cid){
  await panel.evaluate(({origin,cid})=>{
    const real=window.fetch;
    window.fetch=async function(input,opts){
      const response=await real.apply(this,arguments),u=new URL(String(input),location.href);
      if(u.origin===origin&&u.pathname===`/api/extension/v1/conversations/${cid}/pin`&&opts?.method==="PATCH"&&response.status===204){
        window.fetch=real;await new Promise(resolve=>{window.releaseLabPin=resolve;});
      }
      return response;
    };
  },{origin,cid});
}
async function failOnePin(panel,origin,cid){
  await panel.evaluate(({origin,cid})=>{
    const real=window.fetch;let pending=true;
    window.fetch=async function(input,opts){
      const u=new URL(String(input),location.href);
      if(pending&&u.origin===origin&&u.pathname===`/api/extension/v1/conversations/${cid}/pin`&&opts?.method==="PATCH"){
        pending=false;window.fetch=real;return new Response(null,{status:503});
      }
      return real.apply(this,arguments);
    };
  },{origin,cid});
}
module.exports={checkPanelNavigation,holdPinReply,failOnePin};
