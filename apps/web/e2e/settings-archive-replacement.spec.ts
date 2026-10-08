import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";
import type { BackgroundTaskRead } from "../lib/types";
import { seedArchiveFault } from "./archive-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, API and worker");

async function openArchive(page: Page, system: boolean) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await (system ? page.locator('[aria-labelledby="settings-administration-heading"]').getByRole("button", { name: /^(System|系统)$/ }) : page.getByRole("button", { name: /Data.*backup|数据与备份|Data archive|数据归档/ })).click();
  return page.getByRole("dialog", { name: system ? /^(System|系统)$/ : /Data.*backup|数据与备份|Data archive|数据归档/ });
}

async function taskRead(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/tasks/${id}`); expect(response.status()).toBe(200);
  return await response.json() as BackgroundTaskRead;
}

for (const system of [false, true]) for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`${system ? "system" : "personal"} corrupt archive leads to replacement and real preview at ${width}`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width, height: 900 }, ...(system ? { storageState: await admin.storageState() } : {}) });
    const endpoint = `/api/${system ? "system" : "me"}/archive`;
    let userId = "", release = () => {};
    try {
      if (!system) {
        const password = "synthetic archive replacement passphrase";
        const response = await context.request.post("/api/auth/register", { data: { email: `archive-replacement-${crypto.randomUUID()}@example.test`, password, confirm_password: password } });
        expect(response.status()).toBe(201); userId = (await response.json()).user_id;
        expect((await context.request.post("/api/conversations", { data: { title: "Synthetic replacement source", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: "Synthetic answer" }] } })).status()).toBe(201);
      }
      await settingsAppearance(context.request, base, locale);
      const exportResponse = await context.request.post(`${endpoint}/exports`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: {} });
      expect(exportResponse.status()).toBe(202);
      const exported = await exportResponse.json();
      await expect.poll(async () => (await taskRead(context.request, exported.job_id)).status).toBe("committed");
      const delivery = await taskRead(context.request, exported.job_id);
      const downloaded = await context.request.get(String(delivery.result.download_url)); expect(downloaded.status()).toBe(200);
      const good = await downloaded.body();
      const page = await context.newPage(); await page.goto(base);
      let panel = await openArchive(page, system);
      await panel.getByRole("button", { name: /^(Restore archive|恢复归档)$/ }).click();
      const input = panel.getByLabel(system ? /System archive file|系统归档文件/ : /Personal archive file|个人归档文件/);
      await input.setInputFiles({ name: "synthetic-broken.cr", mimeType: "application/octet-stream", buffer: Buffer.from("synthetic malformed archive") });
      const admission = page.waitForResponse(response => response.url().endsWith(`${endpoint}/previews`) && response.request().method() === "POST");
      await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
      const failed = await (await admission).json();
      await expect.poll(async () => (await taskRead(context.request, failed.job_id)).status).toBe("failed");
      const replace = panel.getByRole("button", { name: /^(Choose another archive|选择其他归档)$/ });
      await expect(replace).toBeVisible({ timeout: 10_000 });
      await expect(panel.getByRole("button", { name: /^(Retry task|重试任务)$/ })).toHaveCount(0);
      if (width === 375) {
        await panel.getByRole("button", { name: /^(Close|关闭)$/ }).click();
        await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
        const center = page.getByTestId("task-center-panel");
        const failedRow = center.locator(`[id="task-row-${failed.job_id}"]`);
        await expect(failedRow.getByRole("button", { name: /^(Retry|重试)$/ })).toHaveCount(0);
        await failedRow.getByRole("button", { name: /^(Review archive problem|处理归档问题)$/ }).click();
        panel = page.getByRole("dialog", { name: system ? /^(System|系统)$/ : /Data.*backup|数据与备份|Data archive|数据归档/ });
        await expect(replace).toBeVisible();
      }
      await context.setOffline(true); await expect(replace).toBeDisabled(); await context.setOffline(false);
      await expect(replace).toBeEnabled(); await replace.focus(); await page.keyboard.press("Enter");
      await expect(input).toBeFocused(); await expect(input).toHaveValue("");
      await expect(panel.getByRole("button", { name: /Upload & preview|上传并预检/ })).toBeDisabled();
      expect((await taskRead(context.request, failed.job_id)).result.artifact_available).toBe(true);
      // Merely entering replacement does not delete or requeue the old task.
      await input.setInputFiles([]);
      expect((await taskRead(context.request, failed.job_id)).status).toBe("failed");
      await input.setInputFiles({ name: "synthetic-complete.cr", mimeType: "application/octet-stream", buffer: good });
      const nextAdmission = page.waitForResponse(response => response.url().endsWith(`${endpoint}/previews`) && response.request().method() === "POST");
      await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
      let next = await (await nextAdmission).json(); expect(next.job_id).not.toBe(failed.job_id);
      await expect.poll(async () => (await taskRead(context.request, next.job_id)).status).toBe("committed");
      await expect(panel.getByText(/Integrity checks passed|完整性校验已通过/)).toBeVisible();
      if (width === 768) {
        seedArchiveFault(next.job_id, "unavailable");
        expect((await taskRead(context.request, next.job_id)).result.artifact_available).toBe(false);
        await panel.getByRole("button", { name: /Refresh archive records|刷新归档记录/ }).click();
        const uploadAgain = panel.getByRole("button", { name: /^(Upload archive again|重新上传归档)$/ });
        await expect(uploadAgain).toBeVisible();
        await expect(panel.getByRole("button", { name: /^(Restore these materials|确认新增恢复)$/ })).toHaveCount(0);
        await uploadAgain.click(); await expect(input).toBeFocused(); await expect(input).toHaveValue("");
        await input.setInputFiles({ name: "synthetic-complete.cr", mimeType: "application/octet-stream", buffer: good });
        const repeated = page.waitForResponse(response => response.url().endsWith(`${endpoint}/previews`) && response.request().method() === "POST");
        await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
        const prior = next.job_id; next = await (await repeated).json(); expect(next.job_id).not.toBe(prior);
        await expect.poll(async () => (await taskRead(context.request, next.job_id)).status).toBe("committed");
        await expect(panel.getByText(/Integrity checks passed|完整性校验已通过/)).toBeVisible();
      }
      if (width === 1440) {
        seedArchiveFault(next.job_id, "retryable");
        await panel.getByRole("button", { name: /Refresh archive records|刷新归档记录/ }).click();
        const retry = panel.getByRole("button", { name: /^(Retry task|重试任务)$/ });
        await expect(retry).toBeVisible();
        const held = new Promise<void>(resolve => { release = resolve; });
        await page.route(`**/api/tasks/${next.job_id}`, async route => { await held; await route.continue(); });
        await page.route(`**${endpoint}/tasks?*`, async route => { await held; await route.continue(); });
        const retried = page.waitForResponse(response => response.url().endsWith(`/api/tasks/${next.job_id}/retry`));
        await retry.click(); expect((await retried).status()).toBe(200);
        await expect(panel.getByRole("button", { name: /^(Cancel task|取消任务)$/ })).toBeEnabled({ timeout: 5000 });
        release();
        await expect.poll(async () => (await taskRead(context.request, next.job_id)).status).toBe("committed");
        await expect(panel.getByText(/Integrity checks passed|完整性校验已通过/)).toBeVisible();
      }
      expect((await taskRead(context.request, failed.job_id)).status).toBe("failed");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`archive-replacement-${system ? "system" : "personal"}-${width}.png`) });
      if (!system) {
        await panel.getByRole("button", { name: /^(Restore these materials|确认新增恢复)$/ }).click();
        await expect(panel.getByText(/Added .*1 conversations|已新增 .*1 个对话/)).toBeVisible();
        const restored = (await (await context.request.get(`${endpoint}/tasks`)).json() as BackgroundTaskRead[]).filter(task => task.job_type === "personal_archive_restore");
        expect(restored).toHaveLength(1); expect(restored[0].result.parent_task_id).toBe(next.job_id);
        expect(restored[0].result.counts?.conversations).toBe(1);
        expect(restored[0].result.conversation_ids).toHaveLength(1);
        const window = await (await context.request.get(`/api/conversations/${restored[0].result.conversation_ids![0]}/message-window?limit=10`)).json();
        expect(window.items.map((message: { current_version: { display_text: string } }) => message.current_version.display_text)).toEqual(["Synthetic question", "Synthetic answer"]);
      }
    } finally { release(); await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.dispose(); }
  });
}
