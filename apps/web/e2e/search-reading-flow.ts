import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { startTrace, finish } from "./reader-media-motion";

// Real API, canonical render, browser navigation and share authorization.
// No source text, credentials or share URLs are written into evidence.
export async function verifySharedFind(width: number, page: Page, request: APIRequestContext, info: TestInfo) {
  const made = await request.post("/api/conversations", { data: { title: "Synthetic shared find", messages: [
    { role: "user", content_markdown: "A private unshared-needle." },
    { role: "assistant", content_markdown: Array.from({ length: 112 }, (_, i) => `Passage ${i}: 潮汐 arrives in the middle of this sentence.`).join("\n\n") },
  ] } });
  expect(made.status()).toBe(201);
  const { conversation, messages } = await made.json();
  const shareResponse = await request.post(`/api/conversations/${conversation.id}/shares`, {
    data: { scope: "selected_messages", selected_message_ids: [messages[1].id], content_mode: "frozen" },
  });
  expect(shareResponse.ok()).toBe(true);
  const share = await shareResponse.json();
  try {
    await page.setViewportSize({ width, height: 860 });
    const privateQueries: string[] = [];
    page.on("request", req => { if (new URL(req.url()).pathname === "/api/search") privateQueries.push(req.method()); });
    await page.goto(`/share/${share.token}`);
    await page.locator("[data-shared-find-trigger]").click();
    const panel = page.getByTestId("conversation-find");
    const input = panel.getByRole("textbox");
    await expect(input).toBeFocused();
    const originalY = await page.evaluate(() => window.scrollY);
    await input.dispatchEvent("compositionstart");
    await input.fill("潮");
    await page.waitForTimeout(300);
    expect(await panel.locator("[data-find-index]").count()).toBe(0);
    await input.fill("潮汐");
    await input.dispatchEvent("compositionend");
    await expect(panel.getByRole("status").first()).toContainText("100+");
    expect(await page.evaluate(() => window.scrollY)).toBe(originalY);
    if (width < 768) {
      await expect(panel.locator("[data-find-index]").first()).toBeHidden();
      await panel.getByRole("button", { name: /^(结果|Results)$/ }).click();
    }
    await expect(panel.locator("[data-find-index]")).toHaveCount(50);
    await panel.getByRole("button", { name: /^(下一组匹配|More matches)$/ }).click();
    await expect(panel.locator("[data-find-index]").first()).toHaveAttribute("data-find-index", "50");
    await panel.getByRole("button", { name: /^(加载更多结果|Load more results)$/ }).click();
    const target = panel.locator('[data-find-index="100"]');
    await expect(target).toBeVisible();
    await target.click();
    const block = page.locator(`#block-${messages[1].id}-100`);
    await expect(block).toBeInViewport();
    await expect.poll(() => block.evaluate(node => {
      const highlights = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
      return Array.from(highlights.get("chat-reader-search-match") ?? []).some(range => node.contains(range.startContainer) && range.toString() === "潮汐");
    })).toBe(true);
    if (width >= 768) await page.locator("[data-shared-find-trigger]").click();
    await input.fill("unshared-needle");
    await expect(panel.getByRole("status").first()).toContainText("0 / 0");
    expect(privateQueries).toEqual([]);
    await input.fill("潮汐");
    await expect(panel.getByRole("status").first()).toContainText("100+");
    if (width < 768) {
      await panel.getByRole("button", { name: /^(结果|Results)$/ }).click();
    }
    await panel.getByRole("button", { name: /^(下一组匹配|More matches)$/ }).click();
    await page.screenshot({ path: info.outputPath(`shared-find-${width}.png`) });
    expect((await request.post(`/api/shares/${share.id}/revoke`)).ok()).toBe(true);
    await panel.getByRole("button", { name: /^(加载更多结果|Load more results)$/ }).click();
    await expect(panel.getByText(/Search unavailable|搜索暂不可用/)).toBeVisible();
    await expect(panel.locator("[data-find-index]")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^(下一个匹配|Next match)$/ })).toHaveCount(width < 768 ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await page.goto("about:blank");
    expect((await request.delete(`/api/conversations/${conversation.id}`)).ok()).toBe(true);
  }
}

export async function verifyGlobalSearchReturn(page: Page, request: APIRequestContext, info: TestInfo) {
  const ids: string[] = [];
  const q = `SyntheticReturn${Date.now()}`;
  try {
    for (let i = 0; i < 52; i++) {
      const created = await request.post("/api/conversations", { data: { title: `${q} ${i}`, messages: [
        { role: "user", content_markdown: `${q} first relevant passage.` },
        { role: "assistant", content_markdown: `${q} second relevant passage.\n\nA stable reader paragraph.` },
      ] } });
      expect(created.status()).toBe(201); ids.push((await created.json()).conversation.id);
    }
    await page.setViewportSize({ width: 800, height: 850 });
    await page.goto(`/search?q=${q}&status_scope=all`);
    const scroll = page.getByTestId("search-scroll-root");
    await expect(scroll.getByRole("button", { name: /Remove filter:.*including archived|移除筛选:.*含归档/ })).toBeVisible();
    await expect(scroll.getByRole("button", { name: /归档已选对话|Archive selected/ })).toHaveCount(0);
    await expect(scroll.locator("[data-search-index]")).toHaveCount(50);
    await scroll.getByRole("button", { name: /^(加载更多|Load more)$/ }).click();
    await expect(scroll.locator("[data-search-index]")).toHaveCount(52);
    const disclosure = scroll.getByRole("button", { name: /另有 .*条命中|more hits$/ }).last();
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const last = scroll.locator('[data-search-index="51"]');
    await last.scrollIntoViewIfNeeded();
    const position = await scroll.evaluate(node => node.scrollTop);
    await page.screenshot({ path: info.outputPath("global-expanded-800.png") });
    await last.click();
    await expect(page.getByTestId("reader-scroll-root")).toBeVisible();
    await page.goBack();
    await expect(scroll.locator("[data-search-index]")).toHaveCount(52);
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => scroll.evaluate((node, top) => Math.abs(node.scrollTop - top), position)).toBeLessThanOrEqual(1);
    await expect(scroll.getByRole("textbox", { name: /^(Search|搜索)$/ })).toHaveValue(q);
    for (const locale of ["en-US", "zh-CN"]) {
      expect((await request.patch("/api/preferences", { data: { locale_mode: locale, theme_mode: locale === "en-US" ? "dark" : "light" } })).ok()).toBe(true);
      await page.reload();
      await expect(scroll.locator("[data-search-index]")).toHaveCount(50);
      for (const width of [320, 375, 800, 1440]) {
        await page.setViewportSize({ width, height: 850 });
        await scroll.evaluate(node => { node.scrollTop = 0; });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`global-find-${width}-${locale}.png`) });
      }
      const sidebar = page.locator("[data-reader-primary-sidebar]:visible");
      const sidebarInput = sidebar.getByTestId("sidebar-global-search");
      await sidebarInput.fill(q);
      const menu = sidebar.locator("[data-sidebar-search-row] > div");
      await expect(menu.getByRole("button")).toHaveCount(9);
      for (const width of [224, 288, 448]) {
        const handle = sidebar.getByRole("separator", { name: "Resize sidebar", exact: true });
        const box = (await handle.boundingBox())!, current = (await sidebar.boundingBox())!.width;
        await page.mouse.move(box.x + box.width / 2, box.y + 25);
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + width - current, box.y + 25, { steps: 5 }); await page.mouse.up();
        await expect.poll(() => sidebar.evaluate(node => node.getBoundingClientRect().width)).toBe(width);
        const bounds = (await menu.boundingBox())!, side = (await sidebar.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(side.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(side.x + side.width);
        await sidebarInput.focus();
        for (let i = 0; i < 8; i++) await sidebarInput.press("ArrowDown");
        await expect(menu.locator('[aria-current="true"]')).toBeInViewport();
        await page.screenshot({ path: info.outputPath(`sidebar-find-${width}-${locale}.png`) });
      }
      await sidebarInput.fill("");
    }
  } finally {
    await page.goto("about:blank");
    expect((await request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "dark" } })).ok()).toBe(true);
    for (const id of ids) expect((await request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
  }
}

export async function verifyDelayedMessageRefresh(page: Page, request: APIRequestContext, info: TestInfo) {
  const content = Array.from({ length: 65 }, (_, i) => i === 25
    ? "- [ ] Synthetic pending task"
    : `Paragraph ${i}. ${"The same visible text must follow a small gesture, never a late callback. ".repeat(3)}`).join("\n\n");
  const made = await request.post("/api/conversations", { data: { title: "Synthetic delayed refresh", messages: [
    { role: "user", content_markdown: "Stable question" }, { role: "assistant", content_markdown: content },
  ] } });
  expect(made.status()).toBe(201);
  const { conversation, messages } = await made.json();
  let release = () => {};
  try {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto(`/conversations/${conversation.id}?messageId=${messages[1].id}&blockIndex=25`);
    const root = page.getByTestId("reader-scroll-root");
    await expect(root).toHaveAttribute("data-navigation-stage", "settled");
    const evidence = [];
    for (const direction of [-1, 1, -1]) {
      const check = root.getByRole("checkbox");
      await check.scrollIntoViewIfNeeded();
      let held = false;
      const ready = new Promise<void>(resolve => { release = resolve; });
      const pattern = "**/tasks/*/toggle";
      await page.route(pattern, async route => {
        const response = await route.fetch();
        held = true;
        await ready;
        await route.fulfill({ response });
      });
      await check.click();
      await expect.poll(() => held).toBe(true);
      const box = (await root.boundingBox())!;
      await page.mouse.move(box.x + box.width * .6, box.y + box.height * .6);
      await startTrace(page, direction);
      for (let step = 0; step < 12; step++) {
        await page.mouse.wheel(0, direction * 28);
        if (step === 3) release();
        await page.waitForTimeout(34);
      }
      await page.waitForTimeout(160);
      const phase = await finish(page);
      evidence.push(phase);
      expect(phase.blank).toBe(0);
      expect(phase.worst).toBeLessThanOrEqual(2);
      expect(phase.travelled).toBeGreaterThan(180);
      await page.unroute(pattern);
    }
    await writeFile(info.outputPath("delayed-message-refresh.json"), JSON.stringify(evidence));
  } finally {
    release();
    await page.goto("about:blank");
    expect((await request.delete(`/api/conversations/${conversation.id}`)).ok()).toBe(true);
  }
}
