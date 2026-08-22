import { expect, test } from "@playwright/test";

test.skip(process.env.E2E_CONTENT_CLEANUP !== "1", "E2E_CONTENT_CLEANUP=1 is required");

test("reviews a deterministic noise occurrence without silently changing content", async ({ page }, testInfo) => {
  const created = await page.request.post("/api/conversations", {
    data: {
      title: "Content cleanup browser fixture",
      messages: [
        { role: "user", content_markdown: "Safe cleanup question" },
        { role: "assistant", content_markdown: "Answer before,NOISE and after." },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const payload = await created.json() as { conversation: { id: string } };
  const conversationId = payload.conversation.id;
  let cleanupError: Error | null = null;

  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").filter({ hasText: "Answer before,NOISE and after." });
    await expect(assistant).toBeVisible();
    await assistant.getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ }).click();
    const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    for (let index = 0; index < 11; index += 1) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect(page.getByTestId("source-editor-cleanup-selection")).toBeEnabled();
    await page.getByTestId("source-editor-cleanup-selection").click();
    await expect(page.getByRole("heading", { name: /^(Clean noise|清理噪声)$/ })).toBeVisible();
    await expect(page.getByText("NOISE", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Process NOISE|处理 NOISE/ })).toBeChecked({ timeout: 30_000 });
    await page.getByRole("button", { name: /Rules|规则库/ }).click();
    await expect(page.getByRole("heading", { name: /Noise rule library|噪声规则库/ })).toBeVisible();
    await page.getByRole("button", { name: /Back to cleanup review|返回清理审查/ }).click();
    await page.screenshot({ path: testInfo.outputPath("content-cleanup-source-dialog.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDialog = page.getByTestId("content-cleanup-dialog").locator(":scope > div");
    await expect(mobileDialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("content-cleanup-source-dialog-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: /Apply 1 cleanup|应用 1 项清理/ }).click();
    await expect(page.getByTestId("content-cleanup-dialog")).toHaveCount(0);
    await expect(page.getByTestId("source-editor-codemirror")).toContainText("Answer before, and after.", { timeout: 30_000 });
    await expect(page.getByTestId("source-editor-codemirror")).not.toContainText("NOISE");
  } finally {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await page.request.delete(`/api/conversations/${conversationId}`);
        if ([204, 404].includes(response.status())) break;
        if (attempt === 1) cleanupError = new Error(`Unable to remove the cleanup QA conversation (${response.status()}).`);
      } catch {
        if (attempt === 1) cleanupError = new Error("Unable to remove the cleanup QA conversation.");
        await page.waitForTimeout(250);
      }
    }
  }
  if (cleanupError) throw cleanupError;
});
