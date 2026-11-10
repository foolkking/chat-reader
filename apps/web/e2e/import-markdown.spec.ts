import { expect, test, type Page, type Request } from "@playwright/test";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

const runImportFlow = process.env.E2E_IMPORT_FLOW === "1";

test.skip(!runImportFlow, "E2E_IMPORT_FLOW=1 is required");

// Mounted UI/transport recovery, not a claim that mocked HTTP tests measure
// memory. The separate exact-image Linux worker gate exercises real admission.
for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "zh-CN"]] as const) {
  test(`${width}px: retained memory failure reopens and retries the same analysis without reupload`, async ({ page, baseURL }) => {
    await settingsAppearance(page.request, baseURL!, locale);
    await page.setViewportSize({ width, height: 900 });
    const importId = crypto.randomUUID(), taskId = crypto.randomUUID();
    const state = {
      import_id: importId, analysis_task_id: taskId, state: "FAILED", status: "failed",
      phase: "analysis_failed", progress: 5, file_count: 1, total_bytes: 1488526,
      group_count: 0, family_count: 0, conversation_count: 0, message_count: 0,
      can_import: false, groups: [], families: [], warnings: [], archives: [], analysis_summary: {},
      error_message: "UPLOAD_MEMORY_PRESSURE",
      failure: { code: "UPLOAD_MEMORY_PRESSURE", stage: "admission", retryable: true },
    };
    let uploads = 0, retries = 0;
    await page.route("**/api/adaptive-import/sessions", route => {
      uploads += 1;
      return route.fulfill({ status: 201, json: state });
    });
    await page.route(`**/api/adaptive-import/sessions/${importId}`, route => route.fulfill({ json: state }));
    await page.route(`**/api/tasks/${taskId}/retry`, async route => {
      expect(route.request().method()).toBe("POST");
      retries += 1;
      state.state = "ANALYZING"; state.status = "analyzing"; state.phase = "queued";
      await route.fulfill({ json: { job_id: taskId, job_type: "adaptive_import_analysis", status: "queued" } });
    });
    const openImport = async () => {
      if (width < 768) {
        await page.getByTestId("mobile-sidebar-button").filter({ visible: true }).click();
      }
      const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true });
      const importButton = sidebar.getByTestId("sidebar-import-button");
      await expect(importButton).toBeVisible();
      await importButton.click();
    };
    await page.goto("/");
    await openImport();
    await page.getByTestId("import-file-input").setInputFiles({
      name: "synthetic-memory.zip", mimeType: "application/zip", buffer: Buffer.from("synthetic transport fixture"),
    });
    await page.getByTestId("preview-import-button").click();
    const panel = page.getByTestId("import-analysis-status");
    await expect(panel.getByRole("alert")).toContainText(locale === "zh-CN" ? "可用内存不足" : "not enough available memory");
    await expect(panel.getByRole("alert")).toContainText(locale === "zh-CN" ? "无需重新上传" : "without uploading again");
    await expect(panel.getByRole("alert")).not.toContainText(/损坏|damaged|自动重试|will retry automatically/);
    await page.getByTestId("import-dialog-close").click();
    await page.reload();
    await openImport();
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: /^(查看上次保留的导入|View the last retained import)$/ }).click();
    await expect(panel.getByRole("alert")).toContainText(locale === "zh-CN" ? "可用内存不足" : "not enough available memory");
    const retry = panel.getByRole("button", { name: /^(重试分析|Retry analysis)$/ });
    await expect(retry).toBeInViewport();
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await retry.click();
    await expect(panel.getByRole("heading")).toContainText(/已加入后台分析队列|Queued for background analysis/);
    expect(uploads).toBe(1); expect(retries).toBe(1);
    await expect(page.getByTestId("import-file-input")).toHaveCount(0);
  });
}

test("file drops capture the current unclassified or project destination", async ({ page }) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: { name: `Drop import ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(projectResponse.status()).toBe(201);
  const projectId = (await projectResponse.json() as { id: string }).id;

  const dispatchFileDrop = async (selector: string, filename: string) => {
    await page.locator(selector).evaluate((element, name) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["# Imported note\n\nPlain Markdown body."], name, { type: "text/markdown" }));
      element.dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    }, filename);
  };

  try {
    await page.goto("/");
    await dispatchFileDrop("main", "ignored-drop.md");
    await expect(page.getByRole("dialog", { name: /Import data|导入数据/ })).toHaveCount(0);

    await page.locator("main").evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["# Imported note"], "unclassified-drop.md", { type: "text/markdown" }));
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(page.getByTestId("workspace-file-drop-overlay")).toBeVisible();
    await dispatchFileDrop('[data-testid="workspace-import-drop-target"]', "unclassified-drop.md");
    await expect(page.getByTestId("import-destination-select")).toHaveValue("");
    await expect(page.getByTestId("import-selected-files").getByText("unclassified-drop.md", { exact: true })).toBeVisible();
    await page.getByTestId("import-dialog-close").click();

    await page.goto(`/projects/${projectId}`);
    await dispatchFileDrop('[data-testid="sidebar-import-button"]', "project-drop.md");
    await expect(page.getByTestId("import-destination-select")).toHaveValue(projectId);
    await expect(page.getByTestId("import-selected-files").getByText("project-drop.md", { exact: true })).toBeVisible();
  } finally {
    await page.request.delete(`/api/projects/${projectId}`);
  }
});

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

    const remainingGroup = page.getByRole("article").filter({ hasText: `broken-b-${suffix}.json` });
    await expect(remainingGroup.getByText(`broken-b-${suffix}.json`, { exact: true })).toBeVisible();
    await expect(remainingGroup.getByRole("button", { name: new RegExp(`(?:替换|Replace) broken-b-${suffix}\\.json`) })).toBeEnabled();
    const requests: Array<{ method: string; path: string }> = [];
    const recordRequest = (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/adaptive-import/sessions")) requests.push({ method: request.method(), path });
    };
    page.on("request", recordRequest);
    try {
      const accepted = page.waitForResponse(response => response.request().method() === "PUT"
        && /\/api\/adaptive-import\/sessions\/[^/]+\/artifacts\/[^/]+$/.test(new URL(response.url()).pathname));
      await remainingGroup.locator('input[data-testid^="replace-import-file-"]').setInputFiles({
        name: `replacement-${suffix}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(source(`Replacement ${suffix}`, "replacement")),
      });
      const response = await accepted;
      expect(response.status()).toBe(202);
      const queued = await response.json() as { import_id: string; state: string; analysis_task_id: string; operation_task_id: string };
      expect(queued.state).toBe("ANALYZING");
      expect(queued.operation_task_id).toBe(queued.analysis_task_id);
      expect(queued.analysis_task_id).toBeTruthy();
      // The mounted panel must resume its own GET polling. Do not reload,
      // refocus or call the session API from the test to rescue a stuck cache.
      await expect(page.getByText(/准备导入 2 个对话|Ready to import 2 conversations/)).toBeVisible();
      await expect(page.getByTestId("commit-import-button")).toBeEnabled();
      expect(requests.some(request => request.method === "GET" && request.path === `/api/adaptive-import/sessions/${queued.import_id}`)).toBe(true);
      expect(requests.filter(request => request.method === "PUT")).toHaveLength(1);
      expect(requests.filter(request => request.method === "POST")).toHaveLength(0);
    } finally { page.off("request", recordRequest); }

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

for (const [width, locale] of [[375, "zh-CN"], [768, "en-US"], [1440, "zh-CN"]] as const) {
  test(`${width}px: discover conversion before analysis and import the actual converted Markdown`, async ({ page, baseURL }) => {
    await settingsAppearance(page.request, baseURL!, locale);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
    await page.getByRole("button", { name: /Import data|导入数据/, exact: true }).click();
    const help = page.getByRole("button", { name: /格式不支持？|Format not supported\?/ });
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("format-conversion-guide")).toHaveCount(0);
    const source = { name: "synthetic-transcript.log", mimeType: "text/plain", buffer: Buffer.from("Human: Synthetic question\nAssistant: Synthetic answer") };
    const input = page.getByTestId("import-file-input");
    await input.setInputFiles(source);
    await expect(page.getByTestId("preview-import-button")).toBeDisabled();
    await help.click();
    const guide = page.getByTestId("format-conversion-guide");
    const link = guide.getByRole("link", { name: /下载 Skill|Download skill/ });
    await expect(link).toBeVisible();
    const bundle = await page.request.get((await link.getAttribute("href"))!);
    expect(bundle.status()).toBe(200);
    expect(Object.keys(unzipSync(await bundle.body())).some(name => name.endsWith("/SKILL.md"))).toBe(true);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
    await guide.getByRole("button", { name: /复制模板|Copy template/ }).click();
    const template = guide.getByRole("textbox", { name: /转换请求模板|Conversion request template/ });
    await expect(template).toHaveValue(/ChatGPT Markdown Transcript Profile v1/);
    await template.focus();
    expect(await template.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBeGreaterThan(50);
    await expect(guide).not.toContainText(/已复制。|Copied\./);
    await page.screenshot({ path: `${process.env.TEMP ?? "/tmp"}/normalizer-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await help.click();
    await expect(page.getByTestId("import-selected-files").getByText(source.name, { exact: true })).toBeVisible();
    await help.click();
    const chooserPromise = page.waitForEvent("filechooser");
    await guide.getByRole("button", { name: /选择转换后的文件|Choose the converted file/ }).click();
    const title = `Synthetic converted ${width} ${Date.now()}`;
    const markdown = `# ${title}\n\n**User:** Anonymous  \n**Created:** Unknown  \n**Updated:** Unknown  \n**Exported:** 9/29/2026 15:29:29  \n**Link:** N/A\n\n## Prompt:\nUnknown\n\nSynthetic question ${width}\n\n## Response:\nUnknown · test-model\n\nSynthetic answer ${width}\n`;
    await (await chooserPromise).setFiles({ name: "converted.chat-transcript.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) });
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await page.getByTestId("preview-import-button").click();
    await expect(page.getByText(/准备导入 1 个对话、2 条消息|Ready to import 1 conversations and 2 messages/)).toBeVisible();
    await page.getByTestId("commit-import-button").click();
    await page.getByRole("button", { name: /^(打开对话|Open conversation)$/ }).click();
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
    await page.reload();
    await expect(page.getByRole("article").getByText(`Synthetic question ${width}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("article").getByText(`Synthetic answer ${width}`, { exact: true })).toBeVisible();
  });
}

test("conversion is not offered as recovery for archives, Skills or a service failure", async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, "en-US");
  await page.goto("/");
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const input = page.getByTestId("import-file-input");
  const help = page.getByRole("button", { name: "Format not supported?" });
  for (const name of ["synthetic.cr", "synthetic.context.zip", "SKILL.md"]) {
    await input.setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from("Synthetic input") });
    await expect(help).toHaveCount(0);
    await expect(page.getByTestId("preview-import-button")).toBeDisabled();
    // Adding another file appends; remove the invalid source explicitly before
    // exercising the next independent format instead of silently replacing it.
    await page.getByTestId("import-selected-files").getByRole("button", { name: `Remove file: ${name}`, exact: true }).click();
  }
  await input.setInputFiles({ name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  let analysisRequests = 0;
  await page.route("**/api/adaptive-import/sessions", route => {
    analysisRequests += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: '{}' });
  });
  await page.getByTestId("preview-import-button").click();
  await expect(page.getByRole("dialog", { name: "Import data", exact: true }).getByRole("alert")).toHaveText(
    "The request result is not confirmed. Check the current import state before deciding whether to retry.",
  );
  await expect(help).toHaveCount(0);
  await expect(page.getByTestId("import-selected-files").getByText("synthetic.json", { exact: true })).toBeVisible();
  await expect(input).toBeEnabled();
  expect(analysisRequests).toBe(1);
});

test("an in-flight analysis keeps its source while exit remains available", async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, "en-US");
  await page.goto("/");
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const input = page.getByTestId("import-file-input");
  await input.setInputFiles({ name: "synthetic-original.json", mimeType: "application/json", buffer: Buffer.from("not-json") });
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const reached = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/adaptive-import/sessions", async route => { started(); await paused; await route.continue(); });
  try {
    await page.getByTestId("preview-import-button").click();
    await reached;
    await expect(input).toBeDisabled();
    await expect(page.getByTestId("import-dialog-close")).toBeEnabled();
    await input.locator("xpath=../..").evaluate(element => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["not-json"], "synthetic-new.json", { type: "application/json" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    });
    await expect(page.getByTestId("import-selected-files").getByText("synthetic-original.json", { exact: true })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole("article").filter({ hasText: "synthetic-original.json" })).toBeVisible();
  await expect(page.getByText("synthetic-new.json")).toHaveCount(0);
  await expect(page.getByTestId("import-dialog-close")).toBeEnabled();
  await page.getByTestId("import-dialog-close").click();
  await expect(page.getByRole("dialog", { name: "Import data", exact: true })).toHaveCount(0);
});
