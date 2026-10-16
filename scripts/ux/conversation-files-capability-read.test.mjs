import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../apps/web/features/attachments/conversation-files-panel.tsx", import.meta.url), "utf8");

test("conversation files gates upload while attachment capability is still unknown", () => {
  assert.match(source, /capabilitiesQuery\.isPending/);
  assert.match(source, /capabilitiesQuery\.isError/);
  assert.match(source, /const uploadDisabled =/);
  assert.match(source, /disabled=\{uploadDisabled\}/);
});

test("conversation files exposes a local capability-read retry", () => {
  assert.match(source, /capabilitiesQuery\.refetch\(\)/);
  assert.match(source, /正在读取附件上传设置/);
  assert.match(source, /暂时无法确认附件上传设置/);
  assert.match(source, /重试读取设置/);
  assert.match(source, /role="alert"/);
});

test("capability refresh failure does not alter attachment upload actions", () => {
  assert.match(source, /createAttachmentUploadSession\(conversationId\)/);
  assert.match(source, /uploadAttachmentItem\(session\.id, file/);
  assert.match(source, /finalizeConversationAttachments\(conversationId, itemIds\)/);
  assert.doesNotMatch(source, /getCapabilities\(\)\.then/);
});
