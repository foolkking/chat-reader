import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";
import type { SupportDetail } from "../lib/support-client";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL and worker");

async function inbox(page: Page, admin = false) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  await expect(settings.or(page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ })).first()).toBeVisible();
  if (!await settings.isVisible()) await page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ }).click();
  await settings.click();
  await page.getByRole("button", { name: /^(Help & diagnostics|帮助与诊断)$/ }).click();
  await page.getByRole("button", { name: admin ? /^(Handle user requests|处理用户请求)$/ : /^(My requests|我的请求)$/ }).click();
  return page.getByRole("region", { name: /^(Requests and help|请求与帮助)$/ });
}

async function register(request: APIRequestContext) {
  const password = "synthetic support navigation passphrase";
  const response = await request.post("/api/auth/register", { data: { email: `support-navigation-${crypto.randomUUID()}@example.test`, password, confirm_password: password } });
  expect(response.status()).toBe(201);
  return (await response.json()).user_id as string;
}

async function create(request: APIRequestContext, title: string, kind = "QUESTION") {
  const response = await request.post("/api/me/requests", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { kind, title, body: `Synthetic opening for ${title}` } });
  expect(response.status()).toBe(201);
  return await response.json() as SupportDetail;
}

async function resolve(admin: APIRequestContext, request: SupportDetail) {
  const response = await admin.post(`/api/admin/requests/${request.id}/decision`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { base_revision: request.revision, action: "RESOLVE", body: "Synthetic resolved after review" } });
  expect(response.status()).toBe(200);
}

test("changing filters never labels a previous query's records as the new result", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
  let userId = "", release = () => {};
  try {
    userId = await register(context.request); await settingsAppearance(context.request, base, "en-US");
    await create(context.request, "Synthetic open issue", "ISSUE");
    await resolve(admin, await create(context.request, "Synthetic resolved help"));
    const page = await context.newPage(); await page.goto(base);
    const region = await inbox(page);
    await expect(region.locator("[data-support-request-id]")).toHaveCount(2);
    const hold = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    await page.route("**/api/me/requests?*", async route => {
      if (new URL(route.request().url()).searchParams.get("status") === "RESOLVED") { held = true; await hold; }
      await route.continue();
    });
    await region.getByLabel("Status", { exact: true }).selectOption("RESOLVED");
    await expect.poll(() => held).toBe(true);
    await expect(region.locator("[data-support-request-id]")).toHaveCount(0);
    await expect(region.getByText("No requests match these filters.", { exact: true })).toHaveCount(0);
    // Change again while the old read is outstanding; its later response cannot
    // replace the current query. Both successful results come from the API.
    await region.getByLabel("Status", { exact: true }).selectOption("OPEN");
    await expect(region.locator("[data-support-request-id]")).toHaveCount(1);
    await expect(region.getByRole("button").filter({ hasText: "Synthetic open issue" })).toBeVisible();
    release();
    await expect(region.getByRole("button").filter({ hasText: "Synthetic resolved help" })).toHaveCount(0);
    await region.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(region.getByRole("button", { name: "Refresh", exact: true })).toHaveAttribute("aria-disabled", "false");
    await expect(region.locator("[data-support-request-id]")).toHaveCount(1);
  } finally { release(); await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
});

test("unavailable detail discards retained content even while retry is pending", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const contexts = [await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } }), await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } })];
  const ids: string[] = [];
  let release = () => {};
  try {
    for (const context of contexts) ids.push(await register(context.request));
    await settingsAppearance(contexts[0].request, base, "en-US");
    const own = await create(contexts[0].request, "Synthetic retained detail");
    const foreign = await create(contexts[1].request, "Synthetic foreign detail");
    expect((await contexts[0].request.get(`/api/me/requests/${foreign.id}`)).status()).toBe(404);
    const page = await contexts[0].newPage(); await page.goto(base);
    const region = await inbox(page);
    await region.getByRole("button").filter({ hasText: own.title }).click();
    const body = region.getByText(`Synthetic opening for ${own.title}`, { exact: true });
    await expect(body).toBeVisible();
    const hold = new Promise<void>(resolve => { release = resolve; });
    let unavailable = true, pending = false;
    await page.route(`**/api/me/requests/${own.id}?*`, async route => {
      if (unavailable) {
        // Replay an actual account-scoped 404 to exercise the view's revoked
        // resource handling without modifying account status or global policy.
        const response = await route.fetch({ url: `${base}/api/me/requests/${foreign.id}` });
        expect(response.status()).toBe(404); await route.fulfill({ response });
      } else { pending = true; await hold; await route.continue(); }
    });
    await region.getByRole("button", { name: "Refresh replies", exact: true }).click();
    await expect(region.getByRole("alert")).toContainText("unavailable to this account");
    await expect(body).toHaveCount(0);
    unavailable = false;
    await region.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    await expect(body).toHaveCount(0);
    release();
    await expect(body).toBeVisible();
    await expect(region.getByText(`Synthetic opening for ${foreign.title}`, { exact: true })).toHaveCount(0);
  } finally { release(); for (const context of contexts) await context.close(); for (const id of ids) await removeSyntheticAccount(admin, id); await admin.dispose(); }
});

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`administrator resolves the last filtered page and returns to remaining requests at ${width}`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const root = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, storageState: await admin.storageState(), viewport: { width, height: 900 } });
    const owners = [await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } }), await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } })];
    const ids: string[] = [];
    try {
      const initial = await admin.get("/api/admin/requests?status=OPEN&kind=ISSUE");
      expect(initial.status()).toBe(200);
      expect((await initial.json()).total, "This isolated test owns all matching requests").toBe(0);
      await settingsAppearance(root.request, base, locale);
      let oldest: SupportDetail | undefined;
      for (let owner = 0; owner < owners.length; owner++) {
        ids.push(await register(owners[owner].request));
        for (let index = 0; index < 8; index++) {
          const request = await create(owners[owner].request, `Synthetic filtered issue ${owner * 8 + index}`, "ISSUE");
          oldest ??= request;
        }
      }
      const page = await root.newPage(); await page.goto(base);
      const region = await inbox(page, true);
      await region.getByLabel(/^(Status|状态)$/).selectOption("OPEN");
      await region.getByLabel(/^(Type|类型)$/).selectOption("ISSUE");
      const pagination = region.getByRole("navigation", { name: /^(Request pagination|请求分页)$/ });
      await expect(pagination).toContainText("1–15 / 16");
      await pagination.getByRole("button", { name: /^(Next|下一页)$/ }).click();
      await expect(pagination).toContainText("16–16 / 16");
      await region.getByRole("button").filter({ hasText: "Synthetic filtered issue 0" }).click();
      await region.getByRole("button", { name: /^(Reply or decide|回复或处理)$/ }).click();
      await region.getByLabel(/Action|处理方式/).selectOption("RESOLVE");
      await region.getByRole("textbox", { name: /^(Request body|请求内容)$/ }).fill("Synthetic resolution from the last filtered page");
      await expect(region.getByText(/^(Draft saved on this device|草稿保存在本机)$/)).toBeVisible();
      await region.getByRole("button", { name: /^(Resolve|标记已解决)$/ }).click();
      await page.getByRole("dialog", { name: /^(Resolve|标记已解决)/ }).getByRole("button", { name: /^(Resolve|标记已解决)$/ }).click();
      await expect(region.getByText(/^(Your response was saved.|处理已保存。)$/)).toBeVisible();
      expect((await (await admin.get(`/api/admin/requests/${oldest!.id}`)).json()).status).toBe("RESOLVED");
      await region.getByRole("button", { name: /^(Back to requests|返回请求列表)$/ }).click();
      await expect(region.locator("[data-support-request-id]")).toHaveCount(15);
      await expect(pagination).toHaveCount(0);
      await expect(region.getByLabel(/^(Status|状态)$/)).toHaveValue("OPEN");
      await expect(region.getByLabel(/^(Type|类型)$/)).toHaveValue("ISSUE");
      await expect(region.getByRole("heading", { name: /^(User requests|用户请求)$/ })).toBeFocused();
      await expect(region.getByRole("button").filter({ hasText: "Synthetic filtered issue 15" })).toBeInViewport();
      expect((await (await admin.get("/api/admin/requests?status=OPEN&kind=ISSUE")).json()).total).toBe(15);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`support-shrunk-${width}.png`) });
    } finally { await root.close(); for (const owner of owners) await owner.close(); for (const id of ids) await removeSyntheticAccount(admin, id); await admin.dispose(); }
  });

  test(`failed reply pagination retains the actual page and retries at ${width}`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width, height: 900 } });
    let userId = "";
    try {
      userId = await register(context.request); await settingsAppearance(context.request, base, locale);
      let request = await create(context.request, "Synthetic reply navigation");
      for (let index = 1; index <= 20; index++) {
        const result = await admin.post(`/api/admin/requests/${request.id}/messages`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { base_revision: request.revision, body: `Synthetic navigation reply ${index}` } });
        expect(result.status()).toBe(200); request = await result.json();
      }
      const page = await context.newPage(); await page.goto(base);
      const region = await inbox(page);
      await region.getByRole("button").filter({ hasText: "Synthetic reply navigation" }).click();
      const pagination = region.getByRole("navigation", { name: /^(Request pagination|请求分页)$/ });
      await expect(pagination).toContainText("1–20 / 21");
      let failed = false;
      await page.route(`**/api/me/requests/${request.id}?*`, async route => {
        if (!failed && new URL(route.request().url()).searchParams.get("offset") === "20") { failed = true; await route.abort(); }
        else await route.continue();
      });
      await pagination.getByRole("button", { name: /^(Next|下一页)$/ }).click();
      await expect(region.getByRole("alert")).toBeVisible();
      await expect(pagination).toContainText("1–20 / 21");
      await expect(region.getByText("Synthetic navigation reply 19", { exact: true })).toBeVisible();
      await expect(region.getByText("Synthetic navigation reply 20", { exact: true })).toHaveCount(0);
      await expect(region.getByText(/The new page did not load|新一页尚未载入/)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`support-replies-failed-${width}.png`) });
      // Repeating Next must retry the failed page rather than becoming a no-op.
      await pagination.getByRole("button", { name: /^(Next|下一页)$/ }).click();
      await expect(region.getByRole("alert")).toHaveCount(0);
      await expect(pagination).toContainText("21–21 / 21");
      await expect(region.getByText("Synthetic navigation reply 20", { exact: true })).toBeVisible();
      await expect(region.getByText("Synthetic navigation reply 19", { exact: true })).toHaveCount(0);
      expect((await (await context.request.get(`/api/me/requests/${request.id}?offset=20&limit=20`)).json()).messages[0].body).toBe("Synthetic navigation reply 20");
      await page.screenshot({ path: info.outputPath(`support-replies-recovered-${width}.png`) });
    } finally { await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
  });

  test(`request refresh retains rows and return focus at ${width}`, async ({ browser, playwright, baseURL }, info) => {
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width, height: 900 } });
    let userId = "", release = () => {};
    try {
      userId = await register(context.request);
      await settingsAppearance(context.request, base, locale);
      for (let index = 0; index < 15; index++) await resolve(admin, await create(context.request, `Synthetic navigation ${index}`));
      const page = await context.newPage(); await page.goto(base);
      const region = await inbox(page);
      const row = region.getByRole("button").filter({ hasText: "Synthetic navigation 0" });
      await expect(row).toBeAttached();
      await row.scrollIntoViewIfNeeded();
      const scroller = page.locator("[data-settings-scroll-root]");
      const beforeScroll = await scroller.evaluate(element => element.scrollTop);
      expect(beforeScroll).toBeGreaterThan(200);
      // Refresh while reading the end of the list; the response fails after
      // being held. Existing records and the button must stay mounted.
      const hold = new Promise<void>(resolve => { release = resolve; });
      let fail = true, requested = false;
      await page.route("**/api/me/requests?*", async route => { if (fail) { requested = true; await hold; await route.abort(); } else await route.continue(); });
      const refresh = region.getByRole("button", { name: /^(Refresh|刷新)$/ });
      await refresh.click();
      await expect.poll(() => requested).toBe(true);
      await expect(row).toBeAttached({ timeout: 1500 });
      await expect(refresh).toBeFocused();
      release();
      await expect(region.getByRole("alert")).toBeVisible();
      await expect(region.getByRole("alert")).toBeInViewport({ timeout: 1500 });
      await page.screenshot({ path: info.outputPath(`support-refresh-failed-${width}.png`) });
      await expect(row).toBeAttached();
      fail = false;
      await region.getByRole("alert").getByRole("button", { name: /^(Retry|重试)$/ }).click();
      await expect(region.getByRole("alert")).toHaveCount(0);
      await row.click();
      await expect(region.getByRole("heading", { name: "Synthetic navigation 0", exact: true })).toBeVisible();
      await region.getByRole("button", { name: /^(Back to requests|返回请求列表)$/ }).click();
      await expect(row).toBeFocused();
      await expect(row).toBeInViewport();
      expect(await scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`support-return-${width}.png`) });
    } finally { release(); await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
  });
}
