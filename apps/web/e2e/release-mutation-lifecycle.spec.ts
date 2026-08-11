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

test("revision conflict preserves the source draft and can load the latest base before retry", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const longAssistantSource = Array.from({ length: 180 }, (_, index) => `QA source line ${String(index + 1).padStart(3, "0")} with enough text to require editor scrolling.`).join("\n\n");
  const createdResponse = await page.request.post("/api/conversations", {
    data: {
      title: `QA conflict recovery ${suffix}`,
      messages: [
        { role: "user", content_markdown: "QA conflict user" },
        { role: "assistant", content_markdown: longAssistantSource },
      ],
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const conversationId = created.conversation.id as string;

  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").filter({ hasText: "QA source line 001" });
    await expect(assistant).toBeVisible();
    await assistant.getByRole("button", { name: /Edit Markdown source|\u7f16\u8f91 Markdown \u6e90\u7801/ }).click();
    const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    const readCaret = () => editor.evaluate((element) => {
      const selection = window.getSelection();
      const scroller = element.closest<HTMLElement>(".cm-scroller");
      if (!selection?.anchorNode || !element.contains(selection.anchorNode)) return { offset: -1, scrollTop: scroller?.scrollTop ?? -1 };
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      return { offset: range.toString().length, scrollTop: scroller?.scrollTop ?? -1 };
    });
    const beforeFirstEdit = await readCaret();
    await page.keyboard.insertText("Z");
    await expect.poll(async () => (await readCaret()).offset).toBe(beforeFirstEdit.offset + 1);
    await expect.poll(async () => (await readCaret()).scrollTop).toBeGreaterThanOrEqual(beforeFirstEdit.scrollTop - 2);
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await readCaret()).offset).toBe(beforeFirstEdit.offset);
    await page.keyboard.insertText("\n\nQA preserved draft");
    await expect(editor).toContainText("QA preserved draft");

    await page.route("**/api/messages/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Conversation changed since it was loaded." }) });
        return;
      }
      await route.continue();
    }, { times: 1 });
    await page.getByTestId("source-editor-create-version").click();

    const loadLatest = page.getByRole("button", { name: /Load latest state|\u52a0\u8f7d\u6700\u65b0\u72b6\u6001/ });
    await expect(loadLatest).toBeVisible();
    await expect(editor).toContainText("QA preserved draft");
    await loadLatest.click();
    await expect(page.getByText(/Latest state loaded|\u5df2\u52a0\u8f7d\u6700\u65b0\u72b6\u6001/).last()).toBeVisible();
    await expect(editor).toContainText("QA preserved draft");

    await page.getByTestId("source-editor-create-version").click();
    await expect(page.getByText("QA preserved draft").first()).toBeVisible();
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});
