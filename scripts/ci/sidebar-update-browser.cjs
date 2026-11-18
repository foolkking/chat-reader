// Synthetic product screenshots only. No remote app, credentials, or customer data.
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = createRequire(path.resolve(__dirname, "../../apps/web/package.json"))("@playwright/test");
const origin = new URL(process.env.SIDEBAR_TEST_ORIGIN);
assert.equal(origin.hostname, "127.0.0.1");
const before = process.argv.includes("--before"), out = process.env.SIDEBAR_EVIDENCE;
const settings = process.argv.includes("--settings");
assert.ok(out && path.isAbsolute(out));
const stamp = "2026-01-01T00:00:00Z";
async function main() {
 const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {channel:"chromium"});
 try {
  fs.mkdirSync(out,{recursive:true});
  for (const locale of ["zh-CN","en-US"]) for(const size of [224,288,448,320,375]){
   const mobile=size===320||size===375;
   const ctx=await browser.newContext({viewport:{width:mobile?size:1440,height:840},hasTouch:mobile,isMobile:mobile,serviceWorkers:"block",locale});
   const p=await ctx.newPage();p.setDefaultTimeout(12000);
   await ctx.addCookies([{name:"chat_reader_session",value:"synthetic-ui-only",url:origin.origin}]);
   await p.addInitScript(size=>localStorage.setItem("chat-reader:sidebar-width",JSON.stringify(size)),size);
   let search="", updateReads=0, recentReads=0;
   await p.route("**/api/**",async r=>{
    const u=new URL(r.request().url()), k=u.pathname,zh=locale==="zh-CN", titles=zh?["阅读摘录","资料归档","书目索引"]:["Reading notes","Research archive","Book index"];
    let data=[];
    if(k==="/api/auth/session") data={authenticated:true,principal_id:"fixture",user_id:"00000000-0000-4000-8000-000000000001",role:"USER",auth_mode:"multi_account",inactivity_expires_at:"2099-01-01T00:00:00Z"};
    if(k==="/api/auth/capabilities") data={role:"USER",allow_user_import:true};
    if(k==="/api/preferences") data={theme_mode:"light",locale_mode:locale,reader_width_mode:"standard",reader_density_mode:"comfortable",reader_font_size_px:17,conversation_sort_mode:"recent_read",conversation_sort_direction:"desc",project_sort_mode:"created",project_sort_direction:"asc",navigation_sort:{all:{mode:"content_updated",direction:"desc"},project_default:{mode:"imported",direction:"desc"},unclassified:{mode:"imported",direction:"desc"},blocks:"projects_first",recommendation_backup:null},created_at:stamp,updated_at:stamp};
    if(k.startsWith("/api/admin/updates")) updateReads++;
    if(k==="/api/recent-items") recentReads++;
    if(k==="/api/projects") data=titles.map((name,i)=>({id:`00000000-0000-4000-8000-00000000000${i+2}`,name,sort_order:i,conversation_count:0,pinned_count:0,created_at:stamp,updated_at:stamp,is_archived:false,is_default:false}));
    if(k.includes("sessions")||k.includes("search")) data={items:[],total:0,has_more:false};
    if(k.includes("search")) search=u.search;
    await r.fulfill({json:data});
   });
   await p.goto(origin.origin+"/");
   if(mobile) await p.getByTestId("mobile-sidebar-button").filter({visible:true}).first().click();
   const aside=p.locator("aside[data-reader-primary-sidebar]").filter({visible:true}).last(),projects=aside.getByRole("button",{name:/^(项目|Projects)(\s|$)/i}),unc=aside.getByRole("button",{name:/^(未归类|Unclassified)(\s|$)/i});
   await aside.getByText(locale==="zh-CN"?"阅读摘录":"Reading notes",{exact:true}).first().waitFor();
   const file=`${before?"before":"after"}-${locale}-${size}`;
   if(settings){
    const zh=locale==="zh-CN";
    await aside.getByRole("button",{name:/^(设置|Settings)$/}).click();
    const details=aside.locator("details").filter({has: p.locator("summary").filter({hasText:/Sorting & navigation|排序与导航/})});
    const summary=details.locator("summary");await summary.click();
    const group=details.getByRole("group",{name:/侧栏顺序|Sidebar order/});
    await group.getByRole("button").first().waitFor();
    // Align the same disclosure with the scroll viewport for comparable crops.
    const rect=await summary.evaluate(e=>{const s=e.closest('[role="region"]');s.scrollTop+=e.getBoundingClientRect().top-s.getBoundingClientRect().top-8;const a=e.closest('aside').getBoundingClientRect(),r=s.getBoundingClientRect();return {x:a.x,y:r.y,width:a.width,height:a.bottom-r.y};});
    await p.screenshot({path:path.join(out,file+"-settings.png"),clip:rect});
    if(!before){
      assert.equal(await aside.locator('a[href="/recent"]').count(),0);
      assert.equal(await p.getByRole("link",{name:/查看全部最近阅读|View all recent reading/}).count(),mobile?1:0);
      assert.equal(recentReads>0,mobile);assert.equal(await aside.getByRole("button",{name:/运行状态|Runtime status|版本更新|Version updates/}).count(),0);
      assert.equal(updateReads,0);
      const box=await group.getByRole("button").evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return [r.y,r.height]}));
      assert.equal(box[0][0],box[1][0]);if(mobile)assert.ok(box.every(b=>b[1]>=44));
      assert.equal(await details.locator('[aria-haspopup="menu"]').count(),4);
      assert.ok(await details.evaluate(d=>d.scrollWidth<=d.clientWidth+1));
      const trigger=details.getByRole("button",{name:zh?/^项目内对话/:/^In projects/}); await trigger.click();
      const menu=p.getByTestId("sort-menu-panel").filter({visible:true});await menu.waitFor();
      const m=await menu.boundingBox(),s=await aside.locator("[data-sidebar-settings-scroll]").boundingBox();
      assert.ok(m.width<=192 && m.x>=s.x && m.x+m.width<=s.x+s.width+1 && m.y>=s.y-1 && m.y+m.height<=s.y+s.height+1);
      assert.equal(await menu.locator('[aria-checked="true"]').count(),2);await p.keyboard.press("End");await p.keyboard.press("Escape");
      assert.ok(await trigger.evaluate(e=>document.activeElement===e));
      const footer=aside.getByRole("button",{name:/Collapse settings|收回设置/});
      const last=details.getByRole("button",{name:/Apply recommended rules|应用推荐规则/});await last.scrollIntoViewIfNeeded();
      const lastBox=await last.boundingBox(), footBox=await footer.boundingBox();assert.ok(lastBox.y+lastBox.height<=footBox.y+1);
      await footer.click();await aside.getByTestId("sidebar-action-palette-button").click();await p.getByTestId("action-palette-input").fill(zh?"最近":"recent");
      await p.getByTestId("action-palette-recent").click();await p.waitForURL("**/recent");await p.getByTestId("mobile-page-header").getByRole("heading",{name:zh?"最近":"Recent",exact:true}).waitFor();
      await p.goBack();await p.waitForURL(origin.origin+"/");if(mobile){await p.getByRole("link",{name:/查看全部最近阅读|View all recent reading/}).click();await p.waitForURL("**/recent");}
    }
    await ctx.close();console.log(`${file}: settings & navigation passed`);continue;
   }
   const trigger=aside.getByRole("button",{name:/项目排序|Sort projects/}); await trigger.click();
   const menu=p.getByTestId("sort-menu-panel").filter({visible:true});await menu.waitFor();
   const b=await aside.boundingBox(),m=await menu.boundingBox();
   if(!before){assert.ok(m.width<=195&&m.x>=b.x&&m.x+m.width<=b.x+b.width+1);assert.ok(m.y>=0&&m.y+m.height<=841);assert.equal(await menu.locator('[aria-checked="true"]').count(),2);if(mobile)assert.ok((await trigger.boundingBox()).height>=44);}
   if(!mobile)assert.ok(Math.abs(b.width-size)<2,`unexpected sidebar width ${b.width} (${size})`);
   await p.screenshot({path:path.join(out,file+"-sort.png"),clip:{x:0,y:0,width:Math.ceil(Math.max(b.width,m.x+m.width)),height:760}});
   await p.keyboard.press("Escape");assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
   await projects.click();await unc.click();
   if(!before){assert.equal(await trigger.count(),0);assert.equal(await aside.getByTestId("unclassified-new-conversation-button").count(),0);assert.equal(await aside.getByRole("combobox").count(),0);const a=await projects.boundingBox(),z=await unc.boundingBox();assert.ok(Math.abs(a.x-z.x)<=1&&Math.abs(z.y-a.y)<=50);}
   await aside.screenshot({path:path.join(out,file+"-collapsed.png")});
   if(!before){await projects.click();await aside.getByTestId("sidebar-global-search").fill("synthetic");await p.waitForFunction(()=>document.querySelector('[data-testid="sidebar-global-search"]')?.value==="synthetic");await p.waitForTimeout(400);await aside.getByTestId("sidebar-global-search").press("Enter");await p.waitForURL(/\/search\?q=synthetic$/);assert.ok(!search.includes("project_id"));}
   await ctx.close();console.log(`${file}: passed`);
  }
 } finally {await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
