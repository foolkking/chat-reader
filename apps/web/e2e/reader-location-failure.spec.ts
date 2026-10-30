import { expect, test, type Route } from "@playwright/test";
import { loadCompleteTurnWindow } from "../features/conversations/reader-window";
import { codePointOffsetToCodeUnit, matchTextAnchor } from "../features/conversations/text-anchor";
import type { ReaderTurnResponse, ReadingListValue, UserFeatureEntry } from "../lib/types";

test.use({ serviceWorkers: "block" });

const conversationId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const messageId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const missingMessageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const preservedText = "Reader content that must remain visible after every failed location attempt.";

test("target window reuses the already resolved center turn", async () => {
  const center = {
    ...readerTurnFixture(),
    turn_key: "center",
    previous_anchor_message_id: "previous",
    next_anchor_message_id: "next",
  } as ReaderTurnResponse;
  const calls: Array<string | undefined> = [];
  const page = await loadCompleteTurnWindow(
    async (anchor) => {
      calls.push(anchor);
      return {
        ...center,
        turn_key: anchor ?? "center",
        start_offset: anchor === "previous" ? -1 : anchor === "next" ? 1 : center.start_offset,
        previous_anchor_message_id: null,
        next_anchor_message_id: null,
      };
    },
    messageId,
    3,
    center,
  );
  expect(page.turns.map((turn) => turn.turn_key)).toEqual(["previous", "center", "next"]);
  expect(calls).toEqual(["previous", "next"]);
});

test("text-anchor matching keeps repeated quotes deterministic and converts Unicode offsets", () => {
  const source = "前缀 same 公式 \\frac{1}{2} same 后缀";
  const match = matchTextAnchor(source, "same", "前缀 ", " 公式");
  expect(match).not.toBeNull();
  expect(source.slice(match!.start, match!.end)).toBe("same");
  expect(codePointOffsetToCodeUnit("A😀B", 2)).toBe(3);
  expect(codePointOffsetToCodeUnit("A😀B", 3)).toBe(4);
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{
    name: "chat_reader_session",
    value: "reader-location-failure-session",
    domain: "127.0.0.1",
    path: "/",
  }]);
  await page.route("**/api/**", mockReaderApi);
});

for (const width of [375, 1440]) test(`focus edge navigation preserves the body and fetches only revealed navigation at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/preferences", route => json(route, {
    theme_mode: width === 375 ? "light" : "dark", locale_mode: "en-US",
    reader_default_focus: true, reader_width_mode: "standard", reader_density_mode: "comfortable",
    reader_font_size_px: 17, section_toc_mode: "visible", created_at: "2026-10-31T00:00:00Z", updated_at: "2026-10-31T00:00:00Z",
  }));
  const reads: string[] = [];
  page.on("request", request => { const path = new URL(request.url()).pathname; if (/\/(toc|dialogue-index)$/.test(path)) reads.push(path); });
  await page.goto(`/conversations/${conversationId}`);
  const article = page.locator(`#message-${messageId}`);
  await expect(article).toContainText(preservedText);
  await expect(page.locator('[data-focus-mode="on"]')).toBeVisible();
  await expect(page.locator("[data-reader-workspace-nav]")).toBeHidden();
  await article.evaluate(element => element.setAttribute("data-synthetic-identity", "retained"));
  const contentBox = await page.locator(".reader-content-column").boundingBox();
  const readerBox = await page.getByTestId("reader-scroll-root").boundingBox();
  expect(Math.abs(contentBox!.x + contentBox!.width / 2 - readerBox!.x - readerBox!.width / 2)).toBeLessThanOrEqual(3);
  const before = await article.boundingBox();
  const initial = reads.length;
  await page.waitForTimeout(400);
  expect(reads).toHaveLength(initial);
  const index = page.getByRole("button", { name: "Dialogue index", exact: true }).filter({ visible: true });
  if (width === 1440) {
    await page.mouse.move(700, 240);
    await page.mouse.down();
    await page.mouse.move(6, 350);
    await page.waitForTimeout(240);
    await expect(page.locator('.reader-index-column[data-focus-panel="open"]')).toHaveCount(0);
    expect(reads).toHaveLength(initial);
    await page.mouse.up();
    await page.mouse.move(700, 240);
    await index.hover();
    await expect(page.locator('.reader-index-column[data-focus-panel="open"]')).toBeVisible();
    await page.mouse.move(700, 300);
    await expect(page.locator(".reader-index-column")).toBeHidden();
    await page.mouse.move(1439, 300); // Scrollbar margin is not the right edge trigger.
    await page.waitForTimeout(240);
    expect(reads.some(path => path.endsWith("/toc"))).toBe(false);
  }
  await index.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Dialogue index", exact: true })).toBeVisible();
  await expect.poll(() => reads.some(path => path.endsWith("/dialogue-index"))).toBe(true);
  await expect(article).toHaveAttribute("data-synthetic-identity", "retained");
  const after = await article.boundingBox();
  expect(after?.x).toBeCloseTo(before!.x, 0);
  expect(after?.y).toBeCloseTo(before!.y, 0);
  await page.screenshot({ path: testInfo.outputPath(`focus-index-${width}.png`) });
  await page.keyboard.press("Escape");
  await expect(index).toBeFocused();
  const toc = page.getByRole("button", { name: "Section contents", exact: true }).filter({ visible: true });
  await toc.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => reads.some(path => path.endsWith("/toc"))).toBe(true);
  if (width === 1440) {
    const panel = page.locator('.reader-toc-column[data-focus-panel="open"]');
    const panelBox = await panel.boundingBox(), headerBox = await panel.locator(":scope > header").boundingBox();
    expect(headerBox!.height).toBeLessThan(90);
    expect(panelBox!.height - headerBox!.height).toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath("focus-toc-desktop.png") });
  }
  await page.keyboard.press("Escape");
  await expect(toc).toBeFocused();
  const help = page.locator('summary[aria-label="Reading keyboard help"]').filter({ visible: true });
  await help.click();
  const helpPanel = page.getByRole("heading", { name: "Reading keyboard help", exact: true }).filter({ visible: true });
  await expect(helpPanel).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath(`focus-help-${width}.png`) });
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await page.getByRole("button", { name: "Exit focus mode", exact: true }).filter({ visible: true }).click();
  await expect(page.locator("[data-reader-workspace-nav]")).not.toHaveAttribute("hidden");
  await expect(article).toHaveAttribute("data-synthetic-identity", "retained");
  if (width === 1440) await expect(page.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
});

test("Reader shortcuts respect consumed keys, IME, editable controls and modal ownership", async ({ page }) => {
  await page.goto(`/conversations/${conversationId}`);
  await expect(page.locator(`#message-${messageId}`)).toContainText(preservedText);
  const outcomes = await page.getByTestId("reader-scroll-root").evaluate(element => {
    const root = element as HTMLElement;
    const fire = (target: HTMLElement, init: KeyboardEventInit = {}, consume = false) => {
      const event = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true, ...init });
      if (consume) event.preventDefault();
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // Synthetic events have no browser default scrolling. This checks whether
    // the actual Reader listener consumes them, with a positive control.
    const normal = fire(root);
    const ime = fire(root, { isComposing: true });
    const legacyIme = fire(root, { keyCode: 229 });
    const controls: boolean[] = [];
    for (const tag of ["input", "textarea", "select", "button"]) {
      const element = document.createElement(tag);
      root.appendChild(element);
      controls.push(fire(element));
      element.remove();
    }
    const editable = document.createElement("div");
    editable.contentEditable = "true"; root.appendChild(editable);
    controls.push(fire(editable)); editable.remove();
    const auxiliary = document.createElement("div");
    auxiliary.dataset.readerAuxiliary = ""; root.appendChild(auxiliary);
    controls.push(fire(auxiliary)); auxiliary.remove();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    const behindModal = fire(root);
    modal.remove();
    let byCalls = 0;
    const scrollBy = root.scrollBy;
    root.scrollBy = () => { byCalls++; };
    fire(root, { key: "ArrowDown" }, true);
    root.scrollBy = scrollBy;
    return { normal, ime, legacyIme, controls, behindModal, consumedScrollCalls: byCalls };
  });
  expect(outcomes).toEqual({ normal: true, ime: false, legacyIme: false, controls: [false, false, false, false, false, false], behindModal: false, consumedScrollCalls: 0 });
});

test("stale block fallback preserves Reader content and reports no false exact pulse", async ({ page }) => {
  await page.goto(`/conversations/${conversationId}?messageId=${messageId}&blockIndex=0&characterOffset=9999`);

  const reader = page.getByTestId("reader-scroll-root");
  const article = reader.locator(`#message-${messageId}`);
  await expect(article).toContainText(preservedText);
  await expect(reader).toHaveAttribute("data-navigation-stage", /^(settled|settled:fallback)$/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^(Retry locate|重新定位)$/ })).toHaveCount(0);
  await expect(page.locator("[data-locate-pulse]")).toHaveCount(0, { timeout: 2_000 });
  await expect(reader.locator("article[data-message-id]")).toHaveCount(1);
  await expect(page.locator('[data-locate-pulse="text"]')).toHaveCount(0);
});

test("missing target preserves the safe initial Reader window", async ({ page }) => {
  await page.goto(`/conversations/${conversationId}?messageId=${missingMessageId}&blockIndex=0&characterOffset=0`);

  const reader = page.getByTestId("reader-scroll-root");
  const preservedArticle = reader.locator(`#message-${messageId}`);
  await expect(preservedArticle).toContainText(preservedText);
  await expect(page.locator('[role="alert"]').filter({ hasText: /could not be located|Unable to locate|无法定位该消息/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^(Retry locate|重新定位)$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Locate message|定位到消息)$/ })).toBeVisible();
  await expect(reader.locator("article[data-message-id]")).toHaveCount(1);
  await expect(page.locator("[data-locate-pulse]")).toHaveCount(0);
});

test("content-free exact search URL locates the second Unicode occurrence rather than the first quote", async ({ page }) => {
  const text = "😀 prefix needle gap needle end";
  const turn = readerTurnFixture(text);
  await page.route(`**/api/conversations/${conversationId}/reader-turn*`, route => json(route, turn));
  const message = turn.items[0];
  const start = Array.from(text.slice(0, text.lastIndexOf("needle"))).length;
  const params = new URLSearchParams({
    messageId,
    messageVersionId: message.current_version.id,
    renderBlockId: message.render_blocks[0].id,
    blockIndex: "0",
    characterOffset: String(start),
    endCharacterOffset: String(start + "needle".length),
  });
  // Capture the real transient pulse in its commit, rather than making a
  // delayed CI assertion depend on its 720ms presentation lifetime.
  await page.addInitScript(blockId => {
    const probe = window as typeof window & { __syntheticSearchPulseDelta?: number };
    const observer = new MutationObserver(() => {
      const pulse = document.querySelector<HTMLElement>('[data-locate-pulse="text"]');
      const block = document.getElementById(blockId);
      if (!pulse || !block) return;
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const value = nodes.map(node => node.textContent).join("");
      const start = value.lastIndexOf("needle");
      if (start < 0) return;
      let position = 0;
      const range = document.createRange();
      for (const node of nodes) {
        if (position <= start && start < position + node.length) range.setStart(node, start - position);
        if (position < start + 6 && start + 6 <= position + node.length) {
          range.setEnd(node, start + 6 - position);
          break;
        }
        position += node.length;
      }
      const expected = range.getBoundingClientRect();
      const actual = pulse.getBoundingClientRect();
      probe.__syntheticSearchPulseDelta = Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y));
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }, `block-${messageId}-0`);
  await page.goto(`/conversations/${conversationId}?${params}`);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __syntheticSearchPulseDelta?: number }).__syntheticSearchPulseDelta ?? Number.POSITIVE_INFINITY,
  )).toBeLessThanOrEqual(2);
});

test("stale search version falls back without an exact text pulse", async ({ page }) => {
  const params = new URLSearchParams({
    messageId,
    messageVersionId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd9",
    renderBlockId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    blockIndex: "0",
    characterOffset: "0",
    endCharacterOffset: "6",
  });
  await page.goto(`/conversations/${conversationId}?${params}`);
  const reader = page.getByTestId("reader-scroll-root");
  await expect(reader.locator(`#message-${messageId}`)).toContainText(preservedText);
  await expect(reader).toHaveAttribute("data-navigation-stage", "settled:fallback", { timeout: 15_000 });
  await expect(reader.locator(`#message-${messageId}`)).toBeInViewport();
  // A frame's min-height/padding can overflow even at the upper endpoint.
  // Check the selected fallback anchor's actual unreachable reading line and
  // visible, uncovered geometry instead of assuming the whole root fits.
  const boundary = await reader.evaluate((root, id) => {
    const target = root.querySelector<HTMLElement>(`#message-${id}`)!;
    const targetRect = target.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const viewportTop = rootRect.top + root.clientTop;
    return {
      scrollTop: root.scrollTop,
      readingLineDelta: targetRect.top - (rootRect.top + 120),
      anchorTop: targetRect.top - viewportTop,
      anchorBottom: targetRect.bottom - viewportTop,
      paddingTop: Math.max(0, Number.parseFloat(getComputedStyle(root).scrollPaddingTop) || 0),
      viewportHeight: root.clientHeight,
    };
  }, messageId);
  expect(boundary.scrollTop).toBe(0);
  expect(boundary.readingLineDelta).toBeLessThan(-24);
  expect(boundary.anchorTop).toBeGreaterThanOrEqual(boundary.paddingTop - 1);
  expect(boundary.anchorTop).toBeLessThan(boundary.viewportHeight);
  expect(boundary.anchorBottom).toBeGreaterThan(boundary.paddingTop);
  await expect(page.locator('[data-locate-pulse="text"]')).toHaveCount(0);
});

test("search-hit reading advances between safe targets and exit clears its session queue", async ({ page }) => {
  const queueId = "queue-12345678";
  const queueKey = `chat-reader:search-reading-queue:${queueId}`;
  const versionId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
  const blockId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
  const makeHref = (characterOffset: number) => {
    const params = new URLSearchParams({
      messageId,
      messageVersionId: versionId,
      renderBlockId: blockId,
      blockIndex: "0",
      characterOffset: String(characterOffset),
      endCharacterOffset: String(characterOffset + 6),
    });
    return `/conversations/${conversationId}?${params}`;
  };
  const hrefs = [makeHref(0), makeHref(10)];
  const queue = JSON.stringify({ version: 1, createdAt: Date.now(), hrefs, returnHref: "/search?q=synthetic&role=assistant" });
  await page.addInitScript(({ key, value }) => window.sessionStorage.setItem(key, value), { key: queueKey, value: queue });

  const first = new URL(hrefs[0], "http://127.0.0.1");
  first.searchParams.set("searchQueue", queueId);
  first.searchParams.set("searchIndex", "0");
  await page.goto(`${first.pathname}${first.search}`);

  const banner = page.locator('[data-search-reading-queue="true"]');
  await expect(banner).toContainText("1 / 2");
  await banner.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/characterOffset=10.*searchQueue=queue-12345678.*searchIndex=1/);
  await expect(banner).toContainText("2 / 2");

  await banner.getByRole("button", { name: "Return to results" }).click();
  await expect(page).toHaveURL(/\/search\?q=synthetic&role=assistant$/);
  await page.goBack();
  await expect(banner).toContainText("2 / 2");
  await page.getByRole("button", { name: "Exit continuous reading" }).click();
  await expect(page).not.toHaveURL(/searchQueue|searchIndex/);
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), queueKey)).toBeNull();
});

test("adding to reading list starts unread and only the next explicit action marks it read", async ({ page }) => {
  const entries: UserFeatureEntry<ReadingListValue>[] = [];
  const writes: ReadingListValue[] = [];
  await page.route("**/api/user-feature-entries/reading-list**", async (route) => {
    if (route.request().method() === "GET") return json(route, entries);
    const payload = route.request().postDataJSON() as { expected_revision: number; value: ReadingListValue };
    writes.push(payload.value);
    const saved: UserFeatureEntry<ReadingListValue> = {
      id: new URL(route.request().url()).pathname.split("/").at(-1)!,
      collection: "reading-list", revision: payload.expected_revision + 1, value: payload.value,
      created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z",
    };
    entries.splice(0, entries.length, saved);
    await json(route, saved);
  });
  await page.goto(`/conversations/${conversationId}`);
  const control = page.getByTestId("reading-list-toggle").filter({ visible: true });
  await expect(control).toHaveAttribute("aria-label", "Add to reading list");
  await control.click();
  await expect(control).toHaveAttribute("aria-label", "Mark read");
  expect(writes).toEqual([{ conversation_id: conversationId, state: "unread" }]);
  await control.click();
  await expect(control).toHaveAttribute("aria-label", "Mark unread");
  expect(writes.map((value) => value.state)).toEqual(["unread", "read"]);
});

test("folded turns keep stable anchors mounted and navigation expands before locating", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(`/conversations/${conversationId}`);

  const reader = page.getByTestId("reader-scroll-root");
  const article = reader.locator(`#message-${messageId}`);
  const body = article.locator(".reader-message-body");
  const anchor = page.locator(`#block-${messageId}-0`);
  await expect(article).toContainText(preservedText);
  await expect(anchor).toHaveCount(1);

  const foldButton = article.locator('[data-reader-turn-toggle="true"]');
  await foldButton.click();
  await expect(foldButton).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();
  await expect(article).toBeVisible();
  await expect(anchor).toHaveCount(1);

  await page.getByRole("button", { name: "Reader navigation" }).click();
  await page.locator('button[title^="U1 ·"]').last().click();
  await expect(foldButton).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  await expect(reader).toHaveAttribute("data-navigation-stage", /^(settled|settled:fallback)$/, { timeout: 15_000 });
});

async function mockReaderApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  if (path === "/api/auth/session") return json(route, {
    authenticated: true,
    principal_id: "owner",
    inactivity_expires_at: "2026-09-01T00:00:00Z",
    auth_mode: "single_password",
  });
  if (path === "/api/preferences") return json(route, {
    theme_mode: "light",
    locale_mode: "en-US",
    reader_width_mode: "standard",
    reader_density_mode: "comfortable",
    reader_font_size_px: 17,
    section_toc_mode: "visible",
    conversation_sort_mode: "recent_read",
    conversation_sort_direction: "desc",
    project_sort_mode: "custom",
    project_sort_direction: "asc",
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
  });
  if (path === "/api/search") return json(route, { items: [], total: 0, limit: 50, offset: 0 });
  if (path === `/api/conversations/${conversationId}`) return json(route, conversationFixture());
  if (path === `/api/conversations/${conversationId}/reading-position`) {
    if (request.method() === "GET") return json(route, { conversation_id: conversationId, position: null });
    return json(route, null);
  }
  if (path === `/api/conversations/${conversationId}/reader-turn`) {
    if (url.searchParams.get("anchor_message_id") === missingMessageId) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Anchor message not found" }) });
      return;
    }
    return json(route, readerTurnFixture());
  }
  if (path === `/api/conversations/${conversationId}/message-window`) {
    const turn = readerTurnFixture();
    return json(route, {
      items: turn.items,
      limit: 50,
      offset: 0,
      total: 1,
      has_previous: false,
      has_more: false,
    });
  }
  if (path === `/api/conversations/${conversationId}/toc`) return json(route, {
    conversation_id: conversationId,
    items: [],
    limit: 200,
    offset: 0,
    total: 0,
    has_more: false,
  });
  if (path === `/api/conversations/${conversationId}/dialogue-index`) return json(route, {
    conversation_id: conversationId,
    items: [{ message_id: messageId, role: "user", role_number: 1, ordinal: 1, order_key: "000001", preview: preservedText, turn_index: 0 }],
    message_count: 1,
    turn_count: 1,
    limit: 80,
    offset: 0,
    total: 1,
    has_previous: false,
    has_more: false,
  });
  if (path === `/api/conversations/${conversationId}/recent`) return json(route, {
    id: "ffffffff-ffff-4fff-8fff-fffffffffff1",
    conversation_id: conversationId,
    project_id: null,
    last_message_id: null,
    last_opened_at: "2026-08-31T00:00:00Z",
    open_count: 1,
    context: {},
    conversation: conversationFixture(),
  });
  if (path === `/api/messages/${messageId}/blocks`) return json(route, []);
  if (path === "/api/tasks/active" || path === "/api/content-cleanup/scans/pending" || path === "/api/projects" || path === "/api/conversations" || path === "/api/recent") return json(route, []);
  return json(route, []);
}

function conversationFixture() {
  return {
    id: conversationId,
    title: "Location failure fixture",
    display_title: "Location failure fixture",
    source_type: "test",
    source_profile: "test",
    message_count: 1,
    turn_count: 1,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    imported_at: "2026-08-31T00:00:00Z",
    first_user_message: preservedText,
    description_markdown: null,
    project_id: null,
    project_name: null,
    offline_revision: 1,
    status: "active",
    is_global_pinned: false,
    global_pinned_at: null,
    last_read_at: null,
    manual_sort_order: 0,
    external_source_id: null,
    parser_version: "test",
    render_version: 1,
    content_hash: "fixture-hash",
    sort_time: "2026-08-31T00:00:00Z",
  };
}

function readerTurnFixture(text = preservedText) {
  return {
    conversation_id: conversationId,
    turn_key: "turn-0",
    start_offset: 0,
    end_offset: 1,
    total_messages: 1,
    items: [{
      id: messageId,
      conversation_id: conversationId,
      role: "user",
      order_key: "000001",
      turn_index: 0,
      created_at: "2026-08-31T00:00:00Z",
      current_version: {
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        version_number: 1,
        plain_text: text,
        display_text: text,
        blocks: [],
        content_hash: "message-hash",
      },
      render_blocks: [{
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
        block_index: 0,
        block_type: "paragraph",
        plain_text: text,
        data: { text },
        char_count: text.length,
      }],
      block_count: 1,
      char_count: text.length,
      is_heavy: false,
      ordinal: 1,
      content_preview: null,
      content_truncated: false,
    }],
    previous_anchor_message_id: null,
    next_anchor_message_id: null,
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
}
