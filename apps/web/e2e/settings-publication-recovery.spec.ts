import { expect, test, type APIRequest, type Browser } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number, published = false) {
  const admin = await settingsAdmin(request, baseURL), headers = { Origin: baseURL };
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width, height: 900 }, locale });
  await settingsAppearance(context.request, baseURL, locale);
  const created = await admin.post("/api/content-cleanup/rules", { headers, data: {
    name: "Synthetic personal source", match_value: `SYNTHETIC_PUBLIC_${crypto.randomUUID()}`, role_filter: "assistant", boundary_mode: "WHOLE_LINE",
  } });
  expect(created.status()).toBe(201); const rule = await created.json();
  const path = `/api/admin/noise-rules/${rule.id}`;
  if (published) expect((await admin.put(path + "/publication", { headers, data: { name: "Synthetic published", revision_id: rule.revision_id } })).status()).toBe(200);
  const page = await context.newPage(); await page.goto(baseURL);
  if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
  await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
  await page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"))
    .getByRole("button", { name: /系统噪声规则|System noise rules/ }).click();
  const panel = page.getByRole("dialog", { name: /系统噪声规则|System noise rules/, exact: true }), row = panel.getByRole("article").first();
  await row.getByRole("button").first().click();
  await expect(row.getByRole("radio").first()).toBeEnabled();
  const prepare = async () => { await row.getByLabel(/系统显示名称|System display name/).fill("Synthetic intended"); await row.getByRole("radio").first().check(); };
  const act = async (action: "publish" | "withdraw") => {
    await row.getByRole("button", { name: action === "publish" ? /发布所选版本|Publish selected version/ : /撤回系统提供|Withdraw publication/, exact: true }).click();
    await page.getByRole("dialog", { name: action === "publish" ? /发布此噪声规则版本|Publish this noise rule version/ : /撤回系统提供|Withdraw system availability/ })
      .getByRole("button", { name: action === "publish" ? /确认发布|^Publish$/ : /确认撤回|^Withdraw$/, exact: true }).click();
  };
  const read = async () => {
    const result = await admin.get("/api/admin/noise-rules?limit=100");
    return (await result.json()).items.find((r: { id: string }) => r.id === rule.id);
  };
  const shot = async (name: string) => { if (process.env.SETTINGS_SCREENSHOT_DIR) await panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}-${width}.png` }); };
  const close = async () => { await admin.delete(path + "/publication", { headers }); await context.close(); await admin.dispose(); };
  return { admin, context, page, panel, row, path, rule, prepare, act, read, shot, close, headers };
}

for (const action of ["publish", "withdraw"] as const) test(`375px: confirmed ${action} does not wait for list refresh`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375, action === "withdraw");
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    if (action === "publish") await f.prepare();
    await f.page.route("**/api/admin/noise-rules?*", async route => { await held; await route.continue().catch(() => {}); });
    await f.act(action);
    await expect.poll(async () => (await f.read()).published_revision_id).toBe(action === "publish" ? f.rule.revision_id : null);
    await f.shot(`confirmed-${action}`);
    await expect(f.row.getByRole("status").filter({ hasText: /系统提供状态已更新|Publication updated/ })).toBeVisible({ timeout: 3_000 });
    await expect(f.row.getByText(/正在保存|Saving/)).toHaveCount(0);
  } finally { release(); await f.close(); }
});

for (const width of [375, 768, 1440]) for (const action of ["publish", "withdraw"] as const) test(`${width}px: lost ${action} response is read without a second write`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width, action === "withdraw"); let writes = 0;
  try {
    if (action === "publish") await f.prepare();
    await f.page.route(`**${f.path}/publication*`, async route => {
      writes++; const result = await route.fetch(); expect(result.status()).toBe(200);
      await route.fulfill({ status: 503, json: { detail: "Synthetic lost publication response" } });
    });
    await f.act(action);
    const check = f.row.getByRole("button", { name: /检查当前发布|Check current publication/ });
    await expect(check).toBeVisible();
    await expect(f.row.getByRole("button", { name: /发布所选版本|Publish selected version/ })).toBeDisabled();
    await f.page.route(`**${f.path}`, route => route.fulfill({ status: 503, json: { detail: "Synthetic read unavailable" } }));
    await check.click(); await expect(f.row.getByRole("alert")).toContainText(/核对失败|Check failed/);
    await f.shot(`unknown-${action}`);
    await f.page.unroute(`**${f.path}`); await check.click();
    await expect(check).toHaveCount(0); expect(writes).toBe(1);
    await expect(f.row.getByRole("status").filter({ hasText: /已符合本次选择|matches your choice/ })).toBeVisible();
    expect((await f.read()).published_revision_id).toBe(action === "publish" ? f.rule.revision_id : null);
    await f.shot(`recovered-${action}`);
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.close(); }
});

for (const width of [375, 768, 1440]) for (const action of ["publish", "withdraw"] as const) test(`${width}px: stale ${action} retains choice and requires comparison and confirmation`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width, true); let writes = 0;
  try {
    if (action === "publish") await f.prepare();
    const next = await f.admin.patch(`/api/content-cleanup/rules/${f.rule.id}`, { headers: f.headers, data: { match_value: `SYNTHETIC_NEW_${crypto.randomUUID()}` } });
    expect(next.status()).toBe(200); const nextRule = await next.json();
    expect((await f.admin.put(f.path + "/publication", { headers: f.headers, data: { name: "Synthetic other window", revision_id: nextRule.revision_id } })).status()).toBe(200);
    await f.page.route(`**${f.path}/publication*`, async route => { writes++; await route.continue(); });
    await f.act(action);
    await expect(f.row.getByRole("alert")).toContainText(/其他窗口更新|Another window/);
    expect((await f.read()).name).toBe("Synthetic other window");
    await f.row.getByRole("button", { name: /检查当前发布|Check current publication/ }).click();
    const comparison = f.row.locator("[aria-label]").filter({ hasText: /当前状态与本次选择不同|current state differs/ }).first();
    await expect(comparison).toContainText("Synthetic other window"); await expect(comparison).toContainText("v2");
    await expect(f.row.getByRole("radio")).toHaveCount(2);
    await expect(f.row.getByText(nextRule.match_value, { exact: true })).toBeVisible();
    await expect(f.row.getByRole("button", { name: /发布所选版本|Publish selected version/ })).toBeDisabled();
    expect(writes).toBe(1);
    await f.shot(`compare-${action}`);
    const rebase = f.row.getByRole("button", { name: /保留选择，重新确认|Keep choice and reconfirm/ });
    await rebase.focus(); await rebase.press("Enter");
    await expect(f.row.getByLabel(/系统显示名称|System display name/)).toBeFocused();
    expect(writes).toBe(1);
    await f.act(action);
    await expect.poll(async () => (await f.read()).published_revision_id).toBe(action === "publish" ? f.rule.revision_id : null);
    await expect(f.row.getByRole("status").filter({ hasText: /系统提供状态已更新|Publication updated/ })).toBeVisible();
    expect(writes).toBe(2);
    await f.shot(`rebased-${action}`);
  } finally { await f.close(); }
});

test("768px: failed reopened history keeps readable context but cannot publish", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    await f.prepare();
    await expect(f.row.getByText(/assistant · Exact · Whole line/)).toBeVisible();
    await f.row.getByRole("button").first().click();
    await f.page.route(`**${f.path}/revisions?*`, route => route.fulfill({ status: 503, json: { detail: "Synthetic history unavailable" } }));
    await f.row.getByRole("button").first().click();
    await expect(f.row.getByRole("alert")).toContainText(/Versions could not load/);
    await expect(f.row.getByRole("radio").first()).toBeDisabled();
    await expect(f.row.getByRole("button", { name: "Publish selected version" })).toBeDisabled();
    await f.shot("history-unavailable");
    await f.page.unroute(`**${f.path}/revisions?*`);
    await f.row.getByRole("button", { name: "Retry loading versions" }).click();
    await expect(f.row.getByRole("button", { name: "Publish selected version" })).toBeEnabled();
    await f.act("publish");
    await expect.poll(async () => (await f.read()).name).toBe("Synthetic intended");
    await f.shot("history-recovered");
  } finally { await f.close(); }
});

test("375px: a stalled publication reaches its deadline and can retry only after reading", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375); let writes = 0;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.prepare();
    await f.page.route(`**${f.path}/publication*`, async route => { writes++; if (writes === 1) { await held; await route.abort().catch(() => {}); } else await route.continue(); });
    await f.act("publish");
    const check = f.row.getByRole("button", { name: /检查当前发布/ });
    await expect(check).toBeVisible({ timeout: 25_000 }); release();
    await check.click(); expect(writes).toBe(1); expect((await f.read()).published_revision_id).toBeNull();
    await f.shot("unsent-compare");
    await f.row.getByRole("button", { name: /保留选择，重新确认/ }).click();
    await f.act("publish");
    await expect.poll(async () => (await f.read()).name).toBe("Synthetic intended"); expect(writes).toBe(2);
  } finally { release(); await f.close(); }
});

test("1440px: choosing server publication discards only the unsaved draft", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440, true);
  try {
    await f.prepare();
    await f.admin.put(f.path + "/publication", { headers: f.headers, data: { name: "Synthetic server retained", revision_id: f.rule.revision_id } });
    await f.act("publish");
    await f.row.getByRole("button", { name: /检查当前发布/ }).click();
    await f.row.getByRole("button", { name: /使用当前系统状态/ }).click();
    await expect(f.row.getByRole("button").first()).toBeFocused();
    await expect(f.row.getByLabel(/系统显示名称/)).toHaveValue("Synthetic server retained");
    expect((await f.read()).name).toBe("Synthetic server retained");
    await f.shot("discard-draft");
  } finally { await f.close(); }
});

test("768px: successful publication survives failed list refresh and allows read-only retry", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    await f.prepare();
    await f.page.route("**/api/admin/noise-rules?*", route => route.fulfill({ status: 503, json: { detail: "Synthetic list unavailable" } }));
    await f.act("publish");
    await expect(f.row.getByRole("status").filter({ hasText: "Publication updated" })).toBeVisible();
    await expect(f.panel.getByRole("alert")).toContainText("Rules could not load");
    await expect(f.row.getByRole("button", { name: "Withdraw publication" })).toBeDisabled();
    expect((await f.read()).name).toBe("Synthetic intended");
    await f.shot("list-unavailable");
    await f.page.unroute("**/api/admin/noise-rules?*");
    await f.panel.getByRole("button", { name: "Retry loading rules" }).click();
    await expect(f.row.getByRole("button", { name: "Withdraw publication" })).toBeEnabled();
    await f.shot("list-recovered");
  } finally { await f.close(); }
});
