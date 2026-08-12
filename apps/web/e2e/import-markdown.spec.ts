import { expect, test } from "@playwright/test";
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
  await expect(page.getByRole("heading", { name: "Preview structure" })).toBeVisible();
  await expect(page.getByText("preview list item", { exact: true })).toBeVisible();

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
  await expect(page.getByTestId("import-alignment-issues")).toHaveCount(0);
  await expect(page.getByTestId("import-message-count")).toHaveText("1");
});
