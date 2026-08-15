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
const ATTACHMENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("Markdown and image attachments use the unified Viewer without weakening Rich Markdown", async ({ page }) => {
  const { conversationId, messageId } = await createConversation(page.request);
  try {
    await page.goto(`/conversations/${conversationId}`);
    const message = page.locator(`#message-${messageId}`);
    await message.getByRole("button", { name: /Edit Markdown source|Markdown/ }).click();
    const attachmentInput = page.getByTestId("source-editor-attachment-input");
    await attachmentInput.setInputFiles({
      name: "rich-markdown-fixture.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(ATTACHMENT_MARKDOWN),
    });
    const attachmentDrafts = page.getByTestId("source-editor-attachment-drafts");
    await expect(attachmentDrafts).toBeVisible();
    await expect(attachmentDrafts.getByText(/Uploading:|正在上传/)).toHaveCount(0);
    await expect(attachmentDrafts).not.toContainText(/Upload failed|上传失败/);
    await attachmentInput.setInputFiles({
      name: "viewer-image-fixture.png",
      mimeType: "image/png",
      buffer: ATTACHMENT_PNG,
    });
    await expect(attachmentDrafts.getByText(/Uploading:|正在上传/)).toHaveCount(0);
    await expect(attachmentDrafts).not.toContainText(/Upload failed|上传失败/);
    await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
    const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH"
      && response.url().endsWith(`/api/messages/${messageId}`));
    await page.getByTestId("source-editor-create-version").click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByTestId("source-editor-create-version")).toContainText(/Create v3|创建 v3/);
    await page.locator("button[data-source-editor-close='true']").click();

    const attachments = await page.request.get(`/api/conversations/${conversationId}/attachments`);
    expect(attachments.ok()).toBeTruthy();
    const items = ((await attachments.json()) as { items: Array<{ id: string; display_name: string }> }).items;
    const item = items.find((attachment) => attachment.display_name === "rich-markdown-fixture.md");
    const imageItem = items.find((attachment) => attachment.display_name === "viewer-image-fixture.png");
    expect(item).toBeTruthy();
    expect(imageItem).toBeTruthy();

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

    const imagePreview = message.locator(`[data-testid="attachment-block"][data-attachment-id="${imageItem!.id}"]`);
    await expect(imagePreview.locator("img")).toBeVisible();
    await imagePreview.locator("img").click();
    const imageDialog = page.getByTestId("attachment-viewer-shell");
    await expect(imageDialog).toHaveAttribute("aria-label", "viewer-image-fixture.png");
    await expect(imageDialog.getByRole("img", { name: "viewer-image-fixture.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(imageDialog).toHaveCount(0);
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
