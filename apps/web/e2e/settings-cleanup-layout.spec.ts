import { expect, test } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

for (const width of [375, 768, 1440]) {
  test(`${width}px: candidate details disclose without changing saved choices`, async ({ browser, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const locale = width === 768 ? "en-US" : "zh-CN";
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const password = "synthetic cleanup layout passphrase";
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL! }, data: {
      email: `cleanup-layout-${Date.now()}@example.test`, password, confirm_password: password,
    } })).status()).toBe(201);
    await settingsAppearance(context.request, baseURL!, locale);
    const source = Array.from({ length: 4 }, (_, i) => `Paragraph ${i}.\n\nBefore Cite turn${i+10}search1 after.\n\nRetained context ${i}.`).join("\n\n");
    const created = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: {
      title: "Synthetic cleanup layout", messages: [{ role: "user", content_markdown: "Question" }, { role: "assistant", content_markdown: source }],
    } });
    expect(created.status()).toBe(201);
    const { conversation, messages } = await created.json();
    const second = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: {
      title: "Synthetic second source", messages: [{ role: "user", content_markdown: "Another question" }, {
        role: "assistant", content_markdown: "Before Cite turn20search1 after.\n\nBefore Cite turn21search1 after.\n\nBefore Cite turn22search1 after.",
      }],
    } });
    expect(second.status()).toBe(201);
    const secondConversation = (await second.json()).conversation;
    const started = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers: { Origin: baseURL! }, data: {
      source: "BATCH", scope_type: "SELECTED_CONVERSATIONS", conversation_ids: [conversation.id, secondConversation.id],
    } });
    expect(started.status()).toBe(202);
    const scanId = (await started.json()).id;
    const scan = async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}`)).json());
    await expect.poll(async () => (await scan()).status).toBe("READY");
    const page = await context.newPage();
    try {
      await page.goto(baseURL!); await openSettingsNoiseReview(page, scanId);
      const dialog = page.getByTestId("content-cleanup-dialog");
      if (width < 1024) await dialog.getByRole("button", { name: /^(全部候选|All candidates)$/ }).click();
      await expect(dialog.locator("article")).toHaveCount(7);
      const occurrences = await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}/occurrences`)).json();
      for (const occurrence of occurrences) {
        const row = dialog.locator("article").filter({ has: page.getByRole("checkbox", { name: `${locale === "zh-CN" ? "处理" : "Process"} ${occurrence.match_text}`, exact: true }) });
        await expect(row.getByText(occurrence.conversation_title, { exact: true })).toBeVisible();
        const match = row.getByTestId("content-cleanup-match");
        await expect(match).toHaveText(occurrence.match_text);
        expect(await match.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      }
      if (process.env.SETTINGS_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/layout-summary-${width}.png` });
      await expect(dialog.getByRole("button", { name: /以后忽略这种情况|Ignore this case in future/ })).toHaveCount(0);
      const candidate = dialog.locator("article").first();
      expect((await candidate.boundingBox())!.height).toBeLessThan(210);
      const toggle = candidate.getByRole("button", { name: /上下文与规则|Context and rules/ });
      await toggle.focus(); await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const occurrence = occurrences[0];
      await expect(candidate.getByTestId("cleanup-context")).toHaveText(occurrence.context_before + occurrence.match_text + occurrence.context_after);
      await expect(candidate.getByRole("button", { name: /以后忽略这种情况|Ignore this case in future/ })).toBeVisible();
      await candidate.getByRole("checkbox").check();
      await expect.poll(async () => (await scan()).delete_count).toBe(1);
      await expect(candidate.getByRole("button", { name: /记住此类噪声|Remember this noise/ })).toBeEnabled();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      if (process.env.SETTINGS_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/layout-detail-${width}.png` });
      await toggle.focus(); await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(candidate.getByRole("checkbox")).toBeChecked();
      const message = (await (await context.request.get(`${baseURL}/api/messages/${messages[1].id}`)).json());
      expect(message.current_version.display_text).toBe(source);
    } finally { await context.close(); await admin.dispose(); }
  });
}
