import { expect, test, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";
import { readLocal } from "./settings-offline-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL and SMTP fixture");

async function openSecurity(page: Page) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await page.getByRole("button", { name: /Account & security|账户与安全/ }).click();
  return page.getByRole("dialog", { name: /Account & security|账户与安全/ });
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`email change through real SMTP preserves identity and revokes other devices ${width}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(150_000);
    const base = baseURL!, headers = { Origin: base };
    const admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, colorScheme: locale === "zh-CN" ? "light" : "dark" });
    const otherDevice = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: headers });
    const email = `email-${width}-${Date.now()}@example.test`, newEmail = `new-${email}`, password = "synthetic email browser passphrase";
    try {
      const registered = await context.request.post(`${base}/api/auth/register`, { headers, data: { email, password, confirm_password: password } });
      expect(registered.status()).toBe(201);
      const uid = (await registered.json()).user_id;
      await settingsAppearance(context.request, base, locale);
      expect((await otherDevice.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
      const created = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic retained email content", messages: [{ role: "user", content_markdown: "Synthetic email question" }, { role: "assistant", content_markdown: "Synthetic retained email answer" }] } });
      expect(created.status()).toBe(201);
      const source = (await created.json()).conversation.id;
      const page = await context.newPage();
      if (width === 1440) {
        await page.goto(`${base}/library?conversationId=${source}`);
        await page.getByRole("button", { name: /Download offline copy|下载离线副本/, exact: true }).click();
        await expect.poll(async () => (await readLocal(page, uid)).conversations.length).toBe(1);
      }
      await page.goto(base);
      let dialog = await openSecurity(page);
      let panel = dialog.getByRole("region", { name: /^(Change email|修改邮箱)$/ });
      await panel.getByRole("button", { name: /Set a new email|设置新邮箱/ }).click();
      await panel.getByLabel(/^(New email|新邮箱)$/).fill(newEmail);
      await panel.getByLabel(/Verify current password|验证当前密码/).fill("wrong password");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: /Discard unsaved changes|放弃未保存的更改/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await panel.getByRole("button", { name: /Verify & send email|验证并发送邮件/ }).click();
      await expect(panel.getByRole("alert")).toContainText(/current password is incorrect|当前密码不正确/);
      expect((await (await context.request.get(`${base}/api/auth/me`)).json()).email).toBe(email);
      await panel.getByLabel(/Verify current password|验证当前密码/).fill(password);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/email-change-form-${width}.png` });
      await panel.getByRole("button", { name: /Verify & send email|验证并发送邮件/ }).click();
      await expect(panel.getByText(/Awaiting email confirmation|等待新邮箱确认/)).toBeVisible();
      const mailbox = await (await admin.get("/api/settings-test/mail")).json() as { to: string; text: string }[];
      const link = mailbox.findLast((item) => item.to === newEmail)?.text.match(/http[^\s]+\/verify-email#purpose=email-change&token=[\w-]+/)?.[0];
      expect(link).toBeTruthy();
      await page.reload();
      dialog = await openSecurity(page); panel = dialog.getByRole("region", { name: /^(Change email|修改邮箱)$/ });
      await expect(panel.getByText(newEmail, { exact: true })).toBeVisible();
      expect((await (await otherDevice.get("/api/auth/me")).json()).email).toBe(email);
      const confirmation = await context.newPage();
      await confirmation.goto(link!);
      await expect(confirmation.getByRole("button", { name: /Confirm new email|确认使用新邮箱/, exact: true })).toBeVisible();
      await confirmation.reload();
      expect((await (await context.request.get(`${base}/api/auth/me`)).json()).email).toBe(email);
      await confirmation.getByRole("button", { name: /Confirm new email|确认使用新邮箱/, exact: true }).focus();
      if (process.env.SETTINGS_SCREENSHOT_DIR) await confirmation.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/email-change-confirm-${width}.png` });
      await confirmation.keyboard.press("Enter");
      await expect(confirmation.getByRole("status")).toContainText(/Email changed|邮箱已更换/);
      expect(confirmation.url()).not.toContain("token=");
      const profile = await (await context.request.get(`${base}/api/auth/me`)).json();
      expect(profile).toMatchObject({ user_id: uid, email: newEmail });
      expect((await context.request.get(`${base}/api/conversations/${source}`)).status()).toBe(200);
      expect((await otherDevice.get("/api/auth/me")).status()).toBe(401);
      expect((await otherDevice.post("/api/auth/login", { data: { email, password } })).status()).toBe(401);
      expect((await otherDevice.post("/api/auth/login", { data: { email: newEmail, password } })).status()).toBe(200);
      if (width === 1440) {
        expect((await readLocal(confirmation, uid)).conversations).toHaveLength(1);
        await confirmation.goto(`${base}/library?conversationId=${source}`);
        await expect(confirmation.getByText("Synthetic retained email answer", { exact: true }).first()).toBeVisible();
        await expect(confirmation.locator("p:visible, span:visible").filter({ hasText: /^Offline ready|^Existing offline version is available|^可离线启动|^现有离线版本可用/ }).first()).toBeVisible();
        const network = await context.newCDPSession(confirmation);
        await network.send("Network.enable");
        await context.setOffline(true);
        await expect.poll(() => confirmation.evaluate(() => navigator.onLine)).toBe(false);
        await confirmation.reload({ waitUntil: "domcontentloaded" });
        // Bundled Chromium resets the new renderer's reported network state
        // on this service-worker navigation. Reapply actual network emulation;
        // do not fake navigator.onLine or bypass the account lease check.
        await network.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await network.send("Network.overrideNetworkState", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await expect.poll(() => confirmation.evaluate(() => navigator.onLine)).toBe(false);
        await expect(confirmation.getByText("Synthetic retained email answer", { exact: true }).first()).toBeVisible();
        await context.setOffline(false);
        await network.detach();
      }
      expect(await confirmation.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally { await context.close(); await otherDevice.dispose(); await admin.dispose(); }
  });
}

test("email change recovers request failure, cancellation and a lost committed response", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(150_000);
  const base = baseURL!, headers = { Origin: base };
  const admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 375, height: 900 }, locale: "en-US" });
  const mailContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const email = `email-recovery-${Date.now()}@example.test`, newEmail = `new-${email}`, password = "synthetic recovery email passphrase";
  try {
    const registration = await context.request.post(`${base}/api/auth/register`, { headers, data: { email, password, confirm_password: password } });
    expect(registration.status()).toBe(201);
    const uid = (await registration.json()).user_id;
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base);
    const panel = (await openSecurity(page)).getByRole("region", { name: "Change email", exact: true });
    await panel.getByRole("button", { name: "Set a new email" }).click();
    await panel.getByLabel("New email", { exact: true }).fill(newEmail);
    await panel.getByLabel("Verify current password").fill(password);
    let fail = true;
    await page.route("**/api/auth/email-change/request", async (route) => { if (fail) { fail = false; await route.abort(); } else await route.continue(); });
    await panel.getByRole("button", { name: "Verify & send email" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("New email", { exact: true })).toHaveValue(newEmail);
    await expect(panel.getByLabel("Verify current password")).toHaveValue(password);
    expect((await (await context.request.get(`${base}/api/auth/email-change`)).json()).pending).toBeNull();
    await panel.getByRole("button", { name: "Verify & send email" }).click();
    await expect(panel.getByText("Awaiting email confirmation")).toBeVisible();
    await panel.getByRole("button", { name: "Cancel request", exact: true }).click();
    await page.getByRole("dialog", { name: "Cancel this email change?" }).getByRole("button", { name: "Cancel request", exact: true }).click();
    await expect(panel.getByText("Awaiting email confirmation")).toHaveCount(0);
    expect((await (await context.request.get(`${base}/api/auth/email-change`)).json()).pending).toBeNull();
    await panel.getByRole("button", { name: "Set a new email" }).click();
    await panel.getByLabel("New email", { exact: true }).fill(newEmail);
    await panel.getByLabel("Verify current password").fill(password);
    await panel.getByRole("button", { name: "Verify & send email" }).click();
    await expect(panel.getByText("Awaiting email confirmation")).toBeVisible();
    const messages = await (await admin.get("/api/settings-test/mail")).json() as { to: string; text: string }[];
    const link = messages.findLast((item) => item.to === newEmail)?.text.match(/http[^\s]+\/verify-email#purpose=email-change&token=[\w-]+/)?.[0];
    expect(link).toBeTruthy();
    expect((await mailContext.request.post(`${base}/api/auth/register`, { headers, data: { email: `other-${email}`, password, confirm_password: password } })).status()).toBe(201);
    const confirmation = await mailContext.newPage(); await confirmation.goto(link!);
    await expect(confirmation.getByRole("alert").filter({ hasText: "belongs to another account" })).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Confirm new email", exact: true })).toHaveCount(0);
    await mailContext.clearCookies(); await confirmation.reload();
    await expect(confirmation.getByText(/Sign in to the original account in a new tab/)).toBeVisible();
    const popupReady = confirmation.waitForEvent("popup");
    await confirmation.getByRole("link", { name: "Sign in to original account (new tab)" }).click();
    const popup = await popupReady;
    await popup.locator("#login-email").fill(email);
    await popup.locator("#login-password").fill(password);
    await popup.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(popup).toHaveURL(base + "/");
    await confirmation.getByRole("button", { name: "Check again", exact: true }).click();
    await expect(confirmation.getByRole("button", { name: "Confirm new email", exact: true })).toBeVisible();
    let confirmed = 0;
    await confirmation.route("**/api/auth/email-change/confirm", async (route) => {
      const result = await route.fetch(); expect(result.status()).toBe(200); confirmed++;
      // Lose only the response after a real commit. Recovery must verify the
      // same UUID and target email, without consuming the grant a second time.
      await route.abort();
    });
    await confirmation.getByRole("button", { name: "Confirm new email", exact: true }).click();
    await expect(confirmation.getByRole("status")).toContainText("Email changed");
    expect(confirmed).toBe(1);
    expect(await (await mailContext.request.get(`${base}/api/auth/me`)).json()).toMatchObject({ user_id: uid, email: newEmail });
    expect((await context.request.get(`${base}/api/auth/me`)).status()).toBe(401);
  } finally { await context.close(); await mailContext.close(); await admin.dispose(); }
});
