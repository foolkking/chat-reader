import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL settings fixture");

async function openSystem(page: Page) {
  const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
  const sidebar = page.getByRole("button", { name: /^(Open sidebar|打开侧栏)$/ });
  const entry = page.getByRole("button", { name: /System Instance backup|系统 实例备份/ });
  if (!await entry.isVisible()) {
    await expect(settings.or(sidebar).first()).toBeVisible();
    if (!await settings.isVisible()) await sidebar.click();
    if (!await entry.isVisible()) await settings.click();
  }
  await entry.click();
  return page.getByRole("dialog", { name: /^(System|系统)$/ });
}

function legacyArchive() {
  // Complete synthetic v4 container, including all required canonical tables.
  const sources = Array.from({ length: 21 }, () => crypto.randomUUID()).sort();
  const entries: Record<string, Uint8Array> = {};
  const canonical_entries = ["projects", "conversations", "project_conversations", "messages", "message_versions", "asset_objects", "attachments", "attachment_occurrences", "annotations", "notebooks", "source_refs", "reading_positions"].map((name) => {
    const rows = name === "projects" ? sources.map((owner_user_id, index) => ({ id: crypto.randomUUID(), owner_user_id, name: `Synthetic legacy project ${index + 1}`, is_default: false })) : [];
    const path = `data/${name}.jsonl`, bytes = strToU8(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
    entries[path] = bytes;
    return { path, byte_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), record_count: rows.length };
  });
  entries["manifest.json"] = strToU8(JSON.stringify({ format: "chat-reader-system-archive", version: 4, canonical_entries }));
  return Buffer.from(zipSync(entries, { level: 0 }));
}

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "en-US"]] as const) {
  test(`system archive review persists ownership across pages and reload ${width}`, async ({ browser, playwright, baseURL }) => {
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale, storageState: await admin.storageState() });
    try {
      await settingsAppearance(context.request, base, locale);
      const page = await context.newPage(); await page.goto(base);
      let panel = await openSystem(page);
      await panel.getByRole("button", { name: /Restore archive|恢复归档/, exact: true }).click();
      const upload = legacyArchive();
      await panel.getByLabel(/System archive file|系统归档文件/).setInputFiles({ name: "synthetic-legacy.cr", mimeType: "application/octet-stream", buffer: upload });
      await panel.getByRole("button", { name: /Upload & preview|上传并预检/ }).click();
      await expect(panel.getByText(/21 sources · 21 need a choice|21 个来源 · 21 个待确认/)).toBeVisible();
      await expect(panel.getByRole("button", { name: /Restore system archive|确认恢复系统归档/, exact: true })).toBeDisabled();
      await panel.getByRole("button", { name: /Next sources|下一页来源/ }).click();
      await panel.getByRole("button", { name: /Choose account|选择账户/, exact: true }).click();
      await panel.getByLabel(/Search target accounts|搜索目标账户/).fill(process.env.E2E_AUTH_EMAIL!);
      await panel.getByRole("button", { name: /Search|搜索/, exact: true }).click();
      await panel.getByRole("button", { name: new RegExp(`${process.env.E2E_AUTH_EMAIL}.*Root Admin`) }).click();
      await expect(panel.getByText(/21 sources · 20 need a choice|21 个来源 · 20 个待确认/)).toBeVisible();
      const tasks = await (await context.request.get(`${base}/api/system/archive/tasks`)).json();
      const preview = tasks.find((row: { job_type: string }) => row.job_type === "system_archive_preflight");
      const review = await (await context.request.get(`${base}/api/system/archive/previews/${preview.job_id}/accounts?offset=20&limit=1`)).json();
      expect(review.items[0].decision).toBe("EXISTING");
      expect(review.items[0].target.email).toBe(process.env.E2E_AUTH_EMAIL);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await panel.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/system-ownership-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.reload({ waitUntil: "domcontentloaded" }); panel = await openSystem(page);
      await panel.getByRole("region", { name: /Backup and restore records|备份与恢复记录/ }).getByRole("button", { name: /Archive preview|归档内容预检/ }).first().click();
      await expect(panel.getByText(/21 sources · 20 need a choice|21 个来源 · 20 个待确认/)).toBeVisible();
      for (let count = 0; count < 12; count++) { await page.keyboard.press("Tab"); expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true); }
      await context.setOffline(true);
      await expect(panel.getByText(/System backups and restores need a connection|系统备份与恢复需要联网/)).toBeVisible();
      await context.setOffline(false);
    } finally { await context.close(); await admin.dispose(); }
  });
}

test("system archive lost upload response, ownership conflict and task-center reentry", async ({ browser, playwright, baseURL }) => {
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await admin.storageState() });
  try {
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base);
    let panel = await openSystem(page);
    await panel.getByRole("button", { name: "Restore archive", exact: true }).click();
    await panel.getByLabel("System archive file (.cr)").setInputFiles({ name: "synthetic-retry.cr", mimeType: "application/octet-stream", buffer: legacyArchive() });
    let lost = true;
    await page.route("**/api/system/archive/previews", async (route) => { if (lost) { lost = false; await route.fetch(); await route.abort(); } else await route.continue(); });
    await panel.getByRole("button", { name: "Upload & preview" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("System archive file (.cr)")).not.toHaveValue("");
    await panel.getByRole("button", { name: "Upload & preview" }).click();
    await expect(panel.getByText("21 sources · 21 need a choice")).toBeVisible();
    const tasks = await (await context.request.get(`${base}/api/system/archive/tasks`)).json();
    const preview = tasks.find((row: { job_type: string }) => row.job_type === "system_archive_preflight");
    const endpoint = `${base}/api/system/archive/previews/${preview.job_id}/accounts`;
    const review = await (await context.request.get(endpoint)).json();
    const targets = await (await context.request.get(`${base}/api/system/archive/account-targets?q=${process.env.E2E_AUTH_EMAIL}`)).json();
    await panel.getByRole("button", { name: "Choose account", exact: true }).first().click();
    // A separate real request modifies the persisted revision behind the open editor.
    expect((await context.request.patch(`${endpoint}/${review.items[0].source_key}`, { headers: { Origin: base }, data: { base_revision: review.revision, decision: "EXISTING", target_user_id: targets.items[0].id } })).status()).toBe(200);
    await panel.getByLabel("Search target accounts").fill(process.env.E2E_AUTH_EMAIL!);
    await panel.getByRole("button", { name: "Search", exact: true }).click();
    await panel.getByRole("button", { name: new RegExp(`${process.env.E2E_AUTH_EMAIL}.*Root Admin`) }).click();
    await expect(panel.getByRole("alert")).toContainText("Ownership choices changed");
    await panel.getByRole("button", { name: new RegExp(`${process.env.E2E_AUTH_EMAIL}.*Root Admin`) }).click();
    await expect(panel.getByText("21 sources · 20 need a choice")).toBeVisible();
    await expect(panel.getByText("Ownership choice saved. Accounts remain unchanged until you confirm restoration.")).toBeVisible();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const center = page.getByRole("dialog", { name: "Background tasks", exact: true });
    await center.getByTestId("task-result-system_archive_preflight").getByRole("button", { name: "Review preview & restore" }).first().click();
    panel = page.getByRole("dialog", { name: "System", exact: true });
    await expect(panel.getByRole("heading", { name: "Review account ownership" })).toBeVisible();
    await panel.getByRole("button", { name: "Remove uploaded file" }).click();
    await page.getByRole("dialog", { name: "Remove this uploaded archive?" }).getByRole("button", { name: "Remove upload", exact: true }).click();
    await expect.poll(async () => (await (await context.request.get(`${base}/api/system/archive/tasks`)).json()).find((row: { job_id: string }) => row.job_id === preview.job_id).result.artifact_available).toBe(false);
  } finally { await context.close(); await admin.dispose(); }
});
