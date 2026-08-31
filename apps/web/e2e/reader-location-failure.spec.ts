import { expect, test, type Route } from "@playwright/test";
import { loadCompleteTurnWindow } from "../features/conversations/reader-window";
import { codePointOffsetToCodeUnit, matchTextAnchor } from "../features/conversations/text-anchor";
import type { ReaderTurnResponse } from "../lib/types";

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

test("stale block fallback preserves Reader content and reports no false exact pulse", async ({ page }) => {
  await page.goto(`/conversations/${conversationId}?messageId=${messageId}&blockIndex=0&characterOffset=9999`);

  const reader = page.getByTestId("reader-scroll-root");
  const article = reader.locator(`#message-${messageId}`);
  await expect(article).toContainText(preservedText);
  await expect(reader).toHaveAttribute("data-navigation-stage", /^(settled|settled:fallback)$/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Retry locate" })).toHaveCount(0);
  await expect(page.locator("[data-locate-pulse]")).toHaveCount(0, { timeout: 2_000 });
  await expect(reader.locator("article[data-message-id]")).toHaveCount(1);
  await expect(page.locator('[data-locate-pulse="text"]')).toHaveCount(0);
});

test("missing target preserves the safe initial Reader window", async ({ page }) => {
  await page.goto(`/conversations/${conversationId}?messageId=${missingMessageId}&blockIndex=0&characterOffset=0`);

  const reader = page.getByTestId("reader-scroll-root");
  const preservedArticle = reader.locator(`#message-${messageId}`);
  await expect(preservedArticle).toContainText(preservedText);
  await expect(page.locator('[role="alert"]').filter({ hasText: /could not be located|Unable to locate/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Retry locate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Locate message" })).toBeVisible();
  await expect(reader.locator("article[data-message-id]")).toHaveCount(1);
  await expect(page.locator("[data-locate-pulse]")).toHaveCount(0);
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

function readerTurnFixture() {
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
        plain_text: preservedText,
        display_text: preservedText,
        blocks: [],
        content_hash: "message-hash",
      },
      render_blocks: [{
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
        block_index: 0,
        block_type: "paragraph",
        plain_text: preservedText,
        data: { text: preservedText },
        char_count: preservedText.length,
      }],
      block_count: 1,
      char_count: preservedText.length,
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
