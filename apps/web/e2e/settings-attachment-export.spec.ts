import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000, extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, real worker and synthetic administrator");

// Deliberately damage only this generated fixture object. No real account data.
function fixtureBytes(attachmentId: string, content: string) {
  execFileSync("python", ["-c", `
import os, sys, uuid
assert os.environ.get('APP_ENV') == 'test' and os.environ.get('E2E_SETTINGS_MAILBOX') == '1'
from app.core.database import SessionLocal
from app.models.attachment import Attachment
from app.services.assets.asset_store import get_asset_store
with SessionLocal() as db:
 row = db.get(Attachment, uuid.UUID(sys.argv[1]))
 assert row.original_filename.startswith('synthetic-export-100x-')
 get_asset_store().resolve_key(row.asset_object.storage_key).write_bytes(sys.argv[2].encode())
`, attachmentId, content], { cwd: path.resolve(process.cwd(), "../api"), encoding: "utf8" });
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: attachment export failure recovers with verified downloaded bytes`, async ({ page, context, playwright, baseURL }, info) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const locale = width === 768 ? "en-US" : "zh-CN";
    let attachmentId = "";
    const original = `Synthetic attachment ${crypto.randomUUID()} 100x`;
    try {
      await context.addCookies((await admin.storageState()).cookies);
      await settingsAppearance(context.request, baseURL!, locale);
      await page.setViewportSize({ width, height: 900 });
      const created = await admin.post("/api/conversations", { data: { title: "Synthetic 100x", messages: [
        { role: "user", content_markdown: "Synthetic bundle question" },
        { role: "assistant", content_markdown: "Synthetic bundle answer" },
      ] } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id;
      const session = await admin.post(`/api/conversations/${id}/attachment-upload-sessions`, { data: {} });
      expect(session.status()).toBe(201);
      const sessionId = (await session.json()).id;
      const upload = await admin.post(`/api/attachment-upload-sessions/${sessionId}/items`, { multipart: {
        file: { name: `synthetic-export-100x-${crypto.randomUUID()}.txt`, mimeType: "text/plain", buffer: Buffer.from(original) },
      } });
      expect(upload.status()).toBe(201);
      const finalized = await admin.post(`/api/conversations/${id}/attachments`, { data: { upload_item_ids: [(await upload.json()).id] } });
      expect(finalized.ok()).toBe(true);
      attachmentId = (await finalized.json()).items[0].id;
      fixtureBytes(attachmentId, original.replace("Synthetic", "Corrupted"));
      await page.goto(`/conversations/${id}`);
      await expect(page.locator("article[data-message-id]").first()).toBeVisible();
      if (width < 768) {
        await page.getByRole("button", { name: /^(更多|More)$/ }).click();
        await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name: /^(导出|Export)$/ }).click();
      } else {
        await page.getByRole("button", { name: /^(消息操作|Message actions)$/ }).click();
        await page.getByRole("button", { name: /^(导出|Export)$/ }).click();
      }
      await page.getByRole("button", { name: "CanJSON", exact: true }).click();
      await page.getByRole("checkbox", { name: /包含附件|Include attachments/ }).check();
      const submit = page.getByRole("button", { name: /^(生成导出包|Generate export)$/ });
      const failedJob = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/conversations/${id}/exports`));
      await submit.click();
      const job = await (await failedJob).json();
      await expect.poll(async () => (await (await admin.get(`/api/tasks/${job.job_id}`)).json()).status).toBe("failed");
      await expect(page.getByText(/附件内容校验失败|Attachment integrity check failed/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`attachment-failure-${width}.png`) });
      fixtureBytes(attachmentId, original);
      const resubmitted = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/conversations/${id}/exports`));
      await submit.focus(); await page.keyboard.press("Enter");
      const retry = await (await resubmitted).json();
      expect(retry.job_id).not.toBe(job.job_id);
      await expect.poll(async () => (await (await admin.get(`/api/tasks/${retry.job_id}`)).json()).status).toBe("committed");
      const saved = page.waitForEvent("download");
      await page.getByRole("button", { name: /^(下载导出包|Download export)$/ }).click();
      const file = await saved;
      expect(await file.failure()).toBeNull();
      expect(file.suggestedFilename()).toBe("Synthetic 100x.context.zip");
      const entries = unzipSync(await readFile((await file.path())!));
      const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
      const records = strFromU8(entries["conversation.canjsonl"]).trim().split("\n").map(line => JSON.parse(line));
      expect(records.filter(record => record.record_type === "message")).toHaveLength(2);
      expect(manifest.conversation.message_count).toBe(2);
      for (const [name, data] of Object.entries(entries)) {
        if (name === "manifest.json") continue;
        expect(createHash("sha256").update(data).digest("hex")).toBe(manifest.files[name].sha256);
        expect(data.byteLength).toBe(manifest.files[name].byte_size);
      }
      const attachment = records.find(record => record.record_type === "attachment");
      expect(strFromU8(entries[attachment.object.path])).toBe(original);
      await page.screenshot({ path: info.outputPath(`attachment-download-${width}.png`) });
    } finally {
      if (attachmentId) fixtureBytes(attachmentId, original);
      await admin.dispose();
    }
  });
}
