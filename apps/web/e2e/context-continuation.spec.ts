import { zipSync, strToU8 } from "fflate";
import { expect, test } from "@playwright/test";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires isolated API and a live worker");

for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: direct file updates survive refresh and retain only three snapshots`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await settingsAppearance(page.request, baseURL!, locale);
    const created = await page.request.post("/api/conversations", { data: {
      title: "Synthetic continuation", messages: [
        { role: "user", content_markdown: "Synthetic question" },
        { role: "assistant", content_markdown: "Synthetic answer" },
      ],
    } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).conversation.id;
    const endpoint = `/api/conversations/${id}/continuation`;
    const openPanel = async () => {
      await page.goto(`/conversations/${id}`);
      await expect(page.locator("article[data-message-id]").first()).toBeVisible();
      if (width < 768) {
        await page.getByRole("button", { name: /^(更多|More)$/ }).click();
        await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name: /^(接续|Continuation)$/ }).click();
      } else {
        await page.getByRole("button", { name: /^(接续|Continuation)$/ }).click();
      }
    };
    await openPanel();
    const panel = page.getByRole("region", { name: /^(上下文接续|Context continuation)$/ });
    await expect(panel.locator('input[type="file"]')).toHaveCount(0);
    await panel.getByRole("button", { name: /^(更新文件|Update files)$/ }).click();
    await panel.getByLabel("Current (.md, 1 MiB)").setInputFiles({ name: "current.md", mimeType: "text/markdown", buffer: Buffer.from("# Synthetic current 1") });
    await panel.getByRole("button", { name: /^(保存上传文件|Save uploaded files)$/ }).click();
    await expect(panel.getByRole("status").filter({ hasText: /文件已更新|Files updated/ })).toBeVisible();
    await openPanel();
    await expect(panel.getByRole("heading", { name: "Synthetic current 1", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: /^(历史|History)$/ }).click();
    const view = panel.getByRole("button", { name: /^(查看 current|View current)$/ });
    await view.focus(); await page.keyboard.press("Enter");
    await expect(panel.locator("pre")).toHaveText("# Synthetic current 1");
    await panel.getByRole("button", { name: /^(更新文件|Update files)$/ }).click();
    for (let update = 2; update <= 4; update++) {
      await panel.getByLabel("Index (.json, 8 MiB)").setInputFiles({ name: "index.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ note: `Synthetic update ${update}` })) });
      await panel.getByRole("button", { name: /^(保存上传文件|Save uploaded files)$/ }).click();
      await expect.poll(async () => (await (await page.request.get(endpoint)).json()).generation).toBe(update);
      await expect(panel.getByRole("status").filter({ hasText: /文件已更新|Files updated/ })).toBeVisible();
    }
    const rows = await (await page.request.get(endpoint + "/revisions")).json();
    expect(rows).toHaveLength(3);
    expect(await (await page.request.get(endpoint + `/revisions/${rows[0].id}/members/current`)).text()).toBe("# Synthetic current 1");
    expect((await page.request.get(endpoint + "/candidates")).status()).toBe(410);
    await expect(panel.getByRole("button", { name: /校验候选|Validate candidate|采用此接续版本|Adopt this continuation/ })).toHaveCount(0);
    await panel.getByRole("button", { name: "Index", exact: true }).click();
    await expect(panel.getByText("Synthetic update 4", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: /^(编辑|Edit)$/ }).click();
    await panel.getByRole("textbox").fill('{"segments":');
    await panel.getByRole("button", { name: /^(保存|Save)$/ }).click();
    await expect(panel.getByRole("alert")).toContainText("JSON");
    await panel.getByRole("textbox").fill('{"segments":[{"title":"Design decisions","about":"Synthetic index reading"}]}');
    await panel.getByRole("button", { name: /^(保存|Save)$/ }).click();
    await expect(panel.getByText("Design decisions", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Current", exact: true }).click();
    await panel.getByRole("button", { name: /^(编辑|Edit)$/ }).click();
    const edited = "---\nschema_version: custom-human-notes\n---\n# Next steps\n\nContinue the reading experience with **clear context**.\n\n## Decisions\n\n- Keep personal files.\n- Save the latest three updates.\n\n## Next action\n\nReview the continuation alongside the conversation.";
    await panel.getByRole("textbox", { name: /^(编辑 current|Edit current)$/ }).fill(edited);
    await page.keyboard.press("Control+s");
    await expect(panel.getByRole("heading", { name: "Next steps", exact: true })).toBeVisible();
    const latest = await (await page.request.get(endpoint + "/revisions")).json();
    expect(await (await page.request.get(endpoint + `/revisions/${latest[0].id}/members/current`)).text()).toBe(edited);
    await panel.getByRole("button", { name: /^(编辑|Edit)$/ }).click();
    await panel.getByRole("textbox").fill(edited + "\nUnsaved local draft");
    const generation = (await (await page.request.get(endpoint)).json()).generation;
    expect((await page.request.put(endpoint + "/files", { multipart: { base_generation: String(generation), index: { name: "index.json", mimeType: "application/json", buffer: Buffer.from('{"note":"Other window"}') } } })).status()).toBe(200);
    await panel.getByRole("button", { name: /^(保存|Save)$/ }).click();
    await expect(panel.getByRole("alert")).toContainText(/另一个窗口|Another window/);
    await expect(panel.getByRole("textbox")).toHaveValue(edited + "\nUnsaved local draft");
    page.once("dialog", dialog => dialog.accept());
    await panel.getByRole("button", { name: /^(取消|Cancel)$/ }).click();
    await panel.getByRole("button", { name: /^(更新文件|Update files)$/ }).click();
    await panel.getByText(/^(从 Context Package 更新|Update from Context Package)$/).click();
    await panel.getByLabel("Context Package (.context.zip)").setInputFiles({ name: "synthetic.context.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({
      "manifest.json": strToU8("{}"), "conversation.canjsonl": strToU8("Unused raw"), "continuation/index.json": strToU8('{"note":"From package"}'),
    })) });
    await panel.getByRole("button", { name: /^(上传并更新文件|Upload and update files)$/ }).click();
    await expect(panel.getByRole("status").filter({ hasText: /整包中的接续文件已更新|Continuation files updated from package/ })).toBeVisible();
    const returnedRows = await (await page.request.get(endpoint + "/revisions")).json();
    expect(returnedRows).toHaveLength(3);
    expect(await (await page.request.get(endpoint + `/revisions/${returnedRows[0].id}/members/current`)).text()).toBe(edited);
    expect(await (await page.request.get(endpoint + `/revisions/${returnedRows[0].id}/members/index`)).json()).toEqual({ note: "From package" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.getByRole("button", { name: "Current", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Next steps", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`continuation-${width}-${locale}.png`) });
    await panel.getByRole("button", { name: /^(编辑|Edit)$/ }).click();
    await page.screenshot({ path: testInfo.outputPath(`continuation-edit-${width}-${locale}.png`) });
    await panel.getByRole("button", { name: /^(取消|Cancel)$/ }).click();
    await page.getByRole("button", { name: /^(关闭接续|Close continuation)$/ }).click();
    await expect(page.getByRole("button", { name: width < 768 ? /^(更多|More)$/ : /^(接续|Continuation)$/ })).toBeFocused();
    if (width >= 768) await expect(page.locator('[data-reader-header-action="annotations"] + [data-reader-header-action="continuation"]')).toHaveCount(1);
  });
}
