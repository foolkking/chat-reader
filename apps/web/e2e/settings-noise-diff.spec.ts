import { expect, test, type Browser, type APIRequest } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

const marker = "\ue200cite\ue202turn12search4\ue201";
const padding = "Retained paragraph 👩🏽‍💻 é 中文.\n".repeat(55);
const source = `${padding}First ${marker} context.\n${padding}Second ${marker} context.\n${padding}Third ${marker} context.\nProtected: \`${marker}\``;
const expected = `${padding}First  context.\n${padding}Second  context.\n${padding}Third  context.\nProtected: \`${marker}\``;

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const password = "synthetic noise difference passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL }, data: {
    email: `noise-diff-${Date.now()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const created = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL }, data: {
    title: "Synthetic long noise preview", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
  } });
  expect(created.status()).toBe(201);
  const conversation = await created.json();
  const started = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers: { Origin: baseURL }, data: {
    source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.conversation.id],
  } });
  expect(started.status()).toBe(202);
  const scanId = (await started.json()).id, url = `${baseURL}/api/content-cleanup/scans/${scanId}`;
  await expect.poll(async () => (await (await context.request.get(url)).json()).status).toBe("READY");
  expect((await context.request.patch(`${url}/decisions/filter`, { headers: { Origin: baseURL }, data: { decision: "DELETE", all_matching: true } })).status()).toBe(200);
  const page = await context.newPage();
  await page.goto(baseURL); await openSettingsNoiseReview(page, scanId);
  const dialog = page.getByTestId("content-cleanup-dialog");
  await dialog.getByRole("button", { name: /预览 3 项清理|Preview 3 removals/ }).click();
  const preview = dialog.getByRole("region", { name: /清理差异预览|Cleanup change preview/ });
  await expect(preview.getByRole("button", { name: /确认处理 3 项选择|Confirm 3 selections/ })).toBeEnabled();
  return { admin, context, page, dialog, preview, conversation, url };
}

for (const width of [375, 768, 1440]) test(`${width}px: full preview identifies and locates exact removals`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, width);
  try {
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/diff-initial-${width}.png` });
    const removals = f.preview.locator("mark[data-cleanup-removal]");
    await expect(removals).toHaveCount(3, { timeout: 3_000 });
    for (const mark of await removals.all()) await expect(mark).toHaveText(marker);
    const before = f.preview.getByTestId("cleanup-diff-before"), after = f.preview.getByTestId("cleanup-diff-after");
    expect(await before.textContent()).toBe(source);
    expect(await after.textContent()).toBe(expected);
    const next = f.preview.getByRole("button", { name: /下一处删除|Next removal/ });
    await next.focus(); await f.page.keyboard.press("Enter");
    await expect(removals.first()).toHaveAttribute("data-active", "true");
    expect(await before.evaluate(el => el.scrollTop)).toBeGreaterThan(400);
    expect(await after.evaluate(el => el.scrollTop)).toBeGreaterThan(400);
    const firstScroll = await before.evaluate(el => el.scrollTop);
    await next.click();
    await expect(removals.nth(1)).toHaveAttribute("data-active", "true");
    expect(await before.evaluate(el => el.scrollTop)).toBeGreaterThan(firstScroll);
    await next.click(); await expect(next).toBeDisabled();
    await f.preview.getByRole("button", { name: /上一处删除|Previous removal/ }).click();
    await expect(removals.nth(1)).toHaveAttribute("data-active", "true");
    if (width === 375) {
      const boundary = await after.locator("span").nth(1).boundingBox();
      expect(boundary!.y).toBeGreaterThan(0);
      expect(boundary!.y + boundary!.height).toBeLessThan(790);
    }
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/diff-located-${width}.png` });
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const current = await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json();
    expect(current.current_version.display_text).toBe(source);
    await f.preview.getByRole("button", { name: /确认处理 3 项选择|Confirm 3 selections/ }).click();
    await expect(f.dialog).not.toBeVisible();
    const updated = await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json();
    expect(updated.current_version.display_text).toBe(expected);
    expect(updated.current_version.id).not.toBe(current.current_version.id);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

for (const mode of ["legacy", "mismatched", "malformed"] as const) test(`768px: ${mode} ranges keep truthful complete text without guessed markers`, async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    await f.preview.getByRole("button", { name: "Back to selection", exact: true }).click();
    await f.page.route("**/api/content-cleanup/scans/*/preview?*", async route => {
      const response = await route.fetch();
      const data = await response.json();
      if (mode === "legacy") delete data.items[0].removed_ranges;
      else if (mode === "malformed") data.items[0].removed_ranges = [null, null, null];
      else data.items[0].removed_ranges[0].start_offset += 1;
      await route.fulfill({ response, json: data });
    });
    await f.dialog.getByRole("button", { name: "Preview 3 removals", exact: true }).click();
    await expect(f.preview.getByRole("button", { name: "Confirm 3 selections", exact: true })).toBeEnabled();
    expect(await f.preview.getByTestId("cleanup-diff-before").textContent()).toBe(source);
    expect(await f.preview.getByTestId("cleanup-diff-after").textContent()).toBe(expected);
    await expect(f.preview.locator("mark[data-cleanup-removal]")).toHaveCount(0);
    await expect(f.preview.getByRole("button", { name: "Next removal", exact: true })).toHaveCount(0);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/diff-${mode}-768.png` });
    expect((await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json()).current_version.display_text).toBe(source);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: conflicting preview keeps source and does not mark proposed deletions", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  try {
    const messageURL = `${baseURL}/api/messages/${f.conversation.messages[1].id}`;
    const current = await (await f.context.request.get(messageURL)).json();
    const changed = "New source context.\n" + source;
    expect((await f.context.request.patch(messageURL, { headers: { Origin: baseURL! }, data: {
      content_markdown: changed, base_version_id: current.current_version.id, save_mode: "create_version",
    } })).status()).toBe(200);
    await f.preview.getByRole("button", { name: "返回选择", exact: true }).click();
    await f.dialog.getByRole("button", { name: "预览 3 项清理", exact: true }).click();
    await expect(f.preview.getByRole("alert")).toContainText("源版本变化");
    await expect(f.preview.locator("mark[data-cleanup-removal]")).toHaveCount(0);
    await expect(f.preview.getByRole("button", { name: "确认处理 3 项选择", exact: true })).toBeDisabled();
    expect(await f.preview.getByTestId("cleanup-diff-before").textContent()).toBe(source);
    expect(await f.preview.getByTestId("cleanup-diff-after").textContent()).toBe(source);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/diff-conflict-1440.png` });
    expect((await (await f.context.request.get(messageURL)).json()).current_version.display_text).toBe(changed);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: paged message previews keep exact removal markers on every page", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  try {
    for (let index = 0; index < 10; index++) {
      expect((await f.context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: {
        title: `Synthetic preview page ${index}`, messages: [{ role: "user", content_markdown: "Question" }, { role: "assistant", content_markdown: `Page ${index} 👩🏽‍💻 ${marker} retained.` }],
      } })).status()).toBe(201);
    }
    const started = await f.context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers: { Origin: baseURL! }, data: { source: "BATCH", scope_type: "ALL_ACTIVE", conversation_ids: [] } });
    expect(started.status()).toBe(202);
    const id = (await started.json()).id, url = `${baseURL}/api/content-cleanup/scans/${id}`;
    await expect.poll(async () => (await (await f.context.request.get(url)).json()).status).toBe("READY");
    expect((await f.context.request.patch(`${url}/decisions/filter`, { headers: { Origin: baseURL! }, data: { decision: "DELETE", all_matching: true } })).status()).toBe(200);
    await f.page.goto(baseURL!); await openSettingsNoiseReview(f.page, id);
    await f.dialog.getByRole("button", { name: "预览 13 项清理", exact: true }).click();
    const preview = f.dialog.getByRole("region", { name: "清理差异预览", exact: true });
    await expect(preview.locator("article")).toHaveCount(10);
    await preview.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(preview.locator("article")).toHaveCount(1);
    const expectedPage = await (await f.context.request.get(`${url}/preview?offset=10&limit=10`)).json();
    expect(await preview.getByTestId("cleanup-diff-before").textContent()).toBe(expectedPage.items[0].before);
    expect(await preview.getByTestId("cleanup-diff-after").textContent()).toBe(expectedPage.items[0].after);
    await expect(preview.locator("mark[data-cleanup-removal]")).toHaveCount(expectedPage.items[0].fragments);
    await preview.getByRole("button", { name: /^(定位删除片段|下一处删除)$/ }).click();
    await expect(preview.locator('mark[data-active="true"]')).toHaveCount(1);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await f.dialog.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/diff-pagination-1440.png` });
    await preview.getByRole("button", { name: "上一页", exact: true }).click();
    await expect(preview.locator("article")).toHaveCount(10);
    expect((await (await f.context.request.get(`${baseURL}/api/messages/${f.conversation.messages[1].id}`)).json()).current_version.display_text).toBe(source);
  } finally { await f.context.close(); await f.admin.dispose(); }
});
