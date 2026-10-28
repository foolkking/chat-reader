import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/lib/offline-search.worker.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const document = (id, overrides = {}) => ({
  id, conversation_id: "synthetic-target-conversation", message_id: `message-${id}`,
  document_type: "message", role: "assistant", title: "Synthetic title",
  plain_text: "needle body", order_key: id, metadata: {}, ...overrides,
});

// Actual worker handler, compound-tag construction and installed FlexSearch.
// Only message delivery/self are adapters; not a real browser Worker or Dexie.
function fixture(documents) {
  let handler;
  const replies = [];
  const self = {
    addEventListener: (type, callback) => { assert.equal(type, "message"); handler = callback; },
    postMessage: reply => replies.push(reply),
  };
  new Function("require", "exports", "self", compiled)(name => {
    assert.equal(name, "flexsearch");
    return require("flexsearch");
  }, {}, self);
  let sequence = 0;
  const send = payload => {
    const requestId = `synthetic-request-${++sequence}`;
    handler({ data: { ...payload, requestId } });
    const reply = replies.at(-1);
    assert.equal(reply.requestId, requestId);
    return reply;
  };
  send({ type: "init", documents });
  return {
    search: (query, limit = 80, scope) => send({ type: "search", query, limit, scope }).items,
    page: (query, offset, limit, scope) => send({ type: "search", query, offset, limit, scope }),
    init: documents => send({ type: "init", documents }),
  };
}

test("scoped content search cannot lose its target behind more than the old global candidate window", () => {
  const unrelated = Array.from({ length: 400 }, (_, index) =>
    document(`unrelated-${index}`, { conversation_id: "synthetic-other-conversation" }));
  const otherRoles = Array.from({ length: 250 }, (_, index) =>
    document(`other-role-${index}`, { role: "user" }));
  const otherTypes = Array.from({ length: 250 }, (_, index) =>
    document(`other-type-${index}`, { document_type: "heading" }));
  const target = document("synthetic-final-target");
  const f = fixture([...unrelated, ...otherRoles, ...otherTypes, target]);
  const items = f.search("needle", 1, {
    conversationId: target.conversation_id, documentType: "message", role: "assistant", contentOnly: true,
  });
  assert.deepEqual(items.map(item => item.id), [target.id]);
});

test("scoped pages use lookahead, retain distinct IDs and disclose when the bounded total is not exact", () => {
  const documents = Array.from({ length: 121 }, (_, index) => document(`page-${String(index).padStart(3, "0")}`));
  const scope = { conversationId: documents[0].conversation_id, documentType: "message", contentOnly: true };
  const f = fixture(documents);
  const pages = [0, 50, 100].map(offset => f.page("needle", offset, 50, scope));
  assert.deepEqual(pages.map(page => page.items.length), [50, 50, 21]);
  assert.deepEqual(pages.map(page => page.hasMore), [true, true, false]);
  assert.deepEqual(pages.map(page => page.totalIsExact), [false, false, true]);
  assert.equal(pages.at(-1).total, 121);
  assert.equal(new Set(pages.flatMap(page => page.items.map(item => item.id))).size, 121);
  assert.deepEqual(pages.flatMap(page => page.items.map(item => item.id)), documents.map(item => item.id));
});

test("an exactly full scoped page has no spurious next page", () => {
  const documents = Array.from({ length: 50 }, (_, index) => document(`exact-${index}`));
  const page = fixture(documents).page("needle", 0, 50, { conversationId: documents[0].conversation_id, contentOnly: true });
  assert.equal(page.items.length, 50);
  assert.equal(page.hasMore, false);
  assert.equal(page.totalIsExact, true);
});

test("conversation, type and role filters are conjunctive, including every partial combination", () => {
  const documents = [
    document("target"),
    document("other-conversation", { conversation_id: "synthetic-other-conversation" }),
    document("other-role", { role: "user" }),
    document("other-type", { document_type: "code" }),
  ];
  const f = fixture(documents);
  for (let mask = 1; mask < 8; mask++) {
    const scope = {
      ...(mask & 1 ? { conversationId: documents[0].conversation_id } : {}),
      ...(mask & 2 ? { documentType: "message" } : {}),
      ...(mask & 4 ? { role: "assistant" } : {}),
      contentOnly: true,
    };
    const expected = documents.filter(item => (!scope.conversationId || item.conversation_id === scope.conversationId)
      && (!scope.documentType || item.document_type === scope.documentType)
      && (!scope.role || item.role === scope.role));
    assert.deepEqual(f.search("needle", 80, scope).map(item => item.id).sort(), expected.map(item => item.id).sort());
  }
  assert.deepEqual(f.search("needle", 1, { conversationId: "synthetic-missing", contentOnly: true }), []);
  assert.deepEqual(f.search("needle", 1, { role: "synthetic-missing-role", contentOnly: true }), []);
});

test("global titles remain searchable but title/type fields cannot impersonate current-conversation body hits", () => {
  const target = document("title-only", { title: "TitleOnlyNeedle", plain_text: "unrelated body" });
  const f = fixture([target]);
  assert.deepEqual(f.search("TitleOnlyNeedle").map(item => item.id), [target.id]);
  const scope = { conversationId: target.conversation_id, documentType: "message", contentOnly: true };
  assert.deepEqual(f.search("TitleOnlyNeedle", 80, scope), []);
  assert.deepEqual(f.search("message", 80, scope), []);
  assert.deepEqual(f.search("message"), []);
});

test("filename and annotation comment content remain searchable with null message/role", () => {
  const attachment = document("file", { document_type: "attachment", role: null, message_id: null,
    title: "synthetic-report.txt", plain_text: "unrelated extracted file content" });
  const annotation = document("note", { document_type: "annotation", role: null, plain_text: "needle comment" });
  const f = fixture([attachment, annotation]);
  assert.deepEqual(f.search("synthetic-report", 1, {
    conversationId: attachment.conversation_id, documentType: "attachment", contentOnly: true,
  }).map(item => item.id), [attachment.id]);
  assert.deepEqual(f.search("needle", 1, {
    conversationId: annotation.conversation_id, documentType: "annotation", contentOnly: true,
  }).map(item => item.id), [annotation.id]);
});

test("union is deduplicated and bounded and reinitialization replaces old scope memberships", () => {
  const documents = Array.from({ length: 12 }, (_, index) => document(`both-${index}`, { title: "needle title" }));
  const f = fixture(documents);
  const items = f.search("needle", 3);
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map(item => item.id)).size, 3);
  assert.deepEqual(f.search(" ", 3, { conversationId: documents[0].conversation_id }), []);
  assert.deepEqual(f.search("needle", 0), []);
  f.init([document("new", { conversation_id: "synthetic-new-conversation" })]);
  assert.deepEqual(f.search("needle", 3, { conversationId: documents[0].conversation_id }), []);
  assert.deepEqual(f.search("needle").map(item => item.id), ["new"]);
});
