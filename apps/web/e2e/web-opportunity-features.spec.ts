import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ serviceWorkers: "block" });

for (const width of [375, 1440]) {
  test(`comparison panes have independent complete turns and stay read-only at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    const reads: string[] = [];
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
      reads.push(path);
      const side = path.includes("synthetic-left") ? "left" : "right";
      const payload = path.endsWith("/reader-turn") ? {
        conversation_id: `synthetic-${side}`, turn_key: "turn-1", start_offset: 0, end_offset: 1, total_messages: 2,
        items: [{ id: `synthetic-${side}-message`, conversation_id: `synthetic-${side}`, role: "user", order_key: "a", turn_index: 0, block_count: 0, char_count: 0, is_heavy: false, current_version: null, render_blocks: [] }],
        previous_anchor_message_id: null, next_anchor_message_id: `synthetic-${side}-next`,
      } : path.endsWith("/dialogue-index") ? {
        conversation_id: `synthetic-${side}`, items: [], message_count: 2, turn_count: 2,
        limit: 80, offset: 0, total: 0, has_previous: false, has_more: false,
      } : path.endsWith("/toc") ? {
        conversation_id: `synthetic-${side}`, items: [], limit: 200, offset: 0, total: 0, has_more: false,
      } : path.startsWith("/api/conversations/") ? {
        id: `synthetic-${side}`, title: `Synthetic ${side}`, display_title: `Synthetic ${side}`,
      } : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await page.goto("/compare?left=synthetic-left&right=synthetic-right");
    const left = page.getByRole("region", { name: "Left conversation", exact: true });
    const right = page.getByRole("region", { name: "Right conversation", exact: true });
    await expect(left.getByRole("heading", { name: "Synthetic left", exact: true })).toBeVisible();
    if (width < 768) await page.getByRole("button", { name: "Right", exact: true }).click();
    await expect(right.getByRole("heading", { name: "Synthetic right", exact: true })).toBeVisible();
    await expect(right.getByRole("button", { name: "Next turn", exact: true })).toBeEnabled();
    await expect.poll(() => reads.includes("/api/conversations/synthetic-left/reader-turn") && reads.includes("/api/conversations/synthetic-right/reader-turn")).toBe(true);
    const roots = await page.locator("[data-reader-scroll-root]").evaluateAll(elements => elements.map(element => ({
      overflow: getComputedStyle(element).overflowY, height: element.clientHeight,
    })));
    expect(roots).toHaveLength(2);
    expect(roots.filter(root => root.height > 0).every(root => root.overflow === "auto")).toBe(true);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const viewport of [
  { width: 375, height: 812, label: "mobile" },
  { width: 1440, height: 900, label: "desktop" },
]) {
  test(`synthetic example stays read-only and section links work at ${viewport.label} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const writes: string[] = [];
    await page.route("**/api/**", async (route) => {
      const method = route.request().method();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") writes.push(method);
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/example");
    await expect(page.getByRole("heading", { name: "Weekly review: continue or pause?" })).toBeVisible();
    const contents = page.getByRole("navigation", { name: "Example contents" });
    await contents.getByRole("link", { name: /Compare the evidence/ }).click();
    await expect(page).toHaveURL(/#example-evidence$/);
    await expect(page.locator("#example-evidence")).toContainText("Follow-ups completed");
    await expect(page.locator("#example-evidence table")).toBeVisible();
    expect(writes).toEqual([]);
  });
}

test("table export offers manual clipboard recovery and a real CSV download", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Synthetic clipboard denial")) },
    });
  });
  await page.goto("/example");
  await page.getByRole("button", { name: "Copy TSV", exact: true }).click();
  const recovery = page.getByRole("textbox", { name: "Manually copy the selected data:" });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveValue(/Follow-ups completed/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("reader-table.csv");
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, "utf8");
  expect(content.startsWith("\uFEFF")).toBe(true);
  expect(content).toContain("Follow-ups completed");
  expect(content).toContain("\r\n");
});

test("quick actions supports keyboard choice, focus trapping and Escape restoration", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/example");
  const opener = page.getByRole("link", { name: /Compare the evidence/ });
  await opener.focus();
  await page.keyboard.press("Alt+Shift+P");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  const input = dialog.getByRole("combobox", { name: "Search quick actions" });
  await expect(input).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option", { selected: true })).toContainText("Import");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByTestId("action-palette-archived")).toBeFocused();
  await expect(dialog.getByTestId("action-palette-example")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press("Alt+Shift+P");
  await input.fill("recent");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/recent$/);
});

test("reading list pages its summary, clears page selection and makes no per-row detail requests", async ({ page }, testInfo) => {
  const entries = Array.from({ length: 21 }, (_, index) => ({
    id: `synthetic-entry-${index}`, collection: "reading-list", revision: 1,
    value: { conversation_id: `synthetic-conversation-${index}`, state: "unread" },
    created_at: new Date(Date.UTC(2026, 9, 30, 0, 0, index)).toISOString(),
    updated_at: "2026-10-30T00:00:00Z",
  }));
  const writes: string[] = [];
  const details: string[] = [];
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().method());
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.startsWith("/api/conversations/")) details.push(path);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const payload = path === "/api/reading-list" ? {
      items: entries.slice(offset, offset + 20).map(entry => ({ entry, title: `Synthetic reading ${entry.id}`, available: true, projects: [], resume_available: false, last_read_at: null })),
      total: 21, limit: 20, offset, has_more: offset + 20 < 21, counts: { unread: 21, read: 0, all: 21 },
    } : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto("/reading-list");
  await expect(page.locator('[data-testid^="reading-list-item-"]')).toHaveCount(20);
  await page.getByRole("checkbox", { name: "0 selected on this page" }).check();
  await expect(page.getByRole("checkbox", { name: "20 selected on this page" })).toBeChecked();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/offset=20/);
  await expect(page.locator('[data-testid^="reading-list-item-"]')).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "0 selected on this page" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.goto("/recent");
  await page.goBack();
  await expect(page).toHaveURL(/reading-list\?offset=20/);
  await expect(page.locator('[data-testid^="reading-list-item-"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("reading-list-paged.png") });
  expect(writes).toEqual([]);
  expect(details).toEqual([]);
});

test("lost saved-search response is confirmed read-only without creating a second identity", async ({ page }) => {
  const entries: unknown[] = [], identities: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/user-feature-entries/saved-search/") && route.request().method() === "PUT") {
      const input = route.request().postDataJSON();
      const id = path.split("/").at(-1)!;
      identities.push(id);
      entries.push({ id, collection: "saved-search", revision: 1, value: input.value,
        created_at: "2026-10-31T00:00:00Z", updated_at: "2026-10-31T00:00:00Z" });
      return route.abort("failed");
    }
    const payload = path === "/api/user-feature-entries/saved-search" ? entries
      : path === "/api/search" ? { items: [], total: 0, limit: 50, offset: 0 } : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto("/search?q=synthetic");
  await page.getByRole("button", { name: "Save current search", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Synthetic retained search");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check current state", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check current state", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept checked result", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accept checked result", exact: true }).click();
  await expect(page.getByText("Synthetic retained search", { exact: true })).toBeVisible();
  expect(identities).toHaveLength(1);
});

for (const width of [375, 1440]) {
  test(`annotation inbox separates previews, filters every type and keeps orphan links review-only at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [], fullReads: string[] = [];
    const timestamp = "2026-10-31T00:00:00Z";
    const items = ["highlight", "underline", "strikethrough", "comment", "bookmark"].map((kind, index) => ({
      id: `synthetic-annotation-${index}`, conversation_id: "synthetic-inbox-conversation",
      conversation_title: "Synthetic annotation review", annotation_type: kind,
      anchor_status: index === 0 ? "orphaned" : index === 1 ? "needs_review" : index === 2 ? "remapped" : "valid",
      message_id: `synthetic-source-${index}`, message_version_id: `synthetic-version-${index}`,
      start_block_index: 2, revision: 1, created_at: timestamp, updated_at: timestamp,
      quote_preview: `Source excerpt ${index}: ${"摘录🙂".repeat(20)}`,
      comment_preview: `My retained comment ${index}: ${"评论🙂".repeat(25)}`,
      quote_truncated: true, comment_truncated: true,
    }));
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      if (route.request().method() !== "GET") writes.push(path);
      if (path === "/api/annotations/inbox" || /\/api\/annotations\/synthetic/.test(path)) fullReads.push(path);
      let payload: unknown = [];
      if (path === "/api/annotations/inbox/summary") {
        const type = url.searchParams.get("annotation_type"), status = url.searchParams.get("anchor_status");
        const selected = items.filter(item => (!type || item.annotation_type === type)
          && (!status || (status === "attention" ? ["orphaned", "needs_review"].includes(item.anchor_status) : item.anchor_status === status)));
        payload = { items: selected, total: selected.length, limit: 50, offset: 0, has_more: false };
      } else if (path === "/api/projects") payload = [{ id: "synthetic-review-project", name: "Synthetic review project", is_default: false }];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await page.goto("/annotations");
    await expect(page.locator('[data-testid^="annotation-inbox-item-"]')).toHaveCount(5);
    const orphan = page.getByTestId("annotation-inbox-item-synthetic-annotation-0");
    await expect(orphan.locator("blockquote")).toContainText("Source excerpt 0");
    await expect(orphan).toContainText("My retained comment 0");
    const orphanLink = orphan.getByRole("link", { name: "Open annotation for review", exact: true });
    const orphanHref = await orphanLink.getAttribute("href");
    expect(orphanHref).toContain("annotationId=synthetic-annotation-0");
    expect(orphanHref).not.toMatch(/messageId|messageVersionId|blockIndex/);
    const remappedHref = await page.getByTestId("annotation-inbox-item-synthetic-annotation-2")
      .getByRole("link", { name: "Open source and annotation", exact: true }).getAttribute("href");
    expect(remappedHref).toContain("messageId=synthetic-source-2");
    expect(remappedHref).toContain("blockIndex=2");
    await page.screenshot({ path: testInfo.outputPath(`annotation-inbox-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const type of ["highlight", "underline", "strikethrough", "comment", "bookmark"]) {
      await page.getByRole("combobox", { name: "Type", exact: true }).selectOption(type);
      await expect(page.locator('[data-testid^="annotation-inbox-item-"]')).toHaveCount(1);
      await expect(page).toHaveURL(new RegExp(`annotation_type=${type}`));
    }
    await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("");
    await page.getByRole("button", { name: "Review anchor problems", exact: true }).click();
    await expect(page.locator('[data-testid^="annotation-inbox-item-"]')).toHaveCount(2);
    await page.getByRole("combobox", { name: "Project", exact: true }).selectOption("synthetic-review-project");
    await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("created");
    await expect(page).toHaveURL(/project_id=synthetic-review-project/);
    await expect(page).toHaveURL(/sort=created/);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator('[data-testid^="annotation-inbox-item-"]')).toHaveCount(5);
    expect(writes).toEqual([]);
    expect(fullReads).toEqual([]);
  });
}

for (const projectView of [false, true]) {
  test(`merge keyboard ordering follows two canonical title markers in the ${projectView ? "project" : "global"} list`, async ({ page }) => {
    await page.setViewportSize({ width: projectView ? 375 : 1440, height: 900 });
    const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const timestamp = "2026-10-30T00:00:00Z";
    const conversations = ["Synthetic Alpha", "Synthetic Beta"].map((title, index) => ({
      id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index + 1}`,
      title, display_title: title, description_markdown: null,
      first_user_message: `${title} question`, message_count: 2, turn_count: 1,
      status: "active", is_global_pinned: false, manual_sort_order: index,
      project_id: projectView ? projectId : null,
      project_name: projectView ? "Synthetic merge project" : null,
      created_at: timestamp, updated_at: timestamp, imported_at: timestamp,
      last_read_at: null, offline_revision: 1,
      project_relation: { is_pinned: false, pinned_at: null, added_at: timestamp, sort_order: index },
    }));
    const mergeWrites: string[] = [];
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/conversations/merge" && route.request().method() === "POST") mergeWrites.push(path);
      const value = path === "/api/auth/session" ? { authenticated: true, principal_id: "synthetic-owner", auth_mode: "single_password" }
        : path === "/api/auth/capabilities" ? { maximum_merge_message_count: 4, maximum_export_conversation_count: 100 }
          : path === "/api/preferences" ? {
            theme_mode: "light", locale_mode: "en-US", conversation_sort_mode: "recent_read",
            conversation_sort_direction: "desc", project_sort_mode: "custom", project_sort_direction: "asc",
            created_at: timestamp, updated_at: timestamp,
          }
            : path === "/api/projects" ? [{
              id: projectId, name: "Synthetic merge project", description: null, color: null, icon: null,
              is_archived: false, is_default: false, archived_at: null, sort_order: 0,
              conversation_count: 2, pinned_count: 0, created_at: timestamp, updated_at: timestamp, last_read_at: null,
            }]
              : path === "/api/conversations" || path === `/api/projects/${projectId}/conversations` ? conversations : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    });
    await page.goto(projectView ? `/projects/${projectId}` : "/");
    if (projectView) {
      const mobileHeader = page.getByTestId("mobile-page-header");
      const sort = mobileHeader.getByTestId("sort-menu-trigger");
      await sort.click();
      const sortMenu = page.getByTestId("sort-menu-panel");
      await expect(sortMenu).toBeVisible();
      await expect(sortMenu.getByRole("menuitem", { name: "Custom", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(sortMenu).toHaveCount(0);
      await expect(sort).toBeFocused();
    }
    await page.getByRole("button", { name: "Manage conversations", exact: true }).click();
    for (const conversation of conversations) await page.getByRole("checkbox", { name: `Select ${conversation.title}`, exact: true }).check();
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Merge", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Merge conversations", exact: true });
    const titles = dialog.locator("[data-merge-order-title]");
    await expect(titles).toHaveCount(2);
    const readOrder = () => titles.evaluateAll(elements => elements.map(element => element.getAttribute("data-merge-order-title")));
    const before = await readOrder();
    expect([...before].sort()).toEqual(conversations.map(conversation => conversation.title).sort());
    const title = dialog.getByLabel("Merge title", { exact: true });
    await title.fill("Synthetic retained title");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(titles).toHaveCount(2);
    const move = dialog.getByRole("button", { name: `Move down: ${before[0]}`, exact: true });
    await move.focus();
    await page.keyboard.press("Enter");
    await expect.poll(readOrder).toEqual([...before].reverse());
    await expect(titles).toHaveCount(2);
    await expect(title).toHaveValue("Synthetic retained title");
    await expect(dialog.getByRole("button", { name: "Merge 2 conversations", exact: true })).toBeEnabled();
    expect(mergeWrites).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(title).toHaveValue("Synthetic retained title");
    await expect.poll(readOrder).toEqual([...before].reverse());
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
