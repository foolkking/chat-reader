// Focus and drag against the actual isolated API/DB (no request interception).
const {createRequire}=require("node:module"), path=require("node:path"),fs=require("node:fs"),assert=require("node:assert/strict");
const {chromium}=createRequire(path.resolve(__dirname,"../../apps/web/package.json"))("@playwright/test");
const origin="https://localhost:32481";

async function dropPoint(heading, fraction, context) {
 const deadline = Date.now() + 11000;
 while (Date.now() < deadline) {
  await heading.scrollIntoViewIfNeeded({timeout: Math.max(1, deadline - Date.now())});
  const point = await heading.evaluate(async (el, fraction) => {
   const measure = () => {
    const pane = el.closest("[data-sidebar-navigation-scroll]")?.getBoundingClientRect();
    if (!pane || !el.isConnected || !el.getClientRects().length) return null;
    const rect = el.getBoundingClientRect();
    const left = Math.max(0, rect.left, pane.left), right = Math.min(innerWidth, rect.right, pane.right);
    const top = Math.max(0, rect.top, pane.top), bottom = Math.min(innerHeight, rect.bottom, pane.bottom);
    if (right - left < 4 || bottom - top < 4) return null;
    return {x: left + (right - left) * fraction, y: top + Math.min(16, (bottom - top) / 2)};
   };
   const before = measure();
   await new Promise(requestAnimationFrame);
   const after = measure();
   return before && after && Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1 ? after : null;
  }, fraction);
  if (point) return point;
 }
 throw Error(`${context}: drop heading never settled inside the sidebar`);
}

async function main(){
 const login=JSON.parse(fs.readFileSync(process.env.UPDATE_LAB_LOGIN,"utf8"));
 const browser=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{channel:"chromium"});
 try{
  for(const width of [224,320]){
   const mobile=width===320,ctx=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:"block",locale:"en-US",viewport:{width:mobile?320:1440,height:900},hasTouch:mobile,isMobile:mobile});
   const p=await ctx.newPage();p.setDefaultTimeout(12000); const api=ctx.request;
   assert.equal((await api.post(origin+"/api/auth/login",{data:login,headers:{Origin:origin}})).status(),200);
   const create=async(url,data)=>{const r=await api.post(origin+url,{data,headers:{Origin:origin}});assert.ok(r.ok());return r.json()};
   const name="Sidebar fixture "+width+" "+Date.now(),project=(await create("/api/projects",{name})).id;
   const convo=(await create("/api/conversations",{title:"Synthetic drag "+width,messages:[{role:"user",content_markdown:"Test."},{role:"assistant",content_markdown:"Test."}]})).conversation.id;
   await p.addInitScript(w=>localStorage.setItem("chat-reader:sidebar-width",JSON.stringify(w)),width);
   await p.goto(origin+"/");if(mobile)await p.getByTestId("mobile-sidebar-button").filter({visible:true}).first().click();
   const aside=p.locator("aside[data-reader-primary-sidebar]").filter({visible:true}).last();
   const row=aside.getByTestId("conversation-row-"+convo),group=aside.getByTestId("unclassified-container"),toggle=group.getByRole("button",{name:/^(Unclassified|未归类)(\s|$)/i});
   if(await toggle.getAttribute("aria-expanded")==="false")await toggle.click();
   async function drag(heading, name){
    const context = `${width}px drag to ${name}`;
    console.log(context);
    const pickup = row.getByRole("link").first();
    // hover() checks the live hit target. A row's bounding box alone can be outside the scrollport.
    await p.evaluate(() => {
     window.lastDragPickup = null;
     document.addEventListener("pointermove", event => {
      window.lastDragPickup = {x: event.clientX, y: event.clientY};
     }, {capture: true, once: true});
    });
    await pickup.hover();
    const hit = await pickup.evaluate(el => {
     const point = window.lastDragPickup;
     return point && el.contains(document.elementFromPoint(point.x, point.y)) ? point : null;
    });
    assert.ok(hit, `${context}: pointer did not land on the source link`);
    await p.mouse.down();await p.mouse.move(hit.x+14,hit.y,{steps:5});await p.getByTestId("sidebar-drag-overlay").waitFor();
    const first=await dropPoint(heading,.5,context);
    await p.mouse.move(first.x,first.y,{steps:15});await p.waitForTimeout(550);
    const dest=await dropPoint(heading,.52,context);await p.mouse.move(dest.x,dest.y,{steps:4});
    await p.waitForFunction(()=>document.querySelector('[data-testid="sidebar-drag-overlay"]')?.getAttribute('data-drop-intent')==="conversation-placement");
    await p.mouse.up();await p.getByTestId("sidebar-drag-overlay").waitFor({state:"hidden"});
   }
   async function assigned(id){
    for(let i=0;i<40;i++){const r=await api.get(origin+"/api/conversations/"+convo);assert.ok(r.ok());if((await r.json()).project_id===id)return;await p.waitForTimeout(180)}
    throw new Error("Placement not persisted");
   }
   await drag(aside.getByTestId("project-conversation-container-"+project).locator(":scope > .reader-interactive-row").first(),"project");await assigned(project);
   await p.reload();if(mobile)await p.getByTestId("mobile-sidebar-button").filter({visible:true}).first().click();
   if(await row.count()===0)await aside.getByRole("button",{name:"Expand "+name,exact:true}).click();
   await row.waitFor();await p.waitForFunction(id=>!!document.querySelector(`[data-testid="conversation-row-${id[0]}"][data-project-id="${id[1]}"]`),[convo,project]);
   await toggle.click();assert.equal(await toggle.getAttribute("aria-expanded"),"false");
   assert.equal(await group.getByTestId("unclassified-new-conversation-button").count(),0);
   await drag(group.getByRole("heading").first(),"unclassified");await assigned(null);
   if(await toggle.getAttribute("aria-expanded")==="false")await toggle.click();
   await row.waitFor();await toggle.click();await p.reload();if(mobile)await p.getByTestId("mobile-sidebar-button").filter({visible:true}).first().click();
   await toggle.waitFor();assert.equal(await toggle.getAttribute("aria-expanded"),"false");
   await toggle.click();await row.waitFor();
   const preferences=async()=>{const res=await api.get(origin+"/api/preferences");assert.ok(res.ok());return res.json();};
   const old=await preferences(), other=old.navigation_sort.blocks==="projects_first"?"unclassified_first":"projects_first";
   const edit=async()=>{await aside.getByRole("button",{name:/^(Settings|设置)$/}).click();const section=aside.locator("details").filter({has:p.locator("summary").filter({hasText:/Sorting & navigation|排序与导航/})});await section.locator("summary").click();return section;};
   const section=await edit(), order=section.getByRole("group",{name:/Sidebar order|侧栏顺序/}).getByRole("button");
   const confirm=async(fn)=>{for(let i=0;i<60;i++){if(fn(await preferences()))return;await new Promise(r=>setTimeout(r,200));}throw Error("Fixture preferences did not persist");};
   await order.nth(other==="projects_first"?0:1).click();await confirm(v=>v.navigation_sort.blocks===other);
   const target=section.getByRole("button",{name:/^项目内对话|^In projects/});await target.click();
   const next=old.navigation_sort.project_default.mode==="created"?"title":"created";
   await p.getByRole("menuitemradio",{name:next==="created"?/^(Created|创建时间)$/:/^(Title|标题)$/}).click();
   await confirm(v=>v.navigation_sort.project_default.mode===next);
   await p.reload();if(mobile)await p.getByTestId("mobile-sidebar-button").filter({visible:true}).first().click();
   const restored=await edit();assert.equal(await restored.getByRole("group",{name:/Sidebar order|侧栏顺序/}).getByRole("button").nth(other==="projects_first"?0:1).getAttribute("aria-pressed"),"true");
   const newScope=restored.getByRole("button",{name:/^项目内对话|^In projects/});await newScope.click();const field=p.getByRole("menuitemradio",{name:next==="created"?/^(Created|创建时间)$/:/^(Title|标题)$/});assert.equal(await field.getAttribute("aria-checked"),"true");await p.keyboard.press("Escape");assert.ok(await newScope.evaluate(e=>e===document.activeElement));
   await ctx.close();console.log(`${width}: persisted drag, collapsed target, reload, settings order and scoped sort passed`);
  }
 }finally{await browser.close()}
}
main().catch(e=>{console.error(String(e.message).replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/ig,"<synthetic>"));process.exitCode=1});
