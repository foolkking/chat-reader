import { expect, test, type Browser, type APIRequest, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

// Seed a claimed task so the UI has a deterministic in-progress interval. The
// cancel API and subsequent worker finalization still use real transactions.
function taskFixture(id: string, mode: "new" | "import" | "finish" | "fail" | "complete") {
  return JSON.parse(execFileSync("python", ["-B", "-c", `
import os,sys,uuid,json
from datetime import datetime,timezone
assert os.environ.get('APP_ENV')=='test' and os.environ.get('E2E_SETTINGS_MAILBOX')=='1'
assert any(f'127.0.0.1:{port}/' in os.environ['DATABASE_URL'] for port in (65438, 45438))
from app.core.database import SessionLocal
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
from app.models.content_cleanup import ContentCleanupScan
from app.models.background_job import BackgroundJob
from app.models.user import User
from app.services.content_cleanup import create_scan
from app.services.ownership import OwnershipScope
from app.services import background_jobs
mode=sys.argv[2]
with SessionLocal() as db:
 row=db.get(Conversation if mode=='new' else ImportRecord if mode=='import' else ContentCleanupScan,uuid.UUID(sys.argv[1]))
 assert db.get(User,row.owner_user_id).normalized_email.startswith('scan-lifecycle-')
 if mode in {'new','import'}:
  scan,job=create_scan(db,source='IMPORT' if mode=='import' else 'BATCH',scope_type='CURRENT_CONVERSATION',conversation_ids=[row.conversation_id if mode=='import' else row.id],force_new=True,ownership_scope=OwnershipScope(row.owner_user_id))
  if mode=='import':
   job.payload={**job.payload,'parent_task_id':str(row.id)}
   job.result={**job.result,'parent_task_id':str(row.id)}
  job.status='processing'; job.heartbeat_at=datetime.now(timezone.utc); db.commit()
 else:
  scan=row; job=db.get(BackgroundJob,scan.background_job_id)
 scan_id,job_id=scan.id,job.id
if mode=='fail':
 def fail(*args,**kwargs): raise RuntimeError('Synthetic scanner interruption')
 background_jobs.process_scan_chunk=fail
 background_jobs.process_background_job(job_id)
elif mode=='finish':
 with SessionLocal() as db: assert db.get(BackgroundJob,job_id).status in {'cancelling','cancelled'}
 background_jobs.process_background_job(job_id)
elif mode=='complete':
 for _ in range(3):
  with SessionLocal() as db:
   job=db.get(BackgroundJob,job_id)
   if job.status=='committed': break
   assert job.status in {'processing','queued'}
   job.status='processing'; db.commit()
  background_jobs.process_background_job(job_id)
print(json.dumps({'id':str(scan_id),'job_id':str(job_id)}))
`, id, mode], { cwd: path.resolve(process.cwd(), "../api"), encoding: "utf8" }).trim()) as { id: string; job_id: string };
}

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN", headers = { Origin: baseURL };
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const password = "Synthetic scan lifecycle passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `scan-lifecycle-${crypto.randomUUID()}@example.test`, password, confirm_password: password } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic scan lifecycle", messages: [
    { role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: "Before cite turn12search4 after." },
  ] } });
  expect(created.status()).toBe(201); const conversation = await created.json();
  const scan = taskFixture(conversation.conversation.id, "new");
  const page = await context.newPage();
  const open = async () => { if (width < 768) await page.getByTestId("mobile-sidebar-button").click(); await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click(); };
  await page.goto(baseURL); await open();
  const center = page.getByTestId("task-center-panel"), dialog = page.getByTestId("content-cleanup-dialog");
  const row = center.locator(`[data-cleanup-scan-id="${scan.id}"]`);
  const readSource = async () => (await (await context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json()).current_version;
  return { admin, context, headers, password, page, open, center, dialog, row, scan, readSource };
}

async function shot(page: Page, name: string, dialog = true) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.getByTestId(dialog ? "content-cleanup-dialog" : "task-center-panel").screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: live scan can stop, reopen and rescan without changing source`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    try {
      const before = await f.readSource();
      await expect(f.center.getByRole("region", { name: /^(处理中|In progress)$/ })).toContainText(/正在扫描消息|Scanning messages/);
      await expect(f.center.getByRole("region", { name: /^(需要处理|Needs attention)$/ })).toHaveCount(0);
      await f.row.getByRole("button", { name: /查看进度|View progress/ }).click();
      await expect(f.dialog.getByTestId("cleanup-scan-progress")).toContainText("0 / 2");
      expect((await f.dialog.getByTestId("content-cleanup-surface").boundingBox())!.height).toBeLessThan(450);
      await shot(f.page, `scan-progress-${width}`);
      await f.dialog.getByRole("button", { name: /^(取消扫描|Cancel scan)$/ }).click();
      await expect(f.dialog).toContainText(/当前批次结束后停止|Stopping after the current batch/);
      await shot(f.page, `scan-stopping-${width}`);
      taskFixture(f.scan.id, "finish");
      await expect(f.dialog.getByTestId("cleanup-scan-cancelled")).toBeVisible();
      await expect(f.dialog.getByRole("searchbox", { name: /查找对话|Find conversation/ })).toHaveCount(0);
      await shot(f.page, `scan-cancelled-${width}`);
      await f.dialog.getByRole("button", { name: /^(关闭|Close)$/ }).click();
      await expect(f.center.getByRole("region", { name: /^(已取消|Cancelled)$/ })).toContainText(/扫描已取消|Scan cancelled/);
      await f.row.getByRole("button", { name: /查看结果|View result/ }).click();
      await f.dialog.getByRole("button", { name: /重新扫描原对话|Rescan conversations/ }).click();
      await expect(f.dialog.getByRole("searchbox", { name: /查找对话|Find conversation/ })).toBeVisible();
      expect((await f.readSource()).id).toBe(before.id);
      expect((await f.readSource()).display_text).toBe(before.display_text);
      await shot(f.page, `scan-resumed-${width}`);
    } finally { await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: real worker failure reaches Failed and can start a fresh scan`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    try {
      taskFixture(f.scan.id, "fail");
      await f.page.reload(); await f.open();
      await expect(f.center.getByRole("region", { name: /^(失败|Failed)$/ })).toContainText(/噪声扫描需要重试|Noise scan needs retry/);
      await expect(f.center.getByRole("region", { name: /^(处理中|In progress)$/ })).toHaveCount(0);
      await f.row.getByRole("button", { name: /打开审查|Open review/ }).click();
      await expect(f.dialog.getByRole("alert")).toContainText("Synthetic scanner interruption");
      await shot(f.page, `scan-failed-${width}`);
      await f.dialog.getByRole("button", { name: /重新扫描原对话|Rescan conversations/ }).click();
      await expect(f.dialog.getByRole("searchbox", { name: /查找对话|Find conversation/ })).toBeVisible();
      expect((await f.readSource()).display_text).toBe("Before cite turn12search4 after.");
    } finally { await f.context.close(); await f.admin.dispose(); }
  });
}

test("768px: lost cancel response uses read-only recovery beside the task", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  let writes = 0;
  try {
    await f.page.route(`**/api/tasks/${f.scan.job_id}/cancel`, async route => { writes++; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); });
    await f.row.getByRole("button", { name: "Cancel scan", exact: true }).click();
    const check = f.row.getByRole("button", { name: "Check scan status" });
    await expect(check).toBeVisible();
    await f.page.route(`**/api/tasks/${f.scan.job_id}`, route => route.fulfill({ status: 503, json: { detail: "Synthetic read failure" } }));
    await check.click(); await expect(f.row.getByRole("alert")).toContainText("The check failed");
    await shot(f.page, "scan-cancel-check-failed-768", false);
    await f.page.unroute(`**/api/tasks/${f.scan.job_id}`);
    await check.click(); await expect(check).toHaveCount(0); expect(writes).toBe(1);
    await expect(f.row.getByRole("button", { name: "View progress" })).toBeFocused();
    taskFixture(f.scan.id, "finish");
    await expect(f.center.getByRole("region", { name: "Cancelled", exact: true })).toContainText("Scan cancelled");
    await expect(f.row.getByRole("button", { name: "View result" })).toBeFocused();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: undelivered cancellation permits explicit retry", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let writes = 0;
  try {
    await f.row.getByRole("button", { name: "查看进度" }).click();
    await f.page.route(`**/api/tasks/${f.scan.job_id}/cancel`, async route => { if (++writes === 1) await route.abort("failed"); else await route.continue(); });
    await f.dialog.getByRole("button", { name: "取消扫描", exact: true }).click();
    await f.dialog.getByRole("button", { name: "核对扫描状态" }).click();
    await expect(f.dialog).toContainText("扫描尚未停止，可以再次取消。");
    await shot(f.page, "scan-cancel-retry-375");
    await f.dialog.getByRole("button", { name: "取消扫描", exact: true }).click();
    await expect(f.dialog).toContainText("当前批次结束后停止");
    taskFixture(f.scan.id, "finish");
    await expect(f.dialog.getByTestId("cleanup-scan-cancelled")).toBeVisible(); expect(writes).toBe(2);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: scan completion wins a late cancellation without false success", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  try {
    await f.row.getByRole("button", { name: "查看进度" }).click();
    await f.page.route(`**/api/tasks/${f.scan.job_id}/cancel`, async route => { taskFixture(f.scan.id, "complete"); await route.continue(); });
    await f.dialog.getByRole("button", { name: "取消扫描", exact: true }).click();
    const check = f.dialog.getByRole("button", { name: "核对扫描状态" });
    // Polling may already read the genuine completed result; either route must
    // expose that result, never a cancelled confirmation.
    if (await check.isVisible()) await check.click();
    await expect(f.dialog.getByRole("searchbox", { name: /查找对话|Find conversation/ })).toBeVisible();
    await expect(f.dialog.getByTestId("cleanup-scan-cancelled")).toHaveCount(0);
    expect((await (await f.context.request.get(`${baseURL}/api/tasks/${f.scan.job_id}`)).json()).status).toBe("committed");
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: a delayed cancellation preserves deliberately moved focus", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440);
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  try {
    await f.page.route(`**/api/tasks/${f.scan.job_id}/cancel`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      arrived(); await gate; await route.fulfill({ response });
    });
    await f.row.getByRole("button", { name: "取消扫描", exact: true }).click();
    await ready;
    const close = f.center.getByRole("button", { name: "关闭", exact: true });
    await close.focus(); release();
    taskFixture(f.scan.id, "finish");
    await expect(f.center.getByRole("region", { name: "已取消", exact: true })).toBeVisible();
    await expect(close).toBeFocused();
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

test("768px: a late cancellation cannot restore the previous account's scan", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  let release!: () => void, arrived!: () => void, delivered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const finished = new Promise<void>(resolve => { delivered = resolve; });
  try {
    await f.page.route(`**/api/tasks/${f.scan.job_id}/cancel`, async route => {
      try {
        const response = await route.fetch(); expect(response.status()).toBe(200);
        arrived(); await gate; await route.fulfill({ response });
      } finally { delivered(); }
    });
    await f.row.getByRole("button", { name: "Cancel scan", exact: true }).click(); await ready;
    const email = `scan-lifecycle-other-${crypto.randomUUID()}@example.test`;
    expect((await f.context.request.post(`${baseURL}/api/auth/register`, { headers: f.headers, data: { email, password: f.password, confirm_password: f.password } })).status()).toBe(201);
    const login = await f.context.request.post(`${baseURL}/api/auth/login`, { headers: f.headers, data: { email, password: f.password } });
    expect(login.status()).toBe(200);
    await settingsAppearance(f.context.request, baseURL!, "en-US");
    await f.page.evaluate(otherId => {
      const key = "chat-reader:authenticated-offline-user", oldValue = localStorage.getItem(key);
      localStorage.setItem(key, otherId);
      window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: otherId }));
    }, (await login.json()).user_id);
    await expect(f.center).toHaveCount(0); await f.open();
    expect((await f.context.request.get(`${baseURL}/api/tasks/${f.scan.job_id}`)).status()).toBe(404);
    release(); await finished;
    await expect(f.center).toContainText("No tasks are currently running");
    await expect(f.row).toHaveCount(0);
    await shot(f.page, "scan-account-fence-768", false);
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

test("375px: cancelling an import follow-up keeps the imported conversation available", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  let scan: { id: string; job_id: string } | undefined;
  try {
    taskFixture(f.scan.id, "complete");
    await f.page.goto(baseURL!);
    await f.page.getByTestId("mobile-sidebar-button").click();
    await f.page.getByRole("button", { name: "导入数据", exact: true }).click();
    await f.page.getByTestId("import-file-input").setInputFiles({ name: "synthetic-cancel-import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      metadata: { title: "Synthetic retained import", powered_by: "ChatGPT Exporter" },
      messages: [{ role: "Prompt", say: "Synthetic imported question", time: "2026-10-08 10:00:00" }, { role: "Response", say: "Synthetic retained import answer.", time: "2026-10-08 10:01:00" }],
    })) });
    await f.page.getByTestId("preview-import-button").click();
    await expect(f.page.getByTestId("commit-import-button")).toBeEnabled();
    await f.page.route("**/api/content-cleanup/scans/pending?import_id=*", async route => {
      // Create a real follow-up bound to the committed import, then hold its
      // claimed interval deterministically; no import/result response is mocked.
      if (!scan) scan = taskFixture(new URL(route.request().url()).searchParams.get("import_id")!, "import");
      await route.continue();
    });
    await f.page.getByTestId("commit-import-button").click();
    const completed = f.page.getByTestId("import-completion-summary");
    await completed.getByRole("button", { name: "查看扫描", exact: true }).click();
    await f.dialog.getByRole("button", { name: "取消扫描", exact: true }).click();
    await expect(f.dialog).toContainText("当前批次结束后停止");
    taskFixture(scan!.id, "finish");
    await expect(f.dialog.getByTestId("cleanup-scan-cancelled")).toBeVisible();
    await f.dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(completed).toContainText("噪声扫描已取消，导入内容已保留。");
    if (process.env.SETTINGS_SCREENSHOT_DIR) await completed.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/scan-import-cancelled-375.png` });
    await completed.getByRole("button", { name: "打开对话", exact: true }).click();
    await expect(f.page.getByText("Synthetic retained import answer.", { exact: true })).toBeVisible();
  } finally { await f.context.close(); await f.admin.dispose(); }
});
