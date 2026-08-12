import { expect, test, type APIRequestContext } from "@playwright/test";

const runAttachment = process.env.E2E_RICH_MARKDOWN_ATTACHMENT === "1";
test.skip(!runAttachment, "E2E_RICH_MARKDOWN_ATTACHMENT=1 is required");

const ATTACHMENT_MARKDOWN = String.raw`# Rich Markdown attachment

\[
\boxed{x^2+y^2=z^2}
\]

| A | B |
| - | - |
| 1 | 2 |

Text[^1]

[^1]: Attachment footnote.
` + "\n\n`\\(code-is-not-math\\)`";

test("Markdown attachment inline and Viewer use the shared AI Rich Markdown core", async ({ page }) => {
  const { conversationId, messageId } = await createConversation(page.request);
  try {
    await page.goto(`/conversations/${conversationId}`);
    const message = page.locator(`#message-${messageId}`);
    await message.getByRole("button", { name: /Edit Markdown source|Markdown/ }).click();
    await page.getByTestId("source-editor-attachment-input").setInputFiles({
      name: "rich-markdown-fixture.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(ATTACHMENT_MARKDOWN),
    });
    await expect(page.getByTestId("source-editor-attachment-drafts")).toBeVisible();
    await expect(page.getByTestId("source-editor-attachment-drafts").getByText(/Uploading:|正在上传/)).toHaveCount(0);
    const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH"
      && response.url().endsWith(`/api/messages/${messageId}`));
    await page.getByTestId("source-editor-create-version").click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByTestId("source-editor-create-version")).toContainText(/Create v3|创建 v3/);
    await page.locator("button[data-source-editor-close='true']").click();

    const attachments = await page.request.get(`/api/conversations/${conversationId}/attachments`);
    expect(attachments.ok()).toBeTruthy();
    const item = ((await attachments.json()) as { items: Array<{ id: string; display_name: string }> }).items
      .find((attachment) => attachment.display_name === "rich-markdown-fixture.md");
    expect(item).toBeTruthy();

    const markdownPreview = message.locator(`[data-testid="attachment-block"][data-attachment-id="${item!.id}"]`);
    await expect(markdownPreview).toBeVisible();
    await expect(markdownPreview.locator(".katex-display")).toHaveCount(1);
    await expect(markdownPreview.locator(".katex-mathml math")).toHaveCount(1);
    await markdownPreview.locator("button.attachment-icon-action").first().click();

    const viewer = page.getByTestId("attachment-viewer-shell");
    await expect(viewer).toBeVisible();
    await expect(viewer.locator(".katex-display")).toHaveCount(1);
    await expect(viewer.locator("table")).toHaveCount(1);
    await expect(viewer.locator("[data-footnote-ref]")).toHaveCount(1);
    await expect(viewer.locator("code").filter({ hasText: "\\(code-is-not-math\\)" })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
  } finally {
    const cleanup = await page.request.delete(`/api/conversations/${conversationId}`);
    expect(cleanup.ok()).toBeTruthy();
  }
});

async function createConversation(request: APIRequestContext): Promise<{ conversationId: string; messageId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const create = await request.post("/api/conversations", {
    data: {
      title: `Rich Markdown attachment ${suffix}`,
      messages: [
        { role: "user", content_markdown: "Attach the Rich Markdown fixture." },
        { role: "assistant", content_markdown: "The attachment follows." },
      ],
    },
  });
  expect(create.ok()).toBeTruthy();
  const body = await create.json() as { conversation: { id: string }; messages: Array<{ id: string }> };
  return { conversationId: body.conversation.id, messageId: body.messages[0].id };
}
