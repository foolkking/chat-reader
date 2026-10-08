import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { settingsAdmin } from "./settings-test-helper";

const webRoot = path.resolve(__dirname, "..");
const userId = "00000000-0000-4000-8000-000000000111";
const otherUserId = "00000000-0000-4000-8000-000000000222";

test("account and access clients keep the authenticated API contracts explicit", () => {
  const source = fs.readFileSync(path.join(webRoot, "lib/account-access-client.ts"), "utf8");
  for (const endpoint of [
    "/api/auth/me",
    "/api/auth/sessions",
    "/api/auth/sessions/logout-others",
    "/api/admin/access",
    "/api/admin/access/users",
    "/api/admin/access/registration",
    "/api/admin/access/invitations",
    "/password-reset",
  ]) expect(source).toContain(endpoint);
  expect(source).toContain("notifyAuthenticationFailure(requestGeneration)");
});

test("regular users see their account and devices but not instance maintenance", async ({ page, playwright, baseURL }) => {
  // These are UI mocks. When run alongside the authenticated integration gate,
  // satisfy the real server navigation boundary before mocking browser reads.
  if (process.env.E2E_SETTINGS_MAILBOX === "1") {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    await page.context().addCookies((await admin.storageState()).cookies); await admin.dispose();
  }
  await mockSession(page, "USER");
  let profileUpdate: unknown = null;
  let loggedOutOthers = false;
  await page.route("**/api/auth/me", async (route) => {
    if (route.request().method() === "PATCH") {
      profileUpdate = route.request().postDataJSON();
      await route.fulfill({ json: session("USER", "Archive reader") });
      return;
    }
    await route.fulfill({ json: session("USER", "Reader") });
  });
  await page.route("**/api/auth/sessions", (route) => route.fulfill({ json: [
    { id: "current-session", device_label: "Chrome on Windows", created_at: "2026-09-01T00:00:00Z", last_activity_at: "2026-09-01T08:00:00Z", current: true },
    { id: "other-session", device_label: "Mobile browser", created_at: "2026-08-30T00:00:00Z", last_activity_at: "2026-08-31T08:00:00Z", current: false },
  ] }));
  await page.route("**/api/auth/sessions/logout-others", (route) => {
    loggedOutOthers = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
  await openSettings(page);
  await expect(page.getByRole("button", { name: /Users & access|\u7528\u6237\u4e0e\u8bbf\u95ee/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Data archive|\u6570\u636e\u5f52\u6863/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import formats|\u5bfc\u5165\u683c\u5f0f/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Noise rule library|\u566a\u58f0\u89c4\u5219\u5e93/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /System import formats|System noise rules|系统导入格式|系统噪声规则/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Account & security|\u8d26\u6237\u4e0e\u5b89\u5168/ }).click();
  await expect(page.getByRole("textbox", { name: /^(Email|邮箱)$/ })).toHaveValue("reader@example.test");
  await expect(page.getByText("Chrome on Windows")).toBeVisible();
  await page.getByLabel(/Display name|\u663e\u793a\u540d\u79f0/).fill("Archive reader");
  await page.getByRole("button", { name: /Save account details|\u4fdd\u5b58\u8d26\u6237\u4fe1\u606f/ }).click();
  expect(profileUpdate).toEqual({ display_name: "Archive reader" });
  await page.getByRole("button", { name: /Log out other devices|\u9000\u51fa\u5176\u4ed6\u8bbe\u5907/ }).click();
  await page.getByRole("dialog", { name: /Log out other devices\?|\u9000\u51fa\u5176\u4ed6\u8bbe\u5907\uff1f/ }).getByRole("button", { name: /Log out other devices|\u9000\u51fa\u5176\u4ed6\u8bbe\u5907/ }).click();
  expect(loggedOutOthers).toBe(true);
});

test("administrators manage users, registration and invitations in one focused surface", async ({ page, playwright, baseURL }) => {
  if (process.env.E2E_SETTINGS_MAILBOX === "1") {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    await page.context().addCookies((await admin.storageState()).cookies); await admin.dispose();
  }
  await mockSession(page, "ADMIN");
  let registrationMode = "";
  let userStatus = "ACTIVE";
  let invitationHours = 0;
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: session("ADMIN", "Administrator") }));
  const policy = { registration_mode: "CLOSED", smtp_configured: false, require_admin_approval: true, email_verification_enabled: false, password_reset_enabled: true, revision: "synthetic-policy-revision" };
  await page.route("**/api/admin/access", (route) => route.fulfill({ json: policy }));
  const reader = () => ({ id: otherUserId, email: "reader@example.test", display_name: "Reader", role: "USER", status: userStatus, approval_status: "APPROVED", email_verification_required: false, email_verified_at: null, last_login_at: null, can_login: userStatus === "ACTIVE", deletion: null, created_at: "2026-09-01T00:00:00Z", stats: { projects: 0, conversations: 0, attachments: 0, attachment_bytes: 0 } });
  await page.route(`**/api/admin/access/users/${otherUserId}`, (route) => route.fulfill({ json: reader() }));
  await page.route("**/api/admin/access/users/page?*", (route) => route.fulfill({ json: { items: [
    { id: userId, email: "admin@example.test", display_name: "Administrator", role: "ADMIN", status: "ACTIVE", created_at: "2026-08-01T00:00:00Z", stats: { projects: 0, conversations: 0, attachments: 0, attachment_bytes: 0 } },
    reader(),
  ], total: 2, limit: 20, offset: 0 } }));
  await page.route("**/api/admin/access/invitations/page?*", (route) => route.fulfill({ json: { items: [], total: 0, limit: 20, offset: 0 } }));
  await page.route("**/api/admin/access/invitations", async (route) => {
    if (route.request().method() === "POST") {
      invitationHours = Number((route.request().postDataJSON() as { expires_in_hours: number }).expires_in_hours);
      await route.fulfill({ status: 201, json: { id: "invite-1", token: "secret-token", invite_url: "https://example.test/register?invitation=secret-token", expires_at: "2026-09-08T00:00:00Z" } });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/admin/access/registration", async (route) => {
    registrationMode = (route.request().postDataJSON() as { mode: string }).mode;
    expect(route.request().postDataJSON()).toEqual({ mode: "OPEN", base_revision: policy.revision });
    policy.registration_mode = registrationMode;
    await route.fulfill({ json: policy });
  });
  await page.route("**/api/admin/access/users/*/status", async (route) => {
    userStatus = (route.request().postDataJSON() as { status: string }).status;
    await route.fulfill({ json: { id: otherUserId, status: userStatus, user: reader() } });
  });

  await page.goto("/");
  await openSettings(page);
  await expect(page.getByRole("button", { name: /Data archive|\u6570\u636e\u5f52\u6863/ })).toBeVisible();
  await page.getByRole("button", { name: /Users & access|\u7528\u6237\u4e0e\u8bbf\u95ee/ }).click();
  await expect(page.getByRole("button", { name: /^(Users|用户)$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("reader@example.test")).toBeVisible();
  await page.getByRole("button", { name: /^(View account|查看账户): Reader$/ }).click();
  await page.getByRole("button", { name: /^(Disable account|禁用账户)$/ }).click();
  await expect.poll(() => userStatus).toBe("DISABLED");
  await expect(page.getByRole("button", { name: /^(Enable account|启用账户)$/ })).toBeVisible();

  await page.getByRole("button", { name: /Registration & invitations|注册与邀请/ }).click();
  await page.getByRole("button", { name: /^(Open|开放)$/ }).click();
  await page.getByRole("button", { name: /Save registration policy|保存注册策略/ }).click();
  await expect.poll(() => registrationMode).toBe("OPEN");
  await expect(page.getByRole("status").filter({ hasText: /Registration policy saved|注册策略已保存/ })).toBeVisible();

  await page.getByRole("button", { name: /Create invitation|\u521b\u5efa\u9080\u8bf7/ }).click();
  await page.getByLabel(/Valid for|有效期/).fill("72");
  await page.getByRole("button", { name: /Generate invite link|生成邀请链接/ }).click();
  await expect.poll(() => invitationHours).toBe(72);
  await expect(page.getByRole("textbox", { name: /New invitation link|新邀请链接/ })).toHaveValue(/secret-token/);
});

async function openSettings(page: Page) {
  await page.getByRole("button", { name: /Settings|\u8bbe\u7f6e/ }).click();
  await expect(page.locator('[role="region"][aria-label="Settings"], [role="region"][aria-label="\u8bbe\u7f6e"]').first()).toBeVisible();
}

async function mockSession(page: Page, role: "ADMIN" | "USER") {
  await page.route("**/api/auth/capabilities", (route) => route.fulfill({ json: {
    role, allow_share_links: true, allow_public_share: true, allow_share_password: true,
    allow_user_skills: true, allow_skill_import: true, allow_user_import: true,
    maximum_import_size_mb: 500, maximum_merge_message_count: 1000, email_delivery_available: false,
  } }));
  await page.route("**/api/auth/session*", (route) => route.fulfill({ json: session(role, role === "ADMIN" ? "Administrator" : "Reader") }));
}

function session(role: "ADMIN" | "USER", displayName: string) {
  return {
    authenticated: true,
    principal_id: "principal-fixture",
    user_id: role === "ADMIN" ? userId : otherUserId,
    inactivity_expires_at: "2099-09-01T00:00:00Z",
    auth_mode: "multi_account",
    email: role === "ADMIN" ? "admin@example.test" : "reader@example.test",
    display_name: displayName,
    role,
    registration_mode: "CLOSED",
    password_reset_available: false,
  };
}
