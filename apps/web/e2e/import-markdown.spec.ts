import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const runImportFlow = process.env.E2E_IMPORT_FLOW === "1";

test.skip(!runImportFlow, "E2E_IMPORT_FLOW=1 is required");

test("renders paired Markdown in preview and opens the committed Reader", async ({ page }) => {
  const json = JSON.stringify({
    metadata: { title: "Markdown import E2E", powered_by: "ChatGPT Exporter (https://www.chatgptexporter.com)" },
    messages: [
      { role: "Prompt", say: "### Preview structure\n\n- preview list item\n\n```markdown\n## Response:\n2026-08-03 10:00:30\n\nexample response\n```", time: "2026-08-03 10:00:00" },
      { role: "Response", say: "### Reader structure\n\n```python\nprint(\"paired markdown\")\n```", time: "2026-08-03 10:01:00" },
    ],
  });
  const markdown = `# Markdown import E2E

## Prompt:
2026-08-03 10:00:00

### Preview structure

- preview list item

\`\`\`markdown
## Response:
2026-08-03 10:00:30

example response
\`\`\`

## Response:
2026-08-03 10:01:00

### Reader structure

\`\`\`python
print("paired markdown")
\`\`\`
`;

  await page.goto("/");
  await page.getByRole("button", { name: /Import data|导入数据/ }).click();
  await page.getByTestId("import-file-input").setInputFiles([
    { name: "markdown-import-e2e.json", mimeType: "application/json", buffer: Buffer.from(json) },
    { name: "markdown-import-e2e.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) },
  ]);
  await page.getByTestId("preview-import-button").click();
  await expect(page.getByRole("heading", { name: "导入概览" })).toBeVisible();
  await expect(page.getByText("Chat Reader Native JSON / Markdown")).toBeVisible();
  await expect(page.getByText("准备导入 1 个对话、2 条消息。")).toBeVisible();

  await page.getByTestId("commit-import-button").click();
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
  await expect(page.getByRole("dialog", { name: /Import data|导入数据/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Reader structure" })).toBeVisible();
  await expect(page.locator("code", { hasText: 'print("paired markdown")' })).toBeVisible();
});

test("previews a real response-only JSON and Markdown pair without dropping content", async ({ page }) => {
  const jsonPath = process.env.E2E_IMPORT_PAIR_JSON;
  const markdownPath = process.env.E2E_IMPORT_PAIR_MARKDOWN;
  test.skip(!jsonPath || !markdownPath, "E2E_IMPORT_PAIR_JSON and E2E_IMPORT_PAIR_MARKDOWN are required");

  await page.goto("/");
  await page.getByRole("button", { name: /Import data|瀵煎叆鏁版嵁/ }).click();
  await page.getByTestId("import-file-input").setInputFiles([
    resolve(jsonPath!),
    resolve(markdownPath!),
  ]);
  await page.getByTestId("preview-import-button").click();

  await expect(page.getByTestId("commit-import-button")).toBeEnabled();
  await expect(page.getByText(/准备导入 1 个对话/)).toBeVisible();
});

test("maps one unknown structure family once and reuses the learned profile", async ({ page }) => {
  await cleanupAdaptiveE2EProfiles(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const profileName = `Adaptive E2E ${suffix}`;
  const expectedTitles = new Set([`First adaptive ${suffix}`, `Second adaptive ${suffix}`, `Third adaptive ${suffix}`]);
  const conversations: string[] = [];
  const source = (title: string, detail: string) => JSON.stringify({
    name: title,
    format_marker: "adaptive-e2e",
    archive: {
      entries: [
        { speaker: "human", body: `Question ${detail}`, created_at: "2026-08-22T08:00:00Z" },
        { speaker: "ai", body: `Answer ${detail}`, created_at: "2026-08-22T08:01:00Z" },
      ],
    },
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: /Import data|导入数据/ }).click();
    await page.getByTestId("import-file-input").setInputFiles([
      { name: `first-${suffix}.json`, mimeType: "application/json", buffer: Buffer.from(source(`First adaptive ${suffix}`, "one")) },
      { name: `second-${suffix}.json`, mimeType: "application/json", buffer: Buffer.from(source(`Second adaptive ${suffix}`, "two")) },
    ]);
    await page.getByTestId("preview-import-button").click();
    await expect(page.getByText("发现 2 个对话，识别出 1 种格式")).toBeVisible();
    await page.getByRole("button", { name: "设置格式" }).click();
    await expect(page.getByRole("heading", { name: "设置新的导入格式" })).toBeVisible();
    await page.getByLabel("保存为导入格式").fill(profileName);
    await page.getByRole("button", { name: "验证映射" }).click();
    await expect(page.getByText("全部对话通过")).toBeVisible();
    await page.getByRole("button", { name: "保存映射并继续" }).click();
    await expect(page.getByText("准备导入 2 个对话、4 条消息。")).toBeVisible();
    await page.getByTestId("commit-import-button").click();
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
    conversations.push(page.url().split("/").pop()!);

    await page.goto("/");
    await page.getByRole("button", { name: /Import data|导入数据/ }).click();
    await page.getByTestId("import-file-input").setInputFiles({
      name: `third-${suffix}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(source(`Third adaptive ${suffix}`, "three")),
    });
    await page.getByTestId("preview-import-button").click();
    await expect(page.getByText(profileName)).toBeVisible();
    await expect(page.getByRole("button", { name: "设置格式" })).toHaveCount(0);
    await page.getByTestId("commit-import-button").click();
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
    conversations.push(page.url().split("/").pop()!);
  } finally {
    await cleanupAdaptiveE2EProfiles(page);
    const list = await page.request.get("/api/conversations?status_scope=all&limit=500");
    if (list.ok()) {
      for (const item of (await list.json()) as Array<{ id: string; title: string }>) {
        if (expectedTitles.has(item.title)) conversations.push(item.id);
      }
    }
    for (const conversationId of new Set(conversations)) await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("keeps valid mapping work while invalid groups are excluded or replaced", async ({ page }) => {
  await cleanupAdaptiveE2EProfiles(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const profileName = `Adaptive E2E Recovery ${suffix}`;
  const source = (title: string, detail: string) => JSON.stringify({
    name: title,
    format_marker: "adaptive-recovery-e2e",
    archive: {
      entries: [
        { speaker: "human", body: `Question ${detail}`, created_at: "2026-08-22T08:00:00Z" },
        { speaker: "ai", body: `Answer ${detail}`, created_at: "2026-08-22T08:01:00Z" },
      ],
    },
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: /Import data|导入数据/ }).click();
    await page.getByTestId("import-file-input").setInputFiles([
      { name: `valid-${suffix}.json`, mimeType: "application/json", buffer: Buffer.from(source(`Recovery ${suffix}`, "valid")) },
      { name: `broken-a-${suffix}.json`, mimeType: "application/json", buffer: Buffer.from('{"archive":') },
      { name: `broken-b-${suffix}.json`, mimeType: "application/json", buffer: Buffer.from("not-json") },
    ]);
    await page.getByTestId("preview-import-button").click();

    await expect(page.getByRole("heading", { name: "导入概览" })).toBeVisible();
    await expect(page.getByText("2 个对话需要修复输入")).toBeVisible();
    await expect(page.getByText("其他已识别格式仍可继续设置。替换、排除或重新组合这些文件后，系统会自动重新分析。")).toBeVisible();
    const replaceButton = page.getByRole("button", { name: /替换 broken-/ }).first();
    await replaceButton.focus();
    await expect(replaceButton).toBeFocused();
    await expect(page.getByRole("button", { name: /定位：line/ })).toHaveCount(0);

    await page.getByRole("button", { name: "设置格式" }).click();
    await page.getByLabel("保存为导入格式").fill(profileName);
    await page.getByRole("button", { name: "验证映射" }).click();
    await expect(page.getByText("全部对话通过")).toBeVisible();
    await page.getByRole("button", { name: "保存映射并继续" }).click();
    await expect(page.getByText("2 个对话需要修复输入")).toBeVisible();
    await expect(page.getByText("已支持")).toBeVisible();

    await page.getByRole("button", { name: "不导入此项" }).first().click();
    await page.getByRole("button", { name: "确认不导入" }).click();
    await expect(page.getByText("1 个对话需要修复输入")).toBeVisible();

    await page.locator('[data-testid^="replace-import-file-"]').setInputFiles({
      name: `replacement-${suffix}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(source(`Replacement ${suffix}`, "replacement")),
    });
    await expect(page.getByText("准备导入 2 个对话、4 条消息。")).toBeVisible();
    await expect(page.getByTestId("commit-import-button")).toBeEnabled();

    await page.getByRole("button", { name: "重新选择文件" }).click();
    await expect(page.getByTestId("import-file-input")).toBeVisible();
  } finally {
    await cleanupAdaptiveE2EProfiles(page);
  }
});

async function cleanupAdaptiveE2EProfiles(page: Page): Promise<void> {
  const formats = await page.request.get("/api/import-formats");
  if (!formats.ok()) return;
  for (const profile of (await formats.json()) as Array<{ id: string | null; kind: string; name: string }>) {
    if (profile.kind === "LEARNED" && profile.id && profile.name.startsWith("Adaptive E2E ")) {
      await page.request.delete(`/api/import-formats/${profile.id}`);
    }
  }
}
