import { expect, test } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { randomUUID } from "node:crypto";

test.use({ trace: "retain-on-failure", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, authentication and worker");

for (const [width, locale] of [[375, "zh-CN"], [1440, "en-US"]] as const) {
  test(`rapid notebook typing retains the complete draft through reload and save at ${width}`, async ({ browser, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const headers = { Origin: baseURL! };
    try {
      const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
        email: `draft-burst-${width}-${Date.now()}@example.test`, password: "synthetic burst password", confirm_password: "synthetic burst password",
      } });
      expect(registered.status()).toBe(201);
      expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: { locale_mode: locale } })).status()).toBe(200);
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
        title: "Synthetic notebook typing", messages: [{ role: "user", content_markdown: "Synthetic source" }, { role: "assistant", content_markdown: "Synthetic answer" }],
      } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id;
      const url = `${baseURL}/api/conversations/${id}/notebook`;
      const original = await (await context.request.get(url)).json();
      const blocks = [
        { id: randomUUID(), type: "markdown", markdown: "" },
        { id: randomUUID(), type: "markdown", markdown: "Unchanged second block" },
      ];
      const seeded = await context.request.put(url, { headers, data: { base_revision: original.revision, title: "Synthetic title", blocks } });
      expect(seeded.status()).toBe(200);
      const base = await seeded.json();
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.route(`**/api/conversations/${id}/notebook`, route => route.request().method() === "PUT" ? route.abort("failed") : route.continue());
      await page.goto(`${baseURL}/conversations/${id}?annotations=open`);
      await page.getByRole("button", { name: /^(Notes|精选笔记)$/ }).click();
      const editor = page.getByRole("region", { name: /^(Notebook editor|笔记编辑器)$/ });
      await expect(editor).toHaveAttribute("data-notebook-save-ready", "true");
      const body = editor.getByRole("textbox", { name: /^(Notebook text|笔记正文) 1$/ });
      // Real keyboard input and durable reload; no claim about storage latency.
      const typed = "Synthetic rapid typing preserves the final characters.";
      await body.pressSequentially(typed);
      await body.press("Enter"); await body.press("Enter"); await body.pressSequentially("Final line.");
      const expected = `${typed}\n\nFinal line.`;
      await expect(body).toHaveValue(expected);
      await expect(editor.getByText(/^(Draft saved on this device|草稿已保存在本机)$/)).toBeVisible();
      await page.reload();
      await page.getByRole("button", { name: /^(Notes|精选笔记)$/ }).click();
      await expect(body).toHaveValue(expected);
      await expect(editor.getByRole("textbox", { name: /^(Notebook text|笔记正文) 2$/ })).toHaveValue(blocks[1].markdown);
      expect((await (await context.request.get(url)).json()).revision).toBe(base.revision);
      await page.unroute(`**/api/conversations/${id}/notebook`);
      await expect(editor).toHaveAttribute("data-notebook-save-ready", "true");
      await editor.getByRole("button", { name: /^(Save notebook|保存笔记)$/ }).click();
      await expect.poll(async () => (await (await context.request.get(url)).json()).blocks)
        .toMatchObject([{ ...blocks[0], markdown: expected }, blocks[1]]);
      expect((await (await context.request.get(url)).json()).revision).toBe(base.revision + 1);
      await expect(editor.getByRole("alert")).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    } finally { await context.close(); await admin.dispose(); }
  });

  test(`notebook draft survives failed save and reload, then compares a newer revision at ${width}`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(100_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
    const page = await context.newPage(), headers = { Origin: baseURL! };
    try {
      const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `draft-${width}-${Date.now()}@example.test`, password: "synthetic notebook draft password", confirm_password: "synthetic notebook draft password" } });
      expect(registered.status()).toBe(201);
      expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: { locale_mode: locale, theme_mode: width === 375 ? "light" : "dark" } })).status()).toBe(200);
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic notebook draft", messages: [{ role: "user", content_markdown: "Synthetic draft question" }, { role: "assistant", content_markdown: "Synthetic draft answer" }] } });
      expect(created.status()).toBe(201);
      const conversationId = (await created.json()).conversation.id;
      const note = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
      await page.route(`**/api/conversations/${conversationId}/notebook`, (route) => route.request().method() === "PUT" ? route.abort("failed") : route.continue());
      await page.goto(`${baseURL}/conversations/${conversationId}?annotations=open`);
      await page.getByRole("button", { name: /^(Notes|精选笔记)$/ }).click();
      const editor = page.getByRole("region", { name: /Notebook editor|笔记编辑器/ });
      const title = page.getByRole("textbox", { name: /^(Notebook title|精选笔记标题)$/ });
      await expect(page.getByRole("textbox", { name: locale === "zh-CN" ? "精选笔记标题" : "Notebook title", exact: true })).toHaveCount(1);
      await expect(editor).toHaveAttribute("data-notebook-save-ready", "true");
      await title.fill("Synthetic retained notebook draft");
      // Draft persistence can trigger independent sync reads. Wait for the
      // current notebook/conflict read before explicitly attempting the save.
      await expect(editor.getByText(/Draft saved on this device|草稿已保存在本机/, { exact: true })).toBeVisible();
      await expect(editor).toHaveAttribute("data-notebook-save-ready", "true");
      await editor.getByRole("button", { name: /^(Save notebook|保存笔记)$/ }).click();
      await expect(page.getByRole("alert").filter({ hasText: /Notebook not saved|笔记未保存/ })).toBeVisible();
      await expect(page.getByText(/Draft saved on this device|草稿已保存在本机/, { exact: true })).toBeVisible();
      if (width === 1440) {
        const otherTab = await context.newPage();
        await otherTab.goto(`${baseURL}/recent`);
        await otherTab.getByRole("button", { name: "Settings", exact: true }).click();
        await otherTab.getByRole("button", { name: /Offline & sync/ }).click();
        const center = otherTab.getByRole("dialog", { name: "Offline & sync", exact: true });
        await center.getByRole("tab", { name: "Pending edits", exact: true }).click();
        const downloaded = otherTab.waitForEvent("download");
        await center.getByRole("button", { name: "Export local edits and drafts", exact: true }).click();
        const archive = await downloaded, path = info.outputPath("synthetic-notebook-draft.zip"); await archive.saveAs(path);
        const content = JSON.parse(strFromU8(unzipSync(await readFile(path))["changes.json"]));
        expect(content.drafts[0].value.title).toBe("Synthetic retained notebook draft");
        expect(content.drafts[0].value.base.revision).toBe(note.revision);
        await center.getByRole("link", { name: "Synthetic retained notebook draft", exact: true }).click();
        await expect(otherTab.getByRole("textbox", { name: /^(Notebook title|精选笔记标题)$/ })).toHaveValue("Synthetic retained notebook draft");
        expect(new URL(otherTab.url()).searchParams.has("notebookDraft")).toBe(true);
        await otherTab.close();
      }
      await page.reload();
      await page.getByRole("button", { name: /^(Notes|精选笔记)$/ }).click();
      await expect(title).toHaveValue("Synthetic retained notebook draft");
      expect((await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json()).title).toBe(null);
      expect((await context.request.put(`${baseURL}/api/conversations/${conversationId}/notebook`, { headers, data: { base_revision: note.revision, title: "Synthetic newer server note", blocks: [] } })).status()).toBe(200);
      await page.unroute(`**/api/conversations/${conversationId}/notebook`);
      await page.getByRole("button", { name: /^(Save notebook|保存笔记)$/ }).click();
      await expect(page.getByRole("alert").filter({ hasText: /Notebook not saved|笔记未保存/ })).toBeVisible();
      await page.getByRole("button", { name: /Compare current version|查看当前版本/, exact: true }).click();
      await expect(page.getByRole("region", { name: /Current version comparison|当前版本比较/ })).toContainText("Synthetic newer server note");
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/notebook-draft-${width}.png` });
      await page.getByRole("button", { name: /Apply this draft|应用此草稿/, exact: true }).click();
      await expect.poll(async () => (await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json()).title).toBe("Synthetic retained notebook draft");
      const saved = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
      expect(saved.revision).toBe(3);
      await expect(editor.getByRole("alert")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); await admin.dispose(); }
  });
}
