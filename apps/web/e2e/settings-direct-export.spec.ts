import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000, extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL");

async function openExport(page: Page, width: number) {
  await expect(page.locator("article[data-message-id]").first()).toBeVisible();
  if (width < 768) {
    await page.getByRole("button", { name: /^(更多|More)$/ }).click();
    await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name: /^(导出|Export)$/ }).click();
  } else {
    await page.getByRole("button", { name: /^(消息操作|Message actions)$/ }).click();
    await page.getByRole("button", { name: /^(导出|Export)$/ }).click();
  }
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
}

// Hold actual prepared bytes, so cancellation exercises late delivery rather
// than a made-up successful export. Always release the route in a finally block.
async function holdExport(page: Page, pattern: string) {
  let release!: () => void, arrived!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  let count = 0;
  const handler = async (route: Route) => {
    count += 1;
    try {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      arrived();
      await gate;
      await route.fulfill({ response });
    } finally { finished(); }
  };
  await page.route(pattern, handler);
  return { ready, done, release, count: () => count, remove: () => page.unroute(pattern, handler) };
}

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: direct downloads retain Reader, retry and cancel`, async ({ page, context, playwright, baseURL }, info) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    try {
      await context.addCookies((await admin.storageState()).cookies);
      await page.setViewportSize({ width, height: width < 768 ? 740 : 1000 });
      await settingsAppearance(context.request, baseURL!, locale);
      const created = await context.request.post("/api/conversations", { data: {
        title: "合成下载 Synthetic", messages: [
          { role: "user", content_markdown: "Synthetic export question 中文" },
          { role: "assistant", content_markdown: "Synthetic export answer" },
        ],
      } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id;
      await page.goto(`/conversations/${id}`);
      await openExport(page, width);
      const sourceURL = page.url();
      const panel = page.getByTestId("direct-export-download");
      const pattern = `**/api/conversations/${id}/exports/markdown?*`;
      const faults: string[] = []; page.on("pageerror", error => faults.push(error.message));
      const failed = (route: Route) => locale === "zh-CN"
        ? route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Synthetic storage unavailable"}' })
        : route.abort("failed");
      await page.route(pattern, failed);
      await panel.getByRole("button", { name: /下载文件|Download file/ }).click();
      await expect(panel.getByRole("alert")).toContainText(/暂时无法准备下载|Download failed/);
      expect(page.url()).toBe(sourceURL);
      await expect(page.locator("article[data-message-id]").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`download-retry-${width}-${locale}.png`) });
      await page.unroute(pattern, failed);

      const held = await holdExport(page, pattern);
      try {
        await panel.getByRole("button", { name: /重试下载|Retry download/ }).click();
        await held.ready;
        const pending = panel.getByRole("button", { name: /正在准备下载|Preparing download/ });
        await expect(pending).toBeDisabled();
        await pending.evaluate((button: HTMLButtonElement) => button.click());
        expect(held.count()).toBe(1);
        await expect(panel.getByRole("button", { name: /^(取消|Cancel)$/ })).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: info.outputPath(`download-pending-${width}-${locale}.png`) });
        const downloads: string[] = []; page.on("download", file => downloads.push(file.suggestedFilename()));
        await panel.getByRole("button", { name: /^(取消|Cancel)$/ }).click();
        await expect(panel.getByRole("button", { name: /下载文件|Download file/ })).toBeEnabled();
        held.release(); await held.done; await held.remove();
        for (const format of ["Markdown", "CanJSON"]) {
          await page.getByRole("button", { name: format, exact: true }).click();
          const saved = page.waitForEvent("download");
          const download = panel.getByRole("button", { name: /下载文件|Download file/ });
          await download.focus(); await page.keyboard.press("Enter");
          const file = await saved;
          expect(await file.failure()).toBeNull();
          expect(file.suggestedFilename()).toContain("合成下载");
          expect(file.suggestedFilename()).toMatch(format === "Markdown" ? /\.md$/ : /\.canonical\.jsonl$/);
          const content = await readFile((await file.path())!, "utf8");
          expect(content).toContain("Synthetic export question 中文");
          expect(content).toContain("Synthetic export answer");
          if (format === "CanJSON") {
            const records = content.trim().split("\n").map(line => JSON.parse(line));
            expect(records.filter(row => row.record_type === "message")).toHaveLength(2);
          }
          await expect(panel.getByRole("status")).toContainText(/下载已交给浏览器|Download sent to your browser/);
          expect(page.url()).toBe(sourceURL);
        }
        expect(downloads).toHaveLength(2);
        expect(faults).toEqual([]);
      } finally { held.release(); await held.remove(); }
    } finally { await admin.dispose(); }
  });
}

for (const change of ["format", "options", "close"]) {
  test(`late download is discarded after ${change} changes`, async ({ page, context, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    try {
      await context.addCookies((await admin.storageState()).cookies);
      await page.setViewportSize({ width: 1440, height: 1000 });
      const created = await context.request.post("/api/conversations", { data: { title: "Synthetic cancelled export", messages: [{ role: "user", content_markdown: "Synthetic previous options" }, { role: "assistant", content_markdown: "Synthetic response" }] } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id;
      await page.goto(`/conversations/${id}`); await openExport(page, 1440);
      const held = await holdExport(page, `**/api/conversations/${id}/exports/markdown?*`);
      try {
        const files: string[] = []; page.on("download", file => files.push(file.suggestedFilename()));
        await page.getByTestId("direct-export-download").getByRole("button", { name: /下载文件|Download file/ }).click();
        await held.ready;
        if (change === "format") await page.getByRole("button", { name: "CanJSON", exact: true }).click();
        else if (change === "options") {
          await page.getByText(/^(更多内容选项|More content options)$/).click();
          await page.getByRole("checkbox", { name: /包含对话简介|Include conversation description/ }).check();
        } else {
          await page.getByRole("dialog", { name: /^(导出|Export)$/ }).getByRole("button", { name: /^(关闭|Close)$/ }).click();
          await openExport(page, 1440);
        }
        held.release(); await held.done; await held.remove();
        const saved = page.waitForEvent("download");
        await page.getByTestId("direct-export-download").getByRole("button", { name: /下载文件|Download file/ }).click();
        expect(await (await saved).failure()).toBeNull();
        expect(files).toHaveLength(1);
      } finally { held.release(); await held.remove(); }
    } finally { await admin.dispose(); }
  });
}

test("a revoked account cannot receive previously prepared bytes", async ({ page, context, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  try {
    const email = `direct-export-${crypto.randomUUID()}@example.test`;
    const password = "Synthetic-revoked-download-passphrase";
    expect((await context.request.post("/api/auth/register", { data: { email, password, confirm_password: password } })).status()).toBe(201);
    expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
    const created = await context.request.post("/api/conversations", { data: { title: "Synthetic private download", messages: [{ role: "user", content_markdown: "Synthetic account-only data" }, { role: "assistant", content_markdown: "Synthetic private response" }] } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).conversation.id;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/conversations/${id}`); await openExport(page, 1440);
    const held = await holdExport(page, `**/api/conversations/${id}/exports/markdown?*`);
    try {
      const files: string[] = []; page.on("download", file => files.push(file.suggestedFilename()));
      await page.getByTestId("direct-export-download").getByRole("button", { name: /下载文件|Download file/ }).click();
      await held.ready;
      expect((await context.request.post("/api/auth/logout")).status()).toBe(204);
      // Focus causes a real server session recheck, with no fabricated auth result.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator("#login-password")).toBeVisible();
      expect((await context.request.get(`/api/conversations/${id}/exports/markdown`)).status()).toBe(401);
      const otherEmail = `direct-other-${crypto.randomUUID()}@example.test`;
      expect((await context.request.post("/api/auth/register", { data: { email: otherEmail, password, confirm_password: password } })).status()).toBe(201);
      expect((await context.request.post("/api/auth/login", { data: { email: otherEmail, password } })).status()).toBe(200);
      await page.goto("/");
      await expect(page.getByTestId("sidebar-tasks-button")).toBeVisible();
      held.release(); await held.done;
      expect((await context.request.get(`/api/conversations/${id}/exports/markdown`)).status()).toBe(404);
      expect(files).toEqual([]);
    } finally { held.release(); await held.remove(); }
  } finally { await admin.dispose(); }
});
