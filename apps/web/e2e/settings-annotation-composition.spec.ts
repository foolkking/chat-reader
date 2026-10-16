import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import type { AnnotationCreateInput, AnnotationRead, NotebookBlock } from "../lib/types";

test.use({ trace: "retain-on-failure", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL and authentication");

for (const [width, locale, kind] of [[375, "zh-CN", "text"], [1440, "en-US", "text"], [1440, "zh-CN", "notes"], [1440, "en-US", "notes"]] as const) {
  test(`${width}px ${locale}: ${kind} keeps the original input through an unknown write`, async ({ browser, playwright, baseURL }, info) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const page = await context.newPage(), headers = { Origin: baseURL! };
    try {
      expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
        email: `annotation-compose-${randomUUID()}@example.test`, password: "synthetic compose password", confirm_password: "synthetic compose password",
      } })).status()).toBe(201);
      expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: {
        locale_mode: locale, theme_mode: locale === "zh-CN" ? "light" : "dark",
      } })).status()).toBe(200);
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
        title: "Synthetic annotation composition", messages: [
          { role: "user", content_markdown: "Synthetic source for selection" },
          { role: "assistant", content_markdown: "Synthetic second source" },
        ],
      } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id, endpoint = `${baseURL}/api/conversations/${id}`;
      const messages = await (await context.request.get(`${endpoint}/messages`)).json();
      const getAnnotations = async (): Promise<AnnotationRead[]> => (await context.request.get(`${endpoint}/annotations`)).json();
      const getNotebook = async () => (await context.request.get(`${endpoint}/notebook`)).json();
      let fail = true;
      if (kind === "text") {
        const requests: AnnotationCreateInput[] = [];
        await page.route(`**/api/conversations/${id}/annotations`, async route => {
          if (route.request().method() === "POST") {
            requests.push(route.request().postDataJSON());
            if (fail) { await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Synthetic unknown create"}' }); return; }
          }
          await route.continue();
        });
        await page.goto(`${baseURL}/conversations/${id}`);
        const block = page.locator(`article[data-message-id="${messages[0].id}"] [data-block-index]`).first();
        await expect(block).toBeVisible();
        // A real DOM Range drives the production selection listener. This is
        // not a claim to test a native touch selection gesture.
        await block.evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        });
        const toolbar = page.getByRole("toolbar", { name: "Create annotation" });
        await expect(toolbar).toBeVisible();
        await toolbar.getByRole("button", { name: /^(Comment|评论)$/ }).click();
        await toolbar.getByRole("button", { name: /^(Create Comment Yellow|创建评论，黄色)$/i }).click();
        const prompt = page.getByRole("dialog", { name: /^(Add comment|添加评论)$/ });
        await expect(prompt).toContainText("Synthetic source for selection");
        await prompt.getByRole("textbox", { name: /^(Comment|评论)$/ }).fill("Synthetic comment retained across failure");
        await prompt.getByRole("button", { name: /^(Create|创建)$/ }).click();
        const check = page.getByRole("button", { name: /^(Check annotation|核对批注)$/ });
        await expect(check).toBeVisible(); expect(requests).toHaveLength(1);
        await page.getByText(/^(Retained quote and comment|保留的摘录与评论)$/).click();
        await expect(page.getByText("Synthetic comment retained across failure", { exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`text-create-retained-${width}.png`) });
        await check.click();
        await expect(page.getByRole("button", { name: /^(Retry this annotation|重试添加此批注)$/ })).toBeVisible();
        expect(requests).toHaveLength(1); fail = false;
        await page.getByRole("button", { name: /^(Retry this annotation|重试添加此批注)$/ }).click();
        await expect.poll(async () => (await getAnnotations()).length).toBe(1);
        expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
        expect((await getAnnotations())[0].comment_markdown).toBe("Synthetic comment retained across failure");
        await expect(page.getByRole("dialog", { name: /^(Add comment|添加评论)$/ })).toHaveCount(0);
      } else {
        const annotations: AnnotationRead[] = [];
        for (const message of messages) {
          const response = await context.request.post(`${endpoint}/annotations`, { headers, data: {
            annotation_type: "bookmark", message_id: message.id, comment_markdown: "Synthetic note target",
          } });
          expect(response.status()).toBe(201); annotations.push(await response.json());
        }
        const requests: Array<{ blocks: NotebookBlock[] }> = [];
        await page.route(`**/api/conversations/${id}/notebook`, async route => {
          if (route.request().method() === "PUT") {
            requests.push(route.request().postDataJSON());
            if (fail) { await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Synthetic unknown addition"}' }); return; }
          }
          await route.continue();
        });
        await page.goto(`${baseURL}/conversations/${id}?annotations=open`);
        await page.getByRole("button", { name: /^(All|全部批注)$/ }).click();
        await expect(page.locator(`#annotation-${annotations[1].id}`)).toBeVisible();
        await page.getByRole("button", { name: /^(Manage|管理)$/ }).click();
        await page.getByRole("button", { name: /^(Select visible|全选当前结果)$/ }).click();
        await page.getByRole("button", { name: /^(Add to notes|加入精选笔记) \(2\)$/ }).click();
        await expect(page.getByRole("button", { name: /^(Check current notes|核对笔记内容)$/ })).toBeVisible();
        expect(requests).toHaveLength(1); await page.screenshot({ path: info.outputPath(`note-add-unknown-${locale}.png`) });
        const note = await getNotebook(), textId = randomUUID();
        expect((await context.request.put(`${endpoint}/notebook`, { headers, data: {
          id: note.id, base_revision: note.revision, title: "Synthetic newer notebook", blocks: [
            { id: textId, type: "markdown", markdown: "Synthetic newer text to preserve" },
            { id: randomUUID(), type: "annotation_reference", annotation_id: annotations[0].id },
          ],
        } })).status()).toBe(200);
        await page.getByRole("button", { name: /^(Check current notes|核对笔记内容)$/ }).click();
        await expect(page.getByRole("button", { name: /^(Add missing references \(1\)|补齐引用（1）)$/ })).toBeVisible();
        expect(requests).toHaveLength(1); fail = false;
        await page.getByRole("button", { name: /^(Add missing references \(1\)|补齐引用（1）)$/ }).click();
        await expect.poll(async () => (await getNotebook()).blocks.length).toBe(3);
        const saved = await getNotebook(); expect(saved.title).toBe("Synthetic newer notebook");
        expect(saved.blocks.find((item: NotebookBlock) => item.id === textId).markdown).toBe("Synthetic newer text to preserve");
        expect(saved.blocks.filter((item: NotebookBlock) => item.annotation_id).map((item: NotebookBlock) => item.annotation_id).sort()).toEqual(annotations.map(item => item.id).sort());
        expect(requests).toHaveLength(2);
        expect(requests[1].blocks.find(item => item.annotation_id === annotations[1].id)?.id)
          .toBe(requests[0].blocks.find(item => item.annotation_id === annotations[1].id)?.id);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${kind}-recovered-${width}-${locale}.png`) });
    } finally { await context.close(); await admin.dispose(); }
  });
}
