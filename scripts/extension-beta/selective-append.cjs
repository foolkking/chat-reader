// Fresh extension profile, synthetic opted-in source, real owner API/worker/DB.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process"),lab=require("./lab-target.cjs");
exports.check=async({ctx,chat,origin,sourceButton,signIn,until,mark,dir,label,report,steps})=>{
  assert.equal(origin,lab.origin);await signIn();
  const headers={Origin:origin},target="Append destination "+label,api=ctx.request;
  const response=await api.post(origin+"/api/conversations",{headers,data:{title:target,messages:[
    {role:"user",content_markdown:"Opening question"},{role:"assistant",content_markdown:"Initial tail"}]}});
  assert.equal(response.status(),201);const created=await response.json(),cid=created.conversation.id;
  mark("append-preservation-baseline");
  const personal=await require("./append-preservation.cjs").prepare({api,origin,cid,original:created.messages,label});
  const list=async()=>{const r=await api.get(origin+`/api/conversations/${cid}/messages?limit=25`);assert.equal(r.status(),200);const items=await r.json();assert.ok(Array.isArray(items));return items;};
  const options=/选择内容并追加到|Select content and append to/i;
  const checkSelectionActions=async page=>{
    const group=page.getByRole("group",{name:/消息选择操作|Message selection actions/});
    let geometry;
    try{geometry=await group.evaluate(el=>{
        const boxes=[...el.querySelectorAll("button")].map(button=>{const r=button.getBoundingClientRect();return {top:r.top,height:r.height,width:r.width};});
        return {boxes,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
      });}
    catch(error){
      report.selectionControlFailure=await page.evaluate(()=>({
        visibleGroups:[...document.querySelectorAll('[role="group"]')].map(e=>e.getAttribute("aria-label")||"").filter(Boolean),
        selected:document.querySelectorAll('input[type="checkbox"]:checked').length,
        controls:document.querySelectorAll("button").length,
        noHorizontalOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth
      })).catch(()=>({evaluationFailed:true}));
      await page.screenshot({path:path.join(dir,"append-selection-controls-failure.png")}).catch(()=>{});
      throw error;
    }
    assert.equal(geometry.boxes.length,2);assert.ok(geometry.boxes.every(b=>b.height>=44&&b.width>0));
    assert.ok(Math.max(...geometry.boxes.map(b=>b.top))-Math.min(...geometry.boxes.map(b=>b.top))<=1,
      "Message selection actions must stay in one aligned row on a narrow page");
    assert.ok(geometry.scrollWidth<=geometry.clientWidth);return geometry;
  };
  const more=()=>sourceButton(/Other actions|其他操作/,true);
  const resources={csv:0,png:0};
  const narrow=label.startsWith("edge"),beforeViewport=chat.viewportSize();
  if(narrow)await chat.setViewportSize({width:375,height:820});
  const count=req=>{const u=new URL(req.url());if(u.origin==="https://chatgpt.com"&&u.pathname==="/test-only.csv")resources.csv++;if(u.origin==="https://chatgpt.com"&&u.pathname==="/test-only.png")resources.png++;};
  ctx.on("request",count);
  try{
    mark("excerpt-cancel");await chat.bringToFront();await sourceButton(/保存到 Reader|Save to Reader|已存入 Reader|打开已存版本|Saved to Reader|Open saved version/);
    await more();await sourceButton(options,true);await sourceButton(/^(取消|Cancel)$/,true);
    assert.deepEqual(resources,{csv:0,png:0});
    mark("excerpt-reopen-menu");await more();mark("excerpt-choose-action");await sourceButton(options,true);
    mark("excerpt-native-checkboxes");
    const ax=await ctx.newCDPSession(chat);
    try{
      // Native input hit-test inside a closed shadow root. Do not inject/invoke content-script code.
      const checks=await until(async()=>{const ns=(await ax.send("Accessibility.getFullAXTree")).nodes.filter(n=>n.role?.value==="checkbox");return ns.length>=3&&ns;});
      for(const i of [1,2]){
        const item=checks.find(n=>n.name?.value?.startsWith((i+1)+" · "));assert.ok(item);
        const {model}=await ax.send("DOM.getBoxModel",{backendNodeId:item.backendDOMNodeId}),b=model.content;
        await chat.mouse.click((b[0]+b[4])/2,(b[1]+b[5])/2);
      }
      const text=(await ax.send("Accessibility.getFullAXTree")).nodes.filter(n=>!n.ignored).map(n=>n.name?.value||"").join("\n");
      assert.match(text,/共 3 条 · 已选 2 条|3 messages · 2 selected/);
      assert.match(text,/tide\.csv/);assert.match(text,/Adjacent answer/);
      assert.doesNotMatch(text,/(?:attachment:synthetic|asset:synthetic|```md)/);
    }finally{await ax.detach();}
    assert.deepEqual(resources,{csv:0,png:0});
    await chat.screenshot({path:path.join(dir,"excerpt-choice.png")});
    mark("excerpt-reader-handoff");
    const handoff=ctx.waitForEvent("page");await sourceButton(/选择 Reader 对话|Choose Reader conversation/,true);
    const staged=await handoff;await staged.waitForURL(origin+"/append-imports/*");
    const appendResponses=[];report.appendResponses=appendResponses;
    staged.on("response",async response=>{
      const u=new URL(response.url());if(u.origin!==origin||!u.pathname.startsWith("/api/append-imports/"))return;
      const route=u.pathname.endsWith("/choices")?"choices":u.pathname.endsWith("/targets")?"targets":
        u.pathname.endsWith("/review")?"review":u.pathname.endsWith("/confirm")?"confirm":"status";
      const summary={method:response.request().method(),route,status:response.status()};
      if(route==="targets"&&response.ok()){
        const data=await response.json().catch(()=>null);
        summary.itemCount=Array.isArray(data?.items)?data.items.length:null;
        summary.expectedTargetPresent=!!data?.items?.some(x=>x.title===target);
      }
      appendResponses.push(summary);
    });
    if(narrow)await staged.setViewportSize({width:375,height:820});
    const iid=new URL(staged.url()).pathname.split("/").at(-1);assert.match(iid,/^[a-f\d-]{36}$/i);
    mark("excerpt-reader-destination");
    try{await staged.getByRole("searchbox").fill(target);}
    catch(error){
      report.appendPageState=await staged.evaluate(()=>({
        page:location.pathname.startsWith("/append-imports/")?"append-task":location.pathname==="/login"?"login":"other",
        searchboxes:document.querySelectorAll('input[type="search"],input[role="searchbox"]').length,
        alerts:document.querySelectorAll('[role="alert"]').length,statuses:document.querySelectorAll('[role="status"]').length,
        headings:[...document.querySelectorAll("main h1,main h2")].map(e=>e.textContent||"").join(" ").slice(0,120),
        scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth
      })).catch(()=>({evaluationFailed:true}));
      throw error;
    }
    try{await staged.getByRole("button",{name:new RegExp(target)}).click();}
    catch(error){
      report.appendPageState=await staged.evaluate(expected=>({
        page:location.pathname.startsWith("/append-imports/")?"append-task":location.pathname==="/login"?"login":"other",
        searchValue:document.querySelector('input[type="search"]')?.value===expected,
        expectedButton:!![...document.querySelectorAll("button")].find(e=>e.textContent?.includes(expected)),
        visibleButtons:document.querySelectorAll("button").length,
        alerts:document.querySelectorAll('[role="alert"]').length,statuses:document.querySelectorAll('[role="status"]').length,
        scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth
      }),target).catch(()=>({evaluationFailed:true}));
      throw error;
    }
    assert.equal(await staged.locator('input[type="checkbox"]:checked').count(),2);
    mark("excerpt-target-selected");
    mark("excerpt-selection-controls");
    const pluginSelectionControls=await checkSelectionActions(staged);
    mark("excerpt-selection-screenshot");
    await staged.screenshot({path:path.join(dir,"append-selection-actions.png")});
    const listed=await staged.locator("li").filter({has:staged.getByRole("checkbox")}).allTextContents();
    mark("excerpt-selection-preview");
    assert.match(listed.join(" "),/Adjacent answer/);assert.doesNotMatch(listed.join(" "),/cr-asset:\/\/|```md/);
    assert.deepEqual(resources,{csv:0,png:1});
    // Read the actual bytes in the received ZIP. Counts in the web form alone are insufficient.
    mark("excerpt-received-bytes");
    const archive=JSON.parse(execFileSync("docker",[...lab.fixtureArgs(),iid],{input:fs.readFileSync(path.join(__dirname,"verify_excerpt.py")),stdio:["pipe","pipe","pipe"],encoding:"utf8"}));
    const review=staged.getByRole("button",{name:/核对追加位置|Review append position/});await review.click();
    const confirm=staged.getByRole("button",{name:new RegExp(`追加 2 条消息到《${target}》末尾|Append 2 messages to the end of “${target}”`)});
    await confirm.waitFor();assert.match(await staged.locator("blockquote").innerText(),/Initial tail/);
    assert.equal((await list()).length,2);
    mark("excerpt-other-client");
    // A separate cookie jar/session changes this *same* target without changing the selected source.
    const other=await require("../../apps/web/node_modules/@playwright/test").request.newContext({baseURL:origin,extraHTTPHeaders:headers});
    try{
      assert.equal((await other.post("/api/auth/login",{data:{email:"browser-beta@example.test",password:process.env.BETA_TEST_PASSWORD}})).status(),200);
      assert.equal((await other.post(`/api/conversations/${cid}/messages/insert`,{data:{
        anchor_message_id:created.messages[1].id,position:"after",messages:[{role:"user",content_markdown:"Other device updated the end"}]}})).status(),201);
    }finally{await other.dispose();}
    const stale=staged.waitForResponse(r=>new URL(r.url()).pathname===`/api/append-imports/${iid}/confirm`&&r.status()===409);
    await confirm.click();await stale;await staged.getByText(/已保留勾选|selection is kept/i).waitFor();
    assert.match(await staged.locator("blockquote").innerText(),/Other device updated the end/);
    assert.equal(await staged.locator('input[type="checkbox"]:checked').count(),2);assert.equal((await list()).length,3);
    await personal.verify(personal.baseline);
    assert.ok(await staged.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await staged.getByRole("button",{name:/更改对话|Change conversation/}).evaluate(el=>{
      const r=document.createRange();r.selectNodeContents(el);
      return r.getClientRects().length===1&&el.getBoundingClientRect().height>=44;
    }),"Destination action must stay readable on one line with a 44px target");
    await staged.screenshot({path:path.join(dir,"excerpt-tail-changed.png")});
    await require("./append-queue-recovery.cjs").confirmChosenAndReopen({staged,origin,cid,iid,target,confirm,report,mark});
    const rows=await list();assert.equal(rows.length,5);assert.deepEqual(rows.slice(0,2).map(x=>x.id),created.messages.map(x=>x.id));
    mark("excerpt-preserved-target-data");await personal.verify(personal.baseline);
    assert.ok(rows.slice(-2).every(x=>x.role==="assistant"&&x.standalone_answer===true));
    assert.match(rows.at(-1).current_version.display_text,/Formula/);assert.doesNotMatch(rows.map(x=>x.current_version.display_text).join("\n"),/A tidal observation|tide\.csv/);
    const opened=await api.get(origin+`/api/conversations/${cid}/reader-turn?anchor_message_id=${rows.at(-1).id}`);
    assert.deepEqual((await opened.json()).items.map(m=>m.id),[rows.at(-1).id]);
    mark("fixed-append-from-reader");
    await staged.getByRole("link",{name:/打开目标对话|Open destination conversation/}).click();
    const moreReader=staged.locator('[data-reader-more-actions="true"]:visible');
    await moreReader.waitFor();assert.equal(await moreReader.count(),1);await moreReader.click();
    mark("fixed-open-append-action");
    await staged.locator('[data-reader-header-action="append-import"]:visible').click();
    await staged.waitForURL(origin+`/conversations/${cid}/append`);
    await staged.locator('input[type="file"]').setInputFiles({name:"readings.md",mimeType:"text/markdown",
      buffer:Buffer.from("# Synthetic reading\n\n## User\nAppend local question.\n\n## Assistant\nAppend local response.\n\n## User\nNot locally selected.\n")});
    await staged.getByRole("button",{name:/解析并选择内容|Review file contents/}).click();
    mark("fixed-file-recognition");
    const needsMapping=staged.getByRole("button",{name:/核对来源格式|Review source format/});
    await needsMapping.or(staged.getByRole("checkbox",{name:/^2 · /})).first().waitFor();
    let mapped=false;
    if(await needsMapping.isVisible()){
      await needsMapping.click();
      assert.equal(await staged.getByTestId("commit-import-button").count(),0);
      await staged.getByRole("button",{name:/设置格式|Map format/i}).click();
      await staged.getByRole("button",{name:/验证映射|Validate mapping/i}).click();
      const save=staged.getByRole("button",{name:/保存映射并继续|Learn mapping & continue/i});
      await save.click();mapped=true;
    }
    mark("fixed-file-choose");
    await staged.getByRole("checkbox",{name:/^2 · /}).waitFor();
    assert.equal(await staged.getByRole("searchbox").count(),0);assert.equal(await staged.locator('input[type="checkbox"]:checked').count(),0);
    await staged.getByRole("checkbox",{name:/^2 · /}).check();await staged.getByRole("checkbox",{name:/^1 · /}).check();
    const webSelectionControls=await checkSelectionActions(staged);
    await staged.screenshot({path:path.join(dir,"append-fixed-target-actions.png")});
    await staged.getByRole("button",{name:/核对追加位置|Review append position/}).click();
    // Opening Reader earlier is a real navigation. Bracket the file commit
    // separately so an intentional reader action is not attributed to import.
    const beforeFileCommit=await personal.snapshot();
    const before=await require("./append-queue-recovery.cjs").exercise({staged,origin,cid,anchor:rows.at(-1).id,target,dir,report,mark,list,until});
    const done=await list();assert.deepEqual(done.slice(0,5).map(x=>x.id),rows.map(x=>x.id));
    assert.deepEqual(done.slice(0,6).map(x=>x.id),before.map(x=>x.id));
    assert.deepEqual(done.slice(6).map(x=>x.current_version.display_text.trim()),["Append local question.","Append local response."]);
    mark("file-preserved-target-data");await personal.verify(beforeFileCommit);
    assert.equal(done[7].standalone_answer,false);await staged.close();
    report.selectiveAppend={archive,resources,previewLabelsVerified:true,reviewWidth:narrow?375:beforeViewport?.width,selectionControls:{plugin:pluginSelectionControls,web:webSelectionControls},serverZeroBeforeConfirm:true,reconfirmedAfter409:true,selectedRetained:2,
      readerOriginalsUnchanged:true,preservedAfterConflictAndBothAppends:{oldMessageVersions:3,oldFileBytesAndOccurrence:1,
        highlights:1,readingPointBookmarks:1,referencedNotebookBlocks:2,readerPositionWithRevision:1},
      unrelatedAnswersHaveSeparateTurns:true,webTargetLocked:true,webCommitted:2,fileMappingConfirmed:mapped};
    steps.push("only selected source messages and image bytes reached Reader; independent owner session changed the tail, retained choices required a second explicit click; fixed-target web append preserved originals");
  }finally{ctx.off("request",count);if(narrow&&beforeViewport&&!chat.isClosed())await chat.setViewportSize(beforeViewport);}
};
