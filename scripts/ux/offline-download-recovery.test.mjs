import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = name => ts.transpileModule(readFileSync(new URL(`../../apps/web/lib/${name}.ts`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleSource = compiled("offline-downloads");
function pure(name) {
  const exports = {};
  new Function("exports", compiled(name))(exports);
  return exports;
}
const errors = pure("offline-download-errors"), progress = pure("offline-download-progress");
const plan = pure("offline-download-plan"), deadline = pure("request-deadline");
class ApiRequestError extends Error { constructor(status) { super("Synthetic failure"); this.status = status; } }
class OfflinePackageImportError extends Error { constructor(code) { super("Synthetic import failure"); this.code = code; } }

// Executes the complete production coordinator. Storage, network, access and
// package publication are deterministic adapters, not claims about real Dexie,
// ZIP validation, Web Locks or authentication; the browser gate covers those.
function fixture(count = 4) {
  const settings = new Map(), copies = new Map(), jobs = new Map(), failures = new Map(), admissions = [], imports = [];
  const catalog = { projects: [], conversations: Array.from({ length: count }, (_, i) =>
    ({ id: `synthetic-${i + 1}`, display_title: `Synthetic conversation ${i + 1}`, revision: 2 })) };
  let epoch = 1, usable = true, catalogError, duringCatalog;
  const read = value => value === undefined ? undefined : structuredClone(value);
  const query = (prefix, filter = () => true) => ({
    filter: next => query(prefix, row => filter(row) && next(row)),
    toArray: async () => [...settings.entries()].map(([key, value]) => ({ key, value: read(value) }))
      .filter(row => row.key.startsWith(prefix) && filter(row)),
    first: async () => (await query(prefix, filter).toArray())[0],
  });
  const db = { name: "synthetic-account",
    settings: {
      get: async key => settings.has(key) ? { key, value: read(settings.get(key)) } : undefined,
      put: async row => { settings.set(row.key, read(row.value)); },
      bulkPut: async rows => rows.forEach(row => settings.set(row.key, read(row.value))),
      delete: async key => { settings.delete(key); },
      where: () => ({ startsWith: prefix => query(prefix) }),
    },
    conversations: { toArray: async () => [...copies.values()].map(read), get: async id => read(copies.get(id)) },
    packages: { get: async () => undefined },
    transaction: async (_mode, _tables, work) => work(),
  };
  const auth = { captureOfflineAccess: () => epoch, authenticationGeneration: () => epoch,
    assertOfflineAccess: captured => { if (captured !== epoch) throw Error("ACCOUNT_CHANGED"); },
    notifyAuthenticationFailure: () => { usable = false; }, offlineAuthenticationRequired: () => true };
  const api = { ApiRequestError, getOfflineCatalog: async () => {
    if (duringCatalog) { const callback = duringCatalog; duringCatalog = undefined; await callback(); }
    if (catalogError) throw new ApiRequestError(catalogError);
    return read(catalog);
  }, queueOfflinePackage: async (body, key) => {
    admissions.push({ body: read(body), key });
    const failure = failures.get(body.conversation_id);
    if (failure?.admission) throw new ApiRequestError(failure.admission);
    jobs.set(key, { id: body.conversation_id, body });
    return { job_id: key, package_id: key };
  }, getTask: async key => {
    const job = jobs.get(key), failure = failures.get(job?.id);
    return { status: failure?.task ? "failed" : "committed", progress: 100, error_message: failure?.task, result: { package_id: key } };
  }, cancelTask: async () => {} };
  const deps = {
    "./api": api, "./offline-access": auth, "./server-session": { canUseServer: () => usable },
    "./offline-download-errors": errors, "./offline-download-progress": progress,
    "./offline-download-plan": plan, "./request-deadline": deadline,
    dexie: { liveQuery: () => ({ subscribe: () => ({ unsubscribe() {} }) }) },
    "./offline-db": { offlineDb: db, OfflinePackageImportError,
      inspectOfflineCopyAssets: async () => ({ metadataKnown: true, missing: 0 }),
      importOfflinePackage: async (packageId, _response, options) => {
        const job = jobs.get(packageId);
        assert.equal(options.expectedConversationId, job.id);
        options.signal.throwIfAborted();
        const failure = failures.get(job.id);
        if (failure?.import) throw new OfflinePackageImportError(failure.import);
        if (failure?.callback) await failure.callback(options.signal);
        options.signal.throwIfAborted();
        await options.onWriting();
        copies.set(job.id, { id: job.id, offline_revision: 2, original: false });
        imports.push(job.id);
      } },
  };
  const exports = {};
  new Function("exports", "require", "window", "navigator", "crypto", "fetch", moduleSource)(
    exports, name => { assert.ok(deps[name], name); return deps[name]; },
    { dispatchEvent() {} }, { onLine: true }, { randomUUID }, async url => {
      const key = url.split("/").at(-2), failure = failures.get(jobs.get(key)?.id);
      if (failure?.fetch) return new Response(null, { status: failure.fetch });
      return new Response("synthetic");
    },
  );
  return { api: exports, copies, jobs, failures, admissions, imports, catalog, settings,
    row: id => read(settings.get("offline-download:" + id)),
    set: row => settings.set("offline-download:" + row.id, read(row)),
    enqueue: async (scopeId, assetMode = "all") => exports.enqueueOfflineDownload({ scope: scopeId ? "conversation" : "all", scopeId, assetMode }),
    run: signal => exports.resumeOfflineDownloads(signal ?? new AbortController().signal),
    changeAccount: () => { epoch++; },
    catalogFailure: status => { catalogError = status; },
    changeDuringCatalog: callback => { duringCatalog = callback; },
    authorize: () => { usable = true; },
  };
}

for (const code of ["GENERATION", "OFFLINE_ASSET_INTEGRITY", "OFFLINE_CONTEXT_INTEGRITY", "OFFLINE_CONTEXT_UNAVAILABLE"]) {
  test(`independent ${code} leaves a truthful ledger and continues siblings; retry repeats only failures`, async () => {
    const f = fixture();
    f.copies.set("synthetic-2", { id: "synthetic-2", offline_revision: 1, original: true });
    const record = await f.enqueue();
    f.failures.set("synthetic-2", { task: code });
    await f.run();
    let row = f.row(record.id);
    assert.equal(row.state, "failed");
    assert.equal(row.error, code);
    assert.deepEqual(progress.offlineDownloadCounts(row), { total: 4, completed: 3, failed: 1, pending: 0 });
    assert.equal(row.conversationCursor, 4);
    assert.equal(row.queuePaused, false);
    assert.equal(f.copies.get("synthetic-2").original, true);
    assert.deepEqual(f.imports, ["synthetic-1", "synthetic-3", "synthetic-4"]);
    const oldKey = f.admissions[1].key;
    f.failures.clear();
    await f.api.retryOfflineDownload(record.id);
    await f.run();
    row = f.row(record.id);
    assert.equal(row.state, "completed");
    assert.equal(f.admissions.length, 5);
    assert.notEqual(f.admissions.at(-1).key, oldKey);
    assert.equal(f.admissions.at(-1).body.conversation_id, "synthetic-2");
    assert.equal(f.copies.get("synthetic-2").original, false);
  });
}

for (const code of ["MALFORMED", "CAPACITY"]) test(`package ${code} never replaces the old copy or marks the child successful`, async () => {
  const f = fixture(3);
  f.copies.set("synthetic-2", { id: "synthetic-2", offline_revision: 1, original: true });
  const record = await f.enqueue();
  f.failures.set("synthetic-2", { import: code });
  await f.run();
  const row = f.row(record.id);
  assert.equal(row.error, code); assert.equal(row.state, "failed");
  assert.equal(row.conversationResults["synthetic-2"].state, "failed");
  assert.equal(f.copies.get("synthetic-2").original, true);
  assert.deepEqual(f.imports, ["synthetic-1", "synthetic-3"]);
});

test("mixed failures retain capacity failures on ordinary retry, then explicit reduction retries only that child", async () => {
  const f = fixture();
  const record = await f.enqueue();
  f.failures.set("synthetic-1", { import: "CAPACITY" });
  f.failures.set("synthetic-3", { task: "OFFLINE_ASSET_INTEGRITY" });
  await f.run();
  assert.equal(f.row(record.id).error, "PARTIAL");
  f.failures.delete("synthetic-3");
  await f.api.retryOfflineDownload(record.id);
  await f.run();
  assert.equal(f.row(record.id).error, "CAPACITY");
  assert.deepEqual(f.admissions.map(x => x.body.conversation_id), ["synthetic-1", "synthetic-2", "synthetic-3", "synthetic-4", "synthetic-3"]);
  await f.api.retryOfflineDownload(record.id); await f.run();
  assert.equal(f.admissions.length, 5);
  const attempt = f.row(record.id).attemptRevision;
  await assert.rejects(f.api.retryOfflineDownload(record.id, { assetMode: "none", expectedAttemptRevision: attempt - 1 }), /STATE_CHANGED/);
  assert.equal(f.row(record.id).assetMode, "all");
  f.failures.clear();
  await f.api.retryOfflineDownload(record.id, { assetMode: "none", expectedAttemptRevision: attempt });
  await f.run();
  assert.equal(f.row(record.id).state, "completed");
  assert.equal(f.admissions.length, 6);
  assert.equal(f.admissions.at(-1).body.include_assets, "none");
  assert.equal(f.row(record.id).conversationResults["synthetic-2"].assetMode, "all");
  assert.equal(f.row(record.id).conversationResults["synthetic-1"].assetMode, "none");
});

for (const [code, injected] of Object.entries({
  NETWORK: { fetch: 500 }, AUTH: { fetch: 401 }, QUOTA: { import: "QUOTA" }, STORAGE_WRITE: { import: "STORAGE_WRITE" },
  OFFLINE_ASSET_IO: { task: "OFFLINE_ASSET_IO" }, SERVER_BUSY: { admission: 429 },
})) test(`${code} pauses the whole local queue without losing receipts or committed children`, async () => {
  const f = fixture(4);
  const first = await f.enqueue();
  const later = await f.enqueue("synthetic-4");
  f.failures.set("synthetic-2", injected);
  await f.run(); await f.run();
  const row = f.row(first.id);
  assert.equal(row.error, code); assert.equal(row.state, "failed"); assert.equal(row.queuePaused, true);
  assert.equal(row.conversationCursor, 1);
  assert.equal(f.row(later.id).state, "queued");
  assert.deepEqual(f.imports, ["synthetic-1"]);
  assert.equal(progress.offlineDownloadBlocksCleanup([row, f.row(later.id)]), false);
  // Automatic refresh/new click must not restart a paused row.
  assert.equal((await f.enqueue()).state, "failed");
  await f.run(); assert.deepEqual(f.imports, ["synthetic-1"]);
  f.failures.clear(); f.authorize();
  await f.api.retryOfflineDownload(first.id); await f.run();
  assert.equal(f.row(first.id).state, "completed");
  assert.equal(f.imports.filter(id => id === "synthetic-1").length, 1);
  await f.run();
  assert.equal(f.row(later.id).state, "completed");
});

test("asset reduction after uncertain admission persists cancellation with the old exact key/options", async () => {
  const f = fixture(2);
  const record = await f.enqueue();
  f.failures.set("synthetic-1", { admission: 429 });
  await f.run();
  const old = f.row(record.id);
  await f.api.retryOfflineDownload(record.id, { assetMode: "small" });
  const pending = f.settings.get("offline-cancellation:" + old.idempotencyKey);
  assert.equal(pending.download.conversationIdempotencyKeys["synthetic-1"], f.admissions[0].key);
  assert.equal(pending.download.assetMode, "all");
  assert.equal(f.row(record.id).serverCancellation, "pending");
  assert.notEqual(f.row(record.id).conversationIdempotencyKeys["synthetic-1"], f.admissions[0].key);
});

test("a missing/forbidden target still requires explicit, fresh scope review", async () => {
  const f = fixture(3);
  const record = await f.enqueue();
  f.catalog.conversations.splice(1, 1);
  await f.run();
  const row = f.row(record.id);
  assert.equal(row.error, "UNAVAILABLE_TARGET"); assert.equal(row.conversationCursor, 1);
  assert.deepEqual(f.imports, ["synthetic-1"]);
  await f.api.retryOfflineDownload(record.id);
  assert.equal(f.row(record.id).state, "failed");
  await f.api.retryOfflineDownloadWithReview(record.id, async review => {
    assert.equal(review.unavailableCount, 1);
    assert.deepEqual(review.targetConversationIds, ["synthetic-3"]); return true;
  });
  await f.run(); assert.equal(f.row(record.id).state, "completed");
  assert.deepEqual(f.imports, ["synthetic-1", "synthetic-3"]);
});

test("stopping a paused row releases the queue but retains failures/copies and remote cancellation intent", async () => {
  const f = fixture(3), record = await f.enqueue(), later = await f.enqueue("synthetic-3");
  f.failures.set("synthetic-2", { fetch: 500 });
  await f.run();
  await f.api.cancelOfflineDownload(record.id);
  const row = f.row(record.id);
  assert.equal(row.state, "cancelled"); assert.equal(row.queuePaused, false);
  assert.equal(row.error, "NETWORK");
  assert.equal(row.serverCancellation, "pending");
  await f.run(); assert.equal(f.row(later.id).state, "completed");
  assert.equal(f.copies.has("synthetic-1"), true);
});

test("a stale stop confirmation cannot cancel a newer attempt", async () => {
  const f = fixture(2), record = await f.enqueue();
  f.failures.set("synthetic-1", { fetch: 500 });
  await f.run();
  const revision = f.row(record.id).attemptRevision ?? 0;
  await f.api.retryOfflineDownload(record.id);
  await assert.rejects(f.api.cancelOfflineDownload(record.id, revision), /STATE_CHANGED/);
  assert.equal(f.row(record.id).state, "queued");
  assert.equal(f.row(record.id).cancelRequested, false);
});

test("legacy completed prefixes remain completed during rebuild without another admission", async () => {
  const f = fixture(3), record = await f.enqueue();
  f.set({ ...record, state: "failed", error: "EXPIRED_ARTIFACT", conversationCursor: 2 });
  await f.api.retryOfflineDownload(record.id); await f.run();
  assert.deepEqual(f.admissions.map(x => x.body.conversation_id), ["synthetic-3"]);
  assert.equal(f.row(record.id).state, "completed");
});

test("account retirement after a catalog read cannot publish recovery changes", async () => {
  const f = fixture(2), record = await f.enqueue();
  f.set({ ...record, state: "failed", error: "UNAVAILABLE_TARGET" });
  f.changeDuringCatalog(() => f.changeAccount());
  await assert.rejects(f.api.retryOfflineDownloadWithReview(record.id, async () => true), /ACCOUNT_CHANGED/);
  assert.equal(f.row(record.id).state, "failed");
  assert.equal(f.admissions.length, 0);
});

test("navigation abort never counts an uncommitted child as complete; resume keeps the same receipt", async () => {
  const f = fixture(2), record = await f.enqueue(), controller = new AbortController();
  f.failures.set("synthetic-1", { callback: () => { controller.abort(); } });
  await f.run(controller.signal);
  const row = f.row(record.id);
  assert.notEqual(row.state, "completed"); assert.equal(row.conversationCursor, 0);
  assert.deepEqual(f.imports, []);
  const key = f.admissions[0].key;
  f.failures.clear(); await f.run();
  assert.equal(f.row(record.id).state, "completed");
  assert.equal(f.admissions.filter(item => item.key === key).length, 1);
});

test("cleanup remains blocked for a real writer even when another row says paused", () => {
  assert.equal(progress.offlineDownloadBlocksCleanup([{ state: "failed", queuePaused: true }, { state: "writing" }]), true);
  assert.equal(progress.offlineDownloadBlocksCleanup([{ state: "queued" }]), true);
  assert.equal(progress.offlineDownloadBlocksCleanup([{ state: "failed", queuePaused: true }, { state: "queued" }]), false);
});

test("task-center navigation finds the containing batch after its child receipt or asset policy changes", () => {
  const text = readFileSync(new URL("../../apps/web/components/offline-sync-center.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("offline-sync-center.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "matchesTarget");
  const code = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const matches = new Function(code + "\nreturn matchesTarget;")();
  const record = { scope: "all", assetMode: "none", targetConversationIds: ["synthetic-1", "synthetic-2"] };
  assert.equal(matches(record, { scope: "conversation", conversation_id: "synthetic-2", include_assets: "all" }), true);
  assert.equal(matches(record, { scope: "conversation", conversation_id: "synthetic-foreign", include_assets: "all" }), false);
  assert.equal(matches(record, undefined), false);
});
