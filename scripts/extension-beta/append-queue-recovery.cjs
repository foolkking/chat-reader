// Capture an actual accepted job before the isolated worker can commit. The
// second client logs in independently. No synthetic receipts or fake failures.
const assert=require("node:assert/strict"),{execFileSync}=require("node:child_process");
const lab=require("./lab-target.cjs");
async function whileWorkerStopped(check){
  const worker=lab.container("worker");
  const running=()=>{assert.equal(lab.container("worker"),worker);return execFileSync("docker",["inspect",worker,"--format","{{.State.Running}}"],{encoding:"utf8"}).trim();};
  assert.equal(running(),"true");
  execFileSync("docker",["stop","--time","15",worker],{stdio:"ignore"});
  try{assert.equal(running(),"false");return await check();}
  finally{assert.equal(lab.container("worker"),worker);execFileSync("docker",["start",worker],{stdio:"ignore"});}
}
// The device flow has no fixed target on the upload. A fresh browser document
// must recover the chosen Reader conversation from the accepted selection.
exports.confirmChosenAndReopen=async({staged,origin,cid,iid,target,confirm,report,mark})=>{
  assert.equal(origin,lab.origin);assert.equal(staged.url(),origin+"/append-imports/"+iid);
  const endpoint=origin+"/api/append-imports/"+iid+"/confirm",state=report.chosenTargetRecovery={confirmPosts:0};
  const count=r=>{if(r.method()==="POST"&&r.url()===endpoint)state.confirmPosts++;};
  staged.on("request",count);
  try{
    mark("excerpt-accepted-reload");
    await whileWorkerStopped(async()=>{
      const accepted=staged.waitForResponse(r=>r.url()===endpoint&&r.status()===202);
      await confirm.click();await accepted;await staged.reload();
      await staged.getByRole("heading",{name:target,exact:true}).waitFor();
      const change=staged.getByRole("button",{name:/更改对话|Change conversation/});assert.ok(await change.isDisabled());
      assert.equal(await staged.getByRole("searchbox").count(),0);
      await staged.getByRole("checkbox",{name:/^2 · /}).waitFor();
      const picks=staged.locator('input[type="checkbox"]:checked');
      assert.equal(await picks.count(),2);assert.ok(await picks.first().isDisabled());assert.equal(state.confirmPosts,1);
      state.destinationRestored=true;state.checkedWhileQueued=2;
    });
    const opened=staged.getByRole("link",{name:/打开目标对话|Open destination conversation/});
    await opened.waitFor();assert.equal(await opened.getAttribute("href"),"/conversations/"+cid);
    assert.equal(state.confirmPosts,1);state.noDuplicateConfirmation=true;
  }finally{staged.off("request",count);}
};
exports.exercise=async({staged,origin,cid,anchor,target,dir,report,mark,list,until})=>{
  assert.equal(origin,lab.origin);
  const url=new URL(staged.url()),confirmPath="/api"+url.pathname+"/confirm";
  assert.equal(url.origin,origin);assert.match(url.pathname,/^\/append-imports\/[a-f0-9-]{36}$/);
  const confirm=staged.getByRole("button",{name:new RegExp(`追加 2 条消息到《${target}》末尾|Append 2 messages to the end of “${target}”`)});
  const state=report.queuedRecovery={confirmPosts:0};
  const count=r=>{if(r.method()==="POST"&&new URL(r.url()).pathname===confirmPath)state.confirmPosts++;};
  staged.on("request",count);
  const check=staged.getByRole("checkbox",{name:/^1 · /});
  try{
    mark("file-accepted-reload");
    await whileWorkerStopped(async()=>{
      const accepted=staged.waitForResponse(r=>new URL(r.url()).pathname===confirmPath&&r.status()===202);
      await confirm.click();await accepted;await staged.reload();await check.waitFor();
      state.checkedWhileQueued=await staged.locator('input[type="checkbox"]:checked').count();
      assert.equal(state.checkedWhileQueued,2);assert.ok(await check.isDisabled());
      assert.equal(state.confirmPosts,1);assert.equal(await staged.getByRole("searchbox").count(),0);
      const other=await require("../../apps/web/node_modules/@playwright/test").request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
      try{
        assert.equal((await other.post("/api/auth/login",{data:{email:"browser-beta@example.test",password:process.env.BETA_TEST_PASSWORD}})).status(),200);
        assert.equal((await other.post(`/api/conversations/${cid}/messages/insert`,{data:{anchor_message_id:anchor,position:"after",
          messages:[{role:"user",content_markdown:"Another device changed the queued end"}]}})).status(),201);
      }finally{await other.dispose();}
    });
    mark("file-worker-changed-tail");await staged.getByRole("alert").filter({hasText:/上次追加未完成|previous append did not complete/i}).waitFor();
    // A new DOM after failure must not use the selection held by the old tab.
    await staged.reload();await check.waitFor();
    await until(async()=>/Another device changed the queued end/.test(await staged.locator("blockquote").textContent({timeout:1000}).catch(()=>"")));
    state.checkedAfterFailureAndReload=await staged.locator('input[type="checkbox"]:checked').count();assert.equal(state.checkedAfterFailureAndReload,2);
    assert.ok(await staged.getByRole("checkbox",{name:/^2 · /}).isChecked());
    assert.equal(await staged.getByRole("checkbox",{name:/^3 · /}).isChecked(),false);
    assert.equal(await staged.getByRole("searchbox").count(),0);
    const before=await list();assert.equal(before.length,6);assert.match(before.at(-1).current_version.display_text,/Another device changed the queued end/);
    assert.equal(state.confirmPosts,1);
    await staged.screenshot({path:require("node:path").join(dir,"accepted-reload.png")});
    await confirm.click();await staged.getByRole("link",{name:/打开目标对话|Open destination conversation/}).waitFor();
    assert.equal(state.confirmPosts,2);state.noAutomaticConfirmation=true;return before;
  }finally{staged.off("request",count);}
};
