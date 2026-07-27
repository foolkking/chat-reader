import { expect, test } from "@playwright/test";

const conversationId = process.env.E2E_CONVERSATION_ID;
const evidenceDir = "../../docs/execution/screenshots";

test.skip(!conversationId, "E2E_CONVERSATION_ID is required");

test("navigation, search, reader layout, annotation modes, and screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /最近|Recent/ })).toHaveAttribute("href", "/recent");
  await page.keyboard.press("Control+k");
  await expect(page.locator('input[aria-label*="搜索"], input[aria-label*="Search"]').first()).toBeFocused();
  await page.screenshot({ path: `${evidenceDir}/home-light-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: /Import data|导入数据/ }).click();
  await page.getByTestId("import-file-input").setInputFiles("../../.tmp_execution_fixture.json");
  await page.getByTestId("preview-import-button").click();
  await expect(page.getByText("Reader redesign verification").last()).toBeVisible();
  await page.getByRole("button", { name: /Close|关闭/ }).last().click();

  await page.goto("/search?q=deployment%20annotation%20needle");
  await expect(page.getByText(/批注结果|Annotation results/)).toBeVisible();
  await expect(page.getByText("deployment annotation needle")).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/search-annotation-light-1440x900.png`, fullPage: true });
  await page.goto("/search?q=known-empty-execution-query-9d2c");
  await expect(page.getByText(/No results|娌℃湁鎵惧埌缁撴灉/)).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/search-empty-light-1440x900.png`, fullPage: true });

  await page.goto(`/conversations/${conversationId}`);
  await expect(page.locator(".reader-index-column")).toBeVisible();
  await expect(page.locator(".reader-toc-column")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("sidebar-global-search")).toBeFocused();
  await page.getByRole("button", { name: /Collapse sidebar|Close sidebar|关闭侧栏|收起侧栏/ }).click();
  const messages = page.locator("article[data-message-id]");
  await expect(messages).toHaveCount(6);
  const firstTwoX = await messages.evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.getBoundingClientRect().x));
  expect(Math.abs((firstTwoX[0] ?? 0) - (firstTwoX[1] ?? 0))).toBeLessThan(4);
  await page.screenshot({ path: `${evidenceDir}/reader-default-light-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
  await page.getByRole("button", { name: /Focus mode|专注模式/ }).click();
  await expect(page.locator('[data-focus-mode="on"]')).toBeVisible();
  await expect(page.locator(".reader-index-column")).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("chat-reader:reader-focus-mode"))).toBe("true");
  await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
  await page.getByRole("button", { name: /Exit focus mode|退出专注模式/ }).click();
  await expect(page.locator('[data-focus-mode="off"]')).toBeVisible();

  await page.locator('div[aria-label="Primary reader actions"] button').first().click();
  const conversationSearch = page.getByPlaceholder(/Search this conversation and its annotations|搜索当前对话/);
  await conversationSearch.fill("Accessibility");
  await expect(page.getByText(/Keep focus visible/)).toBeVisible();
  await conversationSearch.fill("deployment annotation needle");
  await page.getByRole("button", { name: /Annotations|批注/ }).last().click();
  await expect(page.getByText("deployment annotation needle")).toBeVisible();
  await page.getByRole("button", { name: /Close|关闭/ }).last().click();

  await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
  await page.getByRole("button", { name: /Export|导出/ }).click();
  await expect(page.getByRole("group", { name: /^(Export|导出)$/ })).toBeVisible();
  await page.getByRole("button", { name: /Close|关闭/ }).last().click();

  await page.goto(`/conversations/${conversationId}?annotations=open`);
  const workspace = page.locator('[data-annotation-mode="floating"]');
  await expect(workspace).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/reader-annotation-floating-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: "固定到左侧栏" }).click();
  await expect(page.locator('[data-annotation-mode="docked"]')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/reader-annotation-docked-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: "恢复导航栏并拆为浮窗" }).click();
  await expect(page.locator('[data-annotation-mode="floating"]')).toBeVisible();

  await page.getByRole("button", { name: /分享|Share/ }).click();
  await expect(page.getByText(/创建分享链接|Create share link/)).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/share-panel-light-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: /关闭|Close/ }).last().click();
  await expect(page.getByText(/创建分享链接|Create share link/)).toBeHidden();

  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: `${evidenceDir}/reader-default-dark-1440x900.png`, fullPage: true });

  await page.goto("/library");
  await page.screenshot({ path: `${evidenceDir}/library-light-1440x900.png`, fullPage: true });
});

test("mobile home and reader do not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidenceDir}/home-mobile-light-390x844.png`, fullPage: true });
  await page.goto(`/conversations/${conversationId}`);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("article[data-message-id]").first()).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/reader-mobile-light-390x844.png`, fullPage: true });
});

test("reader error state screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/conversations/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText(/对话暂时不可用|Conversation unavailable/)).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/reader-error-light-1440x900.png`, fullPage: true });
});
