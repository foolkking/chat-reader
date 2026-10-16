import { expect, test, type Page } from "@playwright/test";
import type { BackgroundTaskRead, ConversationCreateResponse } from "../lib/types";

test.use({ serviceWorkers: "block", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_MUTATION_FLOW !== "1", "Requires the isolated mutation API fixture");
const endpoint = "/api/conversations/batch-delete";
type Sent = { key: string; ids: string[] };

for (const [width, zh] of [[375, true], [1440, false]] as const) {
  test(`${width}px: unknown deletion preserves selection and retries only the original request after a read-only check`, async ({ page }) => {
    const sources = await prepare(page, width, zh);
    const sent: Sent[] = [];
    let checks = 0;
    try {
      await page.route(url => url.pathname === endpoint, async route => {
        if (route.request().method() !== "POST") return route.continue();
        sent.push({ key: route.request().headers()["idempotency-key"]!, ids: route.request().postDataJSON().conversation_ids });
        if (sent.length === 1) await route.abort("connectionfailed");
        else await route.fulfill({ json: task("queued") });
      });
      await page.route(url => url.pathname.startsWith(endpoint + "/requests/"), async route => {
        expect(route.request().method()).toBe("GET");
        expect(decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!)).toBe(sent[0]!.key);
        checks += 1;
        if (checks === 1) await route.fulfill({ status: 503, json: { detail: "Synthetic raw upstream error" } });
        else await route.fulfill({ json: { found: false, task: null } });
      });
      await page.goto("/");
      const first = selection(page, sources[0]!, zh);
      await first.check();
      await page.getByRole("button", { name: zh ? "删除所选" : "Delete selected", exact: true }).click();
      await confirm(page, zh);
      const recovery = page.getByRole("region", { name: zh ? "删除请求恢复" : "Deletion request recovery", exact: true });
      await expect(recovery).toBeVisible();
      await expect(first).toBeChecked();
      await expect(recovery.getByRole("button", { name: zh ? "使用原请求重试" : "Retry original request", exact: true })).toHaveCount(0);
      expect(sent).toEqual([{ key: expect.any(String), ids: [sources[0]!.conversation.id] }]);
      const check = recovery.getByRole("button", { name: zh ? "核对删除结果" : "Check deletion request", exact: true });
      await check.click();
      await expect(recovery).toContainText(zh ? "不代表任务不存在" : "does not mean it is missing");
      await expect(recovery).not.toContainText("Synthetic raw upstream error");
      expect(sent).toHaveLength(1);
      await first.uncheck();
      await selection(page, sources[1]!, zh).check();
      await check.click();
      await recovery.getByRole("button", { name: zh ? "使用原请求重试" : "Retry original request", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(zh ? "不使用当前选择" : "not your current selection");
      await dialog.getByRole("button", { name: zh ? "重试原请求" : "Retry original request", exact: true }).click();
      await expect(recovery).toContainText(zh ? "已找到原删除任务" : "Original deletion task found");
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      await expect(selection(page, sources[1]!, zh)).toBeChecked();
    } finally { await cleanup(page, sources); }
  });

  for (const status of ["failed", "cancelled"] as const) {
    test(`${width}px: retained ${status} task is found without automatically reopening deletion`, async ({ page }) => {
      const sources = await prepare(page, width, zh);
      let submissions = 0, checks = 0;
      try {
        await page.route(url => url.pathname === endpoint, async route => {
          if (route.request().method() !== "POST") return route.continue();
          submissions += 1;
          await route.abort("connectionfailed");
        });
        await page.route(url => url.pathname.startsWith(endpoint + "/requests/"), async route => {
          expect(route.request().method()).toBe("GET");
          checks += 1;
          await route.fulfill({ json: { found: true, task: task(status) } });
        });
        await page.goto("/");
        await selection(page, sources[0]!, zh).check();
        await page.getByRole("button", { name: zh ? "删除所选" : "Delete selected", exact: true }).click();
        await confirm(page, zh);
        const recovery = page.getByRole("region", { name: zh ? "删除请求恢复" : "Deletion request recovery", exact: true });
        await recovery.getByRole("button", { name: zh ? "核对删除结果" : "Check deletion request", exact: true }).click();
        await expect(recovery).toContainText(zh ? "没有自动重新启动" : "not automatically restarted");
        await expect(recovery.getByRole("button", { name: zh ? "使用原请求重试" : "Retry original request", exact: true })).toHaveCount(0);
        expect(submissions).toBe(1);
        expect(checks).toBe(1);
      } finally { await cleanup(page, sources); }
    });
  }

  test(`${width}px: closing a row menu and changing private routes retains one minimized deletion request`, async ({ page }) => {
    const sources = await prepare(page, width, zh);
    let submissions = 0;
    try {
      await page.route(url => url.pathname === endpoint, async route => {
        if (route.request().method() !== "POST") return route.continue();
        submissions += 1;
        await route.abort("connectionfailed");
      });
      await page.goto("/");
      const source = sources[0]!;
      const row = page.getByTestId(`conversation-sortable-row-${source.conversation.id}`);
      await row.getByRole("button", { name: `${zh ? "管理" : "Manage"} ${source.conversation.title}`, exact: true }).click();
      await page.getByRole("menuitem", { name: zh ? "永久删除对话" : "Delete permanently", exact: true }).click();
      await confirm(page, zh);
      const recovery = page.getByRole("region", { name: zh ? "删除请求恢复" : "Deletion request recovery", exact: true });
      await expect(recovery).toBeVisible();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await recovery.getByRole("button", { name: zh ? "收起" : "Minimize", exact: true }).click();
      await row.locator(`a[href="/conversations/${source.conversation.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/conversations/${source.conversation.id}$`));
      await expect(page.getByTestId("reader-scroll-root")).toBeVisible();
      await recovery.getByRole("button", { name: zh ? "查看未确认的删除请求" : "Review unconfirmed deletion", exact: true }).click();
      await expect(recovery).toContainText(zh ? "服务器可能已受理" : "may have accepted");
      await expect(recovery.getByRole("button", { name: zh ? "核对删除结果" : "Check deletion request", exact: true })).toBeVisible();
      expect(submissions).toBe(1);
    } finally { await cleanup(page, sources); }
  });
}

async function prepare(page: Page, width: number, zh: boolean) {
  await page.setViewportSize({ width, height: 900 });
  expect((await page.request.patch("/api/preferences", { data: {
    locale_mode: zh ? "zh-CN" : "en-US", theme_mode: zh ? "light" : "dark",
  } })).ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem("chat-reader:offline-guide-dismissed", "true"));
  const sources: ConversationCreateResponse[] = [];
  for (const suffix of ["first", "second"]) {
    const response = await page.request.post("/api/conversations", { data: {
      title: `Synthetic deletion recovery ${width} ${suffix}`,
      messages: [
        { role: "user", content_markdown: "Synthetic deletion question" },
        { role: "assistant", content_markdown: "Synthetic deletion answer" },
      ],
    } });
    expect(response.status()).toBe(201);
    sources.push(await response.json() as ConversationCreateResponse);
  }
  return sources;
}

function selection(page: Page, source: ConversationCreateResponse, zh: boolean) {
  return page.getByRole("checkbox", { name: `${zh ? "选择" : "Select"} ${source.conversation.title}`, exact: true });
}
async function confirm(page: Page, zh: boolean) {
  await page.getByRole("dialog").getByRole("button", { name: zh ? "永久删除" : "Delete permanently", exact: true }).click();
}
async function cleanup(page: Page, sources: ConversationCreateResponse[]) {
  await page.unrouteAll({ behavior: "wait" });
  for (const source of sources) expect((await page.request.delete(`/api/conversations/${source.conversation.id}`)).ok()).toBe(true);
}
function task(status: "queued" | "failed" | "cancelled"): BackgroundTaskRead {
  return {
    job_id: "9d512440-ea7a-42c6-9c84-5811d1caaf30", job_type: "conversation_batch_delete",
    status, phase: status, progress: 0, processed_items: 0, total_items: 1,
    label: "Synthetic deletion task", result: {}, error_message: null, queued_at: new Date().toISOString(),
    started_at: null, heartbeat_at: null, completed_at: status === "queued" ? null : new Date().toISOString(),
    cancellable: status === "queued", attempt_count: 0,
  };
}
