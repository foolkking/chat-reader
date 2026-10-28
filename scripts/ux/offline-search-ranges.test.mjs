import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("lib/reader-data-source.ts");
const ast = ts.createSourceFile("reader-data-source.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations])
  .find(node => node.name.getText(ast) === "offlineReaderDataSource");
assert.ok(declaration && ts.isObjectLiteralExpression(declaration.initializer));
const method = declaration.initializer.properties.find(node => node.name?.getText(ast) === "searchConversation");
assert.ok(method && ts.isMethodDeclaration(method));
const metadata = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "metadataNumber");
const readBlocks = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getOfflineMessageBlocks");
const projection = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "resolveOfflineSearchResult");
assert.ok(metadata && readBlocks && projection);
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const matcherExports = {};
new Function("exports", compile(read("lib/search-text-matches.ts")))(matcherExports);
const compiled = compile(`exports.source = { ${method.getText(ast)} }; ${metadata.getText(ast)} ${readBlocks.getText(ast)} ${projection.getText(ast)}`);
const text = "😀 one\tneedle  needle";
const document = {
  id: "synthetic-document", document_type: "message", conversation_id: "synthetic-conversation",
  message_id: "synthetic-message", message_version_id: "synthetic-indexed-version",
  title: "Synthetic conversation", plain_text: text, search_text: text, metadata: {},
};
const message = { id: document.message_id, conversation_id: document.conversation_id, current_version: { id: "synthetic-current-version" } };
const block = { id: "synthetic-block", message_id: message.id, block_index: 0, plain_text: text };

// Actual extracted offline search and matcher. FlexSearch recall and Dexie
// reads are controlled adapters, not IndexedDB/package migration evidence.
async function search(documents, blocks = [block], indexedBlocks = blocks, { storedMessage = message, assertAccess = () => {} } = {}) {
  const exports = {};
  const offlineDb = {
    messages: { get: async id => id === message.id ? storedMessage : null },
    blocks: {
      where: () => ({ equals: () => ({ sortBy: async () => indexedBlocks }) }),
      toArray: async () => blocks,
    },
  };
  new Function("exports", "searchOfflinePage", "offlineDb", "findSearchTextMatches", "captureOfflineAccess", "assertOfflineAccess", compiled)(
    exports, async (query, limit, offset, scope) => {
      assert.equal(query, "needle");
      assert.equal(limit, 50);
      assert.equal(offset, 0);
      assert.deepEqual(scope, { conversationId: document.conversation_id, documentType: undefined, role: undefined, contentOnly: true });
      return { items: documents, total: documents.length, offset, has_more: false, total_is_exact: true };
    }, offlineDb, matcherExports.findSearchTextMatches, () => 1, assertAccess,
  );
  return exports.source.searchConversation(document.conversation_id, { query: "needle" });
}

test("offline search preserves indexed version and raw code-point match ranges", async () => {
  const result = await search([document]);
  const item = result.items[0];
  assert.equal(item.message_version_id, "synthetic-indexed-version");
  assert.equal(item.occurrence_count, 1);
  assert.deepEqual(item.matches.map(match => [match.match_start, match.match_end]), [[6, 12], [14, 20]]);
  for (const match of item.matches) {
    assert.equal(Array.from(text).slice(match.match_start, match.match_end).join(""), match.quote);
  }
});

test("legacy offline body without blocks stays searchable without inventing a block offset", async () => {
  const result = await search([{ ...document, message_version_id: null }], []);
  const item = result.items[0];
  assert.equal(item.message_version_id, "synthetic-current-version");
  assert.deepEqual(item.matches, []);
  assert.equal(item.block_index, null);
  assert.equal(item.character_offset, null);
  assert.equal(item.snippet, text);
});

test("offline search reuses canonical block fallback when a legacy message index is empty", async () => {
  const unrelated = { ...block, id: "synthetic-unrelated-block", message_id: "synthetic-other-message" };
  const result = await search([document], [unrelated, block], []);
  assert.deepEqual(result.items[0].matches.map(match => [match.match_start, match.match_end]), [[6, 12], [14, 20]]);
  assert.ok(result.items[0].matches.every(match => match.render_block_id === block.id));
});

test("offline attachment and annotation text never acquire message-body ranges", async () => {
  const attachment = { ...document, id: "synthetic-file-document", document_type: "attachment", message_id: null,
    metadata: { attachment_id: "synthetic-attachment" } };
  const annotation = { ...document, id: "synthetic-note-document", document_type: "annotation",
    metadata: { annotation_id: "synthetic-annotation", start_block_index: 2, start_offset: 5 } };
  const result = await search([attachment, annotation]);
  assert.deepEqual(result.items[0].matches, []);
  assert.equal(result.items[0].attachment_id, "synthetic-attachment");
  assert.deepEqual(result.items[1].matches, []);
  assert.equal(result.items[1].block_index, 2);
  assert.equal(result.items[1].character_offset, 5);
  assert.equal(result.items[1].annotation_id, "synthetic-annotation");
});

test("heading/code projection uses its canonical later block instead of another message occurrence", async () => {
  const later = { ...block, id: "synthetic-later-block", block_index: 2, plain_text: "😀 needle" };
  for (const document_type of ["heading", "code"]) {
    const result = await search([{ ...document, document_type, metadata: { block_index: 2 } }], [block, later]);
    const [match] = result.items[0].matches;
    assert.equal(result.items[0].matches.length, 1);
    assert.equal(match.render_block_id, later.id);
    assert.deepEqual([match.block_index, match.match_start, match.match_end], [2, 2, 8]);
    const missing = await search([{ ...document, document_type, metadata: {} }], [block, later]);
    assert.deepEqual(missing.items[0].matches, []);
    assert.equal(missing.items[0].character_offset, null);
  }
});

test("a misbound stored message cannot supply another conversation's blocks or current version", async () => {
  const result = await search([{ ...document, message_version_id: undefined }], [block], [block], {
    storedMessage: { ...message, conversation_id: "synthetic-other-conversation" },
  });
  assert.deepEqual(result.items[0].matches, []);
  assert.equal(result.items[0].message_version_id, null);
  assert.equal(result.items[0].render_block_id, null);
});

test("projection does not publish a result after its captured offline access is retired", async () => {
  await assert.rejects(search([document], [block], [block], {
    assertAccess: () => { throw Error("Synthetic retired access"); },
  }), /retired access/);
});
