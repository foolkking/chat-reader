import { expect, test } from "@playwright/test";

const sourceBase64 = process.env.E2E_RICH_MARKDOWN_SCIENTIFIC_SOURCE_BASE64;

test.skip(!sourceBase64, "a production scientific Markdown source is required");

test("a transient scientific Markdown copy recovers bounded ChatGPT formulas", async ({ page }) => {
  const source = Buffer.from(sourceBase64 ?? "", "base64").toString("utf8");
  expect(source).toContain("\\lambda");
  expect(source).toContain("\\mathbb");
  expect(source).toContain("\\langle");

  const create = await page.request.post("/api/conversations", {
    data: {
      title: `Scientific Markdown production copy ${crypto.randomUUID().slice(0, 8)}`,
      messages: [
        { role: "user", content_markdown: "Render a transient scientific Markdown copy." },
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
    const canonicalResponse = await page.request.get(`/api/conversations/${body.conversation.id}/messages?limit=10`);
    expect(canonicalResponse.ok()).toBeTruthy();
    const canonicalMessages = await canonicalResponse.json() as Array<{
      role: string;
      current_version?: { display_text?: string | null };
    }>;
    expect(canonicalMessages.find((message) => message.role === "assistant")?.current_version?.display_text).toBe(source);
    await page.getByTestId("source-editor-preview-toggle").click();
    const preview = page.getByTestId("source-editor-rich-preview");
    await expect.poll(async () => preview.locator(".katex-display").count()).toBeGreaterThan(39);
    await expect.poll(async () => preview.locator(".katex-mathml math").count()).toBeGreaterThan(39);
    const annotations = await preview.locator(".katex-mathml annotation").allTextContents();
    for (const command of ["\\lambda", "\\mathbb", "\\langle", "\\xrightarrow"]) {
      expect(annotations.some((value) => value.includes(command)), JSON.stringify(annotations)).toBe(true);
    }
    await expect(preview.locator('[data-math-error="true"]')).toHaveCount(0);
    const literalBrackets = await preview.locator("p").allTextContents();
    expect(literalBrackets.filter((value) => /^\s*\[/.test(value))).toEqual([]);
  } finally {
    await page.request.delete(`/api/conversations/${body.conversation.id}`);
  }
});
