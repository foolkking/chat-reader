// Real owner API, browser, worker and ZIP; only the disposable scope lab can be used.
const fs=require("node:fs"), path=require("node:path"), crypto=require("node:crypto"), {execFileSync}=require("node:child_process");
const {chromium}=require(path.resolve("apps/web/node_modules/@playwright/test"));
const {unzipSync,strFromU8}=require(path.resolve("apps/web/node_modules/fflate"));
const base="http://127.0.0.1:18483",tmp=fs.realpathSync(process.env.TEMP);
if(tmp!==fs.realpathSync(process.env.TMP)||!/^(?:E:\\chat-reader-temp|C:\\Users\\86182\\Desktop\\wkkk)\\[^\\]+/i.test(tmp))throw Error("Use an approved task temp");
const edge=process.argv[2]==="edge",width=edge?375:1440,out=fs.mkdtempSync(path.join(tmp,edge?"scope-edge-":"scope-chromium-"));
const tag=crypto.randomBytes(8).toString("hex"),pass=crypto.randomBytes(32).toString("base64url");
const report={started:new Date().toISOString(),width};let browser,observedPage,stage="seed",step="seed";
const diagnostics={pageErrors:[],httpErrors:{},failedTypes:{}};
const must=(b,why)=>{if(!b)throw Error(why);};
const seed=`
import os,re,json,hashlib
from app.core.database import SessionLocal
from app.services.auth import register_user
from app.models import _register_all_models
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
assert os.environ["APP_ENV"]=="test" and os.environ["PUBLIC_WEB_BASE_URL"]=="${base}" and os.environ["IMPORT_STORAGE_DIR"]=="/data/imports"
assert re.fullmatch("[0-9a-f]{16}",os.environ["FX_TAG"])
_register_all_models()
with SessionLocal() as db:
 assert db.get_bind().url.database=="extension_beta"
 u,_=register_user(db,"export-"+os.environ["FX_TAG"]+"@example.test",os.environ["FX_PASS"])
 p=Project(owner_user_id=u.id,name="合成阅读项目");db.add(p);db.flush()
 for i in range(103):
  title="Study %03d"%i
  c=Conversation(owner_user_id=u.id,title=title,display_title=title,source_type="manual",source_profile="fixture",parser_version="fixture",message_count=1,turn_count=1)
  db.add(c);db.flush();db.add(ProjectConversation(project_id=p.id,conversation_id=c.id,sort_order=i))
  m=Message(conversation_id=c.id,role="user",order_key="000001");db.add(m);db.flush()
  v=MessageVersion(message_id=m.id,version_number=1,plain_text=title,display_text=title,edit_type="manual",content_hash=hashlib.sha256(title.encode()).hexdigest())
  db.add(v);db.flush();m.current_version_id=v.id
 db.commit();print(json.dumps(str(p.id)))
`;
async function main(){
 const p=JSON.parse(execFileSync("docker",["exec","-i","-e","FX_TAG","-e","FX_PASS","reader-scope-1123-api-1","python","-"],{input:seed,encoding:"utf8",stdio:["pipe","pipe","pipe"],env:{...process.env,FX_TAG:tag,FX_PASS:pass}}));
 browser=await chromium.launch({headless:true,executablePath:edge?"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe":"C:/Users/86182/Desktop/wkkk/playwright-browsers/chromium-1234/chrome-win64/chrome.exe",args:["--disable-background-networking","--no-proxy-server","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"]});report.version=browser.version();
 const ctx=await browser.newContext({baseURL:base,viewport:{width,height:900},hasTouch:edge,locale:"zh-CN",serviceWorkers:"block"});
 await ctx.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const api=ctx.request,headers={Origin:base},page=await ctx.newPage();observedPage=page;page.setDefaultTimeout(45000);
 const faults=diagnostics.pageErrors;page.on("pageerror",e=>faults.push(e.name));
 page.on("response",r=>{if(r.status()>=400){const key=r.request().resourceType()+" "+r.status();diagnostics.httpErrors[key]=(diagnostics.httpErrors[key]||0)+1;}});
 page.on("requestfailed",r=>{const key=r.resourceType();diagnostics.failedTypes[key]=(diagnostics.failedTypes[key]||0)+1;});
 const call=async(method,url,data)=>{const r=await api.fetch(url,{method,headers,...(data?{data}:{})});must(r.ok(),"Owner API rejected "+r.status());return r;};
 stage="auth";await call("POST","/api/auth/login",{email:`export-${tag}@example.test`,password:pass});await call("PATCH","/api/preferences",{locale_mode:"zh-CN",theme_mode:"light"});
 const pj="/projects/"+p, ep="/api/conversations/batch-export", bar=page.getByTestId("selection-toolbar");
 const btn=(label)=>page.getByRole("button",{name:label,exact:true});
 const click=async label=>{step="button "+label;await btn(label).click();}, row=id=>page.getByTestId("project-conversation-sortable-row-"+id);
 const members=async(dir)=>(await(await call("GET",`/api/projects/${p}/conversations?sort=title&direction=${dir}&limit=500`)).json()).map(r=>r.id);
 const wait=async fn=>{const end=Date.now()+65000;do{const x=await fn();if(x)return x;await new Promise(r=>setTimeout(r,200));}while(Date.now()<end);throw Error("Observation timed out");};
 const shown=()=>page.locator('[data-testid^="project-conversation-sortable-row-"]').evaluateAll(n=>n.map(x=>x.getAttribute("data-testid").replace("project-conversation-sortable-row-","")));
 const sort=async label=>{step="project sort trigger";await btn("完成批量操作").locator("..").getByRole("button",{name:"对话排序",exact:true}).click();step="sort item "+label;await page.getByRole("menuitem",{name:label,exact:true}).click();};
 const zip=async job=>{const t=await wait(async()=>{const v=await(await call("GET","/api/tasks/"+job)).json();must(!["failed","cancelled"].includes(v.status),"Export job failed");return v.status==="committed"&&v;});
   const d=await call("GET",t.result.download_url),z=unzipSync(await d.body());
   const ids=Object.values(z).map(v=>JSON.parse(strFromU8(v).split("\n")[0]).conversation.id);must(ids.length===t.total_items,"Size differs from job");return ids;};
 const queued=async(button,expected)=>{const req=page.waitForResponse(r=>new URL(r.url()).pathname===ep&&r.request().method()==="POST");
   await button.click();const a=await req;must(a.status()===202,"Not admitted: "+a.status());const sent=a.request().postDataJSON().conversation_ids;
   must(JSON.stringify(sent)===JSON.stringify(expected),"Submission differs from checked list");const bytes=await zip((await a.json()).job_id);
   must(JSON.stringify(bytes)===JSON.stringify(sent),"ZIP differs from submitted list");};
 const open=async()=>{step="navigate";await page.goto(pj,{waitUntil:"domcontentloaded"});await click("批量操作");step="wait for loaded window";await wait(async()=>(await shown()).length===100);};
 const check=async id=>{step="check fixture row";await row(id).getByRole("checkbox").check();};
 stage="sort and paginate";await open();await sort("标题");const asc=await members("asc"),desc=await members("desc");must(asc.length===103,"Missing fixture");
 await wait(async()=>JSON.stringify(await shown())===JSON.stringify(asc.slice(0,100)));
 const off=asc[0],on=asc[50];await check(off);await check(on);await sort("降序");await wait(async()=>JSON.stringify(await shown())===JSON.stringify(desc.slice(0,100)));
 must((await bar.innerText()).includes("已选择 2 条 · 当前列表 1 条"),"Unloaded selection missing");
 const primary=bar.getByRole("button",{name:"导出所选 2 条",exact:true});const box=await primary.boundingBox();
 must(box&&box.x>=0&&box.x+box.width<=width&&await bar.evaluate(n=>n.scrollLeft===0),"Export primary is off screen");
 const countBox=await bar.locator('[aria-live="polite"]').boundingBox();
 must(countBox&&countBox.width>=90&&countBox.height<=74,"Selection count collapsed to a vertical strip");
 must(box.height>=44,"Primary target is too short");
 await primary.focus();must(await primary.evaluate(b=>document.activeElement===b),"Primary not keyboard focusable");
 await bar.screenshot({path:path.join(out,"selection.png")});
 const third=asc[60];await check(third);await row(third).getByRole("checkbox").uncheck();await queued(primary,[off,on]);
 report.selection={checked:2,visible:1,sent:2,zip:2,orderVerified:true,actionVisibleWithoutHorizontalScroll:true,
   labelWidth:Math.round(countBox.width),labelHeight:Math.round(countBox.height),targetHeight:Math.round(box.height)};
 stage="moved member";await open();await check(on);await check(third);
 await call("DELETE",`/api/projects/${p}/conversations/${on}`);const noJob=page.waitForResponse(r=>new URL(r.url()).pathname===ep&&r.status()===409);
 await btn("导出所选 2 条").click();await noJob;await btn("仍导出原选 2 条").waitFor();
 await queued(btn("仅导出仍在项目中的 1 条"),[third]);report.moved={explicitChoice:true,submittedAfterChoice:1,zip:1};
 stage="whole project membership";await page.goto(pj,{waitUntil:"domcontentloaded"});
 if(edge)await btn("打开侧栏").click();
 const menu=btn("管理项目 合成阅读项目");await menu.focus();await menu.press("ArrowDown");
 await page.getByRole("menuitem",{name:"导出项目对话…",exact:true}).press("Enter");
 const confirm=btn("导出《合成阅读项目》的 102 条活动对话");await confirm.waitFor();
 const normalized=await(await call("GET",`/api/projects/${p}/export-preview?sort=title&direction=desc`)).json();
 await call("DELETE",`/api/projects/${p}/conversations/${third}`);await call("POST",`/api/projects/${p}/conversations/${on}`);
 const change=page.waitForResponse(r=>new URL(r.url()).pathname===ep&&r.status()===409);await confirm.click();const answer=await change, review=(await answer.json()).detail.review;
 must(review.count===102&&review.active_ids.includes(on)&&!review.active_ids.includes(third)&&!normalized.active_ids.includes(on),"Same-count change was not detected");
 const drift=page.getByRole("alert").filter({hasText:"项目范围已变化"});
 must((await drift.innerText()).includes("Study 050")&&(await drift.innerText()).includes("Study 060"),"Changed conversation names were not shown");
 await page.getByRole("alert").filter({hasText:"项目范围已变化"}).screenshot({path:path.join(out,"whole-changed.png")});
 await queued(btn("导出当前项目的 102 条"),review.active_ids);report.whole={sameCountChangedMembership:true,zip:102,orderVerified:true};
 stage="reload after lost receipt";await open();await check(on);let lost,posts=0;
 page.on("request",r=>{if(new URL(r.url()).pathname===ep&&r.method()==="POST")posts++;});
 await page.route("**"+ep,async r=>{const a=await r.fetch();must(a.status()===202,"Real request not accepted");lost=(await a.json()).job_id;await r.abort("failed");},{times:1});
 await btn("导出所选 1 条").click();await wait(()=>lost);await btn("核对上次导出").waitFor();await page.reload();await btn("核对上次导出").click();
 await page.getByTestId("task-center-panel").waitFor();must((await zip(lost))[0]===on&&posts===1,"Unexpected second job after reload");
 report.recovery={realAccepted:true,afterReloadLookup:true,totalPosts:posts};
 stage="same titles across projects";
 const second=(await(await call("POST","/api/projects",{name:"合成资料乙"})).json()).id;
 const empty=(await(await call("POST","/api/projects",{name:"合成空项目"})).json()).id;
 const paired=[];
 for(const project_id of [p,second]){
   const v=await(await call("POST","/api/conversations",{title:"同名研究记录",project_id,messages:[
     {role:"user",content_markdown:"Synthetic shared first line"},{role:"assistant",content_markdown:"Synthetic response "+(paired.length+1)}]})).json();
   paired.push(v.conversation.id);
 }
 await page.goto("/",{waitUntil:"domcontentloaded"});await click("批量操作");
 const rows=page.locator('[data-testid^="conversation-sortable-row-"]');
 await wait(async()=>await rows.count()>0);
 // The fixture contains at most 105 active rows. A current window is not the whole catalog.
 for(let n=0;n<4&&!await Promise.all(paired.map(id=>page.getByTestId("conversation-sortable-row-"+id).count())).then(v=>v.every(Boolean));n++){
   const before=await rows.count();await click("加载更多对话");await wait(async()=>(await rows.count())>before);
 }
 for(const [i,id] of paired.entries()){
   const item=page.getByTestId("conversation-sortable-row-"+id), name=i?"合成资料乙":"合成阅读项目";
   must((await item.innerText()).includes(name),"Project not visible on same-title row");await item.getByRole("checkbox",{name:"选择 同名研究记录 · "+name,exact:true}).check();
 }
 await queued(bar.getByRole("button",{name:"导出所选 2 条",exact:true}),paired);
 report.crossProject={sameTitle:true,visiblyDistinguished:true,accessibleNamesDistinct:true,selected:2,zip:2,orderVerified:true};
 stage="selection deleted in another session";await open();await check(asc[54]);await check(on);
 await call("DELETE","/api/conversations/"+asc[54]);
 const deletion=page.waitForResponse(r=>new URL(r.url()).pathname===ep&&r.status()===409);
 await click("导出所选 2 条");const decision=(await (await deletion).json()).detail.review;
 must(decision.can_export_original===false&&decision.changes.removed.titles.length===0,"Unavailable title was disclosed");
 await page.getByText("原选中有对话已不可访问，无法导出原清单。",{exact:true}).waitFor();
 must(!await btn("仍导出原选 2 条").count(),"The unavailable original selection can still be submitted");
 await queued(btn("仅导出仍在项目中的 1 条"),[on]);
 report.deleted={selected:2,explicitSubset:1,zip:1,unavailableTitleDisclosed:false,originalOffered:false};
 stage="empty project";await page.goto("/projects/"+empty+"/export",{waitUntil:"domcontentloaded"});
 await page.getByText("项目里没有可导出的活动对话。",{exact:true}).waitFor();
 must(await page.getByRole("button",{name:/导出《/}).count()===0,"An empty export could be queued");
 report.empty={cannotQueue:true};must(!faults.length,"Browser page error");report.pageErrors=0;report.status="passed";
}
main().catch(async e=>{report.status="failed";report.stage=stage;report.step=step;report.error=e.name;report.diagnostics=diagnostics;
 if(observedPage)report.ui=await observedPage.evaluate(()=>({route:location.pathname.split("/")[1],lang:document.documentElement.lang,
   rows:document.querySelectorAll('[data-testid^="project-conversation-sortable-row-"]').length,
   bulk:[...document.querySelectorAll('button')].filter(b=>b.getAttribute("aria-label")==="批量操作"&&b.getClientRects().length).length,
   bodySize:document.body.innerText.length,appError:/Application error|客户端异常|Runtime Error|client-side exception/.test(document.body.innerText),
   sortButtons:[...document.querySelectorAll("header button")].map(b=>b.getAttribute("aria-label")).filter(Boolean).filter(s=>s.includes("排序")).slice(0,4)})).catch(()=>null);
 if(observedPage&&report.ui?.route==="projects")await observedPage.screenshot({path:path.join(out,"diagnostic.png"),timeout:5000}).catch(()=>{});
 console.log("Stopped:",stage,step,String(e.message).split("\n")[0].replace(/[0-9a-f-]{32,}/ig,"[fixture]").slice(0,130),JSON.stringify(report.ui));process.exitCode=1;}).finally(async()=>{await browser?.close();report.finished=new Date().toISOString();fs.writeFileSync(path.join(out,"result.json"),JSON.stringify(report,null,2)+"\n");console.log(path.basename(out),report.status);});
