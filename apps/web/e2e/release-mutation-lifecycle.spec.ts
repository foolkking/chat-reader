import { expect, test } from "@playwright/test";

const runMutationFlow = process.env.E2E_MUTATION_FLOW === "1";

test.skip(!runMutationFlow, "E2E_MUTATION_FLOW=1 is required");

test("initial recent-recording cannot make delete stale and failed undo remains retryable", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const createdResponse = await page.request.post("/api/conversations", {
    data: {
      title: `QA mutation lifecycle ${suffix}`,
      messages: [
        { role: "user", content_markdown: "QA mutation user" },
        { role: "assistant", content_markdown: "QA mutation assistant" },
      ],
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const conversationId = created.conversation.id as string;

  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").filter({ hasText: "QA mutation assistant" });
    await expect(assistant).toBeVisible();

    await assistant.getByRole("button", { name: /Delete message|\u5220\u9664\u6d88\u606f/ }).click();
    const deleteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "DELETE" && response.url().includes("/api/messages/")
    ));
    await page.getByRole("dialog").getByRole("button", { name: /Delete message|\u5220\u9664\u6d88\u606f/ }).click();
    expect((await deleteResponsePromise).status()).toBe(200);

    const undo = page.getByRole("button", { name: /Undo|\u64a4\u9500/ });
    await expect(undo).toBeVisible();
    await page.route("**/api/messages/*/restore*", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "forced" }) });
    }, { times: 1 });
    await undo.click();

    const retry = page.getByRole("button", { name: /Retry|\u91cd\u8bd5/ });
    await expect(retry).toBeVisible();
    await expect(page.getByRole("alert").filter({ has: retry })).toContainText(/Undo failed|\u64a4\u9500\u5931\u8d25/);
    await retry.click();
    await expect(page.getByText("QA mutation assistant")).toBeVisible();
    await page.reload();
    await expect(page.getByText("QA mutation assistant")).toBeVisible();
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});
