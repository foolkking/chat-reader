// Verify the native packaged client against the real, disposable Reader API, PG and worker.
// Consent setup uses the normal authenticated PKCE APIs (not the Web consent screen).
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {execFileSync}=require("node:child_process"),{chromium,request}=require("../../apps/web/node_modules/@playwright/test");
const lab=require("./lab-target.cjs"),origin=lab.origin,site="https://chatgpt.com";
assert.equal(lab.project,"reader-ext-beta-1123");assert.equal(origin,"http://127.0.0.1:18383");
const [binary,build,parent,label]=process.argv.slice(2),dir=path.resolve(parent,label);
assert.ok(/^(?:chrome-zh|edge-en)-api-[a-z0-9-]+$/.test(label));
assert.ok(["e:\\chat-reader-temp\\","c:\\users\\86182\\desktop\\wkkk\\"].some(p=>dir.toLowerCase().startsWith(p)));
const report={scope:"Native packaged extension with real Reader API, PostgreSQL, worker, attachment bytes and two ordinary test accounts. Synthetic source. No Web consent screen or Reader Web rendering claim.",
  build:JSON.parse(execFileSync("python",["-I","-B",path.join(__dirname,"verify_extension_build.py"),path.resolve(build),origin,
    process.env.READER_TEST_EXTENSION_SHA256||""],{encoding:"utf8"})),steps:[]};
fs.mkdirSync(dir);
const client="gihbiofiiflkckcmomddkkjkoifkddfi",ext="chrome-extension://"+client;
const srcid="synthetic-"+crypto.randomUUID(),source="/c/"+srcid,marker="only-a-synthetic-source-marker";
const attachment=Buffer.from("depth,station\n12,Tide\n"),assetSHA=crypto.createHash("sha256").update(attachment).digest("hex");
const fixturePython=`
import os, re
from sqlalchemy import text
from app.core.database import SessionLocal
from app.services.auth import register_user
from app.models import _register_all_models
assert os.environ["APP_ENV"]=="test" and os.environ["PUBLIC_WEB_BASE_URL"]==os.environ["SYNTHETIC_ORIGIN"]=="http://127.0.0.1:18383"
assert os.environ["IMPORT_STORAGE_DIR"]=="/data/imports" and re.fullmatch(r'api-source-[0-9a-f]{24}@example\\.test',os.environ["LAB_SOURCE_USER"])
_register_all_models()
with SessionLocal() as db:
 assert db.get_bind().url.database == db.scalar(text('select current_database()')) == "extension_beta"
 user,_=register_user(db,os.environ["LAB_SOURCE_USER"],os.environ["LAB_SOURCE_PASS"])
 assert user.role=="USER"
 db.commit()
`;
const verifyPython=`
import os, sys, uuid, hashlib, zipfile
from sqlalchemy import select
from app.core.database import SessionLocal
from app.models import _register_all_models
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.import_record import ImportRecord
from app.models.user import User
from app.services.assets.asset_store import get_asset_store
from app.services.adaptive_import.archive_sources import ARCHIVE_SOURCE_TYPE, _artifact_path, archive_catalog
from app.services.adaptive_import.reader_package import messages, package_header, verify_assets
assert os.environ["APP_ENV"]=="test" and os.environ["PUBLIC_WEB_BASE_URL"]==os.environ["SYNTHETIC_ORIGIN"]=="http://127.0.0.1:18383"
_register_all_models()
with SessionLocal() as db:
 assert db.get_bind().url.database=="extension_beta"
 cv=db.get(Conversation,uuid.UUID(sys.argv[1])); u=db.get(User,cv.owner_user_id)
 assert u.normalized_email==os.environ["LAB_SOURCE_USER"] and u.role=="USER" and cv.message_count==2
 msgs=list(db.scalars(select(Message).where(Message.conversation_id==cv.id).order_by(Message.order_key)))
 assert [m.role for m in msgs]==["user","assistant"]
 versions=[db.get(MessageVersion,m.current_version_id) for m in msgs]
 saved,=db.scalars(select(Attachment).where(Attachment.conversation_id==cv.id))
 record=db.scalars(select(ImportRecord).where(ImportRecord.conversation_id==cv.id)).one()
 original,=[f for f in record.artifacts if f.source_type==ARCHIVE_SOURCE_TYPE]
 derived,=[f for f in record.artifacts if f.source_type!=ARCHIVE_SOURCE_TYPE]
 with zipfile.ZipFile(_artifact_path(record,original)) as z:
  meta=package_header(z); verify_assets(z,meta); assert meta["source_id"]==sys.argv[3] and len(meta["assets"])==1
  assert all(b"only-a-synthetic-source-marker" not in z.read(n) for n in z.namelist())
  rows=list(messages(z,meta)); assert [(r["id"],r["role"]) for r,_,_ in rows]==[("fx-0","user"),("fx-1","assistant")]
  file=meta["assets"][0]["path"]; assert hashlib.sha256(z.read(file)).hexdigest()==sys.argv[2]
  member,=[m for m in archive_catalog(record,original.id)["members"] if m["path"]==file]
  raw=rows[0][1].strip(); label,question=raw.split("\\n\\n"); assert label.endswith("[sample.csv]("+file+")") and question=="Tide test question"
  assert saved.import_id==record.id and saved.source_attachment_id==member["member_id"] and saved.resolution_status=="resolved"
  doc=z.read("conversation.md"); link=("]("+file+")").encode(); assert doc.count(link)==1
  intermediate=doc.replace(link,("](cr-asset://"+member["member_id"]+")").encode())
  assert _artifact_path(record,derived).read_bytes()==intermediate and hashlib.sha256(intermediate).hexdigest()==derived.sha256
  expect=raw.replace("]("+file+")","](cr-asset://"+str(saved.id)+")")
  assert versions[0].display_text.strip()==expect and versions[1].display_text.strip()==rows[1][1].strip()=="Tide test answer"
 asset=saved.asset_object; assert asset.sha256==sys.argv[2]
 links=[list(db.scalars(select(MessageVersionAttachment.attachment_id).where(MessageVersionAttachment.message_version_id==m.current_version_id))) for m in msgs]
 assert links==[[saved.id],[]]
 assert hashlib.sha256(get_asset_store().resolve_key(asset.storage_key).read_bytes()).hexdigest()==sys.argv[2]
`;
const delay=ms=>new Promise(r=>setTimeout(r,ms)),wait=async(fn,ms=10000)=>{const end=Date.now()+ms;do{const v=await fn();if(v)return v;await delay(100);}while(Date.now()<end);throw Error("condition timeout");};
const users=[],ctxs=[];let ctx,worker,panel,step="preflight",captures=0,external=0;
function inside(code,env={},args=[]){
  const a=lab.fixtureArgs();
  try{execFileSync("docker",[...a.slice(0,2),...Object.keys(env).flatMap(k=>["-e",k]),...a.slice(2),...args],
    {input:code,env:{...process.env,...env},stdio:["pipe","pipe","pipe"],timeout:25000});}
  catch(cause){
    // Report only the fixed test program's line/type, never its command, arguments or raw exception.
    const text=String(cause.stderr||""),err=Error("Disposable fixture check failed");
    err.fixtureLine=Number([...text.matchAll(/File "<stdin>", line (\d+)/g)].at(-1)?.[1])||undefined;
    err.fixtureType=/^(AssertionError|KeyError|AttributeError|ValueError|TypeError|LookupError|IndexError|MultipleResultsFound|NoResultFound)\b/m.exec(text)?.[1];
    throw err;
  }
}
async function user(){
  const email="api-source-"+crypto.randomBytes(12).toString("hex")+"@example.test",pw=crypto.randomBytes(32).toString("base64url");
  inside(fixturePython,{LAB_SOURCE_USER:email,LAB_SOURCE_PASS:pw});
  const api=await request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});ctxs.push(api);
  assert.equal((await api.post("/api/auth/login",{data:{email,password:pw}})).status(),200);
  const s=await (await api.get("/api/auth/session")).json();assert.ok(s.authenticated&&s.user_id);
  const u={api,email,uid:s.user_id};users.push(u);return u;
}
async function pair(u){
  const verifier=crypto.randomBytes(32).toString("base64url"),state=crypto.randomBytes(32).toString("base64url");
  const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
  const response=await u.api.post("/api/extension-devices/authorize",{data:{client,state,challenge,expected_user_id:u.uid}});
  assert.equal(response.status(),200);
  const redirect=new URL((await response.json()).redirect);
  assert.equal(redirect.origin,"https://"+client+".chromiumapp.org");assert.equal(redirect.pathname,"/reader");assert.equal(redirect.searchParams.get("state"),state);
  // Only this dedicated ordinary user's code is exchanged in its private extension context.
  // Do not return the access/refresh material, persist a raw HTTP trace, or use the user's browser profile.
  u.device=await worker.evaluate(async({origin,client,code,verifier,expected})=>{
    await ReaderClient.trust;
    const r=await fetch(origin+"/api/extension/v1/token",{...ReaderClient.json("POST",{client,code,verifier}),credentials:"omit",redirect:"error"});
    if(!r.ok)throw Error("Fixture pairing rejected");const data=await r.json();if(data.user_id!==expected)throw Error("Unexpected account");
    await chrome.storage.local.set({device:{origin,id:data.device_id,user:data.user_id,name:"API test account",refresh:data.refresh_token},
      destination:{device:data.device_id,project:null},jobs:[]});
    await chrome.storage.session.set({access:{origin,device:data.device_id,token:data.access_token,until:Date.now()+data.expires_in*1000-15000}});
    return data.device_id;
  },{origin,client,code:redirect.searchParams.get("code"),verifier,expected:u.uid});
}
async function main(){
  const a=await user(),b=await user();assert.notEqual(a.uid,b.uid);
  ctx=await chromium.launchPersistentContext(path.join(dir,"new-profile"),{executablePath:binary,headless:false,
    locale:label.startsWith("chrome-zh")?"zh-CN":"en-US",viewport:{width:375,height:700},args:["--headless=new","--no-first-run",
      "--disable-background-networking","--disable-sync","--no-proxy-server","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--disable-extensions-except="+build,"--load-extension="+build]});
  report.browser=ctx.browser().version();
  const mapping={};for(let i=0;i<2;i++){const id="fx-"+i,role=i?"assistant":"user";mapping[id]={id,parent:i?"fx-0":null,children:i?[]:["fx-1"],
    message:{id,author:{role},create_time:1740000000+i,content:{content_type:"text",parts:[i?"Tide test answer":"Tide test question"]},
      metadata:i?{}:{attachments:[{id:"synthetic-csv",name:"sample.csv",mime_type:"text/csv"}]}}};}
  await ctx.route("**/*",r=>{
    const u=new URL(r.request().url());
    if(u.origin===site){
      if(u.pathname===source)return r.fulfill({contentType:"text/html",body:"<!doctype html><title>Synthetic coast</title><main><p data-message-id='fx-1'>Coastal survey</p></main>"});
      if(u.pathname==="/api/auth/session")return r.fulfill({json:{accessToken:marker}});
      if(u.pathname==="/backend-api/conversation/"+srcid){captures++;return r.fulfill({json:{title:"Coastal survey test",conversation_id:srcid,current_node:"fx-1",mapping}});}
      if(u.pathname==="/backend-api/files/download/synthetic-csv")return r.fulfill({json:{download_url:"/synthetic.csv"}});
      if(u.pathname==="/synthetic.csv")return r.fulfill({body:attachment,contentType:"text/csv"});
      return r.fulfill({status:404,body:""});
    }
    if(u.origin===origin||["chrome-extension:","data:","blob:"].includes(u.protocol))return r.continue();
    external++;return r.abort();
  });
  step="actual-device-A";panel=await ctx.newPage();await panel.goto(ext+"/panel.html");await panel.locator("#connect").waitFor();
  worker=ctx.serviceWorkers().find(w=>w.url().startsWith(ext))||await ctx.waitForEvent("serviceworker",{timeout:10000});
  await pair(a);await panel.reload();await panel.locator("#q").waitFor();report.steps.push(step);
  const chat=await ctx.newPage();await chat.goto(site+source);await chat.bringToFront();const ax=await ctx.newCDPSession(chat);
  async function button(re,click=false){const x=await wait(async()=>(await ax.send("Accessibility.getFullAXTree")).nodes.find(
    n=>n.role?.value==="button"&&re.test(n.name?.value||"")));if(click){const {model}=await ax.send("DOM.getBoxModel",{backendNodeId:x.backendDOMNodeId});
    const p=model.content;await chat.mouse.click((p[0]+p[4])/2,(p[1]+p[5])/2);}}
  const save=/^(?:保存到 Reader|Save to Reader)$/,old=/^(?:打开已存版本|Open saved version)$/;
  const find=async()=>{await button(/其他操作|Other actions/,true);await button(/查找已存版本|Find saved version/,true);};
  step="actual-save";await button(save,true);
  const cid=await wait(()=>worker.evaluate(async()=>{const j=(await chrome.storage.local.get("jobs")).jobs?.at(-1);
    if(j&&["review","attention","upload-rejected","reconnect","failed"].includes(j.phase))throw Error("Unexpected save stage: "+j.phase);
    return j?.phase==="done"&&j.result?.completeness==="complete"&&j.cid||null;}),75000);
  assert.equal(captures,1);const owned=await a.api.get("/api/conversations/"+cid);assert.equal(owned.status(),200);
  assert.equal((await owned.json()).message_count,2);report.steps.push(step);
  step="read-back-bytes-and-owner";inside(verifyPython,{LAB_SOURCE_USER:a.email},[cid,assetSHA,srcid]);
  assert.equal((await b.api.get("/api/conversations/"+cid)).status(),404);report.steps.push(step);
  await worker.evaluate(async cid=>{
    const js=(await chrome.storage.local.get("jobs")).jobs||[];if(js.length!==1||js[0].cid!==cid)throw Error("Unexpected lab receipt ledger");
    const original=ReaderClient.request;
    globalThis.fixtureLookups=0;ReaderClient.request=async(...args)=>{if(args[1]==="sources/status")fixtureLookups++;return original(...args);};
    await chrome.storage.local.set({jobs:[]});
  },cid);
  const lookups=()=>worker.evaluate(()=>fixtureLookups);
  step="default-private";await chat.reload();await button(save);assert.equal(await lookups(),0);report.steps.push(step);
  step="manual-resolves-owner";await find();await button(old);assert.equal(await lookups(),1);report.steps.push(step);
  step="switch-device-in-place";await pair(b);await button(save);assert.equal(await lookups(),1);report.steps.push(step);
  step="actual-foreign-negative";await find();await button(/^(?:保存到 Reader|Save to Reader) · (?:没有可打开的已存版本。|No accessible saved version\.)$/);
  assert.equal(await lookups(),2);assert.equal(captures,1);assert.equal(external,0);report.steps.push(step);
}
main().then(()=>{report.passed=true;}).catch(e=>{report.passed=false;report.failedAt=step;report.errorClass=e.name;
  if(e.fixtureLine)report.fixtureLine=e.fixtureLine;if(e.fixtureType)report.fixtureType=e.fixtureType;
  const ln=/source-receipt-api\.cjs:(\d+):\d+/.exec(String(e.stack));if(ln)report.testLine=Number(ln[1]);process.exitCode=1;
}).finally(async()=>{
  // Revoke only this run's two known grants via their own real first-party sessions, even on failure.
  report.devicesRevoked=0;for(const u of users){if(!u.device)continue;try{const r=await u.api.delete("/api/extension-devices/"+u.device);
    assert.equal(r.status(),204);report.devicesRevoked++;}catch{report.passed=false;process.exitCode=1;}}
  for(const c of ctxs)await c.dispose().catch(()=>{});if(ctx)await ctx.close().catch(()=>{});
  fs.writeFileSync(path.join(dir,"receipt.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
});
