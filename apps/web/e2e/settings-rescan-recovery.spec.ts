import { expect, test, type Browser, type APIRequest, type Page } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");
const marker = "\ue200cite\ue202turn12search4\ue201";

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const headers = { Origin: baseURL }, password = "synthetic rescan test passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `rescan-${crypto.randomUUID()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const source = `Before ${marker} after.\n\nProtected: \`${marker}\``;
  const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
    title: "Synthetic rescan review", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
  } });
  expect(created.status()).toBe(201);
  const conversation = await created.json();
  const admitted = await context.request.post(`${baseURL}/api/content-cleanup/rules/scan-existing`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } });
  expect(admitted.status()).toBe(202);
  const id = (await admitted.json()).id;
  const url = `${baseURL}/api/content-cleanup/scans/${id}`;
  const scan = async (scanId = id) => (await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}`)).json());
  await expect.poll(async () => (await scan()).status).toBe("READY");
  const page = await context.newPage();
  const open = () => openSettingsNoiseReview(page, id);
  await page.goto(baseURL); await open();
  const dialog = page.getByTestId("content-cleanup-dialog");
  const select = async () => {
    if (width < 1024) await dialog.getByRole("button", { name: /^(全部候选|All candidates)$/ }).click();
    await dialog.getByRole("button", { name: /选择全部匹配项|Select all matching/ }).click();
    await expect(dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ })).toBeEnabled();
  };
  const rescan = () => dialog.getByRole("button", { name: /重新扫描原对话|Rescan conversations/, exact: true }).click();
  const confirm = () => page.getByRole("dialog", { name: /开始新的审查？|Start a fresh review\?/, exact: true }).getByRole("button", { name: /^(重新扫描|Rescan)$/ }).click();
  const tasks = async () => ((await (await context.request.get(`${baseURL}/api/tasks/active`)).json()) as { job_type: string }[]).filter(t => t.job_type === "content_noise_scan");
  const assertSource = async () => expect((await (await context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json()).current_version.display_text).toBe(source);
  return { admin, context, headers, page, dialog, url, id, scan, select, rescan, confirm, tasks, open, assertSource, source, conversation };
}
async function shot(page: Page, name: string) {
  const dialog = page.getByTestId("content-cleanup-dialog");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SETTINGS_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: fresh review preserves old selections and supports keyboard return`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    try {
      await f.select(); await f.rescan();
      const confirmation = f.page.getByRole("dialog", { name: /开始新的审查？|Start a fresh review\?/ });
      await expect(confirmation).toContainText(/1 项选择会保留|1 selections stay/);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await confirmation.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/rescan-confirm-${width}.png` });
      await f.page.keyboard.press("Escape");
      await expect(confirmation).not.toBeVisible();
      expect(await f.tasks()).toHaveLength(1);
      expect((await f.scan()).delete_count).toBe(1);
      await f.rescan();
      const response = f.page.waitForResponse(r => r.url().endsWith(`/scans/${f.id}/rescan`) && r.request().method() === "POST");
      await f.confirm(); const next = await (await response).json();
      await expect(f.dialog.getByRole("status").filter({ hasText: /已选 0 项|0 selected/ })).toBeVisible();
      expect((await f.scan()).delete_count).toBe(1); expect((await f.scan(next.id)).delete_count).toBe(0);
      await shot(f.page, `rescan-new-${width}`);
      const previous = f.dialog.getByRole("button", { name: /查看上次审查与选择|View previous review and selections/ });
      await previous.focus(); await f.page.keyboard.press("Enter");
      await expect(f.dialog.getByRole("status").filter({ hasText: /已选 1 项|1 selected/ })).toBeVisible();
      await expect(f.dialog.getByRole("heading", { name: /^(清理噪声|Clean noise)$/ })).toBeFocused();
      await shot(f.page, `rescan-previous-${width}`);
      await f.dialog.getByRole("button", { name: /返回较新审查|Return to newer review/ }).click();
      await expect(f.dialog.getByRole("status").filter({ hasText: /已选 0 项|0 selected/ })).toBeVisible();
      await f.assertSource();
    } finally { await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: lost rescan response survives reload; result check never writes`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    let writes = 0, nextId = "";
    try {
      await f.page.route(`**/api/content-cleanup/scans/${f.id}/rescan`, async route => {
        writes++; const result = await route.fetch(); expect(result.status()).toBe(202);
        nextId = (await result.json()).id;
        await route.fulfill({ status: 503, json: { detail: "Synthetic lost response" } });
      });
      await f.rescan();
      const check = f.dialog.getByRole("button", { name: /检查重新扫描结果|Check rescan result/ });
      await expect(check).toBeVisible();
      await shot(f.page, `rescan-unknown-${width}`);
      await f.page.reload(); await f.open();
      await expect(check).toBeVisible(); expect(writes).toBe(1);
      const pattern = `**/api/content-cleanup/scans/${f.id}/rescan-requests/*`;
      await f.page.route(pattern, route => route.fulfill({ status: 503, json: { detail: "Synthetic failed check" } }));
      await check.click(); await expect(f.dialog.getByRole("alert")).toContainText(/核对失败|check failed/);
      await shot(f.page, `rescan-check-failed-${width}`);
      await f.page.unroute(pattern); await check.click();
      await expect(f.dialog.getByRole("button", { name: /查看上次审查与选择|View previous review and selections/ })).toBeVisible();
      expect(writes).toBe(1); expect(await f.tasks()).toHaveLength(2);
      expect((await f.scan(nextId)).previous_scan_id).toBe(f.id);
      await f.assertSource();
    } finally { await f.context.close(); await f.admin.dispose(); }
  });
}

test("768px: undelivered rescan retries with the same request", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  const keys: string[] = [];
  try {
    await f.page.route(`**/api/content-cleanup/scans/${f.id}/rescan`, async route => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) await route.abort("failed"); else await route.continue();
    });
    await f.rescan();
    await f.dialog.getByRole("button", { name: "Check rescan result" }).click();
    await expect(f.dialog.getByRole("button", { name: "Resubmit scan" })).toBeVisible();
    expect(await f.tasks()).toHaveLength(1);
    await shot(f.page, "rescan-retry-768");
    await f.dialog.getByRole("button", { name: "Resubmit scan" }).click();
    await expect(f.dialog.getByRole("button", { name: "View previous review and selections" })).toBeVisible();
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(await f.tasks()).toHaveLength(2);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: ended rescan is acknowledged without silently starting another", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  try {
    await f.page.route(`**/api/content-cleanup/scans/${f.id}/rescan`, async route => {
      const response = await route.fetch(); const next = await response.json();
      await expect.poll(async () => (await f.scan(next.id)).status).toBe("READY");
      expect((await f.context.request.delete(`${baseURL}/api/content-cleanup/scans/${next.id}`, { headers: f.headers })).status()).toBe(204);
      await route.abort("failed");
    });
    await f.rescan(); await f.dialog.getByRole("button", { name: "检查重新扫描结果" }).click();
    await expect(f.dialog.getByText(/审查已结束或关闭/)).toBeVisible();
    await expect(f.dialog.getByRole("button", { name: "重新扫描原对话" })).toBeEnabled();
    expect(await f.tasks()).toHaveLength(2);
    await shot(f.page, "rescan-ended-1440"); await f.assertSource();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: missing previous review still offers return to newer review", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  try {
    await f.rescan();
    await expect(f.dialog.getByRole("button", { name: "查看上次审查与选择" })).toBeVisible();
    expect((await f.context.request.delete(f.url, { headers: f.headers })).status()).toBe(204);
    await f.dialog.getByRole("button", { name: "查看上次审查与选择" }).click();
    await expect(f.dialog.getByRole("status").filter({ hasText: "本次审查已结束。" })).toBeVisible();
    await shot(f.page, "rescan-previous-missing-375");
    await f.dialog.getByRole("button", { name: "返回较新审查" }).click();
    await expect(f.dialog.getByRole("status").filter({ hasText: "已选 0 项" })).toBeVisible();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: conflict preview and selection share one rescan recovery", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  let writes = 0;
  try {
    await f.select();
    const messageUrl = `${baseURL}/api/messages/${f.conversation.messages[1].id}`;
    const message = await (await f.context.request.get(messageUrl)).json();
    expect((await f.context.request.patch(messageUrl, { headers: f.headers, data: {
      content_markdown: f.source + " Changed.", base_version_id: message.current_version.id, save_mode: "create_version", edit_reason: "Synthetic rescan conflict",
    } })).status()).toBe(200);
    await f.dialog.getByRole("button", { name: "预览 1 项清理" }).click();
    await expect(f.dialog.getByText(/源版本变化/)).toBeVisible();
    await f.page.route(`**/api/content-cleanup/scans/${f.id}/rescan`, async route => { writes++; await route.fetch(); await route.abort("failed"); });
    await f.rescan(); await f.confirm();
    await expect(f.dialog.getByRole("button", { name: "检查重新扫描结果" })).toBeVisible();
    await shot(f.page, "rescan-conflict-1440");
    await f.dialog.getByRole("button", { name: "返回选择" }).click();
    await f.dialog.getByRole("button", { name: "检查重新扫描结果" }).click();
    await expect(f.dialog.getByRole("button", { name: "查看上次审查与选择" })).toBeVisible();
    expect(writes).toBe(1); expect(await f.tasks()).toHaveLength(2);
    expect((await (await f.context.request.get(messageUrl)).json()).current_version.display_text).toBe(f.source + " Changed.");
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: failed scan uses the same recoverable action", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    // Status-only fault injection exercises this UI branch; admission and
    // recovery still go to actual PostgreSQL and worker.
    await f.page.route(`**/api/content-cleanup/scans/${f.id}`, async route => {
      const result = await route.fetch(); await route.fulfill({ json: { ...await result.json(), status: "FAILED", error_message: "Synthetic scan interrupted" } });
    });
    await f.page.reload(); await f.open();
    await expect(f.dialog.getByText("Synthetic scan interrupted")).toBeVisible();
    await f.page.route(`**/api/content-cleanup/scans/${f.id}/rescan`, async route => { await route.fetch(); await route.abort("failed"); });
    await f.rescan(); await expect(f.dialog.getByRole("button", { name: "Check rescan result" })).toBeVisible();
    await shot(f.page, "rescan-failed-768");
    await f.dialog.getByRole("button", { name: "Check rescan result" }).click();
    await expect(f.dialog.getByRole("button", { name: "View previous review and selections" })).toBeVisible();
    expect(await f.tasks()).toHaveLength(2);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: delayed admission times out, then checks the committed task", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route(`**/api/content-cleanup/scans/${f.id}/rescan`, async route => {
      await route.fetch(); await held; await route.abort("failed").catch(() => {});
    });
    const start = Date.now(); await f.rescan();
    const check = f.dialog.getByRole("button", { name: "检查重新扫描结果" });
    await expect(check).toBeVisible({ timeout: 25_000 });
    expect(Date.now() - start).toBeLessThan(25_000);
    await shot(f.page, "rescan-timeout-375");
    await check.click();
    await expect(f.dialog.getByRole("button", { name: "查看上次审查与选择" })).toBeVisible();
    expect(await f.tasks()).toHaveLength(2); await f.assertSource();
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

test("1440px: accepted review opens while task-list refresh is held", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route("**/api/content-cleanup/scans/pending", async route => { await held; await route.continue().catch(() => {}); });
    await f.rescan();
    await expect(f.dialog.getByRole("button", { name: "查看上次审查与选择" })).toBeVisible({ timeout: 3_000 });
    await expect(f.dialog.getByRole("status").filter({ hasText: "已选 0 项" })).toBeVisible();
    await shot(f.page, "rescan-refresh-held-1440");
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});
