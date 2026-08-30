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
    await page.getByRole("button", { name: /Settings|设置|Appearance|外观/ }).click();
    await page.getByRole("button", { name: /Account & security|账户与安全/ }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    expect(await page.evaluate(() => caches.has("chat-reader-offline-assets-v1"))).toBe(false);
    expect((await context.cookies()).find((item) => item.name === "chat_reader_session")).toBeUndefined();
    expect((await context.cookies()).find((item) => item.name === "chat_reader_session_present")).toBeUndefined();

    const unauthenticatedApi = await context.request.get(`${baseURL}/api/preferences`);
    expect(unauthenticatedApi.status()).toBe(401);
    await context.close();
  });

  test("public share URLs stay outside the owner login boundary without leaking into login state", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/share/qa-token-without-access`);
    await expect(page).toHaveURL(/\/share\/qa-token-without-access$/);
    await expect(page.getByText(/Share unavailable|分享不可用/)).toBeVisible();
    expect((await page.context().cookies()).find((item) => item.name === "chat_reader_session")).toBeUndefined();
  });

  test("public and independently protected Shares keep their capability boundaries", async ({ browser, page, baseURL }) => {
    await page.goto(`${baseURL}/login`);
    await page.locator("#owner-password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${baseURL}/`);

    const mutationHeaders = { Origin: baseURL! };
    const conversationResponse = await page.request.post("/api/conversations", {
      headers: mutationHeaders,
      data: {
        title: "Public Share QA fixture",
        messages: [
          { role: "user", content_markdown: "Share QA question" },
          { role: "assistant", content_markdown: "Share QA answer" },
        ],
      },
    });
    expect(conversationResponse.status()).toBe(201);
    const conversation = await conversationResponse.json() as { conversation: { id: string } };
    const publicResponse = await page.request.post(`/api/conversations/${conversation.conversation.id}/shares`, { headers: mutationHeaders, data: {} });
    expect(publicResponse.ok()).toBe(true);
    const publicShare = await publicResponse.json() as { id: string; token: string };

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`${baseURL}/share/${publicShare.token}`);
    await expect(guestPage).toHaveURL(new RegExp(`/share/${publicShare.token}$`));
    await expect(guestPage.getByRole("heading", { name: "Public Share QA fixture" })).toBeVisible();
    expect((await guest.cookies()).find((item) => item.name === "chat_reader_session")).toBeUndefined();

    const sharePassword = "independent-share-qa";
    const protectedResponse = await page.request.post(`/api/conversations/${conversation.conversation.id}/shares`, {
      headers: mutationHeaders,
      data: { share_password: sharePassword },
    });
    expect(protectedResponse.ok()).toBe(true);
    const protectedShare = await protectedResponse.json() as { id: string; token: string };
    const protectedPage = await guest.newPage();
    await protectedPage.goto(`${baseURL}/share/${protectedShare.token}`);
    await expect(protectedPage.getByRole("heading", { name: "This share is password protected" })).toBeVisible();
    await protectedPage.locator("#share-password").fill(password!);
    await protectedPage.getByRole("button", { name: "View shared content" }).click();
    await expect(protectedPage.getByText("Incorrect share password.")).toBeVisible();
    await protectedPage.locator("#share-password").fill(sharePassword);
    await protectedPage.getByRole("button", { name: "View shared content" }).click();
    await expect(protectedPage.getByRole("heading", { name: "Public Share QA fixture" })).toBeVisible();
    await protectedPage.goto(`${baseURL}/library`);
    await expect(protectedPage).toHaveURL(/\/login(?:\?|$)/);

    await page.request.post(`/api/shares/${publicShare.id}/revoke`, { headers: mutationHeaders });
    await page.request.post(`/api/shares/${protectedShare.id}/revoke`, { headers: mutationHeaders });
    await page.request.delete(`/api/conversations/${conversation.conversation.id}`, { headers: mutationHeaders });
    await guest.close();
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

    await pageA.getByRole("button", { name: /Settings|设置|Appearance|外观/ }).click();
    await pageA.getByRole("button", { name: /Account & security|账户与安全/ }).click();
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
