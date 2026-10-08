import { expect, test, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";
import type { BackgroundTaskRead } from "../lib/types";
import { seedArchiveFault } from "./archive-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openArchive(page: Page, system: boolean) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  const entry = system
    ? page.locator('[aria-labelledby="settings-administration-heading"]').getByRole("button", { name: /^(System|系统)$/ })
    : page.getByRole("button", { name: /Data.*backup|数据与备份|Data archive|数据归档/ });
  if (!await entry.isVisible()) {
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    if (!await entry.isVisible()) await settings.click();
  }
  await entry.click();
  return page.getByRole("dialog", { name: system ? /^(System|系统)$/ : /Data.*backup|数据与备份|Data archive|数据归档/ });
}

for (const system of [false, true]) for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`${system ? "system" : "personal"} archive uses current failure when history is stale at ${width}`, async ({ browser, playwright, baseURL }, info) => {
    const base = baseURL!, headers = { Origin: base }, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(system ? { storageState: await admin.storageState() } : {}) });
    let releaseReads = () => {};
    try {
      if (!system) {
        const password = "synthetic archive state passphrase";
        expect((await context.request.post(`${base}/api/auth/register`, { headers, data: { email: `archive-state-${crypto.randomUUID()}@example.test`, password, confirm_password: password } })).status()).toBe(201);
      }
      await settingsAppearance(context.request, base, locale);
      const endpoint = `/api/${system ? "system" : "me"}/archive`;
      const page = await context.newPage();
      let admitted: BackgroundTaskRead | undefined;
      let historyReads = 0;
      let failInitialRead = width === 375;
      let staleFailure: BackgroundTaskRead | undefined = undefined;
      let holdReads: Promise<void> | undefined;
      await page.route(`**${endpoint}/previews`, async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        admitted = await response.json();
        expect(admitted!.status).toBe("queued");
        await route.fulfill({ response });
      });
      await page.route(`**${endpoint}/tasks?*`, async route => {
        if (!admitted) {
          if (failInitialRead) { failInitialRead = false; await route.abort(); }
          else await route.continue();
          return;
        }
        if (staleFailure) { await route.fulfill({ json: [staleFailure] }); return; }
        // A delayed list snapshot retains the actual admission state. Later
        // history reads fail; the independent detail route remains real.
        historyReads++;
        if (historyReads === 1) await route.fulfill({ json: [admitted] });
        else await route.abort();
      });
      await page.goto(base);
      const panel = await openArchive(page, system);
      if (width === 375) {
        await expect(panel.getByRole("alert").filter({ hasText: /读取记录失败/ })).toBeVisible();
        await expect(panel.getByText(/还没有归档任务/)).toHaveCount(0);
      }
      await panel.getByRole("button", { name: /^(Restore archive|恢复归档)$/ }).click();
      await panel.getByLabel(system ? /System archive file|系统归档文件/ : /Personal archive file|个人归档文件/).setInputFiles({ name: "synthetic-invalid.cr", mimeType: "application/octet-stream", buffer: Buffer.from("synthetic malformed archive") });
      await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
      await expect.poll(() => admitted?.job_id).toBeTruthy();
      const id = admitted!.job_id;
      await expect.poll(async () => (await (await context.request.get(`${base}/api/tasks/${id}`)).json()).status).toBe("failed");
      // Seed an unknown worker failure for retry-state testing. Known corrupt
      // input now offers replacement; retry still executes the real worker.
      seedArchiveFault(id, "retryable");
      await panel.getByRole("button", { name: /Refresh archive records|刷新归档记录/ }).click();
      const retry = panel.getByRole("button", { name: /^(Retry task|重试任务)$/ });
      await expect(retry).toBeVisible({ timeout: 10_000 });
      await expect(panel.getByRole("progressbar", { name: /Archive task progress|归档任务进度/ })).toHaveCount(0);
      await expect(panel.getByRole("alert").filter({ hasText: /Archive operation failed|归档操作未完成/ })).toBeVisible();
      staleFailure = await (await context.request.get(`${base}/api/tasks/${id}`)).json();
      await panel.getByRole("button", { name: /Refresh archive records|刷新归档记录/ }).click();
      await expect(panel.getByRole("region", { name: /Backup and restore records|备份与恢复记录/ }).getByRole("button", { name: /Archive preview.*Failed|归档内容预检.*失败/ })).toBeVisible();
      holdReads = new Promise<void>(resolve => { releaseReads = resolve; });
      await page.route(`**/api/tasks/${id}`, async route => { await holdReads; await route.continue(); });
      // A hanging refresh must not keep an acknowledged retry disabled. Keep a
      // delayed old failed list too, to exercise the new execution's queue time.
      await page.route(`**${endpoint}/tasks?*`, async route => { await holdReads; await route.fallback(); });
      const retryResponse = page.waitForResponse(response => response.url().endsWith(`/api/tasks/${id}/retry`));
      await retry.click();
      expect((await retryResponse).status()).toBe(200);
      await expect(panel.getByRole("button", { name: /^(Cancel task|取消任务)$/ })).toBeEnabled({ timeout: 5000 });
      await expect(retry).toHaveCount(0);
      releaseReads(); holdReads = undefined;
      await expect(panel.getByRole("button", { name: /^(Choose another archive|选择其他归档)$/ })).toBeEnabled();
      await expect.poll(async () => (await (await context.request.get(`${base}/api/tasks/${id}`)).json()).status).toBe("failed");
      const tasks = await (await context.request.get(`${base}${endpoint}/tasks`)).json() as BackgroundTaskRead[];
      expect(tasks.filter(task => task.job_id === id)).toHaveLength(1);
      expect(tasks.some(task => task.result.parent_task_id === id && task.job_type.endsWith("_restore"))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`archive-state-${system ? "system" : "personal"}-${width}.png`) });
    } finally { releaseReads(); await context.close(); await admin.dispose(); }
  });
}
