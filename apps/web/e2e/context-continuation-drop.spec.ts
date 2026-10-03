import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires isolated API and live worker");

async function drop(page: Page, name: string, data: Uint8Array) {
  const transfer = await page.evaluateHandle(({ name, bytes }) => {
    const value = new DataTransfer();
    value.items.add(new File([new Uint8Array(bytes)], name));
    return value;
  }, { name, bytes: Array.from(data) });
  await page.getByTestId("continuation-drop-target").dispatchEvent("dragenter", { dataTransfer: transfer });
  await page.getByTestId("continuation-drop-target").dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}

for (const width of [375, 1440]) {
  test(`${width}px: drop updates only the intended file, preserves drafts on failure and resumes package updates`, async ({ page, baseURL }, testInfo) => {
    const locale = width === 375 ? "zh-CN" : "en-US";
    await page.setViewportSize({ width, height: 950 });
    await settingsAppearance(page.request, baseURL!, locale);
    const created = await page.request.post("/api/conversations", { data: { title: "Synthetic drag updates", messages: [
      { role: "user", content_markdown: "Synthetic original question" },
      { role: "assistant", content_markdown: "Synthetic original answer" },
    ] } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).conversation.id;
    const endpoint = `/api/conversations/${id}/continuation`;
    const open = async () => {
      await page.goto(`/conversations/${id}`);
      if (width < 768) {
        await page.getByRole("button", { name: /^(更多|More)$/ }).click();
        await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name: /^(接续|Continuation)$/ }).click();
      } else await page.getByRole("button", { name: /^(接续|Continuation)$/ }).click();
      await expect(page.getByTestId("continuation-drop-target")).toBeVisible();
    };
    const panel = page.getByRole("region", { name: /^(上下文接续|Context continuation)$/ });
    const generation = async () => (await (await page.request.get(endpoint)).json()).generation;
    const read = async (name: string) => {
      const status = await (await page.request.get(endpoint)).json();
      return (await page.request.get(`${endpoint}/revisions/${status.adopted_revision_id}/members/${name}`)).text();
    };
    await open();
    await drop(page, "current.md", strToU8("# Dropped current\n\nSynthetic saved state."));
    await expect.poll(generation).toBe(1);
    await expect(panel.getByRole("heading", { name: "Dropped current" })).toBeVisible();
    await drop(page, "index.json", strToU8('{"note":"Wrong tab"}'));
    await expect(panel.getByRole("alert")).toContainText("Index");
    expect(await generation()).toBe(1);
    await panel.getByRole("button", { name: "Index", exact: true }).click();
    await drop(page, "index.json", strToU8('{"note":"Dropped index"}'));
    await expect.poll(generation).toBe(2);
    expect(await read("current")).toContain("Dropped current");
    await expect(panel.getByText("Dropped index", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: /^(编辑|Edit)$/ }).click();
    await panel.getByRole("textbox").fill('{"note":"Unsaved draft"}');
    page.once("dialog", dialog => dialog.dismiss());
    await drop(page, "index.json", strToU8('{"note":"Declined replacement"}'));
    await expect(panel.getByRole("textbox")).toHaveValue('{"note":"Unsaved draft"}');
    expect(await generation()).toBe(2);
    page.once("dialog", dialog => dialog.accept());
    await drop(page, "index.json", strToU8("broken JSON"));
    await expect(panel.getByRole("alert")).toContainText(/操作未完成|Operation incomplete/);
    await expect(panel.getByRole("textbox")).toHaveValue('{"note":"Unsaved draft"}');
    expect(await read("index")).toBe('{"note":"Dropped index"}');
    page.once("dialog", dialog => dialog.accept());
    await drop(page, "index.json", strToU8('{"note":"Replaced index"}'));
    await expect.poll(generation).toBe(3);
    await expect(panel.getByText("Replaced index", { exact: true })).toBeVisible();
    const bundle = zipSync({ "manifest.json": strToU8("{}"),
      "conversation.canjsonl": strToU8("Must never replace canonical messages"),
      "continuation/current.md": strToU8("# Package current"),
      "continuation/index.json": strToU8('{"note":"Package index"}'),
    });
    await drop(page, "synthetic.context.zip", bundle);
    await expect(panel.getByRole("status").filter({ hasText: /正在后台更新|Updating continuation|整包中的接续文件已更新|Continuation files updated from package/ })).toBeVisible();
    await page.getByRole("button", { name: /^(关闭接续|Close continuation)$/ }).click();
    await open();
    await expect.poll(generation).toBe(4);
    await panel.getByRole("button", { name: "Index", exact: true }).click();
    await expect(panel.getByText("Package index", { exact: true })).toBeVisible();
    expect(await read("current")).toBe("# Package current");
    expect(await (await page.request.get(`${endpoint}/revisions`)).json()).toHaveLength(3);
    await panel.getByRole("button", { name: "Current", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Package current" })).toBeVisible();
    await expect(page.getByText("Synthetic original answer", { exact: true }).first()).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`drop-${width}.png`) });
  });
}
