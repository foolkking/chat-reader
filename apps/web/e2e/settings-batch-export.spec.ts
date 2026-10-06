import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";
import { exportFixture } from "./export-retention-helper";

test.use({ trace: "off", actionTimeout: 20_000, extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL and worker");

async function sources(request: APIRequestContext, project: boolean) {
  let projectId: string | undefined;
  if (project) {
    const response = await request.post("/api/projects", { data: { name: `Synthetic batch ${crypto.randomUUID()}` } });
    expect(response.status()).toBe(201);
    projectId = (await response.json()).id;
  }
  const items: Array<{ id: string; title: string }> = [];
  for (let i = 0; i < 3; i++) {
    const title = `合成批量 Synthetic ${crypto.randomUUID().slice(0, 8)}-${i}`;
    const response = await request.post("/api/conversations", { data: { title, messages: [
      { role: "user", content_markdown: `Synthetic batch question ${i}` },
      { role: "assistant", content_markdown: `Synthetic batch answer ${i}` },
    ] } });
    expect(response.status()).toBe(201);
    const id = (await response.json()).conversation.id;
    items.push({ id, title });
    const moved = projectId
      ? await request.post(`/api/projects/${projectId}/conversations/${id}`)
      : await request.post(`/api/conversations/${id}/archive`);
    expect(moved.ok()).toBe(true);
  }
  return { items, path: projectId ? `/projects/${projectId}` : "/archived" };
}

test("late batch submission cannot open or populate another account's tasks", async ({ page, context, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void;
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  let done!: () => void;
  const finished = new Promise<void>(resolve => { done = resolve; });
  try {
    const password = "Synthetic-batch-account-passphrase";
    const email = `batch-${crypto.randomUUID()}@example.test`;
    expect((await context.request.post("/api/auth/register", { data: { email, password, confirm_password: password } })).status()).toBe(201);
    expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
    await settingsAppearance(context.request, baseURL!, "en-US");
    const data = await sources(context.request, true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await select(page, data);
    let jobId = "";
    await page.route("**/api/conversations/batch-export", async route => {
      try {
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        jobId = (await response.json()).job_id;
        arrived(); await gate;
        await route.fulfill({ response });
      } finally { done(); }
    });
    await page.getByTestId("selection-toolbar").getByRole("button", { name: "Export", exact: true }).click();
    await ready;
    expect((await context.request.post("/api/auth/logout")).status()).toBe(204);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("#login-password")).toBeVisible();
    const other = `batch-other-${crypto.randomUUID()}@example.test`;
    expect((await context.request.post("/api/auth/register", { data: { email: other, password, confirm_password: password } })).status()).toBe(201);
    expect((await context.request.post("/api/auth/login", { data: { email: other, password } })).status()).toBe(200);
    await page.goto("/");
    await expect(page.getByTestId("sidebar-tasks-button")).toBeVisible();
    release(); await finished;
    expect((await context.request.get(`/api/tasks/${jobId}`)).status()).toBe(404);
    await expect(page.getByTestId("task-center-panel")).toHaveCount(0);
    await page.getByTestId("sidebar-tasks-button").click();
    await expect(page.locator('[data-task-row="conversation_batch_export"]')).toHaveCount(0);
  } finally { release(); await admin.dispose(); }
});

async function select(page: Page, data: Awaited<ReturnType<typeof sources>>) {
  await page.goto(data.path);
  await page.getByRole("button", { name: /^(Manage conversations|批量操作)$/ }).click();
  for (const item of data.items) await page.getByRole("checkbox", { name: new RegExp(`^(选择|Select) ${item.title}$`) }).check();
}

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: batch export recovers lost response and downloads after refresh`, async ({ page, context, playwright, baseURL }, info) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    try {
      await context.addCookies((await admin.storageState()).cookies);
      await settingsAppearance(context.request, baseURL!, locale);
      await page.setViewportSize({ width, height: 900 });
      const data = await sources(context.request, locale === "en-US");
      await select(page, data);
      const faults: string[] = []; page.on("pageerror", error => faults.push(error.message));
      const keys: string[] = [];
      let jobId = "", order: string[] = [];
      await page.route("**/api/conversations/batch-export", async route => {
        keys.push(route.request().headers()["idempotency-key"]);
        order = route.request().postDataJSON().conversation_ids;
        if (keys.length === 1) {
          await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Synthetic unavailable"}' });
        } else if (keys.length === 2) {
          const real = await route.fetch();
          expect(real.status()).toBe(202);
          jobId = (await real.json()).job_id;
          await route.abort("failed");
        } else await route.continue();
      });
      const exportButton = page.getByTestId("selection-toolbar").getByRole("button", { name: /^(导出|Export)$/ });
      for (let attempt = 0; attempt < 2; attempt++) {
        await exportButton.click();
        await expect(page.getByRole("alert").filter({ hasText: /未确认提交结果|Submission was not confirmed/ })).toBeVisible();
        for (const item of data.items) await expect(page.getByRole("checkbox", { name: new RegExp(`^(选择|Select) ${item.title}$`) })).toBeChecked();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`batch-retry-${width}-${locale}.png`) });
      const submitted = page.waitForResponse(response => response.url().endsWith("/api/conversations/batch-export") && response.status() === 202);
      await exportButton.focus(); await page.keyboard.press("Enter");
      expect((await (await submitted).json()).job_id).toBe(jobId);
      expect(new Set(keys).size).toBe(1);
      await expect(page.getByTestId("task-center-panel")).toBeVisible();
      await page.reload();
      if (width < 768) await page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ }).click();
      await page.locator('[data-testid="sidebar-tasks-button"]:visible').click();
      const center = page.getByTestId("task-center-panel");
      await expect.poll(async () => (await (await admin.get(`/api/tasks/${jobId}`)).json()).status).toBe("committed");
      const row = center.locator('[data-task-row="conversation_batch_export"]').filter({ has: page.getByTestId(`task-dismiss-${jobId}`) });
      const download = row.getByRole("button", { name: /^(下载结果|Download result)$/ });
      await expect(download).toBeEnabled();
      await expect(row).toContainText(locale === "zh-CN" ? "批量导出对话" : "Export conversations");
      await expect(row).toContainText("CanJSON ZIP");
      for (const id of order.slice(0, 2)) await expect(row).toContainText(data.items.find(item => item.id === id)!.title);
      await expect(row.locator("time")).toHaveCount(1);
      await expect(row.getByRole("progressbar")).toHaveCount(0);
      const saved = page.waitForEvent("download");
      await download.focus(); await page.keyboard.press("Enter");
      const file = await saved;
      expect(await file.failure()).toBeNull();
      expect(file.suggestedFilename()).toMatch(/^chat-reader-export-.*\.zip$/);
      const entries = unzipSync(await readFile((await file.path())!));
      expect(Object.keys(entries)).toHaveLength(3);
      order.forEach((id, index) => {
        const item = data.items.find(value => value.id === id)!;
        const name = `${String(index + 1).padStart(3, "0")}-${item.title}.canonical.jsonl`;
        const text = strFromU8(entries[name]);
        expect(text).toContain(`Synthetic batch question ${data.items.indexOf(item)}`);
        const records = text.trim().split("\n").map(line => JSON.parse(line));
        expect(records.filter(value => value.record_type === "message")).toHaveLength(2);
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`batch-download-${width}-${locale}.png`) });
      if (width === 1440 && locale === "en-US") {
        const job = await (await admin.get(`/api/tasks/${jobId}`)).json();
        exportFixture(job.result.artifact_id, true);
        await expect.poll(() => exportFixture(job.result.artifact_id).exists, { timeout: 40_000 }).toBe(false);
        const regenerate = row.getByRole("button", { name: "Generate again", exact: true });
        await expect(regenerate).toBeEnabled();
        const renewed = page.waitForResponse(response => response.url().endsWith(`/exports/${job.result.artifact_id}/regenerate`));
        await regenerate.click();
        const next = await (await renewed).json();
        expect(next.job_id).not.toBe(jobId);
        await expect.poll(async () => (await (await admin.get(`/api/tasks/${next.job_id}`)).json()).status).toBe("committed");
      }
      expect(faults).toEqual([]);
    } finally { await admin.dispose(); }
  });
}
