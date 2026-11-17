import assert from "node:assert/strict";
import test from "node:test";
import { loadTableFixtureModule } from "./markdown-table-source-fixture.mjs";

const queueModule = (await loadTableFixtureModule("../../apps/web/features/search/search-reading-queue.ts")).module;
const turnModule = (await loadTableFixtureModule("../../apps/web/features/conversations/reader-turn-folding.ts")).module;

const hit = (document_type, conversation_id, message_id) => ({
  document_id: `${document_type}:${message_id ?? conversation_id}`,
  document_type,
  conversation_id,
  conversation_title: "Private title",
  message_id,
});

test("search reading queue keeps only safe message-anchored targets and no more than 100", () => {
  const items = [
    hit("conversation", "c1", null),
    hit("attachment", "c1", "m0"),
    hit("message", "c1", "m1"),
    hit("heading", "c2", "m2"),
    hit("message", "c3", "m3"),
  ];
  const queue = queueModule.buildSearchReadingQueue(items, (item) => `/conversations/${item.conversation_id}?messageId=${item.message_id}`, 100);
  assert.deepEqual(queue, {
    version: 1,
    createdAt: 100,
    hrefs: ["/conversations/c1?messageId=m1", "/conversations/c2?messageId=m2", "/conversations/c3?messageId=m3"],
  });
  const tooMany = Array.from({ length: 120 }, (_, index) => hit("message", "c", `m${index}`));
  assert.equal(queueModule.buildSearchReadingQueue(tooMany, (item) => `/conversations/${item.conversation_id}?messageId=${item.message_id}`, 100).hrefs.length, 100);
});

test("reading queue rejects unsafe, stale, duplicate, and content-bearing targets", () => {
  for (const href of [
    "https://evil.example/conversations/c?messageId=m",
    "//evil.example/conversations/c?messageId=m",
    "/api/conversations/c?messageId=m",
    "/conversations/c?query=private%20text",
    "/conversations/c?messageId=m#fragment",
  ]) {
    assert.equal(queueModule.sanitizeSearchReadingHref(href), null, href);
  }
  assert.equal(queueModule.parseSearchReadingQueue({ version: 1, createdAt: 0, hrefs: ["/conversations/c?messageId=a", "/conversations/c?messageId=b"] }, 10_000_000), null);
  assert.equal(queueModule.parseSearchReadingQueue({ version: 1, createdAt: 100, hrefs: ["/conversations/c?messageId=a", "/conversations/c?messageId=a"] }, 100), null);
  assert.equal(queueModule.withSearchReadingQueue("/conversations/c?messageId=m", "invalid id", 0), null);
});

test("queue navigation preserves target parameters and adds only queue identity", () => {
  assert.equal(
    queueModule.withSearchReadingQueue("/conversations/c?messageId=m&characterOffset=4", "queue-12345678", 2),
    "/conversations/c?messageId=m&characterOffset=4&searchQueue=queue-12345678&searchIndex=2",
  );
});

test("queue storage is account-isolated and returning accepts only bounded search routes", () => {
  assert.notEqual(
    queueModule.searchReadingQueueStorageKey("queue-12345678", "synthetic-owner-a"),
    queueModule.searchReadingQueueStorageKey("queue-12345678", "synthetic-owner-b"),
  );
  const returnHref = "/search?q=synthetic&role=assistant&project_id=synthetic-project";
  assert.equal(queueModule.sanitizeSearchReturnHref(returnHref), returnHref);
  const base = { version: 1, createdAt: 100, hrefs: ["/conversations/c?messageId=a", "/conversations/c?messageId=b"] };
  assert.equal(queueModule.parseSearchReadingQueue({ ...base, returnHref }, 100).returnHref, returnHref);
  for (const sort of ["relevance", "content_updated", "imported"]) {
    const sortedHref = `${returnHref}&sort=${sort}`;
    assert.equal(queueModule.parseSearchReadingQueue({ ...base, returnHref: sortedHref }, 100).returnHref, sortedHref);
  }
  for (const invalid of ["//evil.example/search", "/searching?q=x", "/search?q=a&q=b", "/search?token=x", "/search#x",
    "/search?sort=unknown", "/search?sort=imported&sort=relevance"]) {
    assert.equal(queueModule.sanitizeSearchReturnHref(invalid), null, invalid);
    assert.equal(queueModule.parseSearchReadingQueue({ ...base, returnHref: invalid }, 100), null, invalid);
  }
});

test("missing sort timestamps never imply unread outside the reading view", async () => {
  const time = (await loadTableFixtureModule("../../apps/web/lib/activity-time.ts")).module;
  for (const locale of ["zh-CN", "en-US"]) {
    const missing = locale === "zh-CN" ? "未记录" : "Not recorded";
    const unread = locale === "zh-CN" ? "尚未阅读" : "Not read yet";
    for (const mode of ["created", "updated", "content_updated", "imported"]) {
      assert.equal(time.formatActivityTime(null, locale, undefined, mode), missing);
      assert.equal(time.fullActivityTime(null, locale, mode), missing);
      assert.notEqual(time.sortTimeLabel(mode, locale), "");
    }
    assert.equal(time.formatActivityTime(null, locale), unread);
    assert.equal(time.fullActivityTime(null, locale, "recent_read"), unread);
    const value = "2026-11-17T01:00:00Z", now = new Date("2026-11-17T01:30:00Z");
    assert.equal(time.formatActivityTime(value, locale, now, "imported"), time.formatActivityTime(value, locale, now));
  }
});

test("turn folding follows authoritative turn responses and leaves uncovered messages individually addressable", () => {
  const message = (id) => ({ id });
  const groups = turnModule.buildReaderTurnGroups([
    { turn_key: "turn-a", items: [message("m1"), message("m2")] },
    { turn_key: "turn-b", items: [message("m3")] },
  ], [message("m1"), message("m2"), message("m3"), message("m4")]);
  assert.deepEqual(groups, [
    { key: "turn-a", messageIds: ["m1", "m2"], firstMessageId: "m1" },
    { key: "turn-b", messageIds: ["m3"], firstMessageId: "m3" },
    { key: "message:m4", messageIds: ["m4"], firstMessageId: "m4" },
  ]);
});
