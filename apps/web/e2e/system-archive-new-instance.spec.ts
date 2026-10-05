import { exportFixture } from "./export-retention-helper";
import { expect, test, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(!process.env.E2E_SYSTEM_ARCHIVE_SOURCE, "Requires a fresh disposable PostgreSQL instance and a synthetic v5 archive");

async function openSystem(page: Page) {
  await page.getByRole("button", { name: /^(Settings|设置)$/ }).click();
  await page.locator('[aria-labelledby="settings-administration-heading"]').getByRole("button", { name: /^(System|系统)$/ }).click();
  return page.getByRole("dialog", { name: /^(System|系统)$/ });
}

test("new instance restores identities and configuration, downloads a new archive, and deduplicates repeat restore", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: await admin.storageState() });
  try {
    expect((await (await context.request.get(`${base}/api/system/archive/capabilities`)).json()).empty_instance).toBe(true);
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base);
    const panel = await openSystem(page);
    await panel.getByRole("button", { name: "Restore archive", exact: true }).click();
    await panel.getByLabel("System archive file (.cr)").setInputFiles(process.env.E2E_SYSTEM_ARCHIVE_SOURCE!);
    await panel.getByRole("button", { name: "Upload & preview" }).click();
    await expect(panel.getByText("2 sources · 0 need a choice")).toBeVisible();
    await expect(panel.getByText("Current Root Admin · credentials retained")).toBeVisible();
    await expect(panel.getByText("Password reset before first login", { exact: true })).toBeVisible();
    if (process.env.E2E_SETTINGS_SCREENSHOTS) await panel.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/system-new-instance-preview.png` });
    await panel.getByRole("button", { name: "Restore system archive", exact: true }).click();
    await expect(panel.getByText(/Restored 2 projects and 2 conversations|已恢复 2 个项目、2 个对话/)).toBeVisible();
    const restoredTasks = await (await context.request.get(`${base}/api/system/archive/tasks`)).json();
    const restored = restoredTasks.find((task: { job_type: string }) => task.job_type === "system_archive_restore");
    expect(restored.status).toBe("committed");
    expect(restored.result.counts.users).toBeGreaterThan(0);
    expect(restored.result.counts.skills).toBe(2);
    expect(restored.result.counts.profiles).toBe(1);
    expect((await (await context.request.get(`${base}/api/system/archive/capabilities`)).json()).empty_instance).toBe(false);
    const users = await (await context.request.get(`${base}/api/admin/access/users`)).json();
    expect(users).toHaveLength(2);
    const normal = users.find((user: { role: string }) => user.role === "USER");
    const conversations = await (await context.request.get(`${base}/api/admin/content/users/${normal.id}/conversations`)).json();
    expect(conversations.items).toHaveLength(1);
    expect((await (await context.request.get(`${base}/api/admin/features`)).json()).maximum_import_size_mb).toBe(64);
    await panel.getByRole("button", { name: /Back to options|返回操作选择/ }).click();
    await panel.getByLabel(/System archive file|系统归档文件/).setInputFiles(process.env.E2E_SYSTEM_ARCHIVE_SOURCE!);
    await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
    await panel.getByRole("button", { name: /Retrieve previous restore result|查看已有恢复结果/ }).click();
    await expect(panel.getByText(/No duplicates were created|本次没有重复创建/)).toBeVisible();
    expect(await (await context.request.get(`${base}/api/admin/access/users`)).json()).toHaveLength(2);
    await panel.getByRole("button", { name: /Back to options|返回操作选择/ }).click();
    await panel.getByRole("button", { name: /Back up the system|备份整个系统/, exact: true }).click();
    await panel.getByRole("button", { name: /Create system archive|生成系统归档/ }).click();
    const link = panel.getByRole("button", { name: /Download system archive|下载系统归档/ });
    await expect(link).toBeVisible();
    const downloaded = page.waitForEvent("download"); await link.click();
    const archive = await downloaded;
    expect(await archive.failure()).toBeNull();
    expect(await archive.path()).toBeTruthy();
    const exportTasks = await (await context.request.get(`${base}/api/system/archive/tasks`)).json();
    const exported = exportTasks.find((task: { job_type: string; status: string }) => task.job_type === "system_archive_export" && task.status === "committed");
    exportFixture(exported.result.artifact_id, true);
    await panel.getByRole("button", { name: /Refresh archive records|刷新归档记录/ }).click();
    await expect(panel.getByText(/temporary file is no longer available|临时文件已失效/)).toBeVisible();
    await expect(panel.getByRole("button", { name: /Download system archive|下载系统归档/ })).toHaveCount(0);
    await page.clock.setFixedTime(new Date());
    await panel.getByRole("button", { name: /^(Generate again|重新生成)$/ }).click();
    await expect(panel.getByRole("button", { name: /Download system archive|下载系统归档/ })).toBeVisible();
    const records = await (await context.request.get(`${base}/api/admin/backups`)).json();
    expect(records.some((record: { operation: string; status: string }) => record.operation === "BACKUP" && record.status === "COMPLETED")).toBe(true);
  } finally { await context.close(); await admin.dispose(); }
});
