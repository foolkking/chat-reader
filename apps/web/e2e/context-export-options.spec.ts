import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires isolated API and a live worker");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: Context ZIP without attachment checkbox`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await settingsAppearance(page.request, baseURL!, locale);
    const created = await page.request.post("/api/conversations", { data: {
      title: "Synthetic Context export", messages: [
        { role: "user", content_markdown: "Synthetic browser question" },
        { role: "assistant", content_markdown: "Synthetic browser answer" },
      ],
    } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).conversation.id;
    await page.goto(`/conversations/${id}`);
    await expect(page.locator("article[data-message-id]").first()).toBeVisible();
    if (width < 768) {
      await page.getByRole("button", { name: /^(更多|More)$/ }).click();
      await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name: /^(导出|Export)$/ }).click();
    } else {
      await page.getByRole("button", { name: /^(消息操作|Message actions)$/ }).click();
      await page.getByRole("button", { name: /^(导出|Export)$/ }).click();
    }
    await expect(page.getByRole("button", { name: /^(交给 AI|For AI)$/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("checkbox", { name: /^(包含附件|Include attachments)/ })).not.toBeChecked();
    await page.getByRole("checkbox", { name: /包含接续文件|Include continuation files/ }).uncheck();
    await page.getByRole("button", { name: /生成导出包|Generate export/, exact: true }).click();
    const download = page.getByRole("button", { name: /下载上下文包|Download Context Package/, exact: true });
    await expect(download).toBeVisible();
    const saved = page.waitForEvent("download");
    await download.click();
    const file = await saved;
    expect(file.suggestedFilename()).toMatch(/\.context\.zip$/);
    const members = unzipSync(await readFile((await file.path())!));
    const manifest = JSON.parse(new TextDecoder().decode(members["manifest.json"]));
    expect(manifest.attachments.policy).toBe("metadata_only");
    expect(manifest.extensions.chat_reader_continuation_export.status).toBe("omitted_by_request");
    expect(new TextDecoder().decode(members["conversation.canjsonl"])).toContain("Synthetic browser question");
    const records = new TextDecoder().decode(members["conversation.canjsonl"]).trim().split("\n").map(line => JSON.parse(line));
    expect(records[0].format).toBe("chat-reader-canonical-jsonl");
    expect(records[0].version).toBe(2);
    expect(records.filter(record => record.record_type === "message").map(record => record.current_version.content_markdown)).toEqual([
      "Synthetic browser question", "Synthetic browser answer",
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`export-${width}-${locale}.png`) });
  });
}
