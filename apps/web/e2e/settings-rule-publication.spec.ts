import { expect, test, type Page } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated settings PostgreSQL fixture and worker");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: publish, retain used revision, withdraw and relearn without duplicates`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(150_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const suffix = `${Date.now()}-${width}`;
    const headers = { Origin: baseURL! };
    const initialize = async (kind: string) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
      const password = "synthetic rule publication passphrase";
      expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `rule-${kind}-${suffix}@example.test`, password, confirm_password: password } })).status()).toBe(201);
      await settingsAppearance(context.request, baseURL!, locale);
      return context;
    };
    const author = await initialize("author"), reader = await initialize("reader");
    const adminContext = await browser.newContext({ storageState: await admin.storageState(), viewport: { width, height: 900 }, locale });
    await settingsAppearance(adminContext.request, baseURL!, locale);
    const root = await adminContext.newPage(), b = await reader.newPage();
    const value = `SYNTHETIC_NOISE_${suffix}`;
    const created = await author.request.post(`${baseURL}/api/content-cleanup/rules`, { headers, data: { name: "Synthetic private rule", match_value: value } });
    expect(created.status()).toBe(201);
    const rule = await created.json();
    const publicationPath = `/api/admin/noise-rules/${rule.id}/publication`;
    const readerRules = async () => (await (await reader.request.get(`${baseURL}/api/content-cleanup/rules`)).json()) as { id: string; name: string; revision: number; revision_id: string; held: boolean; system_provided: boolean }[];
    const settings = async (page: Page, system = false) => {
      await page.goto(baseURL!);
      if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
      await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
      const menu = page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"));
      await menu.getByRole("button", { name: system ? /系统噪声规则|System noise rules/ : /噪声规则库|Noise rule library/ }).click();
      return page.getByRole("dialog", { name: system ? /系统噪声规则|System noise rules/ : /噪声规则库|Noise rule library/, exact: true });
    };
    try {
      expect((await readerRules()).some((item) => item.id === rule.id)).toBe(false);
      const panel = await settings(root, true);
      const row = panel.getByRole("article").first();
      await row.getByRole("button").first().click();
      await row.getByLabel(/系统显示名称|System display name/).fill("Synthetic published rule");
      await row.getByRole("radio").first().check();
      await expect(row.getByText(value, { exact: true })).toHaveCount(2);
      await row.getByRole("button", { name: /发布所选版本|Publish selected version/, exact: true }).click();
      await root.getByRole("dialog", { name: /发布此噪声规则版本|Publish this noise rule version/ }).getByRole("button", { name: /确认发布|^Publish$/, exact: true }).click();
      await expect(row.getByRole("status").filter({ hasText: /系统提供状态已更新|Publication updated/ })).toBeVisible();
      await expect.poll(async () => (await readerRules()).find((item) => item.id === rule.id)?.system_provided).toBe(true);
      expect((await readerRules()).find((item) => item.id === rule.id)?.held).toBe(false);
      expect((await author.request.patch(`${baseURL}/api/content-cleanup/rules/${rule.id}`, { headers, data: { match_value: value + "_REPAIRED", base_revision_id: rule.revision_id } })).status()).toBe(200);
      expect((await readerRules()).find((item) => item.id === rule.id)?.revision).toBe(1);
      const conversation = await (await reader.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic shared-rule review", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: `Before ${value} after.` }] } })).json();
      const queued = await reader.request.post(`${baseURL}/api/content-cleanup/scans`, { headers, data: { source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.conversation.id] } });
      expect(queued.status()).toBe(202);
      const scanId = (await queued.json()).id;
      await expect.poll(async () => (await (await reader.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}`)).json()).status).toBe("READY");
      if (process.env.SETTINGS_SCREENSHOT_DIR) await panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/rule-publication-${width}-${locale}.png` });
      await row.getByRole("button", { name: /撤回系统提供|Withdraw publication/, exact: true }).click();
      await root.getByRole("dialog", { name: /撤回系统提供|Withdraw system availability/ }).getByRole("button", { name: /确认撤回|^Withdraw$/, exact: true }).click();
      await expect.poll(async () => (await readerRules()).some((item) => item.id === rule.id)).toBe(false);
      await b.goto(baseURL!);
      await openSettingsNoiseReview(b, scanId);
      const review = b.getByTestId("content-cleanup-dialog");
      if (width < 1024) await review.getByRole("button", { name: /全部候选|All candidates/, exact: true }).click();
      await review.getByRole("checkbox", { name: /处理|Process/ }).check();
      await review.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ }).click();
      await review.getByRole("button", { name: /确认处理 1 项选择|Confirm 1 selections/ }).click();
      await expect(review).not.toBeVisible();
      await expect.poll(async () => (await readerRules()).find((item) => item.id === rule.id)?.held).toBe(true);
      const message = await (await reader.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json();
      expect(message.current_version.display_text).toBe("Before  after.");
      const personal = await settings(b);
      const personalRow = personal.getByRole("article").filter({ hasText: "Synthetic published rule" });
      await expect(personalRow).toHaveCount(1);
      await personalRow.getByRole("button", { name: /Synthetic published rule/ }).click();
      await expect(personalRow.getByText(value, { exact: true })).toHaveCount(1);
      expect((await (await reader.request.get(`${baseURL}/api/content-cleanup/rules/${rule.id}/revisions`)).json()).length).toBe(1);
      await personalRow.getByRole("button", { name: /删除规则|Delete rule/, exact: true }).click();
      await b.getByRole("dialog", { name: /删除个人规则|Delete personal rule/ }).getByRole("button", { name: /确认删除|Confirm delete/, exact: true }).click();
      await expect(personalRow).not.toBeVisible();
      await personal.getByRole("button", { name: /学习文本规则|Learn a text rule/ }).click();
      const editor = personal.getByRole("region", { name: /学习噪声规则|Learn noise rule/ });
      await editor.getByLabel(/规则名称|Rule name/).fill("Synthetic retained rule");
      await editor.getByLabel(/匹配文本|Match text/, { exact: true }).fill(value);
      await editor.getByRole("button", { name: /预览并试运行|Preview and test/ }).click();
      await editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ }).click();
      await expect(editor).not.toBeVisible();
      const retained = (await readerRules()).filter((item) => item.id === rule.id);
      expect(retained).toHaveLength(1);
      expect(retained[0].revision_id).toBe(rule.revision_id);
      expect(retained[0].name).toBe("Synthetic retained rule");
      expect(retained[0].system_provided).toBe(false);
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(b.locator("html")).toHaveAttribute("data-theme", locale === "en-US" ? "dark" : "light");
    } finally { await admin.delete(publicationPath); await author.close(); await reader.close(); await adminContext.close(); await admin.dispose(); }
  });
}
