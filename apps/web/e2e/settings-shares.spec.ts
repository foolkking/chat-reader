import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openShares(page: Page) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  const entry = page.getByRole("button", { name: /My shares|我的分享/ });
  if (!await entry.isVisible()) {
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    await expect(settings.or(entry).first()).toBeVisible();
    if (!await entry.isVisible()) await settings.click();
  }
  await entry.click();
  return page.getByRole("dialog", { name: /My shares|我的分享/ });
}

async function openSection(dialog: Locator, name: RegExp) {
  const toggle = dialog.getByRole("button", { name });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}

async function shareStatus(dialog: Locator, name: RegExp) {
  await dialog.getByRole("group", { name: /Share status|分享状态/ }).getByRole("button", { name, exact: true }).click();
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`share conflict preserves draft and merges only edited fields at ${width}`, async ({ browser, playwright, baseURL }, info) => {
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await register(context.request, base, `share-conflict-${width}`);
      await settingsAppearance(context.request, base, locale);
      const headers = { Origin: base };
      const source = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic conflict source", messages: [{ role: "user", content_markdown: "Synthetic public question" }, { role: "assistant", content_markdown: "Synthetic public answer" }] } });
      expect(source.status()).toBe(201);
      const created = await context.request.post(`${base}/api/conversations/${(await source.json()).conversation.id}/shares`, { headers, data: { title: "Synthetic original link", include_annotations: true } });
      expect(created.status()).toBe(200);
      const share = await created.json();
      const page = await context.newPage();
      await page.goto(base);
      const dialog = await openShares(page);
      await dialog.getByRole("button", { name: /^(Edit share|编辑分享)$/ }).click();
      await openSection(dialog, /Link appearance|链接外观/);
      await dialog.getByLabel(/^(Share title|分享标题)$/).fill("Synthetic retained title");
      const remote = await context.request.patch(`${base}/api/shares/${share.id}`, { headers, data: { base_revision: share.settings_revision, include_annotations: false, ...(width === 768 ? { title: "Synthetic remote title" } : {}) } });
      expect(remote.status()).toBe(200);
      let failLatest = width === 375;
      await page.route(`**/api/shares/${share.id}`, async route => {
        if (route.request().method() === "GET" && failLatest) { failLatest = false; await route.abort(); }
        else await route.continue();
      });
      const save = dialog.getByRole("button", { name: /^(Save share settings|保存分享设置)$/ });
      await save.click();
      await page.getByRole("button", { name: /^(Apply settings|应用设置)$/ }).click();
      await expect(save).toBeDisabled();
      await expect(dialog.getByLabel(/^(Share title|分享标题)$/)).toHaveValue("Synthetic retained title");
      if (width === 375) {
        await expect(dialog.getByText(/无法读取最新分享设置/)).toBeVisible();
        await dialog.getByRole("button", { name: "读取最新设置" }).click();
      }
      const conflict = dialog.getByRole("region", { name: /Share settings conflict|分享设置冲突/ });
      await expect(conflict).toBeFocused();
      await expect(conflict.getByText(/Server now: Off|服务器当前：关闭/)).toBeVisible();
      if (width === 768) {
        await expect(conflict.getByText("Server now: Synthetic remote title")).toBeVisible();
        await expect(conflict.getByText("Your change: Synthetic retained title")).toBeVisible();
      }
      const persisted = await (await context.request.get(`${base}/api/shares/${share.id}`)).json();
      expect(persisted.title).toBe(width === 768 ? "Synthetic remote title" : "Synthetic original link");
      expect(persisted.include_annotations).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`share-conflict-${width}.png`) });
      await conflict.getByRole("button", { name: /^(Merge my changes|合并我的更改)$/ }).click();
      const patchRequest = page.waitForRequest(request => request.method() === "PATCH" && request.url().endsWith(`/api/shares/${share.id}`));
      await save.click();
      await page.getByRole("button", { name: /^(Apply settings|应用设置)$/ }).click();
      const submitted = (await patchRequest).postDataJSON();
      expect(Object.keys(submitted).sort()).toEqual(["base_revision", "title"]);
      await expect(dialog.getByRole("article", { name: "Synthetic retained title" })).toBeVisible();
      const result = await (await context.request.get(`${base}/api/shares/${share.id}`)).json();
      expect(result.title).toBe("Synthetic retained title");
      expect(result.include_annotations).toBe(false);
      expect(result.share_url).toBe(share.share_url);
      const publicResult = await context.request.get(`${base}/api/shared/${share.token}`);
      expect(publicResult.status()).toBe(200);
      expect((await publicResult.json()).capabilities.annotations).toBe(false);
    } finally { await context.close(); await admin.dispose(); }
  });
}

test("share conflict can discard a draft and cannot revive a remotely revoked link", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await register(context.request, base, "share-discard-revoked");
    await settingsAppearance(context.request, base, "en-US");
    const headers = { Origin: base };
    const source = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic discard source", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: "Synthetic answer" }] } });
    expect(source.status()).toBe(201);
    const created = await context.request.post(`${base}/api/conversations/${(await source.json()).conversation.id}/shares`, { headers, data: { title: "Synthetic original link" } });
    expect(created.status()).toBe(200);
    const share = await created.json();
    const page = await context.newPage();
    await page.goto(base);
    const dialog = await openShares(page);
    await dialog.getByRole("button", { name: "Edit share", exact: true }).click();
    await openSection(dialog, /Link appearance/);
    const title = dialog.getByLabel("Share title", { exact: true });
    await title.fill("Synthetic discard draft");
    expect((await context.request.patch(`${base}/api/shares/${share.id}`, { headers, data: { title: "Synthetic latest title", base_revision: share.settings_revision } })).status()).toBe(200);
    const save = dialog.getByRole("button", { name: "Save share settings", exact: true });
    await save.click();
    await page.getByRole("button", { name: "Apply settings", exact: true }).click();
    const conflict = dialog.getByRole("region", { name: "Share settings conflict" });
    await expect(conflict).toBeVisible();
    await conflict.getByRole("button", { name: "Load latest settings", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Discard your changes and load the latest settings?" });
    await expect(title).toHaveValue("Synthetic discard draft");
    await confirmation.getByRole("button", { name: "Load latest settings", exact: true }).click();
    await expect(title).toHaveValue("Synthetic latest title");
    await expect(save).toBeDisabled();
    await expect(conflict).toBeHidden();
    await title.fill("Synthetic must not revive");
    expect((await context.request.post(`${base}/api/shares/${share.id}/revoke`, { headers })).status()).toBe(200);
    await save.click();
    await page.getByRole("button", { name: "Apply settings", exact: true }).click();
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole("button", { name: "Merge my changes" })).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(title).toHaveValue("Synthetic must not revive");
    const persisted = await (await context.request.get(`${base}/api/shares/${share.id}`)).json();
    expect(persisted.title).toBe("Synthetic latest title");
    expect(persisted.revoked_at).toBeTruthy();
    expect((await context.request.get(`${base}/api/shared/${share.token}`)).status()).toBe(410);
  } finally { await context.close(); await admin.dispose(); }
});

test("sharing policy changes retain the draft and offer list recovery", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const policy = await (await admin.get("/api/admin/features")).json();
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  try {
    await register(context.request, base, "share-policy-recovery");
    await settingsAppearance(context.request, base, "zh-CN");
    const headers = { Origin: base };
    const source = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic policy source", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: "Synthetic answer" }] } });
    expect(source.status()).toBe(201);
    const created = await context.request.post(`${base}/api/conversations/${(await source.json()).conversation.id}/shares`, { headers, data: { title: "Synthetic unchanged title" } });
    expect(created.status()).toBe(200);
    const share = await created.json();
    const page = await context.newPage();
    await page.goto(base);
    const dialog = await openShares(page);
    await dialog.getByRole("button", { name: "编辑分享", exact: true }).click();
    await openSection(dialog, /链接外观/);
    await dialog.getByLabel("分享标题", { exact: true }).fill("Synthetic blocked draft");
    // Change real server policy after the stale editor opens, before PATCH.
    expect((await admin.put("/api/admin/features", { data: { allow_share_links: false } })).status()).toBe(200);
    const save = dialog.getByRole("button", { name: "保存分享设置", exact: true });
    await save.click();
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("当前权限不允许此操作");
    await expect(dialog.getByLabel("分享标题", { exact: true })).toHaveValue("Synthetic blocked draft");
    await expect(save).toBeDisabled();
    expect((await (await context.request.get(`${base}/api/shares/${share.id}`)).json()).title).toBe("Synthetic unchanged title");
    await dialog.getByRole("button", { name: "返回分享列表", exact: true }).click();
    await page.getByRole("button", { name: "放弃更改", exact: true }).click();
    await expect(dialog.getByRole("article", { name: "Synthetic unchanged title" })).toBeVisible();
    await dialog.getByRole("article", { name: "Synthetic unchanged title" }).getByRole("button", { name: "更多", exact: true }).click();
    await dialog.getByRole("menuitem", { name: "撤销", exact: true }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "撤销分享", exact: true }).click();
    await expect.poll(async () => (await (await context.request.get(`${base}/api/shares/${share.id}`)).json()).revoked_at).toBeTruthy();
  } finally {
    await admin.put("/api/admin/features", { data: { allow_share_links: policy.allow_share_links } });
    await context.close(); await admin.dispose();
  }
});

test("revoking the last filtered share page returns to the remaining active links", async ({ browser, playwright, baseURL }, info) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  try {
    await register(context.request, base, "share-shrinking-page");
    await settingsAppearance(context.request, base, "zh-CN");
    const headers = { Origin: base };
    const source = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic share pagination", messages: [{ role: "user", content_markdown: "Synthetic pagination question" }, { role: "assistant", content_markdown: "Synthetic pagination answer" }] } });
    expect(source.status()).toBe(201);
    const sourceId = (await source.json()).conversation.id;
    for (let index = 0; index < 21; index++) expect((await context.request.post(`${base}/api/conversations/${sourceId}/shares`, { headers, data: { title: `Synthetic page ${index}` } })).status()).toBe(200);
    const page = await context.newPage();
    await page.goto(base);
    const dialog = await openShares(page);
    await shareStatus(dialog, /有效/);
    await dialog.getByRole("button", { name: "下一页" }).click();
    await expect(dialog.getByRole("article")).toHaveCount(1);
    await dialog.getByRole("button", { name: "批量管理" }).click();
    await dialog.getByRole("button", { name: "选择本页可撤销项" }).click();
    await dialog.getByRole("button", { name: "撤销所选 1 项" }).click();
    await page.getByRole("button", { name: "撤销分享", exact: true }).click();
    await expect(dialog.getByRole("article")).toHaveCount(20);
    await expect(dialog.getByText("第 1 页 · 共 20 项", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect((await (await context.request.get(`${base}/api/shares?status=revoked`)).json()).total).toBe(1);
    expect((await (await context.request.get(`${base}/api/shares?status=active`)).json()).total).toBe(20);
    await page.screenshot({ path: info.outputPath("share-page-recovery-375.png") });
  } finally { await context.close(); await admin.dispose(); }
});

for (const width of [375, 1440]) {
  test(`share retry recovery with injected network and per-item failure ${width}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await register(context.request, base, `share-recovery-${width}`);
      await settingsAppearance(context.request, base, "en-US");
      const headers = { Origin: base };
      const source = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic retry source", messages: [{ role: "user", content_markdown: "Synthetic retry question" }, { role: "assistant", content_markdown: "Synthetic retry answer" }] } });
      expect(source.status()).toBe(201);
      const conversationId = (await source.json()).conversation.id;
      for (const title of ["Retry first", "Retry second", "Retry third"]) expect((await context.request.post(`${base}/api/conversations/${conversationId}/shares`, { headers, data: { title } })).status()).toBe(200);
      const page = await context.newPage();
      let failList = true;
      await page.route("**/api/shares?*", async (route) => { if (failList) { failList = false; await route.abort(); } else await route.continue(); });
      await page.goto(base);
      const dialog = await openShares(page);
      await expect(dialog.getByText("Unable to load shares. Refresh to retry.")).toBeVisible();
      await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(dialog.getByRole("article")).toHaveCount(3);
      await dialog.getByRole("article", { name: "Retry first" }).getByRole("button", { name: "Edit share", exact: true }).click();
      await openSection(dialog, /Link appearance/);
      await dialog.getByLabel("Share title", { exact: true }).fill("Retained retry title");
      let failSave = true;
      await page.route("**/api/shares/*", async (route) => {
        if (failSave && route.request().method() === "PATCH") { failSave = false; await route.abort(); } else await route.continue();
      });
      await dialog.getByRole("button", { name: "Save share settings" }).click();
      await page.getByRole("button", { name: "Apply settings", exact: true }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog.getByLabel("Share title", { exact: true })).toHaveValue("Retained retry title");
      await dialog.getByRole("button", { name: "Save share settings" }).click();
      await page.getByRole("button", { name: "Apply settings", exact: true }).click();
      await expect(dialog.getByRole("article", { name: "Retained retry title" })).toBeVisible();
      await page.unroute("**/api/shares/*");
      await dialog.getByRole("button", { name: "Manage multiple" }).click();
      await dialog.getByRole("button", { name: "Select revocable on this page" }).click();
      let failBatch = true;
      await page.route("**/api/shares/revoke-batch", async (route) => {
        if (!failBatch) { await route.continue(); return; }
        failBatch = false;
        const ids = route.request().postDataJSON().share_ids as string[];
        // Acknowledge one actual server commit and inject failure for the untouched item.
        const response = await route.fetch({ postData: JSON.stringify({ share_ids: [ids[0]] }) });
        expect(response.status()).toBe(200);
        await route.fulfill({ response, json: { results: [...(await response.json()).results, ...ids.slice(1).map(share_id => ({ share_id, status: "failed" }))] } });
      });
      await dialog.getByRole("button", { name: "Revoke 3 selected" }).click();
      await page.getByRole("button", { name: "Revoke shares", exact: true }).click();
      await expect(dialog.getByText("2 items incomplete; other items were revoked.")).toBeVisible();
      let rows = (await (await context.request.get(`${base}/api/shares`)).json()).items;
      expect(rows.filter((row: { status: string }) => row.status === "revoked")).toHaveLength(1);
      expect(rows.filter((row: { status: string }) => row.status === "active")).toHaveLength(2);
      await dialog.getByRole("button", { name: "Retry item" }).first().click();
      await page.getByRole("button", { name: "Revoke shares", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Retry item" })).toHaveCount(1);
      rows = (await (await context.request.get(`${base}/api/shares`)).json()).items;
      expect(rows.filter((row: { status: string }) => row.status === "revoked")).toHaveLength(2);
      expect(rows.filter((row: { status: string }) => row.status === "active")).toHaveLength(1);
      await dialog.getByRole("button", { name: "Retry item" }).click();
      await page.getByRole("button", { name: "Revoke shares", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Retry item" })).toHaveCount(0);
      rows = (await (await context.request.get(`${base}/api/shares`)).json()).items;
      expect(rows.filter((row: { status: string }) => row.status === "revoked")).toHaveLength(3);
      await context.setOffline(true);
      await expect(dialog.getByText("Share management requires a connection. Reconnect and refresh.")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
      await context.setOffline(false);
      await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(dialog.getByRole("article")).toHaveCount(3);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: /My shares/ })).toBeFocused();
    } finally { await context.close(); await admin.dispose(); }
  });
}

async function register(request: APIRequestContext, base: string, name: string) {
  const response = await request.post(`${base}/api/auth/register`, { headers: { Origin: base }, data: { email: `${name}-${Date.now()}@example.test`, password: "synthetic share browser passphrase", confirm_password: "synthetic share browser passphrase" } });
  expect(response.status()).toBe(201);
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`owned shares pagination, editing, permissions and revocation ${width} ${locale}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const policy = await (await admin.get("/api/admin/features")).json();
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const other = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
    const guest = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
    try {
      expect((await admin.put("/api/admin/features", { data: { allow_share_links: true, allow_public_share: true, allow_share_password: true } })).status()).toBe(200);
      await register(context.request, base, `share-a-${width}`);
      await settingsAppearance(context.request, base, locale);
      const headers = { Origin: base };
      const pair = (start: number) => [start, start + 1].map((i) => ({ role: i % 2 ? "assistant" : "user", content_markdown: `Synthetic share message ${String(i).padStart(2, "0")}` }));
      const created = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic shared source", messages: pair(0) } });
      expect(created.status()).toBe(201);
      const initial = await created.json(), source = initial.conversation.id;
      let anchor = initial.messages[1].id;
      for (let start = 2; start < 24; start += 2) {
        const inserted = await context.request.post(`${base}/api/conversations/${source}/messages/insert`, { headers, data: { anchor_message_id: anchor, position: "after", mode: "pair", messages: pair(start) } });
        expect(inserted.status()).toBe(201); anchor = (await inserted.json()).messages[1].id;
      }
      const messageIds = (await (await context.request.get(`${base}/api/conversations/${source}/dialogue-index`)).json()).items.map((item: { message_id: string }) => item.message_id);
      const links: Array<{ id: string; token: string; share_url: string }> = [];
      for (let i = 0; i < 22; i++) {
        const response = await context.request.post(`${base}/api/conversations/${source}/shares`, { headers, data: { title: `Synthetic link ${String(i).padStart(2, "0")}`, ...(i === 0 ? { expires_at: new Date(Date.now() + 2000).toISOString() } : {}) } });
        expect(response.status()).toBe(200); links.push(await response.json());
      }
      await register(other, base, `share-b-${width}`);
      expect((await (await other.get("/api/shares")).json()).total).toBe(0);
      expect((await other.patch(`/api/shares/${links[21].id}`, { data: { title: "Unauthorized" } })).status()).toBe(404);
      expect(await (await other.post("/api/shares/revoke-batch", { data: { share_ids: [links[21].id] } })).json()).toMatchObject({ results: [{ status: "not_found" }] });
      const page = await context.newPage(); await page.goto(base);
      await expect(page.locator("html")).toHaveAttribute("data-theme", locale === "zh-CN" ? "light" : "dark");
      let dialog = await openShares(page);
      await expect(dialog.getByRole("article")).toHaveCount(20);
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: /^(Revoke|撤销)$/ })).toHaveCount(0);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/my-shares-list-${width}.png` });
      await dialog.getByRole("button", { name: /Next page|下一页/ }).click();
      await expect(dialog.getByRole("article")).toHaveCount(2);
      await dialog.getByRole("button", { name: /Previous page|上一页/ }).click();
      const row = dialog.getByRole("article", { name: "Synthetic link 21", exact: true });
      const more = row.getByRole("button", { name: /^(More|更多)$/ });
      await more.focus(); await page.keyboard.press("ArrowDown");
      const menu = dialog.getByRole("menu", { name: /Share actions|分享操作/ });
      await expect(menu.getByRole("menuitem", { name: /Open share|打开分享/, exact: true })).toBeFocused();
      await page.keyboard.press("End");
      await expect(menu.getByRole("menuitem", { name: /^(Revoke|撤销)$/ })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0); await expect(more).toBeFocused(); await expect(dialog).toBeVisible();
      await row.getByRole("button", { name: /Edit share|编辑分享/ }).click();
      await expect(dialog.getByRole("button", { name: /Back to shares|返回分享列表/ })).toBeFocused();
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/my-shares-editor-${width}.png` });
      await expect(dialog.getByLabel(/Share title|分享标题/, { exact: true })).toBeHidden();
      await expect(dialog.getByLabel(/New share password|新分享密码/)).toHaveCount(0);
      await openSection(dialog, /Link appearance|链接外观/);
      await dialog.getByLabel(/Share title|分享标题/, { exact: true }).fill("Unsaved share title");
      await dialog.getByRole("button", { name: /Back to shares|返回分享列表/ }).click();
      await expect(page.getByRole("dialog", { name: /Discard unsaved share settings|放弃未保存的分享设置/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog.getByLabel(/Share title|分享标题/, { exact: true })).toHaveValue("Unsaved share title");
      await dialog.getByLabel(/Share title|分享标题/, { exact: true }).fill("Synthetic edited share");
      const future = new Date(Date.now() + 86_400_000);
      await openSection(dialog, /Access & permissions|访问权限/);
      await dialog.getByLabel(/Link lifetime|链接有效期/).selectOption("custom");
      await dialog.getByLabel(/Expiry \(empty means never\)|到期时间（留空为永久）/).fill(new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
      await openSection(dialog, /Shared content|分享内容/);
      await dialog.getByLabel(/Selected messages only|仅所选消息/).check();
      await dialog.getByLabel(/Synthetic share message 00/).check();
      await dialog.getByRole("button", { name: /Next messages|下一组消息/ }).click();
      await dialog.getByLabel(/Synthetic share message 20/).check();
      await dialog.locator("summary").filter({ hasText: /Additional content|附加内容/ }).click();
      await dialog.getByLabel(/Include section contents|包含章节目录/).uncheck();
      await openSection(dialog, /Access & permissions|访问权限/);
      await dialog.getByLabel(/Allow export|允许导出/).check();
      await dialog.getByLabel(/Require a password|需要密码/, { exact: true }).check();
      await dialog.getByLabel(/New share password|新分享密码/).fill("synthetic protected share phrase");
      // Validation must reopen the hidden section and return keyboard focus to the field.
      await openSection(dialog, /Link appearance|链接外观/);
      await dialog.getByRole("button", { name: /Save share settings|保存分享设置/ }).click();
      await expect(dialog.getByLabel(/New share password|新分享密码/)).toBeFocused();
      await expect(dialog.getByRole("alert")).toHaveText(/matching passwords|两次输入须一致/);
      await dialog.getByLabel(/Confirm share password|确认分享密码/).fill("synthetic protected share phrase");
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/my-shares-access-${width}.png` });
      await dialog.getByRole("button", { name: /Save share settings|保存分享设置/ }).click();
      await page.getByRole("button", { name: /Apply settings|应用设置/, exact: true }).click();
      await expect(dialog.getByText(/Share settings saved|分享设置已保存/)).toBeVisible();
      const stored = (await (await context.request.get(`${base}/api/conversations/${source}/shares`)).json()).find((item: { id: string }) => item.id === links[21].id);
      expect(stored.share_url).toBe(links[21].share_url); expect(stored.selected_message_ids).toEqual([messageIds[0], messageIds[20]]);
      expect(stored.password_required).toBe(true);
      expect(new Date(stored.expires_at).getTime()).toBeGreaterThan(Date.now());
      expect((await guest.get(`/api/shared/${links[21].token}`)).status()).toBe(401);
      expect((await guest.post(`/api/shared/${links[21].token}/unlock`, { data: { password: "synthetic protected share phrase" } })).status()).toBe(200);
      expect(await (await guest.get(`/api/shared/${links[21].token}`)).json()).toMatchObject({ message_count: 2, capabilities: { export: true, toc: false } });
      expect((await guest.get(`/api/shared/${links[21].token}/messages/${messageIds[1]}/blocks`)).status()).toBe(404);
      await dialog.getByRole("article", { name: "Synthetic edited share" }).getByRole("button", { name: /Edit share|编辑分享/ }).click();
      await openSection(dialog, /Access & permissions|访问权限/);
      await dialog.getByLabel(/Link lifetime|链接有效期/).selectOption("never");
      await dialog.getByLabel(/Anyone with the link|持有链接的人/, { exact: true }).check();
      await dialog.getByRole("button", { name: /Save share settings|保存分享设置/ }).click();
      await page.getByRole("button", { name: /Apply settings|应用设置/, exact: true }).click();
      await expect(dialog.getByRole("article", { name: "Synthetic edited share" })).toBeVisible();
      const nowPublic = await other.get(`/api/shared/${links[21].token}`);
      expect(nowPublic.status()).toBe(200);
      expect((await nowPublic.json()).share).toMatchObject({ password_required: false, expires_at: null, share_url: links[21].share_url });
      await dialog.getByRole("article", { name: "Synthetic edited share" }).getByRole("button", { name: /^(More|更多)$/ }).click();
      await dialog.getByRole("menuitem", { name: /Open source conversation|打开来源对话/ }).click();
      await expect(page).toHaveURL(`${base}/conversations/${source}`);
      await expect(page.locator("#settings-focused-title")).toHaveCount(0);
      await expect(page.getByTestId("reader-scroll-root").getByText("Synthetic share message 00", { exact: true })).toBeVisible();
      dialog = await openShares(page);
      await shareStatus(dialog, /^(Expired|已过期)$/);
      await expect(dialog.getByRole("article")).toHaveCount(1);
      await expect(dialog.getByRole("article", { name: "Synthetic link 00" })).toBeVisible();
      await shareStatus(dialog, /^(All|全部)$/);
      await dialog.getByRole("button", { name: /Manage multiple|批量管理/ }).click();
      await dialog.getByLabel(/Select Synthetic edited share|选择 Synthetic edited share/, { exact: true }).check();
      await dialog.getByRole("button", { name: /Next page|下一页/ }).click();
      await dialog.getByLabel(/Select Synthetic link 00|选择 Synthetic link 00/, { exact: true }).check();
      expect((await admin.put("/api/admin/features", { data: { allow_share_links: false } })).status()).toBe(200);
      await dialog.getByRole("button", { name: /^(Refresh|刷新)$/ }).click();
      await expect(dialog.getByRole("article")).toHaveCount(2);
      await dialog.getByRole("button", { name: /Revoke 2 selected|撤销所选 2 项/ }).click();
      await page.getByRole("button", { name: /^(Revoke shares|撤销分享)$/ }).click();
      await expect(dialog.getByText(/2 shares revoked|已撤销 2 个分享/)).toBeVisible();
      await shareStatus(dialog, /^(Revoked|已撤销)$/);
      await expect(dialog.getByRole("article")).toHaveCount(2);
      await dialog.getByRole("button", { name: /Done selecting|完成选择/ }).click();
      await dialog.getByRole("article", { name: "Synthetic edited share" }).getByRole("button", { name: /^(More|更多)$/ }).click();
      await dialog.getByRole("menuitem", { name: /Only this conversation|仅此对话/ }).click();
      await expect(dialog.getByRole("button", { name: /All conversations|查看全部对话/ })).toBeVisible();
      await dialog.getByLabel(/Search conversation or share title|按对话或分享标题搜索/).fill("Synthetic edited");
      await dialog.getByRole("button", { name: /^(Search|搜索)$/ }).click();
      await expect(dialog.getByRole("article")).toHaveCount(1);
      expect((await context.request.post(`${base}/api/conversations/${source}/shares`, { headers, data: {} })).status()).toBe(403);
      expect((await admin.put("/api/admin/features", { data: { allow_share_links: true } })).status()).toBe(200);
      expect((await guest.get(`/api/shared/${links[21].token}`)).status()).toBe(410);
      expect((await guest.get(`/api/shared/${links[0].token}`)).status()).toBe(410);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/my-shares-${width}.png` });
      await dialog.getByLabel(/Search conversation or share title|按对话或分享标题搜索/).fill("No synthetic match");
      await dialog.getByRole("button", { name: /^(Search|搜索)$/ }).click();
      await expect(dialog.getByText(/No matching shares|没有符合条件的分享/)).toBeVisible();
      await dialog.getByRole("button", { name: /Clear filters|清除筛选/ }).click();
      await expect(dialog.getByRole("article")).toHaveCount(20);
    } finally {
      await admin.put("/api/admin/features", { data: { allow_share_links: policy.allow_share_links, allow_public_share: policy.allow_public_share, allow_share_password: policy.allow_share_password } });
      await context.close(); await other.dispose(); await guest.dispose(); await admin.dispose();
    }
  });
}
