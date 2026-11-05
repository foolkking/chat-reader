import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/lib/offline-search-documents.ts", import.meta.url), "utf8");
const exports = {};
new Function("exports", ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText)(exports);
const build = exports.buildOfflineSearchDocuments;
const annotation = (id, patch = {}) => ({
  id, conversation_id: "synthetic-conversation", message_id: "synthetic-message",
  message_version_id: "synthetic-version-new", annotation_type: "comment", color: "yellow",
  start_block_index: 3, start_offset: 17, quote: "current quote", comment_markdown: "current comment",
  anchor_status: "exact", is_deleted: false, metadata: { message_order_key: "0042" }, ...patch,
});
const document = (id, annotationId, patch = {}) => ({
  id, conversation_id: "synthetic-conversation", document_type: "annotation",
  title: "Synthetic old index", plain_text: "obsolete comment", message_id: "synthetic-message",
  metadata: { annotation_id: annotationId }, ...patch,
});
const conversations = [{ id: "synthetic-conversation", display_title: "Synthetic title" }];

test("canonical and local documents collapse to one latest annotation with saved anchors", () => {
  const docs = [document("synthetic-server-uuid", "A"), document("local-annotation:A", "A")];
  const rows = [annotation("A")], before = structuredClone({ docs, rows });
  const results = build(docs, rows, [], conversations);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "annotation:A");
  assert.equal(results[0].plain_text, "current quote\ncurrent comment");
  assert.equal(results[0].message_version_id, "synthetic-version-new");
  assert.equal(results[0].metadata.annotation_id, "A");
  assert.equal(results[0].metadata.block_index, 3);
  assert.equal(results[0].metadata.character_offset, 17);
  assert.equal(results[0].order_key, "0042");
  assert.deepEqual({ docs, rows }, before, "projection never rewrites imported rows or pending edits");
});

test("a local tombstone suppresses every stale index document for that entity", () => {
  const docs = [document("synthetic-server-uuid", "A"), document("local-annotation:A", "A")];
  assert.deepEqual(build(docs, [annotation("A", { is_deleted: true })], [], conversations), []);
});

test("known legacy annotation document prefixes retain identity even without metadata", () => {
  const docs = [document("local-annotation:A", undefined, { metadata: {} }),
    document("annotation:A", undefined, { metadata: {} })];
  assert.equal(build(docs, [], [], []).length, 1);
  assert.deepEqual(build(docs, [annotation("A", { is_deleted: true })], [], []), []);
  assert.equal(build(docs, [annotation("A")], [], []).length, 1);
});

test("legacy-only annotations retain one result per identity, not per identical text", () => {
  const docs = [document("first-A", "A"), document("duplicate-A", "A"), document("B", "B")];
  assert.deepEqual(build(docs, [], [], []).map(item => item.id), ["first-A", "B"]);
});

test("a legacy entity in another conversation is not suppressed by a local ID collision", () => {
  const legacy = document("synthetic-other-document", "A", { conversation_id: "synthetic-other" });
  const result = build([legacy], [annotation("A", { is_deleted: true })], [], conversations);
  assert.deepEqual(result, [legacy]);
});

test("opaque legacy documents and non-annotation search domains remain untouched", () => {
  const opaque = document("synthetic-opaque", undefined, { metadata: {} });
  const body = document("synthetic-body", "A", { document_type: "message", plain_text: "body" });
  const file = document("synthetic-file", "A", { document_type: "attachment", message_id: null });
  assert.deepEqual(build([opaque, body, file], [annotation("A", { is_deleted: true })], [], []), [opaque, body, file]);
});

test("descriptions and notebooks keep their existing text domains without importing titles", () => {
  const result = build([], [], [{
    id: "synthetic-notebook", conversation_id: "synthetic-conversation", title: "Synthetic notes",
    blocks: [{ type: "markdown", markdown: "note body" }, { type: "annotation", annotation_id: "A" }],
  }], [{ ...conversations[0], description_markdown: "description body" }]);
  assert.deepEqual(result.map(item => [item.document_type, item.plain_text]), [
    ["description", "description body"], ["notebook", "note body"],
  ]);
});

test("personal rows override package UUID documents, including cleared content, without rewriting data", () => {
  const docs = ["description", "notebook"].map(kind => document(`server-${kind}`, undefined, {
    document_type: kind, message_id: null, plain_text: "stale keyword", metadata: {},
  }));
  const notebook = { id: "note", conversation_id: "synthetic-conversation", blocks: [], is_conflict: false };
  const before = structuredClone(docs);
  const result = build(docs, [], [notebook], [{ ...conversations[0], description_markdown: "" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].plain_text, "");
  assert.deepEqual(docs, before);
});

test("legacy-only personal documents remain readable and collapse by logical identity", () => {
  const a = document("server-note", undefined, { document_type: "notebook", metadata: {} });
  const b = { ...a, id: "duplicate-note" };
  assert.deepEqual(build([a, b], [], [], []), [a]);
  const description = { ...a, document_type: "description" };
  assert.deepEqual(build([description], [], [], conversations), [description], "missing legacy description is not a tombstone");
});

test("a conflict notebook does not replace the current legacy notebook or another conversation", () => {
  const legacy = document("server-note", undefined, { document_type: "notebook", metadata: {} });
  const conflict = { id: "conflict", conversation_id: "synthetic-conversation", blocks: [{ type: "markdown", markdown: "conflict text" }], is_conflict: true };
  const other = { ...legacy, id: "other-note", conversation_id: "other" };
  const results = build([legacy, other], [], [conflict], []);
  assert.equal(results.length, 3);
  assert.equal(results[2].metadata.is_conflict, true);
});

test("a replacement canonical notebook retires the previous ID but retains an explicit legacy conflict", () => {
  const current = document("old-current-index", undefined, { document_type: "notebook", metadata: { notebook_id: "old-current" } });
  const conflict = { ...current, id: "old-conflict-index", metadata: { notebook_id: "old-conflict", is_conflict: true } };
  const notebook = { id: "new-current", conversation_id: "synthetic-conversation", blocks: [], is_conflict: false };
  const results = build([current, conflict], [], [notebook], []);
  assert.deepEqual(results.map(item => item.id), ["old-conflict-index", "notebook:new-current"]);
});
