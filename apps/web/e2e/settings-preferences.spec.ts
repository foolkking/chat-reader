import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL and authentication");
const password = "synthetic preference passphrase";
async function register(context: BrowserContext, baseURL: string, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.test`;
  const response = await context.request.post(`${baseURL}/api/auth/register`, { headers: { Origin: baseURL }, data: { email, password, confirm_password: password } });
  expect(response.status()).toBe(201);
  return { email, userId: (await response.json()).user_id as string };
}
async function openSettings(page: Page) {
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  const sidebar = page.getByRole("button", { name: "Open sidebar", exact: true });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await page.getByRole("button", { name: "More reading settings", exact: true }).click();
}
async function stored(page: Page, userId: string) {
  return page.evaluate(async (userId) => {
    const hex = Array.from(new TextEncoder().encode(userId), (b) => b.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === userId ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${hex}`;
    return new Promise<{ changes: Record<string, { value: unknown }>; conflicts: Record<string, boolean>; flight?: { request: { operation_id: string } }; attempts: number }>((resolve, reject) => {
      const request = indexedDB.open(name); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction("settings"), value = tx.objectStore("settings").get("account-preferences:v1"); tx.oncomplete = () => { db.close(); resolve(value.result?.value); }; };
    });
  }, userId);
}

for (const choice of ["local", "server"] as const) {
  test(`cross-device field merge and ${choice} conflict choice`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(100_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const a = await browser.newContext({ viewport: { width: choice === "local" ? 375 : 1440, height: 900 }, locale: "en-US" });
    const b = await browser.newContext({ locale: "en-US" });
    try {
      const { email, userId } = await register(a, baseURL!, `fields-${choice}`);
      expect((await b.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(200);
      const pa = await a.newPage(), pb = await b.newPage();
      await pa.goto(`${baseURL}/library`); await openSettings(pa);
      await pb.goto(`${baseURL}/recent`); await openSettings(pb);
      await a.setOffline(true);
      await pa.getByRole("button", { name: "Dark", exact: true }).click();
      await pa.getByRole("button", { name: "Wide", exact: true }).click();
      await expect.poll(async () => Object.keys((await stored(pa, userId)).changes).length).toBe(2);
      await pb.getByRole("button", { name: "System", exact: true }).click();
      await pb.getByRole("button", { name: "Spacious", exact: true }).click();
      await expect.poll(async () => Object.keys((await stored(pb, userId)).changes).length).toBe(0);
      await a.setOffline(false);
      const status = pa.getByRole("region", { name: "Preference sync", exact: true });
      await expect(status.getByRole("group", { name: "Theme", exact: true })).toContainText("Local: dark · Server: system");
      await expect(pa.getByRole("button", { name: "Spacious", exact: true })).toHaveAttribute("aria-pressed", "true");
      const before = await (await a.request.get(`${baseURL}/api/preferences`)).json();
      expect(before.theme_mode).toBe("system"); expect(before.reader_width_mode).toBe("wide"); expect(before.reader_density_mode).toBe("large");
      if (process.env.SETTINGS_SCREENSHOT_DIR) await pa.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/preference-conflict-${choice}.png` });
      await status.getByRole("button", { name: choice === "local" ? "Keep local" : "Use server", exact: true }).click();
      await expect.poll(async () => Object.keys((await stored(pa, userId)).changes).length).toBe(0);
      expect((await (await a.request.get(`${baseURL}/api/preferences`)).json()).theme_mode).toBe(choice === "local" ? "dark" : "system");
      await pa.reload(); await openSettings(pa);
      await expect(pa.getByRole("button", { name: choice === "local" ? "Dark" : "System", exact: true })).toHaveAttribute("aria-pressed", "true");
      expect(await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await a.close(); await b.close(); await admin.dispose(); }
  });
}

for (const scenario of ["lost response", "newer local edit"] as const) {
  test(`preference sync retains ${scenario}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(100_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ locale: "en-US" });
    let release: (() => void) | undefined;
    try {
      const { userId } = await register(context, baseURL!, "receipt");
      const page = await context.newPage(); await page.goto(`${baseURL}/recent`); await openSettings(page);
      const operations: string[] = []; let committed = false;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/preferences/sync", async (route) => {
        operations.push(route.request().postDataJSON().operation_id);
        const response = await route.fetch();
        if (operations.length === 1) { committed = true; if (scenario === "lost response") { await route.abort("failed"); return; } await barrier; }
        await route.fulfill({ response });
      });
      await page.getByRole("button", { name: "Dark", exact: true }).click();
      await expect.poll(() => committed).toBe(true);
      if (scenario === "newer local edit") {
        await page.getByRole("button", { name: "Light", exact: true }).click();
        await expect.poll(async () => (await stored(page, userId)).changes.theme_mode.value).toBe("light"); release!();
      } else {
        await expect.poll(async () => (await stored(page, userId)).attempts).toBe(1);
        await page.reload(); await openSettings(page);
      }
      await expect.poll(async () => Object.keys((await stored(page, userId)).changes).length).toBe(0);
      const saved = await (await context.request.get(`${baseURL}/api/preferences`)).json();
      expect(saved.theme_mode).toBe(scenario === "newer local edit" ? "light" : "dark");
      expect(saved.field_revisions.theme_mode).toBe(scenario === "newer local edit" ? 3 : 2);
      expect(new Set(operations).size).toBe(scenario === "newer local edit" ? 2 : 1);
    } finally { release?.(); await context.close(); await admin.dispose(); }
  });
}

test("legacy preferences migrate only for their owner and only once", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ locale: "en-US" });
  try {
    const a = await register(context, baseURL!, "legacy-a"), page = await context.newPage();
    await page.goto(`${baseURL}/login?reauth=1`);
    await page.evaluate((userId) => {
      localStorage.setItem("chat-reader:offline-active-user-v1", userId);
      localStorage.setItem("chat-reader:user-preferences", JSON.stringify({ theme_mode: "dark", reader_font_size_px: 20, updated_at: "2099-01-01" }));
    }, a.userId);
    await page.goto(`${baseURL}/recent`);
    await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/preferences`)).json()).theme_mode).toBe("dark");
    await openSettings(page);
    await page.getByRole("button", { name: /Account & security/ }).click();
    await page.getByRole("button", { name: "Log out current account", exact: true }).click();
    await expect(page.locator("#login-password")).toBeVisible();
    await register(context, baseURL!, "legacy-b");
    await page.goto(`${baseURL}/recent`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect((await (await context.request.get(`${baseURL}/api/preferences`)).json()).reader_font_size_px).toBe(17);
    await page.evaluate(() => localStorage.setItem("chat-reader:user-preferences", JSON.stringify({ theme_mode: "system", updated_at: "2099-01-01" })));
    expect((await context.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email: a.email, password } })).status()).toBe(200);
    await page.goto(`${baseURL}/recent`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect((await (await context.request.get(`${baseURL}/api/preferences`)).json()).theme_mode).toBe("dark");
  } finally { await context.close(); await admin.dispose(); }
});

test("focus and annotation defaults follow the account into the Reader", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const a = await browser.newContext({ locale: "en-US" }), b = await browser.newContext({ locale: "en-US" });
  try {
    const { email, userId } = await register(a, baseURL!, "defaults");
    const page = await a.newPage(); await page.goto(`${baseURL}/recent`); await openSettings(page);
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await page.getByRole("button", { name: "Docked left", exact: true }).click();
    await expect.poll(async () => Object.keys((await stored(page, userId)).changes).length).toBe(0);
    const created = await a.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: { title: "Synthetic preference reader", messages: [{ role: "user", content_markdown: "Synthetic reader question" }, { role: "assistant", content_markdown: "Synthetic reader answer" }] } });
    expect(created.status()).toBe(201); const id = (await created.json()).conversation.id;
    expect((await b.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(200);
    const reader = await b.newPage(); await reader.goto(`${baseURL}/conversations/${id}?annotations=open`);
    await expect(reader.getByRole("button", { name: "Exit focus mode", exact: true }).first()).toBeVisible();
    await reader.getByRole("button", { name: "Exit focus mode", exact: true }).first().click();
    await reader.getByRole("button", { name: "Annotations", exact: true }).click();
    await expect(reader.getByRole("button", { name: "Return to floating", exact: true })).toBeVisible();
  } finally { await a.close(); await b.close(); await admin.dispose(); }
});

test("stalled preference requests release the sync lock and automatic retries stay bounded", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(110_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ locale: "en-US" });
  let release: (() => void) | undefined;
  try {
    const { userId } = await register(context, baseURL!, "bounded");
    const page = await context.newPage(); await page.goto(`${baseURL}/recent`); await openSettings(page);
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const operations: string[] = [];
    await page.route("**/api/preferences/sync", async (route) => {
      operations.push(route.request().postDataJSON().operation_id);
      if (operations.length === 1) await barrier;
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect.poll(async () => (await stored(page, userId)).attempts, { timeout: 15_000 }).toBe(1);
    // The timed-out HTTP request must no longer monopolize the shared sync lock.
    expect(await page.evaluate(async () => (await navigator.locks.query()).held?.some((lock) => lock.name?.startsWith("chat-reader:sync:")) ?? false)).toBe(false);
    release!();
    await page.clock.install();
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await page.clock.fastForward(31_000);
      await expect.poll(async () => (await stored(page, userId)).attempts).toBe(attempt);
    }
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
    await page.clock.fastForward(60_000);
    expect(operations).toHaveLength(5);
    await page.reload(); await openSettings(page);
    expect((await stored(page, userId)).attempts).toBe(5);
    expect((await stored(page, userId)).changes.theme_mode.value).toBe("dark");
    await page.unroute("**/api/preferences/sync");
    await page.getByRole("button", { name: "Retry preference sync", exact: true }).click();
    await expect.poll(async () => Object.keys((await stored(page, userId)).changes).length).toBe(0);
    const saved = await (await context.request.get(`${baseURL}/api/preferences`)).json();
    expect(saved.theme_mode).toBe("dark"); expect(saved.field_revisions.theme_mode).toBe(2);
    expect(new Set(operations).size).toBe(1);
  } finally { release?.(); await context.close(); await admin.dispose(); }
});

test("local and incoming layout preferences retain the real Reader anchor", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const b = await browser.newContext({ locale: "en-US" });
  try {
    const { email, userId } = await register(a, baseURL!, "layout-anchor");
    const content = Array.from({ length: 400 }, (_, index) => `Synthetic paragraph ${index}. ${"Stable text for layout and reading position. ".repeat(8)}`).join("\n\n");
    const created = await a.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL! }, data: { title: "Synthetic layout anchor", messages: [{ role: "user", content_markdown: "Synthetic anchor question" }, { role: "assistant", content_markdown: content }] } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).conversation.id;
    const messages = await (await a.request.get(`${baseURL}/api/conversations/${id}/message-window?limit=10`)).json();
    const messageId = messages.items[1].id;
    const page = await a.newPage(); await page.goto(`${baseURL}/conversations/${id}?messageId=${messageId}&blockIndex=180&characterOffset=0`);
    const root = page.locator("[data-reader-scroll-root='true']"), frame = page.locator(".reader-frame");
    await expect(page.locator(`#block-${messageId}-180`)).toBeVisible();
    await expect(root).toHaveAttribute("data-navigation-stage", "settled");
    await expect.poll(async () => (await stored(page, userId))?.changes).toEqual({});
    await openSettings(page);
    await root.hover(); await page.mouse.wheel(0, 420);
    await page.waitForTimeout(500);
    const anchor = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']")!;
      const line = root.getBoundingClientRect().top + 120;
      const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-block-index]"));
      const block = blocks.find((node) => { const rect = node.getBoundingClientRect(); return rect.top <= line && rect.bottom >= line; }) ?? blocks.find((node) => node.getBoundingClientRect().top > line)!;
      return { id: block.id, offset: block.getBoundingClientRect().top - line };
    });
    expect(anchor.id).not.toBe("");
    const retained = async () => {
      await expect.poll(() => page.evaluate(({ id, offset }) => {
        const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']")!, block = document.getElementById(id);
        return block ? Math.abs(block.getBoundingClientRect().top - root.getBoundingClientRect().top - 120 - offset) : Infinity;
      }, anchor)).toBeLessThanOrEqual(24);
      await expect(root).not.toHaveAttribute("data-reader-layout-compensating", "true");
    };
    for (const [name, attribute, value] of [["Compact", "data-reader-density", "compact"], ["Spacious", "data-reader-density", "large"], ["Wide", "data-reader-width", "wide"], ["Narrow", "data-reader-width", "compact"]]) {
      await page.getByRole("button", { name, exact: true }).click(); await expect(frame).toHaveAttribute(attribute, value); await retained();
    }
    await page.getByRole("button", { name: "Increase text size", exact: true }).click();
    await expect.poll(() => frame.evaluate((node) => getComputedStyle(node).getPropertyValue("--reader-font-size").trim())).toBe("18px"); await retained();
    await expect.poll(async () => Object.keys((await stored(page, userId)).changes).length).toBe(0);
    expect((await b.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(200);
    const second = await b.newPage(); await second.goto(`${baseURL}/recent`); await openSettings(second);
    await second.getByRole("button", { name: "Comfortable", exact: true }).click();
    await second.getByRole("button", { name: "Standard", exact: true }).click();
    await second.getByRole("button", { name: "Increase text size", exact: true }).click();
    await expect.poll(async () => Object.keys((await stored(second, userId)).changes).length).toBe(0);
    await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(frame).toHaveAttribute("data-reader-density", "comfortable");
    await expect(frame).toHaveAttribute("data-reader-width", "standard");
    await expect.poll(() => frame.evaluate((node) => getComputedStyle(node).getPropertyValue("--reader-font-size").trim())).toBe("19px");
    await retained(); await page.waitForTimeout(1000); await retained();
  } finally { await a.close(); await b.close(); await admin.dispose(); }
});

test("preference-only pending edits are exported and can be synced before signout", async ({ browser, playwright, baseURL }, info) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ locale: "en-US" });
  try {
    const { email, userId } = await register(context, baseURL!, "preference-signout");
    const page = await context.newPage(); await page.goto(`${baseURL}/recent`); await openSettings(page);
    await page.route("**/api/preferences/sync", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect.poll(async () => (await stored(page, userId)).changes.theme_mode?.value).toBe("dark");
    await page.getByRole("button", { name: /Account & security/ }).click();
    await page.getByRole("button", { name: "Log out current account", exact: true }).click();
    const panel = page.getByRole("region", { name: "Handle local changes before signing out", exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.locator("dl")).toContainText("Pending preferences1");
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Export local changes", exact: true }).click();
    const file = info.outputPath("synthetic-preferences.zip"); await (await download).saveAs(file);
    const files = unzipSync(await readFile(file)), changes = JSON.parse(strFromU8(files["changes.json"]));
    expect(changes.preferences.changes.theme_mode.value).toBe("dark");
    expect(strFromU8(files["notes.md"])).toContain('theme_mode: "dark"');
    expect(JSON.stringify(changes)).not.toContain(password);
    expect((await stored(page, userId)).changes.theme_mode.value).toBe("dark");
    await page.unroute("**/api/preferences/sync");
    await panel.getByRole("button", { name: "Sync first", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Continue signing out", exact: true })).toBeVisible();
    expect((await (await context.request.get(`${baseURL}/api/preferences`)).json()).theme_mode).toBe("dark");
    await panel.getByRole("button", { name: "Continue signing out", exact: true }).click();
    await expect(page.locator("#login-password")).toBeVisible();
    expect(await page.evaluate(async () => (await indexedDB.databases()).filter((db) => db.name?.startsWith("chat-reader-offline-library")))).toHaveLength(0);
    expect((await context.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(200);
    await page.goto(`${baseURL}/recent`); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally { await context.close(); await admin.dispose(); }
});

test("failed local preference storage retains the selection and prevents signout until saved", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ locale: "en-US" });
  try {
    const { userId } = await register(context, baseURL!, "preference-quota");
    const page = await context.newPage(); await page.goto(`${baseURL}/recent`); await openSettings(page);
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === "settings" && value?.key === "account-preferences:v1") throw new DOMException("Synthetic preference quota failure", "QuotaExceededError");
        return original.call(this, value, key);
      };
      (window as typeof window & { restorePreferencePut?: () => void }).restorePreferencePut = () => { IDBObjectStore.prototype.put = original; };
    });
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(page.getByRole("region", { name: "Preference sync", exact: true })).toContainText("Local preferences could not be saved");
    await expect(page.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(Object.keys((await stored(page, userId)).changes)).toHaveLength(0);
    await page.getByRole("button", { name: /Account & security/ }).click();
    await page.getByRole("button", { name: "Log out current account", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Local preferences are not saved" })).toBeVisible();
    expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(true);
    await page.evaluate(() => (window as typeof window & { restorePreferencePut?: () => void }).restorePreferencePut?.());
    await page.getByRole("button", { name: "Log out current account", exact: true }).click();
    const panel = page.getByRole("region", { name: "Handle local changes before signing out", exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Sync first", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Continue signing out", exact: true })).toBeVisible();
    expect((await (await context.request.get(`${baseURL}/api/preferences`)).json()).theme_mode).toBe("dark");
  } finally { await context.close(); await admin.dispose(); }
});
