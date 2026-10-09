import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "off", actionTimeout: 20_000, serviceWorkers: "block", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_MUTATION_FLOW !== "1", "Requires an isolated API and worker");

async function conversation(page: Page, title: string) {
  const response = await page.request.post("/api/conversations", { data: { title, messages: [
    { role: "user", content_markdown: `${title} synthetic question` },
    { role: "assistant", content_markdown: `${title} synthetic answer` },
  ] } });
  expect(response.status()).toBe(201);
  return (await response.json()).conversation.id as string;
}

for (const width of [375, 768, 1440]) for (const zh of [true, false]) {
  test(`${width}px ${zh ? "Chinese light" : "English dark"}: protect drafts, reachable project settings and persisted appearance`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.request.patch("/api/preferences", { data: { locale_mode: zh ? "zh-CN" : "en-US", theme_mode: zh ? "light" : "dark" } });
    const projectResponse = await page.request.post("/api/projects", { data: { name: `UX project ${crypto.randomUUID().slice(0, 8)}` } });
    expect(projectResponse.status()).toBe(201);
    const project = await projectResponse.json();
    let madeId: string | undefined;
    try {
      await page.goto("/recent");
      if (width < 768) await page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ }).click();
      await page.locator('[data-testid="unclassified-new-conversation-button"]:visible').click();
      const create = page.getByTestId("new-conversation-dialog");
      await expect(create.getByRole("heading")).toHaveText(zh ? "新建对话" : "New conversation");
      await create.locator("textarea").first().fill("Synthetic draft remains available");
      await page.keyboard.press("Escape");
      const confirmation = page.getByRole("dialog", { name: /放弃未保存|Discard unsaved/ });
      await expect(confirmation).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(confirmation).toHaveCount(0);
      await expect(create.locator("textarea").first()).toHaveValue("Synthetic draft remains available");
      await create.locator("textarea").last().fill("Synthetic saved response");
      let block = true;
      await page.route("**/api/conversations", async (route) => {
        if (route.request().method() === "POST" && block) await route.fulfill({ status: 503, json: { detail: "Synthetic save failure" } });
        else await route.continue();
      });
      await create.getByRole("button", { name: /创建并打开|Create and open/ }).click();
      await expect(create.getByRole("alert")).toBeVisible();
      await expect(create.locator("textarea").first()).toHaveValue("Synthetic draft remains available");
      block = false;
      const saved = page.waitForResponse((response) => response.url().endsWith("/api/conversations") && response.request().method() === "POST");
      await create.getByRole("button", { name: /创建并打开|Create and open/ }).click();
      const response = await saved;
      expect(response.status()).toBe(201);
      madeId = (await response.json()).conversation.id;
      await expect(page).toHaveURL(new RegExp(`/conversations/${madeId}$`));
      await expect(page.locator("article[data-message-id]").filter({ hasText: "Synthetic draft remains available" })).toBeVisible();
      await page.reload();
      await expect(page.locator("article[data-message-id]").filter({ hasText: "Synthetic draft remains available" })).toBeVisible();
      await page.goto("/recent");
      if (width < 768) await page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ }).click();
      const trigger = page.getByRole("button", { name: new RegExp(`^(管理项目|Manage project) ${project.name}$`) });
      // Keyboard invocation must work even when the desktop pointer is elsewhere.
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: /项目设置|Project settings/ })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: /归档项目|Archive project/ })).toBeFocused();
      await page.keyboard.press("Home"); await page.keyboard.press("Enter");
      const settings = page.getByRole("dialog", { name: /^(项目设置|Project settings)$/ });
      await expect(settings).toBeVisible();
      await settings.getByRole("button", { name: /^(保存|Save)$/ }).focus(); await page.keyboard.press("Tab");
      expect(await settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await page.setViewportSize({ width, height: 400 });
      const bounds = await settings.locator("form").boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400);
      await settings.getByRole("combobox", { name: /^(图标|Icon)$/ }).selectOption("book");
      await settings.locator('input[type="color"]').fill("#7c3aed");
      await settings.getByRole("combobox", { name: /^(图标|Icon)$/ }).scrollIntoViewIfNeeded();
      const iconBox = await settings.getByRole("combobox", { name: /^(图标|Icon)$/ }).boundingBox();
      const footerBox = await settings.locator("footer").boundingBox();
      expect(iconBox!.y + iconBox!.height).toBeLessThanOrEqual(footerBox!.y);
      await page.screenshot({ path: info.outputPath(`project-settings-${width}-${zh}.png`) });
      await page.keyboard.press("Escape");
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: /^(取消|Cancel)$/ }).click();
      await settings.getByRole("button", { name: /^(保存|Save)$/ }).click();
      await expect(settings).toHaveCount(0);
      const projects = await (await page.request.get("/api/projects")).json();
      expect(projects.find((row: { id: string }) => row.id === project.id)).toMatchObject({ icon: "book", color: "#7c3aed" });
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      if (width < 768) await page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ }).click();
      await expect(page.locator(`a[href="/projects/${project.id}"]:visible [data-project-symbol="book"]`)).toHaveCSS("color", "rgb(124, 58, 237)");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await page.unrouteAll();
      if (madeId) expect((await page.request.delete(`/api/conversations/${madeId}`)).ok()).toBe(true);
      await page.request.patch(`/api/projects/${project.id}`, { data: { is_archived: true } });
      expect((await page.request.delete(`/api/projects/${project.id}`)).ok()).toBe(true);
    }
  });
}

test("search scope, submit, history, stale results, keyboard ordering and failure recovery", async ({ page }, info) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "light" } });
  const key = `UXSEARCH${crypto.randomUUID().slice(0, 8)}`;
  const id = await conversation(page, key);
  try {
    expect((await page.request.post(`/api/conversations/${id}/archive`)).ok()).toBe(true);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/search?q=${key}`);
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("combobox", { name: "Status", exact: true }).focus();
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("all");
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("all");
    await expect(page.locator('a[data-search-index]').first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeFocused();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?/);
    await page.screenshot({ path: info.outputPath("search-mobile-after.png") });
    const input = page.getByRole("textbox", { name: "Search", exact: true });
    await input.fill(key + "NEW"); await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(key + "NEW"));
    await page.goBack(); await expect(input).toHaveValue(key);
    await input.focus(); await page.keyboard.press("ArrowDown");
    await expect(page.locator('a[data-search-index="0"]')).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('a[data-search-index="1"]')).toHaveAttribute("aria-current", "true");
    const expected = await page.locator('a[data-search-index="1"]').getAttribute("href");
    await page.keyboard.press("Enter"); await expect(page).toHaveURL((url) => url.pathname + url.search === expected);
    await page.route("**/api/search?*", (route) => route.fulfill({ status: 503, json: { detail: "Synthetic search failure" } }));
    await page.goto(`/search?q=${key}&status_scope=all`);
    await expect(page.getByRole("alert").filter({ hasText: "Search failed" })).toBeVisible();
    await expect(page.getByText("No results. Clear filters or try another query.")).toHaveCount(0);
    await page.unroute("**/api/search?*");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator('a[data-search-index]').first()).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(input).toHaveValue(key);
    await expect(page).not.toHaveURL(/status_scope/);
  } finally { await page.unrouteAll(); expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true); }
});

test("search pagination resets with filters while date controls retain focus", async ({ page }) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "light" } });
  const key = `UXPAGING${crypto.randomUUID().slice(0, 8)}`;
  const ids: string[] = [];
  try {
    for (let index = 0; index < 30; index++) {
      const created = await page.request.post("/api/conversations", { data: { title: `Synthetic paginated results ${index}`, messages: [
        { role: "user", content_markdown: `${key} question ${index}` },
        { role: "assistant", content_markdown: `${key} answer ${index}` },
      ] } });
      expect(created.status()).toBe(201); ids.push((await created.json()).conversation.id);
    }
    await page.goto(`/search?q=${key}&document_type=message`);
    await expect(page.locator('a[data-search-index]')).toHaveCount(50);
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    await expect(page.locator('a[data-search-index]')).toHaveCount(60);
    await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("user");
    await expect(page.locator('a[data-search-index]')).toHaveCount(30);
    const from = page.getByLabel("From", { exact: true });
    await from.focus(); await from.fill("2099-01-01");
    await expect(from).toBeFocused();
    await page.getByLabel("To", { exact: true }).fill("2020-01-01");
    await expect(page.getByRole("alert").filter({ hasText: "From must be on or before To." })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator('a[data-search-index]')).toHaveCount(50);
    await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue(key);
  } finally { for (const id of ids) expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true); }
});

test("rapid search filters preserve both dates, other filters and browser history", async ({ page }) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "light" } });
  const key = `UXRAPID${crypto.randomUUID().slice(0, 8)}`;
  const id = await conversation(page, key);
  let releaseNavigation = () => {};
  const navigationBarrier = new Promise<void>((resolve) => { releaseNavigation = resolve; });
  try {
    await page.goto(`/search?q=${key}&document_type=message&role=user&status_scope=all`);
    await expect(page.locator('a[data-search-index]')).toHaveCount(1);
    await page.getByRole("button", { name: /^Filters/ }).click();
    // Hold optional RSC navigations until both user edits have happened. This
    // reproduces a slow navigation deterministically without delaying API reads.
    await page.route((url) => url.pathname === "/search", async (route) => {
      if (route.request().headers().rsc === "1") await navigationBarrier;
      await route.continue();
    });
    const from = page.getByLabel("From", { exact: true });
    const to = page.getByLabel("To", { exact: true });
    await from.fill("2099-01-01");
    await to.fill("2020-01-01");
    releaseNavigation();
    await expect(from).toHaveValue("2099-01-01");
    await expect(to).toHaveValue("2020-01-01");
    await expect(to).toBeFocused();
    await expect(page.getByRole("alert").filter({ hasText: "From must be on or before To." })).toBeVisible();
    const invalidRangeUrl = page.url();
    expect(Object.fromEntries(new URL(invalidRangeUrl).searchParams)).toEqual({
      q: key, document_type: "message", role: "user", status_scope: "all",
      date_from: "2099-01-01", date_to: "2020-01-01",
    });
    await page.goBack();
    await expect(from).toHaveValue("2099-01-01");
    await expect(to).toHaveValue("");
    await page.goBack();
    await expect(from).toHaveValue("");
    await expect(page.locator('a[data-search-index]')).toHaveCount(1);
    await page.goForward();
    await expect(from).toHaveValue("2099-01-01");
    await page.goForward();
    await expect(page).toHaveURL(invalidRangeUrl);
    await expect(to).toHaveValue("2020-01-01");
    await page.reload();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(from).toHaveValue("2099-01-01");
    await expect(to).toHaveValue("2020-01-01");
    await expect(page.getByRole("combobox", { name: "Role", exact: true })).toHaveValue("user");
    await expect(page.getByRole("combobox", { name: "Content type", exact: true })).toHaveValue("message");
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("all");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page).toHaveURL((url) => url.search === `?q=${key}`);
    await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue(key);
    await page.goBack();
    await expect(page).toHaveURL(invalidRangeUrl);
    await expect(from).toHaveValue("2099-01-01");
    await expect(to).toHaveValue("2020-01-01");
  } finally {
    releaseNavigation();
    await page.unrouteAll({ behavior: "wait" });
    expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
  }
});

test("attachments: failed load, rename draft, copy feedback and partial detach remain recoverable", async ({ page }, info) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "dark" } });
  const id = await conversation(page, "Synthetic file actions");
  const endpoint = `/api/conversations/${id}/attachments`;
  try {
    await page.route(`**${endpoint}`, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic file failure" } }));
    await page.goto(`/conversations/${id}`);
    await page.getByRole("button", { name: "Message actions", exact: true }).click();
    await page.getByRole("button", { name: "Conversation files", exact: true }).click();
    const files = page.getByTestId("conversation-files-panel");
    await expect(files.getByRole("alert")).toContainText("Could not load files");
    await page.unroute(`**${endpoint}`); await files.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(files.getByRole("alert")).toHaveCount(0);
    await files.getByTestId("conversation-files-upload-input").setInputFiles([
      { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic first attachment") },
      { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic second attachment") },
    ]);
    await expect(files.getByTestId("conversation-file-row")).toHaveCount(2);
    const items = (await (await page.request.get(endpoint)).json()).items;
    const first = items.find((row: { display_name: string }) => row.display_name === "one.txt");
    const row = files.getByTestId("conversation-file-row").filter({ hasText: "one.txt" });
    await row.getByRole("button", { name: "More file actions" }).click();
    await row.getByRole("button", { name: "Rename display name" }).click();
    const prompt = page.getByRole("dialog", { name: "Rename display name" });
    await prompt.getByRole("textbox").fill("renamed.txt");
    await page.route(`**${endpoint}/${first.id}`, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic mutation failure" } }));
    await prompt.getByRole("button", { name: "Save", exact: true }).click();
    await expect(files.getByRole("alert")).toContainText("Rename failed");
    await row.getByRole("button", { name: "More file actions" }).click();
    await row.getByRole("button", { name: "Rename display name" }).click();
    await expect(prompt.getByRole("textbox")).toHaveValue("renamed.txt");
    await page.unroute(`**${endpoint}/${first.id}`);
    await prompt.getByRole("button", { name: "Save", exact: true }).click();
    await expect(files.getByRole("status")).toHaveText("Name saved");
    expect((await (await page.request.get(endpoint)).json()).items.find((item: { id: string }) => item.id === first.id).display_name).toBe("renamed.txt");
    const renamed = files.getByTestId("conversation-file-row").filter({ hasText: "renamed.txt" });
    await renamed.getByRole("button", { name: "More file actions" }).click();
    await renamed.getByRole("button", { name: "Copy attachment reference" }).click();
    await expect(files.locator('[role="status"], [role="alert"]')).toContainText(/copied|Copy failed/);
    await page.keyboard.press("Escape");
    for (const checkbox of await files.getByRole("checkbox").all()) await checkbox.check();
    await page.route(`**${endpoint}/${first.id}`, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic detach failure" } }));
    await files.getByRole("button", { name: "Detach selected" }).click();
    await page.getByRole("dialog", { name: /Detach 2 files/ }).getByRole("button", { name: "Detach", exact: true }).click();
    await expect(files.getByRole("alert")).toContainText("1 detached, 1 failed");
    await expect(files.getByRole("checkbox")).toBeChecked();
    expect((await (await page.request.get(endpoint)).json()).items).toHaveLength(1);
    await page.unroute(`**${endpoint}/${first.id}`);
    await files.getByRole("button", { name: "Detach selected" }).click();
    await page.getByRole("dialog", { name: /Detach 1 files/ }).getByRole("button", { name: "Detach", exact: true }).click();
    await expect(files.getByTestId("conversation-file-row")).toHaveCount(0);
    expect((await (await page.request.get(endpoint)).json()).items).toHaveLength(0);
    await page.screenshot({ path: info.outputPath("files-dark-after.png") });
  } finally { await page.unrouteAll(); expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true); }
});

test("export status recovers the same real task; task center read failures are explicit", async ({ page }) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "dark" } });
  const id = await conversation(page, "Synthetic export recovery");
  let exports = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith(`/conversations/${id}/exports`)) exports++; });
  try {
    await page.goto(`/conversations/${id}`);
    await page.getByRole("button", { name: "Message actions", exact: true }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.route("**/api/tasks/*", (route) => route.fulfill({ status: 503, json: { detail: "Synthetic task status failure" } }));
    const queued = page.waitForResponse((response) => response.url().endsWith(`/conversations/${id}/exports`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Generate export", exact: true }).click();
    const response = await queued; expect(response.ok()).toBe(true);
    const job = (await response.json()).job_id;
    await expect(page.getByRole("alert").filter({ hasText: "Export status is unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Waiting for task status", exact: true })).toBeDisabled();
    await expect.poll(async () => (await (await page.request.get(`/api/tasks/${job}`)).json()).status).toBe("committed");
    await page.unroute("**/api/tasks/*");
    await page.getByRole("button", { name: "Retry status", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download Context Package", exact: true })).toBeVisible();
    expect(exports).toBe(1);
    const task = await (await page.request.get(`/api/tasks/${job}`)).json();
    const downloaded = await page.request.get(task.result.download_url);
    expect(downloaded.ok()).toBe(true); expect((await downloaded.body()).subarray(0, 2).toString()).toBe("PK");
    await page.route("**/api/tasks/active", (route) => route.fulfill({ status: 503, json: { detail: "Synthetic tasks failure" } }));
    await page.goto("/recent");
    await page.getByTestId("sidebar-tasks-button").click();
    const center = page.getByTestId("task-center-panel");
    await expect(center.getByRole("alert")).toContainText("Could not load task status");
    await expect(center.getByText("No tasks are currently running", { exact: true })).toHaveCount(0);
    await page.unroute("**/api/tasks/active");
    await center.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(center.getByRole("alert")).toHaveCount(0);
  } finally { await page.unrouteAll(); expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true); }
});

test("fresh search input and IME cannot activate stale sidebar or conversation matches", async ({ page }) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "light" } });
  const key = `UXFRESH${crypto.randomUUID().slice(0, 8)}`;
  const id = await conversation(page, key);
  try {
    await page.goto("/recent");
    const sidebar = page.getByTestId("sidebar-global-search");
    await sidebar.fill(key);
    await expect(page.getByRole("button", { name: new RegExp(`${key}.*synthetic`) }).first()).toBeVisible();
    await sidebar.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(page).toHaveURL(/\/recent$/);
    await sidebar.fill("NO_SUCH_FRESH_RESULT"); await sidebar.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=NO_SUCH_FRESH_RESULT$/);
    await page.goto(`/conversations/${id}`);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Search this conversation", exact: true });
    await input.fill(key); await expect(page.locator("button mark").first()).toBeVisible();
    await input.fill("NO_SUCH_FRESH_RESULT"); await input.press("Enter");
    await expect(input).toBeVisible(); await expect(page.getByText('No results for “NO_SUCH_FRESH_RESULT”')).toBeVisible();
    await page.route("**/api/search?*", (route) => route.fulfill({ status: 503, json: { detail: "Synthetic unavailable" } }));
    await input.fill(key + " question");
    await expect(page.getByRole("alert").filter({ hasText: "Search unavailable" })).toBeVisible();
    await page.unroute("**/api/search?*");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Search unavailable" })).toHaveCount(0);
    await input.fill(key); await expect(page.locator("button mark").first()).toBeVisible();
    await page.locator("button").filter({ has: page.locator("mark") }).first().click();
    await expect(input).toHaveCount(0);
    await expect(page.locator("article[data-message-id]").filter({ hasText: key }).first()).toBeVisible();
  } finally { await page.unrouteAll(); expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true); }
});

test("message insertion retains dirty content and locks the actual in-flight write", async ({ page }) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "dark" } });
  const id = await conversation(page, "Synthetic insertion");
  let release: (() => void) | undefined;
  try {
    await page.goto(`/conversations/${id}`);
    await page.getByRole("button", { name: "Insert message here", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Insert messages", exact: true });
    await dialog.getByRole("textbox", { name: "Message content" }).fill("Synthetic inserted text");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Message content" })).toHaveValue("Synthetic inserted text");
    let writes = 0;
    await page.route(`**/api/conversations/${id}/messages/insert`, async (route) => {
      writes++;
      await new Promise<void>((resolve) => { release = resolve; });
      await route.continue();
    });
    await dialog.getByRole("button", { name: "Insert messages", exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await expect(dialog.getByRole("textbox", { name: "Message content" })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    release!();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.locator("article[data-message-id]").filter({ hasText: "Synthetic inserted text" })).toBeVisible();
    expect(writes).toBe(1);
  } finally { release?.(); await page.unrouteAll(); expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true); }
});

test("phone creates a project and failed archive/restore preserve the real project", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "light" } });
  const name = `UX mobile project ${crypto.randomUUID().slice(0, 8)}`;
  let id: string | undefined;
  let failWrite = true;
  const writes: Array<{ is_archived: boolean }> = [];
  try {
    await page.goto("/recent"); await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByRole("textbox", { name: "Project name", exact: true }).fill(name);
    const created = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    const response = await created; expect(response.status()).toBe(201); id = (await response.json()).id;
    const trigger = page.getByRole("button", { name: `Manage project ${name}`, exact: true });
    await page.mouse.move(374, 0); await expect(trigger).toHaveCSS("opacity", "1");
    await trigger.click(); await page.getByRole("menuitem", { name: "Archive project" }).click();
    await page.route(`**/api/projects/${id}`, async route => {
      if (route.request().method() !== "PATCH") return route.continue();
      writes.push(route.request().postDataJSON());
      if (failWrite) return route.fulfill({ status: 503, json: { detail: "Synthetic project failure" } });
      await route.continue();
    });
    await page.getByRole("dialog", { name: `Archive “${name}”?` }).getByRole("button", { name: "Archive", exact: true }).click();
    const archiveNotice = page.getByTestId("project-archive-feedback").filter({ visible: true });
    await expect(archiveNotice).toContainText("Archive could not be confirmed");
    expect(writes).toEqual([{ is_archived: true }]);
    expect((await (await page.request.get("/api/projects")).json()).find((item: { id: string }) => item.id === id).is_archived).toBe(false);
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: "Archive project" })).toBeDisabled();
    await page.keyboard.press("Escape");
    failWrite = false;
    await archiveNotice.getByRole("button", { name: "Check archive result", exact: true }).click();
    await expect(archiveNotice).toContainText("This project is not archived");
    expect(writes).toEqual([{ is_archived: true }]);
    await trigger.click();
    await page.getByRole("menuitem", { name: "Archive project" }).click();
    await page.getByRole("dialog", { name: `Archive “${name}”?` }).getByRole("button", { name: "Archive", exact: true }).click();
    await expect(trigger).toHaveCount(0);
    expect(writes).toEqual([{ is_archived: true }, { is_archived: true }]);
    await page.goto("/archived");
    const section = page.locator('section[aria-labelledby="archived-projects-heading"]');
    const row = section.locator(".reader-interactive-row").filter({ hasText: name });
    failWrite = true;
    await row.getByRole("button", { name: /Restore/ }).click();
    const checkRestore = section.getByRole("button", { name: "Check restore result", exact: true });
    await expect(checkRestore).toBeVisible();
    await expect(row.getByRole("button", { name: /Restore/ })).toBeDisabled();
    expect(writes).toEqual([{ is_archived: true }, { is_archived: true }, { is_archived: false }]);
    expect((await (await page.request.get("/api/projects?include_archived=true")).json()).find((item: { id: string }) => item.id === id).is_archived).toBe(true);
    failWrite = false; await checkRestore.click();
    await expect(section.getByRole("status")).toContainText("1 still archived");
    expect(writes).toHaveLength(3);
    await row.getByRole("button", { name: /Restore/ }).click();
    await expect(row).toHaveCount(0);
    expect(writes).toEqual([{ is_archived: true }, { is_archived: true }, { is_archived: false }, { is_archived: false }]);
    expect((await (await page.request.get("/api/projects")).json()).find((item: { id: string }) => item.id === id).is_archived).toBe(false);
    await page.screenshot({ path: info.outputPath("archived-mobile-after.png") });
  } finally {
    await page.unrouteAll();
    if (id) { await page.request.patch(`/api/projects/${id}`, { data: { is_archived: true } }); expect((await page.request.delete(`/api/projects/${id}`)).ok()).toBe(true); }
  }
});

test("many actual noise scans use one bounded mobile shortcut and dismissal can retry", async ({ page }, info) => {
  await page.request.patch("/api/preferences", { data: { locale_mode: "en-US", theme_mode: "dark" } });
  const ids: string[] = [];
  const scans: string[] = [];
  try {
    for (let index = 0; index < 8; index++) {
      const id = await conversation(page, `Synthetic noise ${index} Cite turn2search1`);
      ids.push(id);
      const created = await page.request.post("/api/content-cleanup/scans", { data: { source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [id] } });
      expect(created.ok()).toBe(true); scans.push((await created.json()).id);
    }
    for (const scan of scans) await expect.poll(async () => (await (await page.request.get(`/api/content-cleanup/scans/${scan}`)).json()).status).toBe("READY");
    expect((await (await page.request.get(`/api/content-cleanup/scans/${scans[0]}`)).json()).occurrence_count).toBeGreaterThan(0);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/conversations/${ids[0]}`);
    const summary = page.locator('[data-testid="task-summary-button"]:visible');
    await expect(summary).toHaveCount(1);
    expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(60);
    await page.screenshot({ path: info.outputPath("tasks-mobile-bounded.png") });
    await summary.click();
    const center = page.getByTestId("task-center-panel");
    const ownScans = center.locator(scans.map((scan) => `[data-cleanup-scan-id="${scan}"]`).join(","));
    await expect(ownScans.getByRole("button", { name: "Open review", exact: true })).toHaveCount(8);
    await expect(center.getByText("0 noise candidates ready for review", { exact: true })).toHaveCount(0);
    let dismissalWrites = 0;
    await page.route("**/api/content-cleanup/scans/*", async (route) => {
      if (route.request().method() === "DELETE") {
        dismissalWrites++;
        if (dismissalWrites === 1) return route.fulfill({ status: 503, json: { detail: "Synthetic dismiss failure" } });
      }
      await route.continue();
    });
    const targetRow = center.locator(`[data-cleanup-scan-id="${scans[0]}"]`);
    const dismiss = targetRow.getByRole("button", { name: "Ignore this result", exact: true });
    await dismiss.click();
    await expect(targetRow.getByRole("alert")).toContainText("Dismissal is unconfirmed");
    await expect(dismiss).toBeDisabled();
    await expect(ownScans.getByRole("button", { name: "Open review", exact: true })).toHaveCount(8);
    await targetRow.getByRole("button", { name: "Check dismissal result", exact: true }).click();
    await expect(targetRow.getByRole("status")).toContainText("This review is still available");
    await expect(dismiss).toBeEnabled();
    expect(dismissalWrites).toBe(1);
    await dismiss.click();
    await expect(ownScans.getByRole("button", { name: "Open review", exact: true })).toHaveCount(7);
    expect(dismissalWrites).toBe(2);
    expect((await (await page.request.get(`/api/content-cleanup/scans/${scans[0]}/dismissal`)).json()).status).toBe("DISMISSED");
    const pending = await (await page.request.get("/api/content-cleanup/scans/pending")).json();
    expect(pending.filter((row: { id: string }) => scans.includes(row.id))).toHaveLength(7);
  } finally {
    await page.unrouteAll();
    for (const scan of scans) await page.request.delete(`/api/content-cleanup/scans/${scan}`);
    for (const id of ids) expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
  }
});
