import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires isolated API and a live worker");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: Context ZIP without attachment checkbox`, async ({ page, context, baseURL }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3107" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: width < 768 ? 740 : 1000 });
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
    const delivery = page.getByTestId("context-package-delivery");
    const manual = delivery.getByRole("textbox", { name: /交给 AI 的使用说明|Instructions for your AI/ });
    const instructions = locale === "zh-CN"
      ? "请使用我提供的接续 Skill 读取这个 .context.zip 并继续任务。"
      : "Use the supplied acquisition Skill to read this .context.zip and continue the task.";
    await expect(manual).toHaveCount(0);
    await page.evaluate(() => navigator.clipboard.writeText("Synthetic clipboard sentinel"));
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
    await delivery.getByRole("button", { name: /复制使用说明|Copy usage instructions/ }).click();
    await expect(delivery.getByRole("alert")).toContainText(/手动复制|copy them manually/);
    await expect(manual).toHaveValue(instructions);
    await expect(manual).toHaveAttribute("readonly", "");
    await expect(manual).toBeFocused();
    await expect(manual).toBeInViewport({ ratio: 1 });
    expect(await manual.evaluate(element => { const rect = element.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element; })).toBe(true);
    expect(await manual.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([0, instructions.length]);
    await page.keyboard.press("ControlOrMeta+C");
    if (width < 768) await expect(page.getByRole("dialog", { name: /^(导出|Export)$/ }).getByRole("button", { name: /^(关闭|Close)$/ })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`copy-fallback-${width}-${locale}.png`) });
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
    await page.evaluate(() => Reflect.deleteProperty(navigator, "clipboard"));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(instructions);
    await delivery.getByRole("button", { name: /复制使用说明|Copy usage instructions/ }).click();
    await expect(delivery.getByRole("status")).toContainText(/使用说明已复制|Usage instructions copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(instructions);
    await expect(manual).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`export-${width}-${locale}.png`) });
  });
}
