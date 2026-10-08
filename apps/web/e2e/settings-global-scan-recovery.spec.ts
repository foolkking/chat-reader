import { expect, test, type APIRequest, type Browser } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number, withConversation = true) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const headers = { Origin: baseURL }, password = "synthetic global scan passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `global-scan-${Date.now()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  if (withConversation) expect((await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
    title: "Synthetic global scan recovery", messages: [{ role: "user", content_markdown: "Synthetic question" },
      { role: "assistant", content_markdown: "Retained cite turn12search4 source." }],
  } })).status()).toBe(201);
  const page = await context.newPage();
  const open = async () => {
    if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
    await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
    await page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"))
      .getByRole("button", { name: /噪声规则库|Noise rule library/ }).click();
  };
  const panel = page.getByRole("dialog", { name: /噪声规则库|Noise rule library/, exact: true });
  const queue = async () => {
    await panel.getByRole("button", { name: /扫描现有对话|Scan existing conversations/, exact: true }).click();
    await page.getByRole("button", { name: /开始后台扫描|Start background scan/, exact: true }).click();
  };
  const tasks = async () => (await (await context.request.get(`${baseURL}/api/tasks/active`)).json()) as { job_type: string; job_id: string; status: string }[];
  await page.goto(baseURL); await open();
  return { admin, context, headers, page, panel, open, queue, tasks };
}

test("375px: admitted scan feedback does not wait for pending-list refresh", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route("**/api/content-cleanup/scans/pending", async route => { await held; await route.continue().catch(() => {}); });
    await f.queue();
    await expect.poll(async () => (await f.tasks()).filter(task => task.job_type === "content_noise_scan").length).toBe(1);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-confirmed-375.png` });
    await expect(f.panel.getByRole("button", { name: /打开任务中心|Open task center/ })).toBeVisible({ timeout: 3000 });
    await expect(f.panel.getByRole("button", { name: /扫描现有对话|Scan existing conversations/, exact: true })).toBeEnabled({ timeout: 3000 });
    release();
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) test(`${width}px: lost response survives reload and read-only recovery opens actual review`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width);
  let writes = 0, scanId = "", requestId = "";
  try {
    await f.page.route("**/api/content-cleanup/rules/scan-existing", async route => {
      writes++; requestId = route.request().headers()["idempotency-key"];
      const accepted = await route.fetch(); expect(accepted.status()).toBe(202);
      scanId = (await accepted.json()).id;
      await route.fulfill({ status: 503, json: { detail: "Synthetic lost admission response" } });
    });
    await f.queue();
    await expect(f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ })).toBeVisible();
    await expect(f.panel.getByRole("button", { name: /扫描现有对话|Scan existing conversations/, exact: true })).toBeDisabled();
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    await f.page.route("**/api/content-cleanup/rules/scan-existing/requests/*", route => route.fulfill({ status: 503, json: { detail: "Synthetic receipt read unavailable" } }));
    await f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ }).click();
    await expect(f.panel.getByRole("alert")).toContainText(/核对失败|check failed/);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-check-failed-${width}.png` });
    await f.page.reload(); await f.open();
    await expect(f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ })).toBeVisible();
    expect(writes).toBe(1);
    await f.page.unroute("**/api/content-cleanup/rules/scan-existing/requests/*");
    await f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ }).click();
    await expect(f.panel.getByRole("button", { name: /打开任务中心|Open task center/ })).toBeVisible();
    expect(writes).toBe(1);
    expect((await f.tasks()).filter(task => task.job_type === "content_noise_scan")).toHaveLength(1);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-recovered-${width}.png` });
    await f.panel.getByRole("button", { name: /打开任务中心|Open task center/ }).click();
    await expect(f.panel).not.toBeVisible();
    const center = f.page.getByTestId("task-center-panel");
    await expect(center).toBeVisible();
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
    await expect.poll(() => center.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await center.getByRole("button", { name: /关闭|Close/, exact: true }).first().focus();
    await f.page.keyboard.press("Shift+Tab");
    await expect.poll(() => center.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await center.locator(`[data-cleanup-scan-id="${scanId}"]`).getByRole("button", { name: /打开审查|Open review/ }).click();
    await expect(f.page.getByTestId("content-cleanup-dialog")).toBeVisible();
    await expect.poll(() => f.page.getByTestId("content-cleanup-dialog").evaluate(element => element.contains(document.activeElement))).toBe(true);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.page.getByTestId("content-cleanup-dialog").screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-review-${width}.png` });
    await f.page.keyboard.press("Escape");
    await expect(f.page.getByTestId("content-cleanup-dialog")).not.toBeVisible();
    await expect(center).toBeVisible();
    await expect(center.locator(`[data-cleanup-scan-id="${scanId}"]`).getByRole("button", { name: /打开审查|Open review/ })).toBeFocused();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: undelivered request can be resubmitted with the same key", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  const keys: string[] = [];
  try {
    await f.page.route("**/api/content-cleanup/rules/scan-existing", async route => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) await route.abort("failed"); else await route.continue();
    });
    await f.queue();
    await f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ }).click();
    await expect(f.panel.getByRole("button", { name: /继续提交扫描|Resubmit scan/ })).toBeVisible();
    expect((await f.tasks()).filter(task => task.job_type === "content_noise_scan")).toHaveLength(0);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-unsent-768.png` });
    await f.panel.getByRole("button", { name: /继续提交扫描|Resubmit scan/ }).click();
    await expect(f.panel.getByRole("button", { name: /打开任务中心|Open task center/ })).toBeVisible();
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    expect((await f.tasks()).filter(task => task.job_type === "content_noise_scan")).toHaveLength(1);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: a closed review resolves the request without creating another task", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  let scanId = "", writes = 0;
  try {
    await f.page.route("**/api/content-cleanup/rules/scan-existing", async route => {
      writes++; const accepted = await route.fetch(); expect(accepted.status()).toBe(202);
      scanId = (await accepted.json()).id; await route.abort("failed");
    });
    await f.queue();
    await expect(f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ })).toBeVisible();
    await expect.poll(async () => (await (await f.context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}`)).json()).status).toBe("READY");
    expect((await f.context.request.delete(`${baseURL}/api/content-cleanup/scans/${scanId}`, { headers: f.headers })).status()).toBe(204);
    await f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ }).click();
    await expect(f.panel.getByRole("status")).toContainText(/审查已结束或关闭|review has ended or closed/);
    await expect(f.panel.getByRole("button", { name: /打开任务中心|Open task center/ })).toHaveCount(0);
    expect(writes).toBe(1);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-closed-1440.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: empty library gives actionable feedback and no false task", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375, false);
  try {
    await f.queue();
    await expect(f.panel.getByRole("alert")).toContainText(/没有可扫描的活动对话|No active conversations/);
    await expect(f.panel.getByRole("button", { name: /扫描现有对话|Scan existing conversations/, exact: true })).toBeEnabled();
    expect(await f.tasks()).toHaveLength(0);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-empty-375.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: no enabled rule explains recovery without creating a task", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    const rules = await (await f.context.request.get(`${baseURL}/api/content-cleanup/rules`)).json();
    for (const rule of rules) expect((await f.context.request.patch(`${baseURL}/api/content-cleanup/rules/${rule.id}`, { headers: f.headers, data: { status: "DISABLED" } })).status()).toBe(200);
    await f.queue();
    await expect(f.panel.getByRole("alert")).toContainText(/请先启用至少一条|Enable at least one/);
    await expect(f.panel.getByRole("button", { name: /个人启用|Enable for me/ })).toHaveCount(rules.length);
    expect(await f.tasks()).toHaveLength(0);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-no-rules-768.png` });
    await f.panel.getByRole("button", { name: /个人启用|Enable for me/ }).first().click();
    await expect(f.panel.getByRole("button", { name: /个人停用|Disable for me/ })).toHaveCount(1);
    await f.queue();
    await expect(f.panel.getByRole("button", { name: /打开任务中心|Open task center/ })).toBeVisible();
    expect((await f.tasks()).filter(task => task.job_type === "content_noise_scan")).toHaveLength(1);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: admission deadline retains the request and restores result checking", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route("**/api/content-cleanup/rules/scan-existing", async route => { await held; await route.abort().catch(() => {}); });
    await f.queue();
    await expect(f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ })).toBeVisible({ timeout: 25_000 });
    release();
    await f.panel.getByRole("button", { name: /检查扫描结果|Check scan result/ }).click();
    await expect(f.panel.getByRole("button", { name: /继续提交扫描|Resubmit scan/ })).toBeVisible();
    expect(await f.tasks()).toHaveLength(0);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-timeout-1440.png` });
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

test("1440px: rule library inside a review returns to the task center with the new scan", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  try {
    await f.queue();
    await f.panel.getByRole("button", { name: /打开任务中心|Open task center/ }).click();
    const center = f.page.getByTestId("task-center-panel");
    await center.getByRole("button", { name: /打开审查|Open review/ }).click();
    const review = f.page.getByTestId("content-cleanup-dialog");
    await review.getByRole("button", { name: /^规则库$|^Rules$/ }).click();
    await review.getByRole("button", { name: /扫描现有对话|Scan existing conversations/, exact: true }).click();
    const response = f.page.waitForResponse(item => item.url().endsWith("/rules/scan-existing") && item.request().method() === "POST");
    await f.page.getByRole("button", { name: /开始后台扫描|Start background scan/, exact: true }).click();
    const scan = await (await response).json();
    await review.getByRole("button", { name: /打开任务中心|Open task center/ }).click();
    await expect(review).not.toBeVisible();
    await expect.poll(() => center.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await center.locator(`[data-cleanup-scan-id="${scan.id}"]`).getByRole("button", { name: /打开审查|Open review/ }).click();
    await expect(review).toBeVisible();
    await expect(review.getByRole("region", { name: "当前审查范围", exact: true })).toContainText("1 个候选");
    const completed = await (await f.context.request.get(`${baseURL}/api/content-cleanup/scans/${scan.id}`)).json();
    expect(completed.status).toBe("READY");
    expect(completed.delete_count).toBe(0);
    expect((await f.tasks()).filter(item => item.job_type === "content_noise_scan")).toHaveLength(2);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await review.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-from-review-1440.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});
