import { expect, test, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function editor(page: Page, baseURL: string, width: number) {
  await page.goto(baseURL);
  if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
  await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
  await page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"))
    .getByRole("button", { name: /噪声规则库|Noise rule library/ }).click();
  const panel = page.getByRole("dialog", { name: /噪声规则库|Noise rule library/, exact: true });
  const row = panel.locator("article").filter({ hasText: "Synthetic original" });
  await row.getByRole("button", { name: /Synthetic original/ }).click();
  await row.getByRole("button", { name: /编辑并试运行|Edit and test/ }).click();
  return { panel, form: panel.getByRole("region", { name: /学习噪声规则|Learn noise rule/ }) };
}

for (const width of [375, 768, 1440]) for (const beforeTrial of [false, true]) {
  test(`${width}px: name-only concurrent edit ${beforeTrial ? "before trial on disabled rule" : "after trial"} keeps draft until explicit rebase`, async ({ browser, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const locale = width === 768 ? "en-US" : "zh-CN", password = "synthetic name concurrency passphrase";
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const headers = { Origin: baseURL! };
    try {
      expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
        email: `rule-name-${Date.now()}@example.test`, password, confirm_password: password,
      } })).status()).toBe(201);
      await settingsAppearance(context.request, baseURL!, locale);
      const created = await context.request.post(`${baseURL}/api/content-cleanup/rules`, { headers, data: {
        name: "Synthetic original", match_value: `SYNTHETIC_NAME_${Date.now()}`,
      } });
      expect(created.status()).toBe(201);
      const original = await created.json();
      if (beforeTrial) expect((await context.request.patch(`${baseURL}/api/content-cleanup/rules/${original.id}`, { headers, data: { status: "DISABLED" } })).status()).toBe(200);
      const firstPage = await context.newPage(), secondPage = await context.newPage();
      const first = await editor(firstPage, baseURL!, width), second = await editor(secondPage, baseURL!, width);
      await first.form.getByLabel(/规则名称|Rule name/, { exact: true }).fill("Synthetic first window");
      await second.form.getByLabel(/规则名称|Rule name/, { exact: true }).fill("Synthetic kept draft");
      const trial = (page: typeof first) => page.form.getByRole("button", { name: /预览并试运行|Preview and test/ });
      const save = (page: typeof first) => page.form.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ });
      if (!beforeTrial) { await trial(second).click(); await expect(save(second)).toBeEnabled(); }
      await trial(first).click(); await save(first).click(); await expect(first.form).not.toBeVisible();
      if (beforeTrial) await trial(second).click(); else await save(second).click();
      await expect(second.form.getByRole("alert")).toContainText(/规则已在其他窗口更改|Rule changed on another device/);
      await expect(second.form.getByLabel(/规则名称|Rule name/, { exact: true })).toHaveValue("Synthetic kept draft");
      const rules = async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/rules`)).json()) as { id: string; name: string; revision_id: string; status: string }[];
      expect((await rules()).find(rule => rule.id === original.id)?.name).toBe("Synthetic first window");
      await second.form.getByRole("button", { name: /比较服务器版本|Compare saved version/ }).click();
      const comparison = second.form.getByRole("region", { name: /规则版本比较|Rule version comparison/ });
      await expect(comparison).toContainText("Synthetic first window");
      await expect(comparison).toContainText("Synthetic kept draft");
      if (process.env.SETTINGS_SCREENSHOT_DIR) await second.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/name-compare-${width}-${beforeTrial}.png` });
      await comparison.getByRole("button", { name: /保留草稿，以此版本重新试运行|Keep draft and use this base revision/ }).click();
      await expect(trial(second)).toBeFocused();
      await trial(second).click(); await save(second).click(); await expect(second.form).not.toBeVisible();
      expect((await rules()).find(rule => rule.id === original.id)).toMatchObject({ name: "Synthetic kept draft", revision_id: original.revision_id, status: beforeTrial ? "DISABLED" : "ACTIVE" });
      expect(await (await context.request.get(`${baseURL}/api/content-cleanup/rules/${original.id}/revisions`)).json()).toHaveLength(1);
      expect(await secondPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await second.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/name-saved-${width}-${beforeTrial}.png` });
    } finally { await context.close(); await admin.dispose(); }
  });
}
