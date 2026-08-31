import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const runLongReaderRegression = process.env.E2E_LONG_READER === "1";

test.skip(!runLongReaderRegression, "E2E_LONG_READER=1 is required");

let conversationId = "";
let targetMessageId = "";
let targetBlockIndex = 0;
let annotationQuote = "";
let shareId = "";
let shareToken = "";

test.beforeAll(async ({ request }) => {
  const existingConversationId = process.env.E2E_LONG_READER_CONVERSATION_ID;
  const existingTargetMessageId = process.env.E2E_LONG_READER_TARGET_MESSAGE_ID;
  const existingTargetBlockIndex = Number(process.env.E2E_LONG_READER_TARGET_BLOCK_INDEX);
  if (existingConversationId && existingTargetMessageId && Number.isFinite(existingTargetBlockIndex)) {
    conversationId = existingConversationId;
    targetMessageId = existingTargetMessageId;
    targetBlockIndex = existingTargetBlockIndex;
    annotationQuote = process.env.E2E_LONG_READER_ANNOTATION_QUOTE ?? `target-35-180-paragraph`;
  } else {
    const seeded = await seedLongConversation(request);
    conversationId = seeded.conversationId;
    targetMessageId = seeded.targetMessageId;
    targetBlockIndex = seeded.targetBlockIndex;
    annotationQuote = seeded.annotationQuote;
  }
  const share = await request.post(`/api/conversations/${conversationId}/shares`, {
    data: { scope: "conversation", include_toc: true, include_metadata: true },
  });
  expect(share.ok()).toBe(true);
  const payload = await share.json() as { id: string; token: string };
  shareId = payload.id;
  shareToken = payload.token;
});

test.afterAll(async ({ request }) => {
  if (shareId) await request.post(`/api/shares/${shareId}/revoke`);
});

test("direct URL keeps a virtualized target mounted through final alignment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/conversations/${conversationId}?messageId=${targetMessageId}&blockIndex=${targetBlockIndex}&characterOffset=0`,
  );

  const targetBlock = page.locator(`#block-${targetMessageId}-${targetBlockIndex}`);
  const targetArticle = page.locator(`#message-${targetMessageId}`);
  const scrollRoot = page.locator("[data-navigation-stage]");
  await expect(targetBlock).toBeVisible();
  await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");
  await expect.poll(async () => targetBlock.evaluate((block) => {
    const root = block.closest<HTMLElement>(".overflow-y-auto");
    if (!root) return Number.POSITIVE_INFINITY;
    return Math.abs(block.getBoundingClientRect().top - (root.getBoundingClientRect().top + 120));
  })).toBeLessThanOrEqual(24);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);
  await page.waitForTimeout(400);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);
  await page.waitForTimeout(4600);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);
  await expect.poll(() => targetArticle.locator("[data-block-index]").count()).toBeLessThanOrEqual(33);
  await expectVirtualRowsNotToOverlap(targetArticle);

  const readerFrame = page.locator(".reader-frame");
  await readerFrame.evaluate((frame) => {
    const element = frame as HTMLElement;
    element.dataset.readerDensity = "large";
    element.dataset.readerWidth = "compact";
    element.style.setProperty("--reader-font-size", "22px");
  });
  await expectVirtualRowsNotToOverlap(targetArticle);
  await page.setViewportSize({ width: 1280, height: 720 });
  await readerFrame.evaluate((frame) => {
    const element = frame as HTMLElement;
    element.dataset.readerDensity = "compact";
    element.dataset.readerWidth = "wide";
    element.style.setProperty("--reader-font-size", "15px");
  });
  await expectVirtualRowsNotToOverlap(targetArticle);
});

test("large scrollbar jumps repair stale virtual coordinates instead of leaving a blank message", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/conversations/${conversationId}?messageId=${targetMessageId}&blockIndex=${Math.max(24, targetBlockIndex - 80)}&characterOffset=0`,
  );

  const scrollRoot = page.locator("[data-reader-scroll-root='true']");
  const targetArticle = page.locator(`#message-${targetMessageId}`);
  await expect(targetArticle.locator('[data-virtualized-block-list="true"]')).toBeVisible();
  await expect.poll(() => visibleBlockCount(targetArticle)).toBeGreaterThan(0);

  // Model a late upstream virtual-height correction after the target
  // virtualizer cached its absolute scroll margin. The production failure was
  // the same coordinate shift after edge-window merge and row measurement.
  await targetArticle.evaluate((article) => {
    const spacer = document.createElement("div");
    spacer.dataset.testUpstreamVirtualShift = "true";
    spacer.style.height = "8000px";
    spacer.setAttribute("aria-hidden", "true");
    article.before(spacer);
  });
  await scrollRoot.evaluate((root, messageId) => {
    const article = document.getElementById(`message-${messageId}`);
    if (!article) throw new Error("Target article is missing");
    const rootRect = root.getBoundingClientRect();
    const articleRect = article.getBoundingClientRect();
    const articleStart = root.scrollTop + articleRect.top - rootRect.top;
    root.scrollTop = articleStart + articleRect.height * 0.55;
  }, targetMessageId);

  await expect.poll(() => visibleBlockCount(targetArticle), { timeout: 750, intervals: [25, 50, 100] }).toBeGreaterThan(0);
  await expect.poll(() => readingLineContentDistance(page), { timeout: 750, intervals: [25, 50, 100] }).toBeLessThanOrEqual(48);

  await page.locator('[data-test-upstream-virtual-shift="true"]').evaluate((spacer) => spacer.remove());

  const jumpLandings = await scrollRoot.evaluate(async (root) => {
    const samples: number[] = [];
    for (const ratio of [0.08, 0.88, 0.2, 0.74, 0.35, 0.62]) {
      root.scrollTop = (root.scrollHeight - root.clientHeight) * ratio;
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      const rootRect = root.getBoundingClientRect();
      samples.push(Array.from(root.querySelectorAll<HTMLElement>("[data-block-index]")).filter((block) => {
        const rect = block.getBoundingClientRect();
        return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
      }).length);
    }
    return samples;
  });
  expect(jumpLandings.every((count) => count > 0), `blank jump samples: ${jumpLandings.join(",")}`).toBe(true);
});

test("scrollbar pointer drag defers edge-window growth until pointer release", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/conversations/${conversationId}?messageId=${targetMessageId}&blockIndex=${Math.max(24, targetBlockIndex - 80)}&characterOffset=0`,
  );

  const scrollRoot = page.locator("[data-reader-scroll-root='true']");
  await expect(scrollRoot).toBeVisible();
  await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");
  let edgeRequests = 0;
  await page.route("**/api/conversations/*/reader-turn*", async (route) => {
    edgeRequests += 1;
    await route.continue();
  });
  await scrollRoot.evaluate((root) => {
    root.setAttribute("data-test-next-loading-count", "0");
    const observer = new MutationObserver(() => {
      if (root.getAttribute("data-reader-edge-stage") !== "next:loading") return;
      const current = Number.parseInt(root.getAttribute("data-test-next-loading-count") ?? "0", 10);
      root.setAttribute("data-test-next-loading-count", String(current + 1));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-reader-edge-stage"] });
    (root as HTMLElement & { __readerEdgeTestObserver?: MutationObserver }).__readerEdgeTestObserver = observer;
  });

  await scrollRoot.evaluate((root) => {
    root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight - 320);
  });
  const box = await scrollRoot.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + Math.min(360, box!.width / 2), box!.y + Math.min(240, box!.height / 2));
  await page.mouse.down();
  await expect(scrollRoot).toHaveAttribute("data-reader-pointer-dragging", "true");
  await scrollRoot.evaluate((root) => {
    root.scrollTop = root.scrollHeight - root.clientHeight;
  });
  await page.waitForTimeout(250);
  expect(edgeRequests).toBe(0);
  await expect(scrollRoot).toHaveAttribute("data-test-next-loading-count", "0");

  await page.mouse.up();
  await expect(scrollRoot).not.toHaveAttribute("data-reader-pointer-dragging", "true");
  await expect.poll(() => edgeRequests, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(scrollRoot).toHaveAttribute("data-reader-edge-stage", "next:settled");
  await expect(scrollRoot).toHaveAttribute("data-test-next-loading-count", "1");
  await scrollRoot.evaluate((root) => {
    (root as HTMLElement & { __readerEdgeTestObserver?: MutationObserver }).__readerEdgeTestObserver?.disconnect();
  });
  await page.unroute("**/api/conversations/*/reader-turn*");
});

test("section TOC follows virtual headings beyond the initially mounted blocks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/conversations/${conversationId}?messageId=${targetMessageId}&blockIndex=0`);

  const scrollRoot = page.locator("[data-reader-scroll-root='true']");
  const tocScroller = page.locator("[data-section-toc-scroll='true']");
  await expect(tocScroller).toBeVisible();
  await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");
  await expect.poll(() => tocScroller.locator("[data-toc-active='true']").count()).toBe(1);

  const initialActive = await tocScroller.locator("[data-toc-active='true']").getAttribute("data-toc-block-id");
  await scrollRoot.hover();
  await page.mouse.wheel(0, 12_000);
  await expect.poll(async () => tocScroller.locator("[data-toc-active='true']").getAttribute("data-toc-block-id"))
    .not.toBe(initialActive);
  await expect.poll(async () => tocScroller.locator("[data-toc-active='true']").evaluate((row) => {
    const container = row.closest<HTMLElement>("[data-section-toc-scroll='true']");
    if (!container) return false;
    const rowRect = row.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return rowRect.top >= containerRect.top - 1 && rowRect.bottom <= containerRect.bottom + 1;
  })).toBe(true);
  await expect.poll(() => tocScroller.evaluate((container) => container.scrollTop)).toBeGreaterThan(0);
});

test("virtualized reading anchor survives consecutive spacing, font, and width changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/conversations/${conversationId}?messageId=${targetMessageId}&blockIndex=${targetBlockIndex}&characterOffset=0`,
  );

  const targetArticle = page.locator(`#message-${targetMessageId}`);
  const targetBlock = page.locator(`#block-${targetMessageId}-${targetBlockIndex}`);
  const scrollRoot = page.locator("[data-reader-scroll-root='true']");
  const readerFrame = page.locator(".reader-frame");
  await expect(targetBlock).toBeVisible();
  await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");

  const preferencesButton = page.getByRole("button", { name: /设置|Settings|外观与语言|Appearance & language/ });
  if (!await preferencesButton.isVisible()) {
    await page.getByRole("button", { name: /展开侧栏|Open sidebar/ }).click();
  }
  const preferencesPanelId = await preferencesButton.getAttribute("aria-controls");
  expect(preferencesPanelId).toBeTruthy();
  await preferencesButton.click();
  const preferences = page.getByRole("region", { name: /设置|Settings|外观与语言|Appearance & language/ });
  await preferences.getByRole("button", { name: /更多阅读设置|More reading settings/ }).click();

  await preferences.getByRole("button", { name: /舒适|Comfortable/ }).click();
  await expect(readerFrame).toHaveAttribute("data-reader-density", "comfortable");
  const resetFontSize = preferences.getByRole("button", { name: /恢复 17px|Reset to 17px/ });
  if (await resetFontSize.isEnabled()) await resetFontSize.click();
  await expect.poll(() => readerFrame.evaluate((frame) => (
    getComputedStyle(frame).getPropertyValue("--reader-font-size").trim()
  ))).toBe("17px");
  await preferences.getByRole("button", { name: /^(标准|Standard)$/ }).click();
  await expect(readerFrame).toHaveAttribute("data-reader-width", "standard");

  await scrollRoot.hover();
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(250);
  const anchor = await captureReadingBlockAnchor(page, targetMessageId);
  expect(anchor.id).not.toBe("");

  const applyLayoutPreference = async (action: () => Promise<void>, applied: () => Promise<boolean>) => {
    await action();
    await expect.poll(applied).toBe(true);
    await expect.poll(() => focusAnchorError(page, anchor)).toBeLessThanOrEqual(24);
    await expectVirtualRowsNotToOverlap(targetArticle);
    await page.waitForTimeout(400);
    await expect.poll(() => focusAnchorError(page, anchor)).toBeLessThanOrEqual(24);
    await expectVirtualRowsNotToOverlap(targetArticle);
  };

  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /^(紧凑|Compact)$/ }).click(),
    () => readerFrame.getAttribute("data-reader-density").then((value) => value === "compact"),
  );
  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /^(宽松|Spacious)$/ }).click(),
    () => readerFrame.getAttribute("data-reader-density").then((value) => value === "large"),
  );
  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /^(舒适|Comfortable)$/ }).click(),
    () => readerFrame.getAttribute("data-reader-density").then((value) => value === "comfortable"),
  );
  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /增大字号|Increase text size/ }).click(),
    () => readerFrame.evaluate((frame) => getComputedStyle(frame).getPropertyValue("--reader-font-size").trim() === "18px"),
  );
  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /增大字号|Increase text size/ }).click(),
    () => readerFrame.evaluate((frame) => getComputedStyle(frame).getPropertyValue("--reader-font-size").trim() === "19px"),
  );
  await applyLayoutPreference(
    () => resetFontSize.click(),
    () => readerFrame.evaluate((frame) => getComputedStyle(frame).getPropertyValue("--reader-font-size").trim() === "17px"),
  );
  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /^(宽|Wide)$/ }).click(),
    () => readerFrame.getAttribute("data-reader-width").then((value) => value === "wide"),
  );
  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /^(窄|Narrow)$/ }).click(),
    () => readerFrame.getAttribute("data-reader-width").then((value) => value === "compact"),
  );
  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /^(标准|Standard)$/ }).click(),
    () => readerFrame.getAttribute("data-reader-width").then((value) => value === "standard"),
  );

  await preferences.getByRole("button", { name: /^(紧凑|Compact)$/ }).click();
  await expect(readerFrame).toHaveAttribute("data-reader-density", "compact");
  await page.waitForTimeout(650);
  await preferences.getByRole("button", { name: /增大字号|Increase text size/ }).click();
  await expect.poll(() => readerFrame.evaluate((frame) => (
    getComputedStyle(frame).getPropertyValue("--reader-font-size").trim()
  ))).toBe("18px");
  await page.waitForTimeout(120);
  expect(await focusAnchorError(page, anchor)).toBeLessThanOrEqual(24);
  await page.waitForTimeout(300);
  expect(await focusAnchorError(page, anchor)).toBeLessThanOrEqual(24);
  await page.waitForTimeout(4600);
  expect(await focusAnchorError(page, anchor)).toBeLessThanOrEqual(24);
  await expectVirtualRowsNotToOverlap(targetArticle);

  await applyLayoutPreference(
    () => preferences.getByRole("button", { name: /^(舒适|Comfortable)$/ }).click(),
    () => readerFrame.getAttribute("data-reader-density").then((value) => value === "comfortable"),
  );
  await applyLayoutPreference(
    () => resetFontSize.click(),
    () => readerFrame.evaluate((frame) => getComputedStyle(frame).getPropertyValue("--reader-font-size").trim() === "17px"),
  );
  await page.locator(`button[aria-controls="${preferencesPanelId}"]`).click();
});

test("far annotation jump and refresh restore hydrate heavy content", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/conversations/${conversationId}?annotations=open`);

  await page.getByRole("button", { name: /^(全部|All)$/ }).click();
  const annotation = page.getByText(annotationQuote, { exact: true });
  await expect(annotation).toBeVisible();
  await annotation.click();

  const targetBlock = page.locator(`#block-${targetMessageId}-${targetBlockIndex}`);
  const targetArticle = page.locator(`#message-${targetMessageId}`);
  await expect(targetBlock).toBeVisible();
  const virtualizedBlocks = targetArticle.locator('[data-virtualized-block-list="true"]');
  await expect.poll(async () => Number(await virtualizedBlocks.getAttribute("data-virtualized-block-count")))
    .toBeGreaterThanOrEqual(380);
  await expect.poll(() => targetArticle.locator("[data-block-index]").count()).toBeLessThanOrEqual(32);
  await expectVirtualRowsNotToOverlap(targetArticle);
  await expect(targetArticle.getByRole("button", { name: /立即展开|Expand now/ })).toHaveCount(0);
  await expect.poll(async () => targetBlock.evaluate((block) => {
    const root = block.closest<HTMLElement>(".overflow-y-auto");
    if (!root) return Number.POSITIVE_INFINITY;
    return Math.abs(block.getBoundingClientRect().top - (root.getBoundingClientRect().top + 120));
  })).toBeLessThanOrEqual(24);
  await page.waitForTimeout(400);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);
  await page.waitForTimeout(4600);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);

  const annotationRegion = page.getByRole("region", { name: /批注|Annotations/ });
  await annotationRegion.getByRole("button", { name: /关闭|Close/ }).click();
  await expect(targetBlock).toBeVisible();
  await page.waitForTimeout(200);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);
  await page.waitForTimeout(800);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);
  await page.waitForTimeout(4000);
  await expect.poll(() => readingRangeError(targetBlock)).toBeLessThanOrEqual(24);

  const scrollRoot = page.locator("[data-navigation-stage]");
  await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");
  await scrollRoot.evaluate((root) => root.scrollBy({ top: 420, behavior: "auto" }));
  await page.waitForTimeout(2500);
  await expect.poll(async () => {
    const response = await request.get(`/api/conversations/${conversationId}/reading-position`);
    if (!response.ok()) return null;
    return (await response.json()).position as { message_id: string | null; block_index: number | null; anchor_data: Record<string, unknown> } | null;
  }, { timeout: 10_000 }).toMatchObject({ message_id: targetMessageId });

  const persistedResponse = await request.get(`/api/conversations/${conversationId}/reading-position`);
  const persisted = (await persistedResponse.json()).position as { message_id: string; block_index: number | null; anchor_data: Record<string, unknown> };
  expect(persisted.message_id).toBe(targetMessageId);
  expect(persisted.block_index).not.toBeNull();
  expect(persisted.anchor_data).toMatchObject({
    position_mode: "block-relative-v2",
    block_id: expect.any(String),
    version_id: expect.any(String),
    order_key: expect.any(String),
    scroll_ratio: expect.any(Number),
  });

  await page.reload();
  const restoredArticle = page.locator(`#message-${persisted.message_id}`);
  const restoredBlock = page.locator(`#block-${persisted.message_id}-${persisted.block_index}`);
  await expect(restoredBlock).toBeVisible();
  await expect(restoredArticle.getByRole("button", { name: /立即展开|Expand now/ })).toHaveCount(0);
  await expect.poll(async () => restoredBlock.evaluate((block) => {
    const root = block.closest<HTMLElement>(".overflow-y-auto");
    if (!root) return Number.POSITIVE_INFINITY;
    const readingLine = root.getBoundingClientRect().top + 120;
    const rect = block.getBoundingClientRect();
    return readingLine >= rect.top - 32 && readingLine <= rect.bottom + 32;
  })).toBe(true);

  await expect.poll(async () => page.locator("article[data-message-id]").evaluateAll((articles) => (
    articles
      .filter((article) => {
        const rect = article.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      })
      .every((article) => !/(立即展开|Expand now)/.test(article.textContent ?? ""))
  ))).toBe(true);
  await expectVirtualRowsNotToOverlap(restoredArticle);
  await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");

  const beforeEdgeIds = await page.locator("article[data-message-id]").evaluateAll((articles) => (
    articles.map((article) => article.getAttribute("data-message-id"))
  ));
  const edgeRequestPattern = "**/api/conversations/*/reader-turn*";
  let markEdgeRequestStarted!: () => void;
  let releaseEdgeRequest!: () => void;
  const edgeRequestStarted = new Promise<void>((resolve) => { markEdgeRequestStarted = resolve; });
  const edgeRequestGate = new Promise<void>((resolve) => { releaseEdgeRequest = resolve; });
  let edgeRequestWasGated = false;
  await page.route(edgeRequestPattern, async (route) => {
    if (edgeRequestWasGated) {
      await route.continue();
      return;
    }
    edgeRequestWasGated = true;
    markEdgeRequestStarted();
    await edgeRequestGate;
    await route.continue();
  });
  await expect.poll(async () => {
    await scrollRoot.evaluate((root) => {
      const targetDistance = 200;
      root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight - targetDistance);
    });
    await page.waitForTimeout(250);
    return scrollRoot.evaluate((root) => {
      const remaining = root.scrollHeight - root.clientHeight - root.scrollTop;
      return Math.abs(remaining - 200);
    });
  }, { timeout: 12_000 }).toBeLessThanOrEqual(8);
  const scrollRootBox = await scrollRoot.boundingBox();
  expect(scrollRootBox).not.toBeNull();
  await page.mouse.move(
    scrollRootBox!.x + scrollRootBox!.width * 0.55,
    scrollRootBox!.y + scrollRootBox!.height * 0.72,
  );
  await page.mouse.wheel(0, 160);
  await expect.poll(async () => JSON.stringify({
    gated: edgeRequestWasGated,
    ...await scrollRoot.evaluate((root) => ({
      edgeStage: root.dataset.readerEdgeStage ?? "missing",
      intent: root.dataset.readerIntentDirection ?? "missing",
      navigationStage: root.dataset.navigationStage ?? "missing",
      remaining: Math.round(root.scrollHeight - root.clientHeight - root.scrollTop),
    })),
  }), { timeout: 5_000 }).toContain('"gated":true');
  await edgeRequestStarted;
  const edgeAnchor = await captureVisibleReadingAnchor(page);
  expect(edgeAnchor.id).not.toBe("");
  releaseEdgeRequest();
  const edgeWindowLimit = beforeEdgeIds.length + 6;
  await expect.poll(async () => page.locator("article[data-message-id]").count()).toBeLessThanOrEqual(edgeWindowLimit);
  await expect.poll(async () => scrollRoot.evaluate((root, previousIds) => {
    const ids = Array.from(document.querySelectorAll<HTMLElement>("article[data-message-id]"))
      .map((article) => article.dataset.messageId ?? null);
    return {
      changed: ids.some((id) => !previousIds.includes(id)),
      edgeStage: root.dataset.readerEdgeStage ?? "missing",
      direction: root.dataset.readerIntentDirection ?? "missing",
      ids,
      scrollTop: Math.round(root.scrollTop),
      scrollHeight: root.scrollHeight,
    };
  }, beforeEdgeIds)).toMatchObject({ changed: true });
  await page.unroute(edgeRequestPattern);
  await expect.poll(() => focusAnchorError(page, edgeAnchor)).toBeLessThanOrEqual(24);
  await expect.poll(() => readingLineContentDistance(page)).toBeLessThanOrEqual(48);
  await expect(page.locator("article[data-message-id]").getByRole("button", { name: /立即展开|Expand now/ })).toHaveCount(0);
});

test("annotation actions dismiss outside or with Escape and restore the source anchor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/conversations/${conversationId}?annotations=open`);
  const workspace = page.locator('[data-annotation-mode="floating"]');
  await workspace.getByRole("button", { name: /^(全部|All)$/ }).click();
  await page.getByText(annotationQuote, { exact: true }).click();

  const targetBlock = page.locator(`#block-${targetMessageId}-${targetBlockIndex}`);
  await expect(targetBlock).toBeVisible();
  const repeatedLocatorRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(`/api/conversations/${conversationId}/reader-turn`)) repeatedLocatorRequests.push(request.url());
  });
  await page.getByText(annotationQuote, { exact: true }).click();
  await expect(targetBlock).toBeVisible();
  expect(repeatedLocatorRequests).toHaveLength(0);
  const point = await annotationTextPoint(targetBlock, annotationQuote);

  await page.mouse.click(point.x, point.y);
  const menu = page.getByRole("dialog", { name: "Annotation actions" });
  await expect(menu).toBeVisible();
  await expect(menu).toBeFocused();
  const annotationSearch = workspace.getByPlaceholder(/搜索批注|Search annotations/);
  await annotationSearch.click();
  await expect(menu).toHaveCount(0);
  await expect(annotationSearch).toBeFocused();
  await expect(workspace).toBeVisible();

  await page.mouse.click(point.x, point.y);
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(targetBlock).toBeFocused();
  await expect(workspace).toBeVisible();
});

test("failed annotation location preserves the current reader content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/conversations/${conversationId}?annotations=open`);
  const reader = page.getByTestId("reader-scroll-root");
  const visibleArticle = reader.locator("article[data-message-id]").filter({ visible: true }).first();
  await expect(visibleArticle).toBeVisible();
  const initialMessageId = await visibleArticle.getAttribute("data-message-id");
  const initialText = normalizeRenderedText(await visibleArticle.textContent()).slice(0, 80);
  expect(initialMessageId).toBeTruthy();
  expect(initialText).not.toBe("");

  await page.route(`**/api/conversations/${conversationId}/reader-turn?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("anchor_message_id") === targetMessageId) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "forced locator failure" }),
      });
      return;
    }
    await route.continue();
  });
  const workspace = page.locator('[data-annotation-mode="floating"]');
  await workspace.getByRole("button", { name: /^(全部|All)$/ }).click();
  await page.getByText(annotationQuote, { exact: true }).click();

  await expect(workspace.getByText("无法定位批注原文，当前正文保持不变。")).toBeVisible();
  await expect(page.getByRole("button", { name: /重新定位|Retry locate/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /定位到消息|Locate message/ })).toBeVisible();
  const preservedArticle = page.locator(`#message-${initialMessageId}`);
  await expect(preservedArticle).toBeVisible();
  await expect.poll(async () => normalizeRenderedText(await preservedArticle.textContent())).toContain(initialText);
  await expect(reader.locator("article[data-message-id]")).not.toHaveCount(0);
  await expect(page.locator("[data-locate-pulse]")).toHaveCount(0);
});

test("mobile message actions dismiss outside or with Escape and restore the trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/conversations/${conversationId}`);
  const reader = page.getByTestId("reader-scroll-root");
  await expect(reader.locator("article[data-message-id]").first()).toBeVisible();
  await reader.evaluate((root) => root.scrollBy({ top: 240, behavior: "auto" }));
  const triggers = page.getByTestId("mobile-message-actions-trigger");
  await expect.poll(() => firstUnobscuredTriggerIndex(triggers)).toBeGreaterThanOrEqual(0);
  const trigger = triggers.nth(await firstUnobscuredTriggerIndex(triggers));
  await expect(trigger).toBeVisible();

  await trigger.click();
  const sheet = page.getByTestId("mobile-message-actions-sheet");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(sheet).toBeVisible();
  await expect(sheet).toBeFocused();
  await reader.click({ position: { x: 20, y: 240 } });
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("continuous wheel scrolling remains monotonic after virtual estimates warm up", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/conversations/${conversationId}?messageId=${targetMessageId}&blockIndex=${Math.max(24, targetBlockIndex - 120)}&characterOffset=0`,
  );

  const scrollRoot = page.locator("[data-reader-scroll-root='true']");
  const targetArticle = page.locator(`#message-${targetMessageId}`);
  await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");
  await expect.poll(() => page.locator("article[data-message-id]").count()).toBeLessThanOrEqual(6);
  await expect.poll(() => targetArticle.locator("[data-index]").count()).toBeLessThanOrEqual(36);

  await scrollRoot.hover();
  await page.mouse.wheel(0, 480);
  await page.waitForTimeout(1300);

  let readerTurnRequests = 0;
  let readingPositionWrites = 0;
  page.on("request", (request) => {
    if (request.url().includes("/reader-turn")) readerTurnRequests += 1;
    if (request.method() === "PUT" && request.url().includes("/reading-position")) readingPositionWrites += 1;
  });
  await page.evaluate(() => {
    const telemetry = {
      frames: [] as number[],
      longTasks: [] as number[],
      lastFrame: 0,
      startedAt: window.performance.now(),
      observer: null as PerformanceObserver | null,
    };
    (window as typeof window & { __readerWheelTelemetry?: typeof telemetry }).__readerWheelTelemetry = telemetry;
    const frame = (time: number) => {
      if (telemetry.lastFrame > 0) telemetry.frames.push(time - telemetry.lastFrame);
      telemetry.lastFrame = time;
      if (telemetry.frames.length < 420) window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      telemetry.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= telemetry.startedAt) telemetry.longTasks.push(entry.duration);
        }
      });
      telemetry.observer.observe({ type: "longtask" });
    }
  });

  const samples: Array<{ scrollTop: number; scrollHeight: number }> = [];
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(34);
    samples.push(await scrollRoot.evaluate((root) => ({
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
    })));
  }

  for (let index = 1; index < samples.length; index += 1) {
    expect(samples[index]!.scrollTop + 2, `wheel sample ${index} moved backward`).toBeGreaterThanOrEqual(samples[index - 1]!.scrollTop);
  }
  const firstKilopixelOfScroll = samples.slice(0, 9);
  const firstKilopixelHeights = firstKilopixelOfScroll.map((sample) => sample.scrollHeight);
  expect(Math.max(...firstKilopixelHeights) - Math.min(...firstKilopixelHeights)).toBeLessThanOrEqual(200);
  expect(readerTurnRequests).toBe(0);
  expect(readingPositionWrites).toBe(0);
  await page.waitForTimeout(650);
  expect(readingPositionWrites).toBe(0);
  await expect.poll(() => readingPositionWrites, { timeout: 2500 }).toBe(1);
  await expect.poll(() => page.locator("article[data-message-id]").count()).toBeLessThanOrEqual(6);
  await expect.poll(() => targetArticle.locator("[data-index]").count()).toBeLessThanOrEqual(36);
  await expectVirtualRowsNotToOverlap(targetArticle);

  const telemetry = await page.evaluate(() => {
    const value = (window as typeof window & {
      __readerWheelTelemetry?: { frames: number[]; longTasks: number[]; observer: PerformanceObserver | null };
    }).__readerWheelTelemetry;
    value?.observer?.disconnect();
    if (!value) return { p95FrameInterval: null, longestTask: null, longTaskTotal: null };
    const frames = value.frames.filter((duration) => duration < 1000).sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(frames.length * 0.95) - 1);
    return {
      p95FrameInterval: frames[p95Index] ?? null,
      longestTask: value.longTasks.length ? Math.max(...value.longTasks) : 0,
      longTaskTotal: value.longTasks.reduce((total, duration) => total + duration, 0),
    };
  });
  await testInfo.attach("reader-wheel-telemetry.json", {
    body: Buffer.from(JSON.stringify({ samples, telemetry }, null, 2)),
    contentType: "application/json",
  });
  if (process.env.E2E_READER_PERF_BUDGET === "1") {
    console.info(`[reader-wheel-performance] ${JSON.stringify(telemetry)}`);
    expect(telemetry.p95FrameInterval).not.toBeNull();
    expect(telemetry.p95FrameInterval!).toBeLessThanOrEqual(34);
    expect(telemetry.longestTask!).toBeLessThanOrEqual(150);
    expect(telemetry.longTaskTotal!).toBeLessThanOrEqual(250);
  } else {
    testInfo.annotations.push({
      type: "performance-budget",
      description: `Recorded without CI hardware gate: ${JSON.stringify(telemetry)}`,
    });
  }
});

test("Share Reader reuses the bounded active-position and wheel path", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/share/${shareToken}`);
  await page.getByRole("button", { name: /展开对话索引|Open dialogue index/ }).click();
  await page.getByRole("button", { name: /索引范围|Index range/ }).click();
  await page.getByRole("button", { name: /全部索引|All messages/ }).click();
  const targetIndexItem = page.getByRole("button", { name: /target-35-000-section/ }).first();
  await expect(targetIndexItem).toBeVisible();
  await targetIndexItem.click();

  const targetArticle = page.locator(`#message-${targetMessageId}`);
  await expect(targetArticle).toBeVisible();
  await expect.poll(() => targetArticle.locator("[data-index]").count()).toBeLessThanOrEqual(36);
  const samples: number[] = [];
  await page.mouse.move(720, 620);
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(34);
    samples.push(await page.evaluate(() => window.scrollY));
  }
  for (let index = 1; index < samples.length; index += 1) {
    expect(samples[index]! + 2).toBeGreaterThanOrEqual(samples[index - 1]!);
  }
  await expect.poll(() => page.locator("article[data-message-id]").count()).toBeLessThanOrEqual(6);
  await expect.poll(() => targetArticle.locator("[data-index]").count()).toBeLessThanOrEqual(36);
  await expectVirtualRowsNotToOverlap(targetArticle);
});

async function expectVirtualRowsNotToOverlap(article: Locator) {
  const virtualList = article.locator('[data-virtualized-block-list="true"]');
  await expect.poll(async () => virtualList.evaluate((list) => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-index]"))
      .map((row) => row.getBoundingClientRect())
      .sort((left, right) => left.top - right.top);
    return rows.slice(1).reduce((largest, row, index) => (
      Math.max(largest, rows[index]!.bottom - row.top)
    ), 0);
  })).toBeLessThanOrEqual(1);
}

async function visibleBlockCount(article: Locator): Promise<number> {
  return article.locator("[data-block-index]").evaluateAll((blocks) => blocks.filter((block) => {
    const root = block.closest<HTMLElement>("[data-reader-scroll-root='true']");
    if (!root) return false;
    const rootRect = root.getBoundingClientRect();
    const rect = block.getBoundingClientRect();
    return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
  }).length);
}

async function readingRangeError(block: Locator): Promise<number> {
  return block.evaluate((element) => {
    const root = element.closest<HTMLElement>("[data-reader-scroll-root='true']");
    if (!root) return Number.POSITIVE_INFINITY;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      if (!text.textContent?.length) continue;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      return Math.abs(rect.top - (root.getBoundingClientRect().top + 120));
    }
    return Number.POSITIVE_INFINITY;
  });
}

async function captureReadingBlockAnchor(page: Page, messageId: string): Promise<{ id: string; offset: number }> {
  return page.evaluate((selectedMessageId) => {
    const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']");
    const article = document.getElementById(`message-${selectedMessageId}`);
    if (!root || !article) return { id: "", offset: Number.POSITIVE_INFINITY };
    const readingLine = root.getBoundingClientRect().top + 120;
    const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
    const block = blocks.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.top <= readingLine && rect.bottom >= readingLine;
    }) ?? blocks.find((candidate) => candidate.getBoundingClientRect().top > readingLine) ?? blocks.at(-1);
    return {
      id: block?.id ?? "",
      offset: block ? block.getBoundingClientRect().top - readingLine : Number.POSITIVE_INFINITY,
    };
  }, messageId);
}

async function focusAnchorError(page: Page, anchor: { id: string; offset: number }): Promise<number> {
  return page.evaluate(({ id, offset }) => {
    const block = document.getElementById(id);
    const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']");
    if (!block || !root) return Number.POSITIVE_INFINITY;
    const readingLine = root.getBoundingClientRect().top + 120;
    return Math.abs((block.getBoundingClientRect().top - readingLine) - offset);
  }, anchor);
}

async function captureVisibleReadingAnchor(page: Page): Promise<{ id: string; offset: number }> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']");
    if (!root) return { id: "", offset: Number.POSITIVE_INFINITY };
    const readingLine = root.getBoundingClientRect().top + 120;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-block-index]"));
    const block = blocks.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.top <= readingLine && rect.bottom >= readingLine;
    }) ?? blocks.find((candidate) => candidate.getBoundingClientRect().top > readingLine) ?? blocks.at(-1);
    return {
      id: block?.id ?? "",
      offset: block ? block.getBoundingClientRect().top - readingLine : Number.POSITIVE_INFINITY,
    };
  });
}

async function readingLineContentDistance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-reader-scroll-root='true']");
    if (!root) return Number.POSITIVE_INFINITY;
    const readingLine = root.getBoundingClientRect().top + 120;
    const distances = Array.from(root.querySelectorAll<HTMLElement>("[data-block-index]"))
      .map((block) => {
        const rect = block.getBoundingClientRect();
        if (rect.top <= readingLine && rect.bottom >= readingLine) return 0;
        return Math.min(Math.abs(rect.top - readingLine), Math.abs(rect.bottom - readingLine));
      });
    return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY;
  });
}

async function annotationTextPoint(block: Locator, quote: string): Promise<{ x: number; y: number }> {
  return block.evaluate((element, expectedQuote) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent ?? "").includes(expectedQuote)) node = walker.nextNode();
    if (!node) throw new Error("Annotation quote is not mounted in the target block");
    const text = node.textContent ?? "";
    const start = text.indexOf(expectedQuote);
    const range = document.createRange();
    range.setStart(node, Math.max(0, start));
    range.setEnd(node, Math.min(text.length, start + expectedQuote.length));
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return { x: rect.left + Math.max(2, Math.min(rect.width / 2, 12)), y: rect.top + Math.max(2, rect.height / 2) };
  }, quote);
}

function normalizeRenderedText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

async function firstUnobscuredTriggerIndex(triggers: Locator): Promise<number> {
  return triggers.evaluateAll((nodes) => nodes.findIndex((node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.bottom > window.innerHeight) return false;
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(point && element.contains(point));
  }));
}

async function seedLongConversation(request: APIRequestContext): Promise<{
  conversationId: string;
  targetMessageId: string;
  targetBlockIndex: number;
  annotationQuote: string;
}> {
  const targetPair = 35;
  const heavyMessageBlocks = new Map<number, number>([
    [targetPair - 1, 402],
    [targetPair, 389],
    [targetPair + 1, 501],
  ]);
  const messages: Array<{ role: "Prompt" | "Response"; say: string }> = [];
  for (let index = 0; index < 50; index += 1) {
    messages.push({ role: "Prompt", say: `Reader restore user message ${index}` });
    const response = heavyMessageBlocks.has(index)
      ? buildHeavyReaderResponse(index, heavyMessageBlocks.get(index)!)
      : `Reader restore assistant message ${index}`;
    messages.push({ role: "Response", say: response });
  }
  const preview = await request.post("/api/imports/preview", {
    multipart: {
      files: {
        name: "reader-restoration.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
          metadata: { title: "Reader restoration regression", powered_by: "ChatGPT Exporter" },
          messages,
        })),
      },
    },
  });
  expect(preview.ok()).toBe(true);
  const importId = (await preview.json()).import_id as string;
  const commit = await request.post(`/api/imports/${importId}/commit`);
  expect(commit.ok()).toBe(true);
  const committed = await waitForCommittedImport(request, importId);
  const seededConversationId = committed.conversation_ids[0] as string;
  const windowResponse = await request.get(
    `/api/conversations/${seededConversationId}/message-window?limit=200&content_mode=preview`,
  );
  expect(windowResponse.ok()).toBe(true);
  const messageWindow = await windowResponse.json();
  const target = messageWindow.items[targetPair * 2 + 1] as {
    id: string;
    is_heavy: boolean;
    current_version: { id: string };
  };
  expect(target.is_heavy).toBe(true);
  const blocksResponse = await request.get(`/api/messages/${target.id}/blocks?start=0&limit=200`);
  expect(blocksResponse.ok()).toBe(true);
  const blocks = await blocksResponse.json() as Array<{ block_index: number; plain_text: string }>;
  const targetBlock = blocks.find((block) => block.plain_text.includes(`target-${targetPair}-180-paragraph`));
  expect(targetBlock).toBeTruthy();
  const quote = `target-${targetPair}-180-paragraph`;
  const annotation = await request.post(`/api/conversations/${seededConversationId}/annotations`, {
    data: {
      message_id: target.id,
      message_version_id: target.current_version.id,
      annotation_type: "comment",
      color: "yellow",
      start_block_index: targetBlock!.block_index,
      start_offset: 0,
      end_block_index: targetBlock!.block_index,
      end_offset: quote.length,
      quote,
      comment_markdown: "Far annotation restore regression",
    },
  });
  expect(annotation.ok()).toBe(true);
  return {
    conversationId: seededConversationId,
    targetMessageId: target.id,
    targetBlockIndex: targetBlock!.block_index,
    annotationQuote: quote,
  };
}

function buildHeavyReaderResponse(messageIndex: number, blockCount: number): string {
  return Array.from({ length: blockCount }, (_, blockIndex) => {
    const marker = `target-${messageIndex}-${String(blockIndex).padStart(3, "0")}`;
    if (blockIndex % 8 === 0 && blockIndex !== 180) return `## ${marker}-section`;
    if (blockIndex % 19 === 0 && blockIndex !== 180) {
      return `\`\`\`ts\nconst block = ${blockIndex};\nconsole.log("${marker}", block);\n\`\`\``;
    }
    if (blockIndex % 23 === 0 && blockIndex !== 180) {
      return `| label | value |\n| --- | ---: |\n| ${marker} | ${blockIndex} |`;
    }
    const multilingual = blockIndex % 7 === 0
      ? "连续滚轮应该稳定跟手，中文、全角字符与 emoji 🙂 都需要按真实视觉宽度估算。"
      : "Long reader content keeps the target message heavy while preserving distinct block anchors.";
    const explicitBreak = blockIndex % 13 === 0 ? "\nA deliberate second visual line exercises explicit wrapping." : "";
    return `${marker}-paragraph ${multilingual.repeat(blockIndex % 5 === 0 ? 5 : 2)}${explicitBreak}`;
  }).join("\n\n");
}

async function waitForCommittedImport(request: APIRequestContext, importId: string) {
  let committed: { status: string; conversation_ids: string[]; error_message: string | null } | null = null;
  return expect.poll(async () => {
    const status = await request.get(`/api/imports/${importId}/status`);
    if (!status.ok()) return null;
    const payload = await status.json() as { status: string; conversation_ids: string[]; error_message: string | null };
    if (payload.status === "failed") throw new Error(payload.error_message ?? "Fixture import failed.");
    if (payload.status === "committed") committed = payload;
    return payload.status;
  }, { timeout: 90_000, intervals: [250, 500, 1000] }).toBe("committed").then(() => committed!);
}
