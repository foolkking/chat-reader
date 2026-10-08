import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL/API");
async function open(page: Page, admin: APIRequestContext, base: string, width: number) {
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.setViewportSize({ width, height: 900 });
  await settingsAppearance(page.request, base, width === 768 ? "en-US" : "zh-CN");
  await page.goto(base);
  const settings = page.getByRole("button", { name: /^(设置|Settings)$/ });
  const sidebar = page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await page.getByRole("button", { name: /^(用户与访问|Users & access)$/ }).click();
  await page.getByRole("button", { name: /^(注册与邀请|Registration & invitations)$/ }).click();
  return page.getByRole("region", { name: /^(注册与邀请|Registration & invitations)$/ });
}
async function shot(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
}
async function fixture(admin: APIRequestContext) {
  const original = await (await admin.get("/api/admin/access")).json();
  expect((await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: false, email_verification_enabled: false, password_reset_enabled: true } })).status()).toBe(200);
  return () => admin.put("/api/admin/access/registration", { data: { ...original, mode: original.registration_mode } });
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: stale registration settings cannot remove a new account's approval gate`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
    let userId = "";
    const visitor = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
    try {
      const panel = await open(page, admin, baseURL!, width);
      const reset = panel.getByRole("checkbox", { name: /允许自助密码找回|Allow self-service password reset/ });
      await reset.uncheck();
      expect((await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: true } })).status()).toBe(200);
      const saved = page.waitForResponse(response => response.url().endsWith("/api/admin/access/registration") && response.request().method() === "PUT");
      await panel.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ }).click();
      const response = await saved;
      expect(response.status()).toBe(409);
      expect(response.request().postDataJSON()).toEqual({ password_reset_enabled: false, base_revision: expect.any(String) });
      await shot(page, `registration-conflict-${width}`);
      expect((await (await admin.get("/api/admin/access")).json()).require_admin_approval).toBe(true);
      await panel.getByRole("button", { name: /^(读取最新注册策略|Read latest registration policy)$/ }).click();
      const comparison = panel.getByRole("region", { name: /比较注册策略|Compare registration policy/ });
      await expect(comparison).toBeVisible(); await expect(reset).not.toBeChecked();
      await expect(panel.getByRole("checkbox", { name: /新账户需要管理员审批|Require approval for new accounts/ })).toBeChecked();
      await expect(panel.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ })).toBeInViewport();
      await expect(panel.getByRole("button", { name: /^(使用服务器策略|Use server policy)$/ })).toBeInViewport();
      await shot(page, `registration-compare-${width}`);
      await panel.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ }).click();
      await expect(panel.getByRole("status").filter({ hasText: /注册策略已保存|Registration policy saved/ })).toBeVisible();
      expect(await (await admin.get("/api/admin/access")).json()).toMatchObject({ require_admin_approval: true, password_reset_enabled: false, registration_mode: "OPEN" });
      const email = `registration-recovery-${crypto.randomUUID()}@example.test`, password = "synthetic registration recovery password";
      const registered = await visitor.post("/api/auth/register", { data: { email, password, confirm_password: password } });
      expect(registered.status()).toBe(201); const account = await registered.json(); userId = account.user_id;
      expect(account).toMatchObject({ authenticated: false, approval_required: true });
      expect((await visitor.post("/api/auth/login", { data: { email, password } })).status()).toBe(401);
      expect((await (await admin.get(`/api/admin/access/users/${userId}`)).json()).can_login).toBe(false);
    } finally { if (userId) await removeSyntheticAccount(admin, userId); expect((await restore()).status()).toBe(200); await visitor.dispose(); await admin.dispose(); }
  });

  test(`${width}px: a lost real registration save is checked without another write`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
    let writes = 0;
    try {
      const panel = await open(page, admin, baseURL!, width);
      await page.route("**/api/admin/access/registration", async route => { writes += 1; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); });
      await panel.getByRole("checkbox", { name: /允许自助密码找回|Allow self-service password reset/ }).uncheck();
      await panel.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ }).click();
      await expect(panel.getByRole("alert")).toBeVisible();
      expect((await (await admin.get("/api/admin/access")).json()).password_reset_enabled).toBe(false);
      await shot(page, `registration-unknown-${width}`);
      await panel.getByRole("button", { name: /^(检查保存结果|Check save result)$/ }).click();
      await expect(panel.getByRole("status").filter({ hasText: /当前注册策略与本次提交一致|Current registration policy matches your submitted changes/ })).toBeVisible();
      expect(writes).toBe(1);
      await expect(panel.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ })).toBeDisabled();
      await shot(page, `registration-confirmed-${width}`);
    } finally { await page.unroute("**/api/admin/access/registration"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
  });
}

test("375px: failed policy reads and a second conflict preserve the invitation draft", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
  try {
    const panel = await open(page, admin, baseURL!, 375);
    await panel.getByRole("button", { name: /^(创建邀请|Create invitation)$/ }).click();
    const hours = panel.getByRole("spinbutton", { name: /有效期|Valid for/ }); await hours.fill("72");
    await panel.getByRole("button", { name: /^(关闭|Closed)$/ }).click();
    expect((await admin.put("/api/admin/access/registration", { data: { mode: "INVITE_ONLY" } })).status()).toBe(200);
    const save = panel.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ });
    const latest = panel.getByRole("button", { name: /^(读取最新注册策略|Read latest registration policy)$/ });
    await save.click(); await expect(latest).toBeVisible();
    await page.route("**/api/admin/access", route => route.fulfill({ status: 503, json: { detail: "Synthetic read outage" } }));
    await latest.click(); await expect(panel.getByRole("alert")).toContainText(/读取失败|Read failed/);
    await expect(save).toBeDisabled(); await expect(hours).toHaveValue("72");
    await shot(page, "registration-read-failure-375");
    await page.unroute("**/api/admin/access");
    await latest.click();
    const compare = panel.getByRole("region", { name: /比较注册策略|Compare registration policy/ });
    await expect(compare).toContainText(/仅邀请|Invite only/); await expect(compare).toContainText(/关闭|Closed/);
    expect(await compare.evaluate(element => element.parentElement === document.activeElement)).toBe(true);
    expect((await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: true } })).status()).toBe(200);
    await save.click(); await latest.click();
    await expect(compare).toContainText(/开放|Open/); await expect(hours).toHaveValue("72");
    await shot(page, "registration-second-conflict-375");
    await panel.getByRole("button", { name: /^(使用服务器策略|Use server policy)$/ }).click();
    await expect(panel.getByRole("button", { name: /^(开放|Open)$/ })).toHaveAttribute("aria-pressed", "true");
    await expect(save).toBeDisabled(); await expect(hours).toHaveValue("72");
  } finally { await page.unroute("**/api/admin/access"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
});

test("768px: an unsent save needs an explicit second save after checking", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
  let writes = 0;
  try {
    const panel = await open(page, admin, baseURL!, 768);
    await page.route("**/api/admin/access/registration", route => ++writes === 1 ? route.abort("failed") : route.continue());
    await panel.getByRole("button", { name: "Invite only", exact: true }).click();
    const save = panel.getByRole("button", { name: "Save registration policy", exact: true });
    await save.click(); await panel.getByRole("button", { name: "Check save result", exact: true }).click();
    await expect(panel.getByRole("region", { name: "Compare registration policy", exact: true })).toContainText("Invite only");
    expect(writes).toBe(1);
    expect((await (await admin.get("/api/admin/access")).json()).registration_mode).toBe("OPEN");
    await shot(page, "registration-not-saved-768");
    await save.focus(); await page.keyboard.press("Enter");
    await expect(panel.getByRole("status").filter({ hasText: "Registration policy saved" })).toBeVisible();
    expect(writes).toBe(2);
    expect((await (await admin.get("/api/admin/access")).json()).registration_mode).toBe("INVITE_ONLY");
  } finally { await page.unroute("**/api/admin/access/registration"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
});

test("1440px: unavailable mail discovery does not block saving unrelated policy", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
  try {
    expect((await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", email_verification_enabled: true } })).status()).toBe(200);
    // Model changed deployment discovery only. The PUT is real; the API suite
    // independently verifies the actual server with SMTP configuration removed.
    await page.route("**/api/admin/access", async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ...await response.json(), smtp_configured: false } }); });
    const panel = await open(page, admin, baseURL!, 1440);
    await expect(panel.getByText(/邮件服务未配置|Email delivery is not configured/)).toBeVisible();
    await panel.getByRole("checkbox", { name: /允许自助密码找回|Allow self-service password reset/ }).uncheck();
    const response = page.waitForResponse(r => r.url().endsWith("/api/admin/access/registration") && r.request().method() === "PUT");
    await panel.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ }).click();
    const saved = await response; expect(saved.status()).toBe(200);
    expect(saved.request().postDataJSON()).toEqual({ password_reset_enabled: false, base_revision: expect.any(String) });
    expect(await (await admin.get("/api/admin/access")).json()).toMatchObject({ password_reset_enabled: false, email_verification_enabled: true });
    await shot(page, "registration-mail-independent-1440");
  } finally { await page.unroute("**/api/admin/access"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
});

for (const method of ["GET", "PUT"] as const) {
  test(`1440px: stalled registration ${method} times out and recovers`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const pattern = method === "GET" ? "**/api/admin/access" : "**/api/admin/access/registration";
    try {
      if (method === "GET") await page.route(pattern, async route => { started = Date.now(); await held; await route.abort("failed").catch(() => {}); });
      await open(page, admin, baseURL!, 1440);
      const dialog = page.getByRole("dialog", { name: /^(用户与访问|Users & access)$/ });
      if (method === "PUT") {
        await page.route(pattern, async route => { started = Date.now(); await held; await route.abort("failed").catch(() => {}); });
        await dialog.getByRole("checkbox", { name: /允许自助密码找回|Allow self-service password reset/ }).uncheck();
        await dialog.getByRole("button", { name: /^(保存注册策略|Save registration policy)$/ }).click();
      }
      await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 24_000 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(19_000); expect(Date.now() - started).toBeLessThan(25_000);
      await shot(page, `registration-timeout-${method.toLowerCase()}-1440`);
      release(); await page.unroute(pattern);
      await dialog.getByRole("button", { name: method === "GET" ? /^(重试|Retry)$/ : /^(检查保存结果|Check save result)$/ }).click();
      if (method === "GET") await expect(dialog.getByRole("checkbox", { name: /允许自助密码找回|Allow self-service password reset/ })).toBeChecked();
      else {
        await expect(dialog.getByRole("region", { name: /比较注册策略|Compare registration policy/ })).toBeVisible();
        expect((await (await admin.get("/api/admin/access")).json()).password_reset_enabled).toBe(true);
      }
    } finally { release(); await page.unroute(pattern); expect((await restore()).status()).toBe(200); await admin.dispose(); }
  });
}

test("375px: another device's language change preserves registration and invitation drafts", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
  try {
    const panel = await open(page, admin, baseURL!, 375);
    await panel.getByRole("checkbox", { name: "允许自助密码找回", exact: true }).uncheck();
    await panel.getByRole("button", { name: "创建邀请", exact: true }).click();
    await panel.getByRole("spinbutton", { name: /有效期/ }).fill("72");
    await settingsAppearance(admin, baseURL!, "en-US");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(panel.getByRole("button", { name: "Save registration policy", exact: true })).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: "Allow self-service password reset", exact: true })).not.toBeChecked();
    await expect(panel.getByRole("spinbutton", { name: /Valid for/ })).toHaveValue("72");
    expect((await (await admin.get("/api/admin/access")).json()).password_reset_enabled).toBe(true);
    await shot(page, "registration-language-draft-375");
  } finally { expect((await restore()).status()).toBe(200); await admin.dispose(); }
});
