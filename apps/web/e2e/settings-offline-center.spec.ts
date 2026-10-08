import { expect, test, type Page } from "@playwright/test";
import { readLocal } from "./settings-offline-helper";
import { settingsAdmin } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, authentication and worker");

async function storedDownloads(page: Page, userId: string) {
  return page.evaluate(async (id) => {
    const namespace = Array.from(new TextEncoder().encode(id), (b) => b.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === id ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
    return new Promise<Array<{ state: string; jobId: string | null; assetMode: string }>>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result, transaction = db.transaction("settings"), query = transaction.objectStore("settings").getAll();
        transaction.oncomplete = () => { db.close(); resolve(query.result.filter((row) => row.key.startsWith("offline-download:")).map((row) => row.value)); };
      };
    });
  }, userId);
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`download resume, attachment tiers and cancellation at ${width} ${locale}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(150_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const page = await context.newPage(), headers = { Origin: baseURL! };
    let release: (() => void) | undefined;
    try {
      const registration = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `center-${width}-${Date.now()}@example.test`, password: "synthetic center passphrase", confirm_password: "synthetic center passphrase" } });
      expect(registration.status()).toBe(201);
      const userId = (await registration.json()).user_id;
      expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: { locale_mode: locale, theme_mode: locale === "zh-CN" ? "light" : "dark" } })).status()).toBe(200);
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic download test", messages: [{ role: "user", content_markdown: "Synthetic download question" }, { role: "assistant", content_markdown: "Synthetic retained download answer" }] } });
      expect(created.status()).toBe(201);
      const conversationId = (await created.json()).conversation.id;
      const upload = await context.request.post(`${baseURL}/api/conversations/${conversationId}/attachment-upload-sessions`, { headers, data: {} });
      expect(upload.status()).toBe(201);
      const file = await context.request.post(`${baseURL}/api/attachment-upload-sessions/${(await upload.json()).id}/items`, { headers, multipart: { file: { name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic offline attachment bytes") } } });
      expect(file.status()).toBe(201);
      expect((await context.request.post(`${baseURL}/api/conversations/${conversationId}/attachments`, { headers, data: { upload_item_ids: [(await file.json()).id] } })).status()).toBe(201);
      await page.goto(`${baseURL}/library?conversationId=${conversationId}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", locale === "zh-CN" ? "light" : "dark");
      await expect(page.getByRole("button", { name: /Download offline copy|下载离线副本/, exact: true })).toBeVisible();
      const openCenter = async () => {
        const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
        const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
        await expect(settings.or(sidebar).first()).toBeVisible();
        if (width < 768 && !await settings.isVisible()) await sidebar.click();
        await page.getByRole("button", { name: /Settings|设置/, exact: true }).click();
        await page.getByRole("button", { name: /Offline & sync|离线与同步/ }).click();
        await expect(page.getByRole("dialog", { name: /Offline & sync|离线与同步/ })).toBeVisible();
      };
      await openCenter();
      const dialog = page.getByRole("dialog", { name: /Offline & sync|离线与同步/ });
      await dialog.getByRole("combobox", { name: /Download attachments|下载附件/ }).selectOption("none");
      const admitted: string[] = [], keys: string[] = [];
      let first = true;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/offline/packages", async (route) => {
        const response = await route.fetch();
        admitted.push((await response.json()).job_id);
        keys.push(route.request().headers()["idempotency-key"]);
        if (first) { first = false; await barrier; }
        await route.fulfill({ response }).catch(() => undefined);
      });
      await dialog.getByRole("button", { name: /Download \/ update all|下载／更新全部/ }).click();
      await expect.poll(() => admitted.length).toBe(1);
      await page.reload();
      await expect.poll(() => admitted.length).toBe(2);
      release!();
      await expect.poll(async () => (await storedDownloads(page, userId))[0]?.state).toBe("completed");
      expect(new Set(admitted).size).toBe(1);
      expect(new Set(keys).size).toBe(1);
      expect((await readLocal(page, userId)).conversations).toHaveLength(1);
      await page.unroute("**/api/offline/packages");
      await openCenter();
      await expect(dialog.getByText(/0\/1/)).toBeVisible();
      await dialog.getByRole("button", { name: /Check and update|检查并更新/ }).click();
      await expect.poll(async () => (await storedDownloads(page, userId)).filter((item) => item.state === "completed").length).toBe(2);
      await expect(dialog.getByText(/1\/1/)).toBeVisible();
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/offline-center-copies-${width}.png` });
      await dialog.getByRole("combobox", { name: /Download attachments|下载附件/ }).selectOption("none");
      await dialog.getByRole("button", { name: /Check and update|检查并更新/ }).click();
      await expect.poll(async () => (await storedDownloads(page, userId)).filter((item) => item.state === "completed").length).toBe(3);
      await expect(dialog.getByText(/1\/1/)).toBeVisible();
      // Reproduce the coordinator's terminal-state/idle-scan lock handoff.
      // No download remains active. Cleanup must wait, then really remove bytes.
      await page.evaluate(async (id) => {
        const namespace = Array.from(new TextEncoder().encode(id), b => b.toString(16).padStart(2, "0")).join("");
        const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === id ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
        await new Promise<void>(ready => {
          void navigator.locks.request(`chat-reader:downloads:${name}`, () => new Promise<void>(resolve => {
            (window as Window & { releaseIdleDownload?: () => void }).releaseIdleDownload = resolve;
            ready();
          }));
        });
      }, userId);
      await dialog.getByRole("button", { name: /Clear cached files|仅清附件缓存/ }).click();
      await page.getByRole("button", { name: /^(Clear|清除)$/ }).click();
      try {
        await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending?.some(lock => lock.name?.startsWith("chat-reader:downloads:"))), { timeout: 2000, intervals: [25, 50, 100] }).toBe(true);
        await expect(dialog.getByRole("alert")).toHaveCount(0);
      } finally {
        await page.evaluate(() => (window as Window & { releaseIdleDownload?: () => void }).releaseIdleDownload?.());
      }
      // Releasing the coordinator lock starts cleanup; it does not await it.
      await expect(dialog.getByRole("button", { name: /^(Refresh|刷新)$/ })).toBeEnabled();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      await expect(dialog.getByText(/0\/1/)).toBeVisible();
      await expect.poll(() => page.evaluate(async id => {
        const namespace = Array.from(new TextEncoder().encode(id), b => b.toString(16).padStart(2, "0")).join("");
        const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === id ? "chat-reader-offline-assets-v1" : `chat-reader-offline-assets-v1--user-${namespace}`;
        return (await (await caches.open(name)).keys()).length;
      }, userId)).toBe(0);
      await dialog.getByRole("combobox", { name: /Download attachments|下载附件/ }).selectOption("all");
      let downloading = false;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/offline/packages/*/download", async (route) => {
        const response = await route.fetch(); downloading = true; await pending; await route.fulfill({ response }).catch(() => undefined);
      });
      await dialog.getByRole("button", { name: /Check and update|检查并更新/ }).click();
      await expect.poll(() => downloading).toBe(true);
      await expect(dialog.getByRole("button", { name: /Clear cached files|仅清附件缓存/ })).toBeDisabled();
      await dialog.getByRole("button", { name: /Cancel|取消/, exact: true }).click();
      await expect.poll(async () => (await storedDownloads(page, userId)).filter((item) => item.state === "cancelled").length).toBe(1);
      release!();
      expect((await readLocal(page, userId)).conversations).toHaveLength(1);
      await dialog.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ }).click();
      await expect(dialog.getByText(/^Synthetic download test · (Cancelled|已取消)$/)).toBeVisible();
      const projectResponse = await context.request.post(`${baseURL}/api/projects`, { headers, data: { name: "Synthetic offline project" } });
      expect(projectResponse.status()).toBe(201);
      const projectId = (await projectResponse.json()).id;
      expect((await context.request.post(`${baseURL}/api/conversations/${conversationId}/projects/${projectId}`, { headers })).ok()).toBe(true);
      await dialog.getByRole("tab", { name: /Offline copies|离线副本/ }).click();
      await dialog.getByRole("button", { name: /^(Refresh|刷新)$/ }).click();
      await dialog.getByRole("combobox", { name: /Choose project|选择项目/ }).selectOption(projectId);
      await dialog.getByRole("button", { name: /Download project|下载项目/ }).click();
      await expect.poll(async () => (await storedDownloads(page, userId)).filter((item) => item.state === "completed").length).toBe(4);
      await expect(dialog.getByText(/1\/1/)).toBeVisible();
      await dialog.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ }).click();
      await expect(dialog.getByRole("button", { name: /Retry download|重试下载/ })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/offline-center-${width}.png` });
      await dialog.getByRole("tab", { name: /Pending edits|待同步修改/ }).focus();
      await page.keyboard.press("ArrowLeft");
      await expect(dialog.getByRole("tab", { name: /Offline copies|离线副本/ })).toBeFocused();
      await page.goto(`${baseURL}/`);
      await openCenter();
      await expect(dialog.getByRole("link", { name: "Synthetic download test", exact: true })).toBeVisible();
      await dialog.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ }).click();
      await expect(dialog.getByText(/^Synthetic download test · (Cancelled|已取消)$/)).toBeVisible();
    } finally { release?.(); await context.close(); await admin.dispose(); }
  });
}
