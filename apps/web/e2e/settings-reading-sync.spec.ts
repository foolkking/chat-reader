import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import type { ReadingPositionRead } from "../lib/types";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL and worker");
const password = "synthetic reading sync passphrase";

async function seed(context: BrowserContext, baseURL: string) {
  const email = `reading-${Date.now()}@example.test`, headers = { Origin: baseURL };
  const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email, password, confirm_password: password } });
  expect(registered.status()).toBe(201); const userId = (await registered.json()).user_id as string;
  const text = Array.from({ length: 260 }, (_, i) => `Synthetic reading paragraph ${i}. ${"Text for a stable source anchor. ".repeat(8)}`).join("\n\n");
  const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic reading sync", messages: [{ role: "user", content_markdown: "Synthetic reading question" }, { role: "assistant", content_markdown: text }] } });
  expect(created.status()).toBe(201); const id = (await created.json()).conversation.id as string;
  return { id, userId, email };
}
async function local(page: Page, userId: string, id: string) {
  return page.evaluate(async ({ userId, id }) => {
    const hex = Array.from(new TextEncoder().encode(userId), (b) => b.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === userId ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${hex}`;
    return new Promise<{ position?: ReadingPositionRead; pending: Array<{ operation_id: string; payload: Record<string, unknown>; submitted?: boolean; attempts: number }>; conflict: boolean }>((resolve, reject) => {
      const request = indexedDB.open(name); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(["readingPositions", "outbox", "settings"]);
        const position = tx.objectStore("readingPositions").get(id), pending = tx.objectStore("outbox").getAll(), conflict = tx.objectStore("settings").get(`sync-conflict:reading_position:${id}`);
        tx.oncomplete = () => { db.close(); resolve({ position: position.result, pending: pending.result.filter((row: { entity_type: string; conversation_id: string }) => row.entity_type === "reading_position" && row.conversation_id === id), conflict: Boolean(conflict.result) }); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { userId, id });
}
async function scroll(page: Page, delta: number) {
  const root = page.getByTestId("reader-scroll-root"); await expect(root).toBeVisible();
  await expect(root.locator("article").first()).toBeVisible();
  if (await root.getAttribute("data-navigation-stage")) await expect(root).toHaveAttribute("data-navigation-stage", "settled");
  await root.hover(); await page.mouse.wheel(0, delta);
}
async function server(context: BrowserContext, baseURL: string, id: string) {
  const response = await context.request.get(`${baseURL}/api/conversations/${id}/reading-position`);
  expect(response.status()).toBe(200); return (await response.json()).position as ReadingPositionRead | null;
}

for (const choice of ["local", "server"] as const) test(`reading conflict keeps current Reader until ${choice} is chosen`, async ({ browser, playwright, baseURL }) => {
  test.setTimeout(130_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const a = await browser.newContext({ locale: "en-US", viewport: { width: choice === "local" ? 375 : 1440, height: 900 } }), b = await browser.newContext({ locale: "en-US" });
  try {
    const { id, userId, email } = await seed(a, baseURL!);
    const pa = await a.newPage(); await pa.goto(`${baseURL}/library?conversationId=${id}`);
    await pa.getByRole("button", { name: "Download offline copy", exact: true }).click();
    await expect(pa.getByTestId("reader-scroll-root")).toBeVisible();
    await scroll(pa, 950);
    await expect.poll(async () => (await server(a, baseURL!, id))?.revision).toBe(1);
    expect((await b.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(200);
    const pb = await b.newPage(); await pb.goto(`${baseURL}/conversations/${id}`);
    await a.setOffline(true); await scroll(pa, 1700);
    await expect.poll(async () => (await local(pa, userId, id)).pending.length).toBe(1);
    const before = (await local(pa, userId, id)).position!;
    await scroll(pb, 4500); await expect.poll(async () => (await server(b, baseURL!, id))?.revision).toBe(2);
    const remote = (await server(b, baseURL!, id))!;
    expect(remote.block_index).not.toBe(before.block_index);
    const scrollTop = await pa.getByTestId("reader-scroll-root").evaluate((node) => node.scrollTop);
    await a.setOffline(false);
    const status = pa.getByRole("region", { name: "Reading progress sync", exact: true });
    await expect(status.getByRole("button", { name: "Continue here", exact: true })).toBeVisible();
    expect(Math.abs(await pa.getByTestId("reader-scroll-root").evaluate((node) => node.scrollTop) - scrollTop)).toBeLessThanOrEqual(24);
    expect((await local(pa, userId, id)).position?.block_index).toBe(before.block_index);
    if (process.env.SETTINGS_SCREENSHOT_DIR) await pa.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/reading-conflict-${choice}.png` });
    await pa.reload();
    await expect(status.getByRole("button", { name: "Continue here", exact: true })).toBeVisible();
    expect((await local(pa, userId, id)).conflict).toBe(true);
    await status.getByRole("button", { name: choice === "local" ? "Continue here" : "Use other device position", exact: true }).click();
    await expect.poll(async () => (await local(pa, userId, id)).conflict).toBe(false);
    await expect.poll(async () => (await local(pa, userId, id)).pending.length).toBe(0);
    const saved = (await server(a, baseURL!, id))!;
    expect(saved.block_index).toBe(choice === "local" ? before.block_index : remote.block_index);
    expect(saved.revision).toBe(choice === "local" ? 3 : 2);
    if (choice === "server") {
      const target = pa.locator(`#block-${remote.message_id}-${remote.block_index}`);
      await expect(target).toBeVisible();
      await expect(pa.getByTestId("reader-scroll-root")).toHaveAttribute("data-navigation-stage", "settled");
      await expect.poll(() => target.evaluate((node, offset) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let remaining = offset;
        while (walker.nextNode()) {
          const text = walker.currentNode as Text;
          if (remaining >= text.length) { remaining -= text.length; continue; }
          const range = document.createRange(); range.setStart(text, remaining); range.setEnd(text, Math.min(remaining + 1, text.length));
          return Math.abs(range.getBoundingClientRect().top - document.querySelector("[data-reader-scroll-root='true']")!.getBoundingClientRect().top - 120);
        }
        return Infinity;
      }, Number(remote.anchor_data.character_offset ?? 0))).toBeLessThanOrEqual(24);
    }
    await pa.waitForTimeout(1500);
    expect((await server(a, baseURL!, id))?.revision).toBe(saved.revision);
  } finally { await a.close(); await b.close(); await admin.dispose(); }
});

test("an incoming remote position changes the next restore without scrolling the active Reader", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const a = await browser.newContext({ locale: "en-US" }), b = await browser.newContext({ locale: "en-US" });
  try {
    const { id, userId, email } = await seed(a, baseURL!), pa = await a.newPage();
    await pa.goto(`${baseURL}/conversations/${id}`);
    await scroll(pa, 1300); await expect.poll(async () => (await server(a, baseURL!, id))?.revision).toBe(1);
    await expect.poll(async () => (await local(pa, userId, id)).pending.length).toBe(0);
    expect((await b.request.post(`${baseURL}/api/auth/login`, { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(200);
    const pb = await b.newPage(); await pb.goto(`${baseURL}/conversations/${id}`); await scroll(pb, 4200);
    await expect.poll(async () => (await server(b, baseURL!, id))?.revision).toBe(2);
    const remote = (await server(b, baseURL!, id))!;
    const top = await pa.getByTestId("reader-scroll-root").evaluate((node) => node.scrollTop);
    await pa.bringToFront(); await pa.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(async () => (await local(pa, userId, id)).position?.revision).toBe(2);
    await pa.waitForTimeout(1200);
    expect(Math.abs(await pa.getByTestId("reader-scroll-root").evaluate((node) => node.scrollTop) - top)).toBeLessThanOrEqual(24);
    expect((await server(a, baseURL!, id))?.revision).toBe(2);
    expect((await local(pa, userId, id)).pending).toHaveLength(0);
    await pa.reload(); await expect(pa.locator(`#block-${remote.message_id}-${remote.block_index}`)).toBeVisible();
    await expect(pa.getByTestId("reader-scroll-root")).toHaveAttribute("data-navigation-stage", "settled");
  } finally { await a.close(); await b.close(); await admin.dispose(); }
});

for (const scenario of ["lost response", "newer scroll"] as const) test(`reading progress survives ${scenario}`, async ({ browser, playwright, baseURL }) => {
  test.setTimeout(100_000);
  const admin = await settingsAdmin(playwright.request, baseURL!), context = await browser.newContext({ locale: "en-US" });
  let release: (() => void) | undefined;
  try {
    const { id, userId } = await seed(context, baseURL!), page = await context.newPage();
    await page.goto(`${baseURL}/conversations/${id}`);
    let committed = false; const operations: string[] = [], barrier = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/reading-position/sync", async (route) => {
      operations.push(route.request().postDataJSON().operation_id);
      const response = await route.fetch();
      if (operations.length === 1) { committed = true; if (scenario === "lost response") { await route.abort("failed"); return; } await barrier; }
      await route.fulfill({ response });
    });
    await scroll(page, 1300); await expect.poll(() => committed).toBe(true);
    if (scenario === "lost response") {
      await expect.poll(async () => (await local(page, userId, id)).pending[0]?.attempts).toBe(1);
      await page.reload();
    } else {
      await scroll(page, 2600); await expect.poll(async () => (await local(page, userId, id)).pending.length).toBe(2);
      release!();
    }
    await expect.poll(async () => (await local(page, userId, id)).pending.length).toBe(0);
    const saved = (await server(context, baseURL!, id))!;
    expect((await local(page, userId, id)).position?.block_index).toBe(saved.block_index);
    expect(saved.revision).toBe(scenario === "lost response" ? 1 : 2);
    expect(new Set(operations).size).toBe(scenario === "lost response" ? 1 : 2);
  } finally { release?.(); await context.close(); await admin.dispose(); }
});

test("reading save failure retains the last durable position and retries the new anchor", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!), context = await browser.newContext({ locale: "en-US" });
  try {
    const { id, userId } = await seed(context, baseURL!), page = await context.newPage();
    await page.goto(`${baseURL}/conversations/${id}`); await scroll(page, 900);
    await expect.poll(async () => (await server(context, baseURL!, id))?.revision).toBe(1);
    await expect.poll(async () => (await local(page, userId, id)).pending.length).toBe(0);
    const before = (await local(page, userId, id)).position!;
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === "readingPositions") throw new DOMException("Synthetic reading quota failure", "QuotaExceededError");
        return put.call(this, value, key);
      };
      (window as typeof window & { restoreReadingPut?: () => void }).restoreReadingPut = () => { IDBObjectStore.prototype.put = put; };
    });
    await scroll(page, 3000);
    const status = page.getByRole("region", { name: "Reading progress sync", exact: true });
    await expect(status).toContainText("Reading progress could not be saved");
    expect((await local(page, userId, id)).position?.block_index).toBe(before.block_index);
    expect((await local(page, userId, id)).pending).toHaveLength(0);
    expect((await server(context, baseURL!, id))?.revision).toBe(1);
    await page.evaluate(() => (window as typeof window & { restoreReadingPut?: () => void }).restoreReadingPut?.());
    await status.getByRole("button", { name: "Retry saving and syncing progress", exact: true }).click();
    await expect.poll(async () => (await server(context, baseURL!, id))?.revision).toBe(2);
    expect((await server(context, baseURL!, id))?.block_index).not.toBe(before.block_index);
    await page.reload();
    const restored = (await server(context, baseURL!, id))!;
    await expect(page.locator(`#block-${restored.message_id}-${restored.block_index}`)).toBeVisible();
  } finally { await context.close(); await admin.dispose(); }
});

test("online Reader restores server progress when IndexedDB is unavailable and reconnects storage on retry", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!), context = await browser.newContext({ locale: "en-US" });
  try {
    const { id } = await seed(context, baseURL!), first = await context.newPage();
    await first.goto(`${baseURL}/conversations/${id}`); await scroll(first, 2200);
    await expect.poll(async () => (await server(context, baseURL!, id))?.revision).toBe(1);
    const saved = (await server(context, baseURL!, id))!;
    await first.close();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = () => { throw new DOMException("Synthetic unavailable IndexedDB", "SecurityError"); };
      (window as typeof window & { restoreReadingStorage?: () => void }).restoreReadingStorage = () => { IDBFactory.prototype.open = open; };
    });
    await page.goto(`${baseURL}/conversations/${id}`);
    await expect(page.locator(`#block-${saved.message_id}-${saved.block_index}`)).toBeVisible();
    await expect(page.getByTestId("reader-scroll-root")).toHaveAttribute("data-navigation-stage", "settled");
    const status = page.getByRole("region", { name: "Reading progress sync", exact: true });
    await expect(status).toContainText("Cannot read local progress");
    expect((await server(context, baseURL!, id))?.revision).toBe(1);
    await page.evaluate(() => (window as typeof window & { restoreReadingStorage?: () => void }).restoreReadingStorage?.());
    await status.getByRole("button", { name: "Retry saving and syncing progress", exact: true }).click();
    await expect(status).toHaveCount(0);
    await scroll(page, 2400);
    await expect.poll(async () => (await server(context, baseURL!, id))?.revision).toBe(2);
  } finally { await context.close(); await admin.dispose(); }
});

test("stale and unavailable reading comparisons preserve conflict until reviewed again", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!), context = await browser.newContext({ locale: "en-US" });
  try {
    const { id, userId } = await seed(context, baseURL!), page = await context.newPage();
    await page.goto(`${baseURL}/conversations/${id}`); await scroll(page, 900);
    await expect.poll(async () => (await server(context, baseURL!, id))?.revision).toBe(1);
    await expect.poll(async () => (await local(page, userId, id)).pending.length).toBe(0);
    const first = (await server(context, baseURL!, id))!;
    await context.setOffline(true); await scroll(page, 2500);
    await expect.poll(async () => (await local(page, userId, id)).pending.length).toBe(1);
    const before = (await local(page, userId, id)).position!;
    const writeRemote = async (delta: number) => {
      const response = await context.request.put(`${baseURL}/api/conversations/${id}/reading-position`, { headers: { Origin: baseURL! }, data: { message_id: first.message_id, block_index: (first.block_index ?? 0) + delta, scroll_offset: 0, anchor_data: { ...first.anchor_data, block_index: (first.block_index ?? 0) + delta, character_offset: 0 } } });
      expect(response.status()).toBe(200);
    };
    await writeRemote(15); await context.setOffline(false);
    const status = page.getByRole("region", { name: "Reading progress sync", exact: true });
    await expect(status.getByRole("button", { name: "Use other device position", exact: true })).toBeVisible();
    await page.route(`**/api/conversations/${id}/reading-position`, (route) => route.abort("failed"));
    await status.getByRole("button", { name: "Use other device position", exact: true }).click();
    await expect(status.getByRole("alert")).toBeVisible();
    expect((await local(page, userId, id)).conflict).toBe(true);
    expect((await local(page, userId, id)).position?.block_index).toBe(before.block_index);
    await page.unroute(`**/api/conversations/${id}/reading-position`);
    await writeRemote(25);
    await status.getByRole("button", { name: "Use other device position", exact: true }).click();
    await expect(status).toContainText(`Other device: Message 2 · Block ${(first.block_index ?? 0) + 26}`);
    expect((await local(page, userId, id)).conflict).toBe(true);
    expect((await local(page, userId, id)).position?.block_index).toBe(before.block_index);
    await status.getByRole("button", { name: "Continue here", exact: true }).click();
    await expect.poll(async () => (await server(context, baseURL!, id))?.revision).toBe(4);
    expect((await server(context, baseURL!, id))?.block_index).toBe(before.block_index);
  } finally { await context.close(); await admin.dispose(); }
});

test("reading-only conflict survives package update and can be exported before copy removal", async ({ browser, playwright, baseURL }, info) => {
  test.setTimeout(130_000);
  const admin = await settingsAdmin(playwright.request, baseURL!), context = await browser.newContext({ locale: "en-US" });
  try {
    const { id, userId } = await seed(context, baseURL!), page = await context.newPage();
    await page.goto(`${baseURL}/library?conversationId=${id}`);
    await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
    await scroll(page, 900); await expect.poll(async () => (await server(context, baseURL!, id))?.revision).toBe(1);
    await expect.poll(async () => (await local(page, userId, id)).pending.length).toBe(0);
    const first = (await server(context, baseURL!, id))!;
    await context.setOffline(true); await scroll(page, 2400);
    await expect.poll(async () => (await local(page, userId, id)).pending.length).toBe(1);
    const before = (await local(page, userId, id)).position!;
    expect((await context.request.put(`${baseURL}/api/conversations/${id}/reading-position`, { headers: { Origin: baseURL! }, data: { message_id: first.message_id, block_index: first.block_index, scroll_offset: 1, anchor_data: first.anchor_data } })).status()).toBe(200);
    await context.setOffline(false);
    await expect.poll(async () => (await local(page, userId, id)).conflict).toBe(true);
    await page.goto(`${baseURL}/recent`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /Offline & sync/ }).click();
    const center = page.getByRole("dialog", { name: "Offline & sync", exact: true });
    // Dropping this one copy's advertised base forces the real worker/package
    // pipeline to carry a different server position into the local importer.
    let packages = 0;
    await page.route("**/api/offline/packages", async (route) => {
      const data = route.request().postDataJSON();
      await route.continue({ postData: JSON.stringify({ ...data, known_revisions: {} }) });
    });
    page.on("response", (response) => { if (response.url().includes("/offline/packages/") && response.url().endsWith("/download") && response.ok()) packages += 1; });
    await center.getByRole("button", { name: "Check and update", exact: true }).click();
    await expect.poll(() => packages).toBeGreaterThan(0);
    await expect(center.getByRole("progressbar")).toHaveCount(0);
    expect((await local(page, userId, id)).conflict).toBe(true);
    expect((await local(page, userId, id)).position?.block_index).toBe(before.block_index);
    await center.getByRole("tab", { name: "Failures & conflicts", exact: true }).click();
    await center.getByRole("button", { name: "Compare and resolve", exact: true }).click();
    await expect(center.getByRole("region", { name: "Reading progress sync", exact: true })).toContainText("Another device updated your reading position");
    await center.getByRole("button", { name: "Back to sync center", exact: true }).click();
    await center.getByRole("tab", { name: "Offline copies", exact: true }).click();
    await center.getByRole("button", { name: "Delete copy", exact: true }).click();
    const review = page.getByRole("region", { name: "Handle local changes before clearing data", exact: true });
    await expect(review).toBeVisible();
    const download = page.waitForEvent("download");
    await review.getByRole("button", { name: "Export local changes", exact: true }).click();
    const path = info.outputPath("synthetic-reading-recovery.zip"); await (await download).saveAs(path);
    const content = JSON.parse(strFromU8(unzipSync(await readFile(path))["changes.json"]));
    expect(content.reading_positions).toHaveLength(1);
    expect(content.reading_positions[0].block_index).toBe(before.block_index);
    await review.getByRole("button", { name: "Discard local changes and delete copy", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard these local changes and delete the copy?", exact: true }).getByRole("button", { name: "Discard and continue", exact: true }).click();
    await expect(review).toHaveCount(0);
    const after = await local(page, userId, id);
    expect(after.position).toBeUndefined(); expect(after.pending).toHaveLength(0); expect(after.conflict).toBe(false);
    expect((await server(context, baseURL!, id))?.revision).toBe(2);
  } finally { await context.close(); await admin.dispose(); }
});
