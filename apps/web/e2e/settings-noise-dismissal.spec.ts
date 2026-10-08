import { expect, test, type Browser, type APIRequest, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL/API/worker");

async function fixture(browser: Browser, request: APIRequest, baseURL: string, width: number, noisy = false) {
  const admin = await settingsAdmin(request, baseURL);
  const locale = width === 768 ? "en-US" : "zh-CN";
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const headers = { Origin: baseURL }, password = "synthetic dismissal passphrase";
  expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
    email: `dismissal-${crypto.randomUUID()}@example.test`, password, confirm_password: password,
  } })).status()).toBe(201);
  await settingsAppearance(context.request, baseURL, locale);
  const source = noisy ? "Before cite turn12search4 after." : "Synthetic ordinary answer.";
  const response = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
    title: "Synthetic dismissal review", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
  } });
  expect(response.status()).toBe(201); const conversation = await response.json();
  const queued = await context.request.post(`${baseURL}/api/content-cleanup/rules/scan-existing`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } });
  expect(queued.status()).toBe(202); const scan = await queued.json();
  const url = `${baseURL}/api/content-cleanup/scans/${scan.id}`;
  await expect.poll(async () => (await (await context.request.get(url)).json()).status).toBe("READY");
  const page = await context.newPage();
  const open = async () => {
    if (width < 768) await page.getByTestId("mobile-sidebar-button").click();
    await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
  };
  await page.goto(baseURL); await open();
  const center = page.getByTestId("task-center-panel");
  const row = center.locator(`[data-cleanup-scan-id="${scan.id}"]`);
  const readSource = async () => (await (await context.request.get(`${baseURL}/api/messages/${conversation.messages[1].id}`)).json()).current_version;
  return { admin, context, headers, page, center, row, scan, url, source, open, readSource };
}

function seedTask(scanId: string, operation: "failed" | "expired") {
  execFileSync("python", ["-B", "-c", `
import os,sys,uuid
from datetime import datetime,timedelta,timezone
assert os.environ.get('APP_ENV')=='test' and os.environ.get('E2E_SETTINGS_MAILBOX')=='1'
assert any(f'127.0.0.1:{port}/' in os.environ['DATABASE_URL'] for port in (65438, 45438))
from app.core.database import SessionLocal
from app.models.content_cleanup import ContentCleanupScan
from app.models.background_job import BackgroundJob
from app.models.user import User
with SessionLocal() as db:
 scan=db.get(ContentCleanupScan,uuid.UUID(sys.argv[1]))
 assert db.get(User,scan.owner_user_id).normalized_email.startswith('dismissal-')
 job=db.get(BackgroundJob,scan.background_job_id)
 assert job.status=='committed'
 if sys.argv[2]=='failed':
  scan.status='FAILED'; job.status='failed'; job.error_message='Synthetic interrupted scan'
 else:
  job.completed_at=datetime.now(timezone.utc)-timedelta(days=3)
 db.commit()
`, scanId, operation], { cwd: path.resolve(process.cwd(), "../api"), encoding: "utf8" });
}

async function shot(page: Page, name: string, result = false) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.getByTestId(result ? "content-cleanup-dialog" : "task-center-panel").screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: zero-result global scan is a compact completion without an attention reminder`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width);
    try {
      await expect(f.center.getByRole("region", { name: /^(已完成|Completed)$/ })).toContainText(/当前规则未发现噪声候选|No noise candidates found with the current rules/);
      await expect(f.center.getByRole("region", { name: /^(需要处理|Needs attention)$/ })).toHaveCount(0);
      await expect(f.page.getByTestId("task-summary-button").filter({ visible: true })).toHaveCount(0);
      await f.row.getByRole("button", { name: /查看结果|View result/ }).click();
      const dialog = f.page.getByTestId("content-cleanup-dialog");
      await expect(dialog.getByText(/当前规则未发现噪声候选|No noise candidates found with the current rules/)).toBeVisible();
      expect((await dialog.getByTestId("content-cleanup-surface").boundingBox())!.height).toBeLessThan(420);
      await shot(f.page, `empty-result-${width}`, true);
      const before = await f.readSource();
      await dialog.getByRole("button", { name: /^(完成|Done)$/ }).click();
      await expect(dialog).not.toBeVisible(); await expect(f.row).toHaveCount(0);
      expect((await f.context.request.get(f.url)).status()).toBe(404);
      expect((await (await f.context.request.get(f.url + "/dismissal")).json()).status).toBe("DISMISSED");
      expect((await f.readSource()).id).toBe(before.id); expect((await f.readSource()).display_text).toBe(f.source);
      await shot(f.page, `empty-finished-${width}`);
    } finally { await f.context.close(); await f.admin.dispose(); }
  });

  test(`${width}px: ignored review recovers a lost response beside its row`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, width, true);
    let writes = 0;
    try {
      await f.page.route(`**/api/content-cleanup/scans/${f.scan.id}`, async route => {
        if (route.request().method() !== "DELETE") return route.continue();
        writes++; const result = await route.fetch(); expect(result.status()).toBe(204);
        await route.abort("failed");
      });
      await f.row.getByRole("button", { name: /忽略本次结果|Ignore this result/ }).click();
      const check = f.row.getByRole("button", { name: /核对结束结果|Check dismissal result/ });
      await expect(check).toBeVisible(); await shot(f.page, `dismiss-unknown-${width}`);
      await f.page.route(`**/api/content-cleanup/scans/${f.scan.id}/dismissal`, route => route.fulfill({ status: 503, json: { detail: "Synthetic read failure" } }));
      await check.click(); await expect(f.row.getByRole("alert")).toContainText(/核对失败|check failed/);
      await shot(f.page, `dismiss-check-failed-${width}`);
      await f.page.unroute(`**/api/content-cleanup/scans/${f.scan.id}/dismissal`);
      await check.click(); await expect(f.row).toHaveCount(0);
      expect(writes).toBe(1);
      await expect(f.center.getByRole("status").filter({ hasText: /本次审查已结束|This review has ended/ }),
        await f.page.evaluate(() => JSON.stringify({ tag: document.activeElement?.tagName, testId: document.activeElement?.getAttribute("data-testid"), role: document.activeElement?.getAttribute("role") }))).toBeFocused();
      expect((await f.readSource()).display_text).toBe(f.source);
    } finally { await f.context.close(); await f.admin.dispose(); }
  });
}

test("768px: empty-result dismissal can retry after an undelivered request", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  let writes = 0;
  try {
    await f.row.getByRole("button", { name: "View result" }).click();
    const dialog = f.page.getByTestId("content-cleanup-dialog");
    await f.page.route(`**/api/content-cleanup/scans/${f.scan.id}`, async route => {
      if (route.request().method() !== "DELETE") return route.continue();
      writes++; if (writes === 1) await route.abort("failed"); else await route.continue();
    });
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await dialog.getByRole("button", { name: "Check dismissal result" }).click();
    await expect(dialog.getByText("This review is still available. You can finish it again.")).toBeVisible();
    await shot(f.page, "empty-dismiss-retry-768", true);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).not.toBeVisible(); expect(writes).toBe(2);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: dismissing an actual failed task leaves no orphan task row", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440, true);
  try {
    seedTask(f.scan.id, "failed");
    await f.page.reload(); await f.open();
    await expect(f.row).toContainText("噪声扫描需要重试");
    await f.row.getByRole("button", { name: "忽略本次结果" }).click();
    await expect(f.row).toHaveCount(0);
    const job = await (await f.context.request.get(`${baseURL}/api/tasks/${f.scan.background_job_id}`)).json();
    expect(job.status).toBe("committed"); expect(job.result.cleanup_dismissal.status).toBe("DISMISSED");
    await f.page.reload(); await f.open(); await expect(f.center).not.toContainText("噪声扫描需要重试");
    await shot(f.page, "dismiss-failed-task-1440");
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: ending saved selections can be cancelled; confirmed ending does not clean source", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440, true);
  try {
    expect((await f.context.request.patch(f.url + "/decisions/filter", { headers: f.headers, data: { decision: "DELETE", all_matching: true } })).status()).toBe(200);
    await f.page.reload(); await f.open();
    await f.row.getByRole("button", { name: "忽略本次结果" }).click();
    const confirm = f.page.getByRole("dialog", { name: "结束本次审查？", exact: true });
    await expect(confirm).toContainText("1 项选择");
    await f.page.keyboard.press("Escape");
    expect((await (await f.context.request.get(f.url)).json()).delete_count).toBe(1);
    await f.row.getByRole("button", { name: "忽略本次结果" }).click();
    await confirm.getByRole("button", { name: "结束审查", exact: true }).click();
    await expect(f.row).toHaveCount(0); expect((await f.readSource()).display_text).toBe(f.source);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("768px: expired zero-result tasks do not reappear as a new completed history", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 768);
  try {
    seedTask(f.scan.id, "expired");
    await f.page.reload(); await f.open(); await expect(f.row).toHaveCount(0);
    expect((await f.context.request.get(f.url)).status()).toBe(200);
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("375px: a noise-free import exposes its result without blocking the conversation", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 375);
  try {
    await f.page.goto(baseURL!);
    await f.page.getByTestId("mobile-sidebar-button").click();
    await f.page.getByRole("button", { name: "导入数据", exact: true }).click();
    await f.page.getByTestId("import-file-input").setInputFiles({ name: "synthetic-empty-noise.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      metadata: { title: "Synthetic ordinary import", powered_by: "ChatGPT Exporter" },
      messages: [{ role: "Prompt", say: "Synthetic question", time: "2026-10-07 10:00:00" }, { role: "Response", say: "Synthetic ordinary answer", time: "2026-10-07 10:01:00" }],
    })) });
    await f.page.getByTestId("preview-import-button").click();
    await expect(f.page.getByTestId("commit-import-button")).toBeEnabled();
    await f.page.getByTestId("commit-import-button").click();
    const completed = f.page.getByTestId("import-completion-summary");
    await completed.getByRole("button", { name: "查看结果", exact: true }).click();
    const dialog = f.page.getByTestId("content-cleanup-dialog");
    await expect(dialog.getByText("当前规则未发现噪声候选")).toBeVisible();
    await shot(f.page, "empty-import-375", true);
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await expect(completed).toBeVisible();
    await expect(completed.getByText("本次导入暂无待审查的扫描任务。")).toBeVisible();
    await expect(completed.getByRole("button", { name: "打开对话", exact: true })).toBeEnabled();
  } finally { await f.context.close(); await f.admin.dispose(); }
});

test("1440px: dismissal acknowledgement does not wait for list refresh", async ({ browser, playwright, baseURL }) => {
  const f = await fixture(browser, playwright.request, baseURL!, 1440, true);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route("**/api/content-cleanup/scans/pending", async route => { await held; await route.continue().catch(() => {}); });
    await f.row.getByRole("button", { name: "忽略本次结果" }).click();
    await expect(f.row).toHaveCount(0, { timeout: 3_000 });
    await expect(f.center.getByRole("status").filter({ hasText: "本次审查已结束" })).toBeVisible();
  } finally { release(); await f.context.close(); await f.admin.dispose(); }
});

for (const moveFocus of [false, true]) {
  test(`1440px: dismissal ${moveFocus ? "preserves focus moved to another row" : "returns focus to the adjacent review"}`, async ({ browser, playwright, baseURL }) => {
    const f = await fixture(browser, playwright.request, baseURL!, 1440, true);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      const queued = await f.context.request.post(`${baseURL}/api/content-cleanup/rules/scan-existing`, { headers: { ...f.headers, "Idempotency-Key": crypto.randomUUID() } });
      expect(queued.status()).toBe(202); const next = await queued.json();
      await expect.poll(async () => (await (await f.context.request.get(`${baseURL}/api/content-cleanup/scans/${next.id}`)).json()).status).toBe("READY");
      await f.page.reload(); await f.open();
      const neighbor = f.center.locator(`[data-cleanup-scan-id="${next.id}"]`);
      await expect(neighbor).toBeVisible();
      await f.page.route(`**/api/content-cleanup/scans/${f.scan.id}`, async route => {
        if (route.request().method() !== "DELETE") return route.continue();
        const response = await route.fetch(); expect(response.status()).toBe(204);
        await held; await route.fulfill({ response });
      });
      await f.row.getByRole("button", { name: "忽略本次结果" }).click();
      const target = neighbor.getByRole("button", { name: moveFocus ? "忽略本次结果" : "打开审查" });
      if (moveFocus) await target.focus();
      release(); await expect(f.row).toHaveCount(0);
      await expect(target).toBeFocused();
      expect((await f.readSource()).display_text).toBe(f.source);
    } finally { release(); await f.context.close(); await f.admin.dispose(); }
  });
}
