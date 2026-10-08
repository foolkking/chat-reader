import { expect, test, type APIRequest, type Browser } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const headers = { Origin: baseURL }, password = "synthetic rule recovery passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `rule-recovery-${Date.now()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const namespace = `SYNTHETIC_${Date.now()}`;
  const local = `${namespace}_LOCAL`, saved = `${namespace}_SAVED`, remote = `${namespace}_REMOTE`;
  const created = await context.request.post(`${baseURL}/api/content-cleanup/rules`, { headers,
    data: { name: "Synthetic recoverable rule", match_value: `${namespace}_TRAILER` } });
  expect(created.status()).toBe(201);
  const rule = await created.json();
  const source = `Retained ${saved} and ${local}, protected \`${local}\`.`;
  const conversation = await (await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
    title: "Synthetic rule recovery source", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
  } })).json();
  const page = await context.newPage(); await page.goto(baseURL);
  if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
  await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
  await page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"))
    .getByRole("button", { name: /噪声规则库|Noise rule library/ }).click();
  const panel = page.getByRole("dialog", { name: /噪声规则库|Noise rule library/, exact: true });
  const row = panel.locator("article").filter({ hasText: "Synthetic recoverable rule" });
  await row.getByRole("button", { name: /Synthetic recoverable rule/ }).click();
  await row.getByRole("button", { name: /编辑并试运行|Edit and test/ }).click();
  const editor = panel.getByRole("region", { name: /学习噪声规则|Learn noise rule/ });
  return { admin, context, page, panel, editor, rule, headers, source, conversation, local, saved, remote,
    rules: async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/rules`)).json()) as { id: string; match_value: string; revision: number }[] };
}

test("375px: confirmed rule save does not wait for the list refresh", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.editor.getByLabel(/匹配文本|Match text/, { exact: true }).fill(f.saved);
    await f.editor.getByRole("button", { name: /预览并试运行|Preview and test/ }).click();
    await expect(f.editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ })).toBeVisible();
    await f.page.route("**/api/content-cleanup/rules", async route => { await hold; await route.continue(); });
    await f.editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ }).click();
    await expect.poll(async () => (await f.rules()).find(r => r.id === f.rule.id)?.match_value).toBe(f.saved);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/confirmed-save-375.png` });
    await expect(f.editor).not.toBeVisible({ timeout: 3_000 });
    await f.panel.locator("article").filter({ hasText: "Synthetic recoverable rule" }).getByRole("button", { name: /Synthetic recoverable rule/ }).click();
    await expect(f.panel.getByText(f.saved, { exact: true })).toBeVisible();
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) test(`${width}px: lost save response is checked without repeating the write`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width);
  let writes = 0;
  try {
    await f.editor.getByLabel(/匹配文本|Match text/, { exact: true }).fill(f.local);
    await f.editor.getByRole("button", { name: /预览并试运行|Preview and test/ }).click();
    await expect(f.editor.getByRole("status")).toContainText(/2 项命中|2 matches/);
    await f.page.route("**/api/content-cleanup/rules/learn", async route => {
      writes++; const response = await route.fetch(); expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, json: { detail: "Synthetic lost response" } });
    });
    await f.editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ }).click();
    await expect(f.editor.getByRole("alert")).toContainText(/尚未确认保存结果|Save is unconfirmed/);
    await expect(f.editor.getByLabel(/匹配文本|Match text/, { exact: true })).toHaveValue(f.local);
    await expect(f.editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ })).toBeDisabled();
    await f.page.route("**/api/content-cleanup/rules", route => route.fulfill({ status: 503, json: { detail: "Synthetic read failure" } }));
    await f.editor.getByRole("button", { name: /检查保存结果|Check save result/ }).click();
    await expect(f.editor.getByRole("alert")).toContainText(/读取失败|Read failed/);
    expect(writes).toBe(1);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/save-check-retry-${width}.png` });
    await f.page.unroute("**/api/content-cleanup/rules");
    await f.editor.getByRole("button", { name: /检查保存结果|Check save result/ }).click();
    await expect(f.editor).not.toBeVisible(); expect(writes).toBe(1);
    const persisted = (await f.rules()).find(item => item.id === f.rule.id)!;
    expect(persisted.match_value).toBe(f.local); expect(persisted.revision).toBe(2);
    expect((await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json()).current_version.display_text).toBe(f.source);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) test(`${width}px: conflict compares readable fields and preserves the draft for a deliberate retry`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width);
  try {
    await f.editor.getByLabel(/匹配文本|Match text/, { exact: true }).fill(f.local);
    await f.editor.getByRole("button", { name: /预览并试运行|Preview and test/ }).click();
    expect((await f.context.request.patch(`${baseURL}/api/content-cleanup/rules/${f.rule.id}`, { headers: f.headers, data: {
      match_value: f.remote, role_filter: "assistant", boundary_mode: "WHOLE_LINE", case_sensitive: false, base_revision_id: f.rule.revision_id,
    } })).status()).toBe(200);
    await f.editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ }).click();
    await expect(f.editor.getByRole("alert")).toContainText(/其他窗口|another device/);
    await f.editor.getByRole("button", { name: /比较服务器版本|Compare saved version/ }).click();
    const comparison = f.editor.getByRole("region", { name: /规则版本比较|Rule version comparison/ });
    await expect(comparison.getByText(f.remote, { exact: true })).toBeVisible();
    await expect(comparison.getByText(f.local, { exact: true })).toBeVisible();
    await expect(comparison.getByText(/^(独占一行|Whole line)$/)).toBeVisible();
    await expect(f.editor.getByLabel(/匹配文本|Match text/, { exact: true })).toHaveValue(f.local);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/conflict-fields-${width}.png` });
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const useBase = f.editor.getByRole("button", { name: /保留草稿，以此版本重新试运行|Keep draft and use this base revision/ });
    await useBase.focus(); await f.page.keyboard.press("Enter");
    await expect(comparison).not.toBeVisible();
    await expect(f.editor.getByRole("button", { name: /预览并试运行|Preview and test/ })).toBeFocused();
    await f.editor.getByRole("button", { name: /预览并试运行|Preview and test/ }).click();
    await f.editor.getByRole("button", { name: /确认保存个人规则|Confirm personal rule/ }).click();
    await expect(f.editor).not.toBeVisible();
    await expect(f.panel.getByRole("button", { name: /Synthetic recoverable rule/ })).toBeFocused();
    expect((await f.rules()).find(item => item.id === f.rule.id)?.match_value).toBe(f.local);
    expect((await f.rules()).find(item => item.id === f.rule.id)?.revision).toBe(3);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: failed comparison refresh cannot reuse the old saved version", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    await f.editor.getByLabel(/Match text/, { exact: true }).fill(f.local);
    const compare = f.editor.getByRole("button", { name: "Compare saved version", exact: true });
    await compare.click();
    const useBase = f.editor.getByRole("button", { name: "Keep draft and use this base revision", exact: true });
    await expect(useBase).toBeEnabled();
    await f.page.route("**/api/content-cleanup/rules/**/revisions?*", route => route.fulfill({ status: 503, json: { detail: "Synthetic read failure" } }));
    await f.page.route("**/api/content-cleanup/rules", route => route.fulfill({ status: 503, json: { detail: "Synthetic read failure" } }));
    await compare.click();
    await expect(f.editor.getByRole("alert")).toBeVisible();
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/comparison-failed-768.png` });
    await expect(useBase).not.toBeVisible({ timeout: 3_000 });
    await expect(f.editor.getByLabel(/Match text/, { exact: true })).toHaveValue(f.local);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: a new rule with a lost response is found without creating a duplicate", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  let writes = 0;
  try {
    await f.editor.getByRole("button", { name: "取消", exact: true }).click();
    await f.panel.getByRole("button", { name: "学习文本规则", exact: true }).click();
    await f.editor.getByLabel("规则名称", { exact: true }).fill("  Synthetic new rule  ");
    await f.editor.getByLabel("匹配文本", { exact: true }).fill(`  ${f.local}  `);
    await f.editor.getByRole("button", { name: "预览并试运行", exact: true }).click();
    await f.page.route("**/api/content-cleanup/rules/learn", async route => {
      writes++; const response = await route.fetch(); expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, json: { detail: "Synthetic lost response" } });
    });
    await f.editor.getByRole("button", { name: "确认保存个人规则", exact: true }).click();
    await f.editor.getByRole("button", { name: "检查保存结果", exact: true }).click();
    await expect(f.editor).not.toBeVisible(); expect(writes).toBe(1);
    expect((await f.rules()).filter(item => item.match_value === f.local)).toHaveLength(1);
    await expect(f.panel.getByRole("button", { name: /Synthetic new rule/ })).toBeVisible();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: an unsent save retains the draft and requires a fresh trial after checking", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    await f.editor.getByLabel("Match text", { exact: true }).fill(f.local);
    await f.editor.getByRole("button", { name: "Preview and test", exact: true }).click();
    await f.page.route("**/api/content-cleanup/rules/learn", route => route.abort("failed"));
    await f.editor.getByRole("button", { name: "Confirm personal rule", exact: true }).click();
    await f.editor.getByRole("button", { name: "Check save result", exact: true }).click();
    await expect(f.editor.getByRole("region", { name: "Rule version comparison", exact: true })).toBeVisible();
    await expect(f.editor.getByRole("button", { name: "Confirm personal rule", exact: true })).toHaveCount(0);
    expect((await f.rules()).find(item => item.id === f.rule.id)?.revision).toBe(1);
    await f.editor.getByRole("button", { name: "Keep draft and use this base revision", exact: true }).click();
    await f.page.unroute("**/api/content-cleanup/rules/learn");
    await f.editor.getByRole("button", { name: "Preview and test", exact: true }).click();
    await f.editor.getByRole("button", { name: "Confirm personal rule", exact: true }).click();
    await expect(f.editor).not.toBeVisible();
    expect((await f.rules()).find(item => item.id === f.rule.id)?.match_value).toBe(f.local);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: a server-rejected expired trial can be rerun without losing the text", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  try {
    await f.editor.getByLabel("匹配文本", { exact: true }).fill(f.local);
    await f.page.route("**/api/content-cleanup/rules/trial", async route => {
      const response = await route.fetch(), data = await response.json();
      data.preview_token = `1.${data.preview_token.split(".")[1]}`;
      await route.fulfill({ response, json: data });
    });
    await f.editor.getByRole("button", { name: "预览并试运行", exact: true }).click();
    await f.editor.getByRole("button", { name: "确认保存个人规则", exact: true }).click();
    await expect(f.editor.getByRole("alert")).toContainText("试运行结果已过期");
    await expect(f.editor.getByLabel("匹配文本", { exact: true })).toHaveValue(f.local);
    expect((await f.rules()).find(item => item.id === f.rule.id)?.revision).toBe(1);
    await f.page.unroute("**/api/content-cleanup/rules/trial");
    await f.editor.getByRole("button", { name: "预览并试运行", exact: true }).click();
    await f.editor.getByRole("button", { name: "确认保存个人规则", exact: true }).click();
    await expect(f.editor).not.toBeVisible();
    expect((await f.rules()).find(item => item.id === f.rule.id)?.revision).toBe(2);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: trial deadline restores controls and keeps the draft", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.editor.getByLabel("匹配文本", { exact: true }).fill(f.local);
    await f.page.route("**/api/content-cleanup/rules/trial", async route => { await hold; await route.continue().catch(() => {}); });
    await f.editor.getByRole("button", { name: "预览并试运行", exact: true }).click();
    await expect(f.editor.getByRole("alert")).toContainText("试运行失败", { timeout: 25_000 });
    await expect(f.editor.getByLabel("匹配文本", { exact: true })).toHaveValue(f.local);
    await expect(f.editor.getByRole("button", { name: "预览并试运行", exact: true })).toBeEnabled();
    release(); await f.page.unroute("**/api/content-cleanup/rules/trial");
    await f.editor.getByRole("button", { name: "预览并试运行", exact: true }).click();
    await expect(f.editor.getByRole("status")).toContainText("2 项命中");
    expect((await f.rules()).find(item => item.id === f.rule.id)?.revision).toBe(1);
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});
