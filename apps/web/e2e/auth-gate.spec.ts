import { expect, test } from "@playwright/test";

const password = process.env.E2E_AUTH_PASSWORD;

test.describe("single-owner authentication boundary", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!password, "Authentication E2E requires an isolated auth-enabled API and E2E_AUTH_PASSWORD.");

  test("new device, protected routes, logout and PWA cache boundary", async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseURL}/library`);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    expect(await page.locator("#owner-password").count()).toBe(1);

    await page.locator("#owner-password").fill("wrong password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("p[role='alert']")).toHaveText("Incorrect password.");

    await page.locator("#owner-password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect.poll(async () => (await page.evaluate(() => fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()))).authenticated).toBe(true);

    const cookie = (await context.cookies()).find((item) => item.name === "chat_reader_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");

    const protectedApi = await context.request.get(`${baseURL}/api/preferences`);
    expect(protectedApi.status()).toBe(200);

    await page.evaluate(async () => {
      const cache = await caches.open("chat-reader-offline-assets-v1");
      await cache.put("/protected-fixture", new Response("business content"));
    });
    await page.goto(`${baseURL}/`);
    await page.getByRole("button", { name: /Appearance|外观/ }).click();
    await page.getByRole("button", { name: /More settings|更多设置/ }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    expect(await page.evaluate(() => caches.has("chat-reader-offline-assets-v1"))).toBe(false);
    expect((await context.cookies()).find((item) => item.name === "chat_reader_session")).toBeUndefined();
    expect((await context.cookies()).find((item) => item.name === "chat_reader_session_present")).toBeUndefined();

    const unauthenticatedApi = await context.request.get(`${baseURL}/api/preferences`);
    expect(unauthenticatedApi.status()).toBe(401);
    await context.close();
  });

  test("share URLs do not become a login-query credential bypass", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/share/qa-token-without-access`);
    await expect(page).toHaveURL(/\/login$/);
    expect(new URL(page.url()).search).toBe("");
  });

  test("password change invalidates every device session", async ({ browser, baseURL }) => {
    const deviceA = await browser.newContext();
    const deviceB = await browser.newContext();
    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();
    const newPassword = `${password!}-rotated`;

    for (const page of [pageA, pageB]) {
      await page.goto(`${baseURL}/login`);
      await page.locator("#owner-password").fill(password!);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(`${baseURL}/`);
    }

    await pageA.getByRole("button", { name: /Appearance|外观/ }).click();
    await pageA.getByRole("button", { name: /More settings|更多设置/ }).click();
    await pageA.getByRole("button", { name: "Change password", exact: true }).click();
    await pageA.getByLabel("Current password").fill(password!);
    await pageA.getByLabel("New password", { exact: true }).fill(newPassword);
    await pageA.getByLabel("Confirm new password").fill(newPassword);
    await pageA.getByRole("button", { name: "Change password and log out all devices" }).click();
    await expect(pageA).toHaveURL(/\/login$/);

    expect((await deviceB.request.get(`${baseURL}/api/preferences`)).status()).toBe(401);
    await pageA.locator("#owner-password").fill(password!);
    await pageA.getByRole("button", { name: "Sign in" }).click();
    await expect(pageA.locator("p[role='alert']")).toHaveText("Incorrect password.");
    await pageA.locator("#owner-password").fill(newPassword);
    await pageA.getByRole("button", { name: "Sign in" }).click();
    await expect(pageA).toHaveURL(`${baseURL}/`);

    await deviceA.close();
    await deviceB.close();
  });
});
