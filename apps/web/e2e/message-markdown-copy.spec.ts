import { expect, test, type APIRequestContext } from "@playwright/test";

test.skip(process.env.E2E_MESSAGE_MARKDOWN_COPY !== "1", "Requires an explicitly isolated API/store");
test.use({ serviceWorkers: "block" });

async function upload(request: APIRequestContext, conversationId: string, name: string, mimeType: string, buffer: Buffer) {
  const session = await request.post(`/api/conversations/${conversationId}/attachment-upload-sessions`, { data: {} });
  expect(session.status()).toBe(201);
  const item = await request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, {
    multipart: { file: { name, mimeType, buffer } },
  });
  expect(item.status()).toBe(201);
  const finalized = await request.post(`/api/conversations/${conversationId}/attachments`, {
    data: { upload_item_ids: [(await item.json()).id] },
  });
  expect(finalized.status()).toBe(201);
  return (await finalized.json()).items[0] as { id: string };
}

for (const width of [1440, 375]) test(`${width}px copies whole message Markdown with public PNG preview and deletion revocation`, async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width, height: 900 });
  // Deterministic Clipboard API adapter; the rest is real Next/Reader/API/PG.
  await page.addInitScript(() => {
    Object.defineProperty(window, "__messageCopyValues", { value: [] });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => {
        const state = window as unknown as { __messageCopyValues: string[]; __denyMessageCopy?: boolean };
        if (state.__denyMessageCopy) throw new Error("Synthetic clipboard rejection");
        state.__messageCopyValues.push(value);
      },
    } });
  });
  const headers = { Origin: baseURL! };
  const create = await page.request.post("/api/conversations", { headers, data: {
    title: "Synthetic single-message copy",
    messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: "Synthetic answer" }],
  } });
  expect(create.status()).toBe(201);
  const made = await create.json() as { conversation: { id: string }; messages: Array<{ id: string; current_version: { id: string } }> };
  const conversationId = made.conversation.id, message = made.messages[1];
  const guest = await browser.newContext();
  let shareId: string | undefined;
  try {
    const svg = await upload(page.request, conversationId, "synthetic.svg", "image/svg+xml",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="green"/></svg>'));
    const file = await upload(page.request, conversationId, "synthetic.txt", "text/plain", Buffer.from("Synthetic non-image attachment"));
    const text = `# Complete source\n\n![Synthetic vector](cr-asset://${svg.id})\n\n[file](cr-asset://${file.id})\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**Final canonical tail**`;
    const edit = await page.request.patch(`/api/messages/${message.id}`, { headers, data: {
      base_version_id: message.current_version.id, content_markdown: text,
    } });
    expect(edit.ok()).toBe(true);
    await page.goto(`/conversations/${conversationId}`);
    const article = page.locator(`article[data-message-id="${message.id}"]`);
    await expect(article).toBeVisible();
    const activate = async () => {
      if (width < 640) await article.getByTestId("mobile-message-actions-trigger").click();
      else await article.hover();
      await article.getByTestId("message-markdown-copy").filter({ visible: true }).click();
    };
    await activate();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __messageCopyValues: string[] }).__messageCopyValues.length)).toBe(1);
    const copied = await page.evaluate(() => (window as unknown as { __messageCopyValues: string[] }).__messageCopyValues[0]);
    expect(copied).toMatch(/^# Complete source/);
    expect(copied).toMatch(/\*\*Final canonical tail\*\*$/);
    expect(copied).toContain("| 1 | 2 |");
    expect(copied).not.toContain("cr-asset://");
    expect(copied).not.toContain("[file]");
    const url = /!\[Synthetic vector\]\((https?:\/\/[^)]+)\)/.exec(copied)?.[1];
    expect(url).toBeTruthy();
    const publicImage = await guest.request.get(url!);
    expect(publicImage.status()).toBe(200);
    expect(publicImage.headers()["content-type"]).toBe("image/png");
    expect(publicImage.headers()["cache-control"]).toBe("no-store");
    const external = await guest.newPage();
    await external.setContent(`<img alt="Synthetic public preview" src="${url}">`);
    await expect.poll(() => external.locator("img").evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // A denied repeat must replace old success, never keep a false copied state.
    await page.evaluate(() => { (window as unknown as { __denyMessageCopy: boolean }).__denyMessageCopy = true; });
    await activate();
    const manual = page.getByRole("textbox", { name: /Full Markdown for manual copy|可手动复制的完整 Markdown/ });
    await expect(manual).toBeVisible();
    expect(await manual.inputValue()).toBe(copied);
    await page.evaluate(() => { (window as unknown as { __denyMessageCopy: boolean }).__denyMessageCopy = false; });
    await activate();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __messageCopyValues: string[] }).__messageCopyValues.length)).toBe(2);
    await expect(manual).toHaveCount(0);

    // The same published URL follows saved scale, while the original remains
    // private and unchanged. Exercise real inline controls, not a CSS adapter.
    const original = await page.request.get(`/api/attachments/${svg.id}/content`);
    const originalBytes = await original.body();
    // Explicit failure injection only: an admission denial must not suggest
    // blindly resaving or replace the retained original.
    const displayRoute = `**/api/attachments/${svg.id}/image-display`;
    await page.route(displayRoute, route => route.fulfill({
      status: 413, contentType: "application/json", body: '{"detail":"Synthetic size admission limit"}',
    }));
    await article.getByRole("button", { name: /Image size ·|图片大小 ·/ }).click();
    await expect(article.getByRole("alert")).toHaveText(/View or download the original|仍可查看或下载原图/);
    const scale = article.getByRole("spinbutton", { name: /Image scale percentage|图片缩放百分比/ });
    await expect(scale).toBeDisabled();
    await page.unroute(displayRoute);
    await article.getByRole("button", { name: /Reload size|重新读取/ }).click();
    await expect(scale).toHaveValue("100");
    // Explicitly applying the unchanged 100% configures intrinsic size; the
    // same action remains available for a missing-derivative repair.
    const applySize = article.getByRole("button", { name: /Apply size|应用比例/ });
    await expect(applySize).toBeEnabled();
    await applySize.click();
    await expect(article.getByRole("status").filter({ hasText: /Image size saved|比例已保存/ })).toBeVisible();
    await scale.fill("50");
    await applySize.click();
    await expect(article.getByRole("status").filter({ hasText: /Image size saved|比例已保存/ })).toBeVisible();
    await expect(applySize).toBeEnabled();
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/api/attachments/${svg.id}/image-display`)
        && response.request().method() === "PUT" && response.status() === 200),
      applySize.click(),
    ]);
    expect((await page.request.get(`/api/attachments/${svg.id}/image-display`)).status()).toBe(200);
    const imageSize = async () => {
      await external.goto(url!);
      return external.locator("img").evaluate(node => (node as HTMLImageElement).naturalWidth);
    };
    await expect.poll(imageSize).toBe(10);
    const inlineImage = article.locator(`[data-attachment-id="${svg.id}"] .attachment-gallery-image`);
    await expect.poll(() => inlineImage.evaluate(node => node.getBoundingClientRect().width)).toBe(10);
    const imageTrigger = article.locator(`[data-attachment-id="${svg.id}"] .attachment-gallery-trigger`);
    const touchBox = await imageTrigger.boundingBox();
    expect(touchBox!.width).toBeGreaterThanOrEqual(44);
    expect(touchBox!.height).toBeGreaterThanOrEqual(44);
    await scale.fill("25");
    await article.getByRole("button", { name: /Apply size|应用比例/ }).click();
    await expect.poll(imageSize).toBe(5);
    await page.reload();
    await expect(article).toBeVisible();
    await expect.poll(() => inlineImage.evaluate(node => node.getBoundingClientRect().width)).toBe(5);
    await article.getByRole("button", { name: /Image size · 25%|图片大小 · 25%/ }).click();
    await expect(scale).toHaveValue("25");
    await article.getByRole("button", { name: /Restore 100%|恢复 100%/ }).click();
    await expect.poll(imageSize).toBe(20);
    expect(await (await page.request.get(`/api/attachments/${svg.id}/content`)).body()).toEqual(originalBytes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`image-size-${width}.png`), fullPage: true });

    const share = await page.request.post(`/api/conversations/${conversationId}/shares`, { headers, data: {} });
    expect(share.ok()).toBe(true);
    const shared = await share.json() as { id: string; token: string };
    shareId = shared.id;
    await external.goto(`${baseURL}/share/${shared.token}`);
    await expect(external.locator("article[data-message-id]")).toHaveCount(2);
    await expect(external.getByTestId("message-markdown-copy")).toHaveCount(0);
    await expect(external.getByRole("button", { name: /Image size ·|图片大小 ·/ })).toHaveCount(0);

    // A current reference correctly prevents direct deletion; remove it through
    // the supported edit contract before removing the conversation file.
    expect((await page.request.delete(`/api/conversations/${conversationId}/attachments/${svg.id}`, { headers })).status()).toBe(409);
    const current = await page.request.get(`/api/messages/${message.id}`);
    const currentVersion = (await current.json()).current_version.id as string;
    const removeReference = await page.request.patch(`/api/messages/${message.id}`, { headers, data: {
      base_version_id: currentVersion, content_markdown: "**Reference removed**",
    } });
    expect(removeReference.ok()).toBe(true);
    expect((await page.request.delete(`/api/conversations/${conversationId}/attachments/${svg.id}`, { headers })).status()).toBe(204);
    expect((await guest.request.get(url!)).status()).toBe(404);
    expect((await guest.request.head(url!)).status()).toBe(404);
  } finally {
    if (shareId) await page.request.post(`/api/shares/${shareId}/revoke`, { headers });
    await page.request.delete(`/api/conversations/${conversationId}`, { headers });
    await guest.close();
  }
});
