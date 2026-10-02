import { expect, test, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openSettings(page: Page, name: RegExp) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await page.getByRole("button", { name }).click();
  return page.getByRole("dialog").filter({ has: page.getByRole("button", { name: /返回设置|Back to settings/ }) });
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`invitations and audit persist through copy failure, revoke and paging ${width}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, storageState: await admin.storageState(), permissions: ["clipboard-read", "clipboard-write"] });
    const issuedIds: string[] = [];
    try {
      for (let i = 0; i < 21; i++) {
        const result = await admin.post("/api/admin/access/invitations", { data: { expires_in_hours: 24 } });
        expect(result.status()).toBe(201); issuedIds.push((await result.json()).id);
      }
      await settingsAppearance(context.request, base, locale);
      const page = await context.newPage(); await page.goto(base);
      await openSettings(page, /Users & access|用户与访问/);
      await page.getByRole("button", { name: /Registration & invitations|注册与邀请/, exact: true }).click();
      const panel = page.getByRole("region", { name: /Registration & invitations|注册与邀请/, exact: true });
      const invitations = panel.getByRole("region", { name: /^(Invitations|邀请)$/ });
      await invitations.getByLabel(/Invitation status|邀请状态/).selectOption("PENDING");
      const history = invitations.getByRole("list", { name: /Invitation history|邀请记录/ });
      await expect(history.getByRole("listitem")).toHaveCount(20);
      await invitations.getByRole("button", { name: /^(Next|下一页)$/ }).click();
      await expect(history.getByRole("listitem").first()).toBeVisible();
      await invitations.getByRole("button", { name: /^(Previous|上一页)$/ }).click();
      await invitations.getByRole("button", { name: /Create invitation|创建邀请/, exact: true }).click();
      await invitations.getByLabel(/Valid for|有效期/).fill("48");
      const created = page.waitForResponse((response) => response.url().endsWith("/api/admin/access/invitations") && response.request().method() === "POST");
      await invitations.getByRole("button", { name: /Generate invite link|生成邀请链接/ }).click();
      const createdResponse = await created; expect(createdResponse.status()).toBe(201);
      const link = await createdResponse.json(); issuedIds.push(link.id);
      const input = invitations.getByRole("textbox", { name: /^(New invitation link|新邀请链接)$/ });
      await expect(input).toBeFocused();
      // Retain the original clipboard method only in this isolated page memory.
      await page.evaluate(() => {
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        let fail = true;
        Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: (text: string) => {
          if (fail) { fail = false; return Promise.reject(new Error("Synthetic clipboard failure")); }
          return write(text);
        } });
      });
      await invitations.getByRole("button", { name: /Copy link|复制链接/, exact: true }).click();
      await expect(invitations.getByRole("alert")).toContainText(/Copy failed|复制失败/);
      expect(await input.inputValue() === link.invite_url).toBe(true);
      await invitations.getByRole("button", { name: /Copy link|复制链接/, exact: true }).click();
      await expect(invitations.getByRole("status")).toHaveText(/Invitation link copied|已复制邀请链接/);
      expect(await page.evaluate(async (expected) => await navigator.clipboard.readText() === expected, link.invite_url)).toBe(true);
      await invitations.getByRole("button", { name: /Revoke this invitation|撤销此邀请/ }).click();
      await page.getByRole("dialog", { name: /Revoke invitation\?|撤销邀请？/ }).getByRole("button", { name: /Revoke invitation|撤销邀请/, exact: true }).click();
      await expect(input).toHaveCount(0);
      const state = await (await admin.get("/api/admin/access/invitations/page?state=REVOKED&limit=100")).json();
      expect(state.items.some((item: { id: string }) => item.id === link.id)).toBe(true);
      await invitations.getByLabel(/Invitation status|邀请状态/).selectOption("REVOKED");
      await expect(history.getByRole("button", { name: /^(Revoke|撤销)$/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/admin-invitations-${width}.png` });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Security & audit|安全与审计/, exact: true }).click();
      const audit = page.getByRole("region", { name: /Security & audit|安全与审计/, exact: true });
      await audit.getByLabel(/^(Action|操作)$/).fill("INVITATION_CREATED");
      await audit.getByLabel(/^(Result|结果)$/).selectOption("SUCCESS");
      await audit.getByRole("button", { name: /Find events|查询记录/ }).click();
      const events = audit.getByRole("list", { name: /Audit events|审计记录/ });
      await expect(events.getByRole("listitem")).toHaveCount(20);
      await expect(events.getByRole("listitem").first()).toContainText(/Invitation created|创建邀请/);
      await audit.getByRole("button", { name: /^(Next|下一页)$/ }).click();
      await expect(events.getByRole("listitem").first()).toBeVisible();
      await audit.getByText(/Accounts & time range|账户与时间范围/, { exact: true }).click();
      await audit.getByLabel(/^(Actor|操作人)$/).fill("no-matching-account@example.test");
      await audit.getByRole("button", { name: /Find events|查询记录/ }).click();
      await expect(audit.getByText(/No events match|没有符合筛选条件的记录/)).toBeVisible();
      await audit.getByRole("button", { name: /Clear filters|清除筛选/ }).click();
      await expect(events.getByRole("listitem").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/admin-audit-${width}.png` });
      await page.reload();
      await openSettings(page, /Users & access|用户与访问/);
      await page.getByRole("button", { name: /Registration & invitations|注册与邀请/, exact: true }).click();
      await expect(page.getByRole("textbox", { name: /^(New invitation link|新邀请链接)$/ })).toHaveCount(0);
    } finally {
      for (const id of issuedIds) await admin.delete(`/api/admin/access/invitations/${id}`);
      await context.close(); await admin.dispose();
    }
  });
}

test("cross-user search opens the actual audited read-only Reader", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const guest = await browser.newContext({ baseURL: base, locale: "en-US", extraHTTPHeaders: { Origin: base } });
  const owner = guest.request;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await admin.storageState() });
  let uid: string | undefined;
  try {
    const email = `audited-search-${Date.now()}@example.test`;
    const invite = await admin.post("/api/admin/access/invitations", { data: { expires_in_hours: 1 } });
    expect(invite.status()).toBe(201); const invitation = await invite.json();
    const registerPage = await guest.newPage(); await registerPage.goto(invitation.invite_url);
    await registerPage.locator("#register-email").fill(email);
    await registerPage.locator("#register-password").fill("synthetic search passphrase");
    await registerPage.locator("#register-confirm-password").fill("synthetic search passphrase");
    const registered = registerPage.waitForResponse((response) => response.url().endsWith("/api/auth/register") && response.request().method() === "POST");
    await registerPage.getByRole("button", { name: /Create account|创建账户/, exact: true }).click();
    const registration = await registered; expect(registration.status()).toBe(201);
    await expect(registerPage).toHaveURL(`${base}/`);
    const identity = await owner.get("/api/auth/me"); expect(identity.status()).toBe(200); uid = (await identity.json()).user_id;
    const used = await (await admin.get("/api/admin/access/invitations/page?state=USED&limit=100")).json();
    expect(used.items.some((item: { id: string }) => item.id === invitation.id)).toBe(true);
    const needle = `synthetic-search-${Date.now()}`;
    const create = await owner.post("/api/conversations", { data: { title: "Synthetic cross-account search", messages: [
      { role: "user", content_markdown: needle }, { role: "assistant", content_markdown: "Synthetic search answer" },
    ] } });
    expect(create.status()).toBe(201); const cid = (await create.json()).conversation.id;
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base);
    await openSettings(page, /Users & access|用户与访问/);
    await page.getByRole("button", { name: "Search across user content", exact: true }).click();
    await page.getByRole("textbox", { name: "Search all user conversations" }).fill(needle);
    await page.getByRole("button", { name: "Search content", exact: true }).click();
    const link = page.getByRole("link", { name: /Synthetic cross-account search/ });
    await expect(link).toHaveCount(1);
    const popupPromise = page.waitForEvent("popup"); await link.click(); const reader = await popupPromise;
    await expect(reader.locator("article[data-message-id]")).toHaveCount(2);
    await expect(reader.getByText(needle, { exact: true })).toBeVisible();
    await expect(reader.getByRole("button", { name: /Edit message|编辑消息/ })).toHaveCount(0);
    const audit = await (await admin.get(`/api/admin/audit/page?target_user_id=${uid}&action=VIEW_USER_CONVERSATION`)).json();
    expect(audit.items.some((row: { resource_id: string }) => row.resource_id === cid)).toBe(true);
    await reader.close();
  } finally {
    if (uid) {
      const queued = await admin.post(`/api/admin/access/users/${uid}/delete`, { data: { confirm_user_id: uid } });
      if (queued.status() === 202) {
        const jobId = (await queued.json()).job_id;
        await expect.poll(async () => (await (await admin.get(`/api/tasks/${jobId}`)).json()).status).toBe("committed");
      }
    }
    await context.close(); await guest.close(); await admin.dispose();
  }
});
