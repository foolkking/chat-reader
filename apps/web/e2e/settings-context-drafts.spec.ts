import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";
import { readLocal } from "./settings-offline-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires the authenticated PostgreSQL settings fixture and worker");

const password = "synthetic context draft account password";
const savedCurrent = "# Saved synthetic Current\n\nServer content stays independent of local drafts.";
const savedIndex = '{"about":"Saved synthetic Index"}';

async function register(context: BrowserContext, baseURL: string, tag: string) {
  const email = `context-draft-${tag}-${Date.now()}@example.test`;
  const response = await context.request.post("/api/auth/register", { data: { email, password, confirm_password: password } });
  expect(response.status()).toBe(201);
  const userId = (await response.json()).user_id as string;
  await settingsAppearance(context.request, baseURL, "en-US");
  return { email, userId };
}

async function createConversation(request: APIRequestContext, title: string) {
  const response = await request.post("/api/conversations", { data: { title, messages: [
    { role: "user", content_markdown: "Synthetic context question" },
    { role: "assistant", content_markdown: "Synthetic context answer" },
  ] } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).conversation.id as string;
  const stored = await request.put(`/api/conversations/${id}/continuation/files`, { multipart: {
    base_generation: "0", current: { name: "current.md", mimeType: "text/markdown", buffer: Buffer.from(savedCurrent) },
    index: { name: "index.json", mimeType: "application/json", buffer: Buffer.from(savedIndex) },
  } });
  expect(stored.status()).toBe(200);
  return id;
}

// Test-only inspection observes retained bytes even while application access is
// locked. It never changes an identity or bypasses the product's read/write path.
async function drafts(page: Page, userId: string) {
  return page.evaluate(async uid => {
    const namespace = Array.from(new TextEncoder().encode(uid), byte => byte.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === uid
      ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
    if (!(await indexedDB.databases()).some(db => db.name === name)) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ key: string; value: { text: string; original: string; conversation_id: string; member: string; version: number } }>>((resolve, reject) => {
        const request = db.transaction("settings").objectStore("settings").getAll();
        request.onsuccess = () => resolve(request.result.filter(row => row.key.startsWith("continuation-draft:")));
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, userId);
}

async function editDraft(page: Page, id: string, text: string, member = "current") {
  await page.goto(`/conversations/${id}?continuation=${member}`);
  const panel = page.getByRole("region", { name: "Context continuation", exact: true });
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  await panel.getByRole("textbox", { name: `Edit ${member}`, exact: true }).fill(text);
  await expect(panel.getByRole("status").filter({ hasText: "Draft saved on this device" })).toBeVisible();
  return panel;
}

async function downloadCopy(page: Page, userId: string, id: string) {
  await page.goto(`/library?conversationId=${id}`);
  await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
  await expect.poll(async () => (await readLocal(page, userId)).conversations.some(row => (row as { id: string }).id === id)).toBe(true);
  await expect(page.getByText("Synthetic context answer", { exact: true }).first()).toBeVisible();
  await expect(page.locator("p:visible, span:visible").filter({ hasText: /^Offline ready|^Existing offline version is available/ }).first()).toBeVisible();
}

async function openSettings(page: Page, section: string) {
  const button = page.getByRole("button", { name: "Settings", exact: true });
  const sidebar = page.getByRole("button", { name: "Open sidebar", exact: true });
  await expect(button.or(sidebar).first()).toBeVisible();
  if (!await button.isVisible()) await sidebar.click();
  await button.click();
  await page.getByRole("button", { name: section, exact: false }).click();
}

test("expired Continuation cache and drafts stay locked, survive another account and resume only for their owner", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(150_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! }, viewport: { width: 1440, height: 1000 } });
  const users: string[] = [];
  try {
    const a = await register(context, baseURL!, "a"); users.push(a.userId);
    const id = await createConversation(context.request, "Synthetic owner A continuation");
    const initialState = await (await context.request.get(`/api/conversations/${id}/continuation`)).json();
    const page = await context.newPage(); await page.clock.install();
    const textA = "# Private owner A draft";
    await editDraft(page, id, textA);
    const before = await drafts(page, a.userId);
    expect(before).toHaveLength(1);
    page.once("dialog", dialog => dialog.accept());
    await downloadCopy(page, a.userId, id);
    const offlineBefore = await readLocal(page, a.userId);
    const cached = offlineBefore.conversations[0] as { continuation: { members: { current: { text: string }; index: { text: string } } } };
    expect(cached.continuation.members.current.text).toBe(savedCurrent);
    expect(cached.continuation.members.index.text).toBe(savedIndex);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Continuation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Saved synthetic Current" })).toBeVisible();
    await page.clock.fastForward(49 * 60 * 60 * 1000);
    await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Context continuation", exact: true })).toHaveCount(0);
    expect(await drafts(page, a.userId)).toEqual(before);
    expect(await readLocal(page, a.userId)).toEqual(offlineBefore);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
    expect(await drafts(page, a.userId)).toEqual(before);

    await context.clearCookies(); await context.setOffline(false); await page.clock.setFixedTime(new Date());
    const b = await register(context, baseURL!, "b"); users.push(b.userId);
    const otherId = await createConversation(context.request, "Synthetic owner B continuation");
    const textB = "# Private owner B draft";
    await editDraft(page, otherId, textB);
    expect((await drafts(page, b.userId)).map(row => row.value.text)).toEqual([textB]);
    expect(await drafts(page, a.userId)).toEqual(before);
    for (const path of [`/api/conversations/${id}/continuation`, `/api/conversations/${id}/continuation/revisions`,
      `/api/conversations/${id}/continuation/revisions/${initialState.adopted_revision_id}/members/current`]) {
      expect((await context.request.get(path)).status()).toBe(404);
    }
    const foreignSave = await context.request.put(`/api/conversations/${id}/continuation/files`, { multipart: {
      base_generation: "1", current: { name: "current.md", mimeType: "text/markdown", buffer: Buffer.from("Foreign overwrite") },
    } });
    expect(foreignSave.status()).toBe(404);
    const beforeB = await drafts(page, b.userId);
    expect((await context.request.post("/api/auth/login", { data: { email: a.email, password } })).status()).toBe(200);
    page.once("dialog", dialog => dialog.accept());
    await page.goto(`/conversations/${id}?continuation=current`);
    await page.getByRole("button", { name: "Resume draft", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Edit current" })).toHaveValue(textA);
    await expect(page.getByText(textB, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Private owner A draft" })).toBeVisible();
    await expect.poll(() => drafts(page, a.userId)).toEqual([]);
    expect(await drafts(page, b.userId)).toEqual(beforeB);
    const state = await (await context.request.get(`/api/conversations/${id}/continuation`)).json();
    expect(await (await context.request.get(`/api/conversations/${id}/continuation/revisions/${state.adopted_revision_id}/members/current`)).text()).toBe(textA);
  } finally {
    for (const id of users) await removeSyntheticAccount(admin, id);
    await context.close(); await admin.dispose();
  }
});

test("Current draft quota and cleanup failures retain recoverable text at 375px", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! }, viewport: { width: 375, height: 950 } });
  let userId: string | undefined;
  try {
    userId = (await register(context, baseURL!, "quota")).userId;
    const id = await createConversation(context.request, "Synthetic draft quota");
    const page = await context.newPage();
    const original = "# Durable local draft", changed = "# Latest in-memory text after quota failure";
    const panel = await editDraft(page, id, original);
    const before = await drafts(page, userId);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...args) {
        if (this.name === "settings" && value?.key?.startsWith("continuation-draft:")) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Synthetic continuation quota failure", "QuotaExceededError");
        }
        return put.call(this, value, ...args);
      };
    });
    await panel.getByRole("textbox", { name: "Edit current" }).fill(changed);
    await expect(panel.getByRole("status")).toContainText("Local draft could not be saved");
    expect(await drafts(page, userId)).toEqual(before);
    await expect(panel.getByRole("textbox", { name: "Edit current" })).toHaveValue(changed);
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download draft", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("current.md");
    expect(await readFile((await file.path())!, "utf8")).toBe(changed);
    await panel.getByRole("button", { name: "Retry saving draft", exact: true }).click();
    await expect.poll(async () => (await drafts(page, userId!)).map(row => row.value.text)).toEqual([changed]);
    await page.evaluate(() => {
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function(key) {
        if (this.name === "settings" && typeof key === "string" && key.startsWith("continuation-draft:")) {
          IDBObjectStore.prototype.delete = remove;
          throw new DOMException("Synthetic interrupted draft cleanup", "UnknownError");
        }
        return remove.call(this, key);
      };
    });
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Latest in-memory text after quota failure" })).toBeVisible();
    await expect(panel.getByRole("alert")).toContainText("File saved, but the local draft was not cleared");
    expect((await drafts(page, userId)).map(row => row.value.text)).toEqual([changed]);
    const state = await (await context.request.get(`/api/conversations/${id}/continuation`)).json();
    expect(await (await context.request.get(`/api/conversations/${id}/continuation/revisions/${state.adopted_revision_id}/members/current`)).text()).toBe(changed);
    await expect(panel.getByRole("button", { name: "Delete draft", exact: true })).toBeVisible({ timeout: 5000 });
    page.once("dialog", dialog => dialog.accept());
    await panel.getByRole("button", { name: "Delete draft", exact: true }).click();
    await expect.poll(() => drafts(page, userId!)).toEqual([]);
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect((await (await context.request.get(`/api/conversations/${id}/continuation`)).json()).generation).toBe(state.generation);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (userId) await removeSyntheticAccount(admin, userId);
    await context.close(); await admin.dispose();
  }
});

test("local copy cleanup scopes drafts; failed signout retains remaining drafts and exported bytes", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(150_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! }, viewport: { width: 1440, height: 1000 } });
  let userId: string | undefined;
  try {
    userId = (await register(context, baseURL!, "cleanup")).userId;
    const first = await createConversation(context.request, "Synthetic first local copy");
    const second = await createConversation(context.request, "Synthetic second local copy");
    const page = await context.newPage();
    await downloadCopy(page, userId, first);
    await downloadCopy(page, userId, second);
    await editDraft(page, first, "# First local draft");
    page.once("dialog", dialog => dialog.accept());
    const secondText = '{"about":"Keep the second local Index draft"}';
    await editDraft(page, second, secondText, "index");
    page.once("dialog", dialog => dialog.accept()); await page.goto("/recent");
    expect(await drafts(page, userId)).toHaveLength(2);
    await openSettings(page, "Offline & sync");
    const center = page.getByRole("dialog", { name: "Offline & sync", exact: true });
    const firstCopy = center.getByRole("listitem").filter({ hasText: "Synthetic first local copy" });
    await firstCopy.getByRole("button", { name: "Delete copy", exact: true }).click();
    const clearing = center.getByRole("region", { name: "Handle local changes before clearing data", exact: true });
    await expect(clearing).toBeVisible();
    await expect(clearing.locator("dt").filter({ hasText: "Current / Index drafts" }).locator("..").locator("dd")).toHaveText("1");
    const exportCopy = page.waitForEvent("download");
    await clearing.getByRole("button", { name: "Export local changes", exact: true }).click();
    const copyFiles = unzipSync(await readFile((await (await exportCopy).path())!));
    const copiedDrafts = JSON.parse(strFromU8(copyFiles["changes.json"])).continuation_drafts;
    expect(copiedDrafts.map((row: { value: { conversation_id: string } }) => row.value.conversation_id)).toEqual([first]);
    await clearing.getByRole("button", { name: "Discard local changes and delete copy", exact: true }).click();
    await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
    await expect.poll(async () => (await drafts(page, userId!)).map(row => row.value.conversation_id)).toEqual([second]);
    expect((await readLocal(page, userId)).conversations.map(row => (row as { id: string }).id)).toEqual([second]);

    await page.goto("/recent"); await openSettings(page, "Account & security");
    await page.getByRole("button", { name: "Log out current account", exact: true }).click();
    const signingOut = page.getByRole("region", { name: "Handle local changes before signing out", exact: true });
    await expect(signingOut).toBeVisible();
    await expect(signingOut.getByRole("button", { name: "Sync first", exact: true })).toBeDisabled();
    const exportAll = page.waitForEvent("download");
    await signingOut.getByRole("button", { name: "Export local changes", exact: true }).click();
    const files = unzipSync(await readFile((await (await exportAll).path())!));
    expect(strFromU8(files["continuation-drafts/1/index.json"])).toBe(secondText);
    const other = await context.newPage();
    await other.goto(`/conversations/${second}?continuation=index`);
    await other.getByRole("button", { name: "Resume draft", exact: true }).click();
    const newer = '{"about":"Newer Index from another window"}';
    await other.getByRole("textbox", { name: "Edit index", exact: true }).fill(newer);
    await expect.poll(async () => (await drafts(other, userId!)).map(row => row.value.text)).toEqual([newer]);
    await signingOut.getByRole("button", { name: "File saved — clear and sign out", exact: true }).click();
    await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
    await expect(signingOut.getByRole("alert")).toContainText("Local changes changed");
    expect((await (await context.request.get("/api/auth/session")).json()).authenticated).toBe(true);
    expect((await drafts(page, userId)).map(row => row.value.text)).toEqual([newer]);
    await other.close();
    const freshDownload = page.waitForEvent("download");
    await signingOut.getByRole("button", { name: "Export local changes", exact: true }).click();
    const freshFiles = unzipSync(await readFile((await (await freshDownload).path())!));
    expect(strFromU8(freshFiles["continuation-drafts/1/index.json"])).toBe(newer);
    const before = await drafts(page, userId);
    await page.route("**/api/auth/logout", route => route.abort("failed"));
    await signingOut.getByRole("button", { name: "File saved — clear and sign out", exact: true }).click();
    await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
    await expect(signingOut.getByRole("alert")).toContainText("Local data is retained");
    expect(await drafts(page, userId)).toEqual(before);
    expect((await (await context.request.get("/api/auth/session")).json()).authenticated).toBe(true);
    await page.unroute("**/api/auth/logout");
    await signingOut.getByRole("button", { name: "File saved — clear and sign out", exact: true }).click();
    await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
    await expect(page.locator("#login-password")).toBeVisible();
    expect(await drafts(page, userId)).toEqual([]);
    expect((await readLocal(page, userId)).conversations).toEqual([]);
    expect((await (await context.request.get("/api/auth/session")).json()).authenticated).toBe(false);
  } finally {
    if (userId) await removeSyntheticAccount(admin, userId);
    await context.close(); await admin.dispose();
  }
});
