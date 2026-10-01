import { expect, test } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL settings fixture");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: full-batch health, retained results and real mapping repair`, async ({ browser, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    await context.addInitScript(({ locale }) => localStorage.setItem("chat-reader:user-preferences", JSON.stringify({ theme_mode: locale === "en-US" ? "dark" : "light", locale_mode: locale, updated_at: new Date().toISOString() })), { locale });
    const suffix = `${Date.now()}_${width}_${locale.replaceAll("-", "_")}`;
    const password = "synthetic health browser passphrase";
    const headers = { Origin: baseURL! };
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `health-${suffix}@example.test`, password, confirm_password: password } })).status()).toBe(201);
    const bytes = (empty = false) => Buffer.from(JSON.stringify({ [`fixture_${suffix}`]: true, turns: [
      { speaker: "user", body: empty ? "" : "Synthetic question", alternate: "Synthetic replacement question" },
      { speaker: "assistant", body: "Synthetic answer", alternate: "Synthetic replacement answer" },
    ] }));
    const page = await context.newPage();
    try {
      const initial = await context.request.post(`${baseURL}/api/adaptive-import/sessions`, { headers, multipart: { files: { name: "synthetic-learning.json", mimeType: "application/json", buffer: bytes() } } });
      expect(initial.status()).toBe(201);
      const session = await initial.json();
      const family = session.families[0];
      family.mapping_draft.messages.content = "$.body";
      const learned = await context.request.post(`${baseURL}/api/adaptive-import/sessions/${session.import_id}/families/${family.id}/mapping`, { headers, data: { profile_name: "Synthetic health format", mapping_spec: family.mapping_draft } });
      expect(learned.status()).toBe(200);
      const profileId = (await learned.json()).families[0].matched_profile_id;
      const openRepair = async () => {
        await page.goto(baseURL!);
        if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
        await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
        await page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div")).getByRole("button", { name: /^导入格式|^Import formats/ }).click();
        await page.getByRole("article", { name: "Synthetic health format", exact: true }).getByRole("button", { name: /重新学习／修复|Relearn \/ repair/ }).click();
      };
      await openRepair();
      const groupCount = width === 375 && locale === "zh-CN" ? 23 : 3;
      await page.getByTestId("import-file-input").setInputFiles(Array.from({ length: groupCount }, (_, i) => ({ name: `synthetic-${String(i).padStart(2, "0")}.json`, mimeType: "application/json", buffer: bytes(i === groupCount - 1) })));
      await page.getByTestId("preview-import-button").click();
      const health = page.getByRole("region", { name: /格式健康检查|Format health check/ });
      await health.getByRole("button", { name: /检查已保存格式|Check saved format/ }).click();
      await expect(health.getByRole("status")).toContainText(/1 组需要处理|1 group needs attention/);
      if (groupCount > 20) {
        await health.getByRole("button", { name: /下一页|Next/, exact: true }).click();
        await expect(health.getByText("synthetic-22.json", { exact: false })).toBeVisible();
      }
      await health.getByLabel(/只看失败组|Failed groups only/).check();
      await expect(health.getByText(/EMPTY_CONTENT/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await health.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/format-health-${width}-${locale}.png` });
      await page.reload();
      await openRepair();
      await expect(health.getByRole("status")).toContainText(/1 组需要处理|1 group needs attention/);
      await health.getByRole("button", { name: /打开映射修复|Open mapping repair/ }).click();
      // Health tests the saved version; editing the draft uses the same validator
      // and saving only learns a revision, without importing conversations.
      await expect(page.getByRole("region", { name: "JSON 字段映射", exact: true })).toBeVisible();
      await page.getByRole("combobox", { name: "正文来源", exact: true }).selectOption("$.alternate");
      await page.getByRole("button", { name: "验证映射", exact: true }).click();
      await expect(page.getByText("全部对话通过", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "保存新版本并继续", exact: true }).click();
      await expect(page.getByTestId("commit-import-button")).toBeEnabled();
      const versions = await (await context.request.get(`${baseURL}/api/import-formats/${profileId}/revisions`)).json();
      expect(versions).toHaveLength(2);
      expect(versions[0].mapping_spec.messages.content).toBe("$.alternate");
      expect(versions[1].mapping_spec.messages.content).toBe("$.body");
      const conversations = await (await context.request.get(`${baseURL}/api/conversations`)).json();
      expect(conversations).toHaveLength(0);
    } finally { await context.close(); await admin.dispose(); }
  });
}
