import { expect, test, type Page } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function shot(page: Page, name: string) {
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.getByTestId("content-cleanup-dialog").screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function compactResult(page: Page) {
  const dialog = page.getByTestId("content-cleanup-dialog");
  await expect.poll(async () => (await dialog.getByTestId("content-cleanup-surface").boundingBox())!.height, { timeout: 5_000 }).toBeLessThan(440);
  await expect(dialog.getByRole("button", { name: /扫描整个当前对话|Scan full conversation/ })).toHaveCount(0);
  await expect(dialog.locator('section[aria-label="清理结果"], section[aria-label="Cleanup result"]')).toBeFocused();
}

async function shortResult(page: Page, width: number, action: RegExp, name: string) {
  if (width === 1440) return;
  await page.setViewportSize({ width, height: 360 });
  const dialog = page.getByTestId("content-cleanup-dialog");
  const surface = dialog.getByTestId("content-cleanup-surface");
  const button = dialog.getByRole("button", { name: action, exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  await expect.poll(async () => {
    const bounds = (await button.boundingBox())!;
    const frame = (await surface.boundingBox())!;
    return frame.height <= 318 && bounds.y >= frame.y && bounds.y + bounds.height <= frame.y + frame.height;
  }, { timeout: 5_000 }).toBe(true);
  await expect(dialog.getByRole("heading", { name: /清理噪声|Clean noise/ })).toBeInViewport();
  await shot(page, name);
}

for (const width of [375, 768, 1440]) for (const failure of ["response", "editor"] as const) {
  test(`${width}px: cleanup ${failure} failure preserves confirmed completion`, async ({ browser, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const locale = width === 768 ? "en-US" : "zh-CN";
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const password = "synthetic cleanup completion passphrase";
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL! }, data: {
      email: `cleanup-completion-${Date.now()}@example.test`, password, confirm_password: password,
    } })).status()).toBe(201);
    await settingsAppearance(context.request, baseURL!, locale);
    const source = "Before Cite turn2search1 after.";
    const created = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: {
      title: "Synthetic cleanup completion", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
    } });
    expect(created.status()).toBe(201);
    const conversation = await created.json(), id = conversation.conversation.id, messageId = conversation.messages[1].id;
    const message = async () => (await (await context.request.get(`${baseURL}/api/messages/${messageId}`)).json());
    const before = await message();
    const page = await context.newPage();
    let scanId = "", applyRequests = 0;
    try {
      if (failure === "editor") {
        await page.goto(`${baseURL}/conversations/${id}`);
        if (width < 640) await page.locator("article[data-message-id]").filter({ hasText: source }).getByTestId("mobile-message-actions-trigger").click();
        await page.locator("article[data-message-id]").filter({ hasText: source }).getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ }).click();
        if (width < 640) await expect(page.getByTestId("mobile-message-actions-sheet")).toHaveCount(0);
        const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
        await editor.click(); await page.keyboard.press("Control+Home");
        for (const char of "Before ") { void char; await page.keyboard.press("ArrowRight"); }
        for (const char of "Cite turn2search1") { void char; await page.keyboard.press("Shift+ArrowRight"); }
        await expect(editor).toBeFocused();
        const started = page.waitForResponse((r) => r.url().endsWith("/content-cleanup/scans") && r.request().method() === "POST");
        await page.getByTestId("source-editor-cleanup-selection").click();
        scanId = (await (await started).json()).id;
      } else {
        const started = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers: { Origin: baseURL! }, data: { source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [id] } });
        expect(started.status()).toBe(202); scanId = (await started.json()).id;
        await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}`)).json()).status).toBe("READY");
        await page.goto(baseURL!); await openSettingsNoiseReview(page, scanId);
      }
      const dialog = page.getByTestId("content-cleanup-dialog");
      if (width < 1024) await dialog.getByRole("button", { name: /^(全部候选|All candidates)$/ }).click();
      await dialog.getByRole("checkbox", { name: /处理 Cite turn2search1|Process Cite turn2search1/ }).check();
      await dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ }).click();
      const applyURL = `**/api/content-cleanup/scans/${scanId}/apply`;
      await page.route(applyURL, async (route) => {
        applyRequests += 1;
        const result = await route.fetch();
        expect(result.status()).toBe(200);
        if (failure === "response") await route.abort("failed");
        else {
          await page.route(`**/api/conversations/${id}`, (read) => read.fulfill({ status: 503, json: { detail: "Synthetic reader refresh failure" } }));
          await route.fulfill({ response: result });
        }
      });
      await dialog.getByRole("button", { name: /确认应用 1 项清理|Confirm 1 removals|确认处理 1 项选择|Confirm 1 selections/ }).click();
      await expect.poll(async () => (await message()).current_version.display_text).toBe("Before  after.");
      if (failure === "response") {
        const outcomeURL = `**/api/content-cleanup/scans/${scanId}/outcome`;
        await page.route(outcomeURL, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic outcome read failure" } }));
        await dialog.getByRole("button", { name: /核对清理结果|Check cleanup result/ }).click({ timeout: 5_000 });
        await expect(dialog.getByText(/暂时无法确认结果|The result could not be confirmed/)).toBeVisible();
        await shot(page, `completion-check-retry-${width}`);
        await page.unroute(outcomeURL);
        await dialog.getByRole("button", { name: /核对清理结果|Check cleanup result/ }).click({ timeout: 5_000 });
        await expect(dialog.getByText(/清理已完成|Cleanup completed/)).toBeVisible();
        await shot(page, `completion-response-${width}`);
        await compactResult(page);
        await page.reload();
        if (width < 768) await page.getByTestId("mobile-sidebar-button").click();
        await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
        const task = page.getByTestId("task-center-panel").locator('[data-task-row="content_noise_scan"]').filter({ hasText: /清理|Cleanup/ }).first();
        await task.getByRole("button", { name: /查看清理结果|View cleanup result/ }).click();
        await expect(dialog.getByText(/清理已完成|Cleanup completed/)).toBeVisible();
        await shot(page, `completion-reentry-${width}`);
        await compactResult(page);
        await shortResult(page, width, /完成|Done/, `completion-short-reentry-${width}`);
        await dialog.getByRole("button", { name: /^(完成|Done)$/ }).click();
        await expect(dialog).not.toBeVisible();
      } else {
        await expect(dialog.getByText(/清理已完成|Cleanup completed/)).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByRole("button", { name: /重新读取正文|Reload source/ })).toBeEnabled();
        await dialog.getByRole("button", { name: /重新读取正文|Reload source/ }).click();
        await expect(dialog.getByRole("button", { name: /重新读取正文|Reload source/ })).toBeEnabled();
        await expect(dialog.getByText(/正文重新读取失败|The source could not reload/)).toBeVisible();
        await shot(page, `completion-editor-${width}`);
        // The retry remains the focused action after a failed read.
        await expect.poll(async () => (await dialog.getByTestId("content-cleanup-surface").boundingBox())!.height, { timeout: 5_000 }).toBeLessThan(440);
        await expect(dialog.getByRole("button", { name: /扫描整个当前对话|Scan full conversation/ })).toHaveCount(0);
        await shortResult(page, width, /重新读取正文|Reload source/, `completion-short-editor-${width}`);
        await page.unroute(`**/api/conversations/${id}`);
        await dialog.getByRole("button", { name: /重新读取正文|Reload source/ }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByTestId("source-editor-codemirror")).toContainText("Before  after.");
        await expect(page.getByTestId("source-editor-codemirror")).not.toContainText("Cite turn2search1");
      }
      expect(applyRequests).toBe(1);
      const after = await message();
      expect(after.current_version.id).not.toBe(before.current_version.id);
      expect(after.current_version.edit_type).toBe("content_cleanup");
    } finally { await context.close(); await admin.dispose(); }
  });
}
