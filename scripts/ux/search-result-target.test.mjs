import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/search/search-result-target.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", compiled)(exports);
const base = {
  document_id: "synthetic-document",
  document_type: "message",
  conversation_id: "synthetic-conversation",
  conversation_title: "Synthetic conversation",
  message_id: "synthetic-message",
  message_version_id: "synthetic-version",
  role: "assistant",
  order_key: "0001",
  block_index: 3,
  render_block_id: "synthetic-block",
  character_offset: 8,
  snippet: "Synthetic excerpt",
  rank: 1,
  source_profile: null,
  occurrence_count: 1,
  matches: [{
    block_index: 4,
    render_block_id: "synthetic-match-block",
    match_start: 12,
    match_end: 20,
    quote: "synthetic",
    context_before: "before",
    context_after: "after",
  }],
};
const parse = item => new URL(exports.searchResultHref(item), "https://example.invalid");

test("library replay identity ignores query ordering/panel settings, not target fields", () => {
  const href = exports.searchResultHref(base, "library");
  const params = new URLSearchParams(href.split("?")[1]);
  const reordered = new URLSearchParams([...params].reverse());
  reordered.set("annotation_layout", "expanded");
  reordered.set("annotations", "open");
  assert.equal(exports.matchesLibrarySearchTarget(href, reordered.toString()), true);
  for (const key of ["conversationId", "messageId", "messageVersionId", "blockIndex",
    "renderBlockId", "characterOffset", "endCharacterOffset", "attachmentId", "annotationId"]) {
    const changed = new URLSearchParams(params);
    changed.set(key, "synthetic-other");
    assert.equal(exports.matchesLibrarySearchTarget(href, changed.toString()), false, key);
  }
  assert.equal(exports.matchesLibrarySearchTarget("/conversations/synthetic-conversation", params.toString()), false);
});

test("precise panel identity ignores open state while legacy panel-only destinations remain distinct", () => {
  const file = exports.searchResultHref({ ...base, document_type: "attachment", attachment_id: "synthetic-file" }, "library");
  const fileParams = new URLSearchParams(file.split("?")[1]);
  fileParams.delete("files");
  assert.equal(exports.matchesLibrarySearchTarget(file, fileParams.toString()), true);
  fileParams.set("attachmentId", "synthetic-other-file");
  assert.equal(exports.matchesLibrarySearchTarget(file, fileParams.toString()), false);
  const legacyFile = exports.searchResultHref({ ...base, document_type: "attachment" }, "library");
  const legacyParams = new URLSearchParams(legacyFile.split("?")[1]);
  assert.equal(exports.matchesLibrarySearchTarget(legacyFile, legacyParams.toString()), true);
  legacyParams.delete("files");
  assert.equal(exports.matchesLibrarySearchTarget(legacyFile, legacyParams.toString()), false);
  legacyParams.set("annotations", "open");
  assert.equal(exports.matchesLibrarySearchTarget(legacyFile, legacyParams.toString()), false);
});

test("body result URL preserves exact message version, RenderBlock and half-open range", () => {
  const target = parse(base);
  assert.equal(target.pathname, "/conversations/synthetic-conversation");
  assert.equal(target.searchParams.get("messageId"), "synthetic-message");
  assert.equal(target.searchParams.get("messageVersionId"), "synthetic-version");
  assert.equal(target.searchParams.get("renderBlockId"), "synthetic-match-block");
  assert.equal(target.searchParams.get("blockIndex"), "4");
  assert.equal(target.searchParams.get("characterOffset"), "12");
  assert.equal(target.searchParams.get("endCharacterOffset"), "20");
});

test("library destination preserves exact body identity/range without leaving the offline route or leaking excerpts", () => {
  const target = new URL(exports.searchResultHref(base, "library"), "https://example.invalid");
  const online = parse(base);
  assert.equal(target.pathname, "/library");
  assert.equal(target.searchParams.get("conversationId"), base.conversation_id);
  for (const [key, value] of online.searchParams) assert.equal(target.searchParams.get(key), value);
  for (const key of ["quote", "prefix", "suffix", "q"]) assert.equal(target.searchParams.has(key), false);
});

test("library attachment and annotation destinations reuse their distinct non-body target contracts", () => {
  const file = new URL(exports.searchResultHref({ ...base, document_type: "attachment",
    attachment_id: "synthetic-file" }, "library"), "https://example.invalid");
  assert.equal(file.pathname, "/library");
  assert.equal(file.searchParams.get("files"), "open");
  assert.equal(file.searchParams.get("attachmentId"), "synthetic-file");
  assert.equal(file.searchParams.has("messageId"), false);
  const note = new URL(exports.searchResultHref({ ...base, document_type: "annotation",
    annotation_id: "synthetic-note" }, "library"), "https://example.invalid");
  assert.equal(note.pathname, "/library");
  assert.equal(note.searchParams.get("annotations"), "open");
  assert.equal(note.searchParams.get("annotationId"), "synthetic-note");
  assert.equal(note.searchParams.get("characterOffset"), String(base.character_offset));
  assert.equal(note.searchParams.has("endCharacterOffset"), false);
});
test("attachment URL uses a file target, never a message-body anchor", () => {
  const target = parse({
    ...base,
    document_type: "attachment",
    attachment_id: "synthetic-attachment",
    message_id: null,
  });
  assert.equal(target.searchParams.get("files"), "open");
  assert.equal(target.searchParams.get("attachmentId"), "synthetic-attachment");
  assert.equal(target.searchParams.has("messageId"), false);
  assert.equal(target.searchParams.has("messageVersionId"), false);
  assert.equal(target.searchParams.has("characterOffset"), false);
});

test("legacy attachment response without an identity opens the file list, not a body anchor", () => {
  const target = parse({ ...base, document_type: "attachment" });
  assert.equal(target.searchParams.get("files"), "open");
  assert.equal(target.searchParams.has("messageId"), false);
  assert.equal(target.searchParams.has("characterOffset"), false);
});

test("annotation URL uses the saved annotation anchor, not the comment match range", () => {
  const target = parse({
    ...base,
    document_type: "annotation",
    annotation_id: "synthetic-annotation",
    block_index: 2,
    character_offset: 5,
    matches: [{
      block_index: 9,
      render_block_id: "comment-is-not-a-render-block",
      match_start: 31,
      match_end: 36,
      quote: "wrong",
      context_before: "",
      context_after: "",
    }],
  });
  assert.equal(target.searchParams.get("annotations"), "open");
  assert.equal(target.searchParams.get("annotationId"), "synthetic-annotation");
  assert.equal(target.searchParams.get("messageVersionId"), "synthetic-version");
  assert.equal(target.searchParams.get("blockIndex"), "2");
  assert.equal(target.searchParams.get("characterOffset"), "5");
  assert.equal(target.searchParams.has("endCharacterOffset"), false);
  assert.notEqual(target.searchParams.get("renderBlockId"), "comment-is-not-a-render-block");
});

const message = {
  id: "synthetic-message",
  current_version: { id: "synthetic-version" },
  render_blocks: [{
    id: "synthetic-block",
    block_index: 2,
    plain_text: "😀 one\tneedle  needle",
  }],
};
const rangeTarget = {
  messageId: message.id,
  messageVersionId: "synthetic-version",
  renderBlockId: "synthetic-block",
  blockIndex: 2,
  characterOffset: 14,
  endCharacterOffset: 20,
  source: "search",
};

test("content-free link hydrates the precise repeated quote from canonical code-point ranges", () => {
  const anchor = exports.resolveCanonicalSearchAnchor(message, rangeTarget);
  assert.ok(anchor);
  assert.equal(anchor.quote, "needle");
  assert.equal(anchor.prefix, "😀 one\tneedle  ");
  assert.equal(anchor.start, 14);
  assert.equal(anchor.end, 20);
});

for (const patch of [
  { messageVersionId: "synthetic-old-version" },
  { renderBlockId: "synthetic-missing-block" },
  { characterOffset: -1 },
  { endCharacterOffset: 1000 },
  { quote: "wrong quote" },
]) {
  test(`invalid canonical search anchor is rejected: ${JSON.stringify(patch)}`, () => {
    assert.equal(exports.resolveCanonicalSearchAnchor(message, { ...rangeTarget, ...patch }), null);
  });
}
