import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

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
  expect(source).toContain("AUTH_UNAUTHORIZED_EVENT");
});

test("regular users see their account and devices but not instance maintenance", async ({ page }) => {
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
  await expect.poll(async () => page.getByRole("button", { name: /Data archive|\u6570\u636e\u5f52\u6863/ }).evaluateAll((elements) => elements.filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().height > 0;
  }).length)).toBe(0);
  await page.getByRole("button", { name: /Account & security|\u8d26\u6237\u4e0e\u5b89\u5168/ }).click();
  await expect(page.getByLabel(/Email|\u90ae\u7bb1/)).toHaveValue("reader@example.test");
  await expect(page.getByText("Chrome on Windows")).toBeVisible();
  await page.getByLabel(/Display name|\u663e\u793a\u540d\u79f0/).fill("Archive reader");
  await page.getByRole("button", { name: /Save account details|\u4fdd\u5b58\u8d26\u6237\u4fe1\u606f/ }).click();
  expect(profileUpdate).toEqual({ display_name: "Archive reader" });
  await page.getByRole("button", { name: /Log out other devices|\u9000\u51fa\u5176\u4ed6\u8bbe\u5907/ }).click();
  await page.getByRole("dialog", { name: /Log out other devices\?|\u9000\u51fa\u5176\u4ed6\u8bbe\u5907\uff1f/ }).getByRole("button", { name: /Log out other devices|\u9000\u51fa\u5176\u4ed6\u8bbe\u5907/ }).click();
  expect(loggedOutOthers).toBe(true);
});

test("administrators manage users, registration and invitations in one focused surface", async ({ page }) => {
  await mockSession(page, "ADMIN");
  let registrationMode = "";
  let userStatus = "";
  let invitationHours = 0;
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: session("ADMIN", "Administrator") }));
  await page.route("**/api/admin/access", (route) => route.fulfill({ json: { registration_mode: "CLOSED", smtp_configured: false } }));
  await page.route("**/api/admin/access/users", (route) => route.fulfill({ json: [
    { id: userId, email: "admin@example.test", display_name: "Administrator", role: "ADMIN", status: "ACTIVE", created_at: "2026-08-01T00:00:00Z" },
    { id: otherUserId, email: "reader@example.test", display_name: "Reader", role: "USER", status: "ACTIVE", created_at: "2026-09-01T00:00:00Z" },
  ] }));
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
    await route.fulfill({ json: { registration_mode: registrationMode, updated_at: "2026-09-01T00:00:00Z" } });
  });
  await page.route("**/api/admin/access/users/*/status", async (route) => {
    userStatus = (route.request().postDataJSON() as { status: string }).status;
    await route.fulfill({ json: { id: otherUserId, status: userStatus } });
  });

  await page.goto("/");
  await openSettings(page);
  await expect(page.getByRole("button", { name: /Data archive|\u6570\u636e\u5f52\u6863/ })).toBeVisible();
  await page.getByRole("button", { name: /Users & access|\u7528\u6237\u4e0e\u8bbf\u95ee/ }).click();
  await expect(page.getByRole("tab", { name: /Users|\u7528\u6237/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("reader@example.test")).toBeVisible();

  await page.getByRole("button", { name: /Disable account|\u7981\u7528\u8d26\u6237/ }).click();
  await page.getByRole("button", { name: /Disable account|\u7981\u7528\u8d26\u6237/ }).last().click();
  expect(userStatus).toBe("DISABLED");

  await page.getByRole("tab", { name: /Registration|\u6ce8\u518c/ }).click();
  await page.getByRole("button", { name: /Open|\u5f00\u653e/, exact: true }).click();
  await page.getByRole("button", { name: /Save registration mode|\u4fdd\u5b58\u6ce8\u518c\u6a21\u5f0f/ }).click();
  expect(registrationMode).toBe("OPEN");

  await page.getByRole("tab", { name: /Invitations|\u9080\u8bf7/ }).click();
  await page.getByLabel(/Valid for|\u6709\u6548\u5c0f\u65f6\u6570/).fill("72");
  await page.getByRole("button", { name: /Create invitation|\u521b\u5efa\u9080\u8bf7/ }).click();
  expect(invitationHours).toBe(72);
  await expect(page.getByLabel(/One-time invitation link|\u4e00\u6b21\u6027\u9080\u8bf7\u94fe\u63a5/)).toHaveValue(/secret-token/);
});

async function openSettings(page: Page) {
  await page.getByRole("button", { name: /Settings|\u8bbe\u7f6e/ }).click();
  await expect(page.locator('[role="region"][aria-label="Settings"], [role="region"][aria-label="\u8bbe\u7f6e"]').first()).toBeVisible();
}

async function mockSession(page: Page, role: "ADMIN" | "USER") {
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
