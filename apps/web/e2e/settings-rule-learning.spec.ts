import { expect, test } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated settings PostgreSQL fixture and worker");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: explicit rule learning, version editing and personal exception`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const password = "synthetic rule browser passphrase";
    const email = `rules-${Date.now()}-${width}@example.test`;
    const headers = { Origin: baseURL! };
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email, password, confirm_password: password } })).status()).toBe(201);
    await settingsAppearance(context.request, baseURL!, locale);
    const page = await context.newPage();
    const marker = "\ue200cite\ue202turn12search4\ue201";
    const unique = `${Date.now()}_${width}_${locale}`;
    const trailer = `SYNTHETIC_TRAILER_${unique}`;
    const replacement = `SYNTHETIC_UPDATED_${unique}`;
    const remote = `SYNTHETIC_REMOTE_${unique}`;
    const source = `Synthetic response ${marker} remains. ${trailer}`;
    const conversation = await (await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic learning review", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }] } })).json();
    const scanResponse = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers, data: { source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.conversation.id] } });
    expect(scanResponse.status()).toBe(202);
    const scanId = (await scanResponse.json()).id;
    const scan = async (id = scanId) => (await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${id}`)).json());
    const rescan = async () => {
      const response = await context.request.post(`${baseURL}/api/content-cleanup/scans/${scanId}/rescan`, { headers });
      expect(response.status()).toBe(202);
      const id = (await response.json()).id;
      await expect.poll(async () => (await scan(id)).status).toBe("READY");
      return id;
    };
    const rules = async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/rules`)).json()) as { id: string; name: string; revision: number; match_value: string; status: string }[];
    try {
      await expect.poll(async () => (await scan()).status).toBe("READY");
      await page.goto(baseURL!);
      await openSettingsNoiseReview(page, scanId);
      const dialog = page.getByTestId("content-cleanup-dialog");
      if (width < 1024) await dialog.getByRole("button", { name: /全部候选|All candidates/, exact: true }).click();
      await dialog.getByRole("button", { name: /以后忽略这种情况|Ignore this case in future/ }).click();
      await expect(dialog.getByRole("region", { name: /个人忽略例外|Personal exception/ })).toBeVisible();
      expect((await (await context.request.get(`${baseURL}/api/content-cleanup/exceptions`)).json()).total).toBe(0);
      await dialog.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ }).click();
      await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/exceptions`)).json()).total).toBe(1);
      const ignoredScan = await rescan();
      expect((await scan(ignoredScan)).occurrence_count).toBe(0);
      await dialog.getByRole("button", { name: /记住此类噪声|Remember this noise/, exact: true }).click();
      const editor = dialog.getByRole("region", { name: /学习噪声规则|Learn noise rule/ });
      await editor.getByLabel(/规则名称|Rule name/).fill("Synthetic learned rule");
      await editor.getByLabel(/匹配文本|Match text/, { exact: true }).fill(trailer);
      // Escape must retain the draft when the discard dialog is cancelled.
      await page.keyboard.press("Escape");
      const discard = page.getByRole("dialog").filter({ has: page.getByText(/放弃未保存的规则？|Discard unsaved rule\?/, { exact: true }) });
      await expect(discard).toBeVisible();
      await expect(page.getByTestId("task-center-panel")).toBeVisible();
      await expect(editor.getByLabel(/匹配文本|Match text/, { exact: true })).toHaveValue(trailer);
      await discard.getByRole("button", { name: /取消|Cancel/, exact: true }).click();
      await expect(editor.getByLabel(/匹配文本|Match text/, { exact: true })).toHaveValue(trailer);
      await editor.getByRole("button", { name: /预览并试运行|Preview and test/ }).click();
      await expect(editor.getByRole("status")).toContainText(/1 项命中|1 matches/);
      expect((await rules()).some((rule) => rule.name === "Synthetic learned rule")).toBe(false);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/rule-learning-${width}-${locale}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ }).click();
      await expect(editor).not.toBeVisible();
      await expect.poll(async () => (await rules()).find((rule) => rule.name === "Synthetic learned rule")?.revision).toBe(1);
      const actual = await (await context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json();
      expect(actual.current_version.display_text).toBe(source);
      const learnedScan = await rescan();
      const learnedHits = await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${learnedScan}/occurrences`)).json();
      expect(learnedHits.map((hit: { match_text: string }) => hit.match_text)).toEqual([trailer]);
      await dialog.getByRole("button", { name: /^规则库$|^Rules$/ }).click();
      await dialog.getByRole("button", { name: /撤销此例外|Revoke exception/ }).click();
      await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/exceptions`)).json()).total).toBe(0);
      const row = dialog.locator("article").filter({ hasText: "Synthetic learned rule" });
      await row.getByRole("button", { name: /Synthetic learned rule/ }).click();
      await row.getByRole("button", { name: /编辑并试运行|Edit and test/ }).click();
      const edit = dialog.getByRole("region", { name: /学习噪声规则|Learn noise rule/ });
      await edit.getByLabel(/匹配文本|Match text/, { exact: true }).fill(replacement);
      await edit.getByRole("button", { name: /预览并试运行|Preview and test/ }).click();
      await expect(edit.getByRole("status")).toContainText(/0 项命中|0 matches/);
      const conflictCase = width === 1440 && locale === "en-US";
      if (conflictCase) {
        const stored = (await rules()).find((rule) => rule.name === "Synthetic learned rule")!;
        expect((await context.request.patch(`${baseURL}/api/content-cleanup/rules/${stored.id}`, { headers, data: { match_value: remote, base_revision: 1 } })).status()).toBe(200);
        await edit.getByRole("button", { name: "Confirm personal rule" }).click();
        await expect(edit.getByRole("alert")).toContainText("Rule changed on another device");
        await expect(edit.getByRole("textbox", { name: "Match text", exact: true })).toHaveValue(replacement);
        await edit.getByRole("button", { name: "Compare saved version" }).click();
        await expect(edit.locator("pre").filter({ hasText: remote })).toBeVisible();
        await edit.getByRole("button", { name: "Keep draft and use this base revision" }).click();
        await edit.getByRole("button", { name: "Preview and test" }).click();
        await expect(edit.getByRole("button", { name: "Confirm personal rule" })).toBeVisible();
      }
      await edit.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ }).click();
      await expect(edit).not.toBeVisible();
      await expect.poll(async () => (await rules()).find((rule) => rule.name === "Synthetic learned rule")?.revision).toBe(conflictCase ? 3 : 2);
      const updated = (await rules()).find((rule) => rule.name === "Synthetic learned rule")!;
      const history = await (await context.request.get(`${baseURL}/api/content-cleanup/rules/${updated.id}/revisions`)).json();
      expect(history.map((revision: { match_value: string }) => revision.match_value)).toEqual(conflictCase ? [replacement, remote, trailer] : [replacement, trailer]);
      await dialog.locator("article").filter({ hasText: "Synthetic learned rule" }).getByRole("button", { name: /个人停用|Disable for me/ }).click();
      await expect.poll(async () => (await rules()).find((rule) => rule.id === updated.id)?.status).toBe("DISABLED");
      const restored = await rescan();
      expect((await scan(restored)).occurrence_count).toBe(1);
      expect((await (await context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json()).current_version.id).toBe(actual.current_version.id);
    } finally { await context.close(); await admin.dispose(); }
  });
}
