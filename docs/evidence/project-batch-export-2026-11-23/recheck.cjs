// Local synthetic evidence only. No external page, existing account or real source data.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = process.cwd(), base = "http://127.0.0.1:18383";
const { chromium } = require(path.join(root, "apps/web/node_modules/@playwright/test"));
const { unzipSync, strFromU8 } = require(path.join(root, "apps/web/node_modules/fflate"));
const tmp = path.resolve(process.env.TEMP), valid = /^(?:E:\\chat-reader-temp|C:\\Users\\86182\\Desktop\\wkkk)\\[^\\]+/i;
if (!valid.test(tmp) || process.env.TMP !== process.env.TEMP) throw Error("Use a task-owned approved temp directory");
const run = crypto.randomBytes(6).toString("hex"), pw = crypto.randomBytes(24).toString("base64url");
const out = path.join(tmp, `recheck-${run}`), width = Number(process.env.AUDIT_WIDTH || 1440);
fs.mkdirSync(out);
const report = {start:new Date().toISOString(), width, height:900, environment:"loopback synthetic ordinary account", steps:[]};
const must = (test, msg) => { if (!test) throw Error(msg); };
const safe = async (fn, ms=35000) => {
  const until=Date.now()+ms;
  do { const x=await fn(); if(x)return x; await new Promise(r=>setTimeout(r,180)); } while(Date.now()<until);
  throw Error("Timed out at "+stage);
};
let stage="fixture", browser;
const seed = `
import json, os, re, hashlib
assert os.environ["APP_ENV"]=="test" and os.environ["PUBLIC_WEB_BASE_URL"]=="http://127.0.0.1:18383"
from app.core.database import SessionLocal
from app.models import _register_all_models
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.source_message_ref import SourceMessageRef
from app.models.attachment import Attachment, MessageVersionAttachment
from app.services.auth import register_user
_register_all_models()
tag=os.environ["AUDIT_SUFFIX"]
assert re.fullmatch(r"[0-9a-f]{12}",tag)
with SessionLocal() as db:
 assert db.get_bind().url.database=="extension_beta"
 u,_=register_user(db,"batch-recheck-"+tag+"@example.test",os.environ["AUDIT_SECRET"])
 p=Project(owner_user_id=u.id,name="Export review fixture");db.add(p);db.flush()
 for i in range(103):
  title="Study %03d"%i
  c=Conversation(owner_user_id=u.id,title=title,display_title=title,source_type="manual",source_profile="audit",parser_version="audit",message_count=1,turn_count=1)
  db.add(c);db.flush();db.add(ProjectConversation(project_id=p.id,conversation_id=c.id,sort_order=i,is_pinned=i==51))
  m=Message(conversation_id=c.id,role="user",order_key="000001");db.add(m);db.flush()
  v=MessageVersion(message_id=m.id,version_number=1,plain_text="Synthetic test",display_text="Synthetic test",edit_type="manual",content_hash=hashlib.sha256(b"Synthetic test").hexdigest())
  db.add(v);db.flush();m.current_version_id=v.id
  if i==51:
   witness=c.id
   db.add(SourceMessageRef(message_id=m.id,source_type="synthetic",source_profile="audit",
       source_conversation_id="fixture-source-thread",source_message_id="fixture-source-row",
       raw_metadata={"conversation":{"user":"SYNTHETIC-LABEL","link":"https://source.invalid/fixture"},"unrelated_canary":"MUST-NOT-BE-IN-SOURCE-REF"}))
   a=Attachment(conversation_id=c.id,original_filename="synthetic-original.txt",display_name="synthetic-renamed.txt",resolution_status="missing")
   db.add(a);db.flush();db.add(MessageVersionAttachment(message_version_id=v.id,attachment_id=a.id,occurrence_key="audit",relation_type="file"))
 db.commit();print(json.dumps({"project":str(p.id),"witness":str(witness)}))
`;
async function main() {
  const {project,witness} = JSON.parse(execFileSync("docker",["exec","-i","-e","AUDIT_SUFFIX","-e","AUDIT_SECRET","reader-ext-beta-1123-api-1","python","-"],{
    input:seed,encoding:"utf8",env:{...process.env,AUDIT_SUFFIX:run,AUDIT_SECRET:pw},stdio:["pipe","pipe","pipe"]
  }));
  browser=await chromium.launch({executablePath:"C:/Users/86182/Desktop/wkkk/playwright-browsers/chromium-1234/chrome-win64/chrome.exe",headless:true,downloadsPath:out,
     args:["--disable-background-networking","--no-proxy-server","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"]});
  const ctx=await browser.newContext({baseURL:base,locale:"zh-CN",hasTouch:width<=400,viewport:{width,height:900},serviceWorkers:"block"});
  await ctx.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const api=ctx.request,H={Origin:base}, pj=`/projects/${project}`, route="/api/conversations/batch-export";
  must((await api.post("/api/auth/login",{headers:H,data:{email:`batch-recheck-${run}@example.test`,password:pw}})).status()===200,"Lab login failed");
  must((await api.patch("/api/preferences",{headers:H,data:{locale_mode:"zh-CN",theme_mode:"light"}})).ok(),"Preferences failed");
  const page=await ctx.newPage();page.setDefaultTimeout(12000);
  const rows=page.locator('[data-testid^="project-conversation-sortable-row-"]'), bar=page.getByTestId("selection-toolbar");
  const visible=()=>rows.evaluateAll(els=>els.map(el=>el.dataset.testid.slice("project-conversation-sortable-row-".length)));
  const row=(id)=>page.getByTestId("project-conversation-sortable-row-"+id);
  const click=(label)=>page.getByRole("button",{name:label,exact:true}).click();
  const sort=async label=>{await page.locator("header").getByRole("button",{name:"对话排序",exact:true}).click();await page.getByRole("menuitem",{name:label,exact:true}).click();};
  const order=async (direction="asc",limit=500)=>{const resp=await api.get(`/api/projects/${project}/conversations?sort=title&direction=${direction}&limit=${limit}`);
     must(resp.ok(),"Membership read failed");return (await resp.json()).map(x=>x.id);};
  const emit=async ()=>{
     const response=page.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()==="POST");
     await bar.getByRole("button",{name:"导出",exact:true}).click();
     const r=await response;must(r.status()===202,"Unexpected admission");return {id:(await r.json()).job_id, ids:r.request().postDataJSON().conversation_ids};
  };
  const bytes=async task=>{
    const j=await safe(async()=>{const r=await api.get("/api/tasks/"+task);must(r.ok(),"Cannot read owned job");const v=await r.json();
      must(!["failed","cancelled"].includes(v.status),"Worker did not publish");return v.status==="committed"&&v;},65000);
    must(/^\/api\/exports\/[0-9a-f-]+\/download$/.test(j.result.download_url),"Unexpected result route");
    const r=await api.get(j.result.download_url);must(r.ok(),"Download failed");const raw=await r.body(), members=unzipSync(raw);
    const records=Object.values(members).flatMap(f=>strFromU8(f).trim().split("\n").map(s=>JSON.parse(s)));
    const ids=records.filter(x=>x.record_type==="manifest").map(x=>x.conversation.id);
    must(ids.length===j.total_items&&ids.length===Object.keys(members).length,"Manifest/task disagreement");
    return {ids,records,sha256:crypto.createHash("sha256").update(raw).digest("hex")};
  };
  const open=async ()=>{await page.goto(pj);await click("批量操作");await safe(async()=>await rows.count()===100);};
  const observe=async()=>({shown:(await bar.innerText()).match(/已选择[^\n]*/)?.[0],checked:await rows.locator("input:checked").count()});
  stage="sort only";await open();await sort("标题");
  const asc=await order(),desc=await order("desc");must(asc.length===103&&desc.length===103,"Need 103 members");
  await safe(async()=>JSON.stringify(await visible())===JSON.stringify(asc.slice(0,100)));
  const offPage=asc.slice(0,100).find(id=>!desc.slice(0,100).includes(id));
  must(offPage&&desc[0]===witness,"Fixture sort precondition failed");
  await row(witness).getByRole("checkbox").check();await row(offPage).getByRole("checkbox").check();
  const before=await observe();must(before.checked===2,"Initial selection failed");
  await sort("降序");await safe(async()=>JSON.stringify(await visible())===JSON.stringify(desc.slice(0,100)));
  const after=await observe(), all=await order("desc");must(all.includes(witness)&&all.includes(offPage),"Server membership changed");
  await bar.screenshot({path:path.join(out,"only-sort.png")});
  const one=await emit(), b1=await bytes(one.id);
  must(JSON.stringify(one.ids)===JSON.stringify(b1.ids),"Download did not follow request");
  report.sortOnly={before,after,originalSelection:2,serverActive:all.length,originalBothStillMembers:true,
     submitted:one.ids.length,membersInDownload:b1.ids.length,bothPresent:b1.ids.includes(witness)&&b1.ids.includes(offPage),sha256:b1.sha256};
  const ref=b1.records.find(x=>x.record_type==="source_ref"),att=b1.records.find(x=>x.record_type==="attachment");
  must(ref&&att,"Missing provenance witness");
  report.metadata={sourceConversationId:ref.source_conversation_id==="fixture-source-thread",sourceMessageId:ref.source_message_id==="fixture-source-row",
    sourceDisplayUser:ref.source_metadata.conversation.user==="SYNTHETIC-LABEL",sourceLink:ref.source_metadata.conversation.link==="https://source.invalid/fixture",
    unrelatedProviderFieldIncluded:JSON.stringify(ref).includes("MUST-NOT-BE-IN-SOURCE-REF"),
    originalFilename:att.original_filename==="synthetic-original.txt",displayFilename:att.display_name==="synthetic-renamed.txt"};
  report.steps.push(stage);
  stage="moved before refetch";await open();
  const active=await visible(),moved=active.find(id=>id!==witness);
  await row(moved).getByRole("checkbox").check();await row(witness).getByRole("checkbox").check();
  must((await api.delete(`/api/projects/${project}/conversations/${moved}`,{headers:H})).ok(),"Membership change failed");
  const current=await order();must(current.length===102&&!current.includes(moved)&&current.includes(witness),"Membership change not observed on server");
  const stale=await observe(),two=await emit(),b2=await bytes(two.id);
  must(JSON.stringify(two.ids)===JSON.stringify(b2.ids),"Download did not follow request");
  report.moveBeforeRefetch={...stale,serverActive:current.length,originalSelection:2,stillMembers:1,submitted:two.ids.length,
    membersInDownload:b2.ids.length,includesMovedButStillOwned:b2.ids.includes(moved),sha256:b2.sha256};report.steps.push(stage);
  stage="lost acknowledgement";const retrySelection=async()=>{await open();await row(witness).getByRole("checkbox").check();};
  const lost=async()=>{
    let captured=null;
    await page.route("**"+route,async r=>{if(r.request().method()!=="POST")return r.fallback();
      const resp=await r.fetch({maxRetries:0});must(resp.status()===202,"Lost-ack precondition failed");
      captured=(await resp.json()).job_id;await r.abort("failed");},{times:1});
    await bar.getByRole("button",{name:"导出",exact:true}).click();await safe(()=>captured);
    const text=await page.getByText("未确认提交结果。所选对话已保留，再次点击导出可安全重试。",{exact:true}).innerText();
    return {id:captured,warning:text};
  };
  await retrySelection();const l1=await lost();const retry1=await emit();
  await retrySelection();const l2=await lost();await retrySelection();const retry2=await emit();
  const identities=[l1.id,retry1.id,l2.id,retry2.id];
  for(const id of new Set(identities))await bytes(id);
  report.lostResponse={serverAccepted:true,sameMountSameJob:l1.id===retry1.id,reloadedSameJob:l2.id===retry2.id,
      distinctCommittedJobsForSameMountRetry:new Set([l1.id,retry1.id]).size,distinctCommittedJobsForReloadRetry:new Set([l2.id,retry2.id]).size,
      warningMentionsReload:/刷新|重新打开/.test(l1.warning)};
  report.steps.push(stage);report.status="observed";console.log("Observed: sort, membership, metadata and retry");
}
main().catch(e=>{report.status="incomplete";report.failedAt=stage;report.errorType=e.name;process.exitCode=1;
  const details=String(e.message||"").split("\n")[0].replace(/[0-9a-f]{8}-[0-9a-f-]{26,}/gi,"[id]")
    .replace(/batch-recheck-[a-z0-9]+@example\.test/gi,"[fixture]");
  // Docker stderr and request bodies are deliberately not logged.
  console.log("Incomplete step:",stage, details.startsWith("Command failed")?"fixture failure":details.slice(0,140));
}).finally(async()=>{await browser?.close();report.finish=new Date().toISOString();fs.writeFileSync(path.join(out,"audit.json"),JSON.stringify(report,null,2)+"\n");
  console.log("Receipt:",path.basename(out));});
