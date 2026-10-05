import { expect, test, type Page } from "@playwright/test";
import { diagnosticReport } from "../lib/help-diagnostics";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openSettings(page: Page, name: RegExp) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await page.getByRole("button", { name }).click();
}

test("diagnostic serializer excludes injected strings and nested sensitive fields", () => {
  const secret = "synthetic-sensitive-canary@example.test/private/path?token=canary";
  const report = diagnosticReport({ connection: secret, info: { checked_at: secret, app: { api_version: secret, revision: secret }, capabilities: { maximum_import_size_mb: secret, allow_share_links: secret, private: secret } },
    shell: { availability: secret, revision: secret, missing: [secret], message: secret, resourceCount: secret },
    preferences: { resolvedLocale: secret, readerFontSizePx: secret, title: secret }, leaseExpiresAt: secret, webRevision: secret, cached: true });
  expect(report.includes(secret)).toBe(false);
  expect(JSON.parse(report)).toMatchObject({ connection: "unknown", web_revision: null, api: { revision: null, api_version: null }, offline: { missing_resource_count: 1, resource_count: null } });
});

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`help and runtime use real server data, recover failures and retain offline limits ${width}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, storageState: await admin.storageState(), permissions: ["clipboard-read", "clipboard-write"] });
    try {
      await settingsAppearance(context.request, base, locale);
      const actualCaps = await (await context.request.get(`${base}/api/auth/capabilities`)).json();
      const page = await context.newPage(); await page.goto(base);
      await openSettings(page, /Help & diagnostics|帮助与诊断/);
      const help = page.getByRole("region", { name: /Help & diagnostics|帮助与诊断/ });
      await expect(help.getByText(/Connected to server|已连接服务器/, { exact: true })).toBeVisible();
      await expect(help.getByRole("button", { name: /Generate & copy diagnostics|生成并复制诊断/ })).toHaveCount(0);
      await expect(help.getByText(/^(Allowed|允许)$/)).toHaveCount(0);
      await expect(help.getByText(`${actualCaps.maximum_import_size_mb} MiB`, { exact: true })).toBeVisible();
      await expect(help.getByRole("button", { name: /Handle user requests|处理用户请求/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Runtime status|运行状态/ }).click();
      const runtime = page.getByRole("region", { name: /Runtime status|运行状态/ });
      await expect(runtime.getByRole("heading", { name: /Task queues|任务队列/ })).toBeVisible();
      await expect(runtime.getByText(/Configured \(delivery not tested\)|已配置（未测试投递）/)).toBeVisible();
      const response = await context.request.get(`${base}/api/admin/runtime-status`);
      expect(response.status()).toBe(200);
      const snapshot = await response.json();
      expect(snapshot.queue.available).toBe(true);
      expect(snapshot.worker.available).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/admin-runtime-${width}.png` });
      await page.route("**/api/admin/runtime-status", (route) => route.abort("failed"));
      await runtime.getByRole("button", { name: /Refresh status|刷新状态/ }).click();
      await expect(runtime.getByRole("alert")).toContainText(/previous result|上次结果/);
      await expect(runtime.getByRole("heading", { name: /Task queues|任务队列/ })).toBeVisible();
      await page.unroute("**/api/admin/runtime-status");
      await runtime.getByRole("button", { name: /Refresh status|刷新状态/ }).click();
      await expect(runtime.getByRole("alert")).toHaveCount(0);
      await page.goto(`${base}/library`);
      await expect(page.locator("p:visible, span:visible").filter({ hasText: /^Offline ready|^Existing offline version is available|^可离线启动|^现有离线版本可用/ }).first()).toBeVisible();
      const network = await context.newCDPSession(page);
      await network.send("Network.enable");
      await context.setOffline(true);
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await page.reload({ waitUntil: "domcontentloaded" });
      // Bundled Chromium resets the replacement renderer on service-worker navigation.
      // Reapply real network emulation, as in the email-change offline regression.
      await network.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await network.send("Network.overrideNetworkState", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await openSettings(page, /Help & diagnostics|帮助与诊断/);
      await expect(help.getByText(/Currently offline|当前离线/, { exact: true })).toBeVisible();
      await expect(help.getByText(/Last known|上次已知/)).toBeVisible();
      await expect(help.getByText(new RegExp(`${actualCaps.maximum_import_size_mb} MiB`))).toBeVisible();
      await expect(help.getByText(/Startup resources complete|启动资源完整/, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/help-offline-${width}.png` });
      await expect(help.getByRole("button", { name: /Generate & copy diagnostics|生成并复制诊断/ })).toHaveCount(0);
      await network.detach();
    } finally { await context.close(); await admin.dispose(); }
  });
}

test("runtime polling pauses when hidden and resumes with a fresh real request", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage(); await page.clock.install(); await page.goto(base);
    let requests = 0;
    page.on("request", (request) => { if (request.url().endsWith("/api/admin/runtime-status")) requests += 1; });
    await openSettings(page, /Runtime status|运行状态/);
    const runtime = page.getByRole("region", { name: /Runtime status|运行状态/ });
    await expect(runtime.getByRole("heading", { name: /Task queues|任务队列/ })).toBeVisible();
    const initial = requests;
    const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/admin/runtime-status") && response.status() === 200);
    await page.clock.fastForward(31_000); await refreshed;
    expect(requests).toBeGreaterThan(initial);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    const hidden = requests;
    await page.clock.fastForward(61_000);
    expect(requests).toBe(hidden);
    const resumed = page.waitForResponse((response) => response.url().endsWith("/api/admin/runtime-status") && response.status() === 200);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    await resumed; expect(requests).toBeGreaterThan(hidden);
  } finally { await context.close(); await admin.dispose(); }
});

test("help cache stays account-scoped and disappears behind expired authorization", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", baseURL: base, extraHTTPHeaders: { Origin: base } });
  const userIds: string[] = [];
  try {
    const password = "synthetic help isolation passphrase";
    const register = async (suffix: string) => { const response = await context.request.post("/api/auth/register", { data: { email: `help-${suffix}-${Date.now()}@example.test`, password, confirm_password: password } }); expect(response.status()).toBe(201); const id = (await response.json()).user_id; userIds.push(id); return id; };
    await register("a");
    expect((await context.request.get("/api/admin/runtime-status")).status()).toBe(404);
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.clock.install(); await page.goto(`${base}/library`);
    await expect(page.locator("p:visible, span:visible").filter({ hasText: /^Offline ready|^Existing offline version is available/ }).first()).toBeVisible();
    await openSettings(page, /Help & diagnostics|帮助与诊断/);
    const help = page.getByRole("region", { name: /Help & diagnostics|帮助与诊断/ });
    await expect(help.getByText("Connected to server", { exact: true })).toBeVisible();
    await context.setOffline(true); await page.clock.fastForward(49 * 60 * 60 * 1000);
    await expect(page.getByRole("heading", { name: /Sign in required|需要重新登录/ })).toBeVisible();
    await expect(help).toHaveCount(0);
    await page.clock.setFixedTime(new Date()); await context.setOffline(false);
    // Leave A's private boundary before switching cookies, as the sign-in link does.
    // Otherwise its reconnect check races B's out-of-band fixture registration.
    await page.goto(`${base}/login?reauth=1`); await context.clearCookies();
    await register("b");
    await settingsAppearance(context.request, base, "en-US");
    // Force this new account's first capabilities request to fail; it cannot inherit A's snapshot.
    await page.route("**/api/auth/capabilities", (route) => route.abort("failed"));
    await page.goto(base); await openSettings(page, /Help & diagnostics|帮助与诊断/);
    await expect(help.getByText("Server unavailable or unverified", { exact: true })).toBeVisible();
    await expect(help.locator("dl").getByText("Unknown", { exact: true }).first()).toBeVisible();
    await expect(help.getByRole("button", { name: "Generate & copy diagnostics" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /Runtime status|运行状态/ })).toHaveCount(0);
  } finally {
    for (const id of userIds) await removeSyntheticAccount(admin, id);
    await context.close(); await admin.dispose();
  }
});
