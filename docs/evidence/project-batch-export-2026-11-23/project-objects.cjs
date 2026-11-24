// Audit the existing operation; this is not a product acceptance gate.
// Only fresh synthetic accounts in the fixed loopback extension-beta lab.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require(path.resolve("apps/web/node_modules/@playwright/test"));
const { unzipSync, strFromU8 } = require(path.resolve("apps/web/node_modules/fflate"));
const origin = "http://127.0.0.1:18383";
const tmp = fs.realpathSync(process.env.TEMP);
if (tmp !== fs.realpathSync(process.env.TMP) ||
    !/^(?:E:\\chat-reader-temp|C:\\Users\\86182\\Desktop\\wkkk)\\[^\\]+/i.test(tmp))
  throw Error("Use an approved task-specific TEMP and TMP");
const run = crypto.randomBytes(8).toString("hex"), password = crypto.randomBytes(30).toString("base64url");
const edge = process.env.AUDIT_BROWSER === "edge", width = edge ? 375 : 1440;
const out = fs.mkdtempSync(path.join(tmp, edge ? "objects-edge-" : "objects-chromium-"));
let browser, phase = "check lab and create synthetic user";
const report = { firstUtc: new Date().toISOString(), viewport: [width, 900], engine: edge ? "Edge" : "Chromium" };
function need(ok, why) { if (!ok) throw Error(why); }
async function until(fn) {
  const end = Date.now() + 45000;
  do { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 160)); } while (Date.now() < end);
  throw Error("Not ready within observation window");
}
async function main() {
  const seed = `import os,re
from app.core.database import SessionLocal
from app.models import _register_all_models
from app.services.auth import register_user
assert os.environ["APP_ENV"]=="test" and os.environ["PUBLIC_WEB_BASE_URL"]=="${origin}"
assert re.fullmatch(r"[0-9a-f]{16}",os.environ["FIXTURE_RUN"])
_register_all_models()
with SessionLocal() as db:
 assert db.get_bind().url.database=="extension_beta"
 register_user(db, "scope-"+os.environ["FIXTURE_RUN"]+"@example.test", os.environ["FIXTURE_PASSWORD"])
 db.commit()`;
  execFileSync("docker", ["exec", "-i", "-e", "FIXTURE_RUN", "-e", "FIXTURE_PASSWORD",
    "reader-ext-beta-1123-api-1", "python", "-"], {input: seed, stdio: ["pipe","pipe","pipe"],
      env: {...process.env, FIXTURE_RUN: run, FIXTURE_PASSWORD: password}});
  const executablePath = edge ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" :
    "C:/Users/86182/Desktop/wkkk/playwright-browsers/chromium-1234/chrome-win64/chrome.exe";
  browser = await chromium.launch({executablePath, headless: true, downloadsPath: out,
    args:["--disable-background-networking","--no-proxy-server","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"]});
  report.version = browser.version();
  const ctx = await browser.newContext({baseURL: origin, viewport: {width,height:900}, locale:"zh-CN",
    hasTouch: width < 400, serviceWorkers:"block"});
  await ctx.route("**/*", r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  const req = ctx.request, page = await ctx.newPage(), H = { Origin: origin };
  page.setDefaultTimeout(12000);
  const json = async (method, url, data) => {
    need(url.startsWith("/api/"), "Local API only");
    const r = await req.fetch(url,{method,headers:H,...(data ? {data} : {}),maxRedirects:0});
    need(r.ok(), `Lab response ${r.status()}`); return r.json();
  };
  phase = "create bounded fixture via owner API";
  await json("POST","/api/auth/login",{email:`scope-${run}@example.test`,password});
  await json("PATCH","/api/preferences",{locale_mode:"zh-CN",theme_mode:"light"});
  const projects = [];
  for (const name of ["Scope Canary Alpha","Scope Canary Beta","Scope Canary Empty"])
    projects.push(await json("POST","/api/projects",{name,description:"Project-only note "+name}));
  const [A,B,E] = projects, same = "同名研究记录";
  async function create(title, project, marker) {
    const r = await json("POST","/api/conversations",{title, project_id:project?.id ?? null, messages:[
      {role:"user",content_markdown:"Identical first line"},{role:"assistant",content_markdown:marker}]});
    return r.conversation.id;
  }
  const a = await create(same,A,"Sample answer A"), b = await create(same,B,"Sample answer B");
  const archived = await create("已归档的单条对话",A,"Archived source");
  const stray = await create("未归类的资料",null,"Unselected source");
  await json("POST",`/api/conversations/${archived}/archive`);
  const members = id => json("GET",`/api/projects/${id}/conversations?sort=title&direction=asc&limit=10`);
  const owners = await Promise.all(projects.map(async p => (await members(p.id)).map(x=>x.id)));
  need(owners[0].length===1 && owners[0][0]===a && owners[1].length===1 && owners[1][0]===b && !owners[2].length,
    "Owner project membership differs from fixture");
  const pathToAction = async (url, prefix, selected) => {
    await page.goto(url); const bar = page.getByTestId("selection-toolbar");
    await page.getByRole("button",{name:"批量操作",exact:true}).click();
    for (const id of selected) await page.getByTestId(prefix+id).getByRole("checkbox").check();
    return bar;
  };
  const emit = async bar => {
    const ack = page.waitForResponse(r=>new URL(r.url()).pathname==="/api/conversations/batch-export" && r.request().method()==="POST");
    await bar.getByRole("button",{name:"导出",exact:true}).click();
    const r = await ack; need(r.status()===202,"No export admitted");
    const j = await r.json(), body = r.request().postDataJSON();
    const complete = await until(async()=>{const t=await json("GET","/api/tasks/"+j.job_id);
      need(!["failed","cancelled"].includes(t.status),"Export did not publish");return t.status==="committed" && t;});
    need(/^\/api\/exports\/[a-f0-9-]+\/download$/.test(complete.result.download_url),"Unexpected result URL");
    const d = await req.get(complete.result.download_url,{maxRedirects:0});need(d.ok(),"No downloadable artifact");
    const raw = await d.body(), entries = unzipSync(raw);
    const docs = Object.entries(entries).map(([filename,content])=>({filename,
      rows:strFromU8(content).trim().split("\n").map(s=>JSON.parse(s))}));
    const ids = docs.map(f=>f.rows.find(x=>x.record_type==="manifest")?.conversation.id);
    need(JSON.stringify(ids)===JSON.stringify(body.conversation_ids) && ids.length===complete.total_items,"Request, task and archive disagree");
    return {docs,ids,requestKeys:Object.keys(body).sort(),disposition:d.headers()["content-disposition"]||"",
      digest:crypto.createHash("sha256").update(raw).digest("hex")};
  };
  phase = "select two identically titled conversations across projects on Home";
  const bar = await pathToAction("/","conversation-sortable-row-",[a,b]);
  const displayedRows=await Promise.all([a,b].map(id=>page.getByTestId("conversation-sortable-row-"+id).innerText()));
  const names=await Promise.all([a,b].map(id=>page.getByTestId("conversation-sortable-row-"+id).getByRole("checkbox").getAttribute("aria-label")));
  // Only synthetic row pixels; never screenshot the address bar, sidebar or account surface.
  for (const [i,id] of [a,b].entries())
    await page.getByTestId("conversation-sortable-row-"+id).screenshot({path:path.join(out,`selected-${i+1}.png`),animations:"disabled"});
  const cross=await emit(bar), text=JSON.stringify(cross.docs);
  need(cross.ids.length===2 && cross.ids.includes(a) && cross.ids.includes(b),"Wrong same-title members");
  report.crossProject={sourceProjectActiveCounts:owners.map(x=>x.length),originalProjects:3,
    rowsDisplayOwnProject:displayedRows.map((txt,i)=>txt.includes(projects[i].name)),sameCheckboxName:names[0]===names[1],
    requestFields:cross.requestKeys, downloadedConversations:cross.ids.length, rawOrderMatchesRequest:true,
    distinctFilenames:new Set(cross.docs.map(x=>x.filename)).size, directoryCount:new Set(cross.docs.flatMap(x=>x.filename.includes("/")?[x.filename.split("/")[0]]:[])).size,
    membershipProjectIdsInFile:projects.filter(p=>text.includes(p.id)).length,
    projectNamesInFile:projects.filter(p=>text.includes(p.name)).length,
    containsArchived:cross.ids.includes(archived),containsUnselected:cross.ids.includes(stray),
    hashedZip:cross.digest};
  phase = "one export per project, comparison of both Suggested Filenames";
  const singles=[];
  for(const [p,id] of [[A,a],[B,b]])singles.push(await emit(await pathToAction(`/projects/${p.id}`,"project-conversation-sortable-row-",[id])));
  need(singles[0].ids.length===1&&singles[0].ids[0]===a&&singles[1].ids.length===1&&singles[1].ids[0]===b,"Wrong per-project export");
  const fn=s=>s.disposition.match(/filename="?([^";]+)/i)?.[1] || null;
  report.independentExports={sameSuggestedFilename:!!fn(singles[0])&&fn(singles[0])===fn(singles[1]),
    usesOnlyDay:/^chat-reader-export-\d{4}-\d{2}-\d{2}\.zip$/.test(fn(singles[0])||""),differentBytes:singles[0].digest!==singles[1].digest};
  phase="empty project page and archived project vs archived conversation";
  await page.goto(`/projects/${E.id}`);
  await page.getByText("这个项目还没有对话",{exact:true}).waitFor();
  await page.getByRole("button",{name:"批量操作",exact:true}).click();
  const emptyBar=page.getByTestId("selection-toolbar");
  report.emptyProject={noConversationRows:!(await page.locator('[data-testid^="project-conversation-sortable-row-"]').count()),
    exportDisabled:await emptyBar.getByRole("button",{name:"导出",exact:true}).isDisabled()};
  const archivedP=await json("PATCH",`/api/projects/${B.id}`,{is_archived:true});
  need(archivedP.is_archived===true,"Archive flag not set on synthetic project");
  const hidden=(await json("GET","/api/projects")).every(p=>p.id!==B.id), browsable=await members(B.id);
  const current=await json("GET",`/api/conversations/${b}`);
  await page.goto("/archived");
  const archivedProjectSection=page.getByRole("region",{name:"已归档项目"});
  await archivedProjectSection.getByRole("button",{name:"批量操作",exact:true}).click();
  const archivedBar=archivedProjectSection.getByTestId("selection-toolbar");
  report.archivedProject={hiddenFromActiveProjects:hidden, memberRemainsActive:current.status==="active",
    activeProjectPageEndpointStillListsMember:browsable.some(row=>row.id===b), archivedConversationInActiveA:owners[0].includes(archived),
    projectActions:{restore:await archivedBar.getByRole("button",{name:"恢复所选",exact:true}).count(),
      permanentlyDelete:await archivedBar.getByRole("button",{name:"永久删除所选",exact:true}).count(),
      export:await archivedBar.getByRole("button",{name:/导出/}).count()}};
  report.status="observed";
}
main().catch(e=>{report.status="incomplete";report.phase=phase;report.errorClass=e.name;
  // Do not persist account information, URLs/ids, response payloads or diagnostic stdout.
  console.log("Incomplete:",phase,e.name);process.exitCode=1;
}).finally(async()=>{await browser?.close();report.lastUtc=new Date().toISOString();
  fs.writeFileSync(path.join(out,"observations.json"),JSON.stringify(report,null,2)+"\n");
  console.log("Audit receipt:",path.basename(out),report.status);});
