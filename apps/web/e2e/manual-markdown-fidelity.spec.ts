import { expect, test as base, type APIRequestContext, type Locator } from "@playwright/test";
import { settingsAppearance } from "./settings-test-helper";

const test = base.extend<{ manualConversation: { id?: string } }>({
  manualConversation: [async ({ page }, use) => {
    const created: { id?: string } = {};
    await use(created);
    // Fixture teardown has its own bounded budget, so a timed-out UI action
    // remains the primary failure and cannot prevent synthetic-data cleanup.
    if (created.id) expect((await page.request.delete(`/api/conversations/${created.id}`, { timeout: 15_000 })).ok()).toBe(true);
  }, { timeout: 30_000 }],
});

test.skip(process.env.E2E_MUTATION_FLOW !== "1", "Requires the isolated mutation API");
test.use({ serviceWorkers: "block" });

const question = "    Synthetic indented source\n\n";
const answer = "\n\nSynthetic answer with a hard break  \nnext line\n\n";

async function expectSource(request: APIRequestContext, messageId: string, expected: string) {
  const response = await request.get(`/api/messages/${messageId}`);
  expect(response.status()).toBe(200);
  const message = await response.json();
  expect(message.current_version.display_text).toBe(expected);
  expect(message.current_version.plain_text).toBe(expected);
  expect(message.char_count).toBe(Array.from(expected).length);
}

async function openMessageActions(message: Locator) {
  await expect(message).toBeVisible();
  const trigger = message.getByTestId("mobile-message-actions-trigger");
  if (await trigger.isVisible() && await trigger.getAttribute("aria-expanded") !== "true") {
    await trigger.click();
  }
}

for (const width of [375, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: create, whitespace-only edit and single/pair insertion preserve exact source`, async ({ page, baseURL, manualConversation }, info) => {
    test.setTimeout(180_000);
    await settingsAppearance(page.request, baseURL!, locale);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/recent");
    if (width < 768) await page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ }).click();
    await page.locator('[data-testid="unclassified-new-conversation-button"]:visible').click();
    const create = page.getByTestId("new-conversation-dialog");
    await create.getByRole("textbox", { name: /Conversation title|对话标题/ }).fill("Synthetic source fidelity");
    await create.locator("textarea").first().fill(question);
    await create.locator("textarea").last().fill(answer);
    await page.screenshot({ path: info.outputPath(`manual-create-${width}-${locale}.png`) });
    const createdResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/conversations");
    await create.getByRole("button", { name: /^(创建并打开|Create and open)$/ }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON().messages.map((message: { content_markdown: string }) => message.content_markdown)).toEqual([question, answer]);
    const created = await response.json() as { conversation: { id: string }; messages: Array<{ id: string }> };
    const conversationId = created.conversation.id;
    manualConversation.id = conversationId;
    await expect(create).toHaveCount(0);
    for (const [index, expected] of [question, answer].entries()) await expectSource(page.request, created.messages[index].id, expected);

    const firstMessage = page.locator(`article[data-message-id="${created.messages[0].id}"]`);
    if (width < 768) {
      const header = page.getByTestId("mobile-reader-header");
      const messageAction = firstMessage.getByTestId("mobile-message-actions-trigger");
      await expect(header.getByRole("button", { name: /^(Prepare offline reading|准备离线阅读)$/ })).toBeVisible();
      await expect(messageAction).toBeVisible();
      await expect.poll(async () => {
        const headerBox = await header.boundingBox(), actionBox = await messageAction.boundingBox();
        return headerBox && actionBox ? actionBox.y - headerBox.y - headerBox.height : -1_000;
      }).toBeGreaterThanOrEqual(-1);
      await page.screenshot({ path: info.outputPath(`manual-first-message-${width}-${locale}.png`) });
    }
    await openMessageActions(firstMessage);
    await firstMessage.getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ }).click();
    const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
    const save = page.getByTestId("source-editor-create-version");
    await expect(save).toBeDisabled();
    await editor.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.insertText(" ");
    await expect(save).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`manual-whitespace-edit-${width}-${locale}.png`) });
    const savedResponse = page.waitForResponse(result => result.request().method() === "PATCH" && new URL(result.url()).pathname === `/api/messages/${created.messages[0].id}`);
    await save.click();
    const saved = await savedResponse;
    expect(saved.status()).toBe(200);
    expect(saved.request().postDataJSON().content_markdown).toBe(` ${question}`);
    await expectSource(page.request, created.messages[0].id, ` ${question}`);
    await expect(save).toContainText(/Create v3|创建 v3/);
    await expect(save).toBeDisabled();
    await page.locator("button[data-source-editor-close='true']").click();

    for (const mode of ["single", "pair"] as const) {
      await openMessageActions(firstMessage);
      await firstMessage.getByRole("button", { name: /^(Insert message here|在此处插入消息)$/ }).click();
      const insert = page.getByRole("dialog", { name: /^(Insert messages|插入消息)$/ });
      await insert.getByRole("combobox", { name: /^(Mode|方式)$/ }).selectOption(mode);
      const bodies = mode === "single" ? ["\tSynthetic inserted line\n\n"] : ["\n    Synthetic paired user  \n", "\n合成回复🙂  \n"];
      for (const [index, body] of bodies.entries()) await insert.locator("textarea").nth(index).fill(body);
      await page.screenshot({ path: info.outputPath(`manual-insert-${mode}-${width}-${locale}.png`) });
      const insertedResponse = page.waitForResponse(result => result.request().method() === "POST" && new URL(result.url()).pathname === `/api/conversations/${conversationId}/messages/insert`);
      await insert.getByRole("button", { name: /^(Insert messages|插入消息)$/ }).click();
      const inserted = await insertedResponse;
      expect(inserted.status()).toBe(201);
      expect(inserted.request().postDataJSON().messages.map((message: { content_markdown: string }) => message.content_markdown)).toEqual(bodies);
      const result = await inserted.json() as { messages: Array<{ id: string }> };
      await expect(insert).toHaveCount(0);
      for (const [index, body] of bodies.entries()) await expectSource(page.request, result.messages[index].id, body);
      await expect(page.locator(`article[data-message-id="${result.messages[0].id}"]`)).toBeVisible();
    }
  });
}
