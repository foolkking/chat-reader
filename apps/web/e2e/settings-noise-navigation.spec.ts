import { expect, test, type Browser, type APIRequest, type Page } from "@playwright/test";
import { openSettingsNoiseReview, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

const marker = "\ue200cite\ue202turn12search4\ue201";
async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number, count = 2) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const password = "synthetic noise navigation passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL }, data: {
    email: `noise-navigation-${Date.now()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const conversations = [];
  for (let i = 0; i < count; i++) {
    const title = i === count - 1 ? "Synthetic Zzz target" : `Synthetic Alpha ${String(i).padStart(3, "0")}`;
    const source = i === 0 && count === 2 ? (`Before ${marker} after.\n\n`).repeat(51) + "Before Cite turn22search1 after." : `Before ${marker} after.`;
    const created = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL }, data: {
      title, messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
    } });
    expect(created.status()).toBe(201);
    conversations.push({ ...await created.json(), source, title });
  }
  const started = await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers: { Origin: baseURL }, data: {
    source: "BATCH", scope_type: "ALL_ACTIVE", conversation_ids: [],
  } });
  expect(started.status()).toBe(202);
  const scanId = (await started.json()).id, url = `${baseURL}/api/content-cleanup/scans/${scanId}`;
  const scan = async () => (await (await context.request.get(url)).json());
  await expect.poll(async () => (await scan()).status).toBe("READY");
  const page = await context.newPage();
  await page.goto(baseURL); await openSettingsNoiseReview(page, scanId);
  return { admin, context, page, dialog: page.getByTestId("content-cleanup-dialog"), scan, url, scanId, conversations };
}
async function shot(page: Page, name: string) {
  const path = process.env.SETTINGS_SCREENSHOT_DIR ? `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` : test.info().outputPath(`${name}.png`);
  await page.getByTestId("content-cleanup-dialog").screenshot({ path });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("1440px: rule-library global scan excludes archives and opens grouped review", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  try {
    const created = await f.context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: {
      title: "Synthetic archived noise", messages: [{ role: "user", content_markdown: "Question" }, { role: "assistant", content_markdown: `Archived ${marker} retained.` }],
    } });
    expect(created.status()).toBe(201);
    const archived = await created.json();
    expect((await f.context.request.patch(`${baseURL}/api/conversations/${archived.conversation.id}`, { headers: { Origin: baseURL! }, data: { status: "archived" } })).status()).toBe(200);
    await f.dialog.getByRole("button", { name: "规则库", exact: true }).click();
    // A new explicit global request rechecks current rules and exceptions,
    // while retaining the earlier review's pinned source and choices.
    await f.dialog.getByRole("button", { name: "扫描现有对话", exact: true }).click();
    const confirmation = f.page.getByRole("dialog", { name: "扫描现有对话？", exact: true });
    const queued = f.page.waitForResponse(response => response.url().endsWith("/rules/scan-existing") && response.request().method() === "POST");
    await confirmation.getByRole("button", { name: "开始后台扫描", exact: true }).click();
    const response = await queued;
    expect(response.status()).toBe(202);
    const scan = await response.json();
    expect(scan.target_count).toBe(2); expect(scan.excluded_archived_count).toBe(1);
    await f.page.goto(baseURL!);
    await openSettingsNoiseReview(f.page, scan.id);
    const review = f.page.getByTestId("content-cleanup-dialog");
    await expect(review.getByRole("region", { name: "当前审查范围", exact: true })).toContainText("53 个候选");
    await review.getByRole("searchbox", { name: "查找对话", exact: true }).fill("archived");
    await expect(review.getByText(/未找到相关对话/)).toBeVisible();
    await shot(f.page, "global-archives-1440");
    const message = await (await f.context.request.get(`${baseURL}/api/messages/${archived.messages[1].id}`)).json();
    expect(message.current_version.display_text).toBe(`Archived ${marker} retained.`);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) {
  test(`${width}px: scope remains explicit and one conversation can span all rules`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    try {
      await f.dialog.getByRole("button").filter({ hasText: "Synthetic Alpha 000" }).first().click();
      await expect(f.dialog.locator("article").first()).toBeVisible();
      await shot(f.page, `scope-before-${width}`);
      const scope = f.dialog.getByRole("region", { name: /当前审查范围|Current review scope/ });
      await expect(scope).toContainText("Synthetic Alpha 000", { timeout: 3_000 });
      await scope.getByRole("button", { name: /此对话的全部规则|All rules in this conversation/ }).click();
      await expect(scope).toContainText(/52 个候选|52 candidates/);
      await f.dialog.getByRole("button", { name: /选择全部匹配项|Select all matching/ }).click();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(52);
      const selected = await (await f.context.request.get(`${f.url}/occurrences?selected_only=true&limit=100`)).json();
      expect(selected).toHaveLength(52);
      expect(new Set(selected.map((item: { conversation_id: string }) => item.conversation_id))).toEqual(new Set([f.conversations[0].conversation.id]));
      await shot(f.page, `scope-selected-${width}`);
      if (width === 375) {
        await f.page.setViewportSize({ width, height: 420 });
        await expect(f.dialog.getByRole("heading", { name: "清理噪声", exact: true })).toBeVisible();
        await f.dialog.getByRole("button", { name: "预览 52 项清理", exact: true }).scrollIntoViewIfNeeded();
        await shot(f.page, "scope-short-375");
      }
      await f.dialog.getByRole("button", { name: /预览 52 项清理|Preview 52 removals/ }).click();
      await expect(f.dialog.getByText(/1 个对话 · 1 条消息 · 52 个已选片段|1 conversations · 1 messages · 52 selected fragments/)).toBeVisible();
      await f.dialog.getByRole("button", { name: /确认处理 52 项选择|Confirm 52 selections/ }).click();
      await expect(f.dialog).not.toBeVisible();
      for (const [i, conversation] of f.conversations.entries()) {
        const current = await (await f.context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json();
        expect(current.current_version.display_text).toBe(i === 0 ? conversation.source.replaceAll(marker, "").replace("Cite turn22search1", "") : conversation.source);
      }
    } finally { await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: return from preview restores the review position and focus`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    try {
      if (width < 1024) await f.dialog.getByRole("button", { name: /^(全部候选|All candidates)$/ }).click();
      const checks = f.dialog.getByRole("checkbox", { name: /处理|Process/ });
      await checks.nth(22).check();
      await expect.poll(async () => (await f.scan()).delete_count).toBe(1);
      await expect(checks.nth(22)).toBeEnabled();
      const details = f.dialog.locator("article").nth(22).getByRole("button", { name: /上下文与规则|Context and rules/ });
      await details.click();
      await checks.nth(22).scrollIntoViewIfNeeded();
      const scroll = f.dialog.getByTestId("content-cleanup-scroll");
      const before = await scroll.evaluate((el) => el.scrollTop);
      expect(before).toBeGreaterThan(400);
      const preview = f.dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ });
      await preview.click();
      await expect(f.dialog.getByRole("button", { name: /确认处理 1 项选择|Confirm 1 selections/ })).toBeEnabled();
      await f.dialog.getByRole("button", { name: /返回选择|Back to selection/ }).click();
      await expect(checks.nth(22)).toBeChecked();
      await expect(details).toHaveAttribute("aria-expanded", "true");
      await shot(f.page, `return-${width}`);
      await expect.poll(async () => Math.abs((await scroll.evaluate((el) => el.scrollTop)) - before), { timeout: 3_000 }).toBeLessThan(8);
      await expect(preview).toBeFocused();
      const current = await (await f.context.request.get(`${baseURL}/api/messages/${f.conversations[0].messages[1].id}`)).json();
      expect(current.current_version.display_text).toBe(f.conversations[0].source);
    } finally { await f.context.close(); await f.admin.dispose(); }
  });
}

test("1440px: group search reaches later pages without changing selected scope", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, playwright.request, baseURL!, 1440, 102);
  try {
    const initial = await (await f.context.request.get(`${f.url}/groups?limit=100`)).json();
    expect(initial.total).toBe(102);
    expect(initial.items.some((item: { conversation_title: string }) => item.conversation_title === "Synthetic Zzz target")).toBe(false);
    const search = f.dialog.getByRole("searchbox", { name: /查找对话|Find conversation/ });
    await expect(search).toBeVisible({ timeout: 3_000 });
    await search.fill("Zzz");
    await f.dialog.getByRole("button").filter({ hasText: "Synthetic Zzz target" }).click();
    const scope = f.dialog.getByRole("region", { name: /当前审查范围|Current review scope/ });
    await expect(scope).toContainText("Synthetic Zzz target");
    await f.dialog.getByRole("checkbox", { name: /处理|Process/ }).check();
    await expect.poll(async () => (await f.scan()).delete_count).toBe(1);
    await search.fill("missing synthetic");
    await expect(f.dialog.getByText(/未找到相关对话|No matching conversations/)).toBeVisible();
    await expect(scope).toContainText("Synthetic Zzz target");
    await shot(f.page, "search-empty-1440");
    await f.page.route(`**/api/content-cleanup/scans/${f.scanId}/groups?*`, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic search failure" } }));
    await search.fill("Alpha");
    await expect(f.dialog.getByRole("alert")).toBeVisible();
    await f.page.unroute(`**/api/content-cleanup/scans/${f.scanId}/groups?*`);
    await f.dialog.getByRole("button", { name: /^(重试|Retry)$/ }).click();
    await expect(f.dialog.getByRole("button").filter({ hasText: "Synthetic Alpha 000" })).toBeVisible();
    await expect(scope).toContainText("Synthetic Zzz target");
    expect((await f.scan()).delete_count).toBe(1);
    await shot(f.page, "search-retry-1440");
    await f.dialog.getByRole("button", { name: /清除搜索|Clear search/ }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await scope.getByRole("button", { name: /查看全部候选|Show all candidates/ }).click();
    await expect(scope).toContainText(/102 个候选|102 candidates/);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

for (const width of [375, 768, 1440]) {
  test(`${width}px: real import opens its own noise review from completion`, async ({ browser, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const locale = width === 768 ? "en-US" : "zh-CN";
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const password = "synthetic import noise passphrase", headers = { Origin: baseURL! };
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
      email: `noise-import-${Date.now()}@example.test`, password, confirm_password: password,
    } })).status()).toBe(201);
    await settingsAppearance(context.request, baseURL!, locale);
    const page = await context.newPage();
    try {
      const unrelated = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
        title: "Synthetic existing conversation", messages: [{ role: "user", content_markdown: "Question" }, { role: "assistant", content_markdown: `Keep ${marker} unrelated.` }],
      } });
      expect(unrelated.status()).toBe(201);
      const other = await unrelated.json();
      expect((await context.request.post(`${baseURL}/api/content-cleanup/scans`, { headers, data: {
        source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [other.conversation.id],
      } })).status()).toBe(202);
      const source = `Before ${marker} after.\n\nProtected: \`${marker}\``;
      await page.goto(baseURL!);
      if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/ }).click();
      await page.getByRole("button", { name: /^(导入数据|Import data)$/ }).click();
      await page.getByTestId("import-file-input").setInputFiles([{
        name: "synthetic-noise-import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
          metadata: { title: "Synthetic imported noise", powered_by: "ChatGPT Exporter" },
          messages: [{ role: "Prompt", say: "Synthetic question", time: "2026-10-07 10:00:00" }, { role: "Response", say: source, time: "2026-10-07 10:01:00" }],
        })),
      }]);
      await page.getByTestId("preview-import-button").click();
      await expect(page.getByTestId("commit-import-button")).toBeEnabled();
      const readPattern = "**/api/content-cleanup/scans/pending?import_id=*";
      let recoveredReads = 0;
      if (width === 768) await page.route(readPattern, async route => {
        const retryClicked = await page.evaluate(() => Boolean((window as Window & { __syntheticImportRetryClicked?: boolean }).__syntheticImportRetryClicked));
        if (retryClicked) { recoveredReads += 1; await route.continue(); }
        else await route.fulfill({ status: 503, json: { detail: "Synthetic import scan read failure" } });
      });
      await page.getByTestId("commit-import-button").click();
      const completed = page.getByTestId("import-completion-summary");
      await expect(completed).toBeVisible();
      if (width === 768) {
        await expect(completed.getByRole("alert")).toContainText("Import complete");
        await completed.screenshot({ path: process.env.SETTINGS_SCREENSHOT_DIR ? `${process.env.SETTINGS_SCREENSHOT_DIR}/import-retry-${width}.png` : test.info().outputPath(`import-retry-${width}.png`) });
        // Keep the injected outage until the real user click. Task completion
        // can invalidate this query too, so unroute-before-click races recovery.
        // This listener changes only the test transport gate, not app/query state.
        await page.evaluate(() => {
          const clicked = (event: MouseEvent) => {
            const button = event.target instanceof Element ? event.target.closest("button") : null;
            if (!button?.closest('[data-testid="import-completion-summary"]') || button.textContent !== "Retry loading") return;
            (window as Window & { __syntheticImportRetryClicked?: boolean }).__syntheticImportRetryClicked = true;
            document.removeEventListener("click", clicked, true);
          };
          document.addEventListener("click", clicked, true);
        });
        await completed.getByRole("button", { name: "Retry loading", exact: true }).click();
        await expect.poll(() => recoveredReads).toBeGreaterThan(0);
      }
      const review = completed.getByRole("button", { name: /审查噪声|Review noise/ });
      await expect(review).toBeVisible({ timeout: 5_000 });
      await expect(completed.getByRole("alert")).toHaveCount(0);
      await page.unrouteAll({ behavior: "wait" });
      await completed.screenshot({ path: process.env.SETTINGS_SCREENSHOT_DIR ? `${process.env.SETTINGS_SCREENSHOT_DIR}/import-complete-${width}.png` : test.info().outputPath(`import-complete-${width}.png`) });
      await review.click();
      const dialog = page.getByTestId("content-cleanup-dialog");
      if (width === 1440) {
        const rescanned = page.waitForResponse(response => response.url().endsWith("/rescan") && response.request().method() === "POST");
        await dialog.getByRole("button", { name: "重新扫描原对话", exact: true }).click();
        const replacement = await (await rescanned).json();
        expect(replacement.source).toBe("IMPORT");
        await expect(dialog.getByRole("checkbox", { name: /处理|Process/ })).toHaveCount(2);
        await page.keyboard.press("Escape");
        const imported = await (await context.request.get(`${baseURL}/api/content-cleanup/scans/pending`)).json();
        expect(imported.filter((scan: { id: string }) => scan.id === replacement.id)).toHaveLength(1);
        await expect(review).toBeFocused();
        await review.click();
        await expect(dialog.getByRole("checkbox", { name: /处理|Process/ })).toHaveCount(2);
      }
      if (width < 1024) await dialog.getByRole("button", { name: /^(全部候选|All candidates)$/ }).click();
      await expect(dialog.getByRole("checkbox", { name: /处理|Process/ })).toHaveCount(2);
      await expect(dialog.getByRole("status").filter({ hasText: /已选 0 项|0 selected/ })).toBeVisible();
      await dialog.getByRole("button", { name: /选择全部匹配项|Select all matching/ }).click();
      await expect(dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ })).toBeEnabled();
      await shot(page, `import-review-${width}`);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(completed).toBeVisible();
      await expect(review).toBeFocused();
      await review.click();
      await expect(dialog.getByRole("status").filter({ hasText: /已选 1 项|1 selected/ })).toBeVisible();
      await dialog.getByRole("button", { name: /预览 1 项清理|Preview 1 removals/ }).click();
      await dialog.getByRole("button", { name: /确认处理 1 项选择|Confirm 1 selections/ }).click();
      await expect(dialog).not.toBeVisible();
      await completed.getByRole("button", { name: /^(打开对话|Open conversation)$/ }).click();
      await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
      const conversationId = new URL(page.url()).pathname.split("/").pop();
      const messages = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/messages`)).json();
      const assistant = messages.find((item: { role: string }) => item.role === "assistant");
      const current = await (await context.request.get(`${baseURL}/api/messages/${assistant.id}`)).json();
      expect(current.current_version.display_text).toBe(`Before  after.\n\nProtected: \`${marker}\``);
      const unchanged = await (await context.request.get(`${baseURL}/api/messages/${other.messages[1].id}`)).json();
      expect(unchanged.current_version.display_text).toBe(`Keep ${marker} unrelated.`);
    } finally { await context.close(); await admin.dispose(); }
  });
}
