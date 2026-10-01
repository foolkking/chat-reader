import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import { readLocal } from "./settings-offline-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, auth and worker");
async function prepare(context: BrowserContext, page: Page, baseURL: string) {
  const headers = { Origin: baseURL }, password = "synthetic cleanup failure passphrase", email = `purge-${Date.now()}@example.test`;
  const response = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email, password, confirm_password: password } });
  expect(response.status()).toBe(201); const userId = (await response.json()).user_id as string;
  const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic signout recovery", messages: [{ role: "user", content_markdown: "Synthetic private question" }, { role: "assistant", content_markdown: "Synthetic private answer" }] } });
  expect(created.status()).toBe(201); const id = (await created.json()).conversation.id as string;
  await page.goto(`${baseURL}/library?conversationId=${id}`);
  await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
  await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(1);
  const names = await page.evaluate(async (userId) => {
    const hex = Array.from(new TextEncoder().encode(userId), (b) => b.toString(16).padStart(2, "0")).join("");
    const suffix = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === userId ? "" : `--user-${hex}`;
    const asset = `chat-reader-offline-assets-v1${suffix}`;
    await (await caches.open(asset)).put("/__synthetic-signout-bytes__", new Response("Synthetic local attachment"));
    await (await caches.open("synthetic-other-account-cache")).put("/__synthetic-other__", new Response("Synthetic retained bytes"));
    return { db: `chat-reader-offline-library${suffix}`, asset };
  }, userId);
  await page.goto(`${baseURL}/recent`);
  const sidebar = page.getByRole("button", { name: "Open sidebar", exact: true });
  await expect(page.getByRole("button", { name: "Settings", exact: true }).or(sidebar).first()).toBeVisible();
  if (!await page.getByRole("button", { name: "Settings", exact: true }).isVisible()) await sidebar.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Account & security/ }).click();
  await expect(page.getByRole("button", { name: "Log out current account", exact: true })).toBeVisible();
  return { id, userId, email, password, ...names };
}

for (const failure of ["database", "cache", "blocked"] as const) test(`signout cleanup recovers from ${failure} deletion failure`, async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!), context = await browser.newContext({ locale: "en-US", viewport: { width: failure === "cache" ? 375 : 1440, height: 900 } });
  try {
    const page = await context.newPage(), seed = await prepare(context, page, baseURL!);
    let staleTab: Page | undefined;
    if (failure === "blocked") {
      await page.evaluate(async (name) => {
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(name); open.onerror = () => reject(open.error);
          open.onsuccess = () => { const db = open.result; (window as typeof window & { restoreCleanup?: () => void }).restoreCleanup = () => db.close(); resolve(); };
        });
      }, seed.db);
    } else {
      const install = ({ failure, asset }: { failure: string; asset: string }) => {
        const removeDb = IDBFactory.prototype.deleteDatabase, removeCache = CacheStorage.prototype.delete;
        if (failure === "database") IDBFactory.prototype.deleteDatabase = () => { throw new DOMException("Synthetic deletion denied", "SecurityError"); };
        else CacheStorage.prototype.delete = function(name) { if (name === asset) return Promise.reject(new DOMException("Synthetic cache denied", "SecurityError")); return removeCache.call(this, name); };
        (window as typeof window & { restoreCleanup?: () => void }).restoreCleanup = () => { IDBFactory.prototype.deleteDatabase = removeDb; CacheStorage.prototype.delete = removeCache; };
      };
      await page.evaluate(install, { failure, asset: seed.asset });
      await page.addInitScript(install, { failure, asset: seed.asset });
    }
    await page.getByRole("button", { name: "Log out current account", exact: true }).click();
    const recovery = page.getByRole("region", { name: "Signout cleanup", exact: true });
    await expect(recovery).toContainText("Some local data could not be cleared");
    if (process.env.SETTINGS_SCREENSHOT_DIR && failure !== "blocked") await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/signout-cleanup-${failure}.png` });
    await expect(page.getByTestId("reader-scroll-root")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
    expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(false);
    if (failure === "database") expect((await readLocal(page, seed.userId)).conversations).toHaveLength(1);
    else if (failure === "blocked") expect(await page.evaluate(async (name) => (await indexedDB.databases()).some((item) => item.name === name), seed.db)).toBe(true);
    else expect(await page.evaluate((name) => caches.has(name), seed.asset)).toBe(true);
    if (failure !== "blocked") {
      await page.goto(`${baseURL}/login`);
      await expect(recovery).toBeVisible();
      if (failure === "database") { staleTab = await context.newPage(); await staleTab.goto(`${baseURL}/login`); await expect(staleTab.getByRole("region", { name: "Signout cleanup", exact: true })).toBeVisible(); }
      await expect(page.locator("#login-password")).toHaveCount(0);
      // Even a separately verified same-account session cannot reopen a database
      // while its recorded deletion still has not completed.
      expect((await context.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email: seed.email, password: seed.password } })).status()).toBe(200);
      await page.goto(`${baseURL}/library?conversationId=${seed.id}`);
      await expect(recovery).toBeVisible(); await expect(page.getByTestId("reader-scroll-root")).toHaveCount(0);
      expect((await context.request.post(`${baseURL}/api/auth/logout`, { headers: { Origin: baseURL! } })).status()).toBe(204);
    }
    await page.evaluate(() => (window as typeof window & { restoreCleanup?: () => void }).restoreCleanup?.());
    await recovery.getByRole("button", { name: "Retry local cleanup", exact: true }).click();
    await expect(page.locator("#login-password")).toBeVisible();
    expect(await page.evaluate(async (name) => (await indexedDB.databases()).some((item) => item.name === name), seed.db)).toBe(false);
    expect(await page.evaluate((name) => caches.has(name), seed.asset)).toBe(false);
    expect(await page.evaluate(() => caches.has("synthetic-other-account-cache"))).toBe(true);
    if (staleTab) {
      expect((await context.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email: seed.email, password: seed.password } })).status()).toBe(200);
      await page.goto(`${baseURL}/library?conversationId=${seed.id}`);
      await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
      await expect.poll(async () => (await readLocal(page, seed.userId)).conversations.length).toBe(1);
      await staleTab.getByRole("button", { name: "Retry local cleanup", exact: true }).click();
      await expect(staleTab.getByRole("region", { name: "Signout cleanup", exact: true })).toHaveCount(0);
      expect((await readLocal(page, seed.userId)).conversations).toHaveLength(1);
    }
  } finally { await context.close(); await admin.dispose(); }
});

test("unavailable browser storage requires explicit discard and preserves cleanup recovery in memory", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!), context = await browser.newContext({ locale: "en-US" });
  try {
    const page = await context.newPage(), seed = await prepare(context, page, baseURL!);
    await page.evaluate(() => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      const tx = IDBDatabase.prototype.transaction, open = IDBFactory.prototype.open, deleteDb = IDBFactory.prototype.deleteDatabase, deleteCache = CacheStorage.prototype.delete;
      const read = IDBObjectStore.prototype.get;
      const denied = () => { throw new DOMException("Synthetic storage disabled", "SecurityError"); };
      Storage.prototype.getItem = denied; Storage.prototype.setItem = denied; Storage.prototype.removeItem = denied;
      IDBDatabase.prototype.transaction = denied; IDBFactory.prototype.open = denied; IDBFactory.prototype.deleteDatabase = denied;
      IDBObjectStore.prototype.get = denied;
      CacheStorage.prototype.delete = () => Promise.reject(new DOMException("Synthetic storage disabled", "SecurityError"));
      (window as typeof window & { restoreCleanup?: () => void }).restoreCleanup = () => {
        Storage.prototype.getItem = get; Storage.prototype.setItem = set; Storage.prototype.removeItem = remove;
        IDBDatabase.prototype.transaction = tx; IDBFactory.prototype.open = open; IDBFactory.prototype.deleteDatabase = deleteDb; CacheStorage.prototype.delete = deleteCache;
        IDBObjectStore.prototype.get = read;
      };
    });
    await page.getByRole("button", { name: "Log out current account", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out with unavailable storage…", exact: true })).toBeVisible();
    expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(true);
    await page.getByRole("button", { name: "Sign out with unavailable storage…", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Sign out without checking local changes?", exact: true });
    await expect(confirm).toContainText("cannot be checked or exported");
    await confirm.getByRole("button", { name: "Discard local changes and sign out", exact: true }).click();
    const recovery = page.getByRole("region", { name: "Signout cleanup", exact: true });
    await expect(recovery).toBeVisible();
    expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(false);
    await page.evaluate(() => (window as typeof window & { restoreCleanup?: () => void }).restoreCleanup?.());
    expect((await readLocal(page, seed.userId)).conversations).toHaveLength(1);
    await recovery.getByRole("button", { name: "Retry local cleanup", exact: true }).click();
    await expect(page.locator("#login-password")).toBeVisible();
    expect((await readLocal(page, seed.userId)).conversations).toHaveLength(0);
    expect(await page.evaluate(() => localStorage.getItem("chat-reader:authenticated-offline-user"))).toBeNull();
    expect(await page.evaluate((name) => caches.has(name), seed.asset)).toBe(false);
  } finally { await context.close(); await admin.dispose(); }
});
