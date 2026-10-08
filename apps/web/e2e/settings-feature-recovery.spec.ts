import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL/API");
async function open(page: Page, admin: APIRequestContext, base: string, width: number) {
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.setViewportSize({ width, height: 900 });
  await settingsAppearance(page.request, base, width === 768 ? "en-US" : "zh-CN");
  await page.goto(base);
  const settings = page.getByRole("button", { name: /^(设置|Settings)$/ });
  const sidebar = page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await page.getByRole("button", { name: /^(功能与默认值|Features & defaults)$/ }).click();
  return page.getByRole("dialog", { name: /^(功能与默认值|Features & defaults)$/ });
}
async function shot(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
}
async function fixture(admin: APIRequestContext) {
  const original = await (await admin.get("/api/admin/features")).json();
  expect((await admin.put("/api/admin/features", { data: { allow_share_links: true, maximum_merge_message_count: 1000, export_retention_minutes: 3 } })).status()).toBe(200);
  return () => admin.put("/api/admin/features", { data: original });
}
for (const width of [375, 768, 1440]) {
  test(`${width}px: stale feature settings cannot reopen sharing or overwrite another limit`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
    try {
      const dialog = await open(page, admin, baseURL!, width);
      const merge = dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ });
      await merge.fill("1200");
      expect((await admin.put("/api/admin/features", { data: { allow_share_links: false, export_retention_minutes: 8 } })).status()).toBe(200);
      const saved = page.waitForResponse(response => response.url().endsWith("/api/admin/features") && response.request().method() === "PUT");
      await dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ }).click();
      const response = await saved;
      expect(response.status()).toBe(409);
      expect(response.request().postDataJSON()).toEqual({ maximum_merge_message_count: 1200, base_revision: expect.any(String) });
      await shot(page, `feature-conflict-${width}`);
      const current = await (await admin.get("/api/admin/features")).json();
      expect(current.allow_share_links).toBe(false);
      expect(current.export_retention_minutes).toBe(8);
      await expect(merge).toHaveValue("1200");
      await dialog.getByRole("button", { name: /^(读取最新策略|Read latest policy)$/ }).click();
      await expect(dialog.getByRole("region", { name: /比较功能策略|Compare feature policy/ })).toBeVisible();
      await expect(dialog.getByRole("checkbox", { name: /^(允许创建分享链接|Allow new share links)$/ })).not.toBeChecked();
      await expect(merge).toHaveValue("1200");
      const saveButton = dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ });
      await expect(saveButton).toBeInViewport();
      await expect(dialog.getByRole("button", { name: /^(使用服务器策略|Use server policy)$/ })).toBeInViewport();
      await shot(page, `feature-compare-${width}`);
      await dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ }).click();
      await expect(dialog.getByRole("status")).toContainText(/功能策略已保存|Feature policy saved/);
      const final = await (await admin.get("/api/admin/features")).json();
      expect(final).toMatchObject({ allow_share_links: false, export_retention_minutes: 8, maximum_merge_message_count: 1200 });
      expect(await (await page.request.get("/api/auth/capabilities")).json()).toMatchObject({ allow_share_links: false, maximum_merge_message_count: 1200 });
    } finally { expect((await restore()).status()).toBe(200); await admin.dispose(); }
  });

  test(`${width}px: an acknowledged-but-lost save is checked without repeating the write`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
    let writes = 0;
    try {
      const dialog = await open(page, admin, baseURL!, width);
      await page.route("**/api/admin/features", async route => {
        if (route.request().method() !== "PUT") return route.continue();
        writes += 1; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed");
      });
      await dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ }).fill("1400");
      await dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      expect((await (await admin.get("/api/admin/features")).json()).maximum_merge_message_count).toBe(1400);
      await shot(page, `feature-unknown-${width}`);
      await dialog.getByRole("button", { name: /^(检查保存结果|Check save result)$/ }).click();
      await expect(dialog.getByRole("status")).toContainText(/当前策略与本次提交一致|Current policy matches your submitted changes/);
      expect(writes).toBe(1);
      await expect(dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ })).toBeDisabled();
      await shot(page, `feature-confirmed-${width}`);
    } finally { await page.unroute("**/api/admin/features"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
  });
}

test("375px: failed latest read preserves input; same-field comparison and a second conflict remain explicit", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
  try {
    const dialog = await open(page, admin, baseURL!, 375);
    const merge = dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ });
    const save = dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ });
    const latest = dialog.getByRole("button", { name: /^(读取最新策略|Read latest policy)$/ });
    await merge.fill("1200");
    expect((await admin.put("/api/admin/features", { data: { maximum_merge_message_count: 1300 } })).status()).toBe(200);
    await save.click(); await expect(latest).toBeVisible();
    await page.route("**/api/admin/features", route => route.request().method() === "GET" ? route.fulfill({ status: 503, json: { detail: "Synthetic read outage" } }) : route.continue());
    await latest.click();
    await expect(dialog.getByRole("alert")).toContainText(/读取失败|Read failed/);
    await expect(merge).toHaveValue("1200"); await expect(save).toBeDisabled();
    await shot(page, "feature-read-failure-375");
    await page.unroute("**/api/admin/features");
    await latest.click();
    const comparison = dialog.getByRole("region", { name: /比较功能策略|Compare feature policy/ });
    await expect(comparison).toContainText("1300"); await expect(comparison).toContainText("1200");
    expect(await comparison.evaluate(element => element.parentElement === document.activeElement)).toBe(true);
    expect((await admin.put("/api/admin/features", { data: { maximum_merge_message_count: 1500 } })).status()).toBe(200);
    await save.click(); await expect(latest).toBeVisible();
    expect((await (await admin.get("/api/admin/features")).json()).maximum_merge_message_count).toBe(1500);
    await latest.focus(); await page.keyboard.press("Enter");
    await expect(comparison).toContainText("1500"); await expect(merge).toHaveValue("1200");
    await shot(page, "feature-second-conflict-375");
    await dialog.getByRole("button", { name: /^(使用服务器策略|Use server policy)$/ }).click();
    await expect(merge).toHaveValue("1500"); await expect(save).toBeDisabled();
    await expect(comparison).not.toBeVisible();
  } finally { await page.unroute("**/api/admin/features"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
});

test("768px: a save that never reached the server retains the draft until an explicit save", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
  let writes = 0;
  try {
    const dialog = await open(page, admin, baseURL!, 768);
    await page.route("**/api/admin/features", async route => {
      if (route.request().method() !== "PUT") return route.continue();
      writes += 1;
      if (writes === 1) return route.abort("failed");
      return route.continue();
    });
    const merge = dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ });
    const save = dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ });
    await merge.fill("1400"); await save.click();
    await dialog.getByRole("button", { name: /^(检查保存结果|Check save result)$/ }).click();
    const comparison = dialog.getByRole("region", { name: /比较功能策略|Compare feature policy/ });
    await expect(comparison).toContainText("1000"); await expect(comparison).toContainText("1400");
    await expect(merge).toHaveValue("1400");
    expect(writes).toBe(1);
    expect((await (await admin.get("/api/admin/features")).json()).maximum_merge_message_count).toBe(1000);
    await shot(page, "feature-not-saved-768");
    await save.focus(); await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toContainText("Feature policy saved");
    expect(writes).toBe(2);
    expect((await (await admin.get("/api/admin/features")).json()).maximum_merge_message_count).toBe(1400);
  } finally { await page.unroute("**/api/admin/features"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
});

for (const method of ["GET", "PUT"] as const) {
  test(`1440px: stalled ${method} reaches its real deadline and can recover`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    try {
      if (method === "GET") await page.route("**/api/admin/features", async route => { started = Date.now(); await held; await route.abort("failed").catch(() => {}); });
      const dialog = await open(page, admin, baseURL!, 1440);
      if (method === "PUT") {
        await page.route("**/api/admin/features", async route => {
          if (route.request().method() !== "PUT") return route.continue();
          started = Date.now(); await held; await route.abort("failed").catch(() => {});
        });
        await dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ }).fill("1400");
        await dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ }).click();
      }
      await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 24_000 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(19_000);
      expect(Date.now() - started).toBeLessThan(25_000);
      await shot(page, `feature-timeout-${method.toLowerCase()}-1440`);
      release(); await page.unroute("**/api/admin/features");
      if (method === "GET") {
        await dialog.getByRole("button", { name: /^(重试|Retry)$/ }).click();
        await expect(dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ })).toHaveValue("1000");
      } else {
        await dialog.getByRole("button", { name: /^(检查保存结果|Check save result)$/ }).click();
        await expect(dialog.getByRole("region", { name: /比较功能策略|Compare feature policy/ })).toContainText("1000");
        await expect(dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ })).toHaveValue("1400");
        expect((await (await admin.get("/api/admin/features")).json()).maximum_merge_message_count).toBe(1000);
      }
    } finally { release(); await page.unroute("**/api/admin/features"); expect((await restore()).status()).toBe(200); await admin.dispose(); }
  });
}

test("375px: another window already saved the same values, so reading resolves without a redundant save", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!); const restore = await fixture(admin);
  try {
    const dialog = await open(page, admin, baseURL!, 375);
    await dialog.getByRole("spinbutton", { name: /合并消息上限|Merge message limit/ }).fill("1200");
    expect((await admin.put("/api/admin/features", { data: { maximum_merge_message_count: 1200 } })).status()).toBe(200);
    const save = dialog.getByRole("button", { name: /^(保存功能策略|Save feature policy)$/ });
    await save.click();
    await dialog.getByRole("button", { name: /^(读取最新策略|Read latest policy)$/ }).click();
    await expect(dialog.getByRole("status")).toContainText(/当前策略与本次提交一致|Current policy matches your submitted changes/);
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole("region", { name: /比较功能策略|Compare feature policy/ })).not.toBeVisible();
    expect((await (await admin.get("/api/admin/features")).json()).maximum_merge_message_count).toBe(1200);
    await shot(page, "feature-already-matches-375");
  } finally { expect((await restore()).status()).toBe(200); await admin.dispose(); }
});
