import { expect, test, type APIRequest, type Browser } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number, count = 1) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const headers = { Origin: baseURL }, password = "synthetic exception recovery passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `exception-recovery-${Date.now()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const source = (index: number) => `Synthetic scope ${index}: \ue200cite\ue202turn12search4\ue201 remains unchanged.`;
  const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
    title: "Synthetic exception recovery", messages: [
      { role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: Array.from({ length: count }, (_, index) => source(index)).join("\n\n") },
    ],
  } });
  expect(created.status()).toBe(201);
  const conversation = await created.json();
  const response = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers, data: {
    source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.conversation.id],
  } });
  expect(response.status()).toBe(202);
  const scanId = (await response.json()).id;
  const scan = async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}`)).json());
  await expect.poll(async () => (await scan()).status).toBe("READY");
  const hits = await (await context.request.get(`${baseURL}/api/content-cleanup/scans/${scanId}/occurrences`)).json();
  expect(hits).toHaveLength(count);
  const path = (index = 0) => `/api/content-cleanup/scans/${scanId}/occurrences/${hits[index].id}/exception`;
  const exceptions = async () => (await (await context.request.get(`${baseURL}/api/content-cleanup/exceptions?limit=100`)).json());
  const save = async (index: number) => {
    const preview = await (await context.request.get(`${baseURL}${path(index)}`)).json();
    expect((await context.request.post(`${baseURL}${path(index)}`, { headers, data: { confirmed: true, preview_token: preview.preview_token } })).status()).toBe(201);
  };
  const page = await context.newPage();
  const dialog = page.getByTestId("content-cleanup-dialog");
  const editor = dialog.getByRole("region", { name: /个人忽略例外|Personal exception/ });
  const open = async () => { await page.goto(baseURL); await openSettingsNoiseReview(page, scanId); };
  const edit = async () => {
    if (width < 1024 && !await dialog.getByRole("button", { name: /返回分组|Back to groups/ }).isVisible()) await dialog.getByRole("button", { name: /全部候选|All candidates/, exact: true }).click();
    const details = dialog.getByRole("button", { name: /上下文与规则|Context and rules/ }).first();
    if (await details.getAttribute("aria-expanded") !== "true") await details.click();
    await dialog.getByRole("button", { name: /以后忽略这种情况|Ignore this case in future/ }).first().click();
    await expect(editor).toBeVisible();
  };
  return { admin, context, headers, page, dialog, editor, scan, hits, path, exceptions, save, open, edit, conversation, source };
}

test("375px: failed scope refresh cannot confirm cached scope", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  try {
    await f.open(); await f.edit();
    await expect(f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ })).toBeEnabled();
    await f.editor.getByRole("button", { name: /取消|Cancel/, exact: true }).click();
    await f.page.route(`**${f.path()}`, route => route.fulfill({ status: 503, json: { detail: "Synthetic unavailable scope" } }));
    await f.edit();
    await expect(f.editor.getByRole("alert")).toBeVisible();
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/stale-scope-375.png` });
    await expect(f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ })).toBeDisabled({ timeout: 3000 });
    expect((await f.exceptions()).total).toBe(0);
    await f.page.unroute(`**${f.path()}`);
    await f.editor.getByRole("button", { name: /重新读取范围|Reload scope/ }).click();
    await expect(f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ })).toBeEnabled();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: committed last-page revoke returns before background read", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, playwright.request, baseURL!, 768, 21);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    for (let index = 0; index < 21; index++) await f.save(index);
    await f.open(); await f.dialog.getByRole("button", { name: /^规则库$|^Rules$/ }).click();
    const list = f.dialog.locator("section").filter({ has: f.page.getByRole("heading", { name: /我的忽略例外|My exceptions/, exact: true }) }).last();
    await list.getByRole("button", { name: /^下一页$|^Next$/ }).click();
    await expect(list.getByRole("button", { name: /撤销此例外|Revoke exception/ })).toHaveCount(1);
    await f.page.route("**/api/content-cleanup/exceptions?*", async route => { await held; await route.continue().catch(() => {}); });
    await list.getByRole("button", { name: /撤销此例外|Revoke exception/ }).click();
    await expect.poll(async () => (await f.exceptions()).total).toBe(20);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/revoke-pending-768.png` });
    await expect(list.getByRole("status").filter({ hasText: /例外已撤销|Exception revoked/ })).toBeVisible({ timeout: 3000 });
    await expect(list.getByRole("button", { name: /撤销此例外|Revoke exception/ })).toHaveCount(20, { timeout: 3000 });
    release();
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) test(`${width}px: lost save response is checked without replay and selection stays kept`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width);
  let writes = 0;
  try {
    await f.open(); await f.edit();
    await f.editor.getByRole("button", { name: /取消|Cancel/, exact: true }).click();
    await expect(f.dialog.getByRole("button", { name: /上下文与规则|Context and rules/ })).toHaveAttribute("aria-expanded", "true");
    await expect(f.dialog.getByRole("button", { name: /以后忽略这种情况|Ignore this case in future/ })).toBeFocused();
    await f.dialog.getByRole("checkbox", { name: /处理|Process/ }).check();
    await expect.poll(async () => (await f.scan()).delete_count).toBe(1);
    await f.edit();
    await f.page.route(`**${f.path()}`, async route => {
      if (route.request().method() === "POST") { writes++; const committed = await route.fetch(); expect(committed.status()).toBe(201); await route.abort("failed"); }
      else await route.continue();
    });
    await f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ }).click();
    await expect(f.editor.getByRole("button", { name: /检查保存结果|Check save result/ })).toBeVisible();
    await expect(f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ })).toBeDisabled();
    expect((await f.exceptions()).total).toBe(1); expect((await f.scan()).delete_count).toBe(0);
    await f.page.route(`**${f.path()}`, route => route.fulfill({ status: 503, json: { detail: "Synthetic check unavailable" } }));
    await f.editor.getByRole("button", { name: /检查保存结果|Check save result/ }).click();
    await expect(f.editor.getByRole("alert")).toContainText(/读取失败|Read failed/);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/check-save-failure-${width}.png` });
    await f.page.unroute(`**${f.path()}`);
    await f.page.route("**/api/content-cleanup/scans/*/review?*", route => route.fulfill({ status: 503, json: { detail: "Synthetic candidate read failure" } }));
    await f.editor.getByRole("button", { name: /检查保存结果|Check save result/ }).click();
    await expect(f.editor).not.toBeVisible();
    await expect(f.dialog.getByRole("status").filter({ hasText: /个人例外已保存|Personal exception saved/ })).toBeVisible();
    await expect(f.dialog.getByRole("checkbox", { name: /处理|Process/ })).not.toBeChecked();
    await expect(f.dialog.getByRole("button", { name: /预览 0 项清理|Preview 0 removals/ })).toBeDisabled();
    expect(writes).toBe(1);
    expect((await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json()).current_version.display_text).toBe(f.source(0));
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/saved-selection-${width}.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 1440]) test(`${width}px: undelivered save requires fresh scope and deliberate confirmation`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width);
  try {
    await f.open(); await f.edit();
    await f.page.route(`**${f.path()}`, async route => route.request().method() === "POST" ? route.abort("failed") : route.continue());
    await f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ }).click();
    await f.editor.getByRole("button", { name: /检查保存结果|Check save result/ }).click();
    await expect(f.editor.getByRole("status")).toContainText(/尚未满足|does not match/);
    expect((await f.exceptions()).total).toBe(0);
    await f.page.unroute(`**${f.path()}`);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/confirm-again-${width}.png` });
    await f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ }).click();
    await expect(f.editor).not.toBeVisible();
    expect((await f.exceptions()).total).toBe(1);
    await expect(f.dialog.getByRole("button", { name: /以后忽略这种情况|Ignore this case in future/ })).toBeFocused();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: revoked response loss, read failure and repeated revoke preserve remaining exceptions", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440, 2);
  let writes = 0;
  try {
    await f.save(0); await f.save(1);
    await f.open(); await f.dialog.getByRole("button", { name: /^规则库$|^Rules$/ }).click();
    const list = f.dialog.getByRole("region", { name: /我的忽略例外|My exceptions/ });
    await expect(list.getByRole("button", { name: /撤销此例外|Revoke exception/ })).toHaveCount(2);
    await f.page.route("**/api/content-cleanup/exceptions/*", async route => {
      writes++; const response = await route.fetch(); expect(response.status()).toBe(204); await route.abort("failed");
    });
    await list.getByRole("button", { name: /撤销此例外|Revoke exception/ }).first().click();
    await expect(list.getByRole("button", { name: /重试撤销|Retry revocation/ })).toBeVisible();
    expect((await f.exceptions()).total).toBe(1);
    await f.page.route("**/api/content-cleanup/exceptions?*", route => route.fulfill({ status: 503, json: { detail: "Synthetic list unavailable" } }));
    await list.getByRole("button", { name: /刷新例外|Refresh exceptions/ }).click();
    await expect(list.getByRole("button", { name: /重试读取|Retry loading/ })).toBeVisible();
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/revoke-read-failure-1440.png` });
    await f.page.unroute("**/api/content-cleanup/exceptions?*");
    await list.getByRole("button", { name: /重试读取|Retry loading/ }).click();
    await expect(list.getByRole("button", { name: /撤销此例外|Revoke exception/ })).toHaveCount(1);
    await f.page.unroute("**/api/content-cleanup/exceptions/*");
    await list.getByRole("button", { name: /重试撤销|Retry revocation/ }).click();
    await expect(list.getByRole("status")).toContainText(/例外已撤销|Exception revoked/);
    await expect(list.getByRole("alert")).toHaveCount(0);
    await expect(list.getByRole("button", { name: /撤销此例外|Revoke exception/ })).toHaveCount(1);
    expect((await f.exceptions()).total).toBe(1); expect(writes).toBe(1);
    await expect.poll(() => list.evaluate(element => element.contains(document.activeElement))).toBe(true);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/revoke-recovered-1440.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: expired confirmation reloads scope before another save", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    await f.page.route(`**${f.path()}`, async route => {
      if (route.request().method() !== "GET") { await route.continue(); return; }
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), preview_token: "0".repeat(65) } });
    });
    await f.open(); await f.edit();
    await f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ }).click();
    await expect(f.editor.getByRole("alert")).toContainText(/确认已过期|confirmation expired/);
    await expect(f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ })).toBeDisabled();
    expect((await f.exceptions()).total).toBe(0);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/expired-confirmation-768.png` });
    await f.page.unroute(`**${f.path()}`);
    await f.editor.getByRole("button", { name: /重新读取范围|Reload scope/ }).click();
    await f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ }).click();
    await expect(f.editor).not.toBeVisible();
    expect((await f.exceptions()).total).toBe(1);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: scope reads stop waiting at the deadline and can retry", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route(`**${f.path()}`, async route => { await held; await route.abort().catch(() => {}); });
    await f.open(); await f.edit();
    await expect(f.editor.getByRole("alert")).toContainText(/读取失败|Read failed/, { timeout: 25_000 });
    await expect(f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ })).toBeDisabled();
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scope-timeout-375.png` });
    release(); await f.page.unroute(`**${f.path()}`);
    await f.editor.getByRole("button", { name: /重新读取范围|Reload scope/ }).click();
    await expect(f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ })).toBeEnabled();
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

test("1440px: saving an exception in selected-only view leaves other decisions intact", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440, 2);
  try {
    await f.open();
    await f.dialog.getByRole("button", { name: /选择全部匹配项|Select all matching/ }).click();
    await expect.poll(async () => (await f.scan()).delete_count).toBe(2);
    await f.dialog.getByRole("checkbox", { name: /只看已选项|Selected only/ }).check();
    await f.edit();
    await f.editor.getByRole("button", { name: /确认保存个人例外|Confirm personal exception/ }).click();
    await expect(f.editor).not.toBeVisible();
    await expect(f.dialog.getByRole("checkbox", { name: /处理|Process/ })).toHaveCount(1);
    await expect(f.dialog.getByRole("checkbox", { name: /处理|Process/ })).toBeChecked();
    expect((await f.scan()).delete_count).toBe(1);
    expect((await f.exceptions()).total).toBe(1);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/selected-only-1440.png` });
  } finally { await f.context.close(); await f.admin.dispose(); }
});
