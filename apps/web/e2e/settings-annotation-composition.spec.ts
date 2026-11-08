import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import type { AnnotationCreateInput, AnnotationRead, NotebookBlock } from "../lib/types";
import { openReaderAction } from "./reader-actions";

test.use({ trace: "retain-on-failure", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL and authentication");

for (const width of [375, 1440]) test(`${width}px: real wrapped text position, bookmark reveal and selected export`, async ({ browser, playwright, baseURL }, info) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(), headers = { Origin: baseURL! };
  try {
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
      email: `reading-point-${randomUUID()}@example.test`, password: "synthetic point password", confirm_password: "synthetic point password",
    } })).status()).toBe(201);
    expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: { locale_mode: "en-US" } })).ok()).toBe(true);
    const paragraph = Array.from({ length: 95 }, (_, index) => `🙂 Sentence ${index}: reading a long uninterrupted paragraph. `).join("");
    const made = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
      title: "Synthetic reading-line bookmark", messages: [{ role: "user", content_markdown: paragraph }],
    } });
    expect(made.status()).toBe(201);
    const result = await made.json(), id = result.conversation.id;
    const endpoint = `${baseURL}/api/conversations/${id}`;
    await page.goto(`/conversations/${id}`);
    const block = page.locator(`article[data-message-id="${result.messages[0].id}"] [data-block-index="0"]`).first();
    await expect(block).toBeVisible();
    await block.evaluate(element => {
      const root = element.closest<HTMLElement>("[data-reader-scroll-root]")!;
      const rect = element.getBoundingClientRect();
      root.scrollTop += rect.top - root.getBoundingClientRect().top + rect.height * .45 - 120;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const expected = await block.evaluate(element => {
      const root = element.closest<HTMLElement>("[data-reader-scroll-root]")!, line = root.getBoundingClientRect().top + 120;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let best = { offset: -1, distance: Infinity }, offset = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode, value = node.textContent ?? "";
        let unit = 0;
        for (const character of value) {
          const range = document.createRange(); range.setStart(node, unit); unit += character.length; range.setEnd(node, unit);
          const rect = range.getBoundingClientRect(), distance = Math.max(rect.top - line, line - rect.bottom, 0);
          if (rect.height > 0 && rect.width > 0 && distance < best.distance) best = { offset, distance };
          offset++;
        }
      }
      return best.offset;
    });
    expect(expected).toBeGreaterThan(100);
    expect(expected).toBeLessThan(Array.from(paragraph).length - 200);
    await openReaderAction(page, "save-position");
    let saved: AnnotationRead[] = [];
    await expect.poll(async () => { saved = await (await context.request.get(`${endpoint}/annotations`)).json(); return saved.length; }).toBe(1);
    expect(saved[0].start_offset).toBe(expected);
    expect(saved[0].quote).toBe(Array.from(paragraph).slice(expected, expected + 160).join(""));
    await page.getByRole("button", { name: "View", exact: true }).click();
    const panel = page.getByRole("region", { name: "批注", exact: true });
    await expect(panel.locator(`#annotation-${saved[0].id}`)).toBeVisible();
    await panel.getByRole("button", { name: "Manage", exact: true }).click();
    await panel.getByLabel("Annotation export scope").selectOption("selected");
    await expect(panel.getByRole("button", { name: "Export Markdown", exact: true })).toBeDisabled();
    await panel.locator(`#annotation-${saved[0].id}`).getByRole("button", { name: "Select annotation", exact: true }).click();
    const downloaded = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Export Markdown", exact: true }).click();
    const stream = await (await downloaded).createReadStream(), chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const markdown = Buffer.concat(chunks).toString("utf8");
    expect(markdown).toContain("Scope: selected · 1");
    expect(markdown).toContain(saved[0].quote!);
    expect(markdown).toContain("Context when saved");
    await page.screenshot({ path: info.outputPath(`reading-position-selected-${width}.png`) });
  } finally { await context.close(); await admin.dispose(); }
});

test("together cancels a tab, pane and close transition without losing a failed local notebook draft", async ({ browser, playwright, baseURL }, info) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), headers = { Origin: baseURL! };
  try {
    expect((await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
      email: `together-draft-${randomUUID()}@example.test`, password: "synthetic guard password", confirm_password: "synthetic guard password",
    } })).status()).toBe(201);
    expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: { locale_mode: "en-US" } })).ok()).toBe(true);
    const ids: string[] = [];
    for (const title of ["Synthetic guard A", "Synthetic guard B"]) {
      const response = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
        title, messages: [{ role: "user", content_markdown: "Synthetic reading body" }],
      } });
      expect(response.status()).toBe(201); ids.push((await response.json()).conversation.id);
    }
    await page.route(`**/api/conversations/${ids[0]}/notebook`, async route => {
      if (route.request().method() === "PUT") await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Synthetic save unavailable"}' });
      else await route.continue();
    });
    await page.goto(`/read-together?left=${ids[0]}&right=${ids[1]}`);
    const a = page.locator(`[data-together-pane="${ids[0]}"]`), b = page.locator(`[data-together-pane="${ids[1]}"]`);
    await expect(a).toBeVisible(); await expect(b).toBeVisible();
    await a.getByRole("button", { name: "Annotations and bookmarks" }).click();
    const panel = page.getByRole("region", { name: "批注", exact: true });
    await panel.locator('[data-annotation-tab="notebook"]').click();
    const title = panel.getByRole("textbox", { name: "Notebook title", exact: true });
    await expect(title).toBeEnabled();
    // Fail only this synthetic draft's writes, not reads, auth or other stores.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === "settings" && String(value?.key).startsWith("notebook-draft:")) throw new DOMException("Synthetic quota", "QuotaExceededError");
        return put.call(this, value, key);
      };
    });
    await title.fill("Synthetic text that must remain until explicit consent");
    await expect(panel.getByText("Local draft could not be saved", { exact: true })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Open conversations" });
    const confirmation = page.getByRole("dialog", { name: "Draft not saved on this device. Leave anyway?" });
    await tabs.getByRole("button", { name: "Synthetic guard B", exact: true }).click();
    await expect(confirmation).toBeVisible(); await page.keyboard.press("Escape");
    await expect(a).toHaveAttribute("data-pane-active", "true");
    await expect(title).toHaveValue("Synthetic text that must remain until explicit consent");
    await b.getByRole("button", { name: "Search this conversation" }).focus();
    await expect(confirmation).toBeVisible(); await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(a).toHaveAttribute("data-pane-active", "true");
    await expect(title).toHaveValue("Synthetic text that must remain until explicit consent");
    await tabs.getByRole("button", { name: "Close conversation Synthetic guard A", exact: true }).click();
    await expect(confirmation).toBeVisible(); await page.keyboard.press("Escape");
    await expect(title).toHaveValue("Synthetic text that must remain until explicit consent");
    await page.screenshot({ path: info.outputPath("together-retained-failed-draft.png") });
    await tabs.getByRole("button", { name: "Synthetic guard B", exact: true }).click();
    await confirmation.getByRole("button", { name: "Leave anyway", exact: true }).click();
    await expect(b).toHaveAttribute("data-pane-active", "true");
    await expect(confirmation).toHaveCount(0);
  } finally { await context.close(); await admin.dispose(); }
});

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
        await page.locator('[data-annotation-tab="bookmarks"]').click();
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
