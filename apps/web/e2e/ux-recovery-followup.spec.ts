import { expect, test, type Page } from "@playwright/test";
import type { ConversationCreateResponse, RecentItemRead, SearchResultItem } from "../lib/types";

test.use({ trace: "off", actionTimeout: 20_000, serviceWorkers: "block", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_MUTATION_FLOW !== "1", "Requires the isolated mutation API fixture");

async function createConversation(page: Page, title: string, projectId?: string): Promise<ConversationCreateResponse> {
  const response = await page.request.post("/api/conversations", { data: {
    title, project_id: projectId, messages: [
      { role: "user", content_markdown: `${title} synthetic question` },
      { role: "assistant", content_markdown: `${title} synthetic answer` },
    ],
  } });
  expect(response.status()).toBe(201);
  return response.json();
}

async function status(page: Page, id: string) {
  const response = await page.request.get(`/api/conversations/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).status as string;
}

async function preferences(page: Page, zh: boolean) {
  expect((await page.request.patch("/api/preferences", { data: { locale_mode: zh ? "zh-CN" : "en-US", theme_mode: zh ? "light" : "dark" } })).ok()).toBe(true);
}

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(`${width}px: batch undo checks unknown outcomes, keeps failed reads and retries only unresolved items`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await preferences(page, zh);
    const projectResponse = await page.request.post("/api/projects", { data: { name: "Synthetic undo project" } });
    expect(projectResponse.status()).toBe(201);
    const project = await projectResponse.json();
    const created: ConversationCreateResponse[] = [];
    let releaseFailure: () => void = () => {};
    try {
      for (const title of ["Synthetic undo first", "Synthetic undo second"]) created.push(await createConversation(page, title, project.id));
      const [first, second] = created.map((item) => item.conversation.id);
      const writes = new Map<string, number>();
      let failSecond = true;
      const held = new Promise<void>((resolve) => { releaseFailure = resolve; });
      await page.route((url) => [first, second].some((id) => url.pathname === `/api/conversations/${id}/unarchive`), async (route) => {
        const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
        writes.set(id, (writes.get(id) ?? 0) + 1);
        if (id === second && failSecond) {
          await held;
          await route.fulfill({ status: 503, json: { detail: "Synthetic unavailable" } });
        } else await route.continue();
      });
      await page.goto(`/projects/${project.id}`);
      await page.getByRole("button", { name: zh ? "批量操作" : "Manage conversations", exact: true }).click();
      await page.getByTestId("selection-toolbar").getByRole("button", { name: zh ? "全选" : "Select all", exact: true }).click();
      await page.getByTestId("selection-toolbar").getByRole("button", { name: zh ? "归档" : "Archive", exact: true }).click();
      const notice = page.locator(`[aria-label="${zh ? "撤销对话操作" : "Undo conversation action"}"]`);
      const undo = notice.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true });
      await expect(undo).toBeEnabled();
      expect(await status(page, first)).toBe("archived");
      expect(await status(page, second)).toBe("archived");
      await undo.dblclick();
      await expect(notice.getByRole("button")).toBeDisabled();
      await expect.poll(() => writes.get(second)).toBe(1);
      releaseFailure();
      const check = notice.getByRole("button", { name: zh ? "检查结果" : "Check result", exact: true });
      await expect(check).toBeEnabled();
      await expect(notice.getByRole("alert")).toContainText(zh ? "已撤销 1 项" : "1 undone");
      if (!zh) await expect(notice.getByRole("alert")).toContainText("1 result needs checking.");
      expect(await status(page, first)).toBe("active");
      expect(await status(page, second)).toBe("archived");
      let failRead = true;
      let reads = 0;
      await page.route((url) => url.pathname === `/api/conversations/${second}`, async (route) => {
        reads += 1;
        if (failRead) await route.fulfill({ status: 503, json: { detail: "Synthetic read failure" } });
        else await route.continue();
      });
      await check.click();
      await expect.poll(() => reads).toBe(1);
      await expect(check).toBeEnabled();
      expect(writes.get(first)).toBe(1);
      expect(writes.get(second)).toBe(1);
      await page.screenshot({ path: info.outputPath(`undo-unconfirmed-${width}.png`) });
      failRead = false;
      await check.click();
      const retry = notice.getByRole("button", { name: zh ? "重试撤销" : "Retry undo", exact: true });
      await expect(retry).toBeEnabled();
      if (!zh) await expect(notice.getByRole("alert")).toContainText("1 remaining. Retry undo.");
      expect(writes.get(second)).toBe(1);
      failSecond = false;
      await retry.click();
      await expect(notice).toHaveCount(0);
      expect(writes.get(first)).toBe(1);
      expect(writes.get(second)).toBe(2);
      expect(await status(page, first)).toBe("active");
      expect(await status(page, second)).toBe("active");
      await expect(page.getByRole("checkbox", { name: `${zh ? "选择" : "Select"} Synthetic undo second`, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      releaseFailure();
      await page.unrouteAll({ behavior: "wait" });
      for (const item of created) expect((await page.request.delete(`/api/conversations/${item.conversation.id}`)).ok()).toBe(true);
      await page.request.patch(`/api/projects/${project.id}`, { data: { is_archived: true } });
      expect((await page.request.delete(`/api/projects/${project.id}`)).ok()).toBe(true);
    }
  });
}

for (const mode of ["archive", "restore"] as const) {
  test(`final-row ${mode}: empty and failed list reads keep the same undo owner`, async ({ page }, info) => {
    const zh = mode === "restore";
    await preferences(page, zh);
    await page.setViewportSize({ width: zh ? 1440 : 375, height: 900 });
    const created = await createConversation(page, "Synthetic final row");
    const id = created.conversation.id;
    let failList = false;
    let writes = 0;
    let loseResponse = true;
    try {
      if (mode === "restore") expect((await page.request.post(`/api/conversations/${id}/archive`)).ok()).toBe(true);
      // Isolate the displayed list, not the stored data. Every status still comes
      // from the real API and no unrelated fixture conversation is removed.
      await page.route((url) => url.pathname === "/api/conversations", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        if (failList) return route.fulfill({ status: 503, json: { detail: "Synthetic list outage" } });
        const response = await route.fetch();
        const rows = await response.json();
        await route.fulfill({ response, json: rows.filter((item: { id: string }) => item.id === id) });
      });
      const undoPath = `/api/conversations/${id}/${mode === "archive" ? "unarchive" : "archive"}`;
      await page.route((url) => url.pathname === undoPath, async (route) => {
        writes += 1;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        if (loseResponse) {
          failList = true;
          await route.fulfill({ status: 503, json: { detail: "Synthetic lost acknowledgement" } });
        } else await route.fulfill({ response });
      });
      await page.goto(mode === "archive" ? "/" : "/archived");
      await page.getByRole("button", { name: zh ? "批量操作" : "Manage conversations", exact: true }).click();
      await page.getByRole("checkbox", { name: `${zh ? "选择" : "Select"} Synthetic final row`, exact: true }).check();
      await page.getByTestId("selection-toolbar").getByRole("button", { name: mode === "archive" ? "Archive" : "恢复", exact: true }).click();
      const notice = page.locator(`[aria-label="${zh ? "撤销对话操作" : "Undo conversation action"}"]`);
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
      await expect(notice.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })).toBeEnabled();
      if (!zh) await expect(notice).toContainText("1 conversation archived");
      await page.screenshot({ path: info.outputPath(`undo-empty-${mode}.png`) });
      await notice.getByRole("button").click();
      const check = notice.getByRole("button", { name: zh ? "检查结果" : "Check result", exact: true });
      await expect(check).toBeEnabled();
      await expect(page.getByRole("heading", { name: zh ? "对话加载失败" : "Failed to load conversations", exact: true })).toBeVisible();
      // This check sees the committed target state. It must never send a second
      // inverse write just because the acknowledgement/list read was lost.
      expect(writes).toBe(1);
      loseResponse = false;
      failList = false;
      await check.click();
      await expect(notice).toHaveCount(0);
      expect(writes).toBe(1);
      expect(await status(page, id)).toBe(mode === "archive" ? "active" : "archived");
      await expect(page.getByRole("checkbox", { name: `${zh ? "选择" : "Select"} Synthetic final row`, exact: true })).toBeVisible();
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
    }
  });
}

test("a batch with zero confirmed archives offers no empty undo", async ({ page }) => {
  await preferences(page, false);
  const created = await createConversation(page, "Synthetic rejected archive");
  const id = created.conversation.id;
  try {
    await page.route(`**/api/conversations/${id}/archive`, (route) => route.fulfill({ status: 503, json: { detail: "Synthetic rejected archive" } }));
    await page.goto("/");
    await page.getByRole("button", { name: "Manage conversations", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Synthetic rejected archive", exact: true }).check();
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "0 completed, 1 failed" })).toBeVisible();
    await expect(page.locator('[aria-label="Undo conversation action"]')).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Select Synthetic rejected archive", exact: true })).toBeChecked();
    expect(await status(page, id)).toBe("active");
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
  }
});

test("mixed-type search pagination retains the selected document and actual Enter destination", async ({ page }, info) => {
  await preferences(page, false);
  const created: ConversationCreateResponse[] = [];
  try {
    created.push(await createConversation(page, "Synthetic selected message"));
    created.push(await createConversation(page, "Synthetic later annotation"));
    const items: SearchResultItem[] = created.map((item, index) => ({
      document_id: `synthetic-document-${index}`, document_type: index ? "annotation" : "message",
      conversation_id: item.conversation.id, conversation_title: item.conversation.title,
      message_id: item.messages[0].id, role: "user", order_key: null, block_index: 0,
      snippet: "Synthetic grouped pagination", rank: 1, source_profile: null, occurrence_count: 1,
    }));
    await page.route("**/api/search?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("q") !== "SyntheticGrouped") return route.continue();
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return route.fulfill({ json: { query: "SyntheticGrouped", items: [items[offset ? 1 : 0]], total: 2, limit: 50, offset } });
    });
    await page.goto("/search?q=SyntheticGrouped");
    await expect(page.locator("a[data-search-index]")).toHaveCount(1);
    const input = page.getByRole("textbox", { name: "Search", exact: true });
    await input.focus();
    await page.keyboard.press("ArrowDown");
    const selected = page.locator('a[data-search-index][aria-current="true"]');
    const destination = await selected.getAttribute("href");
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    await page.mouse.move(0, 0);
    await expect(page.locator("a[data-search-index]")).toHaveCount(2);
    await expect(selected).toHaveAttribute("href", destination!);
    await expect(selected).toHaveAttribute("data-search-index", "1");
    await page.screenshot({ path: info.outputPath("search-stable-selection.png") });
    await input.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname + url.search === destination);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    for (const item of created) expect((await page.request.delete(`/api/conversations/${item.conversation.id}`)).ok()).toBe(true);
  }
});

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(`${width}px: recent initial and background failures keep recovery, cached anchors and named progress`, async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic recent reading");
    const id = created.conversation.id;
    let fail = true;
    let reads = 0;
    try {
      const recentResponse = await page.request.post(`/api/conversations/${id}/recent`, { data: {
        last_message_id: created.messages[0].id,
        context: { progress: 42, block_index: 0, character_offset: 7 },
      } });
      expect(recentResponse.ok()).toBe(true);
      const recent = await recentResponse.json() as RecentItemRead;
      await page.route("**/api/recent-items", async (route) => {
        reads += 1;
        if (fail) await route.fulfill({ status: 503, json: { detail: "Synthetic technical exception must not render" } });
        else await route.fulfill({ json: [recent] });
      });
      await page.clock.install();
      await page.goto("/recent");
      const initial = page.getByRole("alert").filter({ hasText: zh ? "最近阅读加载失败" : "Could not load recent items" });
      await expect(initial).toBeVisible();
      await expect(page.getByText("Synthetic technical exception must not render", { exact: true })).toHaveCount(0);
      fail = false;
      await initial.getByRole("button", { name: zh ? "重试" : "Retry", exact: true }).click();
      const card = page.getByRole("link").filter({ has: page.getByRole("heading", { name: "Synthetic recent reading", exact: true }) });
      await expect(card).toBeVisible();
      const href = await card.getAttribute("href");
      expect(href).toContain(`messageId=${created.messages[0].id}`);
      expect(href).toContain("characterOffset=7");
      await expect(card.getByRole("progressbar", { name: zh ? "阅读进度" : "Reading progress", exact: true })).toHaveAttribute("aria-valuenow", "42");
      // The app deliberately disables refetch-on-focus. Return through real
      // client navigation after the cached list becomes stale instead.
      await card.click();
      await expect(page).toHaveURL((url) => url.pathname === `/conversations/${id}`);
      await page.clock.fastForward(11_000);
      const previousReads = reads;
      fail = true;
      await page.goBack();
      await expect.poll(() => reads).toBeGreaterThan(previousReads);
      const refreshError = page.getByRole("alert").filter({ hasText: zh ? "最近阅读更新失败" : "Could not update recent items" });
      await expect(refreshError).toBeVisible();
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("href", href!);
      await page.screenshot({ path: info.outputPath(`recent-refresh-${width}.png`) });
      fail = false;
      await refreshError.getByRole("button", { name: zh ? "重试" : "Retry", exact: true }).click();
      await expect(refreshError).toHaveCount(0);
      await expect(card).toHaveAttribute("href", href!);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
    }
  });
}

test("failed project-filter loading retains URL scope through project retry", async ({ page }, info) => {
  await preferences(page, false);
  await page.setViewportSize({ width: 375, height: 900 });
  const response = await page.request.post("/api/projects", { data: { name: "Synthetic filter project" } });
  expect(response.status()).toBe(201);
  const project = await response.json();
  let fail = true;
  let reads = 0;
  try {
    await page.route((url) => url.pathname === "/api/projects", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      reads += 1;
      if (fail) await route.fulfill({ status: 503, json: { detail: "Synthetic project outage" } });
      else await route.continue();
    });
    await page.goto(`/search?q=SyntheticScope&project_id=${project.id}&role=user`);
    const urlBefore = page.url();
    await page.getByRole("button", { name: /^Filters/ }).click();
    const filter = page.getByRole("combobox", { name: "Project", exact: true });
    await expect(filter).toHaveValue(project.id);
    await expect(filter.locator("option:checked")).toHaveText("Current project");
    const alert = page.getByRole("alert").filter({ hasText: "Could not load projects. Your filter is unchanged." });
    await expect(alert).toBeVisible();
    await page.screenshot({ path: info.outputPath("project-filter-error-mobile.png") });
    const previousReads = reads;
    fail = false;
    await alert.getByRole("button", { name: "Retry projects", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect.poll(() => reads).toBeGreaterThan(previousReads);
    await expect(filter).toHaveValue(project.id);
    await expect(filter.locator("option:checked")).toHaveText(project.name);
    await expect(page).toHaveURL(urlBefore);
    await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue("SyntheticScope");
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await page.request.patch(`/api/projects/${project.id}`, { data: { is_archived: true } });
    expect((await page.request.delete(`/api/projects/${project.id}`)).ok()).toBe(true);
  }
});
