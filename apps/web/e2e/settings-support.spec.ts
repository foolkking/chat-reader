import { expect, test, type Page } from "@playwright/test";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";
import { readLocal } from "./settings-offline-helper";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL and worker");
async function help(page: Page) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  await expect(settings.or(page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ })).first()).toBeVisible();
  if (!await settings.isVisible()) await page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ }).click();
  await settings.click(); await page.getByRole("button", { name: /^(Help & diagnostics|帮助与诊断)$/ }).click();
}
const body = (page: Page) => page.getByRole("textbox", { name: /^(Request body|请求内容)$/ });
const saved = (page: Page) => expect(page.getByText(/^(Draft saved on this device|草稿保存在本机)$/)).toBeVisible();

test("request and reply pagination preserve the return page and show actual records", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
  let userId = "";
  try {
    const registered = await context.request.post("/api/auth/register", { data: { email: `support-pages-${Date.now()}@example.test`, password: "synthetic pagination passphrase", confirm_password: "synthetic pagination passphrase" } });
    expect(registered.status()).toBe(201); userId = (await registered.json()).user_id;
    await settingsAppearance(context.request, base, "en-US");
    for (let i = 0; i < 16; i++) {
      const created = await context.request.post("/api/me/requests", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { kind: "QUESTION", title: `Synthetic history ${i}`, body: `Synthetic opening ${i}` } });
      expect(created.status()).toBe(201); let request = await created.json();
      if (i === 0) {
        for (let reply = 1; reply <= 20; reply++) {
          const response = await admin.post(`/api/admin/requests/${request.id}/messages`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { base_revision: request.revision, body: `Synthetic paginated reply ${reply}` } });
          expect(response.status()).toBe(200); request = await response.json();
        }
      } else {
        expect((await admin.post(`/api/admin/requests/${request.id}/decision`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { base_revision: request.revision, action: "RESOLVE", body: "Synthetic resolved" } })).status()).toBe(200);
      }
    }
    const page = await context.newPage(); await page.goto(base); await help(page);
    await page.getByRole("button", { name: "My requests", exact: true }).click();
    const region = page.getByRole("region", { name: "Requests and help", exact: true });
    const pagination = region.getByRole("navigation", { name: "Request pagination", exact: true });
    await expect(pagination).toContainText("1–15 / 16");
    await pagination.getByRole("button", { name: "Next", exact: true }).click();
    await expect(pagination).toContainText("16–16 / 16");
    await region.getByRole("button").filter({ hasText: "Synthetic history 0" }).click();
    await expect(page.getByRole("heading", { name: "Synthetic history 0", exact: true })).toBeVisible();
    await expect(region.getByText("Synthetic paginated reply 19", { exact: true })).toBeVisible();
    await pagination.getByRole("button", { name: "Next", exact: true }).click();
    await expect(region.getByText("Synthetic paginated reply 20", { exact: true })).toBeVisible();
    await expect(region.getByText("Synthetic opening 0", { exact: true })).toHaveCount(0);
    await region.getByRole("button", { name: "Back to requests", exact: true }).click();
    await expect(pagination).toContainText("16–16 / 16");
    await region.getByLabel("Status", { exact: true }).selectOption("WAITING");
    await expect(pagination).toHaveCount(0);
    await expect(region.getByRole("button").filter({ hasText: "Synthetic history 0" })).toBeVisible();
  } finally { await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
});

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`support request persists, administrator approval applies, email link opens ${width}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const user = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width, height: 900 }, locale });
    const root = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, storageState: await admin.storageState(), viewport: { width, height: 900 }, locale });
    let userId = "";
    try {
      const password = "synthetic support user passphrase";
      const registered = await user.request.post("/api/auth/register", { data: { email: `support-ui-${width}-${Date.now()}@example.test`, password, confirm_password: password } });
      expect(registered.status()).toBe(201); userId = (await registered.json()).user_id;
      await settingsAppearance(user.request, base, locale); await settingsAppearance(root.request, base, locale);
      const caps = await (await user.request.get("/api/auth/capabilities")).json();
      const requested = caps.maximum_merge_message_count + 10;
      expect(requested).toBeLessThanOrEqual(caps.limit_hard_bounds.merge_message_count);
      const page = await user.newPage(); await page.goto(base); await help(page);
      await expect(page.getByText(/^(Connected to server|已连接服务器)$/)).toBeVisible();
      await expect(page.getByText(/^(Allowed|允许)$/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Generate & copy diagnostics|生成并复制诊断/ })).toHaveCount(0);
      await page.getByRole("button", { name: /Request higher limits|申请调整限制/ }).click();
      await page.getByLabel(/^(Title|标题)$/).fill(`Synthetic merge request ${width}`);
      await page.getByLabel(/Merged messages|合并消息数/).fill(String(requested));
      await body(page).fill("Synthetic **support** explanation."); await saved(page);
      await page.getByRole("button", { name: /^(Preview|预览)$/ }).click();
      await expect(page.locator("strong").filter({ hasText: "support" })).toBeVisible();
      await page.getByRole("button", { name: /^(Write|编写)$/ }).click();
      await page.getByText(/Email and diagnostics \(optional\)|邮件与诊断（可选）/).click();
      await expect(page.getByRole("checkbox", { name: /Attach redacted diagnostics|附上脱敏诊断/ })).not.toBeChecked();
      await page.getByRole("checkbox", { name: /Attach redacted diagnostics|附上脱敏诊断/ }).check();
      const diagnostic = JSON.parse(await page.locator("form pre").innerText());
      expect(diagnostic.capabilities.maximum_merge_message_count).toBe(caps.maximum_merge_message_count);
      await page.getByRole("checkbox", { name: /Notify the administrator by email|邮件通知管理员/ }).check();
      await page.getByRole("checkbox", { name: /Email me when there is a reply|回复时接收邮件/ }).check();
      await saved(page);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/support-compose-${width}.png` });
      let first = true;
      await page.route("**/api/me/requests", async route => { if (route.request().method() === "POST" && first) { first = false; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort("failed"); } else await route.continue(); });
      await page.getByRole("button", { name: /Submit request|提交请求/ }).click();
      await expect(page.getByRole("button", { name: /Retry submission|重试提交/ })).toBeVisible();
      await expect.poll(async () => (await (await user.request.get("/api/me/requests")).json()).total).toBe(1);
      await page.getByRole("button", { name: /Retry submission|重试提交/ }).click();
      await expect(page.getByRole("heading", { name: `Synthetic merge request ${width}` })).toBeVisible();
      const request = (await (await user.request.get("/api/me/requests")).json()).items[0];
      const original = await (await user.request.get(`/api/me/requests/${request.id}`)).json();
      expect(original.messages).toHaveLength(1); expect(original.messages[0].body).toContain("Synthetic **support**");
      await expect.poll(async () => (await readLocal(page, userId)).settings.filter(row => row.key.startsWith("support-draft:")).length).toBe(0);
      const rootPage = await root.newPage(); await rootPage.goto(`${base}/#support-request=${request.id}`);
      await expect(rootPage.getByRole("heading", { name: `Synthetic merge request ${width}` })).toBeVisible();
      await rootPage.getByRole("button", { name: /Reply or decide|回复或处理/ }).click();
      await rootPage.getByLabel(/Action|处理方式/).selectOption("APPROVE");
      await body(rootPage).fill("Synthetic approval after review.");
      await rootPage.getByText(/Email and diagnostics \(optional\)|邮件与诊断（可选）/).click();
      await rootPage.getByRole("checkbox", { name: /Notify the user by email|邮件通知用户/ }).check(); await saved(rootPage);
      await rootPage.getByRole("button", { name: /^(Approve request|批准申请)$/ }).click();
      await rootPage.getByRole("dialog", { name: /^(Approve request|批准申请)/ }).getByRole("button", { name: /Approve request|批准申请/ }).click();
      await expect.poll(async () => (await (await user.request.get("/api/auth/capabilities")).json()).maximum_merge_message_count).toBe(requested);
      await expect.poll(async () => (await (await user.request.get(`/api/me/requests/${request.id}`)).json()).messages.length).toBe(2);
      await page.getByRole("button", { name: /Refresh replies|刷新回复/ }).click();
      await expect(page.getByText("Synthetic approval after review.")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await rootPage.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/support-approved-${width}.png` });
      await expect.poll(async () => (await (await admin.get("/api/settings-test/mail")).json()).some((mail: { text: string }) => mail.text.includes(`#support-request=${request.id}`))).toBe(true);
      await rootPage.getByText(/^(Account limit adjustment|账户限额调整)$/).click();
      await rootPage.getByLabel(/^(Merged messages|合并消息数)$/).fill("");
      await rootPage.getByLabel(/^(Reason|调整原因)$/).fill("Synthetic reset to defaults.");
      await rootPage.getByRole("button", { name: /^(Save limits|保存限制)$/ }).click();
      await rootPage.getByRole("dialog", { name: /^(Update this account|更新此账户)/ }).getByRole("button", { name: /Save limits|保存限制/ }).click();
      await expect.poll(async () => (await (await user.request.get("/api/auth/capabilities")).json()).maximum_merge_message_count).toBe(caps.maximum_merge_message_count);
      expect((await user.request.get("/api/admin/requests")).status()).toBe(404);
    } finally { await user.close(); await root.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
  });
}

test("support drafts survive offline reopen, detect another tab and block silent signout", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width: 1440, height: 900 }, locale: "en-US" });
  let userId = "";
  try {
    const registered = await context.request.post("/api/auth/register", { data: { email: `support-draft-${Date.now()}@example.test`, password: "synthetic draft passphrase", confirm_password: "synthetic draft passphrase" } });
    expect(registered.status()).toBe(201); userId = (await registered.json()).user_id;
    await settingsAppearance(context.request, base, "en-US");
    const first = await context.newPage(); await first.goto(base); await help(first);
    await first.getByRole("button", { name: "Write an issue or question" }).click();
    await first.getByLabel("Title", { exact: true }).fill("Synthetic durable request"); await body(first).fill("First saved draft"); await saved(first);
    const second = await context.newPage(); await second.goto(base); await help(second); await second.getByRole("button", { name: "Write an issue or question" }).click();
    await expect(body(second)).toHaveText("First saved draft");
    await body(first).fill("Latest first tab draft"); await saved(first);
    await body(second).fill("Second tab retained input");
    await expect(second.getByRole("alert").filter({ hasText: "Another window saved" })).toBeVisible();
    await expect(body(second)).toHaveText("Second tab retained input");
    await second.getByRole("button", { name: "Load latest draft" }).click(); await expect(body(second)).toHaveText("Latest first tab draft"); await second.close();
    await context.setOffline(true); await body(first).fill("Offline synthetic request draft"); await saved(first);
    await expect(first.getByRole("button", { name: "Submit request", exact: true })).toBeDisabled();
    await first.getByRole("button", { name: "Save and back", exact: true }).click();
    await first.getByRole("button", { name: "Write a request", exact: true }).click();
    await expect(body(first)).toHaveText("Offline synthetic request draft");
    await context.setOffline(false);
    expect((await (await context.request.get("/api/me/requests")).json()).total).toBe(0);
    await first.getByRole("button", { name: "Save and back", exact: true }).click();
    await first.keyboard.press("Escape");
    await first.getByRole("button", { name: "Account & security", exact: true }).click();
    await first.getByRole("button", { name: "Log out current account", exact: true }).click();
    await expect(first.getByRole("region", { name: "Handle local changes before signing out", exact: true })).toBeVisible();
    expect((await readLocal(first, userId)).settings.some(row => row.key.startsWith("support-draft:"))).toBe(true);
    const download = first.waitForEvent("download");
    await first.getByRole("button", { name: "Export local changes", exact: true }).click();
    const files = unzipSync(await readFile((await (await download).path())!));
    const changes = JSON.parse(strFromU8(files["changes.json"]));
    expect(changes.support_drafts).toHaveLength(1);
    expect(changes.support_drafts[0].value.body).toBe("Offline synthetic request draft");
    expect(strFromU8(files["notes.md"])).toContain("Offline synthetic request draft");
    expect(JSON.stringify(changes)).not.toContain("synthetic draft passphrase");
    expect((await (await context.request.get("/api/me/requests")).json()).total).toBe(0);
  } finally { await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
});

test("request storage failure retains input and retry saves the actual draft", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
  let userId = "";
  try {
    const response = await context.request.post("/api/auth/register", { data: { email: `support-storage-${Date.now()}@example.test`, password: "synthetic storage passphrase", confirm_password: "synthetic storage passphrase" } });
    expect(response.status()).toBe(201); userId = (await response.json()).user_id;
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base); await help(page);
    await page.getByRole("button", { name: "Write an issue or question", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Synthetic storage recovery"); await saved(page);
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === "settings" && String(value?.key).startsWith("support-draft:")) throw new DOMException("Synthetic storage fault", "QuotaExceededError");
        return original.call(this, value, key);
      };
      (window as unknown as { restoreSupportStorage: () => void }).restoreSupportStorage = () => { IDBObjectStore.prototype.put = original; };
    });
    await body(page).fill("Synthetic input must survive a failed write");
    await expect(page.getByRole("alert").filter({ hasText: "could not be saved locally" })).toBeVisible();
    await expect(body(page)).toHaveText("Synthetic input must survive a failed write");
    await expect(page.getByRole("button", { name: "Submit request", exact: true })).toBeDisabled();
    expect((await (await context.request.get("/api/me/requests")).json()).total).toBe(0);
    await page.evaluate(() => (window as unknown as { restoreSupportStorage: () => void }).restoreSupportStorage());
    await page.getByRole("button", { name: "Retry saving", exact: true }).click(); await saved(page);
    expect((await readLocal(page, userId)).settings.find(row => row.key === "support-draft:new")?.value).toMatchObject({ body: "Synthetic input must survive a failed write" });
    await page.getByRole("button", { name: "Submit request", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Synthetic storage recovery", exact: true })).toBeVisible();
    const request = (await (await context.request.get("/api/me/requests")).json()).items[0];
    expect((await (await context.request.get(`/api/me/requests/${request.id}`)).json()).messages[0].body).toBe("Synthetic input must survive a failed write");
  } finally { await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
});

test("request reply conflict preserves input; notification links cannot cross account boundaries", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const ids: string[] = [];
  try {
    const register = async (suffix: string) => { const result = await context.request.post("/api/auth/register", { data: { email: `support-boundary-${suffix}-${Date.now()}@example.test`, password: "synthetic boundary passphrase", confirm_password: "synthetic boundary passphrase" } }); expect(result.status()).toBe(201); ids.push((await result.json()).user_id); await settingsAppearance(context.request, base, "en-US"); };
    await register("a");
    const created = await context.request.post("/api/me/requests", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { kind: "QUESTION", title: "Synthetic private boundary", body: "Synthetic first body" } });
    expect(created.status()).toBe(201); const original = await created.json();
    const page = await context.newPage(); await page.clock.install(); await page.goto(`${base}/#support-request=${original.id}`);
    await page.getByRole("button", { name: "Reply or withdraw" }).click();
    // The persisted draft is read before CodeMirror unlocks editing.
    await expect(body(page)).toHaveAttribute("contenteditable", "true");
    await body(page).fill("Synthetic local reply remains"); await saved(page);
    const remote = await admin.post(`/api/admin/requests/${original.id}/messages`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { base_revision: original.revision, body: "Synthetic newer admin reply" } }); expect(remote.status()).toBe(200);
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reviewed; keep my input" })).toBeVisible();
    await expect(page.getByText("Synthetic newer admin reply")).toBeVisible(); await expect(body(page)).toHaveText("Synthetic local reply remains");
    await page.getByRole("button", { name: "Reviewed; keep my input" }).click(); await saved(page);
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await expect.poll(async () => (await (await context.request.get(`/api/me/requests/${original.id}`)).json()).message_total).toBe(3);
    await page.getByRole("button", { name: "Reply or withdraw" }).click();
    await expect(body(page)).toHaveAttribute("contenteditable", "true");
    await body(page).fill("Synthetic locked draft"); await saved(page);
    await context.setOffline(true); await page.clock.fastForward(49 * 60 * 60 * 1000);
    await expect(page.getByRole("heading", { name: /Sign in required|需要重新登录/ })).toBeVisible(); await expect(body(page)).toHaveCount(0);
    expect((await readLocal(page, ids[0])).settings.some(row => row.key.startsWith("support-draft:"))).toBe(true);
    await page.clock.setFixedTime(new Date()); await context.setOffline(false);
    await page.goto(`${base}/login?reauth=1`); await context.clearCookies();
    await register("b"); await page.goto(`${base}/#support-request=${original.id}`);
    await expect(page.getByRole("region", { name: "Requests and help" }).getByRole("alert")).toContainText("unavailable to this account");
    await expect(page.getByText("Synthetic private boundary")).toHaveCount(0);
    expect((await (await context.request.get("/api/me/requests")).json()).total).toBe(0);
  } finally { await context.close(); for (const id of ids) await removeSyntheticAccount(admin, id); await admin.dispose(); }
});
