// First-party HTTP only, on a newly created named test conversation in the
// disposable Reader. Assertions retain payloads in memory; evidence is counts.
const assert=require("node:assert/strict"),{createHash,randomUUID}=require("node:crypto");
const lab=require("./lab-target.cjs");
exports.prepare=async({api,origin,cid,original,label})=>{
  assert.equal(origin,lab.origin);
  assert.match(label,/^[a-z0-9-]+$/);assert.equal(original.length,2);
  const conv=`/api/conversations/${cid}`,msg=original[0],headers={Origin:origin};
  async function json(method,path,data,code=200) {
    const response=await api[method](origin+path,{headers,...(data===undefined?{}:{data})});
    assert.equal(response.status(),code,`Preservation fixture: ${method} ${path.replace(/[a-f0-9-]{36}/gi,"[id]")} status`);
    return response.json();
  }
  const read=path=>json("get",path);
  const info=await read(conv);assert.equal(info.display_title??info.title,"Append destination "+label);
  // Give the original question a real previous version and a file occurrence.
  const bytes=Buffer.from("Synthetic original attachment\nThese bytes predate both appends.\n");
  const sha=buf=>createHash("sha256").update(buf).digest("hex");
  const session=await json("post",conv+"/attachment-upload-sessions",{},201);
  const up=await api.post(origin+`/api/attachment-upload-sessions/${session.id}/items`,{headers,multipart:{
    file:{name:"original-note.txt",mimeType:"text/plain",buffer:bytes}}});assert.equal(up.status(),201);
  const accepted=await json("post",conv+"/attachments",{upload_item_ids:[(await up.json()).id]},201);
  const aid=accepted.items[0].id;
  const edit=await json("patch","/api/messages/"+msg.id,{base_version_id:msg.current_version.id,
    content_markdown:`Opening question\n\n[Original note](cr-asset://${aid})`});
  assert.notEqual(edit.current_version_id,msg.current_version.id);
  const anchor={message_id:msg.id,message_version_id:edit.current_version_id};
  const ann=await json("post",conv+"/annotations",{...anchor,annotation_type:"highlight",start_block_index:0,
    end_block_index:0,start_offset:0,end_offset:7,quote:"Opening",comment_markdown:"Keep original note"},201);
  const mark=await json("post",conv+"/annotations",{...anchor,annotation_type:"bookmark",start_block_index:0,
    end_block_index:0,start_offset:0,end_offset:7,quote:"Opening",metadata:{bookmark_kind:"reading_point"}},201);
  assert.notEqual(ann.id,mark.id);
  const nb=await read(conv+"/notebook");await json("put",conv+"/notebook",{base_revision:nb.revision,blocks:[
    {id:randomUUID(),type:"annotation_reference",annotation_id:ann.id},{id:randomUUID(),type:"markdown",markdown:"Keep continuation note"}]});
  await json("put",conv+"/reading-position",{message_id:msg.id,block_index:0,scroll_offset:11,
    anchor_data:{position_mode:"block-relative-v2",character_offset:7}});

  const snapshot=async()=>{
    const [fileList,history,originalEnd,annotations,notebook,position,download]=await Promise.all([
      read(conv+"/attachments"),read(`/api/messages/${msg.id}/versions`),read(`/api/messages/${original[1].id}/versions`),
      read(conv+"/annotations"),read(conv+"/notebook"),read(conv+"/reading-position"),api.get(origin+`/api/attachments/${aid}/content`)]);
    assert.equal(download.status(),200);
    const file=fileList.items.find(f=>f.id===aid);
    assert.ok(file?.occurrences?.some(o=>o.message_id===msg.id&&o.message_version_id===edit.current_version_id&&o.is_current_version));
    assert.equal(history.items.length,2);assert.equal(originalEnd.items.length,1);
    assert.ok(annotations.some(a=>a.id===ann.id&&a.anchor_status==="valid"&&a.quote==="Opening"));
    assert.ok(annotations.some(a=>a.id===mark.id&&a.annotation_type==="bookmark"&&a.anchor_status==="valid"));
    assert.equal(notebook.blocks.length,2);assert.ok(position.position?.message_id);
    const fileDigest=sha(await download.body());assert.equal(fileDigest,sha(bytes));
    return {history,originalEnd,file,fileDigest,annotations:annotations.sort((a,b)=>a.id.localeCompare(b.id)),notebook,
      position:position.position};
  };
  // Only the original file is compared: a newly appended image is legitimate.
  const baseline=await snapshot();
  assert.equal(baseline.position.message_id,msg.id);assert.equal(baseline.position.scroll_offset,11);
  return {snapshot,verify:async(before)=>{assert.deepEqual(await snapshot(),before);},baseline};
};
