import { expect, test, type Page } from "@playwright/test";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openSettings(page: Page, name: RegExp) {
  const menu = page.getByRole("region", { name: /^(Settings|设置)$/ }).and(page.locator("div"));
  if (!await menu.isVisible()) {
    const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
    const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    await settings.click();
  }
  await menu.getByRole("button", { name }).click();
  return page.getByRole("dialog");
}

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`settings disclosure, identity persistence and archive routing ${width} ${locale}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, headers = { Origin: base }, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, hasTouch: width === 375 });
    let userId: string | undefined;
    try {
      const password = "Synthetic presentation test password";
      const registered = await context.request.post(`${base}/api/auth/register`, { headers, data: { email: `presentation-${crypto.randomUUID()}@example.test`, password, confirm_password: password } });
      expect(registered.status()).toBe(201); userId = (await registered.json()).user_id;
      await settingsAppearance(context.request, base, locale);
      const source = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic source", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: "Synthetic answer" }] } });
      expect(source.status()).toBe(201);
      const conversationId = (await source.json()).conversation.id;
      expect((await context.request.post(`${base}/api/conversations/${conversationId}/shares`, { headers, data: { title: "Synthetic shared reading" } })).status()).toBe(200);
      const page = await context.newPage(); await page.goto(base);
      const shares = await openSettings(page, /^(My shares|我的分享)$/);
      const row = shares.getByRole("article", { name: "Synthetic shared reading" });
      await expect(row).toBeVisible();
      await expect(row.getByText(/Public link|公开链接/, { exact: true })).toHaveCount(0);
      const status = row.getByRole("button", { name: /^(Active|有效)$/ });
      await status.hover();
      await expect(row.getByRole("tooltip")).toContainText(/Entire conversation|整个对话/);
      await row.getByRole("tooltip").hover();
      await expect(row.getByRole("tooltip")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(row.getByRole("tooltip")).toHaveCount(0);
      await expect(shares).toBeVisible();
      await page.mouse.move(1, 1);
      await expect(row.getByRole("tooltip")).toHaveCount(0);
      await status.focus();
      await expect(row.getByRole("tooltip")).toContainText(/No expiry|永久有效/);
      await page.keyboard.press("Escape");
      await expect(row.getByRole("tooltip")).toHaveCount(0);
      await expect(shares).toBeVisible();
      if (width === 375) await status.tap(); else await status.click();
      await expect(row.getByRole("tooltip")).toBeVisible();
      const rect = await row.getByRole("tooltip").boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      await shares.getByRole("heading", { name: /My shares|我的分享/, exact: true }).click();
      await expect(row.getByRole("tooltip")).toHaveCount(0);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/shares-${width}-${locale}.png` });
      await page.keyboard.press("Escape");

      const account = await openSettings(page, /^(Account & security|账户与安全)$/);
      const name = account.getByRole("textbox", { name: /Display name|显示名称/ });
      await name.fill("Synthetic Reader");
      await account.getByRole("button", { name: /Save account details|保存账户信息/ }).click();
      await expect(account.getByRole("status")).toContainText(/saved|已保存/);
      expect((await (await context.request.get(`${base}/api/auth/me`)).json()).display_name).toBe("Synthetic Reader");
      const emailRect = await account.getByLabel(/^(Email|邮箱)$/).boundingBox(), nameRect = await name.boundingBox();
      if (width >= 768) expect(Math.abs(emailRect!.y - nameRect!.y)).toBeLessThan(2);
      else expect(nameRect!.y).toBeGreaterThan(emailRect!.y);
      await expect(account.getByText(/Account status|账户状态/, { exact: true })).toHaveCount(0);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/account-${width}-${locale}.png` });
      await page.keyboard.press("Escape");

      const help = await openSettings(page, /^(Help & diagnostics|帮助与诊断)$/);
      await expect(help.getByText(/Connected to server|已连接服务器/, { exact: true })).toBeVisible();
      const footer = help.locator("footer");
      await expect(footer).toContainText(/API/);
      await expect(help.getByText(/Check your environment|查看当前环境/)).toHaveCount(0);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/help-${width}-${locale}.png` });
      await page.keyboard.press("Escape");

      const backup = await openSettings(page, /Data.*backup|数据与备份|Data archive|数据归档/);
      await backup.getByRole("button", { name: /^(Restore archive|恢复归档)$/ }).click();
      await backup.getByRole("button", { name: /Restore a conversation archive|恢复单个对话归档/ }).click();
      const archive = page.getByRole("dialog", { name: /Restore conversation archive|恢复对话归档/ });
      await expect(archive.getByTestId("import-file-input")).toHaveAttribute("accept", ".cr");
      // Real legacy archive export -> preview -> worker restore -> canonical messages.
      if (width === 375) {
        const queued = await context.request.post(`${base}/api/conversations/${conversationId}/exports`, { headers });
        expect(queued.status()).toBe(202);
        const job = (await queued.json()).job_id;
        await expect.poll(async () => (await (await context.request.get(`${base}/api/tasks/${job}`)).json()).status).toBe("committed");
        const completed = await (await context.request.get(`${base}/api/tasks/${job}`)).json();
        const file = await context.request.get(`${base}${completed.result.download_url}`);
        expect(file.ok()).toBe(true);
        await archive.getByTestId("import-file-input").setInputFiles({ name: "synthetic.cr", mimeType: "application/octet-stream", buffer: await file.body() });
        await archive.getByTestId("preview-import-button").click();
        await expect(archive.getByTestId("commit-import-button")).toBeEnabled();
        await archive.getByTestId("commit-import-button").click();
        await expect(archive.getByText(/Import complete|导入已完成/, { exact: true })).toBeVisible();
        const conversations = await (await context.request.get(`${base}/api/conversations?scope=all&include_archived=true`)).json();
        expect(conversations).toHaveLength(2);
        expect(conversations.every((item: { message_count: number }) => item.message_count === 2)).toBe(true);
      }
      await page.getByTestId("import-dialog-close").click();
      await page.goto(base);
      if (width < 768) await page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ }).click();
      await page.getByRole("button", { name: /^(Import data|导入数据)$/ }).click();
      const importer = page.getByRole("dialog", { name: /^(Import data|导入数据)$/ });
      await expect(importer.getByRole("button", { name: /\.cr/ })).toHaveCount(0);
      await importer.getByTestId("import-file-input").setInputFiles({ name: "wrong.context.zip", mimeType: "application/zip", buffer: Buffer.from("synthetic") });
      await expect(importer.getByRole("alert")).toContainText(/Current \/ Index/);
      await expect(importer.getByTestId("preview-import-button")).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
      if (userId) await removeSyntheticAccount(admin, userId);
      await admin.dispose();
    }
  });
}
