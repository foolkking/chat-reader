import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";

const require=createRequire(new URL("../../apps/web/package.json",import.meta.url)), ts=require("typescript");
const module={exports:{}};
new Function("module","exports",ts.transpileModule(
  readFileSync(new URL("../../apps/web/lib/append-selection.ts",import.meta.url),"utf8"),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(module,module.exports);
const s=module.exports;

test("249/250 keep old indexes; 251 uses one range only on an advertised server",()=>{
  for(const n of [249,250])assert.deepEqual(s.appendSelectionPayload([[0,n]],false),{indexes:Array.from({length:n},(_,i)=>i)});
  assert.deepEqual(s.appendSelectionPayload([[0,251]],true),{ranges:[[0,251]],selected_count:251});
  assert.throws(()=>s.appendSelectionPayload([[0,251]],false));
});

test("all minus exclusions stays compact and merging page selections never loses order",()=>{
  const all=[[0,1_000_000_000]], next=s.removeAppendRange(all,39,41);
  assert.deepEqual(next,[[0,39],[41,1_000_000_000]]);
  assert.deepEqual(all,[[0,1_000_000_000]]);
  assert.equal(s.appendSelectedCount(next),999_999_998);
  assert.equal(s.appendSelectionHas(next,40),false);
  assert.equal(s.appendSelectionHas(next,41),true);
  assert.deepEqual(s.mergeAppendRanges([...next,[39,40],[40,41]]),all);
  assert.ok(JSON.stringify(s.appendSelectionPayload(next,true)).length<100);
});

test("old and range receipts restore the same normalized selection without expansion",()=>{
  assert.deepEqual(s.appendSelectionRanges({indexes:[4,0,1,3]}),[[0,2],[3,5]]);
  const ranges=s.appendSelectionRanges({ranges:[[0,200],[200,1000]],selected_count:1000});
  assert.deepEqual(ranges,[[0,1000]]);
  assert.equal(s.equalAppendRanges(ranges,[[0,1000]]),true);
  assert.equal(s.equalAppendRanges(ranges,[[0,999]]),false);
});

test("the sparse encoding budget is not a total-message cap; no automatic multi-submit",()=>{
  const sparse=Array.from({length:4096},(_,i)=>[i*2,i*2+1]);
  assert.equal(s.appendSelectionPayload(sparse,true).selected_count,4096);
  assert.throws(()=>s.appendSelectionPayload([...sparse,[8192,8193]],true));
  assert.equal(s.appendSelectionPayload([[0,10_000_000]],true).selected_count,10_000_000);
  assert.throws(()=>s.mergeAppendRanges([[0,0]]));
  assert.throws(()=>s.mergeAppendRanges([[0,Number.MAX_SAFE_INTEGER+1]]));
});
