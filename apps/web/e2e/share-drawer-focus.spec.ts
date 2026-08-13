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
