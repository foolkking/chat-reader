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
      writeText: async (value: string) => (window as unknown as { __messageCopyValues: string[] }).__messageCopyValues.push(value),
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
    if (width < 640) await article.getByTestId("mobile-message-actions-trigger").click();
    else await article.hover();
    await article.getByTestId("message-markdown-copy").filter({ visible: true }).click();
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

    const share = await page.request.post(`/api/conversations/${conversationId}/shares`, { headers, data: {} });
    expect(share.ok()).toBe(true);
    const shared = await share.json() as { id: string; token: string };
    shareId = shared.id;
    await external.goto(`${baseURL}/share/${shared.token}`);
    await expect(external.locator("article[data-message-id]")).toHaveCount(2);
    await expect(external.getByTestId("message-markdown-copy")).toHaveCount(0);

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
