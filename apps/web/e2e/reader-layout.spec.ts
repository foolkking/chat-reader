import { expect, test, type Locator, type Page } from "@playwright/test";

const conversationId = process.env.E2E_CONVERSATION_ID;
const evidenceDir = process.env.E2E_SCREENSHOT_DIR ?? "../../docs/execution/screenshots";

test.skip(!conversationId, "E2E_CONVERSATION_ID is required");

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
}

async function focusAnchorError(page: Page, anchor: { id: string; offset: number }): Promise<number> {
  return page.evaluate(({ id, offset }) => {
    const block = document.getElementById(id);
    const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']");
    if (!block || !root) return Number.POSITIVE_INFINITY;
    return Math.abs((block.getBoundingClientRect().top - (root.getBoundingClientRect().top + 120)) - offset);
  }, anchor);
}

test("navigation, search, reader layout, annotation modes, and screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const desktopRecentLink = page.locator('a[href="/recent"]');
  await expect(desktopRecentLink).toHaveAttribute("href", "/recent");
  await expect(desktopRecentLink).toBeHidden();
  await page.keyboard.press("Control+k");
  await expect(page.locator('input[aria-label*="搜索"], input[aria-label*="Search"]').first()).toBeFocused();
  await page.screenshot({ path: `${evidenceDir}/home-light-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: /Import data|导入数据/ }).click();
  const importInput = page.getByTestId("import-file-input");
  await expect(importInput).toHaveAttribute("accept", ".json,.jsonl,.gz,.md,.markdown");
  await expect(page.getByRole("button", { name: /\.cr 归档/ })).toBeVisible();
  await importInput.setInputFiles("../api/storage/imports/6c7f6ce8-2c20-4e3c-be14-475e58f65009/lan-proxy-qa.json");
  await page.getByTestId("preview-import-button").click();
  await expect(page.getByText("LAN Proxy QA").last()).toBeVisible();
  await page.getByRole("button", { name: /Close|关闭/ }).last().click();

  await page.goto("/search?q=argparse");
  await expect(page.getByText(/argparse/i).first()).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/search-annotation-light-1440x900.png`, fullPage: true });
  await page.goto("/search?q=known-empty-execution-query-9d2c");
  await expect(page.getByText(/No results|\u6ca1\u6709\u627e\u5230\u7ed3\u679c/)).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/search-empty-light-1440x900.png`, fullPage: true });

  await page.goto(`/conversations/${conversationId}`);
  const offlineGuideDismiss = page.getByRole("button", { name: /暂不显示|Not now/ });
  if (await offlineGuideDismiss.isVisible()) await offlineGuideDismiss.click();
  await expect(page.locator(".reader-index-column")).toBeVisible();
  await expect(page.locator(".reader-toc-column")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("sidebar-global-search")).toBeFocused();
  await page.getByRole("button", { name: /Collapse sidebar|Close sidebar|关闭侧栏|收起侧栏/ }).click();
  const messages = page.locator("article[data-message-id]");
  await expect.poll(() => messages.count()).toBeGreaterThanOrEqual(2);
  const firstTwoX = await messages.evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.getBoundingClientRect().x));
  expect(Math.abs((firstTwoX[0] ?? 0) - (firstTwoX[1] ?? 0))).toBeLessThan(4);
  await page.screenshot({ path: `${evidenceDir}/reader-default-light-1440x900.png`, fullPage: true });
  await expect(page.getByTestId("reader-scroll-root")).toHaveAttribute("data-navigation-stage", /^(settled|settled:fallback)$/);
  await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
  const focusAnchor = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']");
    const line = (root?.getBoundingClientRect().top ?? 0) + 120;
    const articles = Array.from(root?.querySelectorAll<HTMLElement>("article[data-message-id]") ?? []);
    const article = articles.find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.top <= line && rect.bottom >= line;
    }) ?? articles.find((item) => item.getBoundingClientRect().bottom > line);
    const block = Array.from(article?.querySelectorAll<HTMLElement>("[data-block-index]") ?? []).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.top <= line && rect.bottom >= line;
    });
    const target = block ?? article;
    return { id: target?.id ?? "", offset: target ? target.getBoundingClientRect().top - line : 0 };
  });
  for (let focusCycle = 0; focusCycle < 3; focusCycle += 1) {
    if (focusCycle > 0) await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
    await page.getByRole("button", { name: /Focus mode|专注模式/ }).click();
    await expect(page.locator('[data-focus-mode="on"]')).toBeVisible();
    await expect(page.locator(".reader-index-column")).toBeHidden();
    await expect(page.locator("[data-reader-primary-sidebar]")).toHaveCount(0);
    await expect(page.locator('div[aria-label="Primary reader actions"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("chat-reader:reader-default-focus"))).not.toBe("true");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("chat-reader:reader-focus-mode"))).toBeNull();
    await expect.poll(() => focusAnchorError(page, focusAnchor)).toBeLessThanOrEqual(24);
    await page.waitForTimeout(400);
    await expect.poll(() => focusAnchorError(page, focusAnchor)).toBeLessThanOrEqual(24);
    await page.getByRole("button", { name: /退出专注模式|Exit focus mode/ }).click();
    await expect(page.locator('[data-focus-mode="off"]')).toBeVisible();
    await expect.poll(() => focusAnchorError(page, focusAnchor)).toBeLessThanOrEqual(24);
    await page.waitForTimeout(400);
    await expect.poll(() => focusAnchorError(page, focusAnchor)).toBeLessThanOrEqual(24);
  }

  const primaryActions = page.locator('div[aria-label="Primary reader actions"] button');
  await expect(primaryActions).toHaveCount(4);
  await expect(primaryActions.nth(0)).toHaveAttribute("aria-label", /Edit Markdown source|\u7f16\u8f91 Markdown \u6e90\u7801/);
  await expect(primaryActions.nth(1)).toHaveAttribute("aria-label", /Search|\u641c\u7d22/);
  await expect(primaryActions.nth(2)).toHaveAttribute("aria-label", /Annotations|\u6279\u6ce8/);
  await expect(primaryActions.nth(3)).toHaveAttribute("aria-label", /Focus mode|\u4e13\u6ce8\u6a21\u5f0f/);

  const activeArticle = page.locator("article[data-message-id]").filter({ visible: true }).first();
  const articleHeightBeforeEditor = await activeArticle.evaluate((element) => element.getBoundingClientRect().height);
  const sourceAnchor = await page.getByTestId("reader-scroll-root").evaluate((root) => {
    const line = root.getBoundingClientRect().top + 120;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>("[id^='block-']"));
    const target = candidates.find((element) => element.getBoundingClientRect().bottom > line) ?? candidates[0];
    return { id: target?.id ?? "", top: target?.getBoundingClientRect().top ?? line };
  });
  await primaryActions.nth(0).click();
  const sourceWorkspace = page.getByTestId("floating-source-workspace");
  await expect(sourceWorkspace).toBeVisible();
  await expect(page.getByTestId("source-editor-codemirror")).toBeVisible();
  await expect(activeArticle.locator(".reader-message-body")).toBeVisible();
  await expect.poll(() => activeArticle.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(articleHeightBeforeEditor, 0);
  await expect.poll(async () => Math.abs((await page.locator(`#${sourceAnchor.id}`).boundingBox())!.y - sourceAnchor.top)).toBeLessThanOrEqual(24);
  const sourceBox = await sourceWorkspace.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(sourceBox!.x).toBe(0);
  expect(sourceBox!.y).toBe(0);
  expect(sourceBox!.width).toBeGreaterThanOrEqual(560);
  expect(sourceBox!.width).toBeLessThanOrEqual(720);
  expect(sourceBox!.height).toBe(900);
  const readerMainBox = await page.locator("[data-reader-main-section]").boundingBox();
  expect(readerMainBox).not.toBeNull();
  expect(readerMainBox!.x).toBeGreaterThanOrEqual(sourceBox!.width - 1);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.locator(".cm-editor").evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgb(255, 255, 255)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await primaryActions.nth(0).click();
  await expect(sourceWorkspace).toHaveCount(0);
  await expect.poll(async () => Math.abs((await page.locator(`#${sourceAnchor.id}`).boundingBox())!.y - sourceAnchor.top)).toBeLessThanOrEqual(24);

  await page.evaluate(() => localStorage.removeItem("chat-reader:conversation-files-workspace-floating-v2"));
  const filesButton = page.getByRole("button", { name: /\u5f53\u524d\u5bf9\u8bdd\u6587\u4ef6|Conversation files/ }).first();
  await filesButton.click();
  const filesWorkspace = page.getByTestId("conversation-files-workspace");
  await expect(filesWorkspace).toBeVisible();
  const defaultFilesBox = await filesWorkspace.boundingBox();
  expect(defaultFilesBox).not.toBeNull();
  expect(defaultFilesBox!.x).toBeCloseTo(1440 - 400 - 28, 0);
  expect(defaultFilesBox!.y).toBeCloseTo(72, 0);
  expect(defaultFilesBox!.width).toBeCloseTo(400, 0);
  expect(defaultFilesBox!.height).toBeCloseTo(620, 0);
  const filesDragHandle = filesWorkspace.locator("[data-workspace-drag-handle='true']");
  const filesHeaderBox = await filesDragHandle.boundingBox();
  expect(filesHeaderBox).not.toBeNull();
  await page.mouse.move(filesHeaderBox!.x + filesHeaderBox!.width / 2, filesHeaderBox!.y + filesHeaderBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(filesHeaderBox!.x + filesHeaderBox!.width / 2 - 80, filesHeaderBox!.y + filesHeaderBox!.height / 2 + 24, { steps: 4 });
  await page.mouse.up();
  const movedFilesBox = await filesWorkspace.boundingBox();
  expect(movedFilesBox!.x).toBeCloseTo(defaultFilesBox!.x - 80, 0);
  expect(movedFilesBox!.y).toBeCloseTo(defaultFilesBox!.y + 24, 0);
  await filesWorkspace.getByRole("button", { name: /Close|\u5173\u95ed/ }).click();
  await filesButton.click();
  const restoredFilesBox = await filesWorkspace.boundingBox();
  expect(restoredFilesBox!.x).toBeCloseTo(movedFilesBox!.x, 0);
  expect(restoredFilesBox!.y).toBeCloseTo(movedFilesBox!.y, 0);
  await filesWorkspace.getByRole("button", { name: /Reset file window position|\u91cd\u7f6e\u6587\u4ef6\u7a97\u53e3\u4f4d\u7f6e/ }).click();
  await expect.poll(async () => (await filesWorkspace.boundingBox())!.x).toBeCloseTo(defaultFilesBox!.x, 0);
  await filesWorkspace.getByRole("button", { name: /Close|\u5173\u95ed/ }).click();

  await primaryActions.nth(2).click();
  await expect(page.locator('[data-annotation-mode="floating"]')).toBeVisible();
  await primaryActions.nth(2).click();
  await expect(page.locator('[data-annotation-mode="floating"]')).toHaveCount(0);

  await page.getByRole("button", { name: /^(Search|\u641c\u7d22)$/ }).click();
  const conversationSearch = page.getByPlaceholder(/Search this conversation and its annotations|搜索当前对话/);
  await conversationSearch.fill("argparse");
  await expect(page.getByText(/共 \d+ 个结果|\d+ results/)).toBeVisible();
  await expect(page.locator("mark", { hasText: /argparse/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /Close|关闭/ }).last().click();

  await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
  await page.getByRole("button", { name: /Export|导出/ }).click();
  await expect(page.getByRole("group", { name: /^(Export|导出)$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Markdown", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "CanJSON", exact: true })).toBeVisible();
  await expect(page.getByText(/包含附件|Include attachments/)).toBeVisible();
  await page.getByRole("button", { name: /Close|关闭/ }).last().click();

  await page.goto(`/conversations/${conversationId}?annotations=open`);
  const workspace = page.locator('[data-annotation-mode="floating"]');
  await expect(workspace).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/reader-annotation-floating-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: /展开批注阅读|Expand annotation reading/ }).click();
  const expandedAnnotations = page.locator('[data-annotation-mode="expanded"]');
  await expect(expandedAnnotations).toBeVisible();
  await expandedAnnotations.getByRole("button", { name: /逐条回顾|Review one by one/ }).click();
  await expect(page).toHaveURL(/annotation_layout=expanded/);
  await page.goBack();
  await expect(page).not.toHaveURL(/annotation_layout=expanded/);
  await expect(workspace).toBeVisible();
  await page.getByRole("button", { name: /固定到左侧栏|Dock to the left/ }).click();
  await expect(page.locator('[data-annotation-mode="docked"]')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/reader-annotation-docked-1440x900.png`, fullPage: true });
  await page.getByRole("button", { name: /恢复为浮窗|Return to floating/ }).click();
  await expect(page.locator('[data-annotation-mode="floating"]')).toBeVisible();

  await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
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
  await expect(page.locator('a[href="/recent"]:visible')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId("sort-menu-panel").filter({ visible: true })).toHaveCount(0);
  await page.getByTestId("sort-menu-trigger").filter({ visible: true }).click();
  await expectInsideViewport(page, page.getByTestId("sort-menu-panel").filter({ visible: true }));
  await page.reload();
  await expect(page.getByTestId("sort-menu-panel").filter({ visible: true })).toHaveCount(0);
  await page.getByTestId("sort-menu-trigger").filter({ visible: true }).click();
  await page.getByTestId("sort-menu-panel").filter({ visible: true }).getByRole("button").first().click();
  await page.screenshot({ path: `${evidenceDir}/home-mobile-light-390x844.png`, fullPage: true });
  await page.goto(`/conversations/${conversationId}`);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("article[data-message-id]").first()).toBeVisible();
  const mobileHeader = page.getByTestId("mobile-reader-header");
  await expect(mobileHeader.getByTestId("mobile-sidebar-button")).toBeVisible();
  await expect(page.getByRole("button", { name: /返回|Back/ })).toHaveCount(0);
  const offlineGuideDismiss = page.getByRole("button", { name: /暂不显示|Not now/ });
  if (await offlineGuideDismiss.isVisible()) await offlineGuideDismiss.click();

  const readerScrollRoot = page.getByTestId("reader-scroll-root");
  await expect(readerScrollRoot).toHaveAttribute("data-navigation-stage", /^(settled|settled:fallback)$/);
  await readerScrollRoot.evaluate((root) => { root.scrollTop = Math.min(1200, Math.max(0, root.scrollHeight - root.clientHeight)); });
  await page.waitForTimeout(250);
  await expect.poll(() => mobileHeader.evaluate((header) => header.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  await readerScrollRoot.evaluate((root) => { root.scrollTop = 0; });
  await page.waitForTimeout(750);
  await readerScrollRoot.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => mobileHeader.evaluate((header) => header.getBoundingClientRect().top)).toBeLessThan(-20);
  await page.mouse.wheel(0, -2);
  await expect.poll(() => mobileHeader.evaluate((header) => header.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);

  await page.getByRole("button", { name: /阅读导航|Reader navigation/ }).click();
  const navigationSheet = page.getByRole("dialog", { name: /阅读导航|Reader navigation/ });
  await expect(navigationSheet).toBeVisible();
  await navigationSheet.getByRole("button", { name: /^(章节|Sections)$/, exact: true }).click();
  await navigationSheet.getByRole("button", { name: /关闭|Close/ }).click();

  await page.getByRole("button", { name: /更多|More/ }).click();
  const toolsSheet = page.getByRole("dialog", { name: /阅读工具|Reader tools/ });
  await expect(toolsSheet).toBeVisible();
  await toolsSheet.getByRole("button", { name: /搜索|Search/ }).click();
  const searchSheet = page.getByRole("dialog", { name: /^(搜索|Search)$/ });
  await expect(searchSheet).toBeVisible();
  await searchSheet.getByPlaceholder(/Search this conversation and its annotations|搜索当前对话/).fill("argparse");
  await expect(searchSheet.getByText(/共 \d+ 个结果|\d+ results/)).toBeVisible();
  await searchSheet.getByRole("button", { name: /关闭|Close/ }).click();

  await page.getByRole("button", { name: /更多|More/ }).click();
  await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name: /导出|Export/ }).click();
  const mobileExportSheet = page.getByRole("dialog", { name: /^(导出|Export)$/ });
  await expect(mobileExportSheet.getByRole("button", { name: "CanJSON v2" })).toBeVisible();
  await mobileExportSheet.getByRole("button", { name: /关闭|Close/ }).click();

  await page.getByRole("button", { name: /更多|More/ }).click();
  await page.getByRole("dialog", { name: /阅读工具|Reader tools/ }).getByRole("button", { name: /批注|Annotations/ }).click();
  await expect(page.locator('[data-annotation-mode="floating"]')).toBeVisible();
  await page.locator("article[data-message-id] [data-block-index]").filter({ hasText: /\S/ }).first().evaluate((block) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent ?? "").trim()) node = walker.nextNode();
    if (!node) throw new Error("No selectable message text");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(8, node.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const annotationToolbar = page.getByRole("toolbar", { name: "Create annotation" });
  await expect(annotationToolbar).toBeVisible();
  await expect(annotationToolbar.getByRole("button", { name: /^(高亮|Highlight)$/ })).toBeVisible();
  await expect(annotationToolbar.getByRole("button", { name: /^(下划线|Underline)$/ })).toBeVisible();
  await expect(annotationToolbar.getByRole("button", { name: /^(评论|Comment)$/ })).toBeVisible();
  await expect(annotationToolbar.getByRole("button", { name: "Strikethrough", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/reader-mobile-light-390x844.png`, fullPage: true });
});

test("mobile application pages share the CR top bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const assertSharedHeader = async (route: string) => {
    await page.goto(route);
    const header = page.getByTestId("mobile-page-header");
    await expect(header).toBeVisible();
    const trigger = header.getByTestId("mobile-sidebar-button");
    await expect(trigger).toHaveText("CR");
    await expectInsideViewport(page, header);
    await trigger.click();
    await expect(page.locator("[data-reader-primary-sidebar]:visible")).toBeVisible();
    await page.mouse.click(380, 420);
  };

  const projectsResponse = await page.request.get("/api/projects");
  expect(projectsResponse.ok()).toBe(true);
  const projects = await projectsResponse.json() as Array<{ id: string }>;
  const projectHref = projects[0] ? `/projects/${projects[0].id}` : null;

  for (const route of ["/", "/archived", "/search", "/recent"]) await assertSharedHeader(route);
  expect(projectHref).toBeTruthy();
  await assertSharedHeader(projectHref!);
});

test("conversation rows use contextual bulk selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const firstArticle = page.locator("article").first();
  await expect(firstArticle.getByRole("button", { name: /管理|Manage/ })).toBeVisible();
  await page.getByRole("button", { name: /批量操作|Manage conversations/ }).click();
  await expect(page.getByRole("button", { name: /完成批量操作|Done/ }).first()).toBeVisible();
  const checkboxes = page.locator("article input[type=checkbox]");
  await expect.poll(() => checkboxes.count()).toBeGreaterThanOrEqual(2);
  const first = checkboxes.nth(0);
  const second = checkboxes.nth(1);
  await expect(first).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: /批量选择工具|bulk selection tools/ });
  await expect(toolbar).toBeVisible();
  await expect(page.locator("article input[type=checkbox]:checked")).toHaveCount(0);
  const toolbarBox = await toolbar.boundingBox();
  const firstArticleBox = await firstArticle.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(firstArticleBox).not.toBeNull();
  expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(firstArticleBox!.y + 1);
  await first.click();
  await second.click({ modifiers: ["Shift"], force: true });
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
  await toolbar.getByRole("button", { name: /合并对话|Merge/ }).click();
  const mergeDialog = page.getByRole("dialog", { name: /合并对话|Merge conversations/ });
  await expect(mergeDialog).toBeVisible();
  await expect(mergeDialog.getByText(/确认 2 个对话的标题与合并顺序|Confirm the title and order for 2 conversations/)).toBeVisible();
  await mergeDialog.getByRole("button", { name: /取消|Cancel/ }).click();
  await expect(mergeDialog).toHaveCount(0);
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Control+a");
  await expect.poll(async () => page.locator("article input[type=checkbox]:checked").count()).toBe(await checkboxes.count());
  await toolbar.getByRole("button", { name: /清空|Clear/ }).click();
  await expect(page.locator("article input[type=checkbox]:checked")).toHaveCount(0);
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);
  await expect(checkboxes.first()).toBeHidden();
});

test("mobile menus and zero-selection toolbar stay inside narrow viewports", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("sort-menu-panel").filter({ visible: true })).toHaveCount(0);
    await page.getByTestId("sort-menu-trigger").filter({ visible: true }).click();
    const sortPanel = page.getByTestId("sort-menu-panel").filter({ visible: true });
    await expectInsideViewport(page, sortPanel);
    await sortPanel.getByRole("button").first().click();

    await page.getByRole("button", { name: /批量操作|Manage conversations/ }).click();
    const toolbar = page.getByTestId("selection-toolbar");
    await expectInsideViewport(page, toolbar);
    await expect(page.locator("article input[type=checkbox]:visible").first()).toBeVisible();
    await expect(page.locator("article input[type=checkbox]:checked")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await toolbar.getByRole("button", { name: /完成|Done/ }).click();
  }
});

test("utility drawer and annotation window stay inside constrained viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/conversations/${conversationId}`);
  await page.evaluate(() => {
    localStorage.setItem("chat-reader:reader-utility-panel-width", "99999");
    localStorage.setItem("chat-reader:annotation-workspace-panel", JSON.stringify({ x: -5000, y: -5000, width: 5000, height: 5000 }));
  });
  await page.reload();
  const offlineGuideDismiss = page.getByRole("button", { name: /暂不显示|Not now/ });
  if (await offlineGuideDismiss.isVisible()) await offlineGuideDismiss.click();

  await page.getByRole("button", { name: /分享|Share/ }).click();
  const drawer = page.getByRole("dialog", { name: /分享对话|Share conversation/ });
  await expect(drawer).toBeVisible();
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.x).toBeGreaterThanOrEqual(0);
  expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(1280);
  await expect(drawer.getByRole("checkbox", { name: /包含对话说明|Include description/ })).toBeVisible();
  await expect(drawer.getByRole("checkbox", { name: /包含精选笔记|Include notes/ })).toBeVisible();
  await drawer.getByRole("button", { name: /关闭|Close/ }).click();

  await page.goto(`/conversations/${conversationId}?annotations=open`);
  const workspace = page.locator('[data-annotation-mode="floating"]');
  await expect(workspace).toBeVisible();
  const panelBox = await workspace.boundingBox();
  const sidebarBox = await page.locator("[data-reader-primary-sidebar]").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
  expect(panelBox!.y).toBeGreaterThanOrEqual(64);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(1280);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(720);
  await page.getByRole("button", { name: /重置批注窗口位置|Reset annotation window position/ }).click();
  const resetBox = await workspace.boundingBox();
  expect(resetBox!.width).toBeLessThanOrEqual(400);
  expect(resetBox!.x + resetBox!.width).toBeLessThanOrEqual(1280);
});

test("reading preset and focus default are independent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/conversations/${conversationId}`);
  await page.evaluate(() => localStorage.setItem("chat-reader:reader-sidebar-expanded", "true"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const preferencesButton = page.getByRole("button", { name: /设置|Settings|外观与语言|Appearance & language/ });
  await expect(preferencesButton).toBeVisible();
  await preferencesButton.click();
  const preferences = page.getByRole("region", { name: /设置|Settings|外观与语言|Appearance & language/ });
  await expect(preferences.getByText(/Markdown 间距|Markdown spacing/)).toHaveCount(0);
  const languageButton = preferences.getByRole("button", { name: /Simplified Chinese|\u7b80\u4f53\u4e2d\u6587/ });
  await expect(languageButton).toHaveCount(0);
  await preferences.getByRole("button", { name: /更多阅读设置|More reading settings/ }).click();
  await expect(languageButton).toBeVisible();
  await expect(preferences.getByText(/Markdown 间距|Markdown spacing/)).toBeVisible();
  await preferences.getByRole("button", { name: /宽松|Spacious/ }).click();
  await expect(page.locator('[data-reader-density="large"]')).toBeVisible();
  const resetFontSize = preferences.getByRole("button", { name: /17px/ });
  if (await resetFontSize.isEnabled()) await resetFontSize.click();
  await expect(preferences.getByText("17px", { exact: true })).toBeVisible();
  const beforeFontSize = await page.locator(".reader-content-inner").evaluate((element) => getComputedStyle(element).fontSize);
  await preferences.getByRole("button", { name: /增大字号|Increase text size/ }).click();
  const afterFontSize = await page.locator(".reader-content-inner").evaluate((element) => getComputedStyle(element).fontSize);
  expect(Number.parseFloat(afterFontSize)).toBeGreaterThan(Number.parseFloat(beforeFontSize));
  await resetFontSize.click();
  await preferences.getByRole("button", { name: /舒适|Comfortable/ }).click();
  await page.getByRole("button", { name: /收回设置|Collapse settings/ }).click();

  await page.evaluate(() => localStorage.setItem("chat-reader:reader-default-focus", "true"));
  await page.reload();
  await expect(page.locator('[data-focus-mode="on"]')).toBeVisible();
  await page.getByRole("button", { name: /退出专注模式|Exit focus mode/ }).click();
  await expect(page.locator('[data-focus-mode="off"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("chat-reader:reader-default-focus"))).toBe("true");
  await page.evaluate(() => localStorage.setItem("chat-reader:reader-default-focus", "false"));
});

test("reader error state screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/conversations/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText(/对话暂时不可用|Conversation unavailable/)).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/reader-error-light-1440x900.png`, fullPage: true });
});
