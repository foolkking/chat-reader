import { expect, test } from "@playwright/test";

test("only the library advertises the installable PWA", async ({ browser }) => {
  const context = await browser.newContext();
  const rootPage = await context.newPage();
  await rootPage.goto("/");
  await expect(rootPage.locator('link[rel="manifest"]')).toHaveCount(0);

  const libraryPage = await context.newPage();
  await libraryPage.goto("/library");
  await expect(libraryPage.locator('link[rel="manifest"]')).toHaveAttribute("href", "/library/manifest.webmanifest");
  await context.close();
});

test("keeps the active revision after a failed update and cold-starts offline", async ({ page, context }) => {
  await page.goto("/library");
  await expect(page.getByText(/^可离线启动/).first()).toBeVisible();
  await seedOfflineFixture(page);
  await page.reload();
  await expect(page.getByText("离线测试对话", { exact: true }).first()).toBeVisible();
  await page.locator('input[placeholder="搜索本地正文、代码与批注"]').first().fill("quantumfixture");
  await expect(page.getByText(/quantumfixture 正文内容/).first()).toBeVisible();

  const activeBefore = await readActiveRecord(page);
  expect(activeBefore.revision).toBeTruthy();
  expect(activeBefore.assets).toContain("/library");

  const failedUpdate = await page.evaluate(async (record) => {
    const registration = await navigator.serviceWorker.getRegistration("/library");
    const serviceWorker = registration?.active;
    if (!serviceWorker) throw new Error("Library service worker is not active.");
    return new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => reject(new Error("Timed out waiting for the failed update.")), 60_000);
      channel.port1.onmessage = (event) => {
        if (event.data.type !== "RESULT") return;
        window.clearTimeout(timer);
        resolve(event.data);
      };
      serviceWorker.postMessage({
        type: "PREPARE_LIBRARY_SHELL",
        revision: `broken-${Date.now().toString(36)}`,
        assets: [...record.assets.filter((asset) => asset !== "/library"), "/_next/static/__missing__/broken.css"],
        workerUrl: record.workerUrl,
      }, [channel.port2]);
    });
  }, activeBefore);
  expect(failedUpdate.ok).toBe(false);

  const activeAfter = await readActiveRecord(page);
  expect(activeAfter.revision).toBe(activeBefore.revision);
  await expect(page.getByText(/^可离线启动/).first()).toBeVisible();

  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((item) => item.scope));
  expect(scopes).toEqual(["http://127.0.0.1:3107/library"]);

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const response = await offlinePage.goto("/library?conversationId=offline-fixture", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(offlinePage.locator("h1:visible", { hasText: "离线资料库" }).first()).toBeVisible();
  await expect(offlinePage.getByText(/^可离线启动/).first()).toBeVisible();
  await offlinePage.locator('input[placeholder="搜索本地正文、代码与批注"]').first().fill("quantumfixture");
  await expect(offlinePage.getByText(/quantumfixture 正文内容/).first()).toBeVisible();

  const normalPage = await context.newPage();
  let normalNavigationFailed = false;
  try {
    await normalPage.goto(`/search?offline-check=${Date.now()}`, { timeout: 10_000 });
  } catch {
    normalNavigationFailed = true;
  }
  expect(normalNavigationFailed).toBe(true);
});

test("prepares and cold-starts the library at the mobile PWA viewport", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/library");
  await expect(page.locator("p:visible", { hasText: /^可离线启动/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const response = await offlinePage.goto("/library", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(offlinePage.locator("h1:visible", { hasText: "离线资料库" }).first()).toBeVisible();
  await expect(offlinePage.locator("p:visible", { hasText: /^可离线启动/ })).toBeVisible();
  await context.close();
});

type ActiveRecord = {
  revision: string;
  cacheName: string;
  assets: string[];
  workerUrl: string;
};

async function readActiveRecord(page: import("@playwright/test").Page): Promise<ActiveRecord> {
  return page.evaluate(async () => {
    const cache = await caches.open("chat-reader-library-meta-v1");
    const response = await cache.match("/__chat_reader_library_active__");
    if (!response) throw new Error("The active offline shell record is missing.");
    return response.json();
  });
}

async function seedOfflineFixture(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("chat-reader-offline-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["conversations", "searchDocuments"], "readwrite");
      transaction.objectStore("conversations").put({
        id: "offline-fixture",
        title: "离线测试对话",
        display_title: "离线测试对话",
        description_markdown: "用于验证断网冷启动",
        source_type: "offline",
        source_profile: "test",
        message_count: 0,
        turn_count: 0,
        created_at: "2026-07-26T00:00:00.000Z",
        updated_at: "2026-07-26T00:00:00.000Z",
        imported_at: "2026-07-26T00:00:00.000Z",
        first_user_message: "quantumfixture 正文内容",
        status: "active",
        is_global_pinned: false,
        global_pinned_at: null,
        last_read_at: "2026-07-26T00:00:00.000Z",
        manual_sort_order: 0,
        project_id: null,
        project_name: null,
        offline_revision: 1,
        external_source_id: null,
        parser_version: "test",
        render_version: 1,
        content_hash: "offline-fixture",
        sort_time: "2026-07-26T00:00:00.000Z",
        downloaded_at: "2026-07-26T00:00:00.000Z",
      });
      transaction.objectStore("searchDocuments").put({
        id: "document:offline-fixture",
        conversation_id: "offline-fixture",
        message_id: null,
        document_type: "message",
        role: "user",
        title: "离线测试对话",
        plain_text: "quantumfixture 正文内容",
        search_text: "quantumfixture 正文内容",
        order_key: null,
        turn_index: null,
        metadata: {},
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
}
