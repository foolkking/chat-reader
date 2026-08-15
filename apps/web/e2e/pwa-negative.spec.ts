import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

const DATABASE = "chat-reader-offline-library";
const SHELL_META_CACHE = "chat-reader-library-meta-v1";
const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT_URL = `https://offline.chat-reader.local/assets/${ATTACHMENT_ID}`;

test.describe("Release E PWA negative matrix", () => {
  test("PWA-NEG-001..005 critical and optional shell misses are explicit and recoverable", async ({ page, context }) => {
    await page.goto("/library");
    const active = await waitForActiveRecord(page);
    const criticalChunk = active.assets.find((asset) => asset.includes("/_next/static/") && asset.endsWith(".js"));
    if (!criticalChunk) throw new Error("The production shell has no JavaScript runtime chunk.");
    const optionalSkill = "/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md";
    await context.setOffline(true);
    const deleted = await page.evaluate(async ({ cacheName, criticalChunk, optionalSkill }) => {
      const cache = await caches.open(cacheName);
      await cache.delete(criticalChunk);
      await cache.delete(optionalSkill);
      return !(await cache.match(criticalChunk));
    }, { cacheName: active.cacheName, criticalChunk, optionalSkill });
    expect(deleted).toBe(true);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCache");
    await page.close();
    const offlinePage = await context.newPage();
    const response = await offlinePage.goto("/library", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(503);
    await expect(offlinePage.locator("main")).toContainText(/Offline|离线/);
    await expect(offlinePage.locator("main")).toContainText(/not ready|尚未就绪|incomplete|不完整/);
    await expect(offlinePage.getByRole("link", { name: /Retry when online|重新联网后重试/ })).toBeVisible();
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1_024 }]) {
      await offlinePage.setViewportSize(viewport);
      expect(await offlinePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }

    await context.setOffline(false);
    await offlinePage.reload({ waitUntil: "domcontentloaded" });
    await expect(offlinePage.locator("main")).toContainText(/Offline ready|可离线启动/);

    // A non-critical Skill asset may be absent without making Library unusable.
    const repaired = await readActiveRecord(offlinePage);
    await context.setOffline(true);
    await offlinePage.evaluate(async ({ cacheName, optionalSkill }) => {
      const cache = await caches.open(cacheName);
      await cache.delete(optionalSkill);
    }, { cacheName: repaired.cacheName, optionalSkill });
    const optionalPage = await context.newPage();
    await optionalPage.goto("/library", { waitUntil: "domcontentloaded" });
    await expect(optionalPage.locator("main")).toContainText(/Offline library|离线资料库/);
    await expect(optionalPage.locator("main")).toContainText(/Offline ready|可离线启动|Existing offline version is available|现有离线版本仍可用/);
    await expect(optionalPage.locator("main")).not.toContainText(/Offline access is not ready|离线启动尚未就绪/);
  });

  test("PWA-NEG-008 shell cache quota keeps the active shell and supports retry", async ({ page, context }) => {
    await page.goto("/library");
    const active = await waitForActiveRecord(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Storage.overrideQuotaForOrigin", { origin: "http://127.0.0.1:3107", quotaSize: 1_024 });
    try {
      const failed = await sendShellMessage(page, {
        type: "PREPARE_LIBRARY_SHELL",
        revision: `${active.revision}-quota-failure`,
        assets: active.assets,
        criticalAssets: active.criticalAssets ?? active.assets,
        workerUrl: active.workerUrl,
      });
      expect(failed.ok).toBe(false);
      const preserved = await readActiveRecord(page);
      expect(preserved.revision).toBe(active.revision);
      const status = await sendShellMessage(page, { type: "GET_LIBRARY_SHELL_STATUS" });
      expect(status.ok).toBe(true);
      expect(status.status?.ready).toBe(true);
    } finally {
      await cdp.send("Storage.overrideQuotaForOrigin", { origin: "http://127.0.0.1:3107" });
    }

    const retried = await sendShellMessage(page, {
      type: "PREPARE_LIBRARY_SHELL",
      revision: `${active.revision}-quota-retry`,
      assets: active.assets,
      criticalAssets: active.criticalAssets ?? active.assets,
      workerUrl: active.workerUrl,
    });
    expect(retried.ok).toBe(true);
    expect(retried.status?.ready).toBe(true);
  });

  test("PWA-NEG-006..007..020 missing and corrupted attachment resources become unavailable", async ({ page }) => {
    await seedMinimalOfflineFixture(page);
    await page.evaluate(async () => {
      const cache = await caches.open("chat-reader-offline-assets-v1");
      await cache.put("https://offline.chat-reader.local/assets/11111111-1111-4111-8111-111111111111", new Response("corrupted bytes", { headers: { "Content-Type": "text/plain" } }));
    });
    await openOfflineFiles(page);
    const panel = page.getByTestId("offline-conversation-files-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/cached-note\.txt/);
    await expect(panel).toContainText(/missing-image\.png/);
    await expect(panel).toContainText(/missing-document\.pdf/);
    await expect(panel).toContainText(/Unavailable offline|离线不可用/);
    await expect(panel).not.toContainText(/loading|正在加载/i);
  });

  test("PWA-NEG-007 Viewer cache miss is explicit, closable, and restores focus", async ({ page }) => {
    await seedMinimalOfflineFixture(page);
    await openOfflineFiles(page);
    const panel = page.getByTestId("offline-conversation-files-panel");
    const view = panel.getByRole("button", { name: /View cached-note\.txt|查看 cached-note\.txt/ });
    await expect(view).toBeVisible();
    await page.evaluate(async (attachmentUrl) => {
      const cache = await caches.open("chat-reader-offline-assets-v1");
      await cache.delete(attachmentUrl);
    }, ATTACHMENT_URL);
    await view.click();
    const viewer = page.getByTestId("attachment-viewer-shell");
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText("离线资源未缓存");
    await expect(viewer.getByRole("button", { name: "重试" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(view).toBeFocused();
  });

  test("PWA-NEG-008..009..015 quota/cache failure preserves A and retry commits B idempotently", async ({ page }) => {
    await seedMinimalOfflineFixture(page);
    const before = await readFixtureState(page);
    const packageBytes = createReplacementPackage();
    const failed = await importWithFault(page, packageBytes, "package-b-quota", "cache-put-after-first");
    expect(failed.ok).toBe(false);
    const preserved = await readFixtureState(page);
    expect(preserved.revision).toBe(before.revision);
    expect(preserved.assetText).toBe(before.assetText);

    expect((await importWithFault(page, packageBytes, "package-b-quota", null)).ok).toBe(true);
    expect((await importWithFault(page, packageBytes, "package-b-quota", null)).ok).toBe(true);
    const retried = await readFixtureState(page);
    expect(retried.revision).toBe(2);
    expect(retried.packageCount).toBe(1);
  });

  test("PWA-NEG-012..021 failed Dexie transaction restores the old cache and package", async ({ page }) => {
    await seedMinimalOfflineFixture(page);
    const before = await readFixtureState(page);
    const failed = await importWithFault(page, createReplacementPackage(), "package-b-abort", "idb-put");
    expect(failed.ok).toBe(false);
    const afterAbort = await readFixtureState(page);
    expect(afterAbort.revision).toBe(before.revision);
    expect(afterAbort.assetText).toBe(before.assetText);
    expect((await importWithFault(page, createReplacementPackage(), "package-b-abort", null)).ok).toBe(true);
    expect((await readFixtureState(page)).revision).toBe(2);
  });

  test("PWA-NEG-011..013..014..016 partial package and reload never expose false-ready state", async ({ page, context }) => {
    await seedMinimalOfflineFixture(page);
    const before = await readFixtureState(page);
    const full = createReplacementPackage();
    const truncated = full.slice(0, Math.max(8, Math.floor(full.length / 3)));
    const failed = await importWithFault(page, truncated, "package-b-interrupted", null);
    expect(failed.ok).toBe(false);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Offline|离线/);
    expect((await readFixtureState(page)).revision).toBe(before.revision);
  });

  test("PWA-NEG-013..014 browser and Service Worker restart preserve the committed package", async () => {
    const profileParent = path.resolve(process.env.RELEASE_E_PROFILE_ROOT ?? path.join(tmpdir(), "chat-reader-release-e"));
    await mkdir(profileParent, { recursive: true });
    const profile = await mkdtemp(path.join(profileParent, "profile-"));
    let persistent: BrowserContext | null = null;
    try {
      persistent = await chromium.launchPersistentContext(profile, {
        baseURL: "http://127.0.0.1:3107",
        headless: true,
        serviceWorkers: "allow",
      });
      let profilePage = persistent.pages()[0] ?? await persistent.newPage();
      await seedMinimalOfflineFixture(profilePage);
      const before = await readFixtureState(profilePage);
      const failed = await importWithFault(profilePage, createReplacementPackage().slice(0, 24), "package-b-restart", null);
      expect(failed.ok).toBe(false);
      await persistent.close();
      persistent = null;

      persistent = await chromium.launchPersistentContext(profile, {
        baseURL: "http://127.0.0.1:3107",
        headless: true,
        serviceWorkers: "allow",
      });
      await persistent.setOffline(true);
      profilePage = persistent.pages()[0] ?? await persistent.newPage();
      await profilePage.goto("/library?conversationId=offline-negative", { waitUntil: "domcontentloaded" });
      await expect(profilePage.locator("main").first()).toContainText(/Offline|离线/);
      expect((await readFixtureState(profilePage)).revision).toBe(before.revision);
    } finally {
      await persistent?.close().catch(() => undefined);
      const resolvedProfile = path.resolve(profile);
      if (resolvedProfile.startsWith(`${profileParent}${path.sep}`)) {
        await rm(resolvedProfile, { recursive: true, force: true });
      }
    }
  });

  test("PWA-NEG-018..019 offline to online recovery remains bounded", async ({ page, context }) => {
    await seedMinimalOfflineFixture(page);
    const packageRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/offline/packages")) packageRequests.push(request.url());
    });
    await context.setOffline(true);
    await page.goto("/library?conversationId=offline-negative", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Offline|离线/);
    await context.setOffline(false);
    await page.goto("/library", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main").first()).toContainText(/Offline ready|可离线启动/);
    expect(packageRequests.length).toBeLessThanOrEqual(1);
  });
});

type ActiveRecord = { revision: string; cacheName: string; assets: string[]; criticalAssets?: string[]; workerUrl: string };
type ShellResult = { ok: boolean; status?: { ready: boolean; revision: string | null }; error?: string };

async function readActiveRecord(page: Page): Promise<ActiveRecord> {
  return page.evaluate(async (metaCache) => {
    const cache = await caches.open(metaCache);
    const response = await cache.match("/__chat_reader_library_active__");
    if (!response) throw new Error("Active shell record missing.");
    return response.json();
  }, SHELL_META_CACHE);
}

async function waitForActiveRecord(page: Page): Promise<ActiveRecord> {
  let record: ActiveRecord | null = null;
  await expect.poll(async () => {
    record = await page.evaluate(async (metaCache) => {
      const cache = await caches.open(metaCache);
      const response = await cache.match("/__chat_reader_library_active__");
      return response ? await response.json() : null;
    }, SHELL_META_CACHE);
    return Boolean(record);
  }, { timeout: 60_000 }).toBe(true);
  if (!record) throw new Error("Active shell record missing after reconciliation.");
  return record;
}

async function sendShellMessage(page: Page, message: Record<string, unknown>): Promise<ShellResult> {
  return page.evaluate(async (payload) => {
    const registration = await navigator.serviceWorker.getRegistration("/library");
    const worker = registration?.active;
    if (!worker) throw new Error("Active Library Service Worker missing.");
    return new Promise<ShellResult>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => reject(new Error("Service Worker response timed out.")), 30_000);
      channel.port1.onmessage = (event: MessageEvent<ShellResult>) => {
        if (event.data && event.data.ok !== undefined) {
          window.clearTimeout(timer);
          resolve(event.data);
        }
      };
      worker.postMessage(payload, [channel.port2]);
    });
  }, message);
}

async function seedMinimalOfflineFixture(page: Page): Promise<void> {
  await page.goto("/library");
  await waitForActiveRecord(page);
  await expect.poll(() => page.evaluate(async (databaseName) => {
    const databases = await indexedDB.databases();
    return databases.some((database) => database.name === databaseName);
  }, DATABASE)).toBe(true);
  await page.evaluate(({ databaseName, attachmentId, attachmentUrl }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const bytes = new TextEncoder().encode("cached attachment");
      crypto.subtle.digest("SHA-256", bytes).then((digest) => {
        const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
        const transaction = database.transaction(["conversations", "messages", "blocks", "headings", "searchDocuments", "annotations", "notebooks", "readingPositions", "packages", "attachments"], "readwrite");
        transaction.objectStore("conversations").put({ id: "offline-negative", title: "Offline negative fixture", display_title: "Offline negative fixture", description_markdown: null, source_type: "offline", source_profile: "test", message_count: 1, turn_count: 1, created_at: "2026-08-15T00:00:00.000Z", updated_at: "2026-08-15T00:00:00.000Z", imported_at: "2026-08-15T00:00:00.000Z", first_user_message: "offline fixture", status: "active", is_global_pinned: false, global_pinned_at: null, last_read_at: null, manual_sort_order: 0, project_id: null, project_name: null, offline_revision: 1, external_source_id: null, parser_version: "test", render_version: 1, content_hash: "offline-negative", sort_time: "2026-08-15T00:00:00.000Z", downloaded_at: "2026-08-15T00:00:00.000Z" });
        transaction.objectStore("messages").put({ id: "offline-negative-message", conversation_id: "offline-negative", role: "user", order_key: "000001", turn_index: 1, created_at: "2026-08-15T00:00:00.000Z", current_version: { id: "offline-negative-version", version_number: 1, plain_text: "offline fixture", display_text: "offline fixture" }, block_count: 1, char_count: 16, is_heavy: false, ordinal: 1, content_preview: "offline fixture" });
        transaction.objectStore("blocks").put({ key: "offline-negative-message:0", id: "offline-negative-block", conversation_id: "offline-negative", message_id: "offline-negative-message", block_index: 0, block_type: "paragraph", plain_text: "offline fixture", data: { text: "offline fixture" } });
        transaction.objectStore("headings").put({ id: "offline-negative-heading", conversation_id: "offline-negative", heading_index: 0, level: 2, text: "Offline fixture", slug: "offline-fixture", message_id: "offline-negative-message", message_order_key: "000001", block_index: 0 });
        transaction.objectStore("searchDocuments").put({ id: "document:offline-negative", conversation_id: "offline-negative", message_id: "offline-negative-message", document_type: "message", role: "user", title: "Offline negative fixture", plain_text: "offline fixture", search_text: "offline fixture", order_key: "000001", turn_index: 1, metadata: {} });
        transaction.objectStore("attachments").put({ id: attachmentId, conversation_id: "offline-negative", message_id: "offline-negative-message", message_version_id: "offline-negative-version", display_name: "cached-note.txt", original_filename: "cached-note.txt", declared_mime_type: "text/plain", detected_mime_type: "text/plain", byte_size: bytes.byteLength, sha256, content_path: "assets/cached-note.txt", status: "available", scan_status: "unscanned", resolution_status: "resolved", occurrences: [] });
        transaction.objectStore("attachments").put({ id: "22222222-2222-4222-8222-222222222222", conversation_id: "offline-negative", message_id: null, message_version_id: null, display_name: "missing-image.png", original_filename: "missing-image.png", declared_mime_type: "image/png", detected_mime_type: "image/png", byte_size: 9, sha256: "b".repeat(64), content_path: "assets/missing-image.png", status: "available", scan_status: "unscanned", resolution_status: "resolved", occurrences: [] });
        transaction.objectStore("attachments").put({ id: "33333333-3333-4333-8333-333333333333", conversation_id: "offline-negative", message_id: null, message_version_id: null, display_name: "missing-document.pdf", original_filename: "missing-document.pdf", declared_mime_type: "application/pdf", detected_mime_type: "application/pdf", byte_size: 16, sha256: "c".repeat(64), content_path: "assets/missing-document.pdf", status: "available", scan_status: "unscanned", resolution_status: "resolved", occurrences: [] });
        transaction.oncomplete = async () => {
          const cache = await caches.open("chat-reader-offline-assets-v1");
          await cache.put(attachmentUrl, new Response(bytes, { headers: { "Content-Type": "text/plain" } }));
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }).catch(reject);
    };
    request.onerror = () => reject(request.error);
  }), { databaseName: DATABASE, attachmentId: ATTACHMENT_ID, attachmentUrl: ATTACHMENT_URL });
}

async function openOfflineFiles(page: Page): Promise<void> {
  await page.goto("/library?conversationId=offline-negative");
  const action = page.getByRole("button", { name: /Conversation files|当前对话文件/ }).first();
  if (!await action.isVisible().catch(() => false)) await page.getByRole("button", { name: /More|Message actions|更多/ }).first().click();
  await page.getByRole("button", { name: /Conversation files|当前对话文件/ }).first().click();
}

function createReplacementPackage(): number[] {
  const binary = new TextEncoder().encode("replacement attachment");
  const secondBinary = new TextEncoder().encode("second replacement attachment");
  const sha256 = createHash("sha256").update(binary).digest("hex");
  const secondSha256 = createHash("sha256").update(secondBinary).digest("hex");
  const payload = {
    format: "chat-reader-offline-package",
    version: 3,
    update_mode: "conversation-delta",
    catalog_revision: "revision-b",
    scope: "conversation",
    scope_id: "offline-negative",
    conversations: [{
      id: "offline-negative",
      title: "Offline negative fixture",
      display_title: "Offline negative fixture",
      message_count: 1,
      turn_count: 1,
      offline_revision: 2,
      updated_at: "2026-08-15T01:00:00.000Z",
      messages: [],
      headings: [],
      search_documents: [],
      annotations: [],
      notebook: null,
      reading_position: null,
      attachments: [
        { id: ATTACHMENT_ID, display_name: "cached-note.txt", original_filename: "cached-note.txt", declared_mime_type: "text/plain", detected_mime_type: "text/plain", byte_size: binary.byteLength, sha256, content_path: "assets/replacement.txt", status: "available", scan_status: "unscanned", resolution_status: "resolved", occurrences: [] },
        { id: "44444444-4444-4444-8444-444444444444", display_name: "second-note.txt", original_filename: "second-note.txt", declared_mime_type: "text/plain", detected_mime_type: "text/plain", byte_size: secondBinary.byteLength, sha256: secondSha256, content_path: "assets/second-replacement.txt", status: "available", scan_status: "unscanned", resolution_status: "resolved", occurrences: [] },
      ],
    }],
  };
  const entries = zipSync({ "package.json": strToU8(JSON.stringify(payload)), "assets/replacement.txt": binary, "assets/second-replacement.txt": secondBinary });
  return Array.from(entries);
}

async function importWithFault(page: Page, bytes: number[], packageId: string, fault: "cache-put-after-first" | "idb-put" | null): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async ({ bytes, packageId, fault }) => {
    const hook = window.__chatReaderPwaNegativeTest;
    if (!hook) throw new Error("PWA negative test bridge is not enabled.");
    const originalCachePut = Cache.prototype.put;
    const originalStorePut = IDBObjectStore.prototype.put;
    let attachmentCachePuts = 0;
    if (fault === "cache-put-after-first") {
      Cache.prototype.put = async function(request, response) {
        const url = request instanceof Request ? request.url : String(request);
        if (url.includes("/assets/") && ++attachmentCachePuts >= 2) throw new DOMException("Synthetic quota", "QuotaExceededError");
        return originalCachePut.call(this, request, response);
      };
    }
    if (fault === "idb-put") {
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === "conversations" && value && (value as { id?: string; offline_revision?: number }).id === "offline-negative" && (value as { offline_revision?: number }).offline_revision === 2) {
          throw new DOMException("Synthetic transaction abort", "AbortError");
        }
        return key === undefined ? originalStorePut.call(this, value) : originalStorePut.call(this, value, key);
      };
    }
    try {
      await hook.importOfflinePackage(packageId, new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Length": String(bytes.length) } }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      Cache.prototype.put = originalCachePut;
      IDBObjectStore.prototype.put = originalStorePut;
    }
  }, { bytes, packageId, fault });
}

async function readFixtureState(page: Page): Promise<{ revision: number; assetText: string | null; packageCount: number }> {
  return page.evaluate(async ({ databaseName, attachmentUrl }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["conversations", "packages", "attachments"], "readonly");
      const conversationRequest = transaction.objectStore("conversations").get("offline-negative");
      const packageRequest = transaction.objectStore("packages").count();
      const attachmentRequest = transaction.objectStore("attachments").get("11111111-1111-4111-8111-111111111111");
      Promise.all([
        new Promise<Record<string, unknown> | undefined>((done) => { conversationRequest.onsuccess = () => done(conversationRequest.result); conversationRequest.onerror = () => done(undefined); }),
        new Promise<number>((done) => { packageRequest.onsuccess = () => done(packageRequest.result); packageRequest.onerror = () => done(0); }),
        new Promise<Record<string, unknown> | undefined>((done) => { attachmentRequest.onsuccess = () => done(attachmentRequest.result); attachmentRequest.onerror = () => done(undefined); }),
      ]).then(async ([conversation, packageCount, attachment]) => {
        const cache = await caches.open("chat-reader-offline-assets-v1");
        const sha256 = typeof attachment?.sha256 === "string" ? attachment.sha256.toLowerCase() : null;
        const response = (sha256 ? await cache.match(`${attachmentUrl}/${encodeURIComponent(sha256)}`) : undefined)
          ?? await cache.match(attachmentUrl);
        const assetText = response ? await response.text() : null;
        database.close();
        resolve({ revision: Number(conversation?.offline_revision ?? 0), assetText, packageCount });
      }).catch(reject);
    };
  }), { databaseName: DATABASE, attachmentUrl: ATTACHMENT_URL });
}
