import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import { readLocal } from "./settings-offline-helper";
import type { OfflineDownload } from "../lib/offline-downloads";
import type { BackgroundTaskRead } from "../lib/types";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, authentication and worker");

async function register(context: BrowserContext, baseURL: string, locale: string) {
  const headers = { Origin: baseURL };
  const response = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `offline-recovery-${crypto.randomUUID()}@example.test`, password: "synthetic recovery passphrase", confirm_password: "synthetic recovery passphrase",
  } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).user_id as string;
  expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: { locale_mode: locale, theme_mode: locale === "zh-CN" ? "light" : "dark" } })).status()).toBe(200);
  return id;
}

async function createConversation(context: BrowserContext, baseURL: string, title = "Synthetic offline recovery") {
  const response = await context.request.post(`${baseURL}/api/conversations`, { headers: { Origin: baseURL }, data: {
    title, messages: [{ role: "user", content_markdown: "Synthetic recovery question" }, { role: "assistant", content_markdown: "Synthetic retained answer" }],
  } });
  expect(response.status()).toBe(201);
  return (await response.json()).conversation.id as string;
}

async function downloads(page: Page, id: string) {
  return (await readLocal(page, id)).settings.filter(row => row.key.startsWith("offline-download:")).map(row => row.value as OfflineDownload);
}

async function cancellations(page: Page, id: string) {
  return (await readLocal(page, id)).settings.filter(row => row.key.startsWith("offline-cancellation:"));
}

async function storedMessages(page: Page, userId: string) {
  return page.evaluate(async id => {
    const namespace = Array.from(new TextEncoder().encode(id), byte => byte.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === id ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
    return new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction("messages"), rows = transaction.objectStore("messages").getAll();
        transaction.oncomplete = () => { db.close(); resolve(rows.result); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
  }, userId);
}

async function failurePageFixture(page: Page, userId: string, record?: OfflineDownload, remove: string[] = []) {
  // Pagination context only: persist synthetic failed rows in this test user's
  // database. No successful job, package or content is fabricated.
  return page.evaluate(async ({ userId, record, remove }) => {
    const namespace = Array.from(new TextEncoder().encode(userId), byte => byte.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === userId ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
    return new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("settings", "readwrite"), store = tx.objectStore("settings");
        const keys: string[] = [];
        for (const key of remove) store.delete(key);
        if (record) for (let index = 0; index < 20; index++) {
          const id = crypto.randomUUID(), key = `offline-download:${id}`;
          const timestamp = new Date(Date.now() + (index + 1) * 1000).toISOString();
          keys.push(key);
          store.put({ key, value: { ...record, id, jobId: crypto.randomUUID(), label: `Synthetic pagination failure ${index + 1}`, createdAt: timestamp, updatedAt: timestamp } });
        }
        tx.oncomplete = () => { db.close(); resolve(keys); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { userId, record, remove });
}

async function openCenter(page: Page) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  // Wait for the account/preferences boundary. The mobile library can already
  // be open while its settings control is still mounting; do not click the
  // background empty-state button through that overlay.
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) {
    await sidebar.click();
  }
  await settings.click();
  await page.getByRole("button", { name: /Offline & sync|离线与同步/ }).click();
  const dialog = page.getByRole("dialog", { name: /Offline & sync|离线与同步/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const [code, locale, width] of [["OFFLINE_ASSET_INTEGRITY", "zh-CN", 375], ["OFFLINE_ASSET_IO", "en-US", 1440]] as const) {
  const cause = locale === "zh-CN" ? /附件内容已损坏/ : /server could not package an attachment/;
  test(`attachment failure guidance persists and rebuilds ${code}`, async ({ browser, playwright, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const page = await context.newPage();
    try {
      const userId = await register(context, baseURL!, locale);
      const conversationId = await createConversation(context, baseURL!);
      const admissions: Array<{ key: string; job: string }> = [];
      await page.route("**/api/offline/packages", async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        admissions.push({ key: route.request().headers()["idempotency-key"], job: (await response.json()).job_id });
        await route.fulfill({ response });
      });
      await page.goto(`${baseURL}/library?conversationId=${conversationId}`);
      await page.getByRole("button", { name: /^(Download offline copy|下载离线副本)$/ }).click();
      await expect.poll(async () => (await downloads(page, userId))[0]?.state).toBe("completed");
      const original = await storedMessages(page, userId);
      expect(original).toHaveLength(2);
      let injectFailure = true;
      // Fault-inject only the failed-task response. Admission, rebuild, ZIP
      // download and IndexedDB writes remain real; worker failures are covered
      // separately by test_offline_asset_integrity.py.
      await page.route("**/api/tasks/*", async route => {
        const response = await route.fetch();
        const task = await response.json() as BackgroundTaskRead;
        if (injectFailure && admissions.length === 2 && task.job_id === admissions[1].job) {
          await route.fulfill({ response, json: { ...task, status: "failed", error_message: code } });
        } else await route.fulfill({ response });
      });
      let dialog = await openCenter(page);
      await dialog.getByRole("button", { name: /Check and update|检查并更新/ }).click();
      await expect.poll(async () => (await downloads(page, userId)).find(row => row.error === code)?.state).toBe("failed");
      expect(await storedMessages(page, userId)).toEqual(original);
      await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/tasks/${admissions[1].job}`)).json()).status).toBe("committed");
      const failedRecord = (await downloads(page, userId)).find(row => row.error === code)!;
      const fillerKeys = width === 1440 ? await failurePageFixture(page, userId, failedRecord) : [];
      await page.goto(baseURL!);
      if (width < 768) await page.getByTestId("mobile-sidebar-button").click();
      await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
      const sourceTask = page.getByTestId("task-center-panel").locator(`[id="task-row-${admissions[1].job}"]`);
      const openDownload = sourceTask.getByRole("button", { name: /^(查看离线下载|View offline download)$/ });
      await openDownload.focus(); await page.keyboard.press("Enter");
      dialog = page.getByRole("dialog", { name: /Offline & sync|离线与同步/ });
      await expect(dialog.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ })).toHaveAttribute("aria-selected", "true");
      await expect(dialog.locator(`[data-offline-download-id="${failedRecord.id}"]`)).toBeFocused();
      if (fillerKeys.length) await expect(dialog.getByRole("navigation", { name: "Offline center pages" })).toContainText("2 / 2");
      expect(admissions).toHaveLength(2);
      await page.keyboard.press("Escape");
      await expect(openDownload).toBeFocused();
      if (fillerKeys.length) await failurePageFixture(page, userId, undefined, fillerKeys);
      await openDownload.click();
      await expect(dialog.getByText(cause)).toBeVisible();
      await expect(dialog.getByText(/现有副本已保留|Existing copies are retained/)).toBeVisible();
      expect((await downloads(page, userId)).some(row => row.error === code)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`offline-retained-${code}.png`) });
      injectFailure = false;
      await dialog.getByRole("button", { name: /^(Retry download|重试下载)$/ }).click();
      await expect.poll(() => admissions.length).toBe(3);
      expect(admissions[2].job).not.toBe(admissions[1].job);
      expect(admissions[2].key).not.toBe(admissions[1].key);
      await expect.poll(async () => (await downloads(page, userId)).some(row => row.state === "failed")).toBe(false);
      await expect.poll(async () => (await downloads(page, userId)).every(row => row.state === "completed")).toBe(true);
      expect(await storedMessages(page, userId)).toEqual(original);
    } finally { await context.close(); await admin.dispose(); }
  });

  for (const unrelatedCopy of [false, true]) {
    test(`first-copy ${code} does not claim a retained copy (${unrelatedCopy ? "unrelated copy" : "empty library"})`, async ({ browser, playwright, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const admin = await settingsAdmin(playwright.request, baseURL!);
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
      const page = await context.newPage();
      try {
        const userId = await register(context, baseURL!, locale);
        const conversationId = await createConversation(context, baseURL!);
        const admissions: Array<{ key: string; job: string }> = [];
        await page.route("**/api/offline/packages", async route => {
          const response = await route.fetch();
          expect(response.status()).toBe(202);
          admissions.push({ key: route.request().headers()["idempotency-key"], job: (await response.json()).job_id });
          await route.fulfill({ response });
        });
        let original: unknown[] = [];
        if (unrelatedCopy) {
          const otherId = await createConversation(context, baseURL!, "Synthetic other offline copy");
          await page.goto(`${baseURL}/library?conversationId=${otherId}`);
          await page.getByRole("button", { name: /^(Download offline copy|下载离线副本)$/ }).click();
          await expect.poll(async () => (await downloads(page, userId))[0]?.state).toBe("completed");
          original = await storedMessages(page, userId);
          expect(original).toHaveLength(2);
        }
        const failedIndex = admissions.length;
        let injectFailure = true;
        await page.route("**/api/tasks/*", async route => {
          const response = await route.fetch();
          const task = await response.json() as BackgroundTaskRead;
          const failedJob = admissions[failedIndex]?.job;
          if (injectFailure && failedJob && task.job_id === failedJob) {
            await route.fulfill({ response, json: { ...task, status: "failed", error_message: code } });
          } else await route.fulfill({ response });
        });
        await page.goto(`${baseURL}/library?conversationId=${conversationId}`);
        await page.getByRole("button", { name: /^(Download offline copy|下载离线副本)$/ }).click();
        await expect.poll(async () => (await downloads(page, userId)).find(row => row.error === code)?.state).toBe("failed");
        expect(await storedMessages(page, userId)).toEqual(original);
        expect((await readLocal(page, userId)).conversations).toHaveLength(unrelatedCopy ? 1 : 0);
        await page.reload();
        const dialog = await openCenter(page);
        const failureTab = dialog.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ });
        await failureTab.focus(); await page.keyboard.press("Enter");
        await expect(dialog.getByText(cause)).toBeVisible();
        await expect(dialog.getByText(/现有副本已保留|Existing copies are retained/)).toHaveCount(0);
        await expect(dialog).not.toContainText(code);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`offline-first-${code}-${unrelatedCopy}.png`) });
        injectFailure = false;
        const retry = dialog.getByRole("button", { name: /^(Retry download|重试下载)$/ });
        await retry.focus(); await page.keyboard.press("Enter");
        await expect.poll(() => admissions.length).toBe(failedIndex + 2);
        expect(admissions[failedIndex + 1].key).not.toBe(admissions[failedIndex].key);
        expect(admissions[failedIndex + 1].job).not.toBe(admissions[failedIndex].job);
        await expect.poll(async () => (await downloads(page, userId)).every(row => row.state === "completed")).toBe(true);
        const messages = await storedMessages(page, userId);
        expect(messages).toHaveLength(original.length + 2);
        expect(messages).toEqual(expect.arrayContaining(original));
        expect((await readLocal(page, userId)).conversations).toHaveLength(unrelatedCopy ? 2 : 1);
      } finally { await context.close(); await admin.dispose(); }
    });
  }

  test(`task center routes ${code} to a real download on this device`, async ({ browser, playwright, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width: 768, height: 900 }, locale });
    const page = await context.newPage();
    try {
      const userId = await register(context, baseURL!, locale);
      const conversationId = await createConversation(context, baseURL!);
      const queued = await context.request.post(`${baseURL}/api/offline/packages`, { headers: { Origin: baseURL!, "Idempotency-Key": crypto.randomUUID() }, data: {
        scope: "conversation", conversation_id: conversationId, include_assets: "none",
      } });
      expect(queued.status()).toBe(202);
      const jobId = (await queued.json()).job_id as string;
      await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/tasks/${jobId}`)).json()).status).toBe("committed");
      // Only the failure display is injected. The following new-device
      // admission, worker package and IndexedDB persistence remain real.
      await page.route("**/api/tasks/active", async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const tasks = await response.json() as BackgroundTaskRead[];
        expect(tasks.some(task => task.job_id === jobId)).toBe(true);
        await route.fulfill({ response, json: tasks.map(task => task.job_id === jobId
          ? { ...task, status: "failed", phase: "failed", error_message: code } : task) });
      });
      await page.goto(baseURL!);
      await page.getByTestId("task-summary-button").filter({ visible: true }).click();
      const row = page.getByTestId("task-center-panel").locator(`[id="task-row-${jobId}"]`);
      await expect(row.getByText(cause)).toBeVisible();
      await expect(row).not.toContainText(code);
      await expect(row.getByText(/现有副本已保留|Existing copies are retained/)).toHaveCount(0);
      await expect(row.getByRole("button", { name: /^(Retry|重试)$/ })).toHaveCount(0);
      const openDownload = row.getByRole("button", { name: /^(处理离线下载|Resolve offline download)$/ });
      await openDownload.focus(); await expect(openDownload).toBeFocused();
      expect((await readLocal(page, userId)).conversations).toHaveLength(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`task-offline-failure-${code}.png`) });
      let genericRetries = 0;
      const admissions: string[] = [];
      await page.route("**/api/tasks/*/retry", async route => { genericRetries++; await route.continue(); });
      await page.route("**/api/offline/packages", async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        expect(route.request().postDataJSON()).toMatchObject({ scope: "conversation", conversation_id: conversationId, include_assets: "none" });
        admissions.push((await response.json()).job_id);
        await route.fulfill({ response });
      });
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: /Offline & sync|离线与同步/ });
      const download = dialog.getByRole("button", { name: /^(下载到此设备|Download to this device)$/ });
      await expect(download).toBeEnabled();
      expect(admissions).toHaveLength(0);
      await download.focus(); await page.keyboard.press("Enter");
      await expect.poll(async () => (await downloads(page, userId)).find(item => item.scopeId === conversationId)?.state).toBe("completed");
      expect(admissions).toHaveLength(1);
      expect(admissions[0]).not.toBe(jobId);
      expect(genericRetries).toBe(0);
      expect(await storedMessages(page, userId)).toHaveLength(2);
      expect((await readLocal(page, userId)).conversations).toHaveLength(1);
      await expect(dialog.getByText(/下载已完成|Download completed/)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`task-offline-saved-${code}.png`) });
      await page.keyboard.press("Escape");
      await expect(openDownload).toBeFocused();
      await openDownload.click();
      await expect(dialog.getByTestId("offline-task-target")).toHaveCount(0);
      await expect(dialog.getByText(/下载已完成|Download completed/)).toBeVisible();
      expect(admissions).toHaveLength(1);
      await dialog.getByRole("link", { name: /^(打开资料库|Open library)$/ }).click();
      await expect(page.getByText("Synthetic retained answer", { exact: true })).toBeVisible();
    } finally { await context.close(); await admin.dispose(); }
  });
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`offline failures survive reload, rebuild and cancel without a connection at ${width}`, async ({ browser, playwright, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const page = await context.newPage();
    let release: (() => void) | undefined;
    try {
      const userId = await register(context, baseURL!, locale);
      const conversationId = await createConversation(context, baseURL!);
      const admissions: Array<{ key: string; job: string }> = [];
      await page.route("**/api/offline/packages", async route => {
        const response = await route.fetch();
        admissions.push({ key: route.request().headers()["idempotency-key"], job: (await response.json()).job_id });
        await route.fulfill({ response });
      });
      let damage = true;
      await page.route("**/api/offline/packages/*/download", async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (damage) await route.fulfill({ status: 200, contentType: "application/zip", body: Buffer.from("synthetic broken ZIP") });
        else await route.fulfill({ response });
      });
      await page.goto(`${baseURL}/library?conversationId=${conversationId}`);
      const main = page.locator('[aria-label="Offline download"], [aria-label="离线下载"]');
      await main.getByRole("button", { name: /^(Download offline copy|下载离线副本)$/ }).click();
      await expect.poll(async () => (await downloads(page, userId))[0]?.error).toBe("MALFORMED");
      await expect(main.getByText(/incomplete or damaged|不完整或已损坏/)).toBeVisible();
      expect((await readLocal(page, userId)).conversations).toHaveLength(0);
      await page.reload();
      await expect(main.getByText(/incomplete or damaged|不完整或已损坏/)).toBeVisible();
      if (width >= 768) {
        const open = main.getByRole("button", { name: "Open library", exact: true });
        await expect(open).toBeHidden();
        await expect(page.getByText(/incomplete or damaged/).filter({ visible: true })).toHaveCount(1);
        await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
        await expect(open).toBeVisible();
        await open.click();
        await expect(page.getByPlaceholder("Search offline text, code, and annotations")).toBeFocused();
        await expect(open).toBeHidden();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`offline-recovery-failure-${width}.png`) });
      damage = false;
      await main.getByRole("button", { name: /^(Retry offline download|重试离线下载)$/ }).click();
      await expect.poll(async () => (await downloads(page, userId))[0]?.state).toBe("completed");
      expect(admissions).toHaveLength(2);
      expect(new Set(admissions.map(item => item.job)).size).toBe(2);
      expect(new Set(admissions.map(item => item.key)).size).toBe(2);
      expect((await readLocal(page, userId)).conversations).toHaveLength(1);
      const original = await storedMessages(page, userId);
      expect(original).toHaveLength(2);
      await page.unroute("**/api/offline/packages/*/download");
      const gate = new Promise<void>(resolve => { release = resolve; });
      let held = false;
      await page.route("**/api/offline/packages/*/download", async route => {
        const response = await route.fetch(); held = true;
        await gate; await route.fulfill({ response }).catch(() => undefined);
      });
      const dialog = await openCenter(page);
      await dialog.getByRole("button", { name: /Check and update|检查并更新/ }).click();
      await expect.poll(() => held).toBe(true);
      await context.setOffline(true);
      await dialog.getByRole("button", { name: /^(Cancel|取消)$/ }).click();
      await expect.poll(async () => (await downloads(page, userId)).filter(item => item.state === "cancelled").length, { timeout: 8_000 }).toBe(1);
      await expect(dialog.getByRole("button", { name: /Delete copy|删除副本/ })).toBeEnabled();
      expect(await storedMessages(page, userId)).toEqual(original);
      expect(await cancellations(page, userId)).toHaveLength(1);
      await dialog.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ }).click();
      await expect(dialog.getByText(/local download was cancelled|本机下载已取消/)).toBeVisible();
      await expect(dialog.getByText(/awaiting confirmation|待确认/)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`offline-recovery-cancel-${width}.png`) });
      if (width === 375) {
        await dialog.getByRole("tab", { name: "离线副本" }).click();
        await dialog.getByRole("button", { name: "删除副本" }).click();
        await page.getByRole("button", { name: "清除", exact: true }).click();
        await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(0);
        expect(await storedMessages(page, userId)).toHaveLength(0);
        expect(await cancellations(page, userId)).toHaveLength(1);
      }
      release!();
      // No API success is fabricated; the real cancellation endpoint must
      // acknowledge on reconnect. The local terminal state survives reload.
      let failedLookups = 0;
      let blockLookup = width === 1440;
      const cancelledJob = (await downloads(page, userId)).find(item => item.state === "cancelled")!.jobId;
      await page.route(`**/api/tasks/${cancelledJob}`, async route => {
        if (blockLookup) {
          failedLookups += 1;
          await route.fulfill({ status: 503, json: { detail: "Synthetic unavailable status lookup" } });
        } else await route.continue();
      });
      await context.setOffline(false);
      if (width === 1440) {
        await expect.poll(() => failedLookups).toBeGreaterThan(0);
        await expect.poll(async () => (await cancellations(page, userId))[0]?.value).toMatchObject({ attempts: 1 });
        expect(await storedMessages(page, userId)).toEqual(original);
        blockLookup = false;
      }
      await expect.poll(async () => (await cancellations(page, userId)).length).toBe(0);
      expect(await storedMessages(page, userId)).toEqual(width === 375 ? [] : original);
      const catalog = await context.request.get(`${baseURL}/api/offline/catalog`);
      expect(catalog.status()).toBe(200);
      expect((await catalog.json()).conversations.map((row: { id: string }) => row.id)).toContain(conversationId);
      await page.reload();
      await expect.poll(async () => (await downloads(page, userId)).filter(item => item.state === "cancelled").length).toBe(1);
      expect(new Set(admissions.map(item => item.job)).size).toBe(3);
    } finally { release?.(); await context.close(); await admin.dispose(); }
  });
}

test("a completed retry retains earlier cancellation recovery without a no-op download button", async ({ browser, playwright, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let release: (() => void) | undefined;
  try {
    const userId = await register(context, baseURL!, "en-US");
    const conversationId = await createConversation(context, baseURL!);
    let held = false, unavailable = true, cancelAttempts = 0, admissions = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/offline/packages", async route => {
      admissions += 1;
      await route.continue();
    });
    await page.route("**/api/offline/packages/*/download", async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      held = true;
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    });
    await page.route("**/api/tasks/*/cancel", async route => {
      cancelAttempts += 1;
      if (unavailable) await route.fulfill({ status: 503, json: { detail: "Synthetic cancellation outage" } });
      else await route.continue();
    });
    await page.goto(`${baseURL}/library?conversationId=${conversationId}`);
    await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
    await expect.poll(() => held).toBe(true);
    const dialog = await openCenter(page);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(async () => (await downloads(page, userId))[0]?.state).toBe("cancelled");
    release!();
    await page.unroute("**/api/offline/packages/*/download");
    await dialog.getByRole("tab", { name: "Failures & conflicts", exact: true }).click();
    await dialog.getByRole("button", { name: "Retry download", exact: true }).click();
    await expect.poll(async () => (await downloads(page, userId))[0]?.state).toBe("completed");
    const messages = await storedMessages(page, userId);
    expect(messages).toHaveLength(2);
    await expect.poll(async () => (await downloads(page, userId))[0]?.serverCancellation, { timeout: 65_000 }).toBe("failed");
    expect(cancelAttempts).toBe(5);
    expect(admissions).toBe(2);
    await expect(dialog.getByText("The offline copy is ready; an earlier server cancellation still needs attention.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Retry download", exact: true })).toHaveCount(0);
    const retry = dialog.getByRole("button", { name: "Retry server cancellation", exact: true });
    await expect(retry).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("offline-completed-cancellation-recovery.png") });
    unavailable = false;
    await retry.click();
    await expect.poll(async () => (await cancellations(page, userId)).length).toBe(0);
    await expect(retry).toHaveCount(0);
    expect(admissions).toBe(2);
    expect(await storedMessages(page, userId)).toEqual(messages);
    expect((await readLocal(page, userId)).conversations).toHaveLength(1);
  } finally { release?.(); await context.close(); await admin.dispose(); }
});

test("cancel a lost admission receipt without a duplicate server job", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(120_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let release: (() => void) | undefined;
  try {
    const userId = await register(context, baseURL!, "en-US");
    const conversationId = await createConversation(context, baseURL!);
    await page.goto(`${baseURL}/library?conversationId=${conversationId}`);
    const dialog = await openCenter(page);
    const admitted: Array<{ key: string; job: string }> = [];
    const gate = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    await page.route("**/api/offline/packages", async route => {
      const response = await route.fetch();
      admitted.push({ key: route.request().headers()["idempotency-key"], job: (await response.json()).job_id });
      if (first) { first = false; await gate; }
      await route.fulfill({ response }).catch(() => undefined);
    });
    await dialog.getByRole("button", { name: "Download / update all" }).click();
    await expect.poll(() => admitted.length).toBe(1);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(async () => (await downloads(page, userId))[0]?.state, { timeout: 8_000 }).toBe("cancelled");
    await expect.poll(() => admitted.length).toBe(2);
    await expect.poll(async () => (await cancellations(page, userId)).length).toBe(0);
    expect(new Set(admitted.map(item => item.key)).size).toBe(1);
    expect(new Set(admitted.map(item => item.job)).size).toBe(1);
    expect((await readLocal(page, userId)).conversations).toHaveLength(0);
    release!();
    await page.reload();
    await expect.poll(async () => (await downloads(page, userId))[0]?.state).toBe("cancelled");
    expect((await readLocal(page, userId)).conversations).toHaveLength(0);
  } finally { release?.(); await context.close(); await admin.dispose(); }
});

test("removing the last offline copy on page two returns to the retained copies", async ({ browser, playwright, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  const page = await context.newPage();
  try {
    const userId = await register(context, baseURL!, "zh-CN");
    for (let index = 0; index < 21; index += 1) await createConversation(context, baseURL!, `Synthetic page ${String(index + 1).padStart(2, "0")}`);
    await page.goto(`${baseURL}/library`);
    const dialog = await openCenter(page);
    await dialog.getByRole("button", { name: "下载／更新全部" }).click();
    await expect.poll(async () => (await downloads(page, userId))[0]?.state).toBe("completed");
    expect((await readLocal(page, userId)).conversations).toHaveLength(21);
    await dialog.getByRole("button", { name: "下一页" }).click();
    await expect(dialog.getByText("2 / 2", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "删除副本" })).toHaveCount(1);
    await dialog.getByRole("button", { name: "删除副本" }).click();
    await page.getByRole("button", { name: "清除", exact: true }).click();
    await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(20);
    await expect(dialog.getByRole("button", { name: "删除副本" })).toHaveCount(20);
    await expect(dialog.getByText("2 / 2", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: /^Synthetic page / }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("offline-recovery-last-page.png") });
    // Deleting a browser copy must not remove its canonical server conversation.
    const catalog = await context.request.get(`${baseURL}/api/offline/catalog`);
    expect(catalog.status()).toBe(200);
    expect((await catalog.json()).conversations).toHaveLength(21);
  } finally { await context.close(); await admin.dispose(); }
});
