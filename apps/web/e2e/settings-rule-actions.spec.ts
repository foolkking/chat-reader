import { expect, test, type APIRequest, type Browser } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number, twoVersions = false) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const headers = { Origin: baseURL }, password = "synthetic rule actions passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `rule-actions-${crypto.randomUUID()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const created = await context.request.post(`${baseURL}/api/content-cleanup/rules`, { headers,
    data: { name: "Synthetic personal rule", match_value: `SYNTHETIC_${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201); const rule = await created.json();
  let latest = rule;
  if (twoVersions) {
    const revised = await context.request.patch(`${baseURL}/api/content-cleanup/rules/${rule.id}`, { headers,
      data: { match_value: `SYNTHETIC_NEW_${crypto.randomUUID()}`, role_filter: "assistant", boundary_mode: "WHOLE_LINE" } });
    expect(revised.status()).toBe(200); latest = await revised.json();
  }
  const page = await context.newPage(); await page.goto(baseURL);
  const open = async () => {
    if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
    await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
    await page.getByRole("region", { name: /设置|Settings/, exact: true }).and(page.locator("div"))
      .getByRole("button", { name: /噪声规则库|Noise rule library/ }).click();
  };
  await open();
  const panel = page.getByRole("dialog", { name: /噪声规则库|Noise rule library/, exact: true });
  const row = panel.locator(`[data-rule-id="${rule.id}"]`);
  await expect(row).toBeVisible();
  const expand = () => row.getByRole("button", { name: /Synthetic personal rule/ }).click();
  const rules = async () => await (await context.request.get(`${baseURL}/api/content-cleanup/rules`)).json() as { id: string; status: string; revision_id: string }[];
  return { admin, context, page, panel, row, rule, latest, headers, expand, open, rules, url: `${baseURL}/api/content-cleanup/rules/${rule.id}` };
}

for (const action of ["switch", "remove"] as const) test(`375px: confirmed ${action} does not wait for list refresh`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    if (action === "remove") await f.expand();
    await f.page.route("**/api/content-cleanup/rules", async route => { await held; await route.continue().catch(() => {}); });
    if (action === "switch") {
      await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
      await expect.poll(async () => (await f.rules()).find(r => r.id === f.rule.id)?.status).toBe("DISABLED");
    } else {
      await f.row.getByRole("button", { name: /删除规则|Delete rule/, exact: true }).click();
      await f.page.getByRole("button", { name: /确认删除|Confirm delete/, exact: true }).click();
      await expect.poll(async () => (await f.rules()).some(r => r.id === f.rule.id)).toBe(false);
    }
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/confirmed-${action}-375.png` });
    if (action === "switch") await expect(f.row.getByRole("button", { name: /个人启用|Enable for me/ })).toBeEnabled({ timeout: 3_000 });
    else {
      await expect(f.row).toHaveCount(0, { timeout: 3_000 }); await expect(f.panel.getByRole("status")).toContainText(/已移除|removed/);
      await expect(f.panel.locator("[data-rule-id]").first().getByRole("button").first()).toBeFocused();
    }
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) for (const action of ["switch", "version"] as const) test(`${width}px: lost ${action} response is checked without another write`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width, action === "version");
  let writes = 0;
  try {
    if (action === "version") await f.expand();
    await f.page.route(`**/api/content-cleanup/rules/${f.rule.id}`, async route => {
      writes++; const accepted = await route.fetch(); expect(accepted.status()).toBe(200);
      await route.fulfill({ status: 503, json: { detail: "Synthetic lost rule action response" } });
    });
    if (action === "switch") await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    else {
      await f.row.getByRole("button", { name: /使用此版本|Use this version/, exact: true }).click();
      await f.page.getByRole("dialog", { name: /使用版本|Use version/ }).getByRole("button", { name: /使用此版本|Use this version/ }).click();
    }
    const check = f.row.getByRole("button", { name: /检查操作结果|Check action result/ });
    await expect(check).toBeVisible();
    await expect(f.row.getByRole("button", { name: /个人停用|Disable for me/ })).toBeDisabled();
    await f.page.route("**/api/content-cleanup/rules", route => route.fulfill({ status: 503, json: { detail: "Synthetic lookup unavailable" } }));
    await check.click(); await expect(f.row.getByRole("alert")).toContainText(/核对失败|Check failed/);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/unknown-${action}-${width}.png` });
    await f.page.unroute("**/api/content-cleanup/rules");
    await check.click();
    await expect(check).toHaveCount(0); expect(writes).toBe(1);
    const saved = (await f.rules()).find(r => r.id === f.rule.id)!;
    if (action === "switch") { expect(saved.status).toBe("DISABLED"); await expect(f.row.getByRole("button", { name: /个人启用|Enable for me/ })).toBeEnabled(); }
    else { expect(saved.revision_id).toBe(f.rule.revision_id); await expect(f.row.getByRole("status").filter({ hasText: /后续扫描使用版本 1|Future scans use version 1/ })).toBeVisible(); }
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/recovered-${action}-${width}.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: deletion result can be checked after response loss", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768); let writes = 0;
  try {
    await f.expand();
    await f.page.route(`**/api/content-cleanup/rules/${f.rule.id}`, async route => { writes++; const response = await route.fetch(); expect(response.status()).toBe(204); await route.abort("failed"); });
    await f.row.getByRole("button", { name: /删除规则|Delete rule/, exact: true }).click();
    await f.page.getByRole("button", { name: /确认删除|Confirm delete/, exact: true }).click();
    await expect(f.row.getByRole("button", { name: /检查操作结果|Check action result/ })).toBeVisible();
    expect((await f.rules()).some(r => r.id === f.rule.id)).toBe(false);
    await f.row.getByRole("button", { name: /检查操作结果|Check action result/ }).click();
    await expect(f.row).toHaveCount(0); expect(writes).toBe(1);
    await expect(f.panel.getByRole("status")).toContainText(/已移除|removed/);
    await expect(f.panel.locator("[data-rule-id]").first().getByRole("button").first()).toBeFocused();
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/removed-768.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: an undelivered switch reads current state before a deliberate retry", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440); let writes = 0;
  try {
    await f.page.route(`**/api/content-cleanup/rules/${f.rule.id}`, async route => { writes++; if (writes === 1) await route.abort("failed"); else await route.continue(); });
    await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    await f.row.getByRole("button", { name: /检查操作结果|Check action result/ }).click();
    expect(writes).toBe(1); expect((await f.rules()).find(r => r.id === f.rule.id)?.status).toBe("ACTIVE");
    await expect(f.row.getByRole("status")).toContainText(/尚未满足|do not match/);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/unsent-1440.png` });
    await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    await expect(f.row.getByRole("button", { name: /个人启用|Enable for me/ })).toBeEnabled();
    expect(writes).toBe(2); expect((await f.rules()).find(r => r.id === f.rule.id)?.status).toBe("DISABLED");
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: failed version refresh cannot select cached versions and can recover", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768, true);
  try {
    await f.expand(); await expect(f.row.getByRole("button", { name: /使用此版本|Use this version/, exact: true })).toBeEnabled();
    await f.expand();
    await f.page.route("**/revisions?*", route => route.fulfill({ status: 503, json: { detail: "Synthetic history unavailable" } }));
    await f.expand();
    await expect(f.row.getByRole("alert")).toContainText(/版本读取失败|Versions could not load/);
    await expect(f.row.getByRole("button", { name: /使用此版本|Use this version/, exact: true })).toBeDisabled();
    await expect(f.row.getByText(/assistant · Exact · Whole line/)).toBeVisible();
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/history-unavailable-768.png` });
    await f.page.unroute("**/revisions?*");
    await f.row.getByRole("button", { name: /重试读取版本|Retry loading versions/ }).click();
    await expect(f.row.getByRole("button", { name: /使用此版本|Use this version/, exact: true })).toBeEnabled();
    await f.row.getByRole("button", { name: /使用此版本|Use this version/, exact: true }).click();
    await f.page.getByRole("dialog", { name: /使用版本|Use version/ }).getByRole("button", { name: /使用此版本|Use this version/ }).click();
    await expect.poll(async () => (await f.rules()).find(r => r.id === f.rule.id)?.revision_id).toBe(f.rule.revision_id);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/history-recovered-768.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: unavailable rule is removed after a fresh state check", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  try {
    expect((await f.context.request.delete(f.url, { headers: f.headers })).status()).toBe(204);
    await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    await f.row.getByRole("button", { name: /检查操作结果|Check action result/ }).click();
    await expect(f.row).toHaveCount(0);
    await expect(f.panel.getByRole("status")).toContainText(/已不可用|no longer available/);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: a stalled switch reaches the deadline and can check the result", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route(`**/api/content-cleanup/rules/${f.rule.id}`, async route => { await held; await route.abort().catch(() => {}); });
    await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    await expect(f.row.getByRole("button", { name: /检查操作结果|Check action result/ })).toBeVisible({ timeout: 25_000 });
    release();
    await f.row.getByRole("button", { name: /检查操作结果|Check action result/ }).click();
    await expect(f.row.getByRole("button", { name: /个人停用|Disable for me/ })).toBeEnabled();
    expect((await f.rules()).find(r => r.id === f.rule.id)?.status).toBe("ACTIVE");
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

test("1440px: selected versions and switches affect only new scans", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440, true);
  try {
    const source = `Retained source\n\n${f.rule.match_value}\n\n${f.latest.match_value}`;
    const created = await f.context.request.post(`${baseURL}/api/conversations`, { headers: f.headers, data: {
      title: "Synthetic rule scan versions", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
    } });
    expect(created.status()).toBe(201); const conversation = await created.json();
    const scan = async () => {
      const response = await f.context.request.post(`${baseURL}/api/content-cleanup/rules/scan-existing`, { headers: { ...f.headers, "Idempotency-Key": crypto.randomUUID() } });
      expect(response.status()).toBe(202); const id = (await response.json()).id;
      await expect.poll(async () => (await (await f.context.request.get(`${baseURL}/api/content-cleanup/scans/${id}`)).json()).status).toBe("READY");
      return id as string;
    };
    const occurrences = async (id: string) => (await (await f.context.request.get(`${baseURL}/api/content-cleanup/scans/${id}/occurrences`)).json()) as { match_text: string; decision: string }[];
    const first = await scan(), oldMatches = await occurrences(first);
    expect(oldMatches.map(item => item.match_text)).toEqual([f.latest.match_value]);
    await f.expand();
    await f.row.getByRole("button", { name: /使用此版本|Use this version/, exact: true }).click();
    await f.page.getByRole("dialog", { name: /使用版本|Use version/ }).getByRole("button", { name: /使用此版本|Use this version/ }).click();
    await expect.poll(async () => (await f.rules()).find(r => r.id === f.rule.id)?.revision_id).toBe(f.rule.revision_id);
    const second = await scan();
    expect((await occurrences(second)).map(item => item.match_text)).toEqual([f.rule.match_value]);
    expect(await occurrences(first)).toEqual(oldMatches);
    await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    await expect(f.row.getByRole("button", { name: /个人启用|Enable for me/ })).toBeEnabled();
    expect(await occurrences(await scan())).toEqual([]);
    await f.row.getByRole("button", { name: /删除规则|Delete rule/, exact: true }).click();
    await f.page.getByRole("button", { name: /确认删除|Confirm delete/, exact: true }).click();
    await expect(f.row).toHaveCount(0); expect(await occurrences(first)).toEqual(oldMatches);
    expect((await occurrences(second))[0].decision).toBe("KEEP");
    const message = await (await f.context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json();
    expect(message.current_version.display_text).toBe(source);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: confirmed state stays visible when refreshing the rule list fails", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  try {
    await f.page.route("**/api/content-cleanup/rules", route => route.fulfill({ status: 503, json: { detail: "Synthetic refresh unavailable" } }));
    await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    await expect(f.row.getByRole("status")).toContainText(/已停用|disabled/);
    await expect(f.panel.getByRole("alert")).toContainText(/规则读取失败|Rules could not load/);
    await expect(f.row.getByRole("button", { name: /个人启用|Enable for me/ })).toBeDisabled();
    expect((await f.rules()).find(r => r.id === f.rule.id)?.status).toBe("DISABLED");
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.panel.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/saved-refresh-failed-375.png` });
    await f.page.unroute("**/api/content-cleanup/rules");
    await f.panel.getByRole("button", { name: /重试读取规则|Retry loading rules/ }).click();
    await expect(f.row.getByRole("button", { name: /个人启用|Enable for me/ })).toBeEnabled();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: reopening after response loss reads actual settings without replaying the action", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375); let writes = 0;
  try {
    await f.page.route(`**/api/content-cleanup/rules/${f.rule.id}`, async route => { writes++; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); });
    await f.row.getByRole("button", { name: /个人停用|Disable for me/ }).click();
    await expect(f.row.getByRole("button", { name: /检查操作结果|Check action result/ })).toBeVisible();
    await f.page.reload(); await f.open();
    await expect(f.row.getByRole("button", { name: /个人启用|Enable for me/ })).toBeEnabled();
    expect(writes).toBe(1); expect((await f.rules()).find(r => r.id === f.rule.id)?.status).toBe("DISABLED");
  } finally { await f.context.close(); await f.admin.dispose(); }
});
