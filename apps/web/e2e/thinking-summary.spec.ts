import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { MessageListItem } from "../lib/types";
import { openSettingsNoiseReview, settingsAppearance } from "./settings-test-helper";

test.skip(process.env.E2E_THINKING_SUMMARY !== "1", "Requires an explicitly isolated API/store and worker");
test.use({ trace: "off", extraHTTPHeaders: { Origin: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3107" } });

for (const width of [1440, 375]) test(`${width}px: Reader, Share and cached Offline preserve source and fold only the opening summary`, async ({ page, context, baseURL }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await settingsAppearance(page.request, baseURL!, width === 375 ? "zh-CN" : "en-US");
  const summary = "> 分析合成示例\n> Thinking 5s\n\nVisible synthetic answer.";
  const ordinary = "Keep this introduction.\n\nThinking 5s\n\nAnd this ordinary answer.";
  const response = await page.request.post("/api/conversations", { data: {
    title: "Synthetic thinking preservation",
    messages: [{ role: "user", content_markdown: "Synthetic question." }, { role: "assistant", content_markdown: summary }],
  } });
  expect(response.status()).toBe(201);
  const { conversation, messages } = await response.json();
  const summaryId = messages[1].id as string;
  const inserted = await page.request.post(`/api/conversations/${conversation.id}/messages/insert`, { data: {
    anchor_message_id: summaryId, position: "after", mode: "pair",
    messages: [{ role: "user", content_markdown: "Second synthetic question." }, { role: "assistant", content_markdown: ordinary }],
  } });
  expect(inserted.status()).toBe(201);
  const ordinaryId = (await inserted.json()).messages[1].id as string;
  const verify = async (target: Page) => {
    const folded = target.locator(`article[data-message-id="${summaryId}"]`);
    await expect(folded.getByText("Visible synthetic answer.", { exact: true })).toBeVisible();
    await expect(folded.locator("details.reader-thinking")).toHaveCount(1);
    await expect(folded.locator("details.reader-thinking")).not.toHaveAttribute("open");
    await folded.locator("details.reader-thinking > summary").click();
    await expect(folded.locator("details.reader-thinking")).toContainText("分析合成示例");
    await expect(folded.locator("details.reader-thinking")).not.toContainText("Visible synthetic answer.");
    await folded.locator("details.reader-thinking > summary").click();
    const plain = target.locator(`article[data-message-id="${ordinaryId}"]`);
    await expect(plain.getByText("Keep this introduction.", { exact: true })).toBeVisible();
    await expect(plain.locator("details.reader-thinking")).toHaveCount(0);
  };
  try {
    await page.goto(`/conversations/${conversation.id}`);
    await verify(page);
    if (width === 1440) {
      await page.locator(`article[data-message-id="${summaryId}"]`).getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ }).click();
      await expect(page.getByTestId("source-editor-codemirror")).toContainText("Thinking 5s");
      await expect(page.getByTestId("source-editor-codemirror")).toContainText("分析合成示例");
      await expect(page.getByTestId("source-editor-codemirror")).toContainText("Visible synthetic answer.");
    }
    const detail = await (await page.request.get(`/api/messages/${summaryId}`)).json();
    expect(detail.current_version.display_text).toBe(summary);
    const index = await (await page.request.get(`/api/conversations/${conversation.id}/dialogue-index`)).json();
    expect(index.items.find((item: { message_id: string }) => item.message_id === ordinaryId).preview).toContain("Keep this introduction.");
    const share = await page.request.post(`/api/conversations/${conversation.id}/shares`, { data: { title: "Synthetic summary share" } });
    expect(share.status()).toBe(200);
    await page.goto(`/share/${(await share.json()).token}`);
    await verify(page);

    const current = await (await page.request.get(`/api/conversations/${conversation.id}`)).json();
    const window = await (await page.request.get(`/api/conversations/${conversation.id}/message-window?include_blocks=true`)).json();
    await page.goto("/library");
    await expect(page.locator("p:visible, span:visible", { hasText: /^(Offline ready|Existing offline version is available|可离线启动|现有离线版本可用)/ }).first()).toBeVisible();
    // Real current source/blocks, with deliberately stale collapse flags to
    // exercise older offline packages without changing Dexie's schema.
    await page.evaluate(async ({ conversation, messages }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("chat-reader-offline-library");
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["conversations", "messages", "blocks"], "readwrite");
        tx.objectStore("conversations").put({ ...conversation, downloaded_at: new Date().toISOString(), last_read_at: null });
        for (const message of messages) {
          const { render_blocks, ...record } = message;
          tx.objectStore("messages").put({ ...record, conversation_id: conversation.id });
          for (const block of render_blocks ?? []) tx.objectStore("blocks").put({
            ...block, key: `${message.id}:${block.block_index}`, message_id: message.id,
            conversation_id: conversation.id, collapsed_by_default: true,
          });
        }
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      });
    }, { conversation: current, messages: window.items as MessageListItem[] });
    await page.goto(`/library?conversationId=${conversation.id}`);
    await verify(page);
    await context.setOffline(true);
    await page.reload();
    await verify(page);
    await page.screenshot({ path: info.outputPath(`thinking-summary-offline-${width}.png`) });
  } finally {
    await context.setOffline(false);
    expect((await page.request.delete(`/api/conversations/${conversation.id}`)).ok()).toBeTruthy();
  }
});

test("long normalized candidates keep rule editing and the saved all-role scope; trials show suppressed and covered hits", async ({ page, baseURL }, info) => {
  page.setDefaultTimeout(15_000);
  await settingsAppearance(page.request, baseURL!, "en-US");
  // Exception scopes intentionally survive rule relearning. Give each run a
  // distinct surrounding context rather than depending on an empty account.
  const source = `Run ${randomUUID()} ALPHA${" ".repeat(600)}BETA`;
  let exceptionId: string | undefined;
  const createdRule = await page.request.post("/api/content-cleanup/rules", { data: {
    name: "Synthetic broad literal", match_value: "ALPHA BETA", role_filter: null, matcher_mode: "NORMALIZED",
  } });
  expect(createdRule.status()).toBe(201);
  const rule = await createdRule.json();
  const response = await page.request.post("/api/conversations", { data: {
    title: "Synthetic long normalized match", messages: [
      { role: "user", content_markdown: "Synthetic question." }, { role: "assistant", content_markdown: source },
    ],
  } });
  expect(response.status()).toBe(201);
  const { conversation } = await response.json();
  try {
    const started = await page.request.post("/api/content-cleanup/scans", { data: {
      source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.id],
    } });
    expect(started.status()).toBe(202);
    const scan = (await started.json()).id;
    await expect.poll(async () => (await (await page.request.get(`/api/content-cleanup/scans/${scan}`)).json()).status).toBe("READY");
    expect((await (await page.request.get(`/api/content-cleanup/scans/${scan}`)).json()).occurrence_count).toBe(1);
    await page.goto(`/conversations/${conversation.id}`);
    await openSettingsNoiseReview(page, scan);
    const dialog = page.getByTestId("content-cleanup-dialog");
    const candidate = dialog.locator("article").filter({ hasText: "Synthetic broad literal" });
    await candidate.getByRole("button", { name: "Context and rules", exact: true }).click();
    await candidate.getByRole("button", { name: "View / edit matching rule", exact: true }).click();
    const editor = dialog.getByRole("region", { name: "Learn noise rule", exact: true });
    await expect(editor.getByRole("combobox", { name: "Message role", exact: true })).toHaveValue("");
    await expect(editor.getByRole("note")).toContainText("anywhere across all roles");
    await expect(editor.getByLabel("Match text", { exact: true })).toHaveValue("ALPHA BETA");
    await editor.getByRole("button", { name: "Preview and test", exact: true }).click();
    await expect(editor.getByRole("status")).toContainText("1 matches");
    // Add an exception through the existing explicit server-bound review.
    const hit = (await (await page.request.get(`/api/content-cleanup/scans/${scan}/occurrences`)).json())[0];
    const prefix = `/api/content-cleanup/scans/${scan}/occurrences/${hit.id}/exception`;
    const exception = await (await page.request.get(prefix)).json();
    const ignored = await page.request.post(prefix, { data: { confirmed: true, preview_token: exception.preview_token } });
    expect(ignored.status()).toBe(201);
    exceptionId = (await ignored.json()).id;
    await editor.getByRole("button", { name: "Preview and test", exact: true }).click();
    await expect(editor.getByText(/1 are suppressed by saved exceptions/)).toBeVisible();
    await editor.getByLabel("Match text", { exact: true }).fill("Cite turn12search4");
    // The editor trial is conversation-scoped; retain that boundary.
    const message = await (await page.request.get(`/api/conversations/${conversation.id}/message-window`)).json();
    const row = message.items[1];
    expect((await page.request.patch(`/api/messages/${row.id}`, { data: { display_text: "Keep Cite turn12search4 after.", base_version_id: row.current_version.id } })).ok()).toBeTruthy();
    await editor.getByRole("button", { name: "Preview and test", exact: true }).click();
    await expect(editor.getByText(/1 are covered by another rule/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("noise-rule-trial-covered.png") });
    await editor.getByLabel("Match text", { exact: true }).fill("ALPHA BETA");
    await editor.getByRole("button", { name: "Preview and test", exact: true }).click();
    await editor.getByRole("button", { name: "Confirm personal rule", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const saved = (await (await page.request.get("/api/content-cleanup/rules")).json()).find((item: { id: string }) => item.id === rule.id);
    expect(saved.role_filter).toBeNull();
    expect(saved.match_value).toBe("ALPHA BETA");
  } finally {
    if (exceptionId) await page.request.delete(`/api/content-cleanup/exceptions/${exceptionId}`);
    await page.request.delete(`/api/conversations/${conversation.id}`);
    await page.request.delete(`/api/content-cleanup/rules/${rule.id}`);
  }
});
