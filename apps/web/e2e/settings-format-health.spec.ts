import { expect, test } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL settings fixture");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: full-batch health, retained results and real mapping repair`, async ({ browser, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const suffix = `${Date.now()}_${width}_${locale.replaceAll("-", "_")}`;
    const password = "synthetic health browser passphrase";
    const headers = { Origin: baseURL! };
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `health-${suffix}@example.test`, password, confirm_password: password } })).status()).toBe(201);
    await settingsAppearance(context.request, baseURL!, locale);
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
      // Stable identities can already expose a published revision from another
      // account. Repair must add exactly one visible version and retain every
      // version this account could use before the repair.
      const baselineResponse = await context.request.get(`${baseURL}/api/import-formats/${profileId}/revisions`);
      expect(baselineResponse.ok()).toBe(true);
      const baseline = await baselineResponse.json() as Array<{ id: string; mapping_spec: { messages: { content: string } } }>;
      expect(baseline[0].mapping_spec.messages.content).toBe("$.body");
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
      await expect(page.getByRole("region", { name: (locale === "zh-CN" ? "JSON 字段映射" : "JSON field mapping"), exact: true })).toBeVisible();
      await page.getByRole("combobox", { name: (locale === "zh-CN" ? "正文来源" : "Content source"), exact: true }).selectOption("$.alternate");
      await page.getByRole("button", { name: (locale === "zh-CN" ? "验证映射" : "Validate mapping"), exact: true }).click();
      await expect(page.getByText((locale === "zh-CN" ? "全部对话通过" : "All conversations validated"), { exact: true })).toBeVisible();
      await page.getByRole("button", { name: (locale === "zh-CN" ? "保存新版本并继续" : "Save new version & continue"), exact: true }).click();
      await expect(page.getByTestId("commit-import-button")).toBeEnabled();
      const versionsResponse = await context.request.get(`${baseURL}/api/import-formats/${profileId}/revisions`);
      expect(versionsResponse.ok()).toBe(true);
      const versions = await versionsResponse.json() as typeof baseline;
      const baselineIds = baseline.map((version) => version.id);
      expect(versions).toHaveLength(baseline.length + 1);
      expect(versions.filter((version) => !baselineIds.includes(version.id))).toHaveLength(1);
      expect(versions.map((version) => version.id)).toEqual(expect.arrayContaining(baselineIds));
      expect(versions[0].mapping_spec.messages.content).toBe("$.alternate");
      expect(versions.find((version) => version.id === baseline[0].id)?.mapping_spec.messages.content).toBe("$.body");
      const conversations = await (await context.request.get(`${baseURL}/api/conversations`)).json();
      expect(conversations).toHaveLength(0);
    } finally { await context.close(); await admin.dispose(); }
  });
}
