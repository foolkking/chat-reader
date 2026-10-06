import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";
import { exportFixture } from "./export-retention-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL and a live worker");

async function action(page: Page, width: number, name: RegExp) {
  if (width < 768) {
    await page.getByRole("button", { name: /^(更多|More)$/ }).click();
    await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name }).click();
  } else {
    const button = page.getByRole("button", { name });
    if (!await button.isVisible()) await page.getByRole("button", { name: /^(消息操作|Message actions)$/ }).click();
    await button.click();
  }
}

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: maintenance expiry, regeneration and click-then-close preserve real ZIP`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(160_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width, height: 900 } });
    try {
      await settingsAppearance(context.request, baseURL!, locale);
      expect((await admin.put("/api/admin/features", { data: { export_retention_minutes: 3, export_release_on_close: true } })).status()).toBe(200);
      const create = await admin.post("/api/conversations", { data: { title: "Synthetic temporary export", messages: [{ role: "user", content_markdown: "Synthetic retained source" }, { role: "assistant", content_markdown: "Synthetic export answer" }] } });
      expect(create.status()).toBe(201);
      const id = (await create.json()).conversation.id;
      const page = await context.newPage();
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${baseURL}/conversations/${id}`);
      await action(page, width, /^(接续|Continuation)$/);
      await page.getByRole("button", { name: /^(准备维护|Prepare maintenance)$/ }).click();
      const preparation = page.getByTestId("maintenance-preparation");
      const queued = page.waitForResponse(response => response.url().includes(`/conversations/${id}/exports`) && response.request().method() === "POST");
      await preparation.getByRole("button", { name: /生成导出包|Generate export/ }).click();
      const job = await (await queued).json();
      const download = preparation.getByRole("button", { name: /^(下载上下文包|Download Context Package)$/ });
      await expect(download).toBeEnabled();
      const task = await (await admin.get(`/api/tasks/${job.job_id}`)).json();
      const artifact = task.result.artifact_id;
      expect(exportFixture(artifact).exists).toBe(true);
      expect(task.result.retention_seconds).toBe(180);
      // Changing local time must not shorten the server's deadline.
      await page.clock.setFixedTime(new Date(Date.now() + 86400000));
      await expect(download).toBeEnabled();
      await page.clock.setFixedTime(new Date());
      exportFixture(artifact, true);
      await expect.poll(() => exportFixture(artifact).exists, { timeout: 40_000 }).toBe(false);
      const regenerate = preparation.getByRole("button", { name: /^(重新生成|Generate again)$/ });
      await expect(regenerate).toBeEnabled();
      await expect(preparation.getByRole("link", { name: /下载维护 Skill|Download maintenance Skill/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: /上下文接续|Context continuation/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`expired-${width}-${locale}.png`) });
      const rebuilt = page.waitForResponse(response => response.url().endsWith(`/exports/${artifact}/regenerate`));
      await regenerate.focus(); await page.keyboard.press("Enter");
      const nextJob = await (await rebuilt).json();
      expect(nextJob.job_id).not.toBe(job.job_id);
      await expect(download).toBeEnabled();
      const nextTask = await (await admin.get(`/api/tasks/${nextJob.job_id}`)).json();
      expect(nextTask.result.parent_task_id).toBe(job.job_id);
      const nextArtifact = nextTask.result.artifact_id;
      // Delay a real request (no fake response). The subsequent close must wait
      // for the claimed download before requesting early reclamation.
      let unblock!: () => void;
      const gate = new Promise<void>(resolve => { unblock = resolve; });
      let arrived!: () => void;
      const pending = new Promise<void>(resolve => { arrived = resolve; });
      await page.route(`**/api/exports/${nextArtifact}/download-claims`, async route => { arrived(); await gate; await route.continue(); });
      const downloaded = page.waitForEvent("download");
      await download.click(); await pending;
      await page.getByRole("button", { name: /关闭接续|Close continuation$/ }).click();
      unblock();
      const file = await downloaded;
      expect(await file.failure()).toBeNull();
      const entries = unzipSync(await readFile((await file.path())!));
      expect(strFromU8(entries["conversation.canjsonl"])).toContain("Synthetic retained source");
      await expect.poll(() => exportFixture(nextArtifact).exists, { timeout: 40_000 }).toBe(false);
      expect((await admin.get(`/api/conversations/${id}`)).status()).toBe(200);
      expect(errors).toEqual([]);
    } finally { await context.close(); await admin.dispose(); }
  });
}

test("regeneration survives a polling refresh and a temporary option change", async ({ page, context, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  let releaseState!: () => void, releaseResult!: () => void;
  const stateGate = new Promise<void>(resolve => { releaseState = resolve; });
  const resultGate = new Promise<void>(resolve => { releaseResult = resolve; });
  let stateArrived!: () => void, resultArrived!: () => void;
  const stateReady = new Promise<void>(resolve => { stateArrived = resolve; });
  const resultReady = new Promise<void>(resolve => { resultArrived = resolve; });
  try {
    await context.addCookies((await admin.storageState()).cookies);
    await settingsAppearance(context.request, baseURL!, "en-US");
    await page.setViewportSize({ width: 768, height: 900 });
    const created = await admin.post("/api/conversations", { data: { title: "Synthetic regeneration race", messages: [
      { role: "user", content_markdown: "Synthetic preserved regeneration" },
      { role: "assistant", content_markdown: "Synthetic answer" },
    ] } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).conversation.id;
    await page.goto(`/conversations/${id}`);
    await action(page, 768, /^(接续|Continuation)$/);
    await page.getByRole("button", { name: "Prepare maintenance", exact: true }).click();
    const preparation = page.getByTestId("maintenance-preparation");
    const queued = page.waitForResponse(response => response.url().endsWith(`/conversations/${id}/exports`) && response.request().method() === "POST");
    await preparation.getByRole("button", { name: "Generate export", exact: true }).click();
    const job = await (await queued).json();
    const download = preparation.getByRole("button", { name: "Download Context Package", exact: true });
    await expect(download).toBeEnabled();
    const original = (await (await admin.get(`/api/tasks/${job.job_id}`)).json()).result.artifact_id;
    exportFixture(original, true);
    const regenerate = preparation.getByRole("button", { name: "Generate again", exact: true });
    await expect(regenerate).toBeEnabled();
    let nextId = "";
    await page.route(`**/api/exports/${original}/regenerate`, async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      nextId = (await response.json()).job_id;
      resultArrived(); await resultGate; await route.fulfill({ response });
    });
    await page.route(`**/api/conversations/${id}/continuation`, async route => {
      const response = await route.fetch();
      stateArrived(); await stateGate; await route.fulfill({ response });
    });
    await regenerate.click(); await resultReady; await stateReady;
    await expect(preparation.getByRole("button", { name: "Creating task…", exact: true })).toBeVisible();
    // Changing options hides the old result without closing its owning panel.
    // A late accepted job must keep its original options and still be recoverable.
    const attachments = preparation.getByRole("checkbox", { name: /Include attachments/ });
    await attachments.check();
    const responseArrived = page.waitForResponse(response => response.url().endsWith(`/exports/${original}/regenerate`));
    releaseResult(); await responseArrived;
    releaseState();
    await expect(attachments).toBeChecked();
    await expect(preparation.getByRole("button", { name: "Generate export", exact: true })).toBeEnabled();
    await attachments.uncheck();
    await expect(download).toBeEnabled();
    const next = await (await admin.get(`/api/tasks/${nextId}`)).json();
    expect(next.status).toBe("committed");
    expect(next.result.parent_task_id).toBe(job.job_id);
    const saved = page.waitForEvent("download");
    await download.click();
    const file = await saved;
    expect(await file.failure()).toBeNull();
    expect(strFromU8(unzipSync(await readFile((await file.path())!))["conversation.canjsonl"])).toContain("Synthetic preserved regeneration");
  } finally { releaseState(); releaseResult(); await admin.dispose(); }
});

test("two tabs, refresh and a failed status request retain the last usable export", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(150_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 1440, height: 900 } });
  try {
    const queued = await (await admin.post("/api/me/archive/exports", { data: {}, headers: { "Idempotency-Key": crypto.randomUUID() } })).json();
    await expect.poll(async () => (await (await admin.get(`/api/tasks/${queued.job_id}`)).json()).status).toBe("committed");
    const task = await (await admin.get(`/api/tasks/${queued.job_id}`)).json();
    const artifact = task.result.artifact_id;
    const pages = [await context.newPage(), await context.newPage()];
    for (const page of pages) {
      await page.goto(baseURL!);
      await page.getByTestId("sidebar-tasks-button").click();
      await expect(page.locator("[data-task-row]").filter({ has: page.getByTestId(`task-dismiss-${queued.job_id}`) }).getByTestId("task-result-download")).toBeEnabled();
    }
    expect(exportFixture(artifact).viewers).toBeGreaterThanOrEqual(2);
    await pages[0].getByTestId("task-center-panel").getByRole("button", { name: /^(关闭|Close)$/ }).click();
    expect(exportFixture(artifact).exists).toBe(true);
    await pages[1].reload();
    await pages[1].getByTestId("sidebar-tasks-button").click();
    const delivery = pages[1].locator("[data-task-row]").filter({ has: pages[1].getByTestId(`task-dismiss-${queued.job_id}`) });
    await expect(delivery.getByTestId("task-result-download")).toBeEnabled();
    await pages[1].route(`**/api/exports/${artifact}/usage`, route => route.abort("failed"));
    await expect(delivery.getByRole("button", { name: /下载状态暂不可用|Download status unavailable/ })).toBeVisible({ timeout: 30_000 });
    expect(exportFixture(artifact).exists).toBe(true);
    await pages[1].unroute(`**/api/exports/${artifact}/usage`);
    await delivery.getByRole("button", { name: /下载状态暂不可用|Download status unavailable/ }).click();
    await expect(delivery.getByTestId("task-result-download")).toBeEnabled();
    await pages[1].getByTestId("task-center-panel").getByRole("button", { name: /^(关闭|Close)$/ }).click();
    // A viewer from the document that reloaded is allowed to time out naturally.
    await expect.poll(() => exportFixture(artifact).exists, { timeout: 65_000 }).toBe(false);
  } finally { await context.close(); await admin.dispose(); }
});

for (const width of [375, 1440]) test(`${width}px: closing the regular export panel reclaims only its delivery file`, async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width, height: 900 } });
  try {
    const response = await admin.post("/api/conversations", { data: { title: "Synthetic regular export", messages: [{ role: "user", content_markdown: "Canonical content stays" }, { role: "assistant", content_markdown: "Only delivery expires" }] } });
    expect(response.status()).toBe(201);
    const id = (await response.json()).conversation.id;
    const page = await context.newPage(); await page.goto(`${baseURL}/conversations/${id}`);
    await action(page, width, /^(导出|Export)$/);
    const queued = page.waitForResponse(response => response.url().includes(`/conversations/${id}/exports`) && response.request().method() === "POST");
    await page.getByRole("button", { name: /生成导出包|Generate export/ }).click();
    const taskId = (await (await queued).json()).job_id;
    await expect(page.getByRole("button", { name: /^(下载上下文包|Download Context Package)$/ })).toBeEnabled();
    const task = await (await admin.get(`/api/tasks/${taskId}`)).json();
    const artifact = task.result.artifact_id;
    // Ordinary layout updates are not a close signal.
    await page.setViewportSize({ width: width + 10, height: 860 });
    expect(exportFixture(artifact).exists).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("export-artifact-delivery")).toHaveCount(0);
    await expect.poll(() => exportFixture(artifact).exists, { timeout: 40_000 }).toBe(false);
    await action(page, width, /^(导出|Export)$/);
    await expect(page.getByRole("button", { name: /^(重新生成|Generate again)$/ })).toBeEnabled();
    expect((await admin.get(`/api/conversations/${id}`)).status()).toBe(200);
  } finally { await context.close(); await admin.dispose(); }
});

test("closing Tasks while regeneration is pending leaves the accepted job running without reopening", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 1440, height: 900 } });
  try {
    const queued = await (await admin.post("/api/me/archive/exports", { data: {}, headers: { "Idempotency-Key": crypto.randomUUID() } })).json();
    await expect.poll(async () => (await (await admin.get(`/api/tasks/${queued.job_id}`)).json()).status).toBe("committed");
    const task = await (await admin.get(`/api/tasks/${queued.job_id}`)).json();
    const artifact = task.result.artifact_id;
    exportFixture(artifact, true);
    const page = await context.newPage(); await page.goto(baseURL!);
    await page.getByTestId("sidebar-tasks-button").click();
    const row = page.locator("[data-task-row]").filter({ has: page.getByTestId(`task-dismiss-${queued.job_id}`) });
    let unblock!: () => void, arrived!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const pending = new Promise<void>(resolve => { arrived = resolve; });
    await page.route(`**/api/exports/${artifact}/regenerate`, async route => { arrived(); await gate; await route.continue(); });
    const result = page.waitForResponse(response => response.url().endsWith(`/exports/${artifact}/regenerate`));
    await row.getByRole("button", { name: /^(重新生成|Generate again)$/ }).click();
    await pending;
    await page.getByTestId("task-center-panel").getByRole("button", { name: /^(关闭|Close)$/ }).click();
    unblock();
    const next = await (await result).json();
    await expect.poll(async () => (await (await admin.get(`/api/tasks/${next.job_id}`)).json()).status).toBe("committed");
    await expect(page.getByTestId("task-center-panel")).toHaveCount(0);
  } finally { await context.close(); await admin.dispose(); }
});

test("legacy live exports retain their deadline and download without a fabricated retention duration", async ({ browser, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ storageState: await admin.storageState() });
  try {
    const queued = await (await admin.post("/api/me/archive/exports", { data: {}, headers: { "Idempotency-Key": crypto.randomUUID() } })).json();
    await expect.poll(async () => (await (await admin.get(`/api/tasks/${queued.job_id}`)).json()).status).toBe("committed");
    const task = await (await admin.get(`/api/tasks/${queued.job_id}`)).json();
    const artifact = task.result.artifact_id;
    const original = await (await admin.get(`/api/exports/${artifact}`)).json();
    exportFixture(artifact, false, true);
    const legacy = await (await admin.get(`/api/exports/${artifact}`)).json();
    expect(legacy.retention_seconds).toBeNull();
    expect(legacy.expires_at).toBe(original.expires_at);
    const page = await context.newPage(); await page.goto(baseURL!);
    await page.getByTestId("sidebar-tasks-button").click();
    const row = page.locator("[data-task-row]").filter({ has: page.getByTestId(`task-dismiss-${queued.job_id}`) });
    await expect(row.getByTestId("export-artifact-delivery").getByRole("status")).toContainText(/到期后可重新生成|Generate it again after expiry/);
    await expect(row).not.toContainText(/0 分钟|0 minutes/);
    const pending = page.waitForEvent("download");
    await row.getByTestId("task-result-download").click();
    const downloaded = await pending;
    expect(await downloaded.failure()).toBeNull();
    expect(Object.keys(unzipSync(await readFile((await downloaded.path())!))).length).toBeGreaterThan(0);
    exportFixture(artifact, true);
    await expect.poll(() => exportFixture(artifact).exists, { timeout: 40_000 }).toBe(false);
  } finally { await context.close(); await admin.dispose(); }
});
