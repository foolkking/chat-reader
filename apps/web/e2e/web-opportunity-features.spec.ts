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
