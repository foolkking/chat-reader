import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function load(path) {
  const source = readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}
const bookmark = load("features/annotations/reading-bookmark.ts");
const together = load("features/compare/together-session.ts");
const document = load("lib/annotation-document.ts");

test("reading-point quote and surrounding context use Unicode code points, not UTF-16 units", () => {
  const text = "前🙂文" + "读".repeat(200);
  const message = { id: "message", role: "assistant", order_key: "a", current_version: { id: "version" },
    render_blocks: [{ block_index: 4, plain_text: text }] };
  const input = bookmark.readingBookmarkInput(message, { message_id: "message", block_index: 4, scroll_offset: 12, anchor_data: { character_offset: 1 } });
  assert.equal(input.quote, "🙂文" + "读".repeat(158));
  assert.equal(input.start_offset, 1);
  assert.equal(input.end_offset, 161);
  assert.equal(input.prefix, "前");
  assert.equal(input.suffix, "读".repeat(42));
  assert.equal(input.metadata.bookmark_kind, "reading_point");
  const stored = { ...input, anchor_status: "valid" };
  assert.equal(bookmark.sameBookmark(stored, input), true);
  for (const patch of [{ message_version_id: "replaced" }, { start_offset: 2 }, { quote: "changed" }, { anchor_status: "orphaned" }])
    assert.equal(bookmark.sameBookmark({ ...stored, ...patch }, input), false);
});

test("legacy message bookmark does not invent a text or block anchor", () => {
  const input = bookmark.readingBookmarkInput({ id: "message", role: "user", order_key: "a" });
  assert.equal(input.quote, undefined);
  assert.equal(input.start_block_index, undefined);
  assert.equal(input.metadata.bookmark_kind, undefined);
});

test("together snapshot and precise search targets retain canonical identity", () => {
  const target = together.togetherTarget("/conversations/conversation?messageId=m&messageVersionId=v&renderBlockId=b&blockIndex=9&characterOffset=7&endCharacterOffset=12&annotationId=a");
  assert.equal(target.messageId, "m"); assert.equal(target.messageVersionId, "v");
  assert.equal(target.renderBlockId, "b"); assert.equal(target.characterOffset, 7);
  assert.equal(target.endCharacterOffset, 12); assert.equal(target.annotationId, "a");
  assert.equal(together.togetherTarget("/conversations/c?messageId=m&blockIndex=-1").blockIndex, undefined);
  assert.equal(together.togetherTarget("/conversations/c?messageId=m&blockIndex=9007199254740992").blockIndex, undefined);
  assert.equal(together.togetherTarget("/conversations/c"), undefined);
  const restored = together.targetFromReadingPosition({ message_id: "m", block_index: 4, scroll_offset: 250, anchor_data: { version_id: "v" } });
  assert.equal(restored.alignmentOffset, -130);
  assert.equal(together.TOGETHER_MAX_TABS, 8);
  assert.equal(together.TOGETHER_MIN_PANE, 520);
});

test("non-text reading points keep their block-relative position without inventing character zero", () => {
  const message = { id: "m", role: "assistant", order_key: "a", current_version: { id: "v" }, render_blocks: [{ block_index: 2, plain_text: "" }] };
  const position = { message_id: "m", block_index: 2, scroll_offset: 650, anchor_data: { block_offset: 650, version_id: "v", character_offset: null } };
  const input = bookmark.readingBookmarkInput(message, position);
  assert.equal(input.start_offset, null); assert.equal(input.end_offset, null);
  assert.equal(bookmark.sameBookmark({ ...input, anchor_status: "valid" }, input), true);
  assert.equal(bookmark.sameBookmark({ ...input, anchor_status: "valid", metadata: { reading_anchor: { block_offset: 20 } } }, input), false);
  const target = together.togetherTarget(together.readingPositionHref("conversation", position));
  assert.equal(target.blockIndex, 2);
  assert.equal(target.characterOffset, undefined);
  assert.equal(target.alignmentOffset, -530);
});

test("uncertain DOM-to-canonical text matching keeps the block offset, not a fabricated quote", () => {
  const input = bookmark.readingBookmarkInput({ id: "m", role: "assistant", order_key: "a",
    render_blocks: [{ block_index: 2, plain_text: "text whose DOM correspondence is unknown", block_type: "paragraph" }] },
  { message_id: "m", block_index: 2, scroll_offset: 650, anchor_data: { block_offset: 650, character_offset: null } });
  assert.equal(input.quote, null); assert.equal(input.start_offset, null);
  assert.equal(input.metadata.reading_anchor.block_offset, 650);
});

test("pane attachment and annotation search have explicit full-reader destinations", () => {
  assert.equal(together.togetherExternalResultHref("c", { attachmentId: "a" }), "/conversations/c?files=open&attachmentId=a");
  assert.equal(together.togetherExternalResultHref("c", { annotationId: "n", messageId: "m" }), "/conversations/c?annotations=open&annotationId=n");
  assert.equal(together.togetherExternalResultHref("c", { messageId: "m", blockIndex: 2 }), undefined);
});

test("two points in one image have distinguishable card/export text without character zero", () => {
  const record = offset => ({ annotation_type: "bookmark", anchor_status: "valid", start_block_index: 2, start_offset: null,
    metadata: { bookmark_kind: "reading_point", reading_anchor: { block_offset: offset }, reading_label: "Synthetic diagram" } });
  for (const zh of [false, true]) {
    const first = document.annotationLocationLabel(record(20), zh), second = document.annotationLocationLabel(record(650), zh);
    assert.notEqual(first, second); assert.match(first, /20 CSS px/); assert.match(second, /650 CSS px/);
    assert.match(second, /Synthetic diagram/);
    assert.doesNotMatch(document.readableAnnotationEntry(record(650), 1, zh), /Character 0|文字位置 0|整条消息书签|Message bookmark/);
    assert.match(document.annotationLocationLabel({ annotation_type: "bookmark" }, zh), /整条消息书签|Message bookmark/);
  }
});
