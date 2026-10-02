import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });

test.describe("learned format ownership and publication", () => {
  test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires disposable PostgreSQL settings fixture");
  for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
    test(`${width}px ${locale}: learn, publish, use, withdraw and retain`, async ({ browser, playwright, baseURL }) => {
      test.setTimeout(150_000);
      const admin = await settingsAdmin(playwright.request, baseURL!);
      const previous = await (await admin.get("/api/admin/import-formats?limit=100")).json() as { items: Array<{ id: string; name: string; published_revision_id: string | null }> };
      for (const item of previous.items) if (item.published_revision_id && item.name === "Synthetic shared format") await admin.delete(`/api/admin/import-formats/${item.id}/publication`);
      const suffix = `${Date.now()}_${width}`;
      const password = "synthetic format browser passphrase";
      const userContext = async (kind: string) => {
        const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
        context.setDefaultTimeout(20_000);
        const email = `formats-${kind}-${suffix}@example.test`;
        const result = await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL! }, data: { email, password, confirm_password: password } });
        expect(result.status()).toBe(201);
        expect((await context.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).ok()).toBeTruthy();
        await settingsAppearance(context.request, baseURL!, locale);
        return context;
      };
      const author = await userContext("author");
      const reader = await userContext("reader");
      const adminContext = await browser.newContext({ storageState: await admin.storageState(), viewport: { width, height: 900 }, locale });
      adminContext.setDefaultTimeout(20_000);
      await settingsAppearance(adminContext.request, baseURL!, locale);
      const a = await author.newPage(), b = await reader.newPage(), root = await adminContext.newPage();
      let learnedProfileId: string | null = null;
      const bytes = Buffer.from(JSON.stringify({ ["fixture_" + suffix]: true, title: "Synthetic format trial", turns: [{ speaker: "human", body: "Synthetic question" }, { speaker: "ai", body: "Synthetic answer" }] }));
      const startImport = async (page: Page) => {
        await page.goto(`${baseURL}/`);
        if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
        await page.getByRole("button", { name: /Import data|导入数据/ }).click();
        await page.getByTestId("import-file-input").setInputFiles({ name: "synthetic-format.json", mimeType: "application/json", buffer: bytes });
        await page.getByTestId("preview-import-button").click();
      };
      const formats = async (request: APIRequestContext) => (await (await request.get(`${baseURL}/api/import-formats`)).json()) as Array<{ id: string; kind: string; name: string; held: boolean; system_provided: boolean; current_revision_id: string }>;
      const openSettings = async (page: Page, system = false) => {
        await page.goto(`${baseURL}/`);
        if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
        await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
        const menu = page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"));
        await menu.getByRole("button", { name: system ? /系统导入格式|System import formats/ : /^导入格式|^Import formats/ }).click();
        return page.getByRole("dialog", { name: system ? /系统导入格式|System import formats/ : /导入格式|Import formats/, exact: true });
      };
      try {
        await startImport(a);
        await a.getByRole("button", { name: (locale === "zh-CN" ? "设置格式" : "Map format"), exact: true }).click();
        await a.getByLabel((locale === "zh-CN" ? "保存为导入格式" : "Format name")).fill("Synthetic personal format");
        await expect(a.getByRole("heading", { name: locale === "zh-CN" ? "设置新的导入格式" : "Learn a new import format", exact: true })).toBeVisible();
        if (locale === "en-US") expect(/[\u4e00-\u9fff]/.test(await a.getByRole("dialog", { name: "Import data", exact: true }).innerText()), "English mapping has no untranslated interface text").toBe(false);
        await a.getByTestId("import-dialog-close").click();
        const discard = a.getByRole("dialog", { name: locale === "zh-CN" ? "放弃未保存的映射？" : "Discard unsaved mapping?", exact: true });
        await expect(discard).toBeVisible();
        await discard.getByRole("button", { name: /^(取消|Cancel)$/ }).click();
        await expect(a.getByLabel(locale === "zh-CN" ? "保存为导入格式" : "Format name")).toHaveValue("Synthetic personal format");
        await expect(a.getByTestId("import-dialog-close")).toBeFocused();
        let releaseValidation: (() => void) | undefined;
        if (width === 1440 && locale === "en-US") {
          await a.route("**/mapping/preview", (route) => route.abort("failed"));
          await a.getByRole("button", { name: "Validate mapping", exact: true }).click();
          await expect(a.getByRole("alert").filter({ hasText: "Cannot connect to the server. Check your network and retry; your input is retained." })).toBeVisible();
          await expect(a.getByLabel("Format name")).toHaveValue("Synthetic personal format");
          await a.unroute("**/mapping/preview");
          const pause = new Promise<void>((resolve) => { releaseValidation = resolve; });
          await a.route("**/mapping/preview", async (route) => { const response = await route.fetch(); await pause; await route.fulfill({ response }); });
        }
        await a.getByRole("button", { name: (locale === "zh-CN" ? "验证映射" : "Validate mapping"), exact: true }).click();
        if (releaseValidation) {
          await expect(a.getByLabel("Format name")).toBeDisabled();
          await expect(a.getByTestId("import-dialog-close")).toBeDisabled();
          releaseValidation();
        }
        await expect(a.getByText((locale === "zh-CN" ? "全部对话通过" : "All conversations validated"), { exact: true })).toBeVisible();
        if (process.env.SETTINGS_SCREENSHOT_DIR) await a.getByRole("dialog", { name: /Import data|导入数据/ }).screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/mapping-${width}-${locale}.png` });
        await a.getByRole("button", { name: (locale === "zh-CN" ? "保存映射并继续" : "Learn mapping & continue"), exact: true }).click();
        await expect(a.getByTestId("commit-import-button")).toBeEnabled();
        const learned = (await formats(author.request)).filter((item) => item.kind === "LEARNED");
        expect(learned).toHaveLength(1);
        const profile = learned[0];
        learnedProfileId = profile.id;
        expect(profile.held).toBe(true);
        expect((await formats(reader.request)).some((item) => item.id === profile.id)).toBe(false);
        const panel = await openSettings(root, true);
        const candidates = await (await admin.get("/api/admin/import-formats?limit=100")).json() as { items: Array<{ id: string; name: string }> };
        const position = candidates.items.findIndex((item) => item.id === profile.id);
        expect(position).toBeGreaterThanOrEqual(0);
        // Freshly learned candidate is first; its identity is never shown in UI.
        const row = panel.getByRole("article").first();
        await row.getByLabel(/系统显示名称|System display name/).fill("Synthetic shared format");
        await row.getByText(/检查映射与验证摘要|Review mapping and validation/).click();
        await expect(row.getByText(/全批次校验通过|Full batch validated/, { exact: true })).toBeVisible();
        await row.getByRole("button", { name: /发布所选版本|Publish selected version/, exact: true }).click();
        await root.getByRole("dialog", { name: /发布此格式版本|Publish this format version/ }).getByRole("button", { name: /确认发布|^Publish$/, exact: true }).click();
        await expect(row.getByRole("status")).toHaveText(/系统提供状态已更新|Publication updated/);
        await expect.poll(async () => (await formats(reader.request)).find((item) => item.id === profile.id)?.system_provided).toBe(true);
        await startImport(b);
        await expect(b.getByTestId("commit-import-button")).toBeEnabled();
        await b.getByTestId("commit-import-button").click();
        await expect(b.getByTestId("import-completion-summary")).toBeVisible();
        await expect.poll(async () => (await formats(reader.request)).find((item) => item.id === profile.id)?.held).toBe(true);
        const personal = await openSettings(b);
        const personalRow = personal.getByRole("article", { name: "Synthetic shared format", exact: true });
        await expect(personalRow).toHaveCount(1);
        await expect(personalRow.getByText(/已学习 · 系统提供|Learned · System provided/)).toBeVisible();
        await personalRow.getByRole("button", { name: /版本与个人设置|Versions and preferences/ }).click();
        await personalRow.getByLabel(/个人显示名称|Your display name/).fill("Synthetic retained format");
        await personalRow.getByRole("button", { name: /保存名称|Save name/ }).click();
        await expect.poll(async () => (await formats(reader.request)).find((item) => item.id === profile.id)?.name).toBe("Synthetic retained format");
        await row.getByRole("button", { name: /撤回系统提供|Withdraw publication/, exact: true }).click();
        await root.getByRole("dialog", { name: /撤回系统提供|Withdraw system availability/ }).getByRole("button", { name: /确认撤回|^Withdraw$/, exact: true }).click();
        await expect(row.getByRole("button", { name: /撤回系统提供|Withdraw publication/, exact: true })).toHaveCount(0);
        await b.reload();
        const retained = (await formats(reader.request)).filter((item) => item.id === profile.id);
        expect(retained).toHaveLength(1);
        expect(retained[0].held).toBe(true);
        expect(retained[0].system_provided).toBe(false);
        const after = await openSettings(b);
        const retainedRow = after.getByRole("article", { name: "Synthetic retained format", exact: true });
        await expect(retainedRow).toBeVisible();
        expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(b.locator("html")).toHaveAttribute("data-theme", locale === "en-US" ? "dark" : "light");
        await retainedRow.scrollIntoViewIfNeeded();
        if (process.env.SETTINGS_SCREENSHOT_DIR) await after.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/formats-${width}-${locale}.png` });
        await retainedRow.getByRole("button", { name: /重新学习／修复|Relearn \/ repair/ }).focus();
        await b.keyboard.press("Enter");
        await expect(b.getByTestId("import-file-input")).toBeAttached();
      } finally { if (learnedProfileId) await admin.delete(`/api/admin/import-formats/${learnedProfileId}/publication`); await author.close(); await reader.close(); await adminContext.close(); await admin.dispose(); }
    });
  }
});
