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
const projection = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.body && node.name?.text === "resolveOfflineSearchResult");
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
async function search(documents, blocks = [block], indexedBlocks = blocks, {
  storedMessage = message, assertAccess = () => {}, searchPage, byMessage, options = {},
} = {}) {
  const exports = {};
  const offlineDb = {
    messages: { get: async id => byMessage?.has(id) ? { ...message, id } : id === message.id ? storedMessage : null },
    blocks: {
      where: () => ({ equals: id => ({ sortBy: async () => byMessage?.get(id) ?? indexedBlocks }) }),
      toArray: async () => blocks,
    },
  };
  new Function("exports", "searchOfflinePage", "captureOfflineSearchIndex", "offlineDb", "findSearchTextMatches", "captureOfflineAccess", "assertOfflineAccess", "hydrateOfflineBlockAttachments", compiled)(
    exports, searchPage ?? (async (query, limit, offset, scope) => {
      assert.equal(query, "needle");
      assert.equal(limit, 50);
      assert.equal(offset, 0);
      assert.deepEqual(scope, { conversationId: document.conversation_id, documentType: undefined, role: undefined, contentOnly: true });
      return { items: documents, total: documents.length, offset, has_more: false, total_is_exact: true };
    }), () => ({}), offlineDb, matcherExports.findSearchTextMatches, () => 1, assertAccess,
    () => { throw Error("Text search must not hydrate media or create object URLs."); },
  );
  return exports.source.searchConversation(document.conversation_id, { query: "needle", ...options });
}

test("cross-block phrases cannot crowd out real locations, inflate totals or break offline continuation", async () => {
  const docs = [], byMessage = new Map(), offsets = [];
  for (let i = 0; i < 125; i++) {
    const id = `m-${i}`, words = i === 55 || i === 90 || i === 120 ? ["a b"] : ["a", "b"];
    docs.push({ ...document, id: `d-${i}`, message_id: id, plain_text: words.join("\n"), order_key: `${i}` });
    byMessage.set(id, words.map((plain_text, n) => ({ ...block, id: `b-${i}-${n}`, message_id: id, block_index: n, plain_text })));
  }
  const searchPage = async (query, limit, offset) => {
    assert.equal(query, "a b"); assert.ok(limit > 0 && limit <= 50); offsets.push(offset);
    return { items: docs.slice(offset, offset + limit), total: docs.length, has_more: offset + limit < docs.length };
  };
  const page = (options = {}) => search([], [], [], { byMessage, searchPage, options: { query: "a b", limit: 2, ...options } });
  const first = await page();
  assert.deepEqual(first.items.map(d => d.document_id), ["d-55", "d-90"]);
  assert.equal(first.total, 3); assert.equal(first.total_is_exact, false); assert.equal(first.has_more, true);
  offsets.length = 0;
  const second = await page({ offset: 2, candidateOffset: first.nextCandidateOffset });
  assert.deepEqual(second.items.map(d => d.document_id), ["d-120"]);
  assert.equal(offsets[0], 120, "continuation does not re-project earlier messages");
  assert.equal(second.total, 3); assert.equal(second.total_is_exact, true); assert.equal(second.has_more, false);
  const randomAccess = await page({ offset: 2 });
  assert.deepEqual(randomAccess.items, second.items);
});

test("offline canonical ranges can continue to the 101st and 205th match without reading media", async () => {
  const plain_text = "needle ".repeat(205);
  const docs = [{ ...document, plain_text, search_text: plain_text }];
  const blocks = [{ ...block, plain_text }];
  const first = await search(docs, blocks);
  assert.equal(first.items[0].matches.length, 100);
  assert.equal(first.next_match_offset, 100);
  const second = await search(docs, blocks, blocks, { options: {
    candidateOffset: first.nextCandidateOffset, offset: first.next_offset,
    matchOffset: first.next_match_offset, matchDocumentId: first.next_document_id,
  } });
  assert.equal(second.items[0].matches.length, 100);
  assert.equal(second.next_match_offset, 200);
  const third = await search(docs, blocks, blocks, { options: {
    candidateOffset: second.nextCandidateOffset, offset: second.next_offset,
    matchOffset: second.next_match_offset, matchDocumentId: second.next_document_id,
  } });
  assert.equal(third.items[0].matches.length, 5);
  assert.equal(third.has_more, false);
  assert.equal(new Set([first, second, third].flatMap(p => p.items.flatMap(i => i.matches.map(m => m.match_start)))).size, 205);
});

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

test("offline text search uses the same canonical ranges without hydrating inline attachments", async () => {
  const inlineBlock = { ...block, data: {
    attachmentOccurrences: [{ attachmentId: "synthetic-media", occurrenceKey: "synthetic-occurrence" }],
  } };
  const result = await search([document], [inlineBlock]);
  assert.deepEqual(result.items[0].matches.map(match => [match.match_start, match.match_end]), [[6, 12], [14, 20]]);
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

test("offline block pagination hydrates only selected blocks and deduplicates inline assets", async () => {
  const getPage = declaration.initializer.properties.find(node => node.name?.getText(ast) === "getMessageBlocks");
  const hydrate = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "hydrateOfflineBlockAttachments");
  assert.ok(getPage && hydrate);
  const pageCode = compile(`exports.source = { ${getPage.getText(ast)} }; ${readBlocks.getText(ast)} ${hydrate.getText(ast)}`);
  const blocks = [0, 1, 2].map(index => ({
    ...block, block_index: index, data: {
      attachmentId: `asset-${index}`,
      attachmentOccurrences: [
        { attachmentId: `asset-${index}`, occurrenceKey: `link-${index}` },
        { attachmentId: `asset-${index}`, occurrenceKey: `image-${index}` },
      ],
    },
  }));
  const before = structuredClone(blocks), reads = [], exports = {};
  new Function("exports", "offlineDb", "getOfflineAttachment", pageCode)(
    exports, { blocks: { where: () => ({ equals: () => ({ sortBy: async () => blocks }) }) } },
    async id => { reads.push(id); return { content_url: `blob:synthetic/${id}`, download_url: `blob:synthetic/${id}`, detected_mime_type: "image/png" }; },
  );
  const result = await exports.source.getMessageBlocks(message.id, { start: 1, limit: 1 });
  assert.deepEqual(reads, ["asset-1"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].data.attachmentOccurrences[1].contentUrl, "blob:synthetic/asset-1");
  assert.deepEqual(blocks, before, "hydration is a read projection, never an offline canonical write");
});
