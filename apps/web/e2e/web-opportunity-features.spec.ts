import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ serviceWorkers: "block" });

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
  await expect(dialog.getByTestId("action-palette-example")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press("Alt+Shift+P");
  await input.fill("synthetic");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/example$/);
});

test("reading list exposes items after the first twenty without mutating them", async ({ page }) => {
  const entries = Array.from({ length: 21 }, (_, index) => ({
    id: `synthetic-entry-${index}`, collection: "reading-list", revision: 1,
    value: { conversation_id: `synthetic-conversation-${index}`, state: "unread" },
    created_at: new Date(Date.UTC(2026, 9, 30, 0, 0, index)).toISOString(),
    updated_at: "2026-10-30T00:00:00Z",
  }));
  const writes: string[] = [];
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().method());
    const path = new URL(route.request().url()).pathname;
    const payload = path === "/api/user-feature-entries/reading-list" ? entries
      : path.startsWith("/api/conversations/synthetic-conversation-")
        ? { id: path.split("/").at(-1), title: "Synthetic reading item" } : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto("/reading-list");
  await expect(page.locator('[data-testid^="reading-list-item-"]')).toHaveCount(20);
  await page.getByRole("button", { name: "Load more (20 / 21)" }).click();
  await expect(page.locator('[data-testid^="reading-list-item-"]')).toHaveCount(21);
  await expect(page.getByRole("button", { name: /Load more/ })).toHaveCount(0);
  expect(writes).toEqual([]);
});

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
