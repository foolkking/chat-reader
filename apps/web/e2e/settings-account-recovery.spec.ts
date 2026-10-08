import { expect, test, type APIRequest, type Browser, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL/API");

async function fixture(browser: Browser, playwright: { request: APIRequest }, base: string, width: number) {
  const admin = await settingsAdmin(playwright.request, base);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const email = `account-recovery-${Date.now()}@example.test`, password = "synthetic account recovery passphrase";
  const headers = { Origin: base };
  expect((await context.request.post(`${base}/api/auth/register`, { headers, data: { email, password, confirm_password: password } })).status()).toBe(201);
  await settingsAppearance(context.request, base, locale);
  expect((await context.request.patch(`${base}/api/auth/me`, { headers, data: { display_name: "Saved identity" } })).status()).toBe(200);
  const page = await context.newPage();
  const profile = async () => (await (await context.request.get(`${base}/api/auth/me`)).json());
  const open = async () => {
    await page.goto(base);
    const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
    const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    await settings.click();
    await page.getByRole("button", { name: /Account & security|账户与安全/ }).click();
  };
  const dialog = page.getByRole("dialog", { name: /Account & security|账户与安全/ });
  const name = dialog.getByRole("textbox", { name: /^(显示名称|Display name)$/ });
  const devices = dialog.getByRole("heading", { name: /^(已登录设备|Signed-in devices)$/ }).locator("xpath=ancestor::section[1]");
  return { admin, context, page, email, password, headers, profile, open, dialog, name, devices };
}

async function shot(page: Page, name: string) {
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: device reads preserve account drafts and recover independently`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width);
    let fail = true, release = () => {};
    try {
      await f.page.route("**/api/auth/sessions", (route) => fail ? route.fulfill({ status: 503, json: { detail: "Synthetic session read failure" } }) : route.continue());
      await f.open();
      await shot(f.page, `account-initial-${width}`);
      await expect(f.name).toHaveValue("Saved identity", { timeout: 5_000 });
      await expect(f.devices.getByRole("alert")).toBeVisible();
      await shot(f.page, `account-initial-${width}`);
      await expect(f.devices.getByText(/暂无可显示的设备|No device sessions/)).toHaveCount(0);
      fail = false;
      await f.devices.getByRole("button", { name: /^(刷新|Refresh)$/ }).click();
      await expect(f.devices.getByText(/^(当前设备|Current device)$/)).toBeVisible();
      await f.name.fill("Unsaved display draft");
      await f.dialog.getByRole("button", { name: /^(修改密码|Change password)$/ }).click();
      await f.dialog.getByLabel(/^(当前密码|Current password)$/).fill("synthetic password draft");
      const held = new Promise<void>((resolve) => { release = resolve; });
      let readStarted = false;
      await f.page.unroute("**/api/auth/sessions");
      await f.page.route("**/api/auth/sessions", async (route) => { const response = await route.fetch(); readStarted = true; await held; await route.fulfill({ response }); });
      await f.devices.getByRole("button", { name: /^(刷新|Refresh)$/ }).click();
      await expect.poll(() => readStarted).toBe(true);
      await expect(f.name).toHaveValue("Unsaved display draft");
      await f.name.focus();
      release();
      await expect(f.devices.getByRole("button", { name: /^(刷新|Refresh)$/ })).toBeEnabled();
      await expect(f.name).toBeFocused();
      await expect(f.name).toHaveValue("Unsaved display draft");
      await expect(f.dialog.getByLabel(/^(当前密码|Current password)$/)).toHaveValue("synthetic password draft");
      expect((await f.profile()).display_name).toBe("Saved identity");
      await shot(f.page, `account-retained-${width}`);
      await f.page.keyboard.press("Escape");
      await expect(f.page.getByRole("dialog", { name: /放弃未保存的更改|Discard unsaved changes/ })).toBeVisible();
      await f.page.keyboard.press("Escape");
      await expect(f.name).toHaveValue("Unsaved display draft");
    } finally { release(); await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: profile save keeps newer input after its response`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width);
    let release = () => {};
    try {
      await f.open(); await expect(f.name).toHaveValue("Saved identity");
      const held = new Promise<void>((resolve) => { release = resolve; });
      let committed = false;
      await f.page.route("**/api/auth/me", async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        const response = await route.fetch(); expect(response.status()).toBe(200); committed = true;
        await held; await route.fulfill({ response });
      });
      await f.name.fill("First submitted name");
      await f.dialog.getByRole("button", { name: /^(保存账户信息|Save account details)$/ }).click();
      await expect.poll(() => committed).toBe(true);
      await f.name.fill("Newer unsaved name");
      release();
      await expect(f.dialog.getByText(/账户信息已保存|Account details saved/)).toBeVisible();
      await shot(f.page, `account-save-${width}`);
      await expect(f.dialog.getByRole("button", { name: /^(保存账户信息|Save account details)$/ })).toBeEnabled({ timeout: 5_000 });
      await expect(f.name).toHaveValue("Newer unsaved name", { timeout: 5_000 });
      await expect(f.name).toBeFocused();
      expect((await f.profile()).display_name).toBe("First submitted name");
      await f.page.unroute("**/api/auth/me");
      await f.dialog.getByRole("button", { name: /^(保存账户信息|Save account details)$/ }).click();
      await expect.poll(async () => (await f.profile()).display_name).toBe("Newer unsaved name");
      await expect(f.dialog.getByRole("button", { name: /^(保存账户信息|Save account details)$/ })).toBeDisabled();
    } finally { release(); await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: confirmed device revocation survives stale and failed reads`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width);
    const other = await playwright.request.newContext({ baseURL: baseURL!, extraHTTPHeaders: f.headers, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15" });
    let release = () => {};
    try {
      expect((await other.post("/api/auth/login", { data: { email: f.email, password: f.password } })).status()).toBe(200);
      const sessionRows = await (await f.context.request.get(`${baseURL}/api/auth/sessions`)).json();
      const otherLabel = sessionRows.find((session: { current: boolean }) => !session.current).device_label;
      await f.open();
      await expect(f.devices.getByText(otherLabel, { exact: true })).toBeVisible();
      const held = new Promise<void>((resolve) => { release = resolve; });
      let oldReadStarted = false, requests = 0, writes = 0;
      await f.page.route("**/api/auth/sessions", async (route) => {
        requests += 1;
        if (requests > 1) return route.fulfill({ status: 503, json: { detail: "Synthetic post-revocation read failure" } });
        const response = await route.fetch(); oldReadStarted = true; await held;
        try { await route.fulfill({ response }); } catch { /* A cancelled obsolete read is expected. */ }
      });
      await f.page.route("**/api/auth/sessions/logout-others", async (route) => { writes += 1; const response = await route.fetch(); expect(response.status()).toBe(204); await route.fulfill({ response }); });
      await f.devices.getByRole("button", { name: /^(刷新|Refresh)$/ }).click();
      await expect.poll(() => oldReadStarted).toBe(true);
      await f.devices.getByRole("button", { name: /^(退出其他设备|Log out other devices)$/ }).click();
      await f.page.getByRole("dialog", { name: /退出其他设备？|Log out other devices\?/ }).getByRole("button", { name: /^(退出其他设备|Log out other devices)$/ }).click();
      await expect.poll(async () => (await other.get("/api/auth/me")).status()).toBe(401);
      release();
      await expect.poll(() => requests).toBe(2);
      await shot(f.page, `account-revoked-${width}`);
      await expect(f.devices.getByText(/其他设备已退出|Other devices have been logged out/)).toBeVisible({ timeout: 5_000 });
      await expect(f.devices.getByText(otherLabel, { exact: true })).toHaveCount(0);
      await expect(f.devices.getByRole("alert")).toBeVisible();
      await shot(f.page, `account-revoked-${width}`);
      expect((await f.context.request.get(`${baseURL}/api/auth/me`)).status()).toBe(200);
      await f.page.unroute("**/api/auth/sessions");
      await f.devices.getByRole("button", { name: /^(刷新|Refresh)$/ }).click();
      await expect(f.devices.getByRole("alert")).toHaveCount(0);
      const sessions = await (await f.context.request.get(`${baseURL}/api/auth/sessions`)).json();
      expect(sessions).toHaveLength(1); expect(sessions[0].current).toBe(true);
      expect(writes).toBe(1);
    } finally { release(); await other.dispose(); await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: failed identity reads and saves keep independent device state`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright, baseURL!, width);
    let release = () => {};
    try {
      await f.page.route("**/api/auth/me", (route) => route.fulfill({ status: 503, json: { detail: "Synthetic identity read failure" } }));
      await f.open();
      await expect(f.devices.getByText(/^(当前设备|Current device)$/)).toBeVisible();
      await expect(f.name).toHaveCount(0);
      await expect(f.dialog.getByRole("alert")).toContainText(/无法加载账户信息|Unable to load account details/);
      await shot(f.page, `account-profile-read-${width}`);
      await f.page.unroute("**/api/auth/me");
      await f.dialog.getByRole("button", { name: /重新读取账户信息|Reload account details/ }).click();
      await expect(f.name).toHaveValue("Saved identity");
      await expect(f.dialog.getByRole("button", { name: /设置新邮箱|Set a new email/ })).toBeEnabled();
      const held = new Promise<void>((resolve) => { release = resolve; });
      let oldStarted = false, oldSettled = false, failSave = true;
      await f.page.route("**/api/auth/me", async (route) => {
        if (route.request().method() === "PATCH") {
          if (failSave) return route.fulfill({ status: 503, json: { detail: "Synthetic profile save failure" } });
          return route.continue();
        }
        const response = await route.fetch(); oldStarted = true; await held;
        try { await route.fulfill({ response }); } catch { /* Save aborts the older identity read. */ }
        oldSettled = true;
      });
      await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => oldStarted).toBe(true);
      await f.name.fill("Retry preserves my name");
      await f.dialog.getByRole("button", { name: /^(保存账户信息|Save account details)$/ }).click();
      await expect(f.dialog.getByRole("alert")).toContainText(/未获保存确认|save was not confirmed/);
      await expect(f.name).toHaveValue("Retry preserves my name");
      expect((await f.profile()).display_name).toBe("Saved identity");
      await shot(f.page, `account-profile-retry-${width}`);
      failSave = false;
      await f.dialog.getByRole("button", { name: /^(保存账户信息|Save account details)$/ }).click();
      await expect.poll(async () => (await f.profile()).display_name).toBe("Retry preserves my name");
      await expect(f.dialog.getByRole("button", { name: /^(保存账户信息|Save account details)$/ })).toBeDisabled();
      release(); await expect.poll(() => oldSettled).toBe(true);
      await expect(f.name).toHaveValue("Retry preserves my name");
      await expect(f.devices.getByText(/^(当前设备|Current device)$/)).toBeVisible();
      expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { release(); await f.context.close(); await f.admin.dispose(); }
  });
}

test("unconfirmed device revocation is checked without repeating its write", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright, baseURL!, 768);
  const other = await playwright.request.newContext({ baseURL: baseURL!, extraHTTPHeaders: f.headers });
  let writes = 0;
  try {
    expect((await other.post("/api/auth/login", { data: { email: f.email, password: f.password } })).status()).toBe(200);
    await f.open();
    await f.page.route("**/api/auth/sessions/logout-others", async (route) => {
      const response = await route.fetch(); expect(response.status()).toBe(204); writes += 1; await route.abort();
    });
    await f.devices.getByRole("button", { name: "Log out other devices", exact: true }).click();
    await f.page.getByRole("dialog", { name: "Log out other devices?" }).getByRole("button", { name: "Log out other devices", exact: true }).click();
    await expect(f.devices.getByRole("alert")).toContainText("Sign-out was not confirmed");
    await expect(f.devices.getByText("Other devices have been logged out.")).toHaveCount(0);
    await expect(f.devices.getByRole("button", { name: "Log out other devices", exact: true })).toBeDisabled();
    expect((await other.get("/api/auth/me")).status()).toBe(401);
    await shot(f.page, "account-unconfirmed-768");
    await f.devices.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(f.devices.getByRole("alert")).toHaveCount(0);
    const sessions = await (await f.context.request.get(`${baseURL}/api/auth/sessions`)).json();
    expect(sessions).toHaveLength(1); expect(sessions[0].current).toBe(true);
    expect(writes).toBe(1);
  } finally { await other.dispose(); await f.context.close(); await f.admin.dispose(); }
});
