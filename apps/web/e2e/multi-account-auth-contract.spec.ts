import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const webRoot = path.resolve(__dirname, "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(webRoot, relativePath), "utf8");
}

test.describe("multi-account authentication frontend contract", () => {
  test("login uses email plus password, password visibility, and a safe registration return path", () => {
    const login = source("app/login/page.tsx");
    const authClient = source("lib/auth-client.ts");
    expect(login).toContain('id="login-email"');
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain("<PasswordField");
    expect(login).toContain("/register?return_to=");
    expect(authClient).toContain('authMutation<AuthSessionState>("/api/auth/login", { email, password })');
    expect(authClient).toContain("decodeURIComponent(pathname)");
    expect(authClient).toContain("share|shared");
    expect(authClient).toContain("login|register|account-upgrade|password-reset|reset-password");
  });

  test("return paths fail closed after URL decoding", async ({ page }) => {
    await page.route("**/api/auth/setup/status", (route) => route.fulfill({ json: { setup_required: false, registration_mode: "OPEN" } }));
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: unauthenticatedSession("OPEN", false) }));
    await page.goto("/login?return_to=%2F%252Foutside.example");
    await expect(page.getByRole("link", { name: /Create an account|创建账户/ })).toHaveAttribute("href", "/register");
    await expect(page.getByRole("link", { name: /Forgot password|忘记密码/ })).toHaveCount(0);
  });

  test("register represents CLOSED, OPEN, and INVITE_ONLY without guessing from authentication", () => {
    const register = source("app/register/page.tsx");
    const authClient = source("lib/auth-client.ts");
    expect(authClient).toContain('export type RegistrationMode = "CLOSED" | "INVITE_ONLY" | "OPEN"');
    expect(register).toContain('mode === "CLOSED"');
    expect(register).toContain('mode === "OPEN" || mode === "INVITE_ONLY"');
    expect(register).toContain('id="invitation-token"');
    expect(register).toContain("当前实例未开放注册");
    expect(authClient).toContain("invitation_token: input.invitationToken || undefined");
  });

  test("legacy owner setup is public, explicit, and requires a fresh email login", () => {
    const setup = source("app/account-upgrade/page.tsx");
    const authClient = source("lib/auth-client.ts");
    const proxy = source("proxy.ts");
    const boundary = source("components/auth-boundary.tsx");
    expect(setup).toContain('id="upgrade-current-password"');
    expect(setup).toContain('id="upgrade-email"');
    expect(setup).toContain('/login?upgraded=1');
    expect(authClient).toContain('"/api/auth/setup/status"');
    expect(authClient).toContain('"/api/auth/setup/upgrade"');
    for (const route of ["login", "register", "account-upgrade", "password-reset", "reset-password"]) {
      expect(proxy).toContain(route);
      expect(boundary).toContain(route);
    }
  });
});

test.describe("multi-account authentication public pages", () => {
  test("login is keyboard-ready, exposes password visibility, and preserves a safe return path", async ({ page }) => {
    await page.route("**/api/auth/setup/status", (route) => route.fulfill({ json: { setup_required: false, registration_mode: "OPEN" } }));
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: unauthenticatedSession("OPEN", true) }));
    await page.goto("/login?return_to=%2Frecent");
    await expect(page.getByRole("heading", { name: /Sign in|登录/ })).toBeVisible();
    await expect(page.locator("#login-email")).toHaveAttribute("autocomplete", "username");
    await expect(page.locator("#login-password")).toHaveAttribute("type", "password");
    await expect(page.getByRole("link", { name: /Forgot password|忘记密码/ })).toHaveAttribute("href", "/reset-password?return_to=%2Frecent");
    await page.getByRole("button", { name: /Show password|显示密码/ }).click();
    await expect(page.locator("#login-password")).toHaveAttribute("type", "text");
    await expect(page.getByRole("link", { name: /Create an account|创建账户/ })).toHaveAttribute("href", "/register?return_to=%2Frecent");
  });

  test("CLOSED registration is explicit and does not render a misleading form", async ({ page }) => {
    await mockRegistrationAvailability(page, "CLOSED");
    await page.goto("/register");
    await expect(page.getByText(/Registration is closed|当前实例未开放注册/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Create account|创建账户/ })).toHaveCount(0);
  });

  test("OPEN registration submits email and matching passwords without silently enabling a custom mode", async ({ page }) => {
    await mockRegistrationAvailability(page, "OPEN");
    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/auth/register", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 422, json: { detail: "Fixture rejection" } });
    });
    await page.goto("/register");
    await page.locator("#register-email").fill("reader@example.test");
    await page.locator("#register-password").fill("correct horse battery staple");
    await page.locator("#register-confirm-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: /Create account|创建账户/ }).click();
    await expect(page.locator("p[role='alert']")).toContainText(/Unable to create|无法使用/);
    expect(requestBody).toMatchObject({
      email: "reader@example.test",
      password: "correct horse battery staple",
      confirm_password: "correct horse battery staple",
    });
    expect(requestBody).not.toHaveProperty("invitation_token");
  });

  test("INVITE_ONLY renders the invitation contract and keeps the primary action disabled until complete", async ({ page }) => {
    await mockRegistrationAvailability(page, "INVITE_ONLY");
    await page.goto("/register?invite=invitation-fixture");
    await expect(page.getByText(/invitation only|仅接受受邀用户/)).toBeVisible();
    await expect(page.locator("#invitation-token")).toHaveValue("invitation-fixture");
    await expect(page.getByRole("button", { name: /Create account|创建账户/ })).toBeDisabled();
  });

  test("legacy owner setup asks for current authority and requires a fresh login", async ({ page }) => {
    await page.route("**/api/auth/setup/status", (route) => route.fulfill({ json: { setup_required: true, registration_mode: "CLOSED" } }));
    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/auth/setup/upgrade", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 401, json: { detail: "Current password is incorrect." } });
    });
    await page.goto("/account-upgrade");
    await page.locator("#upgrade-current-password").fill("incorrect fixture");
    await page.locator("#upgrade-email").fill("admin@example.test");
    await page.getByRole("button", { name: /Upgrade account|升级账户/ }).click();
    await expect(page.locator("p[role='alert']")).toContainText(/current owner password is incorrect|当前所有者密码不正确/);
    expect(requestBody).toMatchObject({ current_password: "incorrect fixture", email: "admin@example.test" });
  });

  test("password reset request keeps account existence private and token reset validates confirmation", async ({ page }) => {
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: unauthenticatedSession("CLOSED", true) }));
    await page.route("**/api/auth/password-reset/request", (route) => route.fulfill({ status: 204, body: "" }));
    await page.goto("/reset-password");
    await page.locator("#reset-email").fill("possibly-existing@example.test");
    await page.getByRole("button", { name: /Send reset link|发送重置链接/ }).click();
    await expect(page.getByText(/If an account matches|如果该邮箱对应/)).toBeVisible();

    await page.goto("/reset-password?token=fixture-token");
    await page.locator("#reset-new-password").fill("correct horse battery staple");
    await page.locator("#reset-confirm-password").fill("different horse battery staple");
    await page.getByRole("button", { name: /Update password|更新密码/ }).click();
    await expect(page.locator("p[role='alert']")).toContainText(/Passwords do not match|两次输入的密码不一致/);
  });
});

async function mockRegistrationAvailability(page: import("@playwright/test").Page, registrationMode: "CLOSED" | "INVITE_ONLY" | "OPEN") {
  await page.route("**/api/auth/setup/status", (route) => route.fulfill({ json: { setup_required: false, registration_mode: registrationMode } }));
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      authenticated: false,
      principal_id: null,
      user_id: null,
      inactivity_expires_at: null,
      auth_mode: "multi_account",
      email: null,
      display_name: null,
      role: null,
      registration_mode: registrationMode,
      password_reset_available: false,
    },
  }));
}

function unauthenticatedSession(registrationMode: "CLOSED" | "INVITE_ONLY" | "OPEN", passwordResetAvailable: boolean) {
  return {
    authenticated: false,
    principal_id: null,
    user_id: null,
    inactivity_expires_at: null,
    auth_mode: "multi_account",
    email: null,
    display_name: null,
    role: null,
    registration_mode: registrationMode,
    password_reset_available: passwordResetAvailable,
  };
}
