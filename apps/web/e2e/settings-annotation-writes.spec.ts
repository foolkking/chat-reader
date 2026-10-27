import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import type { AnnotationRead } from "../lib/types";

test.use({ trace: "retain-on-failure", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL and authentication");

for (const locale of ["zh-CN", "en-US"] as const) {
  for (const scenario of ["comment", "style", "delete", "bookmark"] as const) {
    test(`1440px ${locale}: ${scenario} recovers without losing input or repeating confirmed writes`, async ({ browser, playwright, baseURL }, info) => {
      const admin = await settingsAdmin(playwright.request, baseURL!);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale });
      const page = await context.newPage(), headers = { Origin: baseURL! };
      let releaseNotebookReads = () => {};
      const notebookReadsReleased = new Promise<void>(resolve => { releaseNotebookReads = resolve; });
      try {
        expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
          email: `annotation-write-${randomUUID()}@example.test`,
          password: "synthetic write recovery password", confirm_password: "synthetic write recovery password",
        } })).status()).toBe(201);
        expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: {
          locale_mode: locale, theme_mode: locale === "zh-CN" ? "light" : "dark",
        } })).status()).toBe(200);
        const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
          title: "Synthetic annotation write recovery", messages: [
            { role: "user", content_markdown: "Synthetic annotation source" },
            { role: "assistant", content_markdown: "Synthetic annotation answer" },
          ],
        } });
        expect(created.status()).toBe(201);
        const id = (await created.json()).conversation.id, endpoint = `${baseURL}/api/conversations/${id}`;
        const messages = await (await context.request.get(`${endpoint}/messages?include_blocks=true`)).json();
        const annotations: AnnotationRead[] = [];
        if (scenario !== "bookmark") for (let index = 0; index < 2; index++) {
          const block = messages[index].render_blocks?.[0];
          const quote = block?.plain_text || messages[index].current_version?.display_text || `Synthetic annotation source ${index}`;
          expect(block).toBeTruthy();
          const added = await context.request.post(`${endpoint}/annotations`, { headers, data: {
            annotation_type: "highlight", color: "green", message_id: messages[index].id,
            message_version_id: messages[index].current_version.id,
            start_block_index: block.block_index, start_offset: 0,
            end_block_index: block.block_index, end_offset: quote.length,
            quote, comment_markdown: `Synthetic stored comment ${index}`,
          } });
          expect(added.status()).toBe(201); annotations.push(await added.json());
        }
        const list = async (): Promise<AnnotationRead[]> => (await context.request.get(`${endpoint}/annotations`)).json();
        const notebook = async () => (await context.request.get(`${endpoint}/notebook`)).json();
        if (scenario === "delete") {
          const note = await notebook();
          expect((await context.request.put(`${endpoint}/notebook`, { headers, data: {
            id: note.id, base_revision: note.revision, title: "Synthetic references", blocks: annotations.map(item => ({
              id: randomUUID(), type: "annotation_reference", annotation_id: item.id,
            })),
          } })).status()).toBe(200);
        }
        const writes: string[] = []; let fail = true, noteWrites = 0;
        await page.route("**/api/annotations/*", async route => {
          const request = route.request(), method = request.method();
          if (method === "PATCH" || method === "DELETE") {
            writes.push(new URL(request.url()).pathname);
            if (fail && (scenario === "comment" || writes.length === 2)) {
              await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Synthetic write outage"}' }); return;
            }
          }
          await route.continue();
        });
        await page.route(`**/api/conversations/${id}/notebook`, async route => {
          if (route.request().method() === "PUT") noteWrites++;
          if (scenario === "delete" && route.request().method() === "GET") await notebookReadsReleased;
          await route.continue();
        });
        if (scenario === "bookmark") await page.route(`**/api/conversations/${id}/annotations`, async route => {
          if (route.request().method() === "POST") {
            writes.push(route.request().postDataJSON().id);
            const response = await route.fetch(); expect(response.status()).toBe(201);
            await route.abort("failed"); return;
          }
          await route.continue();
        });
        await page.goto(`${baseURL}/conversations/${id}${scenario === "bookmark" ? "" : "?annotations=open"}`);
        if (scenario === "bookmark") {
          await page.getByRole("button", { name: /^(Bookmark message|收藏消息)$/ }).first().click();
          await expect(page.getByRole("button", { name: /^(Check bookmark|核对书签)$/ })).toBeVisible();
          expect(writes).toHaveLength(1); expect(writes[0]).toMatch(/^[0-9a-f-]{36}$/);
          await page.screenshot({ path: info.outputPath(`bookmark-unknown-${locale}.png`) });
          await page.getByRole("button", { name: /^(Check bookmark|核对书签)$/ }).click();
          await expect(page.getByRole("button", { name: /^(Check bookmark|核对书签)$/ })).toHaveCount(0);
          expect(writes).toHaveLength(1); expect((await list()).map(item => item.id)).toEqual(writes);
        } else {
          if (scenario === "delete") {
            // Deletion requires ready notebook/conflict reads. Hold the initial
            // notebook response so this write-recovery case cannot race that guard.
            await page.getByRole("button", { name: /^(Notes|精选笔记)$/ }).click();
            const editor = page.getByRole("region", { name: /^(Notebook editor|笔记编辑器)$/ });
            await expect(editor).toHaveCount(0);
            expect(writes).toHaveLength(0);
            releaseNotebookReads();
            await expect(editor).toHaveAttribute("data-notebook-save-ready", "true");
          }
          await page.getByRole("button", { name: /^(All|全部批注)$/ }).click();
          const first = page.locator(`#annotation-${annotations[0].id}`);
          await expect(first).toBeVisible();
          if (scenario === "comment") {
            const input = first.getByRole("textbox", { name: /^(Comment|评论)$/ });
            await input.fill("Synthetic protected comment draft");
            await first.getByRole("button", { name: /^(Save comment|保存评论)$/ }).click();
            await expect(first.getByRole("button", { name: /^(Retry saving comment|重试保存评论)$/ })).toBeVisible();
            expect(writes).toHaveLength(1);
            expect((await context.request.patch(`${baseURL}/api/annotations/${annotations[0].id}`, { headers, data: {
              base_revision: annotations[0].revision, color: "blue",
            } })).status()).toBe(200);
            await first.getByRole("button", { name: /^(Check current comment|读取当前评论)$/ }).click();
            await expect(first.locator("blockquote")).toHaveAttribute("data-annotation-color", "blue");
            await expect(input).toHaveValue("Synthetic protected comment draft"); expect(writes).toHaveLength(1);
            await page.screenshot({ path: info.outputPath(`comment-retained-${locale}.png`) });
            fail = false;
            await first.getByRole("button", { name: /^(Retry saving comment|重试保存评论)$/ }).click();
            await expect.poll(async () => (await list()).find(item => item.id === annotations[0].id)?.comment_markdown).toBe("Synthetic protected comment draft");
            expect(writes).toHaveLength(2);
          } else {
            await page.getByRole("button", { name: /^(Manage|管理)$/ }).click();
            await page.getByRole("button", { name: /^(Select visible|全选当前结果)$/ }).click();
            if (scenario === "style") {
              await page.getByRole("button", { name: /^(Apply style \(2\)|应用样式（2）)$/ }).click();
              await expect(page.getByText(/1\/2 style changes confirmed|样式已确认 1\/2 项/)).toBeVisible();
              expect((await list()).filter(item => item.color === "yellow")).toHaveLength(1);
              await page.screenshot({ path: info.outputPath(`style-partial-${locale}.png`) });
              await page.getByRole("button", { name: /^(Check current annotations|读取当前批注)$/ }).click();
              await expect(page.getByRole("button", { name: /^(Check current annotations|读取当前批注)$/ })).toHaveCount(0);
              expect(writes).toHaveLength(2); fail = false;
              await page.getByRole("button", { name: /^(Apply style \(2\)|应用样式（2）)$/ }).click();
              await expect.poll(async () => (await list()).filter(item => item.color === "yellow").length).toBe(2);
              expect(writes).toHaveLength(3); expect(writes[2]).toBe(writes[1]);
            } else {
              await page.getByRole("button", { name: /^(Delete|删除)$/ }).click();
              await page.getByRole("dialog", { name: /Delete 2 annotations|删除 2 条批注/ }).getByRole("button", { name: /^(Delete|删除)$/ }).click();
              await expect(page.getByText(/1\/2 deletions confirmed|删除已确认 1\/2 项/)).toBeVisible();
              expect(await list()).toHaveLength(1); expect((await notebook()).blocks).toHaveLength(2); expect(noteWrites).toBe(0);
              await page.screenshot({ path: info.outputPath(`delete-partial-${locale}.png`) });
              await page.getByRole("button", { name: /^(Check deletion results|核对删除结果)$/ }).click();
              await expect(page.getByRole("button", { name: /^(Clean notebook references|清理对应笔记引用)$/ })).toBeVisible();
              expect(writes).toHaveLength(2); expect(noteWrites).toBe(0);
              await page.getByRole("button", { name: /^(Clean notebook references|清理对应笔记引用)$/ }).click();
              await expect.poll(async () => (await notebook()).blocks.length).toBe(1);
              expect((await notebook()).blocks[0].annotation_id).toBe((await list())[0].id);
              expect(writes).toHaveLength(2); expect(noteWrites).toBe(1);
            }
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${scenario}-recovered-${locale}.png`) });
      } finally { releaseNotebookReads(); await context.close(); await admin.dispose(); }
    });
  }
}
