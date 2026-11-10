import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/reading-position-sync.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const copy = value => value === undefined ? value : structuredClone(value);
test("mounted handoff evidence is required by release CI",()=>{
  const workflow=readFileSync(new URL("../../.github/workflows/build-release-images.yml",import.meta.url),"utf8");
  const step=workflow.split("- name: Cross-device reading handoff and conflict recovery")[1]?.split("- name:")[0];
  assert.match(step??"",/run: node scripts\/ux\/reading-position-browser\.mjs/);
  assert.doesNotMatch(step,/continue-on-error|if:/);
  assert.match(workflow,/reading-position-browser\/result\.json/);
  assert.match(workflow,/reading-position-browser\/\*\.png/);
});
function table(key) {
  const rows = new Map();
  const query = (predicate = () => true, limit = Infinity) => {
    const values = () => [...rows.values()].sort((a,b) => (a.queued_at??"").localeCompare(b.queued_at??"")).filter(predicate).slice(0,limit);
    return { equals: value => query(row => row.conversation_id === value), filter: next => query(row => predicate(row)&&next(row),limit),
      count: async () => values().length, toArray: async () => copy(values()), last: async () => copy(values().at(-1)),
      limit: n => query(predicate,n), delete: async () => { for(const row of values())rows.delete(row[key]); } };
  };
  return { rows, get: async id => copy(rows.get(id)), put: async row => rows.set(row[key],copy(row)), delete: async id => rows.delete(id),
    bulkDelete: async ids => ids.forEach(id=>rows.delete(id)), update: async (id,update) => { if(rows.has(id))rows.set(id,{...rows.get(id),...copy(update)}); },
    where: () => query(), orderBy: () => query(), filter: predicate => query(predicate) };
}
const point = (revision, block=revision) => ({ id:"synthetic-position",conversation_id:"synthetic",message_id:"synthetic-message",
  block_index:block,scroll_offset:12,anchor_data:{ordinal:2},revision,created_at:"2026-11-10T00:00:00Z",updated_at:"2026-11-10T00:01:00Z" });
// Execute the actual sync module; transport/access and the in-memory table API
// are doubles. The companion mounted gate exercises real browser Dexie.
function fixture() {
  const db={name:"synthetic",readingPositions:table("conversation_id"),settings:table("key"),outbox:table("operation_id"),
    transaction:async (...args)=>args.at(-1)()};
  let remote=point(1),generation=1,receipt;
  const posts=[],exports={};
  const api={ApiRequestError:class extends Error{},getReadingPosition:async()=>({conversation_id:"synthetic",position:remote}),
    syncReadingPosition:async(id,operation)=>{
      posts.push(copy(operation));
      if(receipt)return {operation_id:operation.operation_id,...receipt};
      const status=operation.base_revision===remote.revision?"applied":"conflict";
      if(status==="applied")remote={...remote,...operation.position,revision:remote.revision+1};
      return {operation_id:operation.operation_id,status,position:copy(remote)};
    }};
  new Function("exports","require","window","navigator",compiled)(exports,name=>{
    if(name==="./offline-db")return {offlineDb:db};
    if(name==="./api")return api;
    if(name==="./offline-access")return {captureOfflineAccess:()=>generation,assertOfflineAccess:value=>{if(value!==generation)throw Error("retired");}};
    throw Error(name);
  },{dispatchEvent(){}},{onLine:true,locks:{request:async(_name,fn)=>fn()}});
  return {...exports,db,posts,setReceipt:value=>receipt=value,setRemote:value=>remote=value,remote:()=>remote,
    initial:()=>exports.readSyncedReadingPosition("synthetic",true),
    observe:()=>exports.readSyncedReadingPosition("synthetic",true,false,true),
    save:block=>exports.saveLocalReadingPosition("synthetic",point(0,block)),
    local:()=>db.readingPositions.get("synthetic"),
    state:async()=>(await db.settings.get("reading-sync:synthetic"))?.value,
    flush:()=>exports.flushReadingPositionBatch(db,generation)};
}
test("new entry takes the confirmed server point, while observation preserves the active local point",async()=>{
  const f=fixture();await f.initial();f.setRemote(point(2,8));await f.observe();
  assert.equal((await f.local()).block_index,1);assert.equal((await f.state()).server.block_index,8);
  assert.equal((await f.state()).incoming,true);assert.equal(f.posts.length,0);assert.equal(f.db.outbox.rows.size,0);
  await f.initial();assert.equal((await f.local()).block_index,8);assert.equal((await f.state()).incoming,false);
});
for(const choice of ["local","server"])test(`clean cross-device handoff is explicit: ${choice}`,async()=>{
  const f=fixture();await f.initial();f.setRemote(point(2,8));await f.observe();
  const selected=await f.resolveReadingPosition("synthetic",choice,2,f.readingSignature(await f.local()));
  assert.equal((await f.state()).incoming,false);
  if(choice==="server"){assert.equal(selected.block_index,8);assert.equal(f.posts.length,0);assert.equal(f.db.outbox.rows.size,0);}
  else {assert.equal(selected,null);await f.flush();assert.equal(f.remote().block_index,1);assert.equal(f.remote().revision,3);}
});
test("coalescing after a remote read cannot rebase an offline edit over the remote revision",async()=>{
  const f=fixture();await f.initial();await f.save(4);f.setRemote(point(2,8));await f.observe();await f.save(5);
  assert.equal(f.db.outbox.rows.size,1);
  assert.equal([...f.db.outbox.rows.values()][0].base_revision,1);
  await f.flush();assert.equal(f.remote().block_index,8);assert.equal((await f.local()).block_index,5);
  assert.ok(await f.db.settings.get(f.readingConflictKey("synthetic")));
});
test("scrolling while a handoff is awaiting choice preserves both positions as a conflict",async()=>{
  const f=fixture();await f.initial();f.setRemote(point(2,8));await f.observe();await f.save(5);await f.flush();
  assert.equal(f.remote().block_index,8);assert.equal((await f.local()).block_index,5);
  assert.ok(await f.db.settings.get(f.readingConflictKey("synthetic")));
});
test("stale comparisons and submitted operations cannot be discarded by a handoff",async()=>{
  const f=fixture();await f.initial();f.setRemote(point(2,8));await f.observe();
  const signature=f.readingSignature(await f.local());f.setRemote(point(3,12));
  await assert.rejects(f.resolveReadingPosition("synthetic","server",2,signature),/changed/);
  assert.equal((await f.local()).block_index,1);
  await f.save(4);const row=[...f.db.outbox.rows.values()][0];await f.db.outbox.update(row.operation_id,{submitted:true});
  await assert.rejects(f.resolveReadingPosition("synthetic","server",3,f.readingSignature(await f.local())),/acknowledgement/);
  assert.equal(f.db.outbox.rows.size,1);
});
test("older remote snapshots cannot undo an incoming handoff or its local point",async()=>{
  const f=fixture();await f.initial();f.setRemote(point(3,9));await f.observe();f.setRemote(point(2,8));await f.observe();
  assert.equal((await f.state()).server.revision,3);assert.equal((await f.local()).block_index,1);
});
test("an old applied receipt cannot silently accept a later device position observed during that write",async()=>{
  const f=fixture();await f.initial();await f.save(4);
  f.setRemote(point(3,9));await f.observe();
  f.setReceipt({status:"applied",position:point(2,4)});await f.flush();
  assert.equal((await f.state()).server.revision,3);assert.equal((await f.state()).incoming,true);
  assert.equal((await f.local()).block_index,4);assert.equal(f.db.outbox.rows.size,0);
});
