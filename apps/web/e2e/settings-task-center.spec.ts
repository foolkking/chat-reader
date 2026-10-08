import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000, extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL and real export worker");

// Seed the pre-existing failure/running state; retry/cancel themselves use the
// real authenticated API and PostgreSQL transaction. Only synthetic users qualify.
function seedActionTask(conversationId: string, operation: "retry" | "cancel"): string {
  return execFileSync("python", ["-c", `
import os,sys,uuid
from datetime import datetime,timezone
assert os.environ.get('APP_ENV')=='test' and os.environ.get('E2E_SETTINGS_MAILBOX')=='1'
assert os.environ.get('DATABASE_URL'), 'Explicit disposable DATABASE_URL is required; do not fall back to local configuration'
from app.core.database import SessionLocal
from app.models.conversation import Conversation
from app.models.background_job import BackgroundJob
from app.models.user import User
with SessionLocal() as db:
 conversation=db.get(Conversation,uuid.UUID(sys.argv[1]))
 assert db.get(User,conversation.owner_user_id).normalized_email.startswith('task-fence-')
 retry=sys.argv[2]=='retry'
 now=datetime.now(timezone.utc)
 job=BackgroundJob(owner_user_id=conversation.owner_user_id,
  job_type='conversation_export' if retry else 'conversation_merge',
  status='failed' if retry else 'processing',phase='failed' if retry else 'messages',
  queued_at=now,started_at=now,heartbeat_at=now,completed_at=now if retry else None,
  total_items=1, payload={'title':conversation.display_title,'conversation_id':str(conversation.id),'export_format':'markdown_bundle'},
  error_message='Synthetic retryable failure' if retry else None)
 db.add(job); db.commit(); print(job.id)
`, conversationId, operation], { cwd: path.resolve(process.cwd(), "../api"), encoding: "utf8" }).trim();
}

for (const operation of ["retry", "cancel"] as const) {
  test(`late ${operation} response cannot repopulate another account's task center`, async ({ page, context, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void;
    const ready = new Promise<void>(resolve => { arrived = resolve; });
    let delivered!: () => void;
    const finished = new Promise<void>(resolve => { delivered = resolve; });
    try {
      const password = "Synthetic-task-fence-passphrase";
      const email = `task-fence-${crypto.randomUUID()}@example.test`;
      expect((await context.request.post("/api/auth/register", { data: { email, password, confirm_password: password } })).status()).toBe(201);
      expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
      await settingsAppearance(context.request, baseURL!, "en-US");
      const created = await context.request.post("/api/conversations", { data: { title: "Synthetic private first-account task", messages: [
        { role: "user", content_markdown: "Synthetic isolated source" }, { role: "assistant", content_markdown: "Synthetic response" },
      ] } });
      expect(created.status()).toBe(201);
      const jobId = seedActionTask((await created.json()).conversation.id, operation);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.getByTestId("sidebar-tasks-button").click();
      await page.route(`**/api/tasks/${jobId}/${operation}`, async route => {
        try {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          expect((await response.json()).status).toBe(operation === "retry" ? "queued" : "cancelling");
          arrived(); await gate; await route.fulfill({ response });
        } finally { delivered(); }
      });
      await page.locator(`[id="task-row-${jobId}"]`).getByRole("button", { name: operation === "retry" ? "Retry" : "Cancel merge", exact: true }).click();
      await ready;
      const other = `task-fence-other-${crypto.randomUUID()}@example.test`;
      expect((await context.request.post("/api/auth/register", { data: { email: other, password, confirm_password: password } })).status()).toBe(201);
      const switched = await context.request.post("/api/auth/login", { data: { email: other, password } });
      expect(switched.status()).toBe(200);
      const otherId = (await switched.json()).user_id;
      await settingsAppearance(context.request, baseURL!, "en-US");
      // Reproduce a different tab's identity change without navigating/reloading
      // this document (which would simply abort the delayed old response).
      const marker = crypto.randomUUID();
      await page.evaluate(({ otherId, marker }) => {
        (window as Window & { taskFenceMarker?: string }).taskFenceMarker = marker;
        const key = "chat-reader:authenticated-offline-user";
        const oldValue = localStorage.getItem(key);
        localStorage.setItem(key, otherId);
        window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: otherId }));
      }, { otherId, marker });
      await expect(page.getByTestId("task-center-panel")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-tasks-button")).toBeVisible();
      await page.getByTestId("sidebar-tasks-button").click();
      await expect(page.getByTestId("task-center-panel")).toBeVisible();
      expect(await page.evaluate(() => (window as Window & { taskFenceMarker?: string }).taskFenceMarker)).toBe(marker);
      expect((await context.request.get(`/api/tasks/${jobId}`)).status()).toBe(404);
      release(); await finished;
      // Allow the delivered promise/mutation callback and React paint to settle.
      await page.waitForTimeout(250);
      await expect(page.getByTestId("task-center-panel")).not.toContainText("Synthetic private first-account task");
      await expect(page.locator(`[id="task-row-${jobId}"]`)).toHaveCount(0);
    } finally { release(); await admin.dispose(); }
  });
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: task identity survives refresh and delivers its own export`, async ({ page, context, playwright, baseURL }, info) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const locale = width === 768 ? "en-US" : "zh-CN";
    try {
      await context.addCookies((await admin.storageState()).cookies);
      await settingsAppearance(context.request, baseURL!, locale);
      await page.setViewportSize({ width, height: 900 });
      const title = `Synthetic task center ${width}`;
      const body = `Synthetic task body ${crypto.randomUUID()}`;
      const created = await admin.post("/api/conversations", { data: { title, messages: [
        { role: "user", content_markdown: body },
        { role: "assistant", content_markdown: "Synthetic task answer" },
      ] } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id;
      const jobs: Array<{ job_id: string; queued_at: string; format: string }> = [];
      for (const format of ["markdown_bundle", "canjson_bundle", "canjson_bundle"]) {
        // Ensure two identical operations have visibly different server times.
        if (jobs.length) await page.waitForTimeout(1100);
        const queued = await admin.post(`/api/conversations/${id}/exports`, {
          headers: { "Idempotency-Key": crypto.randomUUID() }, data: { format },
        });
        expect(queued.status()).toBe(202);
        const job = await queued.json();
        expect(job.source_label).toBe(title);
        expect(job.export_format).toBe(format);
        jobs.push({ ...job, format });
        await expect.poll(async () => (await (await admin.get(`/api/tasks/${job.job_id}`)).json()).status).toBe("committed");
        expect(await (await admin.get(`/api/tasks/${job.job_id}`)).json()).toMatchObject({ processed_items: 1, total_items: 1 });
      }
      await page.goto("/");
      await page.reload();
      if (width < 768) await page.getByTestId("mobile-sidebar-button").click();
      await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
      const center = page.getByTestId("task-center-panel");
      const times: string[] = [];
      for (const job of jobs) {
        const row = center.locator(`[id="task-row-${job.job_id}"]`);
        await expect(row).toContainText(title);
        await expect(row).toContainText(job.format === "markdown_bundle" ? "Markdown" : "CanJSON");
        await expect(row.locator("time")).toHaveAttribute("datetime", job.queued_at);
        times.push((await row.locator("time").textContent())!);
        await expect(row.getByRole("progressbar")).toHaveCount(0);
        const download = row.getByRole("button", { name: /^(下载结果|Download result)$/ });
        await expect(download).toBeEnabled();
        const received = page.waitForEvent("download");
        await download.focus(); await page.keyboard.press("Enter");
        const file = await received;
        expect(await file.failure()).toBeNull();
        const entries = unzipSync(await readFile((await file.path())!));
        const member = job.format === "markdown_bundle" ? "conversation.md" : "conversation.canjsonl";
        expect(strFromU8(entries[member])).toContain(body);
        if (job.format === "canjson_bundle") {
          const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
          for (const [name, bytes] of Object.entries(entries)) {
            if (name === "manifest.json") continue;
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.files[name].sha256);
          }
        }
      }
      expect(new Set(times).size).toBe(3);
      expect(await center.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await center.locator(`[id="task-row-${jobs[0].job_id}"]`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`task-center-${width}-${locale}.png`) });
      await center.getByTestId(`task-dismiss-${jobs[0].job_id}`).click();
      await expect(center.locator(`[id="task-row-${jobs[0].job_id}"]`)).toHaveCount(0);
      await page.reload();
      if (width < 768) await page.getByTestId("mobile-sidebar-button").click();
      await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
      await expect(page.locator(`[id="task-row-${jobs[0].job_id}"]`)).toHaveCount(0);
      await expect(page.locator(`[id="task-row-${jobs[1].job_id}"]`)).toBeVisible();
    } finally { await admin.dispose(); }
  });
}
