import { expect, test, type Browser, type APIRequest, type APIRequestContext, type Page } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated settings PostgreSQL and worker");

async function fixture(browser: Browser, playwright: { request: APIRequest }, baseURL: string, width: number, count: number, selected: boolean) {
  const admin = await settingsAdmin(playwright.request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const password = "synthetic cleanup recovery passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL }, data: {
    email: `cleanup-recovery-${Date.now()}-${width}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const marker = "\ue200cite\ue202turn12search4\ue201";
  const source = "Synthetic review.\n\n" + (`Before ${marker} after.\n\n`).repeat(count) + "Synthetic end.";
  const created = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL }, data: {
    title: "Synthetic cleanup recovery", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
  } });
  expect(created.status()).toBe(201);
  const conversation = await created.json();
  const started = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers: { Origin: baseURL }, data: {
    source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.conversation.id],
  } });
  expect(started.status()).toBe(202);
  const scanId = (await started.json()).id;
  const scanURL = `${baseURL}/api/content-cleanup/scans/${scanId}`;
  const scan = async () => (await (await context.request.get(scanURL)).json());
  await expect.poll(async () => (await scan()).status).toBe("READY");
  if (selected) expect((await context.request.patch(`${scanURL}/decisions/filter`, { headers: { Origin: baseURL }, data: { decision: "DELETE", all_matching: true } })).status()).toBe(200);
  const page = await context.newPage();
  await page.goto(baseURL);
  await openSettingsNoiseReview(page, scanId);
  const dialog = page.getByTestId("content-cleanup-dialog");
  if (width < 1024) await dialog.getByRole("button", { name: /^(全部候选|All candidates)$/ }).click();
  const checks = dialog.getByRole("checkbox", { name: /处理|Process/ });
  await expect(checks.first()).toBeVisible();
  return { admin, context, page, dialog, checks, scan, scanId, scanURL, conversation, source, marker };
}

async function shot(page: Page, name: string) {
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.getByTestId("content-cleanup-dialog").screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function assertSource(request: APIRequestContext, baseURL: string, id: string, source: string) {
  const response = await request.get(`${baseURL}/api/messages/${id}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).current_version.display_text).toBe(source);
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: lost selection acknowledgement reads saved choices without replay`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width, 2, true);
    const decisionPath = `**/api/content-cleanup/scans/${f.scanId}/decisions`;
    let writes = 0;
    await f.page.route(decisionPath, async (route) => {
      writes++;
      const saved = await route.fetch();
      expect(saved.status()).toBe(200);
      await route.abort("failed");
    });
    try {
      await f.checks.first().uncheck();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(1);
      const recover = f.dialog.getByRole("button", { name: /重新读取选择|Reload saved choices/ });
      await expect(recover).toBeVisible({ timeout: 5_000 });
      await expect(f.checks.first()).toBeDisabled();
      await expect(f.dialog.getByRole("button", { name: /预览 .*项清理|Preview .* removals/ })).toBeDisabled();
      await shot(f.page, `selection-unknown-${width}`);
      const readPath = `**/api/content-cleanup/scans/${f.scanId}/review?*`;
      await f.page.route(readPath, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic selection read unavailable" } }));
      await recover.click();
      await expect(f.dialog.getByText(/选择读取失败，请重试|Saved choices could not load/)).toBeVisible();
      await expect(f.checks.first()).toBeDisabled();
      await shot(f.page, `selection-read-failed-${width}`);
      await f.page.unroute(readPath);
      await recover.click();
      await expect(f.checks.first()).toBeEnabled();
      await expect(f.checks.first()).not.toBeChecked();
      await expect(f.checks.nth(1)).toBeChecked();
      await expect(f.dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ })).toBeEnabled();
      expect(writes).toBe(1);
      await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
      await shot(f.page, `selection-recovered-${width}`);
    } finally { await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: lost cross-page deselection recovers empty selected-only page`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width, 51, true);
    let writes = 0;
    await f.page.route(`**/api/content-cleanup/scans/${f.scanId}/decisions/filter`, async (route) => {
      writes++;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    });
    try {
      await f.dialog.getByRole("checkbox", { name: /只看已选项|Selected only/ }).check();
      await f.dialog.getByRole("button", { name: /^(下一页|Next)$/ }).click();
      await expect(f.checks).toHaveCount(1);
      await f.dialog.getByRole("button", { name: /保留全部匹配项|Keep all matching/ }).click();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(0);
      const recover = f.dialog.getByRole("button", { name: /重新读取选择|Reload saved choices/ });
      await expect(recover).toBeVisible();
      await recover.click();
      await expect(f.dialog.getByText(/当前筛选没有候选|No candidates in this filter/)).toBeVisible();
      await expect(f.checks).toHaveCount(0);
      await expect(f.dialog.getByRole("status").filter({ hasText: /已选 0 项|0 selected/ })).toBeVisible();
      await f.dialog.getByRole("checkbox", { name: /只看已选项|Selected only/ }).uncheck();
      await expect(f.checks).toHaveCount(50);
      await expect(f.checks.first()).not.toBeChecked();
      expect(writes).toBe(1);
      await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
      await shot(f.page, `selection-bulk-recovered-${width}`);
    } finally { await f.context.close(); await f.admin.dispose(); }
  });
}

test("768px: an unsent selection is not silently retried and survives reopening as KEEP", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright, baseURL!, 768, 2, false);
  let writes = 0;
  await f.page.route(`**/api/content-cleanup/scans/${f.scanId}/decisions`, async (route) => { writes++; await route.abort("failed"); });
  try {
    await f.checks.first().check();
    await f.dialog.getByRole("button", { name: "Reload saved choices", exact: true }).click();
    await expect(f.checks.first()).toBeEnabled();
    await expect(f.checks.first()).not.toBeChecked();
    expect((await f.scan()).delete_count).toBe(0);
    expect(writes).toBe(1);
    await f.checks.first().check();
    await expect(f.dialog.getByRole("button", { name: "Reload saved choices", exact: true })).toBeVisible();
    await f.page.keyboard.press("Escape");
    await openSettingsNoiseReview(f.page, f.scanId);
    await f.dialog.getByRole("button", { name: "All candidates", exact: true }).click();
    await expect(f.checks.first()).toBeEnabled();
    await expect(f.checks.first()).not.toBeChecked();
    expect(writes).toBe(2);
    await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: a pending selection request times out and can read its actual result", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright, baseURL!, 1440, 1, false);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  await f.page.route(`**/api/content-cleanup/scans/${f.scanId}/decisions`, async (route) => {
    writes++;
    const saved = await route.fetch();
    expect(saved.status()).toBe(200);
    await gate;
    await route.fulfill({ response: saved }).catch(() => {});
  });
  try {
    await f.checks.first().check();
    await expect.poll(async () => (await f.scan()).delete_count).toBe(1);
    const recover = f.dialog.getByRole("button", { name: "重新读取选择", exact: true });
    await expect(recover).toBeVisible({ timeout: 25_000 });
    release();
    await recover.click();
    await expect(f.checks.first()).toBeEnabled();
    await expect(f.checks.first()).toBeChecked();
    expect(writes).toBe(1);
    await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) {
  test(`${width}px: selected-only last page recovers after saved deselection`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width, 51, true);
    try {
      await f.dialog.getByRole("checkbox", { name: /只看已选项|Selected only/ }).check();
      await expect(f.checks).toHaveCount(50);
      await f.dialog.getByRole("button", { name: /^(下一页|Next)$/ }).click();
      await expect(f.checks).toHaveCount(1);
      await f.checks.first().uncheck();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(50);
      await expect(f.checks).toHaveCount(50, { timeout: 8_000 });
      await expect(f.checks.first()).toBeFocused();
      await shot(f.page, `cleanup-page-${width}`);
      await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
      await f.dialog.getByRole("button", { name: /保留全部匹配项|Keep all matching/ }).click();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(0);
      await expect(f.dialog.getByText(/当前筛选没有候选|No candidates in this filter/)).toBeVisible();
      await f.dialog.getByRole("checkbox", { name: /只看已选项|Selected only/ }).uncheck();
      await expect(f.checks).toHaveCount(50);
      await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
      if (width < 1024) {
        await f.dialog.getByRole("button", { name: /返回分组|Back to groups/ }).click();
        await expect(f.dialog.getByRole("button", { name: /^(全部候选|All candidates)$/ })).toBeFocused();
      }
    } finally { await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: saved choice is acknowledged while follow-up reads are delayed`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width, 1, false);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await f.page.route(`**/api/content-cleanup/scans/${f.scanId}{,/**}`, async (route) => {
      if (route.request().method() === "GET" && !route.request().url().includes("/preview")) await gate;
      await route.continue().catch(() => {});
    });
    try {
      await f.checks.first().check();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(1);
      await expect(f.dialog.getByText(/选择已保存|Selection saved/)).toBeVisible({ timeout: 3_000 });
      await expect(f.dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ })).toBeEnabled({ timeout: 3_000 });
      await shot(f.page, `cleanup-ack-${width}`);
      release();
      await f.dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ }).click();
      await f.dialog.getByRole("button", { name: /确认处理 1 项选择|Confirm 1 selections/ }).click();
      await expect(f.dialog).not.toBeVisible();
      await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source.replace(f.marker, ""));
    } finally { release(); await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: failed preview refresh blocks cached confirmation and can retry`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width, 1, true);
    try {
      await f.dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ }).click();
      const confirm = f.dialog.getByRole("button", { name: /确认处理 1 项选择|Confirm 1 selections/ });
      await expect(confirm).toBeEnabled();
      await f.dialog.getByRole("button", { name: /返回选择|Back to selection/ }).click();
      await f.page.route(`**/api/content-cleanup/scans/${f.scanId}/preview?*`, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic preview unavailable" } }));
      await f.dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ }).click();
      await expect(f.dialog.getByRole("alert").first()).toBeVisible();
      await shot(f.page, `cleanup-preview-${width}`);
      await expect(confirm).toBeDisabled({ timeout: 3_000 });
      await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
      await f.page.unroute(`**/api/content-cleanup/scans/${f.scanId}/preview?*`);
      await f.dialog.getByRole("button", { name: /刷新差异|Refresh changes|^(重试|Retry)$/ }).click();
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(f.dialog).not.toBeVisible();
      await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source.replace(f.marker, ""));
    } finally { await f.context.close(); await f.admin.dispose(); }
  });
}

test("768px: bulk-save count survives a failed candidate refresh and reopening", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright, baseURL!, 768, 2, false);
  try {
    const pattern = `**/api/content-cleanup/scans/${f.scanId}/review?*`;
    await f.page.route(pattern, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic candidate read failed" } }));
    await f.dialog.getByRole("button", { name: "Select all matching", exact: true }).click();
    await expect.poll(async () => (await f.scan()).delete_count).toBe(2);
    await expect(f.dialog.getByText(/Selection saved/)).toBeVisible();
    await expect(f.dialog.getByRole("button", { name: "Preview 2 removals", exact: true })).toBeEnabled();
    await expect(f.dialog.getByRole("alert")).toBeVisible();
    await expect(f.dialog.getByRole("alert")).toContainText("The previous list is shown below");
    await expect(f.checks.first()).toBeDisabled();
    await shot(f.page, "cleanup-list-retry-768");
    await f.page.unroute(pattern);
    await f.dialog.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(f.checks.first()).toBeEnabled();
    await expect(f.checks.first()).toBeChecked();
    await f.page.keyboard.press("Escape");
    await f.page.goto(baseURL!);
    await openSettingsNoiseReview(f.page, f.scanId);
    await expect(f.dialog.getByRole("status").filter({ hasText: "2 selected" })).toBeVisible();
    await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, f.source);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: source changes require refreshed differences and retain content through rescan", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright, baseURL!, 1440, 1, true);
  try {
    await f.dialog.getByRole("button", { name: "预览 1 项清理", exact: true }).click();
    const confirm = f.dialog.getByRole("button", { name: "确认处理 1 项选择", exact: true });
    await expect(confirm).toBeEnabled();
    const current = await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json();
    const updated = `${f.source}Synthetic later edit.`;
    const edit = await f.context.request.patch(`${baseURL}/api/messages/${f.conversation.messages[1].id}`, { headers: { Origin: baseURL! }, data: {
      content_markdown: updated, base_version_id: current.current_version.id, save_mode: "create_version", edit_reason: "Synthetic conflict test",
    } });
    expect(edit.status()).toBe(200);
    const rejected = f.page.waitForResponse((response) => response.url().endsWith(`/scans/${f.scanId}/apply`) && response.request().method() === "POST");
    await confirm.click();
    expect((await rejected).status()).toBe(409);
    await expect(confirm).toBeDisabled();
    await f.dialog.getByRole("button", { name: "刷新差异", exact: true }).click();
    await expect(f.dialog.getByText("源版本变化或删除不安全；此消息会保留原文，请重新扫描。", { exact: true })).toBeVisible();
    await expect(confirm).toBeDisabled();
    await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, updated);
    await shot(f.page, "cleanup-source-conflict-1440");
    const rescanned = f.page.waitForResponse((response) => response.url().endsWith(`/scans/${f.scanId}/rescan`) && response.request().method() === "POST");
    await f.dialog.getByRole("button", { name: "重新扫描原对话", exact: true }).click();
    await f.page.getByRole("dialog", { name: "开始新的审查？", exact: true }).getByRole("button", { name: "重新扫描", exact: true }).click();
    const response = await rescanned;
    expect(response.status()).toBe(202);
    const replacement = await response.json();
    expect(replacement.id).not.toBe(f.scanId);
    await expect(f.dialog.getByRole("status").filter({ hasText: "已选 0 项" })).toBeVisible();
    await assertSource(f.context.request, baseURL!, f.conversation.messages[1].id, updated);
    const latest = await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json();
    expect(latest.current_version.id).not.toBe(current.current_version.id);
    expect(latest.current_version.edit_type).not.toBe("content_cleanup");
  } finally { await f.context.close(); await f.admin.dispose(); }
});
