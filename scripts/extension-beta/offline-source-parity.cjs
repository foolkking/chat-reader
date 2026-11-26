// Acceptance-only: compare both parser paths in the exact candidate, offline. No writes.
// node offline-source-parity.cjs UNPACKED_EXTENSION tree ONE_CONVERSATION.json
// node offline-source-parity.cjs UNPACKED_EXTENSION pages NEWEST.json ... OLDEST.json
// node offline-source-parity.cjs UNPACKED_EXTENSION self-test
"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {isDeepStrictEqual:equal}=require("node:util"),assert=require("node:assert/strict");
const candidate="6725193cfe6f34e8f15f40f3be0e6c5f775e0d4e",pins={
  "locales/en.js":"83d0f746f90a3e71fa9c0fb85a749ecc069ac3fe0d2cefe424a58c92204a767c",
  "i18n.js":"71c776151b7eff621f768131aff3c9ea503fda0cb6c6e870a78f8d75fd25d0af",
  "fast-text.js":"bd8130241fad875f457ae882f2eaecb1131b5de536e44c2002b5f5ef3117f595",
  "source-file.js":"875124eaa06adb24205a1c7ca7f6ee7a18fc0da90bdde13aae4accec930e9636",
  "visible.js":"22bdfa3e59271a7e673ef988f6a85f6c062db20265945c2dced0f28f7500f3a4",
};
const abort=code=>{throw Object.assign(Error(),{code});};
function load(dir){
  const env=vm.createContext({TextDecoder,TextEncoder},{codeGeneration:{strings:false,wasm:false}});
  for(const [name,hash] of Object.entries(pins)){
    const bytes=fs.readFileSync(path.join(dir,name));
    if(crypto.createHash("sha256").update(bytes).digest("hex")!==hash)abort("MODULE_MISMATCH");
    vm.runInContext(bytes.toString("utf8"),env,{filename:name});
  }
  env.ChatExportI18n.setLocale("en");return env;
}
const safe=e=>["SOURCE_PAGE_CHANGED","SOURCE_PAGE_INVALID","SOURCE_FORMAT_INVALID","SOURCE_BRANCH_UNVERIFIED",
  "MODULE_MISMATCH","SNAPSHOT_SET_INVALID","SNAPSHOT_ID_UNVERIFIED","USAGE"].includes(e?.code)?e.code:"READ_OR_PARSE_FAILED";
async function compare(env,mode,blobs){
  if(!blobs.length||mode==="tree"&&blobs.length!==1)abort("USAGE");
  const api=env.FastTextExporter,stream=env.ReaderSourceFile,parseJSON=vm.runInContext("JSON.parse",env);let id;
  for(const blob of blobs){
    const h=await stream.header(blob,()=>{}),actual=h.conversation_id??h.id;
    if(typeof actual!=="string"||!/^[\w-]{1,128}$/.test(actual)||id&&id!==actual||h.id!=null&&h.id!==actual)abort("SNAPSHOT_ID_UNVERIFIED");
    if(mode==="tree"?!h.mapping:h.mapping||!h.messages)abort("SNAPSHOT_SET_INVALID");
    id=actual;
  }
  async function parse(bytes){
    let at=0,requests=0;
    // In-memory adapter to exercise the original loadConversation implementation. No
    // network API, browser profile, session file, real token, or remote URL is used.
    const fetch=async()=>{
      if(++requests===1)return {ok:true,json:async()=>({accessToken:"offline-placeholder"})};
      if(mode==="pages"&&requests===2)return {ok:false,status:404};
      const blob=blobs[at++];if(!blob)abort("SNAPSHOT_SET_INVALID");
      return {ok:true,json:async()=>parseJSON(await blob.text()),readerFile:async()=>blob};
    };
    const data=await api.loadConversation({id,fetch,retainRaw:false,sourcePaths:true,
      ...(bytes?{readerSource:stream.conversation(id,null,()=>{})}:{})});
    if(at!==blobs.length)abort("SNAPSHOT_SET_INVALID");return data;
  }
  const out={candidate,scope:"offline snapshot only",pages:blobs.length,reference:"not_run",reader:"not_run",
    messagesReference:null,messagesReader:null,parity:false,historyContinuityVerified:false,liveBranchVerified:false,
    assetBytesVerified:false,serverCommittedVerified:false};
  let ref;
  try{ref=await parse(false);out.reference="parsed";out.messagesReference=ref.messages.length;}catch(e){out.reference=safe(e);}
  try{
    const data=await parse(true);let i=0;
    const checks={orderedIds:true,rolesTimesPaths:true,visibleMarkdown:true,resourceReferences:true,normalizedRecords:true,warningCounts:false};
    for await(const row of data.rows()){
      const original=ref?.messages[i];i++;
      if(!original){for(const k of Object.keys(checks))checks[k]=false;continue;}
      checks.orderedIds&&=original.id===row.id;
      checks.rolesTimesPaths&&=original.role===row.role&&original.createTime===row.createTime&&equal(original.sourcePath,row.sourcePath);
      checks.visibleMarkdown&&=equal(env.ReaderVisible(original,api),env.ReaderVisible(row,api));
      checks.resourceReferences&&=["images","attachments","tables","needsAssets"].every(k=>equal(original[k],row[k]));
      checks.normalizedRecords&&=equal(original,row);
    }
    out.reader="parsed";out.messagesReader=i;
    if(ref){checks.warningCounts=ref.warnings.length===data.warnings.length;out.checks=checks;
      out.parity=i===ref.messages.length&&i>0&&Object.values(checks).every(Boolean);}
  }catch(e){out.reader=safe(e);}
  return out;
}
async function main([dir,mode,...paths]){
  if(!dir||!["tree","pages","self-test"].includes(mode))abort("USAGE");
  const env=load(dir);
  if(mode==="self-test"){
    if(paths.length)abort("USAGE");
    const blob=d=>new Blob([JSON.stringify(d)]),m=(id,t)=>({id,author:{role:"user"},content:{content_type:"text",parts:[t]}});
    const one=m("m1","SYNTHETIC_TEXT_NOT_TO_PRINT"),two=m("m2","Tide");
    one.metadata={attachments:[{id:"file-test",name:"synthetic.csv"}]};
    two.author.role="assistant";two.metadata={model_dil_v2:{fallbackMarkdown:"## Synthetic section",code:"not executed"}};
    const d={conversation_id:"synthetic",current_node:"n2",mapping:{n1:{parent:null,children:["n2"],message:one},n2:{parent:"n1",children:[],message:two}}};
    assert.ok((await compare(env,"tree",[blob(d)])).parity);
    const page=(rows,more)=>blob({conversation_id:"synthetic",messages:rows,page_info:{has_previous_page:more,start_cursor:"synthetic"}});
    assert.ok((await compare(env,"pages",[page([two],true),page([one,{...two,update_time:2}],false)])).parity);
    const mismatch=await compare(env,"pages",[page([two],true),page([m("m2","different")],false)]);
    assert.equal(mismatch.reference,"SOURCE_PAGE_CHANGED");assert.equal(mismatch.reader,"SOURCE_PAGE_CHANGED");assert.equal(mismatch.parity,false);
    await assert.rejects(compare(env,"tree",[blob({...d,id:"other"})]),e=>safe(e)==="SNAPSHOT_ID_UNVERIFIED");
    assert.doesNotMatch(JSON.stringify(mismatch),/SYNTHETIC_TEXT_NOT_TO_PRINT|synthetic|different/);
    return {candidate,selfTests:"passed"};
  }
  const blobs=[];for(const file of paths){if(!fs.lstatSync(file).isFile())abort("SNAPSHOT_SET_INVALID");blobs.push(await fs.openAsBlob(file));}
  return compare(env,mode,blobs);
}
main(process.argv.slice(2)).then(out=>{console.log(JSON.stringify(out));if(out.parity===false)process.exitCode=1;})
  .catch(e=>{console.error(JSON.stringify({candidate,error:safe(e)}));process.exitCode=2;});
