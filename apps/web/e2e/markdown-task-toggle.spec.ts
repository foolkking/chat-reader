import { expect, test } from "@playwright/test";

const runTaskToggle = process.env.E2E_TASK_TOGGLE === "1";

test.skip(!runTaskToggle, "E2E_TASK_TOGGLE=1 is required");

test("owner task checkbox persists immediately while share stays read-only", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/messages/")) {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  const suffix = crypto.randomUUID().slice(0, 8);
  const preview = await page.request.post("/api/imports/preview", {
    multipart: {
      files: {
        name: `task-toggle-${suffix}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
          metadata: { title: `Task toggle ${suffix}`, powered_by: "ChatGPT Exporter" },
          messages: [
            { role: "Prompt", say: "- [ ] 用户任务" },
            { role: "Response", say: "- [ ] 助手任务\n\n```md\n- [ ] 示例而非任务\n```" },
          ],
        })),
      },
    },
  });
  expect(preview.ok()).toBeTruthy();
  const commit = await page.request.post(`/api/imports/${(await preview.json()).import_id}/commit`);
  expect(commit.ok()).toBeTruthy();
  const commitBody = await commit.json() as { conversation_ids?: string[] };
  expect(commitBody.conversation_ids, "E2E API must use IMPORT_COMMIT_INLINE=true").toHaveLength(1);
  const conversationId = commitBody.conversation_ids![0];

  try {
    await page.goto(`/conversations/${conversationId}`);
    const userMessage = page.locator("[data-message-id]").first();
    const checkbox = userMessage.getByRole("checkbox").first();
    await expect(checkbox).not.toBeChecked();
    await page.waitForLoadState("networkidle");
    await checkbox.click();
    await expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
    await expect(failedRequests, `failed task requests: ${failedRequests.join(" | ")}`).toEqual([]);
    await expect(checkbox).toBeChecked();
    await page.reload();
    await expect(userMessage.getByRole("checkbox").first()).toBeChecked();

    const messageId = await userMessage.getAttribute("data-message-id");
    const historyAfterFirst = await page.request.get(`/api/messages/${messageId}/versions`);
    expect((await historyAfterFirst.json()).items.map((item: { version_number: number }) => item.version_number)).toEqual([2, 1]);
    await userMessage.getByRole("checkbox").first().click();
    await expect(userMessage.getByRole("checkbox").first()).not.toBeChecked();
    const historyAfterSecond = await page.request.get(`/api/messages/${messageId}/versions`);
    expect((await historyAfterSecond.json()).items.map((item: { version_number: number }) => item.version_number)).toEqual([2, 1]);

    const shareResponse = await page.request.post(`/api/conversations/${conversationId}/shares`, {
      data: { scope: "conversation", include_toc: true, include_metadata: true },
    });
    const share = await shareResponse.json() as { id: string; token: string };
    await page.goto(`/share/${share.token}`);
    const sharedCheckbox = page.getByRole("checkbox").first();
    const before = await sharedCheckbox.isChecked();
    await sharedCheckbox.click({ force: true });
    expect(await sharedCheckbox.isChecked()).toBe(before);
    await page.request.post(`/api/shares/${share.id}/revoke`);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});
