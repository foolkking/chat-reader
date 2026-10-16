import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../apps/web/features/exporting/offline-export-panel.tsx", import.meta.url), "utf8");

test("offline export distinguishes attachment-count loading, success and error states", () => {
  assert.match(source, /attachmentCountQuery\.isLoading/);
  assert.match(source, /attachmentCountQuery\.isError/);
  assert.match(source, /attachmentCountQuery\.data \?\? 0/);
  assert.match(source, /附件记录数暂时无法确认/);
  assert.match(source, /Attachment count unavailable/);
});

test("offline export exposes a local read-only attachment-count retry", () => {
  assert.match(source, /attachmentCountQuery\.refetch\(\)/);
  assert.match(source, /attachmentCountQuery\.isFetching/);
  assert.match(source, /重试读取/);
  assert.match(source, /Retry count/);
  assert.match(source, /role="alert"/);
});

test("attachment-count failure does not gate or replay the export action", () => {
  const generateStart = source.indexOf("async function generate()");
  const generateEnd = source.indexOf("\n  }\n\n  return (", generateStart);
  assert.ok(generateStart >= 0 && generateEnd > generateStart);
  const generateBody = source.slice(generateStart, generateEnd);
  assert.match(generateBody, /exportOfflineConversation\(conversationId/);
  assert.doesNotMatch(generateBody, /attachmentCountQuery/);
  assert.match(source, /disabled=\{generating\}/);
  assert.doesNotMatch(source, /disabled=\{generating \|\| attachmentCountQuery/);
});
