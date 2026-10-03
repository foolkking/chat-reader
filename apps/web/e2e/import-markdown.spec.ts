import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const runImportFlow = process.env.E2E_IMPORT_FLOW === "1";

test.skip(!runImportFlow, "E2E_IMPORT_FLOW=1 is required");

test("renders paired Markdown in preview and exposes the committed Reader", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: /导入概览|Import overview/ })).toBeVisible();
  await expect(page.getByText("Chat Reader Native JSON / Markdown")).toBeVisible();
  await expect(page.getByText(/准备导入 1 个对话、2 条消息。|Ready to import 1 conversations and 2 messages./)).toBeVisible();

  await page.getByTestId("commit-import-button").click();
  await expect(page.getByTestId("import-completion-summary")).toBeVisible();
  await expect(page.getByText(/导入已完成|Import complete/)).toBeVisible();
  await page.getByRole("button", { name: /^(打开对话|Open conversation)$/ }).click();
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Reader structure" })).toBeVisible();
  await expect(page.locator("code", { hasText: 'print("paired markdown")' })).toBeVisible();
});

test("previews a real response-only JSON and Markdown pair without dropping content", async ({ page }) => {
  const jsonPath = process.env.E2E_IMPORT_PAIR_JSON;
  const markdownPath = process.env.E2E_IMPORT_PAIR_MARKDOWN;
  test.skip(!jsonPath || !markdownPath, "E2E_IMPORT_PAIR_JSON and E2E_IMPORT_PAIR_MARKDOWN are required");

  await page.goto("/");
  await page.getByRole("button", { name: /Import data|导入数据/ }).click();
  await page.getByTestId("import-file-input").setInputFiles([
    resolve(jsonPath!),
    resolve(markdownPath!),
  ]);
  await page.getByTestId("preview-import-button").click();

  await expect(page.getByTestId("commit-import-button")).toBeEnabled();
  await expect(page.getByText(/准备导入 1 个对话|Ready to import 1 conversations/)).toBeVisible();
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
    await expect(page.getByText(/发现 2 个对话，识别出 1 种格式|Found 2 conversations in 1 formats/)).toBeVisible();
    await page.getByRole("button", { name: /设置格式|Map format/ }).click();
    await expect(page.getByRole("heading", { name: /设置新的导入格式|Learn a new import format/ })).toBeVisible();
    await page.getByLabel(/保存为导入格式|Format name/).fill(profileName);
    await page.getByRole("button", { name: /验证映射|Validate mapping/ }).click();
    await expect(page.getByText(/全部对话通过|All conversations validated/)).toBeVisible();
    await page.getByRole("button", { name: /保存映射并继续|Learn mapping & continue/ }).click();
    await expect(page.getByText(/准备导入 2 个对话|Ready to import 2 conversations/)).toBeVisible();
    await page.getByTestId("commit-import-button").click();
    await expect(page.getByTestId("import-completion-summary")).toBeVisible();
    await page.getByRole("button", { name: /打开第一条|Open first conversation/ }).click();
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
    await expect(page.getByRole("button", { name: /设置格式|Map format/ })).toHaveCount(0);
    await page.getByTestId("commit-import-button").click();
    await expect(page.getByTestId("import-completion-summary")).toBeVisible();
    await page.getByRole("button", { name: /^(打开对话|Open conversation)$/ }).click();
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

    await expect(page.getByRole("heading", { name: /导入概览|Import overview/ })).toBeVisible();
    await expect(page.getByText(/暂不可映射 · 需要先转换|Not mappable · Convert the source first/)).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "broken-a-" }).getByText(/JSON 无法解析|Cannot parse JSON/)).toBeVisible();
    await expect(page.getByText(/语法或编码错误无法通过字段映射解决。|Field mapping cannot fix syntax or encoding errors\./)).toHaveCount(2);
    const replaceButton = page.getByRole("button", { name: /(?:替换|Replace) broken-/ }).first();
    await replaceButton.focus();
    await expect(replaceButton).toBeFocused();
    await expect(page.getByRole("button", { name: /使用格式转换 Skill|Use format conversion Skill/ })).toHaveCount(2);
    await page.getByRole("button", { name: /使用格式转换 Skill|Use format conversion Skill/ }).first().click();
    const converter = page.getByRole("dialog", { name: /使用格式转换 Skill|Use format conversion Skill/ });
    const bundleUrl = await converter.getByRole("link", { name: /下载 Skill|Download skill/ }).getAttribute("href");
    const bundle = await page.request.get(bundleUrl!);
    expect(bundle.status()).toBe(200);
    const members = unzipSync(await bundle.body());
    const instructions = Object.entries(members).find(([name]) => name.endsWith("/SKILL.md"));
    expect(instructions).toBeTruthy();
    expect(strFromU8(instructions![1])).toContain("chat-transcript-normalizer");
    await converter.getByRole("button", { name: /稍后处理|Do this later/ }).click();

    await page.getByRole("button", { name: /设置格式|Map format/ }).click();
    await page.getByLabel(/保存为导入格式|Format name/).fill(profileName);
    await page.getByRole("button", { name: /验证映射|Validate mapping/ }).click();
    await expect(page.getByText(/全部对话通过|All conversations validated/)).toBeVisible();
    await page.getByRole("button", { name: /保存映射并继续|Learn mapping & continue/ }).click();
    await expect(page.getByText(/暂不可映射 · 需要先转换|Not mappable · Convert the source first/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /已支持 · 可直接导入|Supported · Ready to import/ })).toBeVisible();

    const firstInvalidGroup = page.getByRole("article").filter({ hasText: `broken-a-${suffix}.json` });
    await firstInvalidGroup.getByRole("button", { name: /不导入此项|Exclude this item/ }).click();
    await page.getByRole("button", { name: /确认不导入|Confirm exclusion/ }).click();
    await expect(page.getByText(/暂不可映射 · 需要先转换|Not mappable · Convert the source first/)).toBeVisible();
    await expect(page.getByText(`broken-a-${suffix}.json`)).toHaveCount(0);
    await expect(page.getByText(`broken-b-${suffix}.json`)).toBeVisible();

    const remainingGroup = page.getByRole("article").filter({ hasText: `broken-b-${suffix}.json` });
    await expect(remainingGroup.getByRole("button", { name: new RegExp(`(?:替换|Replace) broken-b-${suffix}\\.json`) })).toBeEnabled();
    await remainingGroup.locator('input[data-testid^="replace-import-file-"]').setInputFiles({
      name: `replacement-${suffix}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(source(`Replacement ${suffix}`, "replacement")),
    });
    await expect(page.getByText(/准备导入 2 个对话|Ready to import 2 conversations/)).toBeVisible();
    await expect(page.getByTestId("commit-import-button")).toBeEnabled();

    await page.getByRole("button", { name: /重新选择文件|Choose different files/ }).click();
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
