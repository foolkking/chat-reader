import { expect, test, type Page } from "@playwright/test";
import type { BackgroundTaskRead, ConversationCreateResponse, ConversationDetail, ProjectConversationRead, ProjectRead, ReadingPositionInput, ReadingPositionRead, RecentItemRead, SearchResultItem } from "../lib/types";

test.use({ trace: "off", actionTimeout: 20_000, serviceWorkers: "block", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_MUTATION_FLOW !== "1", "Requires the isolated mutation API fixture");

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(width + "px: routine autosave stays silent and does not resize the reading viewport", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("chat-reader:offline-guide-dismissed", "true"));
    const created = await createConversation(page, "Synthetic quiet autosave " + width, undefined,
      Array.from({ length: 70 }, (_, index) => `Synthetic quiet reading paragraph ${index + 1}. ${"Keep the reading viewport stable while its position saves. ".repeat(4)}`).join("\n\n"));
    const path = "/api/conversations/" + created.conversation.id;
    const sent: ReadingPositionInput[] = [];
    let hold = true, releaseSync: () => void = () => {};
    const syncGate = new Promise<void>(resolve => { releaseSync = resolve; });
    try {
      const sourceBefore = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
      await page.route(url => url.pathname === path + "/reading-position/sync", async route => {
        if (route.request().method() !== "POST") return route.continue();
        sent.push(route.request().postDataJSON().position as ReadingPositionInput);
        if (hold) await syncGate;
        await route.continue();
      });
      await page.goto(path.replace("/api", ""));
      const reader = page.getByTestId("reader-scroll-root");
      await expect(reader.locator("article[data-message-id]")).toHaveCount(2);
      await expect.poll(() => page.evaluate(() => performance.getEntriesByName("chat-reader:first-content").length)).toBe(1);
      const rootHandle = await reader.elementHandle(); expect(rootHandle).not.toBeNull();
      const boundsBefore = await reader.boundingBox(); expect(boundsBefore).not.toBeNull();
      const feedback = page.getByRole("region", { name: zh ? "阅读进度同步" : "Reading progress sync", exact: true });
      await reader.hover(); await page.mouse.wheel(0, 1100);
      await expect.poll(() => sent.length).toBe(1);
      // Let the pending-state observation render before checking its absence.
      // Keep the hold short: the real sync client has a ten-second timeout.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(feedback).toHaveCount(0);
      const queued = await localReadingSnapshot(page, created.conversation.id);
      expect(queued.pending).toBe(1); expect(queued.position).toMatchObject(sent[0]!);
      const boundsPending = await reader.boundingBox(); expect(boundsPending).not.toBeNull();
      expect(Math.abs(boundsPending!.y - boundsBefore!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(boundsPending!.height - boundsBefore!.height)).toBeLessThanOrEqual(1);
      hold = false; releaseSync();
      await expect.poll(async () => (await localReadingSnapshot(page, created.conversation.id)).pending).toBe(0);
      const stored = await page.request.get(path + "/reading-position"); expect(stored.ok()).toBe(true);
      expect((await stored.json()).position).toMatchObject(sent[0]!);
      await expect(feedback).toHaveCount(0);
      const boundsSaved = await reader.boundingBox(); expect(boundsSaved).not.toBeNull();
      expect(Math.abs(boundsSaved!.y - boundsBefore!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(boundsSaved!.height - boundsBefore!.height)).toBeLessThanOrEqual(1);
      expect(await rootHandle!.evaluate(element => element.isConnected)).toBe(true);
      expect(await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(sourceBefore);
      await reader.screenshot({ path: info.outputPath("quiet-autosave-" + width + ".png") });
    } finally {
      hold = false; releaseSync(); await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  test(width + "px: quiet autosave still exposes real storage failure and an explicit retry", async ({ page }) => {
    await preferences(page, zh); await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic autosave storage recovery " + width, undefined,
      Array.from({ length: 65 }, (_, index) => `Synthetic storage recovery paragraph ${index + 1}. ${"Reading content remains available. ".repeat(5)}`).join("\n\n"));
    const path = "/api/conversations/" + created.conversation.id;
    try {
      await page.goto(path.replace("/api", ""));
      const reader = page.getByTestId("reader-scroll-root"); await expect(reader.locator("article[data-message-id]")).toHaveCount(2);
      await expect.poll(() => page.evaluate(() => performance.getEntriesByName("chat-reader:first-content").length)).toBe(1);
      await page.evaluate(id => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, key) {
          if (this.name === "readingPositions" && value?.conversation_id === id) throw new DOMException("Synthetic scoped reading quota failure", "QuotaExceededError");
          return put.call(this, value, key);
        };
        (window as typeof window & { restoreQuietReadingPut?: () => void }).restoreQuietReadingPut = () => { IDBObjectStore.prototype.put = put; };
      }, created.conversation.id);
      await reader.hover(); await page.mouse.wheel(0, 1000);
      const feedback = page.getByRole("region", { name: zh ? "阅读进度同步" : "Reading progress sync", exact: true });
      await expect(feedback).toContainText(zh ? "阅读进度尚未保存" : "Reading progress could not be saved");
      await expect(reader).toBeVisible(); expect((await localReadingSnapshot(page, created.conversation.id)).pending).toBe(0);
      await page.evaluate(() => (window as typeof window & { restoreQuietReadingPut?: () => void }).restoreQuietReadingPut?.());
      await feedback.getByRole("button", { name: zh ? "重试进度保存与同步" : "Retry saving and syncing progress", exact: true }).click();
      await expect.poll(async () => {
        const response = await page.request.get(path + "/reading-position"); expect(response.ok()).toBe(true);
        return (await response.json()).position?.message_id;
      }).toBe(created.messages[1].id);
      await expect(feedback).toHaveCount(0);
    } finally {
      await page.evaluate(() => (window as typeof window & { restoreQuietReadingPut?: () => void }).restoreQuietReadingPut?.());
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  for (const savedAnchor of [false, true]) {
    test(width + "px: initial body retry preserves " + (savedAnchor ? "the saved anchor" : "the first turn") + " without reopening the conversation", async ({ page }, info) => {
      await preferences(page, zh);
      await page.setViewportSize({ width, height: 900 });
      const created = await createConversation(page, "Synthetic body retry " + width + " " + savedAnchor);
      const path = "/api/conversations/" + created.conversation.id;
      const anchor = savedAnchor ? created.messages[1].id : null;
      const reads: (string | null)[] = [];
      let failRead = true, holdRead = false, heldReads = 0, recentPosts = 0, detailReads = 0;
      let releaseRead: () => void = () => {};
      const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
      try {
        if (anchor) expect((await page.request.put(path + "/reading-position", { data: {
          message_id: anchor, block_index: null, scroll_offset: 0, anchor_data: {},
        } })).ok()).toBe(true);
        const messages = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
        await page.route(url => url.pathname === path + "/reader-turn", async route => {
          if (route.request().method() !== "GET") return route.continue();
          reads.push(new URL(route.request().url()).searchParams.get("anchor_message_id"));
          if (holdRead) { heldReads += 1; await readGate; }
          if (failRead) await route.fulfill({ status: 503, json: { detail: "Synthetic raw initial body outage" } });
          else await route.continue();
        });
        await page.route(url => url.pathname === path + "/recent", async route => {
          if (route.request().method() === "POST") recentPosts += 1;
          await route.continue();
        });
        await page.route(url => url.pathname === path, async route => {
          if (route.request().method() === "GET") detailReads += 1;
          await route.continue();
        });
        await page.goto(path.replace("/api", ""));
        const reader = page.getByTestId("reader-scroll-root");
        const originalRoot = await reader.elementHandle();
        expect(originalRoot).not.toBeNull();
        const error = reader.locator("[data-reader-initial-read-recovery]");
        await expect(error).toContainText(zh ? "暂时无法读取正文" : "Could not read the messages");
        await expect(reader.locator("article[data-message-id]")).toHaveCount(0);
        await expect(page.getByText("Synthetic raw initial body outage", { exact: true })).toHaveCount(0);
        await expect.poll(() => recentPosts).toBe(1);
        expect(reads.length).toBeGreaterThan(0); expect(reads.every(value => value === anchor)).toBe(true);
        await error.screenshot({ path: info.outputPath("initial-body-failed-" + width + "-" + savedAnchor + ".png") });
        const readsBefore = reads.length, detailBefore = detailReads;
        failRead = false; holdRead = true;
        const retry = error.getByRole("button", { name: zh ? "重试读取正文" : "Retry messages", exact: true });
        await retry.focus(); await retry.press("Enter");
        await expect.poll(() => heldReads).toBe(1);
        await expect(reader).toContainText(zh ? "正在获取首屏对话内容。" : "Fetching the initial conversation content.");
        await expect(reader.locator("article[data-message-id]")).toHaveCount(0);
        expect(reads).toHaveLength(readsBefore + 1); expect(reads.at(-1)).toBe(anchor);
        expect(recentPosts).toBe(1); expect(detailReads).toBe(detailBefore);
        releaseRead();
        await expect(error).toHaveCount(0);
        await expect(reader.locator("article[data-message-id]")).toHaveCount(2);
        await expect(reader.locator('article[data-message-id="' + created.messages[0].id + '"]')).toContainText(created.conversation.title + " synthetic question");
        await expect(reader.locator('article[data-message-id="' + created.messages[1].id + '"]')).toContainText(created.conversation.title + " synthetic answer");
        await expect(reader).toBeFocused();
        expect(await originalRoot!.evaluate(element => element.isConnected)).toBe(true);
        expect(recentPosts).toBe(1); expect(detailReads).toBe(detailBefore);
        expect(await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(messages);
        expect(page.url()).toBe(new URL(path.replace("/api", ""), page.url()).href);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        failRead = false; holdRead = false; releaseRead();
        await page.unrouteAll({ behavior: "wait" });
        expect((await page.request.delete(path)).ok()).toBe(true);
      }
    });
  }

  test(width + "px: successful index navigation retires an obsolete initial body error", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const title = "Synthetic initial body navigation " + width;
    const created = await createConversation(page, title, undefined, title + " synthetic answer\n\n" +
      Array.from({ length: 45 }, (_, index) => `Synthetic navigation paragraph ${index + 1}. ${"A recovered reading position still saves. ".repeat(4)}`).join("\n\n"));
    const path = "/api/conversations/" + created.conversation.id;
    let initialReads = 0, targetReads = 0, recentPosts = 0;
    const positions: ReadingPositionInput[] = [];
    try {
      await page.route(url => url.pathname === path + "/reader-turn", async route => {
        if (route.request().method() !== "GET") return route.continue();
        const anchor = new URL(route.request().url()).searchParams.get("anchor_message_id");
        if (!anchor) {
          initialReads += 1;
          await route.fulfill({ status: 503, json: { detail: "Synthetic initial body remains unavailable" } });
        } else { targetReads += 1; await route.continue(); }
      });
      await page.route(url => url.pathname === path + "/recent", async route => {
        if (route.request().method() === "POST") recentPosts += 1;
        await route.continue();
      });
      await page.route(url => url.pathname === path + "/reading-position/sync", async route => {
        if (route.request().method() === "POST") positions.push(route.request().postDataJSON().position as ReadingPositionInput);
        await route.continue();
      });
      await page.goto(path.replace("/api", ""));
      const reader = page.getByTestId("reader-scroll-root");
      const error = reader.locator("[data-reader-initial-read-recovery]");
      await expect(error).toBeVisible();
      const originalRoot = await reader.elementHandle(); expect(originalRoot).not.toBeNull();
      const previousInitialReads = initialReads;
      if (width < 768) await page.getByRole("button", { name: zh ? "阅读导航" : "Reader navigation", exact: true }).click();
      else await page.locator(".dialogue-index-rail").getByRole("button").first().click();
      const index = page.getByRole("region", { name: zh ? "对话索引" : "Dialogue index", exact: true }).filter({ visible: true });
      await index.getByRole("button").filter({ hasText: created.conversation.title + " synthetic answer" }).click();
      await expect(reader.locator('article[data-message-id="' + created.messages[1].id + '"]')).toContainText(created.conversation.title + " synthetic answer");
      await expect(reader.locator("article[data-message-id]")).toHaveCount(2);
      await expect(error).toHaveCount(0);
      await expect(page.getByRole("button", { name: zh ? "重试读取正文" : "Retry messages", exact: true })).toHaveCount(0);
      await expect.poll(() => targetReads).toBeGreaterThan(0);
      await expect.poll(() => recentPosts).toBe(1);
      expect(initialReads).toBe(previousInitialReads);
      expect(await originalRoot!.evaluate(element => element.isConnected)).toBe(true);
      await expect(reader).toHaveAttribute("data-navigation-stage", "settled");
      await expect.poll(() => page.evaluate(() => performance.getEntriesByName("chat-reader:first-content").length)).toBe(1);
      const positionsBefore = positions.length;
      await reader.hover(); await page.mouse.wheel(0, 360);
      await expect.poll(() => positions.length).toBeGreaterThan(positionsBefore);
      expect(positions.at(-1)!.message_id).toBe(created.messages[1].id);
      await expect.poll(async () => {
        const response = await page.request.get(path + "/reading-position"); expect(response.ok()).toBe(true);
        return (await response.json()).position?.anchor_data;
      }).toEqual(positions.at(-1)!.anchor_data);
      await expect(page.getByRole("region", { name: zh ? "阅读进度同步" : "Reading progress sync", exact: true })).toHaveCount(0);
      expect(initialReads).toBe(previousInitialReads);
      await reader.screenshot({ path: info.outputPath("initial-error-retired-after-navigation-" + width + ".png") });
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  test(width + "px: failed Reader detail refresh keeps the same reading DOM and retries only its read", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic retained Reader " + width, undefined,
      Array.from({ length: 60 }, (_, index) => `Synthetic reading paragraph ${index + 1}. The same reading node must remain available through a failed detail refresh.`).join("\n\n"));
    const path = "/api/conversations/" + created.conversation.id;
    let failDetail = false, holdDetail = false, heldReads = 0, detailReads = 0, recentPosts = 0, renameWrites = 0;
    let releaseRead: () => void = () => {};
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    try {
      const messages = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
      await page.route(url => url.pathname === path, async route => {
        if (route.request().method() === "GET") {
          detailReads += 1;
          if (holdDetail) { heldReads += 1; await readGate; }
          if (failDetail) { await route.fulfill({ status: 503, json: { detail: "Synthetic raw detail outage" } }); return; }
        } else if (route.request().method() === "PATCH") renameWrites += 1;
        await route.continue();
      });
      await page.route(url => url.pathname === path + "/recent", async route => {
        if (route.request().method() === "POST") recentPosts += 1;
        await route.continue();
      });
      await page.goto(path.replace("/api", ""));
      await expect(page.locator("[data-reader-main-section]").getByRole("heading", { name: created.conversation.title, exact: true }).filter({ visible: true })).toBeVisible();
      const expand = page.getByRole("button", { name: zh ? "打开侧栏" : "Open sidebar", exact: true }).filter({ visible: true });
      if (width >= 768 && await expand.count()) await expand.click();
      const reader = page.getByTestId("reader-scroll-root");
      const article = reader.locator('article[data-message-id="' + created.messages[1].id + '"]');
      await expect(article).toContainText("Synthetic reading paragraph 1");
      const originalRoot = await reader.elementHandle(), originalArticle = await article.elementHandle();
      expect(originalRoot).not.toBeNull(); expect(originalArticle).not.toBeNull();
      await reader.hover(); await page.mouse.wheel(0, 500);
      await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
      if (width < 768) {
        // A real upward gesture reveals the mobile header before opening its sidebar.
        // Record the preserved position only after that deliberate user movement.
        const downPosition = await reader.evaluate(element => element.scrollTop);
        await page.mouse.wheel(0, -80);
        await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeLessThan(downPosition);
        await expect(expand).toBeInViewport();
      }
      const scrollBefore = await reader.evaluate(element => element.scrollTop);
      await expect.poll(() => recentPosts).toBe(1);
      if (width < 768 && await expand.count()) await expand.click();
      const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
      await sidebar.getByRole("button", { name: (zh ? "管理 " : "Manage ") + created.conversation.title, exact: true }).click();
      await page.getByRole("menuitem", { name: zh ? "重命名对话" : "Rename conversation", exact: true }).click();
      const editor = page.getByRole("dialog", { name: zh ? "重命名对话" : "Rename conversation", exact: true });
      await editor.getByLabel(zh ? "对话标题" : "Conversation title", { exact: true }).fill("Synthetic recovered Reader " + width);
      failDetail = true;
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await closeMobileSidebar(page);
      const notice = page.locator("[data-reader-read-recovery]");
      await expect(notice).toContainText(zh ? "仍显示上次读取的内容" : "Previously loaded content");
      await expect(reader).toBeVisible();
      expect(await originalRoot!.evaluate(element => element.isConnected)).toBe(true);
      expect(await originalArticle!.evaluate(element => element.isConnected)).toBe(true);
      await expect.poll(async () => Math.abs(await reader.evaluate(element => element.scrollTop) - scrollBefore)).toBeLessThan(3);
      await expect(page).toHaveTitle(new RegExp("Synthetic recovered Reader " + width));
      await expect(page.getByText("Synthetic raw detail outage", { exact: true })).toHaveCount(0);
      await notice.screenshot({ path: info.outputPath("reader-detail-retained-" + width + ".png") });
      const readsBeforeRetry = detailReads;
      failDetail = false; holdDetail = true;
      const retry = notice.getByRole("button", { name: zh ? "重试读取对话" : "Retry conversation", exact: true });
      await retry.focus(); await retry.press("Enter");
      await expect.poll(() => heldReads).toBe(1);
      await expect(retry).toBeDisabled(); await expect(notice).toHaveAttribute("aria-busy", "true");
      expect(await originalArticle!.evaluate(element => element.isConnected)).toBe(true);
      expect(detailReads).toBe(readsBeforeRetry + 1); expect(recentPosts).toBe(1); expect(renameWrites).toBe(1);
      releaseRead();
      await expect(notice).toHaveCount(0); await expect(reader).toBeFocused();
      expect(await originalRoot!.evaluate(element => element.isConnected)).toBe(true);
      expect(await originalArticle!.evaluate(element => element.isConnected)).toBe(true);
      await expect.poll(async () => Math.abs(await reader.evaluate(element => element.scrollTop) - scrollBefore)).toBeLessThan(3);
      expect(recentPosts).toBe(1); expect(renameWrites).toBe(1);
      expect(await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(messages);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      failDetail = false; holdDetail = false; releaseRead();
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  test(width + "px: initial Reader detail failure recovers with a read before its first recent open", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic initial Reader retry " + width);
    const path = "/api/conversations/" + created.conversation.id;
    let failDetail = true, holdDetail = false, heldReads = 0, recentPosts = 0;
    let releaseRead: () => void = () => {};
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    try {
      await page.route(url => url.pathname === path, async route => {
        if (route.request().method() === "GET") {
          if (holdDetail) { heldReads += 1; await readGate; }
          if (failDetail) { await route.fulfill({ status: 503, json: { detail: "Synthetic raw initial outage" } }); return; }
        }
        await route.continue();
      });
      await page.route(url => url.pathname === path + "/recent", async route => {
        if (route.request().method() === "POST") recentPosts += 1;
        await route.continue();
      });
      await page.goto(path.replace("/api", ""));
      const retry = page.getByRole("button", { name: zh ? "重试读取对话" : "Retry conversation", exact: true });
      await expect(retry).toBeVisible();
      await expect(page.getByTestId("reader-scroll-root")).toHaveCount(0);
      await expect(page.getByText("Synthetic raw initial outage", { exact: true })).toHaveCount(0);
      expect(recentPosts).toBe(0);
      await page.screenshot({ path: info.outputPath("reader-detail-initial-" + width + ".png") });
      failDetail = false; holdDetail = true;
      await retry.focus(); await retry.press("Enter");
      await expect.poll(() => heldReads).toBe(1); await expect(retry).toHaveCount(0);
      expect(recentPosts).toBe(0);
      releaseRead();
      const reader = page.getByTestId("reader-scroll-root");
      await expect(reader).toBeVisible(); await expect(reader).toBeFocused();
      await expect(reader.locator('article[data-message-id="' + created.messages[1].id + '"]')).toContainText(created.conversation.title + " synthetic answer");
      await expect.poll(() => recentPosts).toBe(1);
      await expect(page.locator("[data-reader-read-recovery]")).toHaveCount(0);
    } finally {
      failDetail = false; holdDetail = false; releaseRead();
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  for (const outcome of ["late", "lost"] as const) {
    test(width + "px: " + outcome + " recent-open response preserves a renamed Reader and records only once", async ({ page }, info) => {
      await preferences(page, zh);
      await page.setViewportSize({ width, height: 900 });
      const created = await createConversation(page, "Synthetic recent Reader " + outcome + " " + width);
      const path = "/api/conversations/" + created.conversation.id;
      const renamedTitle = "Synthetic renamed recent Reader " + width;
      const insertRequests: unknown[] = [];
      let recentPosts = 0, recentFailures = 0, recordedRevision = 0, renamedRevision = 0;
      let holdReads = false, heldReads = 0;
      let releaseRecent: () => void = () => {}, releaseReads: () => void = () => {};
      const recentGate = new Promise<void>(resolve => { releaseRecent = resolve; });
      const readGate = new Promise<void>(resolve => { releaseReads = resolve; });
      try {
        const messages = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
        const beforeResponse = await page.request.get("/api/recent-items");
        expect(beforeResponse.ok()).toBe(true);
        const before = await beforeResponse.json() as RecentItemRead[];
        const previousCount = before.find(item => item.conversation_id === created.conversation.id)?.open_count ?? 0;
        page.on("requestfailed", request => {
          if (new URL(request.url()).pathname === path + "/recent" && request.method() === "POST") recentFailures += 1;
        });
        await page.route(url => url.pathname === path + "/recent", async route => {
          if (route.request().method() !== "POST") return route.continue();
          recentPosts += 1;
          // Let the real fixture count the open; delay or lose only its reply.
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          const opened = await response.json() as RecentItemRead;
          recordedRevision = opened.conversation.offline_revision;
          if (outcome === "late") { await recentGate; await route.fulfill({ response }); }
          else await route.abort("failed");
        });
        await page.route(url => [path, "/api/conversations", "/api/projects", "/api/recent-items"].includes(url.pathname), async route => {
          if (route.request().method() === "PATCH" && new URL(route.request().url()).pathname === path) {
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
            renamedRevision = (await response.json() as ConversationDetail).offline_revision;
            // Do not let a fresh GET hide a stale response overwriting the cache.
            holdReads = true;
            await route.fulfill({ response });
          } else {
            if (holdReads && route.request().method() === "GET") { heldReads += 1; await readGate; }
            await route.continue();
          }
        });
        await page.route(url => url.pathname === path + "/messages/insert", async route => {
          if (route.request().method() !== "POST") return route.continue();
          insertRequests.push(route.request().postDataJSON());
          // Inspect the real dialog's revision contract without inserting data.
          await route.fulfill({ status: 503, json: { detail: "Synthetic insert is intentionally not applied" } });
        });
        await page.goto(path.replace("/api", ""));
        const title = page.locator("[data-reader-main-section]").getByRole("heading", { name: created.conversation.title, exact: true }).filter({ visible: true });
        await expect(title).toBeVisible();
        await expect.poll(() => recordedRevision).toBe(created.conversation.offline_revision);
        if (outcome === "lost") await expect.poll(() => recentFailures).toBe(1);
        const expand = page.getByRole("button", { name: zh ? "打开侧栏" : "Open sidebar", exact: true }).filter({ visible: true });
        if (await expand.count()) await expand.click();
        const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
        await sidebar.getByRole("button", { name: (zh ? "管理 " : "Manage ") + created.conversation.title, exact: true }).click();
        await page.getByRole("menuitem", { name: zh ? "重命名对话" : "Rename conversation", exact: true }).click();
        const editor = page.getByRole("dialog", { name: zh ? "重命名对话" : "Rename conversation", exact: true });
        await editor.getByLabel(zh ? "对话标题" : "Conversation title", { exact: true }).fill(renamedTitle);
        await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
        await expect(editor).toHaveCount(0);
        await expect(page).toHaveTitle(new RegExp(renamedTitle));
        expect(renamedRevision).toBeGreaterThan(recordedRevision);
        await expect.poll(() => heldReads).toBeGreaterThan(0);
        if (outcome === "late") {
          const readsBeforeRecent = heldReads;
          releaseRecent();
          // The callback's list invalidations establish that it ran in the page.
          await expect.poll(() => heldReads).toBeGreaterThan(readsBeforeRecent);
        }
        await closeMobileSidebar(page);
        const firstMessage = page.locator('article[data-message-id="' + created.messages[0].id + '"]');
        if (width < 640) await firstMessage.getByTestId("mobile-message-actions-trigger").click();
        else await firstMessage.hover();
        await firstMessage.getByRole("button", { name: zh ? "在此处插入消息" : "Insert message here", exact: true }).filter({ visible: true }).click();
        const insert = page.getByRole("dialog", { name: zh ? "插入消息" : "Insert messages", exact: true });
        await insert.getByLabel(zh ? "消息内容" : "Message content", { exact: true }).fill("Synthetic revision probe, never persisted");
        await insert.getByRole("button", { name: zh ? "插入消息" : "Insert messages", exact: true }).click();
        // The API client deliberately maps 503 to safe generic copy, even when
        // the upstream fixture includes a more detailed diagnostic.
        await expect(insert.getByRole("alert")).toHaveText("服务暂时不可用，请稍后重试。");
        await expect(insert).not.toContainText("Synthetic insert is intentionally not applied");
        expect(insertRequests).toEqual([expect.objectContaining({
          expected_offline_revision: renamedRevision, anchor_message_id: created.messages[0].id,
        })]);
        expect(recentPosts).toBe(1);
        const afterResponse = await page.request.get("/api/recent-items");
        expect(afterResponse.ok()).toBe(true);
        const after = await afterResponse.json() as RecentItemRead[];
        expect(after.find(item => item.conversation_id === created.conversation.id)?.open_count).toBe(previousCount + 1);
        expect(await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(messages);
        expect((await (await page.request.get(path)).json()).offline_revision).toBe(renamedRevision);
        await insert.screenshot({ path: info.outputPath("recent-" + outcome + "-revision-probe-" + width + ".png") });
      } finally {
        holdReads = false; releaseRecent(); releaseReads();
        await page.unrouteAll({ behavior: "wait" });
        expect((await page.request.delete(path)).ok()).toBe(true);
      }
    });
  }
}

async function createPlacementFixture(page: Page, name: string, longReader = false) {
  const projects: ProjectRead[] = [];
  let conversation: ConversationCreateResponse | undefined;
  try {
    for (const suffix of ["source", "target", "another"]) {
      const response = await page.request.post("/api/projects", { data: { name: name + " " + suffix } });
      expect(response.status()).toBe(201);
      projects.push(await response.json() as ProjectRead);
    }
    const response = await page.request.post("/api/conversations", { data: {
      title: name + " conversation", project_id: projects[0].id,
      messages: [{ role: "user", content_markdown: name + " synthetic question" }, {
        role: "assistant", content_markdown: longReader
          ? Array.from({ length: 60 }, (_, index) => `Synthetic reading paragraph ${index + 1}. This is disposable test content for a stable reading position.`).join("\n\n")
          : name + " synthetic answer",
      }],
    } });
    expect(response.status()).toBe(201);
    conversation = await response.json() as ConversationCreateResponse;
    return { projects, conversation };
  } catch (error) {
    await removePlacementFixture(page, { projects, conversation });
    throw error;
  }
}

async function removePlacementFixture(page: Page, fixture: { projects: ProjectRead[]; conversation?: ConversationCreateResponse }) {
  if (fixture.conversation) expect((await page.request.delete("/api/conversations/" + fixture.conversation.conversation.id)).ok()).toBe(true);
  for (const project of fixture.projects) {
    expect((await page.request.patch("/api/projects/" + project.id, { data: { is_archived: true } })).ok()).toBe(true);
    expect((await page.request.delete("/api/projects/" + project.id)).ok()).toBe(true);
  }
}

async function openPlacementFromProject(page: Page, fixture: Awaited<ReturnType<typeof createPlacementFixture>>, zh: boolean) {
  await page.getByTestId("project-conversation-sortable-row-" + fixture.conversation.conversation.id)
    .getByRole("button", { name: (zh ? "管理 " : "Manage ") + fixture.conversation.conversation.title, exact: true }).click();
  await page.getByRole("menuitem", { name: zh ? "移动到项目" : "Move to project", exact: true }).click();
  return page.getByRole("dialog", { name: zh ? "移动对话" : "Move conversation", exact: true });
}

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(width + "px: placement picker recovers project reads and clears hidden or old selections", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 780 });
    const fixture = await createPlacementFixture(page, "Synthetic picker " + width);
    let failRead = true, reads = 0, writes = 0;
    try {
      await page.route(url => url.pathname === "/api/projects", async route => {
        if (route.request().method() !== "GET") return route.continue();
        reads += 1;
        if (failRead) await route.fulfill({ status: 503, json: { detail: "Synthetic destination read outage" } });
        else await route.continue();
      });
      await page.route(url => url.pathname.endsWith("/placement"), async route => { if (route.request().method() === "PUT") writes += 1; await route.continue(); });
      // Intercept before the page can populate the shared, briefly fresh
      // projects cache; opening a picker need not refetch a fresh success.
      await page.goto("/projects/" + fixture.projects[0].id);
      await expect(page.getByTestId("project-conversation-sortable-row-" + fixture.conversation.conversation.id)).toBeVisible();
      const picker = await openPlacementFromProject(page, fixture, zh);
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(picker.getByRole("alert")).toContainText(zh ? "项目读取失败" : "Could not read projects");
      await expect(picker.getByRole("button", { name: zh ? "移动到所选项目" : "Move to selected project", exact: true })).toBeDisabled();
      await picker.screenshot({ path: info.outputPath("placement-project-read-failed-" + width + ".png") });
      const readCount = reads; failRead = false;
      await picker.getByRole("button", { name: zh ? "重试读取项目" : "Retry projects", exact: true }).click();
      await expect.poll(() => reads).toBeGreaterThan(readCount);
      const search = picker.getByLabel(zh ? "搜索项目" : "Search projects", { exact: true });
      await search.fill("target");
      await search.press("Home"); await expect(search).toBeFocused();
      expect(await search.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(0);
      await search.press("End"); expect(await search.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(6);
      await picker.getByRole("radio", { name: fixture.projects[1].name, exact: true }).check();
      await search.fill("another");
      await expect(picker.getByRole("button", { name: zh ? "移动到所选项目" : "Move to selected project", exact: true })).toBeDisabled();
      await search.fill("no synthetic match");
      await expect(picker).toContainText(zh ? "没有匹配的项目" : "No matching projects");
      await picker.getByRole("button", { name: zh ? "清除搜索" : "Clear search", exact: true }).click();
      await picker.getByRole("radio", { name: fixture.projects[1].name, exact: true }).check();
      await search.press("Escape"); await expect(picker).toHaveCount(0);
      await openPlacementFromProject(page, fixture, zh);
      await expect(search).toHaveValue("");
      await expect(picker.locator('input[type="radio"]:checked')).toHaveCount(0);
      expect(writes).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await removePlacementFixture(page, fixture);
    }
  });

  test(width + "px: sidebar placement acknowledges before held reads and preserves the Reader", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await createPlacementFixture(page, "Synthetic Reader placement " + width, true);
    const path = "/api/conversations/" + fixture.conversation.conversation.id;
    const writes: unknown[] = [];
    let holdReads = false, heldReads = 0;
    let releaseWrite: () => void = () => {}, releaseReads: () => void = () => {};
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    const readGate = new Promise<void>(resolve => { releaseReads = resolve; });
    try {
      const messages = await Promise.all(fixture.conversation.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
      await page.route(url => url.pathname === path + "/placement", async route => {
        writes.push(route.request().postDataJSON()); await writeGate;
        const response = await route.fetch(); expect(response.ok()).toBe(true); holdReads = true;
        await route.fulfill({ response });
      });
      await page.route(url => [path, "/api/conversations", "/api/projects", "/api/recent-items"].includes(url.pathname)
        || url.pathname.startsWith("/api/projects/") && url.pathname.endsWith("/conversations"), async route => {
        if (holdReads && route.request().method() === "GET") { heldReads += 1; await readGate; }
        await route.continue();
      });
      await page.goto(path.replace("/api", "") + "?projectId=" + fixture.projects[0].id);
      await expect(page.locator("[data-reader-main-section]").getByRole("heading", { name: fixture.conversation.conversation.title, exact: true }).filter({ visible: true })).toBeVisible();
      const readerUrl = page.url(), scroll = page.getByTestId("reader-scroll-root");
      await scroll.hover(); await page.mouse.wheel(0, 500);
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
      const expand = page.getByRole("button", { name: zh ? "打开侧栏" : "Open sidebar", exact: true }).filter({ visible: true });
      if (width < 768) {
        const downPosition = await scroll.evaluate(element => element.scrollTop);
        await page.mouse.wheel(0, -80);
        await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeLessThan(downPosition);
        await expect(expand).toBeInViewport();
      }
      const scrollBefore = await scroll.evaluate(element => element.scrollTop);
      if (await expand.count()) await expand.click();
      const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
      const row = sidebar.getByTestId("conversation-row-" + fixture.conversation.conversation.id);
      if (!await row.count()) await sidebar.getByRole("button", { name: "Expand " + fixture.projects[0].name, exact: true }).click();
      await row.getByRole("button", { name: (zh ? "管理 " : "Manage ") + fixture.conversation.conversation.title, exact: true }).click();
      await page.getByRole("menuitem", { name: zh ? "移动到项目" : "Move to project", exact: true }).click();
      const picker = page.getByRole("dialog", { name: zh ? "移动对话" : "Move conversation", exact: true });
      await picker.getByRole("radio", { name: fixture.projects[1].name, exact: true }).check();
      const submit = picker.getByRole("button", { name: zh ? "移动到所选项目" : "Move to selected project", exact: true });
      await submit.dblclick();
      await expect.poll(() => writes.length).toBe(1);
      await expect(submit).toBeDisabled();
      const close = picker.getByRole("button", { name: zh ? "关闭" : "Close", exact: true });
      await expect(close).toBeFocused();
      await close.press("Shift+Tab");
      await expect(picker.getByRole("button", { name: zh ? "返回" : "Back", exact: true })).toBeFocused();
      await page.keyboard.press("Tab"); await expect(close).toBeFocused();
      await picker.screenshot({ path: info.outputPath("placement-pending-double-click-" + width + ".png") });
      releaseWrite();
      await expect.poll(() => heldReads).toBeGreaterThan(0);
      await expect(picker).toHaveCount(0);
      const feedback = page.getByTestId("conversation-placement-feedback");
      await expect(feedback).toContainText(zh ? "移动已确认" : "Move confirmed");
      await expect(feedback).toContainText(fixture.projects[1].name);
      await expect(row).toHaveCount(0);
      await expect(page).toHaveTitle(fixture.projects[1].name + " / " + fixture.conversation.conversation.title);
      expect(page.url()).toBe(readerUrl);
      expect(await scroll.evaluate(element => element.scrollTop)).toBe(scrollBefore);
      expect(await Promise.all(fixture.conversation.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(messages);
      await feedback.screenshot({ path: info.outputPath("placement-confirmed-before-refresh-" + width + ".png") });
    } finally {
      releaseWrite(); releaseReads(); holdReads = false;
      await page.unrouteAll({ behavior: "wait" });
      await removePlacementFixture(page, fixture);
    }
  });

  test(width + "px: uncertain project placement checks without replay and retries with the reviewed revision", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 780 });
    const fixture = await createPlacementFixture(page, "Synthetic uncertain placement " + width);
    const path = "/api/conversations/" + fixture.conversation.conversation.id;
    const writes: { expected_offline_revision: number }[] = [];
    let failCheck = true, checks = 0;
    let releaseCheck: () => void = () => {};
    const checkGate = new Promise<void>(resolve => { releaseCheck = resolve; });
    try {
      await page.route(url => url.pathname === path + "/placement", async route => {
        writes.push(route.request().postDataJSON());
        if (writes.length === 1) { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed"); }
        else await route.continue();
      });
      await page.goto("/projects/" + fixture.projects[0].id);
      const picker = await openPlacementFromProject(page, fixture, zh);
      await picker.getByRole("radio", { name: fixture.projects[1].name, exact: true }).check();
      await picker.getByRole("button", { name: zh ? "移动到所选项目" : "Move to selected project", exact: true }).click();
      await expect(picker.getByRole("alert")).toContainText(zh ? "无法确认移动结果" : "could not be confirmed");
      expect((await page.request.patch(path, { data: { description_markdown: "Synthetic concurrent metadata change" } })).ok()).toBe(true);
      const current = await (await page.request.get(path)).json() as ConversationDetail;
      await page.route(url => url.pathname === path, async route => {
        if (route.request().method() !== "GET") return route.continue();
        checks += 1;
        if (failCheck) { await checkGate; await route.fulfill({ status: 503, json: { detail: "Synthetic current-location outage" } }); }
        else await route.continue();
      });
      const check = picker.getByRole("button", { name: zh ? "核对当前归属" : "Check current location", exact: true });
      await check.click();
      const close = picker.getByRole("button", { name: zh ? "关闭" : "Close", exact: true });
      await expect(close).toBeFocused();
      await close.press("Shift+Tab");
      await expect(picker.getByRole("button", { name: zh ? "返回" : "Back", exact: true })).toBeFocused();
      await page.keyboard.press("Tab"); await expect(close).toBeFocused();
      releaseCheck();
      await expect(picker.getByRole("alert")).toContainText(zh ? "核对失败" : "Could not check");
      expect(checks).toBe(1); expect(writes).toHaveLength(1);
      failCheck = false; await check.click();
      await expect(picker).toContainText(zh ? "不是上次移动的回执" : "not a receipt");
      expect(checks).toBe(2); expect(writes).toHaveLength(1);
      await picker.screenshot({ path: info.outputPath("placement-reviewed-current-state-" + width + ".png") });
      await picker.getByRole("button", { name: zh ? "关闭" : "Close", exact: true }).click();
      await page.getByTestId("conversation-placement-feedback").getByRole("button", { name: zh ? "查看移动" : "Review move", exact: true }).click();
      expect(checks).toBe(2); expect(writes).toHaveLength(1);
      await picker.getByRole("button", { name: zh ? "按当前状态再次移动" : "Move again using current state", exact: true }).click();
      await expect(picker).toHaveCount(0);
      await expect(page.getByTestId("conversation-placement-feedback")).toContainText(zh ? "移动已确认" : "Move confirmed");
      expect(writes).toHaveLength(2); expect(writes[1].expected_offline_revision).toBe(current.offline_revision);
    } finally {
      releaseCheck();
      await page.unrouteAll({ behavior: "wait" });
      await removePlacementFixture(page, fixture);
    }
  });

  test(width + "px: one-click Unclassified recovery does not mistake a null summary for a receipt", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 780 });
    const fixture = await createPlacementFixture(page, "Synthetic unclassified move " + width);
    const path = "/api/conversations/" + fixture.conversation.conversation.id;
    const writes: { target_project_id: string | null }[] = [];
    try {
      await page.route(url => url.pathname === path + "/placement", async route => {
        writes.push(route.request().postDataJSON());
        const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed");
      });
      await page.goto("/projects/" + fixture.projects[0].id);
      await page.getByTestId("project-conversation-sortable-row-" + fixture.conversation.conversation.id)
        .getByRole("button", { name: (zh ? "管理 " : "Manage ") + fixture.conversation.conversation.title, exact: true }).click();
      await page.getByRole("menuitem", { name: zh ? "移到未分类" : "Move to unclassified", exact: true }).click();
      await expect(page.getByTestId("conversation-placement-feedback")).toContainText(zh ? "无法确认移动结果" : "could not be confirmed");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(writes).toHaveLength(1); expect(writes[0].target_project_id).toBeNull();
      await page.getByTestId("conversation-placement-feedback").getByRole("button", { name: zh ? "核对当前归属" : "Check current location", exact: true }).click();
      const picker = page.getByRole("dialog", { name: zh ? "移动对话" : "Move conversation", exact: true });
      await expect(picker).toContainText(zh ? "也可能属于归档项目" : "may belong to an archived project");
      await expect(picker).toContainText(zh ? "不是上次移动的回执" : "not a receipt");
      expect(writes).toHaveLength(1);
      await picker.screenshot({ path: info.outputPath("placement-null-location-review-" + width + ".png") });
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await removePlacementFixture(page, fixture);
    }
  });
}

async function openMetadataFromList(page: Page, title: string, zh: boolean, field: "description" | "title" = "description") {
  const list = page.locator("section[aria-busy]").filter({
    has: page.getByRole("heading", { name: zh ? "对话记录" : "Conversation history", exact: true }),
  });
  await list.getByRole("button", { name: (zh ? "管理 " : "Manage ") + title, exact: true }).click();
  const name = field === "title" ? (zh ? "重命名对话" : "Rename conversation") : (zh ? "编辑简介" : "Edit description");
  await page.getByRole("menuitem", { name, exact: true }).click();
  return page.getByRole("dialog", { name, exact: true });
}

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(width + "px: description validation preserves Unicode, cancelled drafts and explicit clearing", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic metadata validation");
    const path = "/api/conversations/" + created.conversation.id, writes: unknown[] = [];
    try {
      expect((await page.request.patch(path, { data: { description_markdown: "Synthetic initial description" } })).ok()).toBe(true);
      const messages = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
      await page.route(url => url.pathname === path, async route => {
        if (route.request().method() === "PATCH") writes.push(route.request().postDataJSON());
        await route.continue();
      });
      await page.goto("/");
      const editor = await openMetadataFromList(page, created.conversation.title, zh);
      const field = editor.getByLabel(zh ? "Markdown 简介（可选）" : "Markdown description (optional)", { exact: true });
      await expect(field).toBeFocused();
      await field.fill("Synthetic retained composition");
      await field.press("Escape");
      await page.getByRole("dialog", { name: zh ? "放弃未保存的修改？" : "Discard unsaved changes?", exact: true })
        .getByRole("button", { name: zh ? "取消" : "Cancel", exact: true }).click();
      await expect(field).toHaveValue("Synthetic retained composition");
      await expect(field).toBeFocused();
      await field.fill("a".repeat(501));
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(field).toHaveValue("a".repeat(501));
      await expect(editor.getByRole("alert")).toContainText("500");
      expect(writes).toEqual([]);
      await editor.screenshot({ path: info.outputPath("metadata-overflow-" + width + ".png") });
      const unicode = "😀".repeat(500);
      await field.fill(unicode);
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await (await page.request.get(path)).json()).description_markdown).toBe(unicode);
      await openMetadataFromList(page, created.conversation.title, zh);
      await field.fill("");
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await (await page.request.get(path)).json()).description_markdown).toBeNull();
      await openMetadataFromList(page, created.conversation.title, zh);
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(writes).toEqual([{ description_markdown: unicode }, { description_markdown: null }]);
      const after = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
      expect(after).toEqual(messages);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  test(width + "px: sidebar rename confirms the live Reader before held refreshes finish", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic metadata reader");
    const path = "/api/conversations/" + created.conversation.id, writes: unknown[] = [];
    let holdReads = false, heldReads = 0;
    let releaseWrite: () => void = () => {}, releaseRead: () => void = () => {};
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    try {
      const messages = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
      await page.route(url => [path, "/api/conversations", "/api/projects", "/api/recent-items"].includes(url.pathname), async route => {
        if (route.request().method() === "PATCH" && new URL(route.request().url()).pathname === path) {
          writes.push(route.request().postDataJSON());
          await writeGate;
          const response = await route.fetch(); expect(response.ok()).toBe(true);
          await route.fulfill({ response });
        } else {
          if (holdReads && route.request().method() === "GET") { heldReads += 1; await readGate; }
          await route.continue();
        }
      });
      await page.goto(path.replace("/api", ""));
      await expect(page.locator("[data-reader-main-section]").getByRole("heading", { name: created.conversation.title, exact: true }).filter({ visible: true })).toBeVisible();
      const expand = page.getByRole("button", { name: zh ? "打开侧栏" : "Open sidebar", exact: true }).filter({ visible: true });
      if (await expand.count()) await expand.click();
      const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
      await sidebar.getByRole("button", { name: (zh ? "管理 " : "Manage ") + created.conversation.title, exact: true }).click();
      await page.getByRole("menuitem", { name: zh ? "重命名对话" : "Rename conversation", exact: true }).click();
      const editor = page.getByRole("dialog", { name: zh ? "重命名对话" : "Rename conversation", exact: true });
      const field = editor.getByLabel(zh ? "对话标题" : "Conversation title", { exact: true });
      await expect(field).toBeFocused();
      await field.fill("Synthetic acknowledged rename");
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).dblclick();
      await expect.poll(() => writes.length).toBe(1);
      await expect(field).toHaveAttribute("readonly", "");
      await expect(editor.getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })).toBeDisabled();
      holdReads = true; releaseWrite();
      await expect.poll(() => heldReads).toBeGreaterThan(0);
      await expect(editor).toHaveCount(0);
      await expect(page).toHaveTitle(/Synthetic acknowledged rename/);
      const opener = sidebar.getByRole("button", { name: (zh ? "管理 " : "Manage ") + "Synthetic acknowledged rename", exact: true });
      await expect(opener).toBeFocused();
      await page.screenshot({ path: info.outputPath("metadata-reader-acknowledged-" + width + ".png") });
      expect(writes).toEqual([{ title: "Synthetic acknowledged rename", display_title: "Synthetic acknowledged rename" }]);
      expect(await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(messages);
    } finally {
      releaseWrite(); releaseRead(); holdReads = false;
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  test(width + "px: reviewed rename compares and saves both stored and display titles", async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic title comparison");
    const path = "/api/conversations/" + created.conversation.id, writes: unknown[] = [];
    const draft = "Synthetic intended title", savedTitle = "Synthetic different saved title";
    try {
      const messages = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
      await page.route(url => url.pathname === path, async route => {
        if (route.request().method() === "PATCH") {
          writes.push(route.request().postDataJSON());
          if (writes.length === 1) {
            await route.fulfill({ status: 503, json: { detail: "Synthetic unknown rename" } });
            return;
          }
        }
        await route.continue();
      });
      await page.goto("/");
      const editor = await openMetadataFromList(page, created.conversation.title, zh, "title");
      const field = editor.getByLabel(zh ? "对话标题" : "Conversation title", { exact: true });
      await field.fill(draft);
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText(zh ? "暂时无法确认保存结果" : "The save could not be confirmed");
      expect((await page.request.patch(path, { data: { title: savedTitle, display_title: draft } })).ok()).toBe(true);
      await editor.getByRole("button", { name: zh ? "核对当前内容" : "Check current value", exact: true }).click();
      await expect(editor.getByText(savedTitle, { exact: true })).toBeVisible();
      await expect(editor.getByText(zh ? "已存标题" : "Saved title", { exact: true })).toBeVisible();
      await expect(editor.getByText(zh ? "显示标题" : "Display title", { exact: true })).toBeVisible();
      await expect(field).toHaveValue(draft);
      expect(writes).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await editor.screenshot({ path: info.outputPath("metadata-title-comparison-" + width + ".png") });
      await editor.getByRole("button", { name: zh ? "保留草稿继续编辑" : "Continue editing draft", exact: true }).click();
      await expect(field).toBeEditable();
      expect(writes).toHaveLength(1);
      await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(writes).toEqual([{ title: draft, display_title: draft }, { title: draft, display_title: draft }]);
      const saved = await (await page.request.get(path)).json();
      expect(saved.title).toBe(draft); expect(saved.display_title).toBe(draft);
      expect(await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(messages);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(path)).ok()).toBe(true);
    }
  });

  for (const applied of [true, false]) {
    test(width + "px: unknown description checks only reads before " + (applied ? "accepting a matching value" : "an explicit reviewed save"), async ({ page }, info) => {
      await preferences(page, zh);
      await page.setViewportSize({ width, height: 900 });
      const created = await createConversation(page, "Synthetic metadata unknown");
      const path = "/api/conversations/" + created.conversation.id, writes: unknown[] = [];
      let checking = false, failCheck = false, checks = 0;
      try {
        const messages = await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()));
        await page.route(url => url.pathname === path, async route => {
          if (route.request().method() === "PATCH") {
            writes.push(route.request().postDataJSON());
            if (writes.length === 1) {
              if (applied) { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed"); }
              else await route.fulfill({ status: 503, json: { detail: "Synthetic metadata rejection" } });
              return;
            }
          } else if (checking && route.request().method() === "GET") {
            checks += 1;
            if (failCheck) { await route.fulfill({ status: 503, json: { detail: "Synthetic failed check" } }); return; }
          }
          await route.continue();
        });
        await page.goto("/");
        const editor = await openMetadataFromList(page, created.conversation.title, zh);
        const field = editor.getByLabel(zh ? "Markdown 简介（可选）" : "Markdown description (optional)", { exact: true });
        await field.fill("Synthetic draft after lost reply");
        await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
        await expect(editor.getByRole("alert")).toContainText(zh ? "暂时无法确认保存结果" : "The save could not be confirmed");
        await expect(field).toHaveValue("Synthetic draft after lost reply");
        await expect(field).toHaveAttribute("readonly", "");
        expect(writes).toHaveLength(1);
        const check = editor.getByRole("button", { name: zh ? "核对当前内容" : "Check current value", exact: true });
        checking = true; failCheck = true;
        await check.click();
        await expect(editor.getByRole("alert")).toContainText(zh ? "当前内容核对失败" : "Could not check the current value");
        expect(checks).toBe(1); expect(writes).toHaveLength(1);
        await editor.screenshot({ path: info.outputPath("metadata-unknown-" + width + "-" + applied + ".png") });
        failCheck = false;
        await check.click();
        if (!applied) {
          await expect(editor.getByText(zh ? "服务器当前内容" : "Current server value", { exact: true })).toBeVisible();
          expect(checks).toBe(2); expect(writes).toHaveLength(1);
          await editor.getByRole("button", { name: zh ? "保留草稿继续编辑" : "Continue editing draft", exact: true }).click();
          expect(writes).toHaveLength(1);
          await field.fill("Synthetic reviewed final draft");
          await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
        }
        await expect(editor).toHaveCount(0);
        expect(writes).toEqual(applied
          ? [{ description_markdown: "Synthetic draft after lost reply" }]
          : [{ description_markdown: "Synthetic draft after lost reply" }, { description_markdown: "Synthetic reviewed final draft" }]);
        expect((await (await page.request.get(path)).json()).description_markdown).toBe(applied ? "Synthetic draft after lost reply" : "Synthetic reviewed final draft");
        expect(await Promise.all(created.messages.map(async message => (await page.request.get("/api/messages/" + message.id)).json()))).toEqual(messages);
      } finally {
        await page.unrouteAll({ behavior: "wait" });
        expect((await page.request.delete(path)).ok()).toBe(true);
      }
    });
  }
}

async function createConversation(page: Page, title: string, projectId?: string, assistantText = `${title} synthetic answer`): Promise<ConversationCreateResponse> {
  const response = await page.request.post("/api/conversations", { data: {
    title, project_id: projectId, messages: [
      { role: "user", content_markdown: `${title} synthetic question` },
      { role: "assistant", content_markdown: assistantText },
    ],
  } });
  expect(response.status()).toBe(201);
  return response.json();
}

async function localReadingSnapshot(page: Page, id: string) {
  const allowUnownedLegacy = process.env.APP_ENV === "test" && process.env.AUTH_ENABLED !== "true";
  return page.evaluate(async ({ conversationId, allowUnownedLegacy }) => {
    const userId = localStorage.getItem("chat-reader:offline-active-user-v1");
    const legacyOwner = localStorage.getItem("chat-reader:offline-legacy-owner-v1");
    // AuthBoundary does not activate an account namespace in the explicit
    // auth-disabled fixture. Its Reader opens the unowned legacy database.
    if (!userId && (!allowUnownedLegacy || legacyOwner)) throw new Error("Synthetic Reader has no verified offline storage owner");
    const hex = userId ? Array.from(new TextEncoder().encode(userId), byte => byte.toString(16).padStart(2, "0")).join("") : "";
    const name = !userId || legacyOwner === userId
      ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${hex}`;
    return new Promise<{ position: ReadingPositionRead | null; pending: number }>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error("Expected the Reader's existing database")); };
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(["readingPositions", "outbox"], "readonly");
        const position = tx.objectStore("readingPositions").get(conversationId);
        const pending = tx.objectStore("outbox").index("conversation_id").getAll(conversationId);
        tx.oncomplete = () => { db.close(); resolve({ position: position.result ?? null,
          pending: pending.result.filter((row: { entity_type: string }) => row.entity_type === "reading_position").length }); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { conversationId: id, allowUnownedLegacy });
}

async function closeMobileSidebar(page: Page) {
  const backdrop = page.getByRole("button", { name: "Close sidebar", exact: true }).filter({ visible: true });
  if (!await backdrop.count()) return;
  const cover = await backdrop.boundingBox();
  const drawer = await page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true }).boundingBox();
  expect(cover).not.toBeNull(); expect(drawer).not.toBeNull();
  const left = Math.max(cover!.x, drawer!.x + drawer!.width);
  const right = Math.min(cover!.x + cover!.width, page.viewportSize()!.width);
  expect(right).toBeGreaterThan(left);
  // The center of the full-screen scrim is under the drawer. Click the actual
  // exposed portion, with normal pointer hit-testing and no forced interaction.
  await backdrop.click({ position: { x: (left + right) / 2 - cover!.x, y: cover!.height / 2 } });
  await expect(backdrop).toHaveCount(0);
}

async function status(page: Page, id: string) {
  const response = await page.request.get(`/api/conversations/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).status as string;
}

async function preferences(page: Page, zh: boolean) {
  expect((await page.request.patch("/api/preferences", { data: { locale_mode: zh ? "zh-CN" : "en-US", theme_mode: zh ? "light" : "dark" } })).ok()).toBe(true);
}

async function createArchivedProject(page: Page, name: string) {
  const response = await page.request.post("/api/projects", { data: { name } });
  expect(response.status()).toBe(201);
  const project = await response.json() as ProjectRead;
  let conversation: ConversationCreateResponse | undefined;
  try {
    conversation = await createConversation(page, `${name} source`, project.id);
    expect((await page.request.patch(`/api/projects/${project.id}`, { data: { is_archived: true } })).ok()).toBe(true);
    const messages = await Promise.all(conversation.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json()));
    return { project, conversation, messages };
  } catch (error) {
    if (conversation) expect((await page.request.delete(`/api/conversations/${conversation.conversation.id}`)).ok()).toBe(true);
    expect((await page.request.patch(`/api/projects/${project.id}`, { data: { is_archived: true } })).ok()).toBe(true);
    expect((await page.request.delete(`/api/projects/${project.id}`)).ok()).toBe(true);
    throw error;
  }
}

async function expectProjectSourceUnchanged(page: Page, fixture: Awaited<ReturnType<typeof createArchivedProject>>) {
  const messages = await Promise.all(fixture.conversation.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json()));
  expect(messages).toEqual(fixture.messages);
  const response = await page.request.get(`/api/projects/${fixture.project.id}/conversations`);
  expect(response.ok()).toBe(true);
  expect((await response.json() as ProjectConversationRead[]).some(item => item.id === fixture.conversation.conversation.id)).toBe(true);
}

async function removeArchivedProjectFixture(page: Page, fixture: Awaited<ReturnType<typeof createArchivedProject>>) {
  expect((await page.request.delete(`/api/conversations/${fixture.conversation.conversation.id}`)).ok()).toBe(true);
  expect((await page.request.patch(`/api/projects/${fixture.project.id}`, { data: { is_archived: true } })).ok()).toBe(true);
  expect((await page.request.delete(`/api/projects/${fixture.project.id}`)).ok()).toBe(true);
}

async function createSidebarReadFixture(page: Page, name: string) {
  const fixture = await createArchivedProject(page, name);
  let unclassified: ConversationCreateResponse | undefined;
  try {
    // Reuse the existing synthetic fixture and make it active before observing
    // the sidebar. All setup mutations precede the read-only request counters.
    expect((await page.request.patch(`/api/projects/${fixture.project.id}`, { data: { is_archived: false } })).ok()).toBe(true);
    unclassified = await createConversation(page, `${name} unclassified`);
    const unclassifiedMessages = await Promise.all(unclassified.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json()));
    return { ...fixture, unclassified, unclassifiedMessages };
  } catch (error) {
    if (unclassified) expect((await page.request.delete(`/api/conversations/${unclassified.conversation.id}`)).ok()).toBe(true);
    await removeArchivedProjectFixture(page, fixture);
    throw error;
  }
}

async function expectSidebarSourcesUnchanged(page: Page, fixture: Awaited<ReturnType<typeof createSidebarReadFixture>>) {
  await expectProjectSourceUnchanged(page, fixture);
  const messages = await Promise.all(fixture.unclassified.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json()));
  expect(messages).toEqual(fixture.unclassifiedMessages);
  const response = await page.request.get("/api/conversations?scope=history&limit=5000");
  expect(response.ok()).toBe(true);
  const rows = await response.json() as { id: string }[];
  expect(rows.some(item => item.id === fixture.unclassified.conversation.id)).toBe(true);
  expect(rows.some(item => item.id === fixture.conversation.conversation.id)).toBe(false);
}

async function removeSidebarReadFixture(page: Page, fixture: Awaited<ReturnType<typeof createSidebarReadFixture>>) {
  expect((await page.request.delete(`/api/conversations/${fixture.unclassified.conversation.id}`)).ok()).toBe(true);
  await removeArchivedProjectFixture(page, fixture);
}

async function expectProjectArchivedOnce(page: Page, fixture: Awaited<ReturnType<typeof createSidebarReadFixture>>, beforeRevision: number) {
  const projects = await page.request.get("/api/projects?include_archived=true");
  expect(projects.ok()).toBe(true);
  expect((await projects.json() as ProjectRead[]).find(item => item.id === fixture.project.id)?.is_archived).toBe(true);
  await expectProjectSourceUnchanged(page, fixture);
  const conversation = await page.request.get(`/api/conversations/${fixture.conversation.conversation.id}`);
  expect(conversation.ok()).toBe(true);
  expect((await conversation.json()).offline_revision).toBe(beforeRevision + 1);
  const history = await page.request.get("/api/conversations?scope=history&limit=5000");
  expect(history.ok()).toBe(true);
  const ids = (await history.json() as { id: string }[]).map(item => item.id);
  expect(ids).toContain(fixture.conversation.conversation.id);
  expect(ids).toContain(fixture.unclassified.conversation.id);
}

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(`${width}px: project archive acknowledgement survives row removal before list refresh settles`, async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await createSidebarReadFixture(page, "Synthetic archive feedback");
    const before = await page.request.get(`/api/conversations/${fixture.conversation.conversation.id}`);
    expect(before.ok()).toBe(true);
    const beforeRevision = (await before.json()).offline_revision as number;
    let hold = false, heldReads = 0;
    const writes: unknown[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      await page.route(url => ["/api/projects", "/api/conversations", `/api/projects/${fixture.project.id}`].includes(url.pathname), async route => {
        if (route.request().method() === "PATCH") {
          writes.push(route.request().postDataJSON());
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          hold = true;
          await route.fulfill({ response });
        } else {
          if (hold && route.request().method() === "GET") { heldReads += 1; await held; }
          await route.continue();
        }
      });
      await page.goto("/");
      if (width === 375) await page.getByTestId("mobile-sidebar-button").filter({ visible: true }).click();
      const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
      await sidebar.getByRole("button", { name: `${zh ? "管理项目" : "Manage project"} ${fixture.project.name}`, exact: true }).click();
      await page.getByRole("menuitem", { name: zh ? "归档项目" : "Archive project", exact: true }).click();
      await page.getByRole("dialog", { name: zh ? `归档“${fixture.project.name}”？` : `Archive “${fixture.project.name}”?`, exact: true })
        .getByRole("button", { name: zh ? "归档" : "Archive", exact: true }).click();
      const notice = sidebar.getByTestId("project-archive-feedback");
      await expect(notice).toContainText(zh ? "项目已归档" : "Project archived");
      await expect.poll(() => heldReads).toBeGreaterThan(0);
      await expect(sidebar.locator(`a[href="/projects/${fixture.project.id}"]`)).toHaveCount(0);
      await expect(notice).toBeFocused();
      expect(await notice.evaluate(element => element.closest('[aria-busy="true"]') !== null)).toBe(false);
      await expect(notice.getByRole("link", { name: zh ? "查看归档" : "View archive", exact: true })).toHaveAttribute("href", "/archived");
      expect(writes).toEqual([{ is_archived: true }]);
      await expectProjectArchivedOnce(page, fixture, beforeRevision);
      await page.screenshot({ path: info.outputPath(`project-archive-acknowledged-${width}.png`) });
      release(); hold = false;
      await expect(notice).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release(); await page.unrouteAll({ behavior: "wait" }); await removeSidebarReadFixture(page, fixture);
    }
  });

  for (const appliedBeforeLoss of [true, false]) {
    test(`${width}px: unknown project archive ${appliedBeforeLoss ? "checks the existing result" : "retries only after an active result"}`, async ({ page }, info) => {
      await preferences(page, zh);
      await page.setViewportSize({ width, height: 900 });
      const fixture = await createSidebarReadFixture(page, "Synthetic uncertain project archive");
      const before = await page.request.get(`/api/conversations/${fixture.conversation.conversation.id}`);
      expect(before.ok()).toBe(true);
      const beforeRevision = (await before.json()).offline_revision as number;
      const writes: unknown[] = [];
      let checks = 0, failCheck = true;
      try {
        await page.route(url => url.pathname === `/api/projects/${fixture.project.id}`, async route => {
          if (route.request().method() !== "PATCH") return route.continue();
          writes.push(route.request().postDataJSON());
          if (writes.length === 1) {
            if (appliedBeforeLoss) expect((await route.fetch()).ok()).toBe(true);
            await route.fulfill({ status: 503, json: { detail: "Synthetic uncertain archive response" } });
          } else await route.continue();
        });
        await page.route(url => url.pathname === "/api/projects" && url.searchParams.get("include_archived") === "true", async route => {
          checks += 1;
          if (failCheck) await route.fulfill({ status: 503, json: { detail: "Synthetic archive check failure" } });
          else await route.continue();
        });
        await page.goto("/");
        if (width === 375) await page.getByTestId("mobile-sidebar-button").filter({ visible: true }).click();
        const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
        const openMenu = async () => sidebar.getByRole("button", { name: `${zh ? "管理项目" : "Manage project"} ${fixture.project.name}`, exact: true }).click();
        const confirmArchive = async () => {
          await page.getByRole("menuitem", { name: zh ? "归档项目" : "Archive project", exact: true }).click();
          await page.getByRole("dialog", { name: zh ? `归档“${fixture.project.name}”？` : `Archive “${fixture.project.name}”?`, exact: true })
            .getByRole("button", { name: zh ? "归档" : "Archive", exact: true }).click();
        };
        await openMenu(); await confirmArchive();
        const notice = sidebar.getByTestId("project-archive-feedback");
        await expect(notice).toContainText(zh ? "暂时无法确认归档结果" : "Archive could not be confirmed");
        await openMenu(); await expect(page.getByRole("menuitem", { name: zh ? "归档项目" : "Archive project", exact: true })).toBeDisabled();
        await page.keyboard.press("Escape");
        if (width === 375) {
          await closeMobileSidebar(page);
          await page.getByTestId("mobile-sidebar-button").filter({ visible: true }).click();
        }
        await expect(notice).toBeVisible(); expect(checks).toBe(0); expect(writes).toHaveLength(1);
        await page.screenshot({ path: info.outputPath(`project-archive-unknown-${width}-${appliedBeforeLoss}.png`) });
        await notice.getByRole("button", { name: zh ? "核对归档结果" : "Check archive result", exact: true }).click();
        await expect(notice).toContainText(zh ? "归档结果核对失败" : "Could not check the archive result");
        expect(checks).toBe(1); expect(writes).toHaveLength(1);
        failCheck = false;
        await notice.getByRole("button", { name: zh ? "核对归档结果" : "Check archive result", exact: true }).click();
        if (!appliedBeforeLoss) {
          await expect(notice).toContainText(zh ? "项目尚未归档" : "This project is not archived");
          expect(writes).toHaveLength(1);
          await openMenu(); await confirmArchive();
        }
        await expect(notice).toContainText(zh ? "项目已归档" : "Project archived");
        expect(checks).toBe(2);
        expect(writes).toEqual(Array.from({ length: appliedBeforeLoss ? 1 : 2 }, () => ({ is_archived: true })));
        await expectProjectArchivedOnce(page, fixture, beforeRevision);
        await page.screenshot({ path: info.outputPath(`project-archive-checked-${width}-${appliedBeforeLoss}.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        await page.unrouteAll({ behavior: "wait" }); await removeSidebarReadFixture(page, fixture);
      }
    });
  }
}

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  for (const scope of ["projects", "history", "branch"] as const) {
    test(`${width}px ${scope}: sidebar read failure keeps the same reading node and retries only its own query`, async ({ page }, info) => {
      await preferences(page, zh);
      await page.setViewportSize({ width, height: 900 });
      const fixture = await createSidebarReadFixture(page, `Synthetic sidebar ${scope} recovery`);
      const reads = { projects: 0, history: 0, branch: 0 };
      let fail = false, hold = false, writes = 0;
      let release: () => void = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      const readScope = (url: URL): keyof typeof reads | null => {
        if (url.pathname === "/api/projects" && url.searchParams.get("sort") === "custom" && url.searchParams.get("direction") === "asc" && !url.searchParams.has("include_archived")) return "projects";
        if (url.pathname === "/api/conversations" && url.searchParams.get("scope") === "history") return "history";
        if (url.pathname === `/api/projects/${fixture.project.id}/conversations`) return "branch";
        return null;
      };
      try {
        page.on("request", request => {
          if (/^\/api\/(projects|conversations)(\/|$)/.test(new URL(request.url()).pathname) && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes += 1;
        });
        await page.route(url => readScope(url) !== null, async route => {
          const target = readScope(new URL(route.request().url()))!;
          reads[target] += 1;
          if (target === scope) {
            if (hold) await held;
            if (fail) return route.fulfill({ status: 503, json: { detail: "Synthetic sidebar read failure" } });
          }
          await route.continue();
        });
        await page.clock.install();
        await page.goto("/");
        if (width === 375) await page.getByTestId("mobile-sidebar-button").filter({ visible: true }).click();
        const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
        if (scope === "branch") await sidebar.getByRole("button", { name: `Expand ${fixture.project.name}`, exact: true }).click();
        const region = scope === "projects" ? sidebar.getByRole("region", { name: zh ? "项目" : "Projects", exact: true })
          : scope === "history" ? sidebar.getByRole("navigation", { name: zh ? "未归类" : "Unclassified", exact: true })
            : sidebar.getByRole("group", { name: zh ? `项目对话：${fixture.project.name}` : `Conversations in ${fixture.project.name}`, exact: true });
        const link = scope === "projects" ? region.locator(`a[href="/projects/${fixture.project.id}"]`)
          : region.locator(`a[href^="/conversations/${scope === "history" ? fixture.unclassified.conversation.id : fixture.conversation.conversation.id}"]`);
        await expect(link).toBeVisible(); await link.focus();
        const original = await link.elementHandle();
        if (!original) throw new Error("Synthetic sidebar reading link was not mounted");
        // QueryProvider's current staleTime is 15 seconds; exceed it explicitly.
        await page.clock.fastForward(20_000);
        fail = true; const beforeFailure = reads[scope];
        await page.context().setOffline(true);
        await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
        await page.context().setOffline(false);
        await expect.poll(() => reads[scope]).toBeGreaterThan(beforeFailure);
        const error = region.getByRole("alert").filter({ hasText: zh ? "仍显示上次内容" : "Previously loaded items are shown" });
        await expect(error).toBeVisible(); await expect(link).toBeVisible(); await expect(link).toBeFocused();
        expect(await link.evaluate((node, old) => node === old, original)).toBe(true);
        fail = false; hold = true;
        const beforeRetry = { ...reads };
        const retry = error.getByRole("button", { name: zh ? "重试" : "Retry", exact: true });
        await retry.click(); await expect.poll(() => reads[scope]).toBe(beforeRetry[scope] + 1);
        await expect(retry).toBeDisabled(); await expect(region).toHaveAttribute("aria-busy", "true");
        await expect(link).toBeVisible(); expect(await link.evaluate((node, old) => node === old, original)).toBe(true);
        for (const other of ["projects", "history", "branch"] as const) if (other !== scope) expect(reads[other]).toBe(beforeRetry[other]);
        expect(writes).toBe(0);
        await page.screenshot({ path: info.outputPath(`sidebar-${scope}-held-retry-${width}.png`) });
        release(); hold = false;
        await expect(error).toHaveCount(0); await expect(link).toBeVisible();
        expect(await link.evaluate((node, old) => node === old, original)).toBe(true); await original.dispose();
        expect(writes).toBe(0); await expect(page).toHaveURL(url => url.pathname === "/");
        await expectSidebarSourcesUnchanged(page, fixture);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        release(); await page.context().setOffline(false); await page.unrouteAll({ behavior: "wait" });
        await removeSidebarReadFixture(page, fixture);
      }
    });
  }

  test(`${width}px: an initial sidebar project-conversation failure is not empty drop guidance`, async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await createSidebarReadFixture(page, "Synthetic initial sidebar project read");
    let fail = true, reads = 0, writes = 0;
    try {
      page.on("request", request => {
        if (/^\/api\/(projects|conversations)(\/|$)/.test(new URL(request.url()).pathname) && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes += 1;
      });
      await page.route(url => url.pathname === `/api/projects/${fixture.project.id}/conversations`, async route => {
        reads += 1;
        if (fail) await route.fulfill({ status: 503, json: { detail: "Synthetic initial project read failure" } });
        else await route.continue();
      });
      await page.goto("/");
      if (width === 375) await page.getByTestId("mobile-sidebar-button").filter({ visible: true }).click();
      const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
      await sidebar.getByRole("button", { name: `Expand ${fixture.project.name}`, exact: true }).click();
      const region = sidebar.getByRole("group", { name: zh ? `项目对话：${fixture.project.name}` : `Conversations in ${fixture.project.name}`, exact: true });
      const error = region.getByRole("alert").filter({ hasText: zh ? "项目对话加载失败" : "Could not load project conversations" });
      await expect(error).toBeVisible();
      await expect(region.getByText(zh ? "拖动对话到这里" : "Drag conversations here", { exact: true })).toHaveCount(0);
      await expect(region.getByText("Synthetic initial project read failure", { exact: true })).toHaveCount(0);
      const beforeRetry = reads; fail = false;
      await error.getByRole("button", { name: zh ? "重试" : "Retry", exact: true }).click();
      await expect.poll(() => reads).toBe(beforeRetry + 1);
      await expect(error).toHaveCount(0);
      await expect(region.locator(`a[href^="/conversations/${fixture.conversation.conversation.id}"]`)).toBeVisible();
      await expect(sidebar.getByRole("button", { name: `Collapse ${fixture.project.name}`, exact: true })).toBeVisible();
      expect(writes).toBe(0); await expectSidebarSourcesUnchanged(page, fixture);
      await page.screenshot({ path: info.outputPath(`sidebar-initial-project-recovered-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await page.unrouteAll({ behavior: "wait" }); await removeSidebarReadFixture(page, fixture);
    }
  });
}

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(`${width}px: archived-project refresh failure retains the same selected row through retry`, async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await createArchivedProject(page, "Synthetic archive read recovery");
    let fail = false, hold = false, reads = 0, writes = 0;
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      page.on("request", request => {
        if (new URL(request.url()).pathname.startsWith("/api/projects") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes += 1;
      });
      await page.route(url => url.pathname === "/api/projects" && url.searchParams.get("include_archived") === "true", async route => {
        reads += 1;
        if (hold) await held;
        if (fail) await route.fulfill({ status: 503, json: { detail: "Synthetic archived-project read error" } });
        else await route.continue();
      });
      await page.clock.install();
      await page.goto("/archived");
      const section = page.locator('section[aria-labelledby="archived-projects-heading"]');
      await section.getByRole("button", { name: zh ? "批量操作" : "Manage projects", exact: true }).click();
      const checkbox = section.getByRole("checkbox", { name: `${zh ? "选择" : "Select"} ${fixture.project.name}`, exact: true });
      await checkbox.check(); await checkbox.focus();
      const original = await checkbox.elementHandle();
      if (!original) throw new Error("Synthetic project checkbox was not mounted");
      await page.clock.fastForward(20_000);
      const before = reads; fail = true;
      await page.context().setOffline(true);
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await page.context().setOffline(false);
      await expect.poll(() => reads).toBeGreaterThan(before);
      const error = section.getByRole("alert").filter({ hasText: zh ? "项目更新失败，仍显示上次内容" : "Previously loaded projects are shown" });
      await expect(error).toBeVisible(); await expect(checkbox).toBeChecked(); await expect(checkbox).toBeFocused();
      expect(await checkbox.evaluate((node, old) => node === old, original)).toBe(true);
      await original.dispose();
      fail = false; hold = true;
      const retry = error.getByRole("button", { name: zh ? "重试" : "Retry", exact: true });
      const beforeRetry = reads; await retry.click();
      await expect.poll(() => reads).toBe(beforeRetry + 1);
      await expect(retry).toBeDisabled(); await expect(checkbox).toBeChecked();
      await page.screenshot({ path: info.outputPath(`archived-project-read-retry-${width}.png`) });
      release(); hold = false;
      await expect(error).toHaveCount(0); await expect(checkbox).toBeChecked();
      expect(writes).toBe(0); await expectProjectSourceUnchanged(page, fixture);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release(); await page.context().setOffline(false); await page.unrouteAll({ behavior: "wait" });
      await removeArchivedProjectFixture(page, fixture);
    }
  });

  test(`${width}px: confirmed ${width === 375 ? "single" : "bulk"} project restore remains acknowledged before the empty-list refresh completes`, async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await createArchivedProject(page, "Synthetic final archived project");
    let hold = false, heldReads = 0, writes = 0;
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      page.on("request", request => { if (new URL(request.url()).pathname === `/api/projects/${fixture.project.id}` && request.method() === "PATCH") writes += 1; });
      await page.route(url => url.pathname === "/api/projects" && url.searchParams.get("include_archived") === "true", async route => {
        if (hold) { heldReads += 1; await held; }
        const response = await route.fetch();
        const rows = await response.json() as ProjectRead[];
        // Isolate this section's final visible row with a filtered real response;
        // this is not a claim that the shared fixture has no other projects.
        await route.fulfill({ response, json: rows.filter(item => item.id === fixture.project.id) });
      });
      await page.goto("/archived");
      const section = page.locator('section[aria-labelledby="archived-projects-heading"]');
      await expect(section.getByText(fixture.project.name, { exact: true })).toBeVisible();
      if (width === 1440) {
        await section.getByRole("button", { name: "Manage projects", exact: true }).click();
        await section.getByRole("checkbox", { name: `Select ${fixture.project.name}`, exact: true }).check();
      }
      hold = true;
      await section.getByRole("button", { name: zh ? "恢复" : "Restore selected", exact: true }).click();
      await expect.poll(() => heldReads).toBeGreaterThan(0);
      const notice = section.getByRole("status").filter({ hasText: zh ? "项目已恢复" : "1 project restored" });
      await expect(notice).toBeVisible(); await expect(notice).toBeFocused();
      await expect(section.getByText(fixture.project.name, { exact: true })).toHaveCount(0);
      expect(await notice.evaluate(element => element.closest('[aria-busy="true"]') !== null)).toBe(false);
      expect(writes).toBe(1);
      const canonical = await page.request.get("/api/projects?include_archived=true");
      expect(canonical.ok()).toBe(true);
      expect((await canonical.json() as ProjectRead[]).find(item => item.id === fixture.project.id)?.is_archived).toBe(false);
      await expectProjectSourceUnchanged(page, fixture);
      await page.screenshot({ path: info.outputPath(`archived-project-confirmed-${width}.png`) });
      release(); hold = false;
      await expect(notice).toBeVisible(); expect(writes).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release(); await page.unrouteAll({ behavior: "wait" }); await removeArchivedProjectFixture(page, fixture);
    }
  });

  test(`${width}px: ${width === 375 ? "single" : "bulk"} project deletion stops when archive membership changes during confirmation`, async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await createArchivedProject(page, "Synthetic changed archive selection");
    let other: Awaited<ReturnType<typeof createArchivedProject>> | undefined;
    let reads = 0, writes = 0;
    try {
      other = await createArchivedProject(page, "Synthetic retained archived project");
      page.on("request", request => {
        if (new URL(request.url()).pathname === `/api/projects/${fixture.project.id}` && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes += 1;
      });
      await page.route(url => url.pathname === "/api/projects" && url.searchParams.get("include_archived") === "true", async route => {
        reads += 1;
        await route.continue();
      });
      await page.clock.install();
      await page.goto("/archived");
      const section = page.locator('section[aria-labelledby="archived-projects-heading"]');
      const row = section.locator(".reader-interactive-row").filter({ hasText: fixture.project.name });
      await expect(row).toBeVisible();
      if (width === 1440) {
        await section.getByRole("button", { name: "Manage projects", exact: true }).click();
        await section.getByRole("checkbox", { name: `Select ${fixture.project.name}`, exact: true }).check();
        await section.getByRole("button", { name: "Delete selected", exact: true }).click();
      } else {
        await row.getByRole("button", { name: `永久删除项目 ${fixture.project.name}`, exact: true }).click();
      }
      const confirmation = page.getByRole("dialog", { name: zh ? `永久删除项目“${fixture.project.name}”？` : "Permanently delete 1 selected projects?", exact: true });
      await expect(confirmation).toBeVisible();
      // Simulate a separate client restoring only this synthetic project. The
      // browser must observe a real refreshed list before confirming deletion.
      expect((await page.request.patch(`/api/projects/${fixture.project.id}`, { data: { is_archived: false } })).ok()).toBe(true);
      await page.clock.fastForward(20_000);
      const before = reads;
      await page.context().setOffline(true);
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await page.context().setOffline(false);
      await expect.poll(() => reads).toBeGreaterThan(before);
      await expect(row).toHaveCount(0);
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: zh ? "永久删除" : "Delete permanently", exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      const notice = section.getByRole("status").filter({ hasText: zh ? "项目列表已更新，请检查当前选择后重试" : "The project list changed. Review the current selection and try again." });
      await expect(notice).toBeVisible();
      expect(writes).toBe(0);
      if (width === 1440) await expect(section.getByRole("button", { name: "Delete selected", exact: true })).toBeDisabled();
      await expectProjectSourceUnchanged(page, fixture);
      await expectProjectSourceUnchanged(page, other);
      const current = await page.request.get("/api/projects?include_archived=true");
      expect(current.ok()).toBe(true);
      expect((await current.json() as ProjectRead[]).find(item => item.id === fixture.project.id)?.is_archived).toBe(false);
      await page.screenshot({ path: info.outputPath(`archived-project-changed-confirmation-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await page.context().setOffline(false);
      await page.unrouteAll({ behavior: "wait" });
      if (other) await removeArchivedProjectFixture(page, other);
      await removeArchivedProjectFixture(page, fixture);
    }
  });

  for (const appliedBeforeLoss of [true, false]) {
    test(`${width}px: uncertain project restore ${appliedBeforeLoss ? "is confirmed by a read" : "retries only after a still-archived read"}`, async ({ page }, info) => {
      await preferences(page, zh);
      await page.setViewportSize({ width, height: 900 });
      const fixture = await createArchivedProject(page, "Synthetic uncertain project restore");
      let failCheck = false, reads = 0;
      const writes: unknown[] = [];
      try {
        await page.route(url => url.pathname === `/api/projects/${fixture.project.id}`, async route => {
          if (route.request().method() !== "PATCH") return route.continue();
          writes.push(route.request().postDataJSON());
          if (writes.length === 1) {
            if (appliedBeforeLoss) expect((await route.fetch()).ok()).toBe(true);
            await route.abort("failed");
          } else await route.continue();
        });
        await page.route(url => url.pathname === "/api/projects" && url.searchParams.get("include_archived") === "true", async route => {
          reads += 1;
          if (failCheck) await route.fulfill({ status: 503, json: { detail: "Synthetic restore check outage" } });
          else await route.continue();
        });
        await page.goto("/archived");
        const section = page.locator('section[aria-labelledby="archived-projects-heading"]');
        const row = section.locator(".reader-interactive-row").filter({ hasText: fixture.project.name });
        await row.getByRole("button", { name: zh ? "恢复" : "Restore", exact: true }).click();
        const check = section.getByRole("button", { name: zh ? "核对恢复结果" : "Check restore result", exact: true });
        await expect(check).toBeVisible();
        await expect(row.getByRole("button", { name: zh ? "恢复" : "Restore", exact: true })).toBeDisabled();
        expect(writes).toEqual([{ is_archived: false }]);
        failCheck = true; await check.click();
        await expect(section.getByRole("status")).toContainText(zh ? "恢复结果核对失败" : "Could not check the restore result");
        await expect(check).toBeEnabled(); expect(writes).toHaveLength(1);
        await page.screenshot({ path: info.outputPath(`archived-project-unconfirmed-${width}-${appliedBeforeLoss}.png`) });
        const beforeCheck = reads; failCheck = false; await check.click();
        await expect.poll(() => reads).toBe(beforeCheck + 1);
        await expect(check).toHaveCount(0);
        if (appliedBeforeLoss) {
          await expect(section.getByRole("status")).toContainText(zh ? "1 个项目已恢复" : "1 project restored");
          await expect(row).toHaveCount(0); expect(writes).toHaveLength(1);
        } else {
          await expect(section.getByRole("status")).toContainText(zh ? "1 个仍在归档中" : "1 still archived");
          expect(writes).toHaveLength(1);
          await row.getByRole("button", { name: zh ? "恢复" : "Restore", exact: true }).click();
          await expect(section.getByRole("status")).toContainText(zh ? "项目已恢复" : "Project restored");
          expect(writes).toEqual([{ is_archived: false }, { is_archived: false }]);
        }
        await expectProjectSourceUnchanged(page, fixture);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        await page.unrouteAll({ behavior: "wait" }); await removeArchivedProjectFixture(page, fixture);
      }
    });
  }
}

for (const [projectView, width, zh] of [[false, 1440, false], [true, 375, true]] as const) {
  for (const admittedBeforeLoss of [true, false]) {
    test(`merge recovery ${projectView ? "project" : "all"} ${width}px: ${admittedBeforeLoss ? "find accepted request after reload" : "read missing before original-key resubmission"}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await preferences(page, zh);
      const projectResponse = await page.request.post("/api/projects", { data: { name: "Synthetic merge recovery project" } });
      expect(projectResponse.status()).toBe(201);
      const project = await projectResponse.json();
      const created: ConversationCreateResponse[] = [];
      let receipt: BackgroundTaskRead | undefined;
      let releaseResponse: () => void = () => {};
      let releaseRefresh: () => void = () => {};
      const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
      const heldRefresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
      const writes: { key: string | undefined; body: unknown }[] = [];
      let reads = 0, listReads = 0, heldRefreshReads = 0, failRead = true, holdRefresh = false;
      try {
        for (const title of ["Synthetic merge recovery first", "Synthetic merge recovery second"]) created.push(await createConversation(page, title, projectView ? project.id : undefined));
        const sourceMessages = await Promise.all(created.flatMap(item => item.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json())));
        await page.route(url => url.pathname === "/api/conversations/merge", async route => {
          writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
          if (writes.length === 1) {
            if (admittedBeforeLoss) { const response = await route.fetch(); expect(response.status()).toBe(202); receipt = await response.json(); }
            await heldResponse;
            await route.fulfill({ status: 503, json: { detail: "Synthetic lost merge response" } });
          } else {
            const response = await route.fetch(); expect(response.status()).toBe(202); receipt = await response.json();
            await route.fulfill({ response });
          }
        });
        await page.route(url => url.pathname.startsWith("/api/conversations/merge/requests/"), async route => {
          reads += 1;
          expect(route.request().method()).toBe("GET");
          expect(new URL(route.request().url()).pathname.split("/").at(-1)).toBe(writes[0].key);
          if (failRead) await route.fulfill({ status: 503, json: { detail: "Synthetic failed result check" } });
          else await route.continue();
        });
        await page.route(url => url.pathname === "/api/tasks/active", async route => {
          if (holdRefresh) { heldRefreshReads += 1; await heldRefresh; }
          await route.continue();
        });
        const dialog = page.getByRole("dialog", { name: zh ? "合并对话" : "Merge conversations", exact: true });
        const recoveryEntry = page.getByRole("button", { name: zh ? "核对原合并" : "Review merge request", exact: true });
        const openMerge = async () => {
          await page.getByRole("button", { name: zh ? "批量操作" : "Manage conversations", exact: true }).click();
          for (const item of created) await page.getByRole("checkbox", { name: `${zh ? "选择" : "Select"} ${item.conversation.title}`, exact: true }).check();
          await page.getByTestId("selection-toolbar").getByRole("button", { name: zh ? "合并对话" : "Merge", exact: true }).click();
          await expect(dialog).toBeVisible();
        };
        await page.goto(projectView ? `/projects/${project.id}` : "/");
        await openMerge();
        const title = dialog.getByRole("textbox", { name: zh ? "合并标题" : "Merge title", exact: true });
        await title.fill("Synthetic retained merge request");
        await dialog.locator(".reader-interactive-row").first().getByRole("button", { name: zh ? /^下移：/ : /^Move down:/ }).click();
        const ordered = await dialog.locator("[data-merge-order-title]").allTextContents();
        const submit = dialog.getByRole("button", { name: zh ? "合并 2 个对话" : "Merge 2 conversations", exact: true });
        await submit.click();
        await expect.poll(() => writes.length).toBe(1);
        await expect(title).toHaveAttribute("readonly", "");
        await expect(dialog.getByRole("button", { name: zh ? "正在提交合并…" : "Submitting merge…", exact: true })).toBeDisabled();
        releaseResponse();
        const check = dialog.getByRole("button", { name: zh ? "检查合并结果" : "Check merge result", exact: true });
        await expect(check).toBeEnabled();
        await expect(title).toHaveValue("Synthetic retained merge request");
        expect(await dialog.locator("[data-merge-order-title]").allTextContents()).toEqual(ordered);
        await check.click();
        await expect.poll(() => reads).toBe(1);
        await expect(check).toBeEnabled();
        expect(writes).toHaveLength(1);
        await dialog.screenshot({ path: info.outputPath(`merge-unknown-${width}-${admittedBeforeLoss}.png`) });

        // Remove only our synthetic project memberships, not the conversations.
        // The project remains accessible but neither original source is selectable.
        if (projectView) {
          for (const item of created) expect((await page.request.delete(`/api/projects/${project.id}/conversations/${item.conversation.id}`)).status()).toBe(204);
          const response = await page.request.get(`/api/projects/${project.id}/conversations`);
          expect(response.ok()).toBe(true);
          const rows: ProjectConversationRead[] = await response.json();
          expect(rows.filter(row => created.some(item => item.conversation.id === row.id))).toEqual([]);
        } else {
          // Only the list READ is doubled. Admission, receipt lookup and worker
          // completion still use the real isolated API; this is not DB emptiness.
          await page.route(url => url.pathname === "/api/conversations", async route => {
            if (route.request().method() !== "GET") return route.continue();
            listReads += 1;
            if (admittedBeforeLoss) await route.fulfill({ status: 200, json: [] });
            else await route.fulfill({ status: 503, json: { detail: "Synthetic unavailable conversation list" } });
          });
        }

        // Session recovery must be reachable after reload, with no new selection.
        // Hydration, opening and closing must neither check nor resubmit.
        await page.reload();
        await expect(recoveryEntry).toBeEnabled();
        await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
        await expect(dialog).toHaveCount(0);
        expect(reads).toBe(1); expect(writes).toHaveLength(1);
        if (!projectView) {
          await expect.poll(() => listReads).toBeGreaterThan(0);
          await expect(page.getByText(admittedBeforeLoss ? "There are no conversations here yet" : "Failed to load conversations", { exact: true })).toBeVisible();
        }
        await recoveryEntry.screenshot({ path: info.outputPath(`merge-reentry-${width}-${admittedBeforeLoss}.png`) });
        await recoveryEntry.click();
        await expect(check).toBeEnabled(); await expect(title).toHaveValue("Synthetic retained merge request");
        await expect(title).toHaveAttribute("readonly", "");
        const recoveredTitles = zh
          ? ["之前选择的对话 1", "之前选择的对话 2"]
          : ["Previously selected conversation 1", "Previously selected conversation 2"];
        const orderTitles = dialog.locator("[data-merge-order-title]");
        await expect(orderTitles).toHaveCount(recoveredTitles.length);
        for (const [index, title] of recoveredTitles.entries()) {
          await expect(orderTitles.nth(index)).toHaveAttribute("title", title);
          await expect(orderTitles.nth(index)).toHaveText(`${index + 1}${title}`);
          await expect(orderTitles.nth(index).locator('span[aria-hidden="true"]')).toHaveText(String(index + 1));
        }
        expect(reads).toBe(1); expect(writes).toHaveLength(1);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(recoveryEntry).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(check).toBeEnabled();
        expect(reads).toBe(1); expect(writes).toHaveLength(1);
        failRead = false; holdRefresh = true;
        await check.focus(); await page.keyboard.press("Enter");
        if (!admittedBeforeLoss) {
          const retry = dialog.getByRole("button", { name: zh ? "继续提交原合并" : "Resubmit original merge", exact: true });
          await expect(retry).toBeEnabled();
          expect(writes).toHaveLength(1);
          await retry.click();
        }
        await expect(dialog).toHaveCount(0);
        const resultNotice = page.locator('p[role="status"][tabindex="-1"]').filter({ hasText: zh
          ? /^(合并请求已受理|原合并已完成)/ : /^(Merge request accepted|The original merge completed)/ });
        await expect(resultNotice).toBeVisible();
        await expect(resultNotice).toBeFocused();
        await expect(recoveryEntry).toHaveCount(0);
        await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
        // Prove a real task refresh is outstanding while acknowledgement and
        // focus are already complete; only then release the held read.
        await expect.poll(() => heldRefreshReads).toBeGreaterThan(0);
        await resultNotice.screenshot({ path: info.outputPath(`merge-acknowledged-${width}-${admittedBeforeLoss}.png`) });
        expect(reads).toBe(2);
        expect(writes).toHaveLength(admittedBeforeLoss ? 1 : 2);
        if (!admittedBeforeLoss) expect(writes[1]).toEqual(writes[0]);
        expect(writes[0].key).toMatch(/^[0-9a-f-]{36}$/i);
        releaseRefresh(); holdRefresh = false;
        expect(receipt).toBeDefined();
        const lookupResponse = await page.request.get(`/api/conversations/merge/requests/${writes[0].key}`);
        expect(lookupResponse.ok()).toBe(true);
        const lookup = await lookupResponse.json();
        expect(lookup.found).toBe(true); expect(lookup.task.job_id).toBe(receipt!.job_id);
        await expect.poll(async () => (await (await page.request.get(`/api/tasks/${receipt!.job_id}`)).json()).status).toBe("committed");
        const afterMessages = await Promise.all(created.flatMap(item => item.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json())));
        expect(afterMessages).toEqual(sourceMessages);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        releaseResponse(); releaseRefresh();
        await page.unrouteAll({ behavior: "wait" });
        if (receipt) {
          const current: BackgroundTaskRead = await (await page.request.get(`/api/tasks/${receipt.job_id}`)).json();
          if (["queued", "processing", "cancelling"].includes(current.status)) {
            await page.request.post(`/api/tasks/${receipt.job_id}/cancel`);
            await expect.poll(async () => (await (await page.request.get(`/api/tasks/${receipt!.job_id}`)).json()).status).toMatch(/^(committed|cancelled|failed)$/);
          }
          const final: BackgroundTaskRead = await (await page.request.get(`/api/tasks/${receipt.job_id}`)).json();
          if (typeof final.result.conversation_id === "string") expect((await page.request.delete(`/api/conversations/${final.result.conversation_id}`)).ok()).toBe(true);
        }
        for (const item of created) expect((await page.request.delete(`/api/conversations/${item.conversation.id}`)).ok()).toBe(true);
        await page.request.patch(`/api/projects/${project.id}`, { data: { is_archived: true } });
        expect((await page.request.delete(`/api/projects/${project.id}`)).ok()).toBe(true);
      }
    });
  }
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

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  for (const mode of ["active", "archived"] as const) {
    test(`${width}px ${mode}: failed conversation refresh keeps the reading node and selection through retry`, async ({ page }, info) => {
      await preferences(page, zh);
      await page.setViewportSize({ width, height: 900 });
      const created = await createConversation(page, `Synthetic ${mode} retained list`);
      const id = created.conversation.id;
      let failRead = false, holdRead = false, reads = 0, writes = 0;
      let releaseRead: () => void = () => {};
      const heldRead = new Promise<void>(resolve => { releaseRead = resolve; });
      try {
        if (mode === "archived") expect((await page.request.post(`/api/conversations/${id}/archive`)).ok()).toBe(true);
        const beforeMessages = await Promise.all(created.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json()));
        page.on("request", request => {
          if (new URL(request.url()).pathname.startsWith("/api/conversations") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes += 1;
        });
        await page.route(url => url.pathname === "/api/conversations" && url.searchParams.get("status_scope") === mode && url.searchParams.get("limit") === "5000", async route => {
          reads += 1;
          if (holdRead) await heldRead;
          if (failRead) await route.fulfill({ status: 503, json: { detail: "Synthetic list exception must not render" } });
          else await route.continue();
        });
        await page.clock.install();
        await page.goto(mode === "active" ? "/" : "/archived");
        const heading = mode === "active" ? (zh ? "对话记录" : "Conversation history") : (zh ? "已归档对话" : "Archived conversations");
        const list = page.locator("section[aria-busy]").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
        const link = list.locator(`a[href="/conversations/${id}"]`);
        await expect(link).toBeVisible();
        const original = await link.elementHandle();
        if (!original) throw new Error("Synthetic reading link was not mounted");
        await link.focus();
        const previousReads = reads;
        // A real browser offline/online transition refetches the now-stale query.
        // The targeted 503 is injected; this does not claim a real network outage.
        await page.clock.fastForward(11_000);
        failRead = true;
        await page.context().setOffline(true);
        await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
        await page.context().setOffline(false);
        await expect.poll(() => reads).toBeGreaterThan(previousReads);
        const error = list.getByRole("alert").filter({ hasText: zh ? "对话更新失败，仍显示上次内容" : "Could not update conversations. Previously loaded items are shown." });
        await expect(error).toBeVisible();
        await expect(link).toBeVisible(); await expect(link).toBeFocused();
        expect(await link.evaluate((current, previous) => current === previous, original)).toBe(true);
        await original.dispose();
        await expect(page.getByText("Synthetic list exception must not render", { exact: true })).toHaveCount(0);

        await list.getByRole("button", { name: zh ? "批量操作" : "Manage conversations", exact: true }).click();
        const selected = list.getByRole("checkbox", { name: `${zh ? "选择" : "Select"} ${created.conversation.title}`, exact: true });
        await selected.check();
        const retry = error.getByRole("button", { name: zh ? "重试" : "Retry", exact: true });
        const beforeRetry = reads;
        holdRead = true; failRead = false;
        await retry.click();
        await expect.poll(() => reads).toBe(beforeRetry + 1);
        await expect(retry).toBeDisabled(); await expect(selected).toBeChecked();
        await expect(list.getByTestId("selection-toolbar")).toBeVisible();
        await page.screenshot({ path: info.outputPath(`conversation-list-retry-${mode}-${width}.png`) });
        releaseRead(); holdRead = false;
        await expect(error).toHaveCount(0); await expect(selected).toBeChecked();
        expect(writes).toBe(0); expect(await status(page, id)).toBe(mode);
        const afterMessages = await Promise.all(created.messages.map(async message => (await page.request.get(`/api/messages/${message.id}`)).json()));
        expect(afterMessages).toEqual(beforeMessages);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        releaseRead(); await page.context().setOffline(false);
        await page.unrouteAll({ behavior: "wait" });
        expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
      }
    });
  }

  test(`${width}px: empty active-list recovery retries only the failed existence check and opens Archive`, async ({ page }, info) => {
    await preferences(page, zh);
    await page.setViewportSize({ width, height: 900 });
    const created = await createConversation(page, "Synthetic archived-only recovery");
    const id = created.conversation.id;
    let failExistence = true, primaryReads = 0, existenceReads = 0;
    try {
      expect((await page.request.post(`/api/conversations/${id}/archive`)).ok()).toBe(true);
      const response = await page.request.get("/api/conversations?status_scope=archived&scope=all&limit=5000");
      expect(response.ok()).toBe(true);
      const archived = (await response.json() as { id: string }[]).find(item => item.id === id);
      expect(archived).toBeDefined();
      // Model this UI's empty active read without claiming the shared fixture's
      // whole database is empty. The archive row and its destination are real.
      await page.route(url => url.pathname === "/api/conversations", async route => {
        if (route.request().method() !== "GET") return route.continue();
        const url = new URL(route.request().url());
        if (url.searchParams.get("status_scope") === "active" && url.searchParams.get("limit") === "5000") {
          primaryReads += 1; await route.fulfill({ status: 200, json: [] });
        } else if (url.searchParams.get("include_archived") === "true" && url.searchParams.get("limit") === "1") {
          existenceReads += 1;
          if (failExistence) await route.fulfill({ status: 503, json: { detail: "Synthetic existence exception must not render" } });
          else await route.fulfill({ status: 200, json: [archived] });
        } else await route.continue();
      });
      await page.goto("/");
      const error = page.getByRole("alert").filter({ hasText: zh ? "无法检查已保存的对话" : "Could not check saved conversations" });
      await expect(error).toBeVisible();
      await expect(page.getByText(zh ? "现有对话已归入项目，可在左侧展开项目查看。" : "Existing conversations are filed in projects. Expand a project in the sidebar to view them.", { exact: true })).toHaveCount(0);
      await expect(page.getByText(zh ? "这里还没有对话" : "There are no conversations here yet", { exact: true })).toHaveCount(0);
      const beforePrimary = primaryReads, beforeExistence = existenceReads;
      failExistence = false;
      await error.getByRole("button", { name: zh ? "重试" : "Retry", exact: true }).click();
      await expect(error).toHaveCount(0);
      expect(primaryReads).toBe(beforePrimary); expect(existenceReads).toBe(beforeExistence + 1);
      await expect(page.getByRole("heading", { name: zh ? "暂无活动对话" : "No active conversations", exact: true })).toBeVisible();
      const archive = page.getByRole("link", { name: zh ? "查看归档" : "View archive", exact: true });
      await expect(archive).toHaveAttribute("href", "/archived");
      await page.screenshot({ path: info.outputPath(`conversation-list-archived-only-${width}.png`) });
      await archive.click();
      await expect(page).toHaveURL(url => url.pathname === "/archived");
      await expect(page.getByRole("heading", { name: created.conversation.title, exact: true })).toBeVisible();
      expect(await status(page, id)).toBe("archived");
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
