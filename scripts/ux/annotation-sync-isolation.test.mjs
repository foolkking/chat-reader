import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const code = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/annotation-sync.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
class ApiRequestError extends Error { constructor(status) { super("Synthetic failure"); this.status = status; } }
const operation = (id, conversation, entity = id) => ({
  operation_id: id, conversation_id: conversation, entity_id: entity, entity_type: "annotation",
  action: "upsert", base_revision: 1, payload: {}, attempts: 0, queued_at: id,
});
function table(rows = []) {
  const data = new Map(rows.map(row => [row.operation_id ?? row.id ?? row.key, row]));
  const query = (predicate = () => true, limit = Infinity) => ({
    equals: value => query(row => row.conversation_id === value),
    filter: next => query(row => predicate(row) && next(row), limit),
    limit: value => query(predicate, value),
    toArray: async () => [...data.values()].filter(predicate).slice(0, limit),
    delete: async () => { for (const [key, row] of data) if (predicate(row)) data.delete(key); },
    modify: async patch => { for (const row of data.values()) if (predicate(row)) Object.assign(row, patch); },
  });
  return { data, orderBy: () => query(), where: () => query(), bulkDelete: async ids => ids.forEach(id => data.delete(id)),
    put: async row => data.set(row.operation_id ?? row.id ?? row.key, row),
    bulkPut: async rows => rows.forEach(row => data.set(row.id, row)),
    update: async (id, patch) => { if (data.has(id)) Object.assign(data.get(id), patch); },
  };
}
function fixture({ failure, snapshotFailure, retire = false } = {}) {
  const db = { name: "synthetic", outbox: table([operation("1", "A"), operation("2", "B"), operation("3", "B", "2")]),
    annotations: table(), notebooks: table(), searchDocuments: table(), conversations: table(), settings: table(),
    transaction: async (...args) => args.at(-1)() };
  const requests = [], positions = [];
  let generation = 1;
  const exports = {};
  const mocks = {
    "./api": { ApiRequestError, syncConversationAnnotations: async items => {
      requests.push(items);
      if (retire) { generation++; throw Error("Account retired"); }
      if (items[0].conversation_id === "A" && failure) throw new ApiRequestError(failure);
      return { results: items.map(item => ({ ...item, revision: 2, status: "applied" })) };
    }, getConversationAnnotations: async id => {
      if (id === "A" && snapshotFailure) throw new ApiRequestError(503);
      return [];
    }, getConversationNotebook: async id => ({ id: `note-${id}`, conversation_id: id }), getConversationNotebookConflicts: async () => [] },
    "./offline-db": { offlineDb: db, getActiveOfflineStorageContext: () => ({ userId: "synthetic" }),
      clearOfflineAnnotationSearch: async () => {}, syncOfflineAnnotationSearch: async () => {} },
    "./offline-access": { captureOfflineAccess: () => generation, assertOfflineAccess: captured => {
      if (captured !== generation) throw Error("Account retired");
    }, offlineAuthenticationRequired: () => true },
    "./server-session": { canUseServer: () => true },
    "./reading-position-sync": { flushReadingPositionBatch: async () => { positions.push(true); return { synced: 0, conflicts: 0 }; } },
  };
  new Function("exports", "require", "navigator", "window", code)(exports, name => {
    assert.ok(mocks[name], name); return mocks[name];
  }, { onLine: true, locks: { request: async (_key, run) => run() } }, { dispatchEvent() {} });
  return { ...exports, db, requests, positions };
}
for (const failure of [404, 503]) test(`${failure}: a rejected conversation cannot reject B or advance its second entity edit`, async () => {
  const f = fixture({ failure });
  const result = await f.flushAnnotationOutbox();
  assert.equal(result.synced, 1);
  assert.deepEqual(f.requests.map(items => items.map(item => item.conversation_id)), [["A"], ["B"]]);
  assert.equal(f.db.outbox.data.get("1").last_error, failure === 404 ? "INVALID" : "NETWORK");
  assert.equal(f.db.outbox.data.has("2"), false);
  assert.equal(f.db.outbox.data.get("3").attempts, 0);
});
test("post-commit snapshot failure retains A's same operation ID while B confirms", async () => {
  const f = fixture({ snapshotFailure: true });
  assert.equal((await f.flushAnnotationOutbox()).synced, 1);
  assert.equal(f.db.outbox.data.get("1").last_error, "NETWORK");
  await f.flushAnnotationOutbox();
  assert.deepEqual(f.requests.filter(items => items[0].conversation_id === "A").map(items => items[0].operation_id), ["1", "1"]);
});
test("authentication failure stops the entire pass, including reading-position writes", async () => {
  const f = fixture({ failure: 401 });
  await f.flushAnnotationOutbox();
  assert.equal(f.requests.length, 1);
  assert.equal(f.positions.length, 0);
  assert.equal(f.db.outbox.data.get("2").attempts, 0);
});
test("account retirement does not write old failures or continue in another namespace", async () => {
  const f = fixture({ retire: true });
  await assert.rejects(f.flushAnnotationOutbox(), /retired/);
  assert.equal(f.db.outbox.data.get("1").attempts, 0);
  assert.equal(f.requests.length, 1);
});
