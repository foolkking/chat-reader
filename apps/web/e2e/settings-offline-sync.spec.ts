import { expect, test, type Page } from "@playwright/test";
import { readLocal } from "./settings-offline-helper";
import { settingsAdmin } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000, viewport: { width: 1440, height: 900 }, locale: "en-US" });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, auth and worker fixture");

async function editTitle(page: Page, title: string) {
  await page.getByRole("textbox", { name: "Notebook title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Notebook title", exact: true }).press("Tab");
}

for (const scenario of ["new edit during snapshot", "snapshot failure after server commit", "account disabled while offline"] as const) {
  test(scenario, async ({ page, context, playwright, baseURL }) => {
    test.setTimeout(100_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const headers = { Origin: baseURL! }, password = "synthetic offline sync passphrase", email = `sync-${Date.now()}@example.test`;
    let release: (() => void) | undefined;
    try {
      const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email, password, confirm_password: password } });
      expect(registered.status()).toBe(201);
      const userId = (await registered.json()).user_id;
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic sync library", messages: [
        { role: "user", content_markdown: "Synthetic sync question" }, { role: "assistant", content_markdown: "Synthetic sync answer" },
      ] } });
      expect(created.status()).toBe(201);
      const conversationId = (await created.json()).conversation.id;
      await page.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
      await page.getByRole("button", { name: /Download offline copy|下载离线副本/, exact: true }).click();
      await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(1);
      await expect(page.getByText("Synthetic sync answer", { exact: true }).first()).toBeVisible();
      await context.setOffline(true);
      await page.getByRole("button", { name: /Notes|精选笔记/, exact: true }).click();
      await editTitle(page, "Synthetic first draft");
      await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(1);
      const before = await readLocal(page, userId);
      expect(before.notebooks[0].title).toBe("Synthetic first draft");

      await page.getByRole("button", { name: /Delete offline copy|删除本地副本/, exact: true }).click();
      await expect(page.getByText(/unsynced changes remain|项未同步修改/)).toBeVisible();
      expect(await readLocal(page, userId)).toEqual(before);

      if (scenario === "new edit during snapshot") {
        let captured = false;
        const barrier = new Promise<void>((resolve) => { release = resolve; });
        await page.route(`**/api/conversations/${conversationId}/notebook`, async (route) => {
          // Read the actual committed PostgreSQL result, then delay delivery.
          const response = await route.fetch();
          captured = true;
          await barrier;
          await route.fulfill({ response });
        });
        await context.setOffline(false);
        await expect.poll(() => captured).toBe(true);
        await editTitle(page, "Synthetic newer local draft");
        await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(2);
        await context.setOffline(true);
        release!();
        await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(1);
        expect((await readLocal(page, userId)).notebooks[0].title).toBe("Synthetic newer local draft");
        await page.unroute(`**/api/conversations/${conversationId}/notebook`);
        await context.setOffline(false);
        await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(0);
        const saved = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
        expect(saved.title).toBe("Synthetic newer local draft");
        expect(saved.revision).toBe(2);
      } else if (scenario === "snapshot failure after server commit") {
        let failSnapshot = true;
        const receipts: Array<{ status: string; operation_id: string }> = [];
        await page.route("**/api/annotations/sync", async (route) => {
          const response = await route.fetch();
          receipts.push(...(await response.json()).results);
          await route.fulfill({ response });
        });
        await page.route(`**/api/conversations/${conversationId}/notebook`, (route) => failSnapshot ? route.abort("failed") : route.continue());
        await context.setOffline(false);
        await expect.poll(() => receipts.length).toBeGreaterThan(0);
        await expect.poll(async () => ((await readLocal(page, userId)).outbox[0] as { last_error?: string })?.last_error).toBe("NETWORK");
        expect((await readLocal(page, userId)).outbox).toHaveLength(1);
        expect((await readLocal(page, userId)).notebooks[0].title).toBe("Synthetic first draft");
        await page.getByRole("button", { name: /^(Settings|设置)$/ }).click();
        await page.getByRole("button", { name: /Offline & sync|离线与同步/ }).click();
        const center = page.getByRole("dialog", { name: /Offline & sync|离线与同步/ });
        await center.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ }).click();
        await expect(center.getByRole("heading", { name: /Sync failures|同步失败/ })).toBeVisible();
        failSnapshot = false;
        await center.getByRole("button", { name: /Retry sync|重试同步/ }).click();
        await expect.poll(async () => (await readLocal(page, userId)).outbox.length, { timeout: 10_000 }).toBe(0);
        expect(receipts[0].status).toBe("applied");
        expect(receipts.slice(1).length).toBeGreaterThan(0);
        expect(receipts.slice(1).every((item) => item.status === "duplicate")).toBe(true);
        expect(new Set(receipts.map((item) => item.operation_id)).size).toBe(1);
        const saved = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
        expect(saved.title).toBe("Synthetic first draft");
        expect(saved.revision).toBe(1);
      } else {
        expect((await admin.patch(`/api/admin/access/users/${userId}/status`, { data: { status: "DISABLED" } })).status()).toBe(200);
        await context.setOffline(false);
        await expect(page.locator("#login-password")).toBeVisible();
        expect(await readLocal(page, userId)).toEqual(before);
        await context.setOffline(true);
        await page.goto(`${baseURL}/library`);
        await expect(page.getByRole("heading", { name: /Sign in required|需要重新登录/ })).toBeVisible();
        expect((await readLocal(page, userId)).outbox).toEqual(before.outbox);
        await context.setOffline(false);
        expect((await admin.patch(`/api/admin/access/users/${userId}/status`, { data: { status: "ACTIVE" } })).status()).toBe(200);
        expect((await context.request.post(`${baseURL}/api/auth/login`, { headers, data: { email, password } })).status()).toBe(200);
        await page.goto(`${baseURL}/library?conversationId=${conversationId}`);
        await expect(page.getByText("Synthetic sync answer", { exact: true }).first()).toBeVisible();
        await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(0);
        expect((await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json()).title).toBe("Synthetic first draft");
      }
    } finally { release?.(); await admin.dispose(); }
  });
}
