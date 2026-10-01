import { expect, test, type Page } from "@playwright/test";
import { readLocal } from "./settings-offline-helper";
import { settingsAdmin } from "./settings-test-helper";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, auth and worker");

async function markers(page: Page, userId: string, prefix = "sync-conflict:") {
  return page.evaluate(async ({ id, prefix }) => {
    const namespace = Array.from(new TextEncoder().encode(id), (b) => b.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === id ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
    return new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result, tx = db.transaction("settings"), query = tx.objectStore("settings").getAll();
        tx.oncomplete = () => { db.close(); resolve(query.result.filter((row) => row.key.startsWith(prefix))); }; };
    });
  }, { id: userId, prefix });
}
async function editTitle(page: Page, title: string) {
  await page.getByRole("textbox", { name: "Notebook title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Notebook title", exact: true }).press("Tab");
}

for (const [width, choice, locale] of [[375, "local", "zh-CN"], [768, "server", "en-US"], [1440, "merge", "en-US"]] as const) {
  test(`notebook conflict ${choice} at ${width}, durable comparison and receipt`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(150_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale });
    const page = await context.newPage(), headers = { Origin: baseURL! };
    let release: (() => void) | undefined;
    try {
      const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `resolve-${width}-${Date.now()}@example.test`, password: "synthetic resolution passphrase", confirm_password: "synthetic resolution passphrase" } });
      expect(registered.status()).toBe(201);
      const userId = (await registered.json()).user_id;
      expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: { locale_mode: locale, theme_mode: locale === "zh-CN" ? "light" : "dark" } })).status()).toBe(200);
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic conflict notebook", messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: "Synthetic response" }] } });
      expect(created.status()).toBe(201);
      const conversationId = (await created.json()).conversation.id;
      const note = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
      await page.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
      await page.getByRole("button", { name: /Download offline copy|下载离线副本/, exact: true }).click();
      await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(1);
      await page.getByRole("button", { name: /Notes|精选笔记/, exact: true }).click();
      await context.setOffline(true);
      await editTitle(page, "Synthetic local draft");
      await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(1);
      expect((await context.request.put(`${baseURL}/api/conversations/${conversationId}/notebook`, { headers, data: { base_revision: note.revision, title: "Synthetic server draft", blocks: [] } })).status()).toBe(200);
      await context.setOffline(false);
      await expect.poll(async () => (await markers(page, userId)).length).toBe(1);
      await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(0);
      await page.setViewportSize({ width, height: 900 });
      const openReview = async () => {
        const annotationPanel = page.locator('section[aria-label="批注"]');
        if (await annotationPanel.isVisible()) await annotationPanel.getByRole("button", { name: /^(Close|关闭)$/ }).click();
        if (width < 768 && !await page.getByRole("button", { name: /Settings|设置/, exact: true }).isVisible()) await page.getByRole("button", { name: /Open sidebar|打开侧栏/, exact: true }).click();
        await page.getByRole("button", { name: /Settings|设置/, exact: true }).click();
        await page.getByRole("button", { name: /Offline & sync|离线与同步/ }).click();
        const center = page.getByRole("dialog", { name: /Offline & sync|离线与同步/ });
        await center.getByRole("tab", { name: /Failures & conflicts|失败与冲突/ }).click();
        await center.getByRole("button", { name: /Compare and resolve|比较并解决/ }).click();
        return center;
      };
      let center;
      if (choice === "local") {
        await page.getByRole("button", { name: /Compare and resolve conflicts|比较并解决冲突/, exact: true }).click();
        center = page.getByRole("dialog", { name: /Offline & sync|离线与同步/ });
      } else center = await openReview();
      await expect(center.getByRole("region", { name: /Local version|本机内容/ })).toContainText("Synthetic local draft");
      await expect(center.getByRole("region", { name: /Server version|服务器内容/ })).toContainText("Synthetic server draft");
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/offline-conflict-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (choice === "server") {
        expect((await context.request.put(`${baseURL}/api/conversations/${conversationId}/notebook`, { headers, data: { base_revision: 2, title: "Synthetic newer server draft", blocks: [] } })).status()).toBe(200);
        await center.getByRole("button", { name: "Keep server", exact: true }).click();
        await page.getByRole("button", { name: "Apply resolution", exact: true }).click();
        await expect(center.getByRole("alert")).toBeVisible();
        expect((await markers(page, userId)).length).toBe(1);
        await center.getByRole("button", { name: "Compare again", exact: true }).click();
        await expect(center.getByRole("region", { name: "Server version" })).toContainText("Synthetic newer server draft");
      }
      if (choice !== "merge") {
        await center.getByRole("button", { name: choice === "local" ? /Keep local|保留本机/ : "Keep server", exact: true }).click();
        await page.getByRole("button", { name: /Apply resolution|确认应用/, exact: true }).click();
      } else {
        await center.getByText("Merge manually", { exact: true }).click();
        await center.getByRole("textbox", { name: "Merged title", exact: true }).fill("Synthetic merged title");
        await center.getByRole("button", { name: "Add text block", exact: true }).click();
        await center.getByRole("textbox", { name: "Merged text 1", exact: true }).fill("Synthetic merged body");
        await expect(center.getByText("Draft saved on this device", { exact: true })).toBeVisible();
        const otherTab = await context.newPage();
        await otherTab.goto(`${baseURL}/recent`);
        await otherTab.getByRole("button", { name: "Settings", exact: true }).click();
        await otherTab.getByRole("button", { name: /Offline & sync/ }).click();
        const otherCenter = otherTab.getByRole("dialog", { name: "Offline & sync", exact: true });
        await otherCenter.getByRole("tab", { name: "Pending edits", exact: true }).click();
        const downloaded = otherTab.waitForEvent("download");
        await otherCenter.getByRole("button", { name: "Export local edits and drafts", exact: true }).click();
        const archive = await downloaded, path = info.outputPath("synthetic-resolution-draft.zip"); await archive.saveAs(path);
        const content = JSON.parse(strFromU8(unzipSync(await readFile(path))["changes.json"]));
        expect(content.resolution_drafts[0].value.title).toBe("Synthetic merged title");
        expect(content.resolution_drafts[0].value.blocks[0].markdown).toBe("Synthetic merged body");
        await otherTab.close();
        await page.reload(); center = await openReview();
        await center.getByText("Merge manually", { exact: true }).click();
        await expect(center.getByRole("textbox", { name: "Merged title", exact: true })).toHaveValue("Synthetic merged title");
        await expect(center.getByRole("textbox", { name: "Merged text 1", exact: true })).toHaveValue("Synthetic merged body");
        const receipts: Array<{ status: string; operation_id: string }> = [];
        let drop = true;
        await page.route("**/api/annotations/sync", async (route) => {
          const response = await route.fetch(); receipts.push(...(await response.json()).results);
          if (drop) { drop = false; await route.abort("failed"); } else await route.fulfill({ response });
        });
        await center.getByRole("button", { name: "Apply merge", exact: true }).click();
        await page.getByRole("button", { name: "Apply resolution", exact: true }).click();
        await expect(center.getByRole("button", { name: "Retry resolution", exact: true })).toBeVisible();
        await expect(center.getByRole("button", { name: "Retry resolution", exact: true })).toBeEnabled();
        await expect.poll(() => receipts.length).toBe(1);
        expect(receipts[0].status).toBe("applied");
        await page.reload(); center = await openReview();
        // Force a package carrying the already-resolved server notebook while
        // local acknowledgment is still pending. It must not replace the
        // working notebook or the stored resolution comparison.
        await center.getByRole("button", { name: "Back to conflicts", exact: true }).click();
        await center.getByRole("tab", { name: "Offline copies", exact: true }).click();
        const completed = async () => ((await markers(page, userId, "offline-download:")) as Array<{ value: { state: string } }>).filter((row) => row.value.state === "completed").length;
        const beforeDownloads = await completed();
        await center.getByRole("button", { name: "Check and update", exact: true }).click();
        await expect.poll(completed).toBeGreaterThan(beforeDownloads);
        await center.getByRole("tab", { name: "Failures & conflicts", exact: true }).click();
        await center.getByRole("button", { name: "Compare and resolve", exact: true }).click();
        const second = await context.newPage();
        await second.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
        await second.getByRole("button", { name: "Notes", exact: true }).click();
        await expect(second.getByRole("textbox", { name: "Notebook title", exact: true })).toHaveValue("Synthetic server draft");
        let captured = false;
        const barrier = new Promise<void>((resolve) => { release = resolve; });
        await page.route(`**/api/conversations/${conversationId}/notebook`, async (route) => {
          const response = await route.fetch(); captured = true; await barrier; await route.fulfill({ response });
        });
        await center.getByRole("button", { name: "Retry resolution", exact: true }).click();
        await expect.poll(() => captured).toBe(true);
        await editTitle(second, "Synthetic edit while resolving");
        await expect.poll(async () => {
          if (await second.getByRole("alert").filter({ hasText: "Save failed" }).isVisible()) {
            throw new Error("Concurrent notebook save was rejected; the draft must remain recoverable.");
          }
          return (await readLocal(page, userId)).outbox.length;
        }).toBe(1);
        await context.setOffline(true); release!();
        await expect.poll(async () => (await markers(page, userId)).length).toBe(0);
        const local = (await readLocal(page, userId)).notebooks;
        expect(local).toHaveLength(1);
        expect(local[0].title).toBe("Synthetic edit while resolving");
        expect(local[0].blocks).toEqual(expect.arrayContaining([expect.objectContaining({ markdown: "Synthetic merged body" })]));
        await page.unroute(`**/api/conversations/${conversationId}/notebook`);
        await context.setOffline(false);
        await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(0);
        expect(receipts[1].status).toBe("duplicate");
        expect(receipts[1].operation_id).toBe(receipts[0].operation_id);
      }
      await expect.poll(async () => (await markers(page, userId)).length).toBe(0);
      const final = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
      expect(final.title).toBe(choice === "local" ? "Synthetic local draft" : choice === "server" ? "Synthetic newer server draft" : "Synthetic edit while resolving");
      expect((await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook/conflicts`)).json()).length).toBe(0);
    } finally { release?.(); await context.close(); await admin.dispose(); }
  });
}

test("annotation merge removes its conflict and persists the canonical comment", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(100_000);
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const page = await context.newPage(), headers = { Origin: baseURL! };
  try {
    const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `resolve-annotation-${Date.now()}@example.test`, password: "synthetic annotation passphrase", confirm_password: "synthetic annotation passphrase" } });
    expect(registered.status()).toBe(201);
    const userId = (await registered.json()).user_id;
    const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic annotation conflict", messages: [{ role: "user", content_markdown: "Synthetic annotation question" }, { role: "assistant", content_markdown: "Synthetic annotation answer" }] } });
    expect(created.status()).toBe(201);
    const conversationId = (await created.json()).conversation.id;
    const messages = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/messages`)).json();
    const createdAnnotation = await context.request.post(`${baseURL}/api/conversations/${conversationId}/annotations`, { headers, data: { annotation_type: "bookmark", message_id: messages[0].id, comment_markdown: "Synthetic initial comment" } });
    expect(createdAnnotation.status()).toBe(201);
    const annotation = await createdAnnotation.json();
    await page.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
    await page.getByRole("button", { name: /Download offline copy|下载离线副本/, exact: true }).click();
    await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(1);
    const comment = page.getByPlaceholder("Markdown comment", { exact: true }).first();
    await expect(comment).toBeVisible();
    await context.setOffline(true);
    await comment.fill("Synthetic local comment"); await comment.press("Tab");
    await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(1);
    expect((await context.request.patch(`${baseURL}/api/annotations/${annotation.id}`, { headers, data: { base_revision: 1, comment_markdown: "Synthetic server comment" } })).status()).toBe(200);
    await context.setOffline(false);
    await expect.poll(async () => (await markers(page, userId)).length).toBe(1);
    await page.locator('section[aria-label="批注"]').getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Offline & sync" }).click();
    const center = page.getByRole("dialog", { name: "Offline & sync" });
    // A conflict without queued descendant edits must still prevent removal.
    await center.getByRole("button", { name: "Delete copy", exact: true }).click();
    await expect(center.getByRole("region", { name: "Handle local changes before clearing data", exact: true })).toBeVisible();
    expect((await readLocal(page, userId)).conversations.length).toBe(1);
    await center.getByRole("button", { name: "Back to offline copies", exact: true }).click();
    await center.getByRole("tab", { name: "Failures & conflicts" }).click();
    await center.getByRole("button", { name: "Compare and resolve", exact: true }).click();
    await expect(center.getByRole("region", { name: "Local version" })).toContainText("Synthetic local comment");
    await expect(center.getByRole("region", { name: "Server version" })).toContainText("Synthetic server comment");
    await center.getByText("Merge manually", { exact: true }).click();
    await center.getByRole("textbox", { name: "Merged comment", exact: true }).fill("Synthetic combined comment");
    await center.getByRole("button", { name: "Apply merge", exact: true }).click();
    await page.getByRole("button", { name: "Apply resolution", exact: true }).click();
    await expect.poll(async () => (await markers(page, userId)).length).toBe(0);
    const rows = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/annotations?include_deleted=true`)).json();
    expect(rows).toHaveLength(1); expect(rows[0].comment_markdown).toBe("Synthetic combined comment"); expect(rows[0].revision).toBe(3);
    await page.reload();
    await expect(page.getByPlaceholder("Markdown comment", { exact: true }).first()).toHaveValue("Synthetic combined comment");
  } finally { await context.close(); await admin.dispose(); }
});
