import { expect, test } from "@playwright/test";
import { settingsAdmin } from "./settings-test-helper";

test.use({ trace: "retain-on-failure", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL and authentication");

for (const [width, locale] of [[375, "zh-CN"], [1440, "en-US"]] as const) {
  for (const failedPart of ["annotations", "notebook", "conflicts"] as const) {
    test(`${width}px: ${failedPart} read failure is independent and retry preserves the notebook draft`, async ({ browser, playwright, baseURL }, info) => {
      const admin = await settingsAdmin(playwright.request, baseURL!);
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale });
      const page = await context.newPage(), headers = { Origin: baseURL! };
      try {
        const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
          email: `annotation-read-${failedPart}-${width}-${Date.now()}@example.test`,
          password: "synthetic annotation read password", confirm_password: "synthetic annotation read password",
        } });
        expect(registered.status()).toBe(201);
        expect((await context.request.patch(`${baseURL}/api/preferences`, { headers,
          data: { locale_mode: locale, theme_mode: width === 375 ? "light" : "dark" } })).status()).toBe(200);
        const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
          title: "Synthetic independent annotation reads", messages: [
            { role: "user", content_markdown: "Synthetic annotation source" },
            { role: "assistant", content_markdown: "Synthetic annotation reply" },
          ],
        } });
        expect(created.status()).toBe(201);
        const id = (await created.json()).conversation.id;
        const endpoint = `/api/conversations/${id}`;
        const messages = await (await context.request.get(`${baseURL}${endpoint}/messages`)).json();
        const added = await context.request.post(`${baseURL}${endpoint}/annotations`, { headers,
          data: { annotation_type: "bookmark", message_id: messages[0].id, comment_markdown: "Synthetic existing annotation" } });
        expect(added.status()).toBe(201);
        const annotationId = (await added.json()).id;
        const counts = { annotations: 0, notebook: 0, conflicts: 0, writes: 0 };
        let fail = true;
        await page.route(`**${endpoint}/**`, async route => {
          const path = new URL(route.request().url()).pathname;
          if (route.request().method() === "PUT" && path === `${endpoint}/notebook`) counts.writes++;
          const kind = path === `${endpoint}/annotations` ? "annotations"
            : path === `${endpoint}/notebook` ? "notebook" : path === `${endpoint}/notebook/conflicts` ? "conflicts" : null;
          if (route.request().method() === "GET" && kind) {
            counts[kind]++;
            if (fail && kind === failedPart) {
              await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Synthetic private upstream detail" }) });
              return;
            }
          }
          await route.continue();
        });
        await page.goto(`${baseURL}/conversations/${id}?annotations=open`);
        await page.getByRole("button", { name: /^(All|全部批注)$/ }).click();
        if (failedPart !== "annotations") await expect(page.locator(`#annotation-${annotationId}`)).toBeVisible();
        else {
          await expect(page.getByRole("button", { name: /^(Retry annotations|重试读取批注)$/ })).toBeVisible();
          await expect(page.getByText(/^(No annotations yet|暂无批注)$/)).toHaveCount(0);
        }
        const retryName = failedPart === "annotations" ? /^(Retry annotations|重试读取批注)$/
          : failedPart === "notebook" ? /^(Retry notebook|重试读取笔记)$/ : /^(Retry notebook conflicts|重试读取笔记冲突)$/;
        if (failedPart !== "annotations") await page.getByRole("button", { name: /^(Notes|精选笔记)$/ }).click();
        const editor = page.getByRole("region", { name: /^(Notebook editor|笔记编辑器)$/ });
        const title = page.getByRole("textbox", { name: /^(Notebook title|精选笔记标题)$/ });
        await expect(page.getByRole("button", { name: retryName })).toBeVisible();
        await expect(page.getByText("Synthetic private upstream detail")).toHaveCount(0);
        if (failedPart === "notebook") await expect(editor).toHaveCount(0);
        if (failedPart === "conflicts") {
          await expect(editor).toHaveAttribute("data-notebook-save-ready", "false");
          await title.fill("Synthetic retained draft during read failure"); await title.press("Tab");
          await expect(page.getByRole("button", { name: /^(Save notebook|保存笔记)$/ })).toBeDisabled();
          await expect(page.getByText(/^(Draft saved on this device|草稿已保存在本机)$/)).toBeVisible();
          expect(counts.writes).toBe(0);
        }
        await page.screenshot({ path: info.outputPath(`annotation-read-failed-${failedPart}-${width}.png`) });
        const before = { ...counts };
        fail = false;
        await page.getByRole("button", { name: retryName }).click();
        await expect(page.getByRole("button", { name: retryName })).toHaveCount(0);
        if (failedPart === "annotations") await expect(page.locator(`#annotation-${annotationId}`)).toBeVisible();
        else await expect(editor).toHaveAttribute("data-notebook-save-ready", "true");
        for (const kind of ["annotations", "notebook", "conflicts"] as const) {
          expect(counts[kind]).toBe(before[kind] + Number(kind === failedPart));
        }
        if (failedPart === "conflicts") {
          await expect(title).toHaveValue("Synthetic retained draft during read failure");
          expect(counts.writes).toBe(0);
          await page.getByRole("button", { name: /^(Save notebook|保存笔记)$/ }).click();
          await expect.poll(async () => (await (await context.request.get(`${baseURL}${endpoint}/notebook`)).json()).title)
            .toBe("Synthetic retained draft during read failure");
          expect(counts.writes).toBe(1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`annotation-read-recovered-${failedPart}-${width}.png`) });
      } finally { await context.close(); await admin.dispose(); }
    });
  }
}

for (const locale of ["zh-CN", "en-US"]) {
  test(`1440px ${locale}: hidden selections are disclosed and notes/deletion use the same scope`, async ({ browser, playwright, baseURL }, info) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale });
    const page = await context.newPage(), headers = { Origin: baseURL! };
    try {
      const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: {
        email: `annotation-batch-${locale}-${Date.now()}@example.test`, password: "synthetic batch password", confirm_password: "synthetic batch password",
      } });
      expect(registered.status()).toBe(201);
      expect((await context.request.patch(`${baseURL}/api/preferences`, { headers, data: {
        locale_mode: locale, theme_mode: locale === "zh-CN" ? "light" : "dark",
      } })).status()).toBe(200);
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: {
        title: "Synthetic annotation selection scope", messages: [{ role: "user", content_markdown: "Synthetic batch source" }, { role: "assistant", content_markdown: "Synthetic batch reply" }],
      } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id, endpoint = `${baseURL}/api/conversations/${id}`;
      const messages = await (await context.request.get(`${endpoint}/messages`)).json();
      const ids: string[] = [];
      for (const [index, name] of ["visible", "hidden"].entries()) {
        const added = await context.request.post(`${endpoint}/annotations`, { headers, data: {
          annotation_type: "bookmark", message_id: messages[index].id, comment_markdown: `Synthetic ${name} selection`,
        } });
        expect(added.status()).toBe(201); ids.push((await added.json()).id);
      }
      await page.goto(`${baseURL}/conversations/${id}?annotations=open`);
      await page.getByRole("button", { name: /^(All|全部批注)$/ }).click();
      await expect(page.locator(`#annotation-${ids[1]}`)).toBeVisible();
      await page.getByRole("button", { name: /^(Manage|管理)$/ }).click();
      await page.getByRole("button", { name: /^(Select visible|全选当前结果)$/ }).click();
      await page.getByPlaceholder(/^(Search annotations|搜索批注)$/).fill("visible");
      await expect(page.getByText(/2 selected; 1 hidden by filters|已选 2 项，其中 1 项不在当前筛选中/)).toBeVisible();
      await expect(page.getByRole("button", { name: /^(Apply style \(0\)|应用样式（0）)$/ })).toBeDisabled();
      await page.screenshot({ path: info.outputPath(`annotation-hidden-selection-${locale}.png`) });
      await page.getByRole("button", { name: /^(Add to notes|加入精选笔记) \(2\)$/ }).click();
      await expect(page.getByRole("region", { name: /^(Notebook editor|笔记编辑器)$/ })).toBeVisible();
      const saved = await (await context.request.get(`${endpoint}/notebook`)).json();
      expect(saved.blocks.map((block: { annotation_id: string }) => block.annotation_id).sort()).toEqual([...ids].sort());
      await page.getByRole("button", { name: /^(All|全部批注)$/ }).click();
      await page.getByRole("button", { name: /^(Delete|删除)$/ }).click();
      const confirmation = page.getByRole("dialog", { name: /Delete 2 annotations|删除 2 条批注/ });
      await expect(confirmation).toContainText(/1 are hidden by the current filters|其中 1 条不在当前筛选中/);
      await page.screenshot({ path: info.outputPath(`annotation-hidden-delete-confirmation-${locale}.png`) });
      await confirmation.getByRole("button", { name: /^(Delete|删除)$/ }).click();
      await expect.poll(async () => (await (await context.request.get(`${endpoint}/annotations`)).json()).length).toBe(0);
      await expect.poll(async () => (await (await context.request.get(`${endpoint}/notebook`)).json()).blocks.length).toBe(0);
      expect((await (await context.request.get(`${endpoint}/notebook`)).json()).blocks).toHaveLength(0);
      await expect(page.getByText(/^(0 selected|已选 0 项)$/)).toBeVisible();
    } finally { await context.close(); await admin.dispose(); }
  });
}
