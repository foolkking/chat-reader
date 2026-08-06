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

test("upgrades an active legacy library worker before preparing the shell", async ({ page, context }) => {
  await context.route("**/legacy-library-sw.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
        self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
      `,
    });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/legacy-library-sw.js", { scope: "/library" });
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error("Legacy library worker did not install.");
    if (worker.state !== "activated") {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Legacy worker activation timed out.")), 15_000);
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") {
            window.clearTimeout(timer);
            resolve();
          }
        });
      });
    }
  });

  await page.goto("/library");
  await expect(page.locator("p:visible", { hasText: /^(可离线启动|Offline ready)/ })).toBeVisible();
  const registration = await page.evaluate(async () => {
    const current = await navigator.serviceWorker.getRegistration("/library");
    return { scriptURL: current?.active?.scriptURL ?? null };
  });
  expect(registration.scriptURL).toBe("http://127.0.0.1:3107/library-sw.js");
});

test("keeps the active revision after a failed update and cold-starts offline", async ({ page, context }) => {
  await page.goto("/library");
  await expect(page.locator("p:visible", { hasText: /^(可离线启动|Offline ready)/ })).toBeVisible();
  await seedOfflineFixture(page);
  await page.reload();
  await expect(page.locator("p:visible", { hasText: /^离线测试对话$/ })).toBeVisible();
  await page.locator('input:visible[placeholder="搜索本地正文、代码与批注"], input:visible[placeholder="Search offline text, code, and annotations"]').fill("quantumfixture");
  await expect(page.locator("button:visible", { hasText: /quantumfixture 正文内容/ })).toBeVisible();

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
  await expect(page.locator("p:visible", { hasText: /^(可离线启动|Offline ready)/ })).toBeVisible();

  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((item) => item.scope));
  expect(scopes).toEqual(["http://127.0.0.1:3107/library"]);

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const response = await offlinePage.goto("/library?conversationId=offline-fixture", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(offlinePage.locator("h1:visible", { hasText: /离线资料库|Offline library/ }).first()).toBeVisible();
  await expect(offlinePage.locator("p:visible", { hasText: /^(可离线启动|Offline ready)/ })).toBeVisible();
  await offlinePage.locator('input:visible[placeholder="搜索本地正文、代码与批注"], input:visible[placeholder="Search offline text, code, and annotations"]').fill("quantumfixture");
  await expect(offlinePage.locator("button:visible", { hasText: /quantumfixture 正文内容/ })).toBeVisible();

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
  await expect(page.locator("p:visible", { hasText: /^(可离线启动|Offline ready)/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const response = await offlinePage.goto("/library", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(offlinePage.locator("h1:visible", { hasText: /离线资料库|Offline library/ }).first()).toBeVisible();
  await expect(offlinePage.locator("p:visible", { hasText: /^(可离线启动|Offline ready)/ })).toBeVisible();
  await context.close();
});

test("mirrors the unified sidebar and keeps preferences compact in library mode", async ({ page }) => {
  await page.goto("/library");
  await seedOfflineFixture(page);
  await arrangeOfflineSidebarFixture(page);
  await page.goto("/library?conversationId=offline-fixture");

  await expect(page.getByRole("heading", { name: /^(项目|Projects)$/, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^(未归类|Unclassified)$/, exact: true })).toBeVisible();
  await expect(page.getByText("离线测试对话", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("未归类离线对话", { exact: true })).toBeVisible();

  const preferencesFooter = page.locator("aside footer").first();
  const heightBefore = await preferencesFooter.evaluate((element) => element.getBoundingClientRect().height);
  await page.getByRole("button", { name: /外观与语言|Appearance & language/ }).click();
  await expect(page.getByRole("dialog", { name: /外观与语言|Appearance & language/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /返回在线版|Back online/ })).toHaveAttribute("href", "/conversations/offline-fixture");
  const heightAfter = await preferencesFooter.evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(heightAfter - heightBefore)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: /关闭|Close/, exact: true }).click();
  await page.goto("/");
  await page.getByRole("button", { name: /外观与语言|Appearance & language/ }).click();
  await expect(page.getByRole("link", { name: /离线资料库|Offline library/ })).toHaveAttribute("href", "/library");
});

test("restores the offline reader frame and target-loads a distant annotation", async ({ page }) => {
  await page.goto("/library");
  await seedOfflineFixture(page);
  await page.goto("/library?conversationId=offline-fixture");

  await expect(page).toHaveTitle("离线测试对话");

  const dialogueIndex = page.getByRole("region", { name: /对话索引|Dialogue index/ });
  await expect(dialogueIndex.getByRole("button", { name: /^U3 · quantumfixture paragraph 5/ })).toBeVisible();
  await expect(dialogueIndex.getByRole("button", { name: /^A3 · quantumfixture paragraph 6/ })).toBeVisible();
  await expect(dialogueIndex).not.toContainText("2026/07/26");

  const restoredBlock = page.locator("#block-offline-message-20-1");
  await expect(restoredBlock).toBeVisible();
  await expect.poll(async () => readingLineDelta(page, "block-offline-message-20-1")).toBeLessThan(36);

  const separator = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(separator).toBeVisible();
  const sidebarBefore = await page.locator("main > aside").first().evaluate((element) => element.getBoundingClientRect().width);
  const box = await separator.boundingBox();
  if (!box) throw new Error("Sidebar resize separator is missing.");
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 80);
  await page.mouse.up();
  const sidebarAfter = await page.locator("main > aside").first().evaluate((element) => element.getBoundingClientRect().width);
  expect(sidebarAfter).toBeGreaterThan(sidebarBefore + 40);

  await page.getByRole("button", { name: /收起侧栏|Collapse sidebar/ }).click();
  await expect(page.getByRole("button", { name: "Open sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(separator).toBeVisible();

  await page.goto("/library?conversationId=offline-fixture&annotations=open");
  await page.getByRole("button", { name: /^(全部批注|All)$/ }).click();
  await expect(page.locator("#annotation-offline-far")).toBeVisible();
  await page.locator("#annotation-offline-far button").first().click();
  await expect.poll(() => page.locator("[data-navigation-stage]").getAttribute("data-navigation-stage"), { timeout: 15_000 }).toBe("resolved");
  const targetBlock = page.locator("#block-offline-message-40-1");
  await expect(targetBlock).toBeVisible();
  await expect.poll(async () => readingLineDelta(page, "block-offline-message-40-1")).toBeLessThan(36);
  await expect.poll(() => hasConnectedAnnotationHighlight(page, "target-annotation-40")).toBe(true);
  await expect(page.locator("#message-offline-message-8")).toHaveCount(0);
  await expect.poll(
    () => page.locator("[data-navigation-stage]").getAttribute("data-navigation-stage"),
    { timeout: 15_000 },
  ).toBe("settled");

  await expect.poll(async () => {
    await page.locator('[data-reader-scroll-root="true"]').evaluate((root) => {
      root.scrollTop = root.scrollHeight;
    });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    return page.locator("#block-offline-message-40-1").count();
  }).toBe(0);
  await page.locator("#annotation-offline-far button").first().click();
  await expect.poll(() => page.locator("[data-navigation-stage]").getAttribute("data-navigation-stage"), { timeout: 15_000 }).toBe("resolved");
  await expect(targetBlock).toBeVisible();
  await expect.poll(() => hasConnectedAnnotationHighlight(page, "target-annotation-40")).toBe(true);

  await page.reload();
  const persistedSidebarWidth = await page.locator("main > aside").first().evaluate((element) => element.getBoundingClientRect().width);
  expect(persistedSidebarWidth).toBeGreaterThan(sidebarBefore + 40);
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
  await expect.poll(() => page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === "chat-reader-offline-library")) return false;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("chat-reader-offline-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const requiredStores = ["conversations", "messages", "blocks", "headings", "searchDocuments", "annotations", "readingPositions"];
    const ready = requiredStores.every((store) => database.objectStoreNames.contains(store));
    database.close();
    return ready;
  })).toBe(true);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("chat-reader-offline-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["conversations", "messages", "blocks", "headings", "searchDocuments", "annotations", "readingPositions"], "readwrite");
      transaction.objectStore("conversations").put({
        id: "offline-fixture",
        title: "离线测试对话",
        display_title: "离线测试对话",
        description_markdown: "用于验证断网冷启动",
        source_type: "offline",
        source_profile: "test",
        message_count: 40,
        turn_count: 20,
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
      for (let index = 1; index <= 40; index += 1) {
        const messageId = `offline-message-${index}`;
        const paragraph = index === 40 ? "prefix target-annotation-40 suffix" : `quantumfixture paragraph ${index}`;
        const displayText = index === 6 ? `2026/07/26 00:06:00\n${paragraph}` : `Section ${index}\n${paragraph}`;
        const contentPreview = index === 5 ? `2026/07/26 00:05:00\n${paragraph}` : index === 6 ? null : paragraph;
        transaction.objectStore("messages").put({
          id: messageId,
          conversation_id: "offline-fixture",
          role: index % 2 ? "user" : "assistant",
          order_key: String(index).padStart(6, "0"),
          turn_index: Math.ceil(index / 2),
          created_at: `2026-07-26T00:${String(index).padStart(2, "0")}:00.000Z`,
          current_version: {
            id: `offline-version-${index}`,
            version_number: 1,
            plain_text: displayText,
            display_text: displayText,
          },
          block_count: index === 40 ? 220 : 2,
          char_count: index === 40 ? 60_000 : paragraph.length + 10,
          is_heavy: index === 40,
          ordinal: index,
          content_preview: contentPreview,
        });
        transaction.objectStore("blocks").put({
          key: `${messageId}:0`,
          id: `offline-block-${index}-0`,
          conversation_id: "offline-fixture",
          message_id: messageId,
          block_index: 0,
          block_type: "heading",
          plain_text: `Section ${index}`,
          data: { text: `Section ${index}`, level: 2 },
        });
        transaction.objectStore("blocks").put({
          key: `${messageId}:1`,
          id: `offline-block-${index}-1`,
          conversation_id: "offline-fixture",
          message_id: messageId,
          block_index: 1,
          block_type: "paragraph",
          plain_text: paragraph,
          data: { text: paragraph },
        });
        if (index === 40) {
          for (let blockIndex = 2; blockIndex < 220; blockIndex += 1) {
            const virtualText = `virtual paragraph ${blockIndex} `.repeat(8);
            transaction.objectStore("blocks").put({
              key: `${messageId}:${blockIndex}`,
              id: `offline-block-${index}-${blockIndex}`,
              conversation_id: "offline-fixture",
              message_id: messageId,
              block_index: blockIndex,
              block_type: "paragraph",
              plain_text: virtualText,
              data: { text: virtualText },
            });
          }
        }
        transaction.objectStore("headings").put({
          id: `offline-heading-${index}`,
          conversation_id: "offline-fixture",
          heading_index: index - 1,
          level: 2,
          text: `Section ${index}`,
          slug: `section-${index}`,
          message_id: messageId,
          message_order_key: String(index).padStart(6, "0"),
          block_index: 0,
        });
      }
      transaction.objectStore("searchDocuments").put({
        id: "document:offline-target",
        conversation_id: "offline-fixture",
        message_id: "offline-message-40",
        document_type: "message",
        role: "assistant",
        title: "离线测试对话",
        plain_text: "prefix target-annotation-40 suffix",
        search_text: "prefix target-annotation-40 suffix",
        order_key: "000040",
        turn_index: 20,
        metadata: { block_index: 1, character_offset: 7 },
      });
      transaction.objectStore("annotations").put({
        id: "offline-far",
        conversation_id: "offline-fixture",
        message_id: "offline-message-40",
        message_version_id: "offline-version-40",
        annotation_type: "highlight",
        color: "yellow",
        start_block_index: 1,
        start_offset: 7,
        end_block_index: 1,
        end_offset: 27,
        quote: "target-annotation-40",
        prefix: "prefix ",
        suffix: " suffix",
        comment_markdown: "Distant annotation fixture",
        anchor_status: "valid",
        revision: 1,
        is_deleted: false,
        conflict_of_id: null,
        metadata: { message_role: "assistant", message_role_number: 20, section_title: "Section 40" },
        created_at: "2026-07-26T01:00:00.000Z",
        updated_at: "2026-07-26T01:00:00.000Z",
      });
      transaction.objectStore("readingPositions").put({
        id: "offline-reading-position",
        conversation_id: "offline-fixture",
        message_id: "offline-message-20",
        block_index: 1,
        scroll_offset: 0,
        anchor_data: { position_mode: "block-relative-v1", order_key: "000020", ordinal: 20, heading_block_index: 0, current_version_id: "offline-version-20" },
        created_at: "2026-07-26T01:00:00.000Z",
        updated_at: "2026-07-26T01:00:00.000Z",
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
}

async function arrangeOfflineSidebarFixture(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("chat-reader-offline-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("conversations", "readwrite");
      const store = transaction.objectStore("conversations");
      const request = store.get("offline-fixture");
      request.onsuccess = () => {
        const fixture = request.result as Record<string, unknown>;
        store.put({ ...fixture, project_id: "offline-project", project_name: "离线项目" });
        store.put({
          ...fixture,
          id: "offline-unclassified",
          title: "未归类离线对话",
          display_title: "未归类离线对话",
          description_markdown: "用于验证未归类列表",
          message_count: 0,
          turn_count: 0,
          project_id: null,
          project_name: null,
          last_read_at: null,
          downloaded_at: "2026-07-25T00:00:00.000Z",
        });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
}

async function hasConnectedAnnotationHighlight(page: import("@playwright/test").Page, quote: string): Promise<boolean> {
  return page.evaluate((expectedQuote) => {
    const registry = (CSS as unknown as { highlights?: { get: (name: string) => unknown } }).highlights;
    const highlight = registry?.get("annotation-highlight-yellow");
    if (highlight) {
      return Array.from(highlight as Iterable<Range>).some((range) =>
        range.commonAncestorContainer.isConnected && range.toString().includes(expectedQuote),
      );
    }
    return Boolean(document.querySelector('[data-annotation-overlay-root] [data-annotation-type="highlight"][data-annotation-color="yellow"]'));
  }, quote);
}

async function readingLineDelta(page: import("@playwright/test").Page, targetId: string): Promise<number> {
  return page.evaluate((id) => {
    const target = document.getElementById(id);
    const root = document.querySelector<HTMLElement>("[data-navigation-stage]") ?? target?.closest<HTMLElement>(".overflow-y-auto");
    if (!target || !root) return Number.POSITIVE_INFINITY;
    return Math.abs(target.getBoundingClientRect().top - (root.getBoundingClientRect().top + 120));
  }, targetId);
}
