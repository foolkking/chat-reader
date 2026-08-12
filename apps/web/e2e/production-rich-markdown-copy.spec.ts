import { expect, test } from "@playwright/test";

const sourceUrl = process.env.E2E_RICH_MARKDOWN_SOURCE_URL;
const sourceBase64 = process.env.E2E_RICH_MARKDOWN_SOURCE_BASE64;

test.skip(!sourceUrl && !sourceBase64, "a production Rich Markdown source is required");

test("a transient copy of the production Markdown renders all recovered math", async ({ page }) => {
  let source = sourceBase64 ? Buffer.from(sourceBase64, "base64").toString("utf8") : "";
  if (!source && sourceUrl) {
    const sourceResponse = await page.request.get(sourceUrl);
    expect(sourceResponse.ok()).toBeTruthy();
    const messages = await sourceResponse.json() as Array<{
      role: string;
      current_version?: { display_text?: string | null };
    }>;
    source = messages.find((message) => message.role === "assistant")?.current_version?.display_text ?? "";
  }
  expect(source).toContain("(n^6)");
  expect(source).toContain("[\nf(x)=x^2.");

  const create = await page.request.post("/api/conversations", {
    data: {
      title: `Rich Markdown production copy ${crypto.randomUUID().slice(0, 8)}`,
      messages: [
        { role: "user", content_markdown: "Render a transient production-source copy." },
        { role: "assistant", content_markdown: source },
      ],
    },
  });
  expect(create.ok()).toBeTruthy();
  const body = await create.json() as { conversation: { id: string } };

  try {
    await page.goto(`/conversations/${body.conversation.id}`);
    const assistant = page.locator("article[data-message-id]").last();
    await expect.poll(async () => assistant.locator(".katex-display").count()).toBeGreaterThan(0);
    await expect(assistant.locator('[data-math-error="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await assistant.getByRole("button", { name: /Edit Markdown source|\u7f16\u8f91 Markdown \u6e90\u7801/ }).click();
    await page.getByTestId("source-editor-preview-toggle").click();
    const preview = page.getByTestId("source-editor-rich-preview");
    await expect(preview.locator(".katex-display")).toHaveCount(108);
    await expect.poll(async () => preview.locator(".katex-mathml math").count()).toBeGreaterThanOrEqual(108);
    await expect(preview.locator('[data-math-error="true"]')).toHaveCount(0);
    await expect(preview).toContainText("根号中最高次是");
  } finally {
    await page.request.delete(`/api/conversations/${body.conversation.id}`);
  }
});
