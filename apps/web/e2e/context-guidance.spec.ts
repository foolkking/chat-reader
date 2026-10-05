import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires an isolated API and worker");

async function openAction(page: Page, width: number, name: RegExp) {
  if (width < 768) {
    await page.getByRole("button", { name: /^(更多|More)$/ }).click();
    await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name }).click();
  } else {
    const direct = page.getByRole("button", { name });
    if (!await direct.isVisible()) await page.getByRole("button", { name: /^(消息操作|Message actions)$/ }).click();
    await direct.click();
  }
}

for (const width of [375, 768, 1440]) {
  test(`${width}px: optional first guide, real maintenance ZIP and uncovered-range reminder`, async ({ page, context, baseURL }, info) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3107" });
    await page.setViewportSize({ width, height: width < 768 ? 844 : 950 });
    await settingsAppearance(page.request, baseURL!, width === 768 ? "en-US" : "zh-CN");
    const payload = { metadata: { title: "Synthetic guidance", powered_by: "ChatGPT Exporter" }, messages: Array.from({ length: 105 }, (_, i) => ({ role: i % 2 ? "Response" : "Prompt", say: `Synthetic turn ${i + 1}` })) };
    const preview = await page.request.post("/api/imports/preview", { multipart: { files: { name: "synthetic-guidance.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) } } });
    expect(preview.status()).toBe(200);
    const importId = (await preview.json()).import_id;
    const commit = await page.request.post(`/api/imports/${importId}/commit`);
    expect([200, 202]).toContain(commit.status());
    const statusURL = `/api/imports/${importId}/status`;
    await expect.poll(async () => {
      const response = await page.request.get(statusURL);
      expect(response.status()).toBe(200);
      return (await response.json()).status;
    }, { message: "The real import worker must finish before guidance is tested" }).toBe("committed");
    const persisted = await (await page.request.get(statusURL)).json();
    expect(persisted.conversation_ids).toHaveLength(1);
    const id = persisted.conversation_ids[0];
    const endpoint = `/api/conversations/${id}/continuation`;
    await page.goto(`/conversations/${id}`);
    await openAction(page, width, /^(接续|Continuation)$/);
    const guide = page.getByRole("region", { name: /^(接续使用指引|Continuation guide)$/ });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText(/短对话可以直接导出|Short conversations can be exported directly/);
    await page.screenshot({ path: info.outputPath(`first-guide-${width}.png`) });
    await page.getByRole("button", { name: /关闭使用指引|Close continuation guide/ }).click();
    await expect(guide).toHaveCount(0);
    await page.getByRole("button", { name: /关闭接续|Close continuation$/ }).click();
    await page.reload();
    await openAction(page, width, /^(接续|Continuation)$/);
    await expect(guide).toHaveCount(0);
    await page.getByRole("button", { name: /如何使用 Current|How to use Current/ }).focus();
    await page.keyboard.press("Enter");
    await expect(guide).toBeVisible();
    await page.getByRole("button", { name: /^(准备维护|Prepare maintenance)$/ }).click();
    const preparation = page.getByTestId("maintenance-preparation");
    await preparation.getByRole("button", { name: /生成导出包|Generate export/ }).click();
    const download = preparation.getByRole("button", { name: /下载上下文包|Download Context Package/ });
    await expect(download).toBeVisible();
    const packagePromise = page.waitForEvent("download"); await download.click();
    const artifact = await packagePromise;
    const entries = unzipSync(await readFile((await artifact.path())!));
    expect(strFromU8(entries["conversation.canjsonl"])).toContain("Synthetic turn 105");
    const skillPromise = page.waitForEvent("download");
    await preparation.getByRole("link", { name: /下载维护 Skill|Download maintenance Skill/ }).click();
    const skill = await skillPromise;
    expect(skill.suggestedFilename()).toMatch(/\.zip$/);
    expect(createHash("sha256").update(await readFile((await skill.path())!)).digest("hex")).toBe(createHash("sha256").update(await readFile("../../tools/context-skills/default-bundles/context-continuation-maintainer.zip")).digest("hex"));
    await page.evaluate(() => navigator.clipboard.writeText("Synthetic maintenance clipboard sentinel"));
    await page.evaluate(width => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => { if (width === 1440) throw new Error("Synthetic synchronous Clipboard failure"); return Promise.reject(new DOMException("Synthetic denied copy", "NotAllowedError")); },
    } }), width);
    const instructions = width === 768
      ? "Use the supplied maintenance Skill to update Current and Index in this .context.zip. Preserve the raw conversation and attachments and return a new .context.zip."
      : "请使用我提供的维护 Skill 更新这个 .context.zip 内的 Current 和 Index，保留原始对话和附件，输出新的 .context.zip。";
    const manual = preparation.getByRole("textbox", { name: /交给 AI 的使用说明|Instructions for your AI/ });
    await preparation.getByRole("button", { name: /复制使用说明|Copy usage instructions/ }).click();
    await expect(preparation.getByRole("alert")).toContainText(/手动复制|copy them manually/);
    await expect(manual).toHaveValue(instructions);
    await expect(manual).toBeFocused();
    await expect(manual).toBeInViewport({ ratio: 1 });
    expect(await manual.evaluate(element => { const rect = element.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element; })).toBe(true);
    expect(await manual.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([0, instructions.length]);
    await page.keyboard.press("ControlOrMeta+C");
    await page.screenshot({ path: info.outputPath(`maintenance-copy-fallback-${width}.png`) });
    await page.evaluate(() => Reflect.deleteProperty(navigator, "clipboard"));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(instructions);
    await preparation.getByRole("button", { name: /复制使用说明|Copy usage instructions/ }).click();
    await expect(preparation.getByRole("status")).toContainText(/使用说明已复制|Usage instructions copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(instructions);
    await expect(manual).toHaveCount(0);
    await page.getByRole("button", { name: /关闭接续|Close continuation$/ }).click();
    await openAction(page, width, /^(导出|Export)$/);
    const hint = page.getByRole("complementary", { name: /接续维护建议|Continuation suggestion/ });
    await expect(hint).toContainText("105");
    if (width === 768) {
      await hint.getByRole("button", { name: /此对话不再提示|Don't remind for this conversation/ }).click();
      await page.reload();
      await openAction(page, width, /^(导出|Export)$/);
      await expect(hint).toHaveCount(0);
      await page.reload();
      await openAction(page, width, /^(接续|Continuation)$/);
      await page.getByRole("button", { name: /如何使用 Current|How to use Current/ }).click();
      await page.getByRole("button", { name: /恢复此对话的维护提示|Restore maintenance suggestions for this conversation/ }).click();
      await page.getByRole("button", { name: /关闭接续|Close continuation$/ }).click();
      await openAction(page, width, /^(导出|Export)$/);
      await expect(hint).toContainText("105");
    }
    const index = { conversation_id: id, coverage: { seq_start: 1, seq_end: 100 }, segments: [{ seq_start: 1, seq_end: 100, title: "Indexed history" }] };
    if (width === 1440) {
      await page.getByLabel(/包含附件|Include attachments/).check();
      await page.getByRole("button", { name: /生成导出包|Generate export/ }).click();
      await expect(page.getByRole("button", { name: /下载上下文包|Download Context Package/ })).toBeVisible();
    }
    await page.getByRole("button", { name: /前往 Current|Open Current/ }).click();
    await expect(guide).toBeVisible();
    await expect(page.getByTestId("maintenance-preparation")).toHaveCount(0);
    if (width === 1440) {
      await page.getByRole("button", { name: /^(更新文件|Update files)$/ }).click();
      await page.getByLabel('Current (.md, 1 MiB)', { exact: true }).setInputFiles({ name: 'current.md', mimeType: 'text/markdown', buffer: Buffer.from('# Updated guidance context') });
      await page.getByLabel('Index (.json, 8 MiB)', { exact: true }).setInputFiles({ name: 'index.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(index)) });
      await page.getByRole("button", { name: /保存上传文件|Save uploaded files/ }).click();
      await expect(page.getByText(/^(文件已更新。|Files updated\.)$/)).toBeVisible();
    }
    await page.getByRole("button", { name: /关闭接续|Close continuation$/ }).click();
    await openAction(page, width, /^(导出|Export)$/);
    await expect(hint).toHaveCount(0);
    if (width === 1440) {
      await expect(page.getByLabel(/包含附件|Include attachments/)).toBeChecked();
      await expect(page.getByRole("button", { name: /下载上下文包|Download Context Package/ })).toHaveCount(0);
      await page.getByRole("button", { name: /生成导出包|Generate export/ }).click();
      const updatedDownload = page.getByRole("button", { name: /下载上下文包|Download Context Package/ });
      await expect(updatedDownload).toBeVisible();
      const updatedPromise = page.waitForEvent("download"); await updatedDownload.click();
      const updatedPackage = unzipSync(await readFile((await (await updatedPromise).path())!));
      expect(strFromU8(updatedPackage['continuation/current.md'])).toBe('# Updated guidance context');
      expect(JSON.parse(strFromU8(updatedPackage['continuation/index.json']))).toEqual(index);
    } else {
      const saved = await page.request.put(endpoint + "/files", { multipart: { base_generation: "0", index: { name: "index.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(index)) } } });
      expect(saved.status()).toBe(200);
    }
    const counts = await (await page.request.get(endpoint + "/guidance")).json();
    expect(counts.unindexed_messages).toBe(5);
    expect(counts.suggest_maintenance).toBe(false);
    await page.reload();
    await openAction(page, width, /^(导出|Export)$/);
    await expect(hint).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`guidance-${width}.png`) });
  });
}

test("quick start is opt-in, closes and hands off to real import", async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, "zh-CN");
  await page.goto("/");
  await page.getByRole("button", { name: /^设置$/ }).click();
  await page.getByRole("button", { name: /^帮助与诊断$/ }).click();
  const quick = page.getByRole("region", { name: /^快速入门$/ });
  await expect(quick).toHaveCount(0);
  await page.getByRole("button", { name: /^快速入门 · 3 步$/ }).click();
  await expect(quick.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "关闭入门引导" }).click();
  await expect(quick).toHaveCount(0);
  await page.getByRole("button", { name: /^快速入门 · 3 步$/ }).click();
  await quick.getByRole("button", { name: "开始导入" }).click();
  const dialog = page.getByRole("dialog", { name: "导入数据" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("import-file-input")).toHaveAttribute("accept", /\.json/);
  await expect(page.getByRole("dialog", { name: "帮助与诊断" })).toHaveCount(0);
});
