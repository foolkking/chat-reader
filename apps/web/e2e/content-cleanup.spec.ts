import { expect, test, type Locator, type Page } from "@playwright/test";
import { openSettingsNoiseReview, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3107" } });

test.skip(
  process.env.E2E_CONTENT_CLEANUP !== "1",
  "E2E_CONTENT_CLEANUP=1 is required",
);

test.beforeEach(async ({ page }) => {
  if (process.env.E2E_SETTINGS_MAILBOX === "1") {
    expect((await page.request.post("/api/auth/login", { data: { email: process.env.E2E_AUTH_EMAIL, password: process.env.E2E_AUTH_PASSWORD } })).ok()).toBeTruthy();
  }
});

test("reviews a deterministic noise occurrence without silently changing content", async ({
  page,
}, testInfo) => {
  const created = await page.request.post("/api/conversations", {
    data: {
      title: "Content cleanup browser fixture",
      messages: [
        { role: "user", content_markdown: "Safe cleanup question" },
        {
          role: "assistant",
          content_markdown: "🙂 Answer before Cite turn2search1 and after.",
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const payload = (await created.json()) as { conversation: { id: string } };
  const conversationId = payload.conversation.id;
  let cleanupError: Error | null = null;

  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page
      .locator("article[data-message-id]")
      .filter({ hasText: "🙂 Answer before Cite turn2search1 and after." });
    await expect(assistant).toBeVisible();
    await assistant
      .getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ })
      .click();
    const editor = page
      .getByTestId("source-editor-codemirror")
      .locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+Home");
    for (const _character of Array.from("🙂 Answer before ")) {
      await page.keyboard.press("ArrowRight");
    }
    for (const _character of Array.from("Cite turn2search1")) {
      await page.keyboard.press("Shift+ArrowRight");
    }
    await expect(
      page.getByTestId("source-editor-cleanup-selection"),
    ).toBeEnabled();
    await page.getByTestId("source-editor-cleanup-selection").click();
    await expect(
      page.getByRole("heading", { name: /^(Clean noise|清理噪声)$/ }),
    ).toBeVisible();
    await expect(
      page.getByTestId("content-cleanup-match"),
    ).toBeVisible();
    await expect(page.getByText(/完整可见引用协议|Visible citation protocol/)).toBeVisible();
    const candidateCheckbox = page.getByRole("checkbox", {
      name: /Process Cite turn2search1|处理 Cite turn2search1/,
    });
    await expect(candidateCheckbox).not.toBeChecked({ timeout: 30_000 });
    await candidateCheckbox.check();
    await expect(page.getByText(/选择已保存|Selection saved/)).toBeVisible();
    await expect(page.getByTestId("content-cleanup-scroll")).toHaveCSS(
      "overflow-y",
      "auto",
    );
    await page.getByRole("button", { name: /Rules|规则库/ }).click();
    await expect(
      page.getByRole("heading", { name: /Noise rule library|噪声规则库/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Back to cleanup review|返回清理审查/ })
      .click();
    await page.screenshot({
      path: testInfo.outputPath("content-cleanup-source-dialog.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDialog = page
      .getByTestId("content-cleanup-dialog")
      .locator(":scope > div");
    await expect(mobileDialog).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("content-cleanup-source-dialog-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: /Preview 1 removals|预览 1 项清理/ })
      .click();
    await page.getByRole("button", { name: /Confirm 1 selections|确认处理 1 项选择/ }).click();
    await expect(page.getByTestId("content-cleanup-dialog")).toHaveCount(0);
    await expect(page.getByTestId("source-editor-codemirror")).toContainText(
      "🙂 Answer before  and after.",
      { timeout: 30_000 },
    );
    await expect(
      page.getByTestId("source-editor-codemirror"),
    ).not.toContainText("Cite turn2search1");
  } finally {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await page.request.delete(
          `/api/conversations/${conversationId}`,
        );
        if ([204, 404].includes(response.status())) break;
        if (attempt === 1)
          cleanupError = new Error(
            `Unable to remove the cleanup QA conversation (${response.status()}).`,
          );
      } catch {
        if (attempt === 1)
          cleanupError = new Error(
            "Unable to remove the cleanup QA conversation.",
          );
        await page.waitForTimeout(250);
      }
    }
  }
  if (cleanupError) throw cleanupError;
});

async function selectCandidateRange(page: Page, candidate: Locator, start: number, end: number) {
  await candidate.scrollIntoViewIfNeeded();
  // Read-only textareas on Windows Chrome do not move a text caret with
  // Shift+Arrow. Use the real pointer selection path, not setSelectionRange
  // or a synthetic select event, and verify the native resulting offsets.
  const points = await candidate.evaluate((element, range) => {
    const node = element as HTMLTextAreaElement;
    const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const left = bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) - node.scrollLeft;
    return {
      from: left + context.measureText(node.value.slice(0, range.start)).width,
      to: left + context.measureText(node.value.slice(0, range.end)).width,
      y: bounds.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 - node.scrollTop,
    };
  }, { start, end });
  await page.mouse.move(points.from, points.y);
  await page.mouse.down();
  await page.mouse.move(points.to, points.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => candidate.evaluate(element => [(element as HTMLTextAreaElement).selectionStart, (element as HTMLTextAreaElement).selectionEnd])).toEqual([start, end]);
}

for (const width of [375, 1440]) {
  test(`${width}px: multiple candidates retain exact edited ranges across checkbox changes`, async ({ page, baseURL }, info) => {
    page.setDefaultTimeout(15_000);
    const zh = width === 375;
    await page.setViewportSize({ width, height: 900 });
    await settingsAppearance(page.request, baseURL!, zh ? "zh-CN" : "en-US");
    const source = "🙂 First Cite turn2search1.\n\nSecond Cite turn3search2.";
    const created = await page.request.post("/api/conversations", { data: {
      title: "Synthetic exact noise ranges",
      messages: [{ role: "user", content_markdown: "Synthetic question" }, { role: "assistant", content_markdown: source }],
    } });
    expect(created.status()).toBe(201);
    const { conversation, messages } = await created.json();
    try {
      const started = await page.request.post("/api/content-cleanup/scans", { data: {
        source: "BATCH", scope_type: "CURRENT_CONVERSATION", conversation_ids: [conversation.id],
      } });
      expect(started.status()).toBe(202);
      const scanId = (await started.json()).id;
      const scan = async () => (await (await page.request.get(`/api/content-cleanup/scans/${scanId}`)).json());
      await expect.poll(async () => (await scan()).status).toBe("READY");
      await page.goto(`/conversations/${conversation.id}`);
      await openSettingsNoiseReview(page, scanId);
      const dialog = page.getByTestId("content-cleanup-dialog");
      if (width < 1024) await dialog.getByRole("button", { name: zh ? "全部候选" : "All candidates", exact: true }).click();
      await dialog.getByRole("button", { name: zh ? "选择全部匹配项" : "Select all matching", exact: true }).click();
      await expect.poll(async () => (await scan()).delete_count).toBe(2);
      const first = dialog.locator("article").filter({ has: page.getByRole("checkbox", { name: `${zh ? "处理" : "Process"} Cite turn2search1`, exact: true }) });
      await first.getByRole("button", { name: zh ? "调整删除范围" : "Adjust deletion ranges", exact: true }).click();
      const editor = dialog.getByRole("region", { name: zh ? "调整删除范围" : "Adjust deletion ranges", exact: true });
      const candidate = editor.getByRole("textbox", { name: zh ? "扫描到的候选（可选择文字，不可改写原文）" : "Scanned candidate (select text; source is read-only)", exact: true });
      await expect(candidate).toHaveValue("Cite turn2search1");
      await expect(candidate).toHaveAttribute("readonly", "");
      await selectCandidateRange(page, candidate, 0, 5);
      await editor.getByRole("button", { name: zh ? "只删除选区" : "Only remove selection", exact: true }).click();
      await selectCandidateRange(page, candidate, 10, 17);
      await editor.getByRole("button", { name: zh ? "加入删除范围" : "Add selection to removals", exact: true }).click();
      await expect(editor.getByRole("status")).toHaveText(zh ? "待删除 2 处 · 12 个字符" : "2 removal ranges · 12 characters");
      await expect(editor.getByRole("region", { name: zh ? "调整后上下文" : "Context after adjustment", exact: true }).locator("pre")).toContainText("First turn2.");
      await editor.getByRole("button", { name: zh ? "保存范围并选中" : "Save ranges and select", exact: true }).click();
      const checkbox = first.getByRole("checkbox");
      await expect(checkbox).toBeChecked();
      await expect(first.locator("[data-cleanup-candidate-removal]")).toHaveText(["Cite ", "search1"]);
      await expect(first).toContainText(zh ? "将删除 · 已调整为 2 处" : "Marked for deletion · 2 adjusted ranges");
      await checkbox.uncheck();
      await expect.poll(async () => (await scan()).delete_count).toBe(1);
      await expect(first.locator("[data-cleanup-candidate-removal]")).toHaveCount(0);
      await checkbox.check();
      await expect.poll(async () => (await scan()).delete_count).toBe(2);
      await expect(first.locator("[data-cleanup-candidate-removal]")).toHaveText(["Cite ", "search1"]);
      const before = await (await page.request.get(`/api/messages/${messages[1].id}`)).json();
      expect(before.current_version.display_text).toBe(source);
      await dialog.screenshot({ path: info.outputPath(`noise-refined-selected-${width}.png`) });
      await dialog.getByRole("button", { name: zh ? "预览 2 项清理" : "Preview 2 removals", exact: true }).click();
      await expect(dialog.getByTestId("cleanup-diff-after")).toHaveText("🙂 First turn2.\n\nSecond .");
      await expect(dialog.getByTestId("cleanup-diff-before").locator("[data-cleanup-removal]")).toHaveText(["Cite ", "search1", "Cite turn3search2"]);
      await dialog.getByRole("button", { name: zh ? "确认处理 3 项选择" : "Confirm 3 selections", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const after = await (await page.request.get(`/api/messages/${messages[1].id}`)).json();
      expect(after.current_version.display_text).toBe("🙂 First turn2.\n\nSecond .");
      expect(after.current_version.edit_type).toBe("content_cleanup");
    } finally {
      expect((await page.request.delete(`/api/conversations/${conversation.id}`, { timeout: 15_000 })).ok()).toBe(true);
    }
  });
}
