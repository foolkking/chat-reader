import { expect, test, type Page } from "@playwright/test";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openBackup(page: Page) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  const entry = page.getByRole("button", { name: /Data.*backup|数据与备份|Data archive|数据归档/ });
  if (!await entry.isVisible()) {
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    if (!await entry.isVisible()) await settings.click();
  }
  await entry.click();
  return page.getByRole("dialog", { name: /Data.*backup|数据与备份|Data archive|数据归档/ });
}

test("personal archive recovers lost upload response, keyboard navigation and task-center reentry", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL!, headers = { Origin: base }, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 375, height: 900 }, locale: "en-US" });
  try {
    const email = `archive-recovery-${Date.now()}@example.test`, password = "synthetic archive recovery passphrase";
    expect((await context.request.post(`${base}/api/auth/register`, { headers, data: { email, password, confirm_password: password } })).status()).toBe(201);
    await settingsAppearance(context.request, base, "en-US");
    const queued = await (await context.request.post(`${base}/api/me/archive/exports`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, data: {} })).json();
    await expect.poll(async () => (await (await context.request.get(`${base}/api/tasks/${queued.job_id}`)).json()).status).toBe("committed");
    const task = await (await context.request.get(`${base}/api/tasks/${queued.job_id}`)).json();
    const backup = await (await context.request.get(`${base}${task.result.download_url}`)).body();
    const page = await context.newPage(); await page.goto(base);
    let panel = await openBackup(page);
    await panel.getByRole("button", { name: "Restore archive", exact: true }).click();
    await panel.getByLabel("Personal archive file (.cr)").setInputFiles({ name: "synthetic-recovery.cr", mimeType: "application/octet-stream", buffer: backup });
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(confirmation).toBeVisible(); await page.keyboard.press("Escape");
    let loseResponse = true;
    await page.route("**/api/me/archive/previews", async (route) => {
      if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort(); }
      else await route.continue();
    });
    await panel.getByRole("button", { name: "Upload & preview" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Personal archive file (.cr)")).not.toHaveValue("");
    await panel.getByRole("button", { name: "Upload & preview" }).click();
    await expect(panel.getByRole("button", { name: "Restore these materials" })).toBeVisible();
    const tasks = await (await context.request.get(`${base}/api/me/archive/tasks`)).json();
    expect(tasks.filter((item: { job_type: string }) => item.job_type === "personal_archive_preflight")).toHaveLength(1);
    const previewId = tasks.find((item: { job_type: string }) => item.job_type === "personal_archive_preflight").job_id;
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const center = page.getByRole("dialog", { name: "Background tasks", exact: true });
    await center.getByRole("button", { name: "Review preview & restore" }).click();
    panel = page.getByRole("dialog", { name: "Data archive", exact: true });
    await expect(panel.getByRole("button", { name: "Restore these materials" })).toBeVisible();
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press("Tab");
      expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await panel.getByRole("button", { name: "Remove uploaded file" }).click();
    await page.getByRole("dialog", { name: "Remove this uploaded archive?" }).getByRole("button", { name: "Remove upload", exact: true }).click();
    await expect.poll(async () => (await (await context.request.get(`${base}/api/me/archive/tasks`)).json()).find((item: { job_id: string }) => item.job_id === previewId).result.artifact_available).toBe(false);
    // The DB response can precede the panel's awaited cache refresh. Closing
    // while it is still busy correctly invokes the unsaved-work guard.
    await expect(panel.getByRole("button", { name: "Restore these materials" })).toHaveCount(0);
    await expect(panel.getByLabel("Personal archive file (.cr)")).toBeEnabled();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(center.getByRole("button", { name: "Review preview & restore" })).toBeFocused();
  } finally { await context.close(); await admin.dispose(); }
});

test("personal archive rejects corrupt file and replacement creates no restore", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, headers = { Origin: base }, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  try {
    const email = `archive-invalid-${Date.now()}@example.test`, password = "synthetic archive invalid passphrase";
    expect((await context.request.post(`${base}/api/auth/register`, { headers, data: { email, password, confirm_password: password } })).status()).toBe(201);
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base);
    const panel = await openBackup(page);
    await panel.getByRole("button", { name: "Restore archive", exact: true }).click();
    await panel.getByLabel("Personal archive file (.cr)").setInputFiles({ name: "synthetic-invalid.cr", mimeType: "application/octet-stream", buffer: Buffer.from("synthetic invalid archive") });
    await panel.getByRole("button", { name: "Upload & preview" }).click();
    await expect(panel.getByRole("alert")).toContainText("malformed");
    await expect(panel.getByRole("button", { name: "Restore these materials" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Retry task", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Choose another archive", exact: true }).click();
    await expect(panel.getByLabel("Personal archive file (.cr)")).toBeFocused();
    await expect(panel.getByLabel("Personal archive file (.cr)")).toHaveValue("");
    const tasks = await (await context.request.get(`${base}/api/me/archive/tasks`)).json();
    expect(tasks.filter((item: { job_type: string }) => item.job_type === "personal_archive_restore")).toHaveLength(0);
    expect(tasks).toHaveLength(1);
  } finally { await context.close(); await admin.dispose(); }
});

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`personal archive browser round trip, reentry and duplicate protection ${width}`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, headers = { Origin: base }, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    try {
      const email = `personal-backup-${width}-${Date.now()}@example.test`, password = "synthetic personal backup passphrase";
      expect((await context.request.post(`${base}/api/auth/register`, { headers, data: { email, password, confirm_password: password } })).status()).toBe(201);
      await settingsAppearance(context.request, base, locale);
      const created = await context.request.post(`${base}/api/conversations`, { headers, data: { title: "Synthetic archive reading", messages: [
        { role: "user", content_markdown: "Synthetic backup question" },
        { role: "assistant", content_markdown: "# Synthetic archive heading\n\nSynthetic backup answer" },
      ] } });
      expect(created.status()).toBe(201);
      const original = (await created.json()).conversation.id;
      const page = await context.newPage(); await page.goto(base);
      let panel = await openBackup(page);
      await expect(panel.getByText(/Only this account|仅包含当前账户/)).toBeVisible();
      await panel.getByRole("button", { name: /Create personal archive|生成个人归档/ }).click();
      const downloadLink = panel.getByRole("button", { name: /Download personal archive|下载个人归档/ });
      await expect(downloadLink).toBeVisible();
      const downloadPromise = page.waitForEvent("download"); await downloadLink.click();
      const download = await downloadPromise, filePath = await download.path();
      expect(filePath).toBeTruthy();
      await panel.getByRole("button", { name: /Back to options|返回操作选择/ }).click();
      await panel.getByRole("group", { name: /Backup action|备份操作/ }).getByRole("button", { name: /Restore archive|恢复归档/ }).click();
      await panel.getByLabel(/Personal archive file|个人归档文件/).setInputFiles(filePath!);
      await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
      await expect(panel.getByRole("button", { name: /Restore these materials|确认新增恢复/ })).toBeVisible();
      await expect(panel.getByRole("checkbox", { name: /Also import account preferences|同时导入账户偏好/ })).not.toBeChecked();
      await panel.getByText(/Review projects and conversations|查看项目与对话清单/, { exact: true }).click();
      await expect(panel.getByText(/Conversation · Synthetic archive reading|对话 · Synthetic archive reading/)).toBeVisible();
      expect((await (await context.request.get(`${base}/api/me/archive/tasks`)).json()).filter((task: { job_type: string }) => task.job_type === "personal_archive_restore")).toHaveLength(0);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await panel.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/personal-backup-preview-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      panel = await openBackup(page);
      await panel.getByRole("region", { name: /Backup and restore records|备份与恢复记录/ }).getByRole("button", { name: /Archive preview|归档内容预检/ }).first().click();
      await panel.getByRole("button", { name: /Restore these materials|确认新增恢复/ }).click();
      await expect(panel.getByText(/Added .*1 conversations|已新增 .*1 个对话/)).toBeVisible();
      const tasks = await (await context.request.get(`${base}/api/me/archive/tasks`)).json();
      const restored = tasks.find((task: { job_type: string; status: string }) => task.job_type === "personal_archive_restore" && task.status === "committed");
      expect(restored.result.conversation_ids[0]).not.toBe(original);
      const window = await (await context.request.get(`${base}/api/conversations/${restored.result.conversation_ids[0]}/message-window?limit=10`)).json();
      expect(window.items.map((message: { current_version: { display_text: string } }) => message.current_version.display_text).join("\n")).toContain("Synthetic backup answer");
      await panel.getByRole("button", { name: /Back to options|返回操作选择/ }).click();
      await panel.getByLabel(/Personal archive file|个人归档文件/).setInputFiles(filePath!);
      await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
      await panel.getByRole("button", { name: /Restore these materials|确认新增恢复/ }).click();
      await expect(panel.getByText(/No duplicates were created|本次没有重复创建/)).toBeVisible();
      const again = await (await context.request.get(`${base}/api/me/archive/tasks`)).json();
      expect(again.filter((task: { job_type: string; result: { already_restored?: boolean } }) => task.job_type === "personal_archive_restore" && task.result.already_restored)).toHaveLength(1);
      await context.setOffline(true);
      await expect(panel.getByText(/Personal backups and restores need a connection|个人备份与恢复需要联网/)).toBeVisible();
      await context.setOffline(false);
    } finally { await context.close(); await admin.dispose(); }
  });
}
