import { expect, type APIRequestContext, type Page, type Route, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Start *before* the first virtual message, not inside an already measured one.
// Offset alone is insufficient: releasing old turns may change the coordinate
// origin without changing the text under the reading line.
export async function verifyFastReader(mobile: boolean, page: Page, request: APIRequestContext, info: TestInfo) {
  const text = "逐段阅读定位。 Each canonical paragraph stays in its place while the next turn loads. ";
  const pair = (n: number) => [
    { role: "user", content_markdown: `Synthetic question ${n}` },
    { role: "assistant", content_markdown: Array.from({ length: n === 5 || n === 7 ? 28 : 5 }, (_, i) =>
      (n === 5 || n === 7) && i % 4 === 1 ? `$$\nf_{${i}}(x) = \\frac{x^2}{1+x}\n$$` : `Turn ${n} paragraph ${i}：${text.repeat(2)}`).join("\n\n") },
  ];
  const made = await request.post("/api/conversations", { data: { title: "Synthetic fast reading", messages: pair(0) } });
  expect(made.status()).toBe(201);
  const { conversation, messages } = await made.json();
  const ids: string[] = messages.map((m: { id: string }) => m.id);
  try {
    for (let n = 1; n < 11; n++) {
      const added = await request.post(`/api/conversations/${conversation.id}/messages/insert`, {
        data: { anchor_message_id: ids.at(-1), position: "after", mode: "pair", messages: pair(n) },
      });
      expect(added.ok()).toBe(true);
      ids.push(...(await added.json()).messages.map((m: { id: string }) => m.id));
    }
    await page.setViewportSize(mobile ? { width: 375, height: 780 } : { width: 1280, height: 820 });
    await page.goto(`/conversations/${conversation.id}`);
    const root = page.getByTestId("reader-scroll-root");
    await expect(root.locator("article[data-message-id]").first()).toBeVisible();
    await expect(root.locator("[data-virtualized-block-list]")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await root.evaluate((node, ids) => {
      const el = node as HTMLElement, ordinals = new Map(ids.map((id, i) => [id, i]));
      const record = { highest: -1, worstBacktrack: 0, virtual: false, lines: 0, topResets: 0 };
      const scroll = el.scrollTo.bind(el);
      // Forward the real method and observe the actual effect, not merely the
      // requested coordinate. Do not persist IDs, text or event payloads.
      el.scrollTo = ((...args: [ScrollToOptions] | [number, number]) => {
        const before = el.scrollTop;
        if (args.length === 1) scroll(args[0]); else scroll(args[0], args[1]);
        if (before > el.clientHeight && el.scrollTop === 0) record.topResets++;
      }) as HTMLElement["scrollTo"];
      let frame = 0;
      function sample() {
        const line = el.getBoundingClientRect().top + Math.min(150, el.clientHeight * .3);
        for (const a of el.querySelectorAll<HTMLElement>("article[data-message-id]")) {
          const rect = a.getBoundingClientRect();
          if (rect.top > line || rect.bottom < line) continue;
          const ordinal = ordinals.get(a.dataset.messageId!)!;
          record.worstBacktrack = Math.max(record.worstBacktrack, record.highest - ordinal);
          record.highest = Math.max(record.highest, ordinal); record.lines++; break;
        }
        record.virtual ||= !!el.querySelector("[data-virtualized-block-list]");
        frame = requestAnimationFrame(sample);
      }
      sample();
      Object.assign(el, { finishFastRead: () => { cancelAnimationFrame(frame); el.scrollTo = scroll; return record; } });
    }, ids);
    const box = (await root.boundingBox())!;
    const x = Math.round(box.x + box.width * .56), y = Math.round(box.y + box.height * .55);
    if (mobile) {
      const cdp = await page.context().newCDPSession(page);
      try {
        for (let i = 0; i < 15; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y + 145 }] });
          for (let k = 1; k <= 4; k++) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 145 - k * 79 }] });
            await page.waitForTimeout(12);
          }
          // No pause before release: exercise actual native fling/coasting.
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await page.waitForTimeout(115);
        }
      } finally { await cdp.detach(); }
    } else {
      await page.mouse.move(x, y);
      for (let i = 0; i < 38; i++) { await page.mouse.wheel(0, 440); await page.waitForTimeout(35); }
    }
    await page.waitForTimeout(1100);
    const result = await root.evaluate(el => (el as HTMLElement & { finishFastRead(): {
      highest: number; virtual: boolean; lines: number; topResets: number; worstBacktrack: number;
    } }).finishFastRead());
    await writeFile(info.outputPath("fast-read.json"), JSON.stringify({ mobile, ...result }));
    expect(result.virtual).toBe(true); expect(result.lines).toBeGreaterThan(12);
    expect(result.highest).toBeGreaterThanOrEqual(11);
    expect(result.topResets).toBe(0); expect(result.worstBacktrack).toBe(0);
  } finally {
    await page.goto("about:blank");
    expect((await request.delete(`/api/conversations/${conversation.id}`)).ok()).toBe(true);
  }
}

export async function verifyEarlyMovementBeatsLateRestore(mobile: boolean, page: Page, request: APIRequestContext, info: TestInfo) {
  const text = (n: number) => `Synthetic early reader paragraph ${n}. Stable position beats a later restoration.`;
  const made = await request.post("/api/conversations", { data: {
    title: "Synthetic early reader movement", messages: [
      { role: "user", content_markdown: "Synthetic early movement fixture" },
      { role: "assistant", content_markdown: Array.from({ length: 44 }, (_, index) => text(index)).join("\n\n") },
    ],
  } });
  expect(made.status()).toBe(201);
  const { conversation, messages } = await made.json();
  try {
    const path = `/conversations/${conversation.id}`, apiPath = `/api${path}/reading-position`;
    await page.setViewportSize(mobile ? { width: 375, height: 780 } : { width: 1280, height: 820 });
    expect((await request.patch(`/api${path}`, { data: { status: "archived" } })).ok()).toBe(true);
    await page.goto("/archived");
    const open = page.locator(`a[href="${path}"]:visible`).first();
    await open.click();
    const root = page.getByTestId("reader-scroll-root");
    await expect(root.locator("article[data-message-id]").first()).toBeVisible();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const savedBlock = root.locator(`#block-${messages[1].id}-35`);
    let restoredWithoutMovement = false;
    for (const move of [false, true]) {
      // A cold visit waits for the position before fetching turns. Warm the
      // actual query via a client-side visit; never wait through REST retries
      // and then mistake the error fallback for a late successful response.
      await page.goBack({ waitUntil: "commit" });
      await expect(page).toHaveURL(/\/archived$/);
      await expect(root).toBeHidden();
      const saved = await request.put(apiPath, { data: {
        message_id: messages[1].id, block_index: 35, scroll_offset: 0, anchor_data: {},
      } });
      expect(saved.ok()).toBe(true);
      let release!: () => void, received = false;
      const held = new Promise<void>(resolve => { release = resolve; });
      const handler = async (route: Route) => {
        if (route.request().method() !== "GET") return route.continue();
        const response = await route.fetch();
        received = true;
        await held;
        await route.fulfill({ response });
      };
      await page.route(`**${apiPath}`, handler);
      const cdp = mobile && move ? await page.context().newCDPSession(page) : null;
      try {
        await open.click();
        await expect(page).toHaveURL(url => url.pathname === path);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
        await expect.poll(() => received, { timeout: 3500 }).toBe(true);
        await expect(root.locator("article[data-message-id]").first()).toBeVisible({ timeout: 3500 });
        const initialTop = await root.evaluate(node => node.scrollTop);
        await expect(savedBlock).not.toBeInViewport({ timeout: 1500 });
        const box = (await root.boundingBox())!;
        const x = Math.round(box.x + box.width * .55), y = Math.round(box.y + box.height * .55);
        if (cdp) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y + 130 }] });
          for (let step = 1; step <= 4; step++) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 130 - step * 72 }] });
          }
          // Keep the finger still and down while the response lands. The
          // separate fast-reading test releases immediately to exercise flings.
        } else if (move) {
          await page.mouse.move(x, y); await page.mouse.wheel(0, 400);
        } else if (mobile) {
          await page.touchscreen.tap(x, y); // A tap isn't a request to scroll.
        }
        if (move) {
          await expect(root).toHaveAttribute("data-reader-intent-direction", "down", { timeout: 2000 });
          await expect.poll(() => root.evaluate(node => node.scrollTop), { timeout: 2000 }).toBeGreaterThan(initialTop + 80);
        }
        const afterUserMovement = await root.evaluate(node => node.scrollTop);
        const delivered = page.waitForResponse(r => new URL(r.url()).pathname === apiPath && r.request().method() === "GET",
          { timeout: 3500 });
        release();
        const response = await delivered;
        expect(response.ok()).toBe(true);
        expect((await response.json()).position).toMatchObject({ message_id: messages[1].id, block_index: 35 });
        if (!move) {
          await expect(savedBlock).toBeInViewport({ timeout: 5000 });
          restoredWithoutMovement = true;
        } else {
          const drift = await root.evaluate(async (el, before) => {
            let max = 0, frames = 0;
            const start = performance.now();
            do {
              await new Promise<void>(r => requestAnimationFrame(() => r()));
              max = Math.max(max, Math.abs(el.scrollTop - before)); frames++;
            } while (performance.now() - start < 1000 || frames < 15);
            return { max, frames, afterLateRestore: el.scrollTop };
          }, afterUserMovement);
          await writeFile(info.outputPath("early-movement.json"), JSON.stringify({
            mobile, initialTop, afterUserMovement, ...drift, restoredWithoutMovement,
            staleRestoreRejected: drift.max <= 2,
          }));
          expect(drift.max).toBeLessThanOrEqual(2);
          await expect(savedBlock).not.toBeInViewport();
        }
      } finally {
        release();
        if (cdp) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await cdp.detach();
        }
        await page.unroute(`**${apiPath}`, handler);
      }
    }
  } finally {
    await page.goto("about:blank");
    expect((await request.delete(`/api/conversations/${conversation.id}`)).ok()).toBe(true);
  }
}

export async function verifyReaderFind(mobile: boolean, page: Page, request: APIRequestContext, info: TestInfo) {
  const query = "向下滑", phrase = (n: number) => `段落 ${n}：快速向下滑动时，能找到正文里的这一处。`;
  const made = await request.post("/api/conversations", { data: { title: "Synthetic archive find", messages: [
    { role: "user", content_markdown: "从这里开始：" + phrase(0) },
    { role: "assistant", content_markdown: [
      ...Array.from({ length: 56 }, (_, i) => phrase(i + 1)),
      ...Array.from({ length: 130 }, (_, i) => `Unmatched synthetic paragraph ${i}.`),
    ].join("\n\n") },
  ] } });
  expect(made.status()).toBe(201);
  const { conversation, messages } = await made.json();
  try {
    expect((await request.patch(`/api/conversations/${conversation.id}`, { data: { status: "archived" } })).ok()).toBe(true);
    await page.setViewportSize(mobile ? { width: 375, height: 780 } : { width: 1280, height: 820 });
    await page.goto(`/conversations/${conversation.id}`);
    const root = page.getByTestId("reader-scroll-root");
    await expect(root.locator("article").first()).toBeVisible();
    if (mobile) await page.getByTestId("mobile-reader-header").getByRole("button", { name: /^搜索$|^Search$/ }).click();
    else await page.keyboard.press("Control+f");
    const input = page.getByRole("textbox", { name: /^(搜索当前对话|Search this conversation)$/ });
    await expect(input).toBeFocused();
    await input.fill(query);
    if (mobile) await page.getByRole("button", { name: /^(结果|Results)$/ }).click();
    const rows = page.locator("[data-find-index]");
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText("从这里开始");
    if (!mobile) await page.mouse.move(1, 1);
    const startOffset = await root.evaluate(el => el.scrollTop);
    for (let i = 0; i < 50; i++) await input.press("ArrowDown");
    const active = page.locator('[data-find-index][aria-current="true"]');
    await expect(active).toHaveAttribute("data-find-index", "50");
    await expect(active).toBeInViewport({ ratio: .8 });
    await expect(input).toBeFocused();
    expect(await root.evaluate(el => el.scrollTop)).toBe(startOffset);
    await page.screenshot({ path: info.outputPath("find-results.png") });
    await input.press("Enter");
    const status = mobile ? page.getByTestId("conversation-find") : page.getByRole("status").filter({ hasText: query }).filter({ hasText: "51 / 57" });
    if (mobile) { await expect(status).toContainText("51 / 57"); await expect(rows.first()).toBeHidden(); await expect(input).not.toBeFocused(); }
    await expect(status).toBeVisible();
    const block = root.locator(`#block-${messages[1].id}-49`);
    await expect(block).toBeInViewport();
    const highlightedText = () => block.evaluate(node => {
      const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
      const range = Array.from(registry.get("chat-reader-search-match") ?? [])[0];
      return range && node.contains(range.startContainer) ? range.toString() : null;
    });
    await expect.poll(highlightedText).toBe(query);
    await page.screenshot({ path: info.outputPath("find-while-reading.png") });
    // A recycled row is a different DOM node. Returning to it by scrolling,
    // without another search/navigation, must restore its highlight without
    // scrolling the reader on the user's behalf.
    const position = await root.evaluate(node => node.scrollTop);
    await root.hover();
    if (mobile) {
      const box = (await root.boundingBox())!;
      const x = Math.round(box.x + box.width * 0.55), y = Math.round(box.y + box.height * 0.55);
      const cdp = await page.context().newCDPSession(page);
      try {
        for (let burst = 0; burst < 9; burst++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y + 135 }] });
          for (let step = 1; step <= 4; step++) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 135 - step * 82 }] });
            await page.waitForTimeout(12);
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await page.waitForTimeout(105);
        }
      } finally { await cdp.detach(); }
    } else {
      const box = (await root.boundingBox())!;
      await page.mouse.move(Math.round(box.x + box.width * 0.55), Math.round(box.y + box.height * 0.55));
      for (let burst = 0; burst < 15; burst++) { await page.mouse.wheel(0, 480); await page.waitForTimeout(18); }
    }
    const away = await root.evaluate(node => ({
      scrollTop: node.scrollTop,
      virtualRows: node.querySelectorAll("[data-virtualized-block-list]").length,
    }));
    const targetMounted = await block.count() !== 0;
    await writeFile(info.outputPath("find-remount.json"), JSON.stringify({ mobile, ...away, targetMounted }));
    await expect(block).toHaveCount(0);
    await root.evaluate((node, top) => node.scrollTo({ top }), position);
    await expect(block).toBeInViewport();
    await expect.poll(highlightedText).toBe(query);
    // On mobile a real downward finger move reveals the auto-hidden toolbar.
    const revealMobileToolbar = async () => {
      const box = (await root.boundingBox())!;
      const x = Math.round(box.x + box.width * 0.55), y = Math.round(box.y + box.height * 0.48);
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 48 }] });
        await page.waitForTimeout(50);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } finally { await cdp.detach(); }
      await expect(page.getByTestId("mobile-reader-header")).toBeInViewport();
    };
    if (mobile) await revealMobileToolbar();
    const nextButton = status.getByRole("button", { name: /下一个匹配|Next match/ });
    await expect(nextButton).toBeInViewport();
    await nextButton.click();
    const next = mobile ? status : page.getByRole("status").filter({ hasText: query }).filter({ hasText: "52 / 57" });
    await expect(next).toContainText("52 / 57");
    await expect(next).toBeVisible();
    if (mobile) await revealMobileToolbar();
    if (mobile) await next.getByRole("button", { name: /^(结果|Results)$/ }).click();
    else await next.getByRole("button", { name: /返回搜索|Return to search/ }).click();
    await expect(input).toHaveValue(query);
    await expect(active).toHaveAttribute("data-find-index", "51");
    await expect(active).toBeInViewport({ ratio: .8 });
    await writeFile(info.outputPath("find-navigation.json"), JSON.stringify({
      mobile, rowsAtStart: 50, chosenNumber: 51, resumedNumber: Number(await active.getAttribute("data-find-index")) + 1,
      virtualRowRemountHighlight: true,
    }));
  } finally {
    await page.goto("about:blank");
    expect((await request.delete(`/api/conversations/${conversation.id}`)).ok()).toBe(true);
  }
}
