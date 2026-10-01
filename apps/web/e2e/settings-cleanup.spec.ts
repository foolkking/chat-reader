import { expect, test } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires disposable PostgreSQL settings fixture and worker");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: durable cross-page noise review with protected source`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    context.setDefaultTimeout(20_000);
    const email = `cleanup-${Date.now()}-${width}@example.test`, password = "synthetic cleanup browser passphrase";
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL! }, data: { email, password, confirm_password: password } })).status()).toBe(201);
    await settingsAppearance(context.request, baseURL!, locale);
    const page = await context.newPage();
    const marker = "\ue200cite\ue202turn12search4\ue201";
    const source = "Synthetic evidence " + (marker + " remains.\n\n").repeat(125) + "Code: `" + marker + "`";
    const created = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: { title: "Synthetic noise review", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }] } });
    expect(created.status()).toBe(201);
    const conversation = await created.json();
    const scanResponse = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers: { Origin: baseURL! }, data: { source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.conversation.id] } });
    expect(scanResponse.status()).toBe(202);
    const scanId = (await scanResponse.json()).id;
    const scan = async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}`)).json());
    const open = async () => {
      await page.goto(baseURL!);
      await page.locator("button:visible").filter({ hasText: /^Open review$|^打开审查$/ }).first().click();
      return page.getByTestId("content-cleanup-dialog");
    };
    try {
      await expect.poll(async () => (await scan()).status).toBe("READY");
      expect((await scan()).delete_count).toBe(0);
      let dialog = await open();
      if (width < 1024) await dialog.getByRole("button", { name: /全部候选|All candidates/, exact: true }).click();
      await expect(dialog.getByRole("checkbox", { name: /处理|Process/ }).first()).not.toBeChecked();
      await dialog.getByRole("button", { name: /选择全部匹配项|Select all matching/, exact: true }).click();
      await expect.poll(async () => (await scan()).delete_count).toBe(125);
      await dialog.getByRole("button", { name: /下一页|Next/, exact: true }).click();
      await expect(dialog.getByRole("checkbox", { name: /处理|Process/ }).first()).toBeChecked();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      dialog = await open();
      await expect(dialog.getByRole("status").filter({ hasText: /已选 125 项|125 selected/ })).toBeVisible();
      if (width < 1024) await dialog.getByRole("button", { name: /全部候选|All candidates/, exact: true }).click();
      await dialog.getByRole("button", { name: /下一页|Next/, exact: true }).click();
      await dialog.getByRole("button", { name: /下一页|Next/, exact: true }).click();
      await expect(dialog.getByRole("checkbox", { name: /处理|Process/ }).last()).toBeDisabled();
      await expect(dialog.getByRole("checkbox", { name: /处理|Process/ }).last()).not.toBeChecked();
      if (process.env.SETTINGS_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/cleanup-${width}-${locale}.png` });
      await dialog.getByRole("button", { name: /预览 125 项清理|Preview 125 removals/ }).click();
      await expect(dialog.getByText(/1 个对话 · 1 条消息 · 125 个删除片段|1 conversations · 1 messages · 125 fragments/, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await dialog.getByRole("button", { name: /确认应用 125 项清理|Confirm 125 removals/ }).click();
      await expect(dialog).not.toBeVisible();
      const message = await (await context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json();
      expect(message.current_version.display_text).toBe("Synthetic evidence " + " remains.\n\n".repeat(125) + "Code: `" + marker + "`");
      expect(message.current_version.edit_type).toBe("content_cleanup");
    } finally { await context.close(); await admin.dispose(); }
  });
}
