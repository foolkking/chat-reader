import { expect, test } from "@playwright/test";

const runShareDrawerFocus = process.env.E2E_SHARE_DRAWER_FOCUS === "1";
test.skip(!runShareDrawerFocus, "E2E_SHARE_DRAWER_FOCUS=1 is required");

async function openShare(page: import("@playwright/test").Page) {
  await page.locator('[data-reader-header-more-actions="true"]').click();
  await page.locator('[data-reader-header-action="share"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("Share drawer restores logical focus for Escape, X and backdrop", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const created = await page.request.post("/api/conversations", {
    data: {
      title: `QA Share drawer focus ${suffix}`,
      messages: [
        { role: "user", content_markdown: "QA Share drawer focus user" },
        { role: "assistant", content_markdown: "QA Share drawer focus assistant" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const body = await created.json() as { conversation: { id: string } };
  const conversationId = body.conversation.id;

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/conversations/${conversationId}`);
    await expect(page.locator('[data-reader-header-more-actions="true"]')).toBeVisible();

    await openShare(page);
    await expect(page.getByRole("dialog").locator("[data-dialog-initial-focus]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator('[data-reader-header-more-actions="true"]')).toBeFocused();

    await openShare(page);
    await page.getByRole("dialog").getByRole("button", { name: /Close|关闭/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator('[data-reader-header-more-actions="true"]')).toBeFocused();

    await openShare(page);
    await page.locator("[data-dialog-backdrop]").last().click({ position: { x: 8, y: 8 }, force: true });
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator('[data-reader-header-more-actions="true"]')).toBeFocused();
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("mobile Share replaces the tools sheet and restores the More trigger", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const created = await page.request.post("/api/conversations", {
    data: {
      title: `QA mobile Share focus ${suffix}`,
      messages: [
        { role: "user", content_markdown: "QA mobile Share focus user" },
        { role: "assistant", content_markdown: "QA mobile Share focus assistant" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const body = await created.json() as { conversation: { id: string } };
  const conversationId = body.conversation.id;

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/conversations/${conversationId}`);
    const more = page.locator('[data-reader-mobile-more-actions="true"]');
    await expect(more).toBeVisible();
    await more.click();

    const tools = page.getByRole("dialog", { name: /阅读工具|Reader tools/ });
    await expect(tools).toBeVisible();
    await tools.getByRole("button", { name: /分享|Share/ }).click();

    const share = page.getByRole("dialog", { name: /分享对话|Share conversation/ });
    await expect(tools).toBeHidden();
    await expect(share).toBeVisible();
    await expect(share.locator("[data-dialog-initial-focus]")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(share).toBeHidden();
    await expect(more).toBeFocused();

    // A short viewport must still expose the last tool without scrolling the
    // fixed title out of sight. Both snap positions use the visible height.
    await page.setViewportSize({ width: 375, height: 480 });
    await more.click();
    const lastTool = tools.getByRole("button").last();
    await lastTool.focus();
    await expect(lastTool).toBeInViewport({ ratio: 1 });
    const close = tools.getByRole("button", { name: /^(关闭|Close)$/ });
    await expect(close).toBeInViewport({ ratio: 1 });
    const bounds = await tools.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(187, bounds!.y + 14);
    await page.mouse.down();
    await page.mouse.move(187, 40, { steps: 15 });
    await page.mouse.up();
    await expect.poll(async () => (await tools.boundingBox())!.y).toBeLessThan(60);
    await expect(lastTool).toBeInViewport({ ratio: 1 });
    await close.click();
    await expect(tools).toBeHidden();
    await more.click();
    await expect.poll(async () => (await tools.boundingBox())!.y).toBeGreaterThan(180);
    await lastTool.focus();
    await expect(lastTool).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(tools).toBeHidden();
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});
