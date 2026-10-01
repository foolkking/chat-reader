import { expect, test } from "@playwright/test";

// The fixture is an isolated PostgreSQL API with a loopback SMTP sink. This
// test endpoint is provided by the fixture harness, never by the application.
test.describe("registration verification with SMTP and persistence", () => {
  test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated SMTP/PostgreSQL settings fixture");
  test("settings preserves policy drafts, menu scroll and keyboard focus", async ({ page, baseURL }) => {
    await page.goto("/login");
    await page.locator("#login-email").fill(process.env.E2E_AUTH_EMAIL!);
    await page.locator("#login-password").fill(process.env.E2E_AUTH_PASSWORD!);
    await page.getByRole("button", { name: /登录|Sign in/, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
    const menu = page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"));
    const access = menu.getByRole("button", { name: /用户与访问|Users & access/ });
    await expect(access).toHaveCount(1);
    await access.scrollIntoViewIfNeeded();
    const scroll = await menu.evaluate((element) => element.scrollTop);
    await access.click();
    await page.getByRole("button", { name: /注册与邀请|Registration & invitations/, exact: true }).click();
    const approval = page.getByLabel(/新账户需要管理员审批|Require approval for new accounts/);
    const original = await approval.isChecked();
    await approval.setChecked(!original);
    await page.keyboard.press("Escape");
    const confirm = page.getByRole("dialog", { name: /放弃未保存的更改|Discard unsaved changes/ });
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).not.toBeVisible();
    await expect(approval).toBeVisible();
    expect(await approval.isChecked()).toBe(!original);
    await page.getByRole("button", { name: /保存注册策略|Save registration policy/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /注册策略已保存|Registration policy saved/ })).toBeVisible();
    expect((await (await page.request.get(`${baseURL}/api/admin/access`)).json()).require_admin_approval).toBe(!original);
    await page.keyboard.press("Escape");
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0);
    await expect(access).toBeFocused();
  });
  for (const width of [375, 768, 1440]) {
    for (const locale of ["zh-CN", "en-US"]) {
      test(`${width}px ${locale}: email confirmation and approval gate`, async ({ browser, playwright, baseURL }) => {
        const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
        expect((await admin.post("/api/auth/login", { data: { email: process.env.E2E_AUTH_EMAIL, password: process.env.E2E_AUTH_PASSWORD } })).ok()).toBeTruthy();
        expect((await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: true, email_verification_enabled: true } })).ok()).toBeTruthy();
        const context = await browser.newContext({ viewport: { width, height: 900 }, locale, colorScheme: locale === "en-US" ? "dark" : "light" });
        await context.addInitScript(({ locale }) => {
          localStorage.setItem("chat-reader:user-preferences", JSON.stringify({ theme_mode: locale === "en-US" ? "dark" : "light", locale_mode: locale, updated_at: new Date().toISOString() }));
        }, { locale });
        const page = await context.newPage();
        const email = `settings-${Date.now()}-${width}@example.test`;
        const password = "synthetic registration browser passphrase";
        await page.goto(`${baseURL}/register`);
        await page.locator("#register-email").fill(email);
        await page.locator("#register-password").fill(password);
        await page.locator("#register-confirm-password").fill(password);
        const registration = page.waitForResponse((r) => r.url().endsWith("/api/auth/register") && r.request().method() === "POST");
        await page.getByRole("button", { name: /创建账户|Create account/, exact: true }).click();
        const response = await registration;
        expect(response.status()).toBe(201);
        const account = await response.json();
        expect(account.authenticated).toBe(false);
        expect(account.verification_delivery).toBe("sent");
        await expect(page.getByText(/账户等待邮箱验证|Account awaiting email verification/, { exact: true })).toBeVisible();
        const mailbox = await (await admin.get("/api/settings-test/mail")).json() as { to: string; text: string }[];
        const message = mailbox.findLast((m) => m.to === email);
        const link = message?.text.match(/http[^\s]+\/verify-email#token=[\w-]+/)?.[0];
        expect(link).toBeTruthy();
        await page.goto(link!);
        await expect(page.locator("html")).toHaveAttribute("data-theme", locale === "en-US" ? "dark" : "light");
        await expect(page.getByRole("button", { name: /确认邮箱|Confirm email/, exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        // Reload/preview did not consume the grant. Approval alone still cannot
        // yield a session; only a deliberate confirmation can complete it.
        await page.reload();
        expect((await admin.post(`/api/admin/access/users/${account.user_id}/approve`)).ok()).toBeTruthy();
        expect((await context.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(401);
        await page.getByRole("button", { name: /确认邮箱|Confirm email/, exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("status")).toHaveText(/邮箱已验证，可以登录。|Email verified. You can now sign in./);
        expect(page.url()).not.toContain("token=");
        await page.goto(`${baseURL}/login`);
        await page.locator("#login-email").fill(email);
        await page.locator("#login-password").fill(password);
        await page.getByRole("button", { name: /登录|Sign in/, exact: true }).click();
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/auth/me`)).json()).user_id).toBe(account.user_id);
        await context.close(); await admin.dispose();
      });
    }
  }
});
