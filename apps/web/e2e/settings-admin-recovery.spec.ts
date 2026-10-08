import { expect, test, type Page } from "@playwright/test";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openUsers(page: Page) {
  const entry = page.getByRole("button", { name: /Users & access|用户与访问/ }).filter({ visible: true });
  if (!await entry.isVisible()) {
    const settings = page.getByRole("button", { name: /^(Settings|设置)$/ }).filter({ visible: true });
    const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ }).filter({ visible: true });
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    await settings.click();
  }
  await entry.click();
  return page.getByRole("dialog", { name: /Users & access|用户与访问/ });
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`account acknowledgement remains usable during delayed refresh ${width}`, async ({ browser, playwright, baseURL }, testInfo) => {
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const owner = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, storageState: await admin.storageState() });
    let uid = "", hold = false;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      const registered = await owner.post("/api/auth/register", { data: {
        email: `admin-ack-${width}-${Date.now()}@example.test`, display_name: "Synthetic acknowledgement account",
        password: "synthetic account recovery passphrase", confirm_password: "synthetic account recovery passphrase",
      } });
      expect(registered.status()).toBe(201); uid = (await registered.json()).user_id;
      await settingsAppearance(context.request, base, locale);
      const page = await context.newPage(); await page.goto(base);
      const panel = await openUsers(page);
      await panel.getByLabel(/Email or name|邮箱或名称/).fill("Synthetic acknowledgement account");
      await panel.getByRole("button", { name: /Search users|搜索用户/ }).click();
      await panel.getByRole("button", { name: /View account: Synthetic acknowledgement account|查看账户: Synthetic acknowledgement account/ }).click();
      await expect(panel.getByRole("heading", { name: "Synthetic acknowledgement account" })).toBeFocused();
      await page.route("**/api/admin/access/users/**", async route => {
        if (hold && route.request().method() === "GET") await held;
        await route.continue();
      });
      hold = true;
      const written = page.waitForResponse(response => response.url().endsWith(`/users/${uid}/status`) && response.request().method() === "PATCH");
      await panel.getByRole("button", { name: /^(Disable account|禁用账户)$/ }).click();
      expect((await written).status()).toBe(200);
      expect((await (await admin.get(`/api/admin/access/users/${uid}`)).json()).status).toBe("DISABLED");
      expect((await owner.get("/api/conversations")).status()).toBe(401);
      const enable = panel.getByRole("button", { name: /^(Enable account|启用账户)$/ });
      if (process.env.PLAYWRIGHT_GATE_ID === "admin-account-before") await page.screenshot({ path: testInfo.outputPath(`admin-ack-${width}.png`) });
      await expect(enable).toBeEnabled({ timeout: 3000 });
      await page.screenshot({ path: testInfo.outputPath(`admin-ack-${width}.png`) });
      await enable.focus(); await page.keyboard.press("Enter");
      await expect(panel.getByRole("button", { name: /^(Disable account|禁用账户)$/ })).toBeEnabled({ timeout: 3000 });
      expect((await (await admin.get(`/api/admin/access/users/${uid}`)).json()).status).toBe("ACTIVE");
      hold = false; release();
      await page.unrouteAll({ behavior: "wait" });
      const refreshAccount = panel.getByRole("button", { name: /^(Refresh account|刷新账户)$/ });
      await expect(refreshAccount).toBeEnabled();
      await page.route(`**/api/admin/access/users/${uid}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Synthetic read failure" }) }));
      const failedRead = page.waitForResponse(response => response.url().endsWith(`/users/${uid}`) && response.status() === 503);
      await refreshAccount.click();
      await failedRead;
      await expect(panel.getByRole("alert")).toContainText(/Unable to load|暂时无法读取/);
      await expect(panel.getByRole("heading", { name: "Synthetic acknowledgement account" })).toBeVisible();
      await expect(panel.getByRole("button", { name: /^(Disable account|禁用账户)$/ })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath(`admin-read-failure-${width}.png`) });
      await page.unrouteAll({ behavior: "wait" });
      await panel.getByRole("button", { name: /^(Retry|重试)$/ }).click();
      await expect(panel.getByRole("button", { name: /^(Disable account|禁用账户)$/ })).toBeEnabled();
      await panel.getByText(/^(Password assistance|密码帮助)$/).click();
      await panel.getByRole("button", { name: /^(Create reset link|生成重置链接)$/ }).click();
      await expect(panel.locator("#admin-reset-link")).toBeVisible();
      await removeSyntheticAccount(admin, uid); uid = "";
      await panel.getByRole("button", { name: /^(Refresh account|刷新账户)$/ }).click();
      await expect(panel.getByRole("alert")).toContainText(/no longer exists|已不存在/);
      await expect(panel.getByRole("heading", { name: "Synthetic acknowledgement account" })).toHaveCount(0);
      await expect(panel.locator("#admin-reset-link")).toHaveCount(0);
      await expect(panel.getByRole("button", { name: /^(Disable account|禁用账户)$/ })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`admin-account-unavailable-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release(); await context.close();
      if (uid) await removeSyntheticAccount(admin, uid);
      await owner.dispose(); await admin.dispose();
    }
  });
}

for (const [width, locale] of [[375, "zh-CN"], [1440, "en-US"]] as const) {
  test(`last filtered account moves back to a valid page ${width}`, async ({ browser, playwright, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const owner = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, storageState: await admin.storageState() });
    const ids: string[] = [], prefix = `admin-pages-${width}-${Date.now()}`;
    try {
      for (let n = 0; n < 21; n++) {
        const response = await owner.post("/api/auth/register", { data: {
          email: `${prefix}-${n}@example.test`, display_name: `Synthetic paging account ${n}`,
          password: "synthetic paging account passphrase", confirm_password: "synthetic paging account passphrase",
        } });
        expect(response.status()).toBe(201); ids.push((await response.json()).user_id);
      }
      await settingsAppearance(context.request, base, locale);
      const page = await context.newPage(); await page.goto(base);
      const panel = await openUsers(page);
      await panel.getByLabel(/Email or name|邮箱或名称/).fill(prefix);
      await panel.getByRole("button", { name: /Search users|搜索用户/ }).click();
      await panel.getByLabel(/Account status|账户状态/).selectOption("ACTIVE");
      const details = panel.locator("[data-user-detail]");
      await expect(details).toHaveCount(20);
      await panel.getByRole("button", { name: /^(Next|下一页)$/ }).click();
      await expect(details).toHaveCount(1);
      const target = await details.first().getAttribute("data-user-detail");
      await details.first().click();
      await panel.getByRole("button", { name: /^(Disable account|禁用账户)$/ }).click();
      await expect(panel.getByRole("button", { name: /^(Enable account|启用账户)$/ })).toBeEnabled();
      expect((await (await admin.get(`/api/admin/access/users/${target}`)).json()).status).toBe("DISABLED");
      await panel.getByRole("button", { name: /^(Back to users|返回用户列表)$/ }).click();
      await expect(details).toHaveCount(20);
      await expect(panel.getByRole("navigation", { name: /^(Pagination|分页)$/ })).toContainText("1–20 / 20");
      await expect(panel.getByLabel(/Email or name|邮箱或名称/)).toHaveValue(prefix);
      await expect(panel.getByLabel(/Account status|账户状态/)).toHaveValue("ACTIVE");
      await expect(details.first()).toBeFocused();
      expect(await details.evaluateAll(rows => rows.map(row => row.getAttribute("data-user-detail")))).not.toContain(target);
      await page.screenshot({ path: testInfo.outputPath(`admin-page-return-${width}.png`) });
      await details.nth(12).click();
      await panel.getByRole("button", { name: /^(Back to users|返回用户列表)$/ }).click();
      await expect(details.nth(12)).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
      for (const id of ids) await removeSyntheticAccount(admin, id);
      await owner.dispose(); await admin.dispose();
    }
  });
}

test("lost deletion response reattaches after the account is already gone", async ({ browser, playwright, baseURL }, testInfo) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const owner = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
  const context = await browser.newContext({ viewport: { width: 375, height: 900 }, locale: "en-US", storageState: await admin.storageState() });
  let uid = "", removed = false;
  try {
    const response = await owner.post("/api/auth/register", { data: {
      email: `admin-delete-result-${Date.now()}@example.test`, display_name: "Synthetic deletion result account",
      password: "synthetic deletion result passphrase", confirm_password: "synthetic deletion result passphrase",
    } });
    expect(response.status()).toBe(201); uid = (await response.json()).user_id;
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base);
    const panel = await openUsers(page);
    await panel.getByLabel("Email or name").fill("Synthetic deletion result account");
    await panel.getByRole("button", { name: "Search users" }).click();
    await panel.getByRole("button", { name: "View account: Synthetic deletion result account" }).click();
    await panel.getByRole("button", { name: "Delete account…", exact: true }).click();
    const keys: string[] = [];
    await page.route(`**/api/admin/access/users/${uid}/delete`, async route => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 2) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Synthetic recovery failure" }) }); return; }
      if (keys.length > 1) { await route.continue(); return; }
      const accepted = await route.fetch(); expect(accepted.status()).toBe(202);
      const { job_id: taskId } = await accepted.json();
      await expect.poll(async () => (await (await admin.get(`/api/tasks/${taskId}`)).json()).status).toBe("committed");
      expect((await admin.get(`/api/admin/access/users/${uid}`)).status()).toBe(404);
      removed = true; await route.abort();
    });
    await panel.getByRole("button", { name: "Confirm account deletion", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Check deletion result", exact: true })).toBeEnabled();
    await expect(panel.getByRole("heading", { name: "Synthetic deletion result account" })).toHaveCount(0);
    await expect(panel.getByText("Could not confirm the action result", { exact: false })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("admin-deletion-result-375.png") });
    await panel.getByRole("button", { name: "Check deletion result", exact: true }).click();
    await expect(panel.getByText("Could not retrieve the deletion result. Try again.", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Check deletion result", exact: true }).click();
    await expect(panel.getByText(/Account and private content deleted/)).toBeVisible();
    expect(keys).toHaveLength(3); expect(keys[0]).toBeTruthy(); expect(new Set(keys).size).toBe(1);
    const audit = await (await admin.get(`/api/admin/audit?target_user_id=${uid}`)).json();
    expect(audit.filter((event: { action: string }) => event.action === "USER_DELETE_QUEUED")).toHaveLength(1);
    expect(audit.filter((event: { action: string }) => event.action === "USER_DELETED")).toHaveLength(1);
  } finally {
    await context.close();
    if (uid && !removed) await removeSyntheticAccount(admin, uid);
    await owner.dispose(); await admin.dispose();
  }
});
