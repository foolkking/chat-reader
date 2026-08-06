import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const runLongReaderRegression = process.env.E2E_LONG_READER === "1";

test.skip(!runLongReaderRegression, "E2E_LONG_READER=1 is required");

let conversationId = "";
let targetMessageId = "";
let targetBlockIndex = 0;
let annotationQuote = "";

test.beforeAll(async ({ request }) => {
  const seeded = await seedLongConversation(request);
  conversationId = seeded.conversationId;
  targetMessageId = seeded.targetMessageId;
  targetBlockIndex = seeded.targetBlockIndex;
  annotationQuote = seeded.annotationQuote;
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

  const preferencesButton = page.getByRole("button", { name: /外观与语言|Appearance & language/ });
  if (!await preferencesButton.isVisible()) {
    await page.getByRole("button", { name: /展开侧栏|Open sidebar/ }).click();
  }
  await preferencesButton.click();
  const preferences = page.getByRole("dialog", { name: /外观与语言|Appearance & language/ });
  await preferences.getByRole("button", { name: /更多设置|More settings/ }).click();

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
  await preferences.getByRole("button", { name: /关闭|Close/ }).click();
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
  await expect(virtualizedBlocks).toHaveAttribute("data-virtualized-block-count", "220");
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
  await expect.poll(async () => page.locator("article[data-message-id]").count()).toBeLessThanOrEqual(6);
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

async function seedLongConversation(request: APIRequestContext): Promise<{
  conversationId: string;
  targetMessageId: string;
  targetBlockIndex: number;
  annotationQuote: string;
}> {
  const targetPair = 35;
  const messages: Array<{ role: "Prompt" | "Response"; say: string }> = [];
  for (let index = 0; index < 50; index += 1) {
    messages.push({ role: "Prompt", say: `Reader restore user message ${index}` });
    const response = index === targetPair
      ? Array.from({ length: 220 }, (_, paragraph) => (
          paragraph % 4 === 0 && paragraph !== 180
            ? `## target-${index}-section-${String(paragraph).padStart(3, "0")}`
            : `target-${index}-paragraph-${String(paragraph).padStart(3, "0")} ` +
              "Long reader content keeps the target message heavy while preserving distinct block anchors. ".repeat(3)
        )).join("\n\n")
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
  const targetBlock = blocks.find((block) => block.plain_text.includes(`target-${targetPair}-paragraph-180`));
  expect(targetBlock).toBeTruthy();
  const quote = `target-${targetPair}-paragraph-180`;
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
