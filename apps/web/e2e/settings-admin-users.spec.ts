import { expect, test, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openUsers(page: Page) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  const entry = page.getByRole("button", { name: /Users & access|用户与访问/ });
  if (!await entry.isVisible()) {
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    if (!await entry.isVisible()) await settings.click();
  }
  await entry.click();
  return page.getByRole("dialog", { name: /Users & access|用户与访问/ });
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`admin account inspection, real search and confirmed deletion ${width}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, headers = { Origin: base }, admin = await settingsAdmin(playwright.request, base);
    const owner = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: headers });
    const email = `admin-inspection-${width}-${Date.now()}@example.test`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, storageState: await admin.storageState() });
    try {
      const registration = await owner.post("/api/auth/register", { data: { email, display_name: "Synthetic inspection account", password: "synthetic inspection passphrase", confirm_password: "synthetic inspection passphrase" } });
      expect(registration.status()).toBe(201);
      const uid = (await registration.json()).user_id;
      const created = await owner.post("/api/conversations", { data: { title: "Synthetic complete-turn inspection", messages: [
        { role: "user", content_markdown: "Synthetic first question" }, { role: "assistant", content_markdown: "# Synthetic first answer\n\n- [ ] Synthetic read-only task" },
      ] } });
      expect(created.status()).toBe(201);
      const source = await created.json(), cid = source.conversation.id;
      const inserted = await owner.post(`/api/conversations/${cid}/messages/insert`, { data: { anchor_message_id: source.messages[1].id, position: "after", mode: "pair", messages: [
        { role: "user", content_markdown: "Synthetic unique needle question" }, { role: "assistant", content_markdown: "Synthetic second answer" },
      ] } });
      expect(inserted.status()).toBe(201);
      const target = (await inserted.json()).messages[0].id;
      for (let i = 0; i < 20; i++) expect((await owner.post("/api/conversations", { data: { title: `Synthetic list item ${i + 1}`, messages: [
        { role: "user", content_markdown: "Synthetic pagination question" }, { role: "assistant", content_markdown: "Synthetic pagination answer" },
      ] } })).status()).toBe(201);
      const upload = await owner.post(`/api/conversations/${cid}/attachment-upload-sessions`, { data: {} });
      expect(upload.status()).toBe(201);
      const file = await owner.post(`/api/attachment-upload-sessions/${(await upload.json()).id}/items`, { multipart: { file: { name: "synthetic-admin-file.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic administrator attachment content") } } });
      expect(file.status()).toBe(201);
      expect((await owner.post(`/api/conversations/${cid}/attachments`, { data: { upload_item_ids: [(await file.json()).id] } })).status()).toBe(201);
      expect((await owner.get("/api/admin/access/users/page")).status()).toBe(404);
      expect((await admin.get(`/api/conversations/${cid}`)).status()).toBe(404);
      await settingsAppearance(context.request, base, locale);
      const page = await context.newPage(); await page.goto(base);
      let panel = await openUsers(page);
      await panel.getByLabel(/Email or name|邮箱或名称/).fill(email);
      await panel.getByRole("button", { name: /Search users|搜索用户/ }).click();
      const detail = panel.getByRole("button", { name: /View account: Synthetic inspection account|查看账户: Synthetic inspection account/ });
      await expect(detail).toHaveCount(1);
      await detail.focus(); await page.keyboard.press("Enter");
      await expect(panel.getByRole("heading", { name: "Synthetic inspection account" })).toBeFocused();
      await panel.getByRole("button", { name: /Back to users|返回用户列表/ }).click();
      await expect(panel.getByLabel(/Email or name|邮箱或名称/)).toHaveValue(email);
      await expect(detail).toBeFocused();
      await detail.click();
      await panel.getByRole("button", { name: /Inspect content|查看资料/, exact: true }).click();
      const contentLinks = panel.locator('a[href^="/admin/users/"]');
      await expect(contentLinks).toHaveCount(20);
      const firstPage = await contentLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      await panel.getByRole("button", { name: /^(Next|下一页)$/ }).click();
      await expect(contentLinks).toHaveCount(1);
      const secondPage = await contentLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(new Set([...firstPage, ...secondPage]).size).toBe(21);
      await panel.getByLabel(/Search conversation titles|搜索对话标题/).fill("Synthetic complete-turn inspection");
      await panel.getByRole("button", { name: /Search content|搜索资料/ }).click();
      const conversationLink = panel.getByRole("link", { name: /Synthetic complete-turn inspection/ });
      await expect(conversationLink).toBeVisible();
      const popupPromise = page.waitForEvent("popup"); await conversationLink.click(); const reader = await popupPromise;
      await expect(reader.locator("article[data-message-id]")).toHaveCount(2);
      await expect(reader.getByText(/Administrator · Read-only · Audited access|管理员只读查看 · 访问已审计/)).toBeVisible();
      await expect(reader.getByRole("button", { name: /Edit message|编辑消息/ })).toHaveCount(0);
      await reader.getByRole("button", { name: /Next turn|下一轮/ }).click();
      await expect(reader.locator(`article[data-message-id="${target}"]`)).toBeVisible();
      await reader.getByRole("button", { name: /Previous turn|上一轮/ }).click();
      await expect(reader.getByText("Synthetic first question", { exact: true })).toBeVisible();
      await reader.getByRole("button", { name: /Search messages|搜索消息/, exact: true }).click();
      await reader.getByLabel(/Search this conversation|搜索当前对话正文/).fill("unique needle");
      await reader.getByRole("button", { name: /^(Search|搜索)$/ }).click();
      await reader.getByRole("button", { name: /Synthetic unique needle question/ }).click();
      await expect(reader.locator(`article[data-message-id="${target}"]`)).toBeFocused();
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await reader.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/admin-reader-${width}.png` });
      await reader.close();
      await panel.getByRole("button", { name: /^(Attachments|附件)$/ }).click();
      await expect(panel.getByText("synthetic-admin-file.txt")).toBeVisible();
      await panel.getByRole("button", { name: /^(View|查看)$/ }).click();
      await expect(page.getByText("Synthetic administrator attachment content", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      const downloadPromise = page.waitForEvent("download"); await panel.getByRole("link", { name: /^(Download|下载)$/ }).click();
      const download = await downloadPromise; expect(await download.failure()).toBeNull();
      const audit = await (await admin.get(`/api/admin/audit?target_user_id=${uid}`)).json();
      expect(audit.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(["VIEW_USER_CONVERSATION", "SEARCH_USER_CONVERSATION", "LIST_USER_CONVERSATIONS", "VIEW_USER_ATTACHMENT", "DOWNLOAD_USER_ATTACHMENT"]));
      await panel.getByRole("button", { name: /Delete account…|删除账户…/, exact: true }).click();
      await expect(panel.getByRole("heading", { name: /Confirm deletion scope|确认删除范围/ })).toBeFocused();
      expect((await admin.get(`/api/admin/access/users/${uid}`)).status()).toBe(200);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await panel.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/admin-delete-preview-${width}.png` });
      await panel.getByRole("button", { name: /^(Cancel|取消)$/ }).click();
      await page.reload(); panel = await openUsers(page);
      await panel.getByLabel(/Email or name|邮箱或名称/).fill(email);
      await panel.getByRole("button", { name: /Search users|搜索用户/ }).click();
      await panel.getByRole("button", { name: /View account: Synthetic inspection account|查看账户: Synthetic inspection account/ }).click();
      await panel.getByRole("button", { name: /Delete account…|删除账户…/, exact: true }).click();
      await panel.getByRole("button", { name: /Confirm account deletion|确认删除账户/, exact: true }).click();
      await expect(panel.getByText(/Account and private content deleted|账户与私有内容已删除/)).toBeVisible();
      expect((await admin.get(`/api/admin/access/users/${uid}`)).status()).toBe(404);
      expect((await owner.get("/api/conversations")).status()).toBe(401);
      await expect(panel.getByRole("button", { name: /View account: Synthetic inspection account|查看账户: Synthetic inspection account/ })).toHaveCount(0);
    } finally { await context.close(); await owner.dispose(); await admin.dispose(); }
  });
}

test("admin directory retry, access actions and lost deletion response recovery", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(120_000);
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const owner = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
  const context = await browser.newContext({ viewport: { width: 375, height: 900 }, locale: "en-US", storageState: await admin.storageState() });
  const email = `admin-recovery-${Date.now()}@example.test`, password = "synthetic recovery passphrase";
  try {
    expect((await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: true } })).status()).toBe(200);
    const registered = await owner.post("/api/auth/register", { data: { email, password, confirm_password: password, display_name: "Synthetic approval account" } });
    expect(registered.status()).toBe(201);
    const uid = (await registered.json()).user_id;
    expect((await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: false } })).status()).toBe(200);
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); let failList = true;
    await page.route("**/api/admin/access/users/page?*", async (route) => { if (failList) { failList = false; await route.abort(); } else await route.continue(); });
    await page.goto(base); const panel = await openUsers(page);
    await expect(panel.getByRole("alert")).toContainText("Unable to load");
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    await panel.getByLabel("Email or name").fill(email); await panel.getByRole("button", { name: "Search users" }).click();
    await panel.getByRole("button", { name: "View account: Synthetic approval account" }).click();
    await panel.getByRole("button", { name: "Approve registration", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("Approved.");
    expect((await owner.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
    await panel.getByRole("button", { name: "Disable account", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Enable account", exact: true })).toBeVisible();
    expect((await owner.get("/api/conversations")).status()).toBe(401);
    await panel.getByRole("button", { name: "Enable account", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Disable account", exact: true })).toBeVisible();
    expect((await owner.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
    await panel.getByRole("button", { name: "Revoke sessions", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("All user sessions revoked.");
    expect((await owner.get("/api/conversations")).status()).toBe(401);
    await panel.getByText("Password assistance", { exact: true }).click();
    await panel.getByRole("button", { name: "Create reset link", exact: true }).click();
    await expect(panel.locator("#admin-reset-link")).toBeFocused();
    expect(await panel.locator("#admin-reset-link").inputValue()).toContain("/reset-password?token=");
    await panel.getByRole("button", { name: "Hide", exact: true }).click();
    await panel.getByRole("button", { name: "Delete account…", exact: true }).click();
    let first = true;
    const keys: string[] = [];
    await page.route(`**/api/admin/access/users/${uid}/delete`, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (first) { first = false; const response = await route.fetch(); expect(response.status()).toBe(202); await route.abort(); }
      else await route.continue();
    });
    await panel.getByRole("button", { name: "Confirm account deletion", exact: true }).click();
    const checkDeletion = panel.getByRole("button", { name: "Check deletion result", exact: true });
    await expect(panel.getByRole("alert").filter({ hasText: "Could not confirm the action result" }).or(checkDeletion).first()).toBeVisible();
    if (await checkDeletion.isVisible()) await checkDeletion.click();
    else await panel.getByRole("button", { name: "Confirm account deletion", exact: true }).click();
    await expect(panel.getByText(/Account and private content deleted/)).toBeVisible();
    expect(keys).toHaveLength(2); expect(keys[0]).toBeTruthy(); expect(keys[0]).toBe(keys[1]);
    expect((await admin.get(`/api/admin/access/users/${uid}`)).status()).toBe(404);
    const audit = await (await admin.get(`/api/admin/audit?target_user_id=${uid}`)).json();
    expect(audit.filter((event: { action: string }) => event.action === "USER_DELETE_QUEUED")).toHaveLength(1);
    expect(audit.filter((event: { action: string }) => event.action === "USER_DELETED")).toHaveLength(1);
  } finally {
    await admin.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: false } });
    await context.close(); await owner.dispose(); await admin.dispose();
  }
});
