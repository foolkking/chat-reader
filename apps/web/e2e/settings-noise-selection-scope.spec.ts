import { expect, test, type APIRequest, type Browser, type Page } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");
const marker = "\ue200cite\ue202turn12search4\ue201";

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const password = "synthetic scope review passphrase", headers = { Origin: baseURL };
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `noise-scope-${Date.now()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const sources = [("Before " + marker + " after.\n\n").repeat(51) + `Protected \`${marker}\`.`, `Other ${marker} end.`];
  const conversations = [];
  for (const [index, source] of sources.entries()) {
    const response = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
      title: `Synthetic scope ${index + 1}`, messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
    } });
    expect(response.status()).toBe(201);
    conversations.push(await response.json());
  }
  const response = await context.request.post(`${baseURL}/api/content-cleanup/rules/scan-existing`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, data: {} });
  expect(response.status()).toBe(202);
  const scanId = (await response.json()).id, url = `${baseURL}/api/content-cleanup/scans/${scanId}`;
  const scan = async () => (await (await context.request.get(url)).json());
  await expect.poll(async () => (await scan()).status).toBe("READY");
  const page = await context.newPage();
  await page.goto(baseURL); await openSettingsNoiseReview(page, scanId);
  const dialog = page.getByTestId("content-cleanup-dialog");
  async function openGroup(index: number) {
    if (width < 1024 && await dialog.getByRole("button", { name: /^(返回分组|Back to groups)$/ }).isVisible()) {
      await dialog.getByRole("button", { name: /^(返回分组|Back to groups)$/ }).click();
    }
    await dialog.getByRole("button").filter({ hasText: `Synthetic scope ${index}` }).click();
    await expect(dialog.getByRole("region", { name: /当前审查范围|Current review scope/ })).toContainText(`Synthetic scope ${index}`);
  }
  return { admin, context, page, dialog, scanId, url, scan, conversations, sources, openGroup };
}

async function shot(page: Page, name: string) {
  const dialog = page.getByTestId("content-cleanup-dialog");
  if (process.env.SETTINGS_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: other-group selections are explicit, navigable and persisted across pages`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    try {
      await expect(f.dialog.getByRole("button").filter({ hasText: "Synthetic scope 1" })).toContainText(/1 项受保护|1 protected/);
      await f.openGroup(1);
      await f.dialog.getByRole("button", { name: /选择全部匹配项|Select all matching/ }).click();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(51);
      await expect(f.dialog.getByRole("region", { name: /当前审查范围|Current review scope/ })).toContainText(/此范围已选 51 项|51 selected in this scope/);
      await f.openGroup(2);
      await expect(f.dialog.getByText(/含其他分组的 51 项选择|Includes 51 selections in other groups/)).toBeVisible();
      await f.dialog.getByRole("checkbox", { name: /只看已选项|Selected only/ }).check();
      await expect(f.dialog.getByText(/当前筛选没有候选|No candidates in this filter/)).toBeVisible();
      await shot(f.page, `empty-scope-${width}`);
      const all = f.dialog.getByRole("button", { name: /查看全部已选项|View all selections/ });
      await all.focus(); await f.page.keyboard.press("Enter");
      const scope = f.dialog.getByRole("region", { name: /当前审查范围|Current review scope/ });
      await expect(scope).toContainText(/51 个候选|51 candidates/);
      await expect(f.dialog.getByLabel(/^(审查候选|Review candidates)$/)).toBeFocused();
      const checks = f.dialog.getByRole("checkbox", { name: /处理|Process/ });
      await expect(checks).toHaveCount(50);
      const detail = f.dialog.getByLabel(/^(审查候选|Review candidates)$/);
      await detail.getByRole("button", { name: /^(下一页|Next)$/ }).click();
      await expect(checks).toHaveCount(1); await expect(checks).toBeChecked();
      await f.dialog.getByRole("checkbox", { name: /只看已选项|Selected only/ }).uncheck();
      await f.openGroup(2);
      await f.dialog.getByRole("checkbox", { name: /处理|Process/ }).check();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(52);
      await expect(f.dialog.getByText(/含其他分组的 51 项选择|Includes 51 selections in other groups/)).toBeVisible();
      await shot(f.page, `cross-group-${width}`);
      if (width === 375) {
        await f.page.setViewportSize({ width, height: 520 });
        await f.dialog.getByRole("button", { name: "预览 52 项清理" }).scrollIntoViewIfNeeded();
        await shot(f.page, "cross-group-short-375");
      }
      await f.page.keyboard.press("Escape");
      await expect(f.dialog).not.toBeVisible();
      await f.page.getByTestId("task-center-panel").locator(`[data-cleanup-scan-id="${f.scanId}"]`)
        .getByRole("button", { name: /^(Open review|打开审查)$/ }).click();
      await f.openGroup(2);
      await expect(f.dialog.getByText(/含其他分组的 51 项选择|Includes 51 selections in other groups/)).toBeVisible();
      await f.dialog.getByRole("button", { name: /预览 52 项清理|Preview 52 removals/ }).click();
      await expect(f.dialog.getByText(/2 个对话 · 2 条消息 · 52 个已选片段|2 conversations · 2 messages · 52 selected fragments/)).toBeVisible();
      await f.dialog.getByRole("button", { name: /确认处理 52 项选择|Confirm 52 selections/ }).click();
      await expect(f.dialog).not.toBeVisible();
      for (const [index, conversation] of f.conversations.entries()) {
        const message = await (await f.context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json();
        expect(message.current_version.display_text).toBe(index === 0 ? "Before  after.\n\n".repeat(51) + `Protected \`${marker}\`.` : "Other  end.");
      }
    } finally { await f.context.close(); await f.admin.dispose(); }
  });
}

for (const legacy of [false, true]) {
  test(`375px: ${legacy ? "older response" : "failed scoped read"} keeps a safe route to all selections`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, 375);
    try {
      await f.openGroup(1);
      await f.dialog.getByRole("button", { name: /选择全部匹配项/ }).click();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(51);
      const pattern = `**/api/content-cleanup/scans/${f.scanId}/review?*`;
      await f.page.route(pattern, async route => {
        if (!route.request().url().includes(f.conversations[1].conversation.id)) return route.continue();
        if (!legacy) return route.fulfill({ status: 503, json: { detail: "Synthetic review read failure" } });
        const response = await route.fetch(), body = await response.json();
        delete body.selection_summary;
        return route.fulfill({ response, json: body });
      });
      await f.openGroup(2);
      if (!legacy) await expect(f.dialog.getByRole("alert")).toBeVisible();
      await expect(f.dialog.getByText("预览包含本次扫描的全部选择", { exact: true })).toBeVisible();
      await expect(f.dialog.getByText("含其他分组的 51 项选择", { exact: true })).toHaveCount(0);
      await shot(f.page, legacy ? "legacy-summary" : "failed-summary");
      // A background review refresh may still be finishing route.fetch().
      // Drain it before removing the handler or navigating to all selections.
      await f.page.unrouteAll({ behavior: "wait" });
      await f.dialog.getByRole("button", { name: "查看全部已选项", exact: true }).click();
      await expect(f.dialog.getByRole("region", { name: "当前审查范围" })).toContainText("此范围已选 51 项");
      expect((await f.scan()).delete_count).toBe(51);
      const source = await (await f.context.request.get(`${baseURL}/api/messages/${f.conversations[0].messages[1].id}`)).json();
      expect(source.current_version.display_text).toBe(f.sources[0]);
    } finally { await f.page.unrouteAll({ behavior: "wait" }); await f.context.close(); await f.admin.dispose(); }
  });
}
