import { expect, test } from "@playwright/test";
import { readLocal } from "./settings-offline-helper";
import { settingsAdmin } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, auth and worker fixture");


test("expired library retains local edits, blocks another account, and restores only after same-account verification", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(150_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const password = "synthetic offline account passphrase", suffix = Date.now();
  const emailA = `offline-a-${suffix}@example.test`, emailB = `offline-b-${suffix}@example.test`;
  const headers = { Origin: baseURL! };
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("chat-reader:user-preferences", JSON.stringify({ locale_mode: "en-US", theme_mode: "light" })));
  try {
    const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: emailA, password, confirm_password: password } });
    expect(registered.status()).toBe(201);
    const userId = (await registered.json()).user_id;
    const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic retained offline library", messages: [
      { role: "user", content_markdown: "Synthetic offline question" }, { role: "assistant", content_markdown: "Synthetic offline answer" },
    ] } });
    expect(created.status()).toBe(201);
    const conversationId = (await created.json()).conversation.id;
    await page.clock.install();
    await page.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
    await page.getByRole("button", { name: /Download offline copy|下载离线副本/, exact: true }).click();
    await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(1);
    await expect(page.getByText("Synthetic offline answer", { exact: true }).first()).toBeVisible();
    await expect(page.locator("p:visible, span:visible").filter({ hasText: /^Offline ready|^Existing offline version is available|^可离线启动|^现有离线版本可用/ }).first()).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("button", { name: /Notes|精选笔记/, exact: true }).click();
    await page.getByRole("textbox", { name: "Notebook title", exact: true }).fill("Synthetic unsynced note");
    await page.getByRole("button", { name: /插入说明|Add text block/, exact: true }).click();
    await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBeGreaterThan(0);
    const before = await readLocal(page, userId);
    await page.clock.fastForward(49 * 60 * 60 * 1000);
    await expect(page.getByRole("heading", { name: /Sign in required|需要重新登录/ })).toBeVisible();
    await expect(page.getByText("Synthetic offline answer", { exact: true })).toHaveCount(0);
    expect(await readLocal(page, userId)).toEqual(before);
    await page.reload();
    await expect(page.getByRole("heading", { name: /Sign in required|需要重新登录/ })).toBeVisible();
    expect(await readLocal(page, userId)).toEqual(before);
    await context.clearCookies(); // The real session would also have expired after the simulated 49 hours.
    await context.setOffline(false);
    await page.clock.setFixedTime(new Date());
    const signIn = async (email: string, destination: string) => {
      await page.goto(`${baseURL}/login?reauth=1&return_to=${encodeURIComponent(destination)}`);
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill(password);
      await page.getByRole("button", { name: /^(Sign in|登录)$/ }).click();
      await expect(page).toHaveURL(`${baseURL}${destination}`);
    };
    // A different real account must neither claim nor sync A's pending edits.
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: emailB, password, confirm_password: password } })).status()).toBe(201);
    await signIn(emailB, "/library");
    await expect(page.getByText("Synthetic offline answer", { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("chat-reader:offline-active-user-v1")).catch(() => userId)).not.toBe(userId);
    expect(await readLocal(page, userId)).toEqual(before);
    expect((await context.request.get(`${baseURL}/api/conversations/${conversationId}`)).status()).toBe(404);
    await page.clock.setFixedTime(new Date());
    // Unlocking a retained local lock requires the actual password form, not a
    // background valid-cookie response or an out-of-band APIRequestContext.
    await signIn(emailA, `/library?conversationId=${conversationId}&annotations=open`);
    await expect(page.getByText("Synthetic offline answer", { exact: true }).first()).toBeVisible();
    await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(0);
    const serverNote = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
    expect(serverNote.title).toBe("Synthetic unsynced note");
    expect((await readLocal(page, userId)).conversations).toHaveLength(1);
  } finally { await context.close(); await admin.dispose(); }
});
