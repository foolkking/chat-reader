import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { syntheticImage } from "./synthetic-image";

type Kind = "text" | "image" | "long-image" | "math" | "mixed" | "turns";
type Phase = { direction: number; travelled: number; reverse: number; worst: number; blank: number;
  comparisons: number; corrections: number; maxCorrection: number; unmeasuredGap: number; newArticles: number;
  edge: boolean; image: boolean; math: boolean; invisibleTextFrames: number; textFrames: number; textWorst: number;
  frames: { time: number; scroll: number; writer: string; text: string; top: number | null }[] };

// Measure the movement of *the same canonical block* across adjacent paints.
// scrollTop alone cannot detect a prepend jumping the visible text, and it can
// change legitimately when an image above the reading line obtains its height.
export async function startTrace(page: Page, direction: number) {
  await page.getByTestId("reader-scroll-root").evaluate((el, direction) => {
    const root = el as HTMLElement;
    const out: Phase = { direction, travelled: 0, reverse: 0, worst: 0, blank: 0, comparisons: 0,
      corrections: 0, maxCorrection: 0, unmeasuredGap: 0, newArticles: 0, edge: false, image: false, math: false,
      invisibleTextFrames: 0, textFrames: 0, textWorst: 0, frames: [] };
    const articles = new Set(Array.from(root.querySelectorAll("article[data-message-id]"), el => el.id));
    let frame = 0, previous = new Map<string, number>(), prior = 0;
    let witness: { range: Range; node: Node; offset: number; top: number } | null = null;
    const correction = (event: Event) => {
      out.corrections++; out.maxCorrection = Math.max(out.maxCorrection, Math.abs((event as CustomEvent).detail.applied));
    };
    const sample = () => {
      const rect = root.getBoundingClientRect(), line = rect.top + Math.min(180, rect.height * .35);
      const current = new Map<string, number>();
      for (const list of root.querySelectorAll("[data-virtualized-block-list]")) {
        let last: { index: number; bottom: number } | null = null;
        for (const row of list.querySelectorAll<HTMLElement>("[data-reader-virtual-slot] > [data-index]")) {
          const index = Number(row.dataset.index), r = row.getBoundingClientRect();
          if (last && index === last.index + 1) out.unmeasuredGap = Math.max(out.unmeasuredGap, r.top - last.bottom);
          last = { index, bottom: r.bottom };
        }
      }
      for (const b of root.querySelectorAll<HTMLElement>("article [data-block-index][id]")) {
        const r = b.getBoundingClientRect();
        if (r.height && r.width && r.bottom > rect.top - 128 && r.top < rect.bottom + 128) current.set(b.id, r.top);
        if (r.bottom > rect.top && r.top < rect.bottom) {
          if (!out.image && b.querySelector("img.attachment-gallery-image")) out.image = true;
          if (!out.math && b.querySelector(".katex")) out.math = true;
        }
      }
      const common = Array.from(previous).filter(([id]) => current.has(id))
        .sort((a,b) => Math.abs(a[1] - line) - Math.abs(b[1] - line))[0];
      if (witness?.node.isConnected && witness.range.startContainer === witness.node
        && witness.range.startOffset === witness.offset) {
        const bounds = witness.range.getBoundingClientRect();
        if (bounds.height > 0) {
          out.textFrames++;
          out.textWorst = Math.max(out.textWorst, (bounds.top - witness.top) * direction);
        }
      }
      witness = null;
      const nearest = Array.from(current).sort((a,b) => Math.abs(a[1] - line) - Math.abs(b[1] - line))[0];
      const block = nearest ? document.getElementById(nearest[0]) : null;
      if (block) {
        const bounds = block.getBoundingClientRect();
        const caret = (document as Document & { caretRangeFromPoint(x: number, y: number): Range | null })
          .caretRangeFromPoint(bounds.left + Math.min(24, bounds.width / 2), Math.max(bounds.top + 2, Math.min(line, bounds.bottom - 2)));
        if (caret?.startContainer.nodeType === Node.TEXT_NODE && block.contains(caret.startContainer)
          && caret.startContainer.textContent?.length) {
          const node = caret.startContainer, offset = Math.min(caret.startOffset, node.textContent!.length - 1);
          caret.setStart(node, offset); caret.setEnd(node, offset + 1);
          const r = caret.getBoundingClientRect();
          if (r.height > 0) {
            witness = { range: caret, node, offset, top: r.top };
            if (!node.parentElement?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) out.invisibleTextFrames++;
          }
        }
      }
      if (out.frames.length < 600) out.frames.push({ time: performance.now(), scroll: root.scrollTop,
        writer: root.dataset.readerLastScrollWriter ?? "none", top: witness?.top ?? null,
        text: witness?.node.textContent?.slice(witness.offset, witness.offset + 48) ?? "" });
      if (common) {
        const distance = (common[1] - current.get(common[0])!) * direction;
        out.travelled += distance; out.reverse += Math.max(0, -distance);
        out.worst = Math.max(out.worst, -distance); out.comparisons++;
      } else if (prior && (!current.size || previous.size)) out.blank++;
      for (const a of root.querySelectorAll("article[data-message-id]")) {
        if (!articles.has(a.id)) { articles.add(a.id); out.newArticles++; }
      }
      if (/^(previous|next):settled$/.test(root.dataset.readerEdgeStage ?? "")) out.edge = true;
      previous = current; prior++; frame = requestAnimationFrame(sample);
    };
    root.addEventListener("chat-reader:geometry-correction", correction);
    sample();
    Object.assign(window, { finishMediaTrace: () => {
      cancelAnimationFrame(frame); root.removeEventListener("chat-reader:geometry-correction", correction); return out;
    } });
  }, direction);
}

export async function finish(page: Page): Promise<Phase> {
  return page.evaluate(() => (window as unknown as { finishMediaTrace: () => Phase }).finishMediaTrace());
}

async function attachImage(request: APIRequestContext, id: string, long = false) {
  const s = await request.post(`/api/conversations/${id}/attachment-upload-sessions`, {data:{}});
  expect(s.status()).toBe(201);
  const item = await request.post(`/api/attachment-upload-sessions/${(await s.json()).id}/items`, {
    multipart:{ file:{name:long ? "long-passage.png" : "passage.png",mimeType:"image/png",
      buffer:syntheticImage(long ? 240 : 680, long ? 4000 : 940)} },
  });
  expect(item.status()).toBe(201);
  const finalized = await request.post(`/api/conversations/${id}/attachments`, {data:{upload_item_ids:[(await item.json()).id]}});
  expect(finalized.status()).toBe(201);
  return (await finalized.json()).items[0].id as string;
}

export async function verifyMediaPassage(kind: Kind, mobile: boolean, page: Page, request: APIRequestContext, info: TestInfo) {
  const pair = (i:number) => [
    {role:"user",content_markdown:`Question ${i}`},{role:"assistant",content_markdown:`Answer ${i}.\n\nA second line.\n\nA third line.`},
  ];
  const create = await request.post("/api/conversations", {data:{title:"Synthetic repeated reading passage", messages:pair(0)}});
  expect(create.status()).toBe(201);
  const made = await create.json(), id = made.conversation.id;
  let message = made.messages[1];
  const rows: Phase[] = [];
  try {
    if (kind === "turns") {
      let tail = message.id;
      for (let i = 1; i < 16; i++) {
        const added = await request.post(`/api/conversations/${id}/messages/insert`, {data:{anchor_message_id:tail, position:"after",mode:"pair",messages:pair(i)}});
        expect(added.ok()).toBe(true);
        const last = (await added.json()).messages[1]; tail = last.id;
        if (i === 8) message = last;
      }
    }
    await page.setViewportSize(mobile?{width:375,height:760}:{width:1280,height:820});
    const needsImage = kind==="mixed" || kind==="image" || kind==="long-image";
    const needsMath = kind==="mixed" || kind==="math" || kind==="turns";
    const asset = needsImage ? await attachImage(request,id,kind==="long-image") : "";
    const para = (i:number) => `Paragraph ${i}. ${"Reading a real line of text in both directions. ".repeat(4)}`;
    const math = (i:number) => `$$\n\\begin{aligned} f_{${i}}(x)&=\\frac{1}{1+x^2}\\\\ g(x)&=\\sum_{j=1}^{n}\\frac{j}{n+1}\\end{aligned}\n$$`;
    const source = Array.from({length:kind==="turns"?6:kind==="image"?13:kind==="long-image"?196:45},(_,i)=> {
      if(needsImage && i%8===3) return `![Synthetic illustration](cr-asset://${asset})`;
      if(needsMath && i%4===1) return math(i);
      return para(i);
    }).join("\n\n");
    const edit = await request.patch(`/api/messages/${message.id}`,{data:{base_version_id:message.current_version.id,content_markdown:source}});
    expect(edit.ok()).toBe(true);
    let images = 0;
    if(needsImage) await page.route(/\/api\/.*attachments\/[^/]+\/content(?:\?|$)/,async route=>{
      images++; await new Promise(r=>setTimeout(r,450)); await route.continue();
    });
    // Start in the middle, not on a page boundary. For the edge fixture start
    // in its middle turn; only native input is used after explicit navigation.
    const index=kind==="turns"?1:kind==="image"?6:kind==="long-image"?99:20;
    await page.addInitScript(({id,index})=>{
      const points: number[][] = [];
      const end=performance.now()+9000;
      let last:Element|null=null;
      const sample=()=>{
        const root=document.querySelector<HTMLElement>("[data-testid=reader-scroll-root]");
        const target=document.getElementById(`block-${id}-${index}`);
        if(root && points.length<600) {
          const list=target?.closest("[data-virtualized-block-list]"),r=target?.getBoundingClientRect(),rr=root.getBoundingClientRect();
          points.push([Math.round(performance.now()), Math.round(root.scrollTop), root.scrollHeight,
            r?Math.round(r.top-rr.top):-9999, r?Math.round(r.height):-1, +(last!==target),list?.querySelectorAll("[data-index]").length??0]);
        }
        last=target;
        if(performance.now()<end && !root?.dataset.navigationStage?.startsWith("settled")) requestAnimationFrame(sample);
      };
      Object.assign(window,{navigationSamples:points});requestAnimationFrame(sample);
    },{id:message.id,index});
    await page.goto(`/conversations/${id}?messageId=${message.id}&blockIndex=${index}`);
    const root=page.getByTestId("reader-scroll-root");
    try { await expect(root).toHaveAttribute("data-navigation-stage","settled"); }
    catch(error) {
      const points=await page.evaluate(()=>(window as unknown as {navigationSamples:number[][]}).navigationSamples);
      await writeFile(info.outputPath("navigation-geometry.json"),JSON.stringify(points));throw error;
    }
    await expect(root).toHaveAttribute("data-reader-geometry-owner","viewport");
    if (kind==="long-image" || kind==="mixed" || kind==="math") await expect(root.locator("[data-virtualized-block-list=true]")).toHaveCount(1);
    if (kind==="long-image") {
      const attachment = root.locator(`#block-${message.id}-${index} [data-testid="attachment-block"][data-attachment-mode="media"]`);
      await expect(attachment).toHaveCount(1);
      await expect(attachment).toHaveAttribute("data-image-expanded","false");
      await expect(attachment.getByRole("button",{name:"Expand full image",exact:true})).toBeVisible();
      const image = attachment.locator("img.attachment-gallery-image");
      await expect(image).toHaveAttribute("width","240");
      await expect(image).toHaveAttribute("height","4000");
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalHeight)).toBe(4000);
    }
    await page.evaluate(()=>document.fonts.ready.then(()=>true));
    const b=await root.boundingBox(); expect(b).toBeTruthy();
    const x=Math.floor(b!.x+b!.width*.49),y=Math.floor(b!.y+b!.height*.49);
    await page.mouse.move(x,y);
    const cdp = mobile ? await page.context().newCDPSession(page) : null;
    if(cdp) await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:2});
    try {
      for(const direction of [-1,1,-1,1]){
        await startTrace(page,direction);
        if(cdp) {
          for(let stroke=0;stroke<(kind==="turns"?6:1);stroke++){
            const initial=y+direction*110;
            await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y:initial}]});
            for(let i=1;i<=12;i++) {
              await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:initial-direction*18*i}]});
              await page.waitForTimeout(30);
            }
            // End without adding an uncontrolled fling to the opposite pass.
            await page.waitForTimeout(150); await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
          }
        } else {
          const n=kind==="turns"?32:16;
          for(let i=0;i<n;i++) { await page.mouse.wheel(0,direction*36); await page.waitForTimeout(34); }
        }
        await page.waitForTimeout(320); rows.push(await finish(page));
      }
    } finally { await cdp?.detach(); }
    const scalars = {kind,mobile,images,phases:rows};
    const filename=info.outputPath("media-passage.json");
    await writeFile(filename,JSON.stringify(scalars,null,2)); await info.attach("media-passage",{path:filename,contentType:"application/json"});
    expect(rows.every(r=>r.comparisons>8)).toBe(true);
    expect(rows.filter(r=>r.image).length>0 || !needsImage).toBe(true);
    expect(rows.filter(r=>r.math).length>0 || !needsMath).toBe(true);
    if(needsImage) expect(images).toBeGreaterThan(0);
    if(kind==="turns") { expect(rows.some(r=>r.edge)).toBe(true); expect(rows.some(r=>r.newArticles>0)).toBe(true); }
    for(const r of rows) {
      expect(r.blank,"visible blocks disappeared between slow input frames").toBe(0);
      expect(r.invisibleTextFrames, "a real text witness became visually hidden").toBe(0);
      expect(r.textWorst, "the same text character moved against the gesture").toBeLessThanOrEqual(2);
      expect(r.worst,"visible text jumped against the gesture in one frame").toBeLessThanOrEqual(2);
      expect(r.reverse,"visible text repeatedly pulled back").toBeLessThanOrEqual(4);
      expect(r.unmeasuredGap,"mounted row pitches must equal the cached border boxes").toBeLessThanOrEqual(.5);
      expect(r.travelled,"small gestures did not carry the text through the passage").toBeGreaterThan(mobile?130:320);
    }
  } finally {
    await page.goto("about:blank");
    expect((await request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
  }
}
