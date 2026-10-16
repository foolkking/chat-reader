import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const path = "components/offline-sync-center.tsx";
const source = readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const liveCalls = [];
const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "liveQuery") liveCalls.push(node);
  ts.forEachChild(node, visit);
};
visit(ast);
assert.equal(liveCalls.length, 1, "Extract the one local-ledger liveQuery");
const liveRead = liveCalls[0].arguments[0];
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["downloadNeedsAttention", "readLocalSection", "successfulLocalRead"].includes(node.name?.text));
assert.equal(helpers.length, 3);
const compiled = ts.transpileModule(
  helpers.map(node => node.getText(ast)).join("\n") + `\nexports.read = (${liveRead.getText(ast)});\nexports.readLocalSection = readLocalSection;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

const task = (id, scope = "conversation") => ({
  id, scope, scopeId: scope === "conversation" ? "synthetic-conversation" : undefined,
  state: "failed", serverCancellation: undefined,
});

function createChain(table, calls, value, countValue = 0, beforeRead = () => {}) {
  const chain = {
    orderBy: key => { calls.push(`${table}.orderBy(${key})`); return chain; },
    reverse: () => { calls.push(`${table}.reverse()`); return chain; },
    offset: value => { calls.push(`${table}.offset(${value})`); return chain; },
    limit: value => { calls.push(`${table}.limit(${value})`); return chain; },
    where: key => { calls.push(`${table}.where(${key})`); return chain; },
    startsWith: prefix => { calls.push(`${table}.startsWith(${prefix})`); return chain; },
    equals: value => { calls.push(`${table}.equals(${value})`); return chain; },
    toArray: async () => { calls.push(`${table}.toArray()`); beforeRead(); return value; },
    count: async () => { calls.push(`${table}.count()`); beforeRead(); return countValue; },
  };
  return chain;
}

function runRead({ tab, page = 0, initialJobId, conversations = [], downloads = [],
  operations = [], markers = [], failedRows = [], notebookDrafts = [],
  continuationDrafts = [], conversationCount = conversations.length, anyCopyCount = conversationCount,
  scopedCopyCount = 1, failureSection = null }) {
  const calls = [];
  const beforeRead = section => () => { if (failureSection === section) throw Error("Synthetic local read failure"); };
  const conversationsTable = {
    count: async () => { calls.push("conversations.count()"); beforeRead("copies")(); return conversationCount; },
    orderBy: key => createChain("conversations", calls, conversations, 0, beforeRead("copies")).orderBy(key),
    toCollection: () => createChain("conversations", calls, [], anyCopyCount),
    where: key => createChain("conversations", calls, [], scopedCopyCount).where(key),
  };
  const outboxTable = {
    orderBy: key => createChain("outbox", calls, operations, 0, beforeRead("pending")).orderBy(key),
    count: async () => { calls.push("outbox.count()"); beforeRead("pending")(); return operations.length; },
    filter: predicate => {
      calls.push("outbox.filter()");
      // The actual callback only needs a chain after filter; evaluate one
      // synthetic item to ensure its predicate is not replaced by the adapter.
      predicate({ last_error: "NETWORK" });
      return createChain("outbox", calls, failedRows, failedRows.length, beforeRead("failures"));
    },
  };
  const settingsTable = {
    where: key => {
      const chain = createChain("settings", calls, []).where(key);
      chain.startsWith = prefix => {
        calls.push(`settings.startsWith(${prefix})`);
        const values = prefix === "sync-conflict:" ? markers : prefix === "notebook-draft:" ? notebookDrafts : continuationDrafts;
        return createChain("settings", calls, values, values.length, beforeRead(prefix === "sync-conflict:" ? "conflicts" : "drafts"));
      };
      return chain;
    },
  };
  const db = { conversations: conversationsTable, outbox: outboxTable, settings: settingsTable };
  const exports = {};
  const bindings = {
    db: undefined,
    offlineDb: db,
    tab,
    page,
    initialJobId,
    listOfflineDownloads: async () => {
      calls.push("downloads.list");
      beforeRead("downloads")();
      return downloads;
    },
  };
  new Function(...Object.keys(bindings), "exports", compiled)(...Object.values(bindings), exports);
  return { calls, result: exports.read(), readLocalSection: exports.readLocalSection };
}

test("Copies reads only copy rows/count and downloads, not hidden pending/draft/conflict ledgers", async () => {
  const f = runRead({ tab: "copies", conversations: [{ id: "copy" }], downloads: [task("download")] });
  await f.result;
  assert.ok(f.calls.includes("conversations.count()"));
  assert.ok(f.calls.some(call => call.startsWith("conversations.orderBy(")));
  assert.ok(f.calls.includes("downloads.list"));
  assert.ok(!f.calls.some(call => call.startsWith("outbox.")));
  assert.ok(!f.calls.some(call => call.startsWith("settings.")));
});

test("Pending reads its operation/draft/conflict owners without conversation pages or downloads", async () => {
  const f = runRead({
    tab: "pending",
    operations: [{ operation_id: "operation" }],
    markers: [{ key: "sync-conflict:synthetic", value: { conversation_id: "copy" } }],
    notebookDrafts: [{ key: "notebook-draft:synthetic" }],
    continuationDrafts: [{ key: "continuation-draft:synthetic" }],
  });
  const result = await f.result;
  assert.deepEqual(result.pendingRead.value.operations, [{ operation_id: "operation" }]);
  assert.ok(f.calls.includes("outbox.count()"));
  assert.ok(f.calls.some(call => call.includes("startsWith(notebook-draft:)")));
  assert.ok(f.calls.some(call => call.includes("startsWith(continuation-draft:)")));
  assert.ok(f.calls.some(call => call.includes("startsWith(sync-conflict:)")));
  assert.ok(!f.calls.some(call => call.startsWith("conversations.")));
  assert.ok(!f.calls.includes("downloads.list"));
});

test("Failures reads tasks/conflicts/failed rows and only the displayed copy-existence checks", async () => {
  const scoped = runRead({
    tab: "failures",
    downloads: [task("scoped", "conversation")],
    markers: [{ key: "sync-conflict:synthetic", value: { conversation_id: "copy" } }],
    failedRows: [{ operation_id: "failed" }],
    scopedCopyCount: 1,
  });
  const scopedResult = await scoped.result;
  assert.equal(scopedResult.failureRead.value.failedRows.length, 1);
  assert.ok(scoped.calls.includes("downloads.list"));
  assert.ok(scoped.calls.includes("outbox.filter()"));
  assert.ok(scoped.calls.some(call => call.includes("conversations.where(id)")));
  assert.ok(!scoped.calls.some(call => call.includes("conversations.orderBy(")));
  assert.ok(!scoped.calls.some(call => call.includes("settings.startsWith(notebook-draft:)")));

  const allScope = runRead({ tab: "failures", downloads: [task("all", "all")], anyCopyCount: 1 });
  await allScope.result;
  assert.ok(allScope.calls.includes("conversations.limit(1)"));
  assert.ok(!allScope.calls.some(call => call.includes("conversations.orderBy(")));
  assert.ok(!allScope.calls.some(call => call.includes("conversations.where(")));
});

test("an initial task entry keeps its download read even when the selected tab is Pending", async () => {
  const f = runRead({
    tab: "pending",
    initialJobId: "synthetic-job",
    downloads: [{ ...task("download"), jobId: "synthetic-job" }],
  });
  await f.result;
  assert.ok(f.calls.includes("downloads.list"));
});

test("tab-owned query results preserve the existing paging offsets and bounded limits", async () => {
  const copies = runRead({ tab: "copies", page: 2 });
  await copies.result;
  assert.ok(copies.calls.includes("conversations.offset(40)"));
  assert.ok(copies.calls.includes("conversations.limit(20)"));
  const pending = runRead({ tab: "pending", page: 3 });
  await pending.result;
  assert.ok(pending.calls.includes("outbox.offset(60)"));
  assert.ok(pending.calls.includes("outbox.limit(20)"));
  const failures = runRead({ tab: "failures", page: 4, downloads: [task("scoped")] });
  await failures.result;
  assert.ok(failures.calls.includes("outbox.offset(80)"));
  assert.ok(failures.calls.includes("outbox.limit(20)"));
});

test("download-status rejection settles separately from a successful copy read", async () => {
  const f = runRead({ tab: "copies", conversations: [{ id: "synthetic-copy" }], failureSection: "downloads" });
  const result = await f.result;
  assert.equal(result.downloadRead.ok, false);
  assert.equal(result.downloadRead.section, "downloads");
  assert.equal(result.copyRead.ok, true);
  assert.deepEqual(result.copyRead.value.rows, [{ id: "synthetic-copy" }]);
  assert.equal(result.copyRead.value.count, 1);
});

test("pending operations remain independently readable when one draft prefix fails", async () => {
  const f = runRead({ tab: "pending", operations: [{ operation_id: "synthetic-edit" }],
    markers: [{ key: "sync-conflict:synthetic" }], failureSection: "drafts" });
  const result = await f.result;
  assert.equal(result.draftRead.ok, false);
  assert.equal(result.pendingRead.ok, true);
  assert.equal(result.pendingRead.value.operationCount, 1);
  assert.equal(result.conflictRead.ok, true);
  assert.deepEqual(result.conflictRead.value, [{ key: "sync-conflict:synthetic" }]);
  assert.ok(!f.calls.includes("downloads.list"));
});

test("outbox failure cannot reject readable draft and conflict sections", async () => {
  const notebookDrafts = [{ key: "notebook-draft:synthetic" }];
  const continuationDrafts = [{ key: "continuation-draft:synthetic" }];
  const f = runRead({ tab: "pending", notebookDrafts, continuationDrafts, failureSection: "pending" });
  const result = await f.result;
  assert.equal(result.pendingRead.ok, false);
  assert.equal(result.draftRead.ok, true);
  assert.deepEqual(result.draftRead.value.draftRows, notebookDrafts);
  assert.deepEqual(result.draftRead.value.contextRows, continuationDrafts);
  assert.equal(result.draftRead.value.draftsTotal, 1);
  assert.equal(result.draftRead.value.contextTotal, 1);
});

test("failed conflict markers cannot reject download failures or failed outbox rows", async () => {
  const f = runRead({ tab: "failures", downloads: [task("synthetic-download")],
    failedRows: [{ operation_id: "synthetic-failure" }], failureSection: "conflicts" });
  const result = await f.result;
  assert.equal(result.conflictRead.ok, false);
  assert.equal(result.downloadRead.ok, true);
  assert.equal(result.downloadRead.value.tasks[0].id, "synthetic-download");
  assert.equal(result.failureRead.ok, true);
  assert.equal(result.failureRead.value.failedCount, 1);
});

test("the actual section helper catches synchronous throws and asynchronous rejections without changing success data", async () => {
  const f = runRead({ tab: "pending" });
  await f.result;
  const value = { synthetic: true };
  assert.deepEqual(await f.readLocalSection("drafts", () => value), { section: "drafts", ok: true, value });
  const syncError = Error("Synthetic sync throw"), asyncError = Error("Synthetic async rejection");
  assert.deepEqual(await f.readLocalSection("drafts", () => { throw syncError; }), { section: "drafts", ok: false, error: syncError });
  assert.deepEqual(await f.readLocalSection("pending", () => Promise.reject(asyncError)), { section: "pending", ok: false, error: asyncError });
});
