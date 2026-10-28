import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/annotation-comment-drafts.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const draft = text => ({ base: { id: "synthetic-annotation", conversation_id: "synthetic-a", comment_markdown: "base", revision: 1 }, text, status: "error" });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// Actual persistence helper; account/access, serialized transactions and the
// settings table are adapters. This is not an IndexedDB or browser acceptance.
function fixture() {
  const db = () => {
    const rows = new Map();
    let queue = Promise.resolve(), gate, failDelete = false;
    const settings = {
      get: async key => { if (gate) await gate.promise; return structuredClone(rows.get(key)); },
      put: async row => { rows.set(row.key, structuredClone(row)); },
      delete: async key => { if (failDelete) throw Error("Synthetic storage unavailable"); rows.delete(key); },
      where: () => ({ startsWith: prefix => {
        let predicate = () => true;
        const query = { filter: fn => { predicate = fn; return query; },
          toArray: async () => [...rows.values()].filter(row => row.key.startsWith(prefix) && predicate(row)).map(row => structuredClone(row)) };
        return query;
      } }),
    };
    return { rows, settings, hold(value) { gate = value; }, failDelete(value) { failDelete = value; },
      transaction: (_mode, _table, fn) => { const work = queue.then(fn); queue = work.catch(() => {}); return work; } };
  };
  const accounts = [db(), db()];
  let account = 0, generation = 1, allowed = true;
  const modules = new Map();
  const load = (tab = "synthetic-tab") => {
    if (modules.has(tab)) return modules.get(tab);
    const exports = {}, session = new Map([["chat-reader:comment-draft-tab", tab]]);
    new Function("require", "exports", "sessionStorage", compiled)(name => {
      if (name === "./offline-db") return { get offlineDb() { return accounts[account]; } };
      assert.equal(name, "./offline-access");
      return { captureOfflineAccess: () => { if (!allowed) throw Error("locked"); return generation; },
        assertOfflineAccess: value => { if (!allowed || value !== generation) throw Error("retired"); } };
    }, exports, { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value) });
    modules.set(tab, exports); return exports;
  };
  return { load, accounts, switchAccount() { account = 1 - account; generation++; }, lock() { allowed = false; generation++; } };
}

test("comment drafts recover in their conversation/mode/tab and cannot cross account storage", async () => {
  const f = fixture(), api = f.load();
  await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 0, draft("recover me"), "remote");
  assert.equal((await api.readAnnotationCommentDrafts("synthetic-a", "remote"))[0].text, "recover me");
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-b", "remote"), []);
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-a", "offline"), []);
  assert.deepEqual(await f.load("synthetic-other-tab").readAnnotationCommentDrafts("synthetic-a", "remote"), []);
  f.switchAccount();
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-a", "remote"), []);
  f.switchAccount();
  assert.equal((await api.readAnnotationCommentDrafts("synthetic-a", "remote"))[0].base.comment_markdown, "base");
  f.lock();
  await assert.rejects(api.readAnnotationCommentDrafts("synthetic-a", "remote"), /locked|retired/);
});

test("a late save/discard version cannot clear newer comment typing", async () => {
  const api = fixture().load();
  assert.equal(await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 0, draft("old"), "remote"), 1);
  assert.equal(await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 1, draft("new"), "remote"), 2);
  await assert.rejects(api.removeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 1, "remote"), /changed/);
  await assert.rejects(api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 1, draft("stale"), "remote"), /changed/);
  assert.equal((await api.readAnnotationCommentDrafts("synthetic-a", "remote"))[0].text, "new");
  await api.removeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 2, "remote");
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-a", "remote"), []);
});

test("retiring access while a transaction awaits the current version prevents its write", async () => {
  const f = fixture(), api = f.load(), waiting = deferred();
  f.accounts[0].hold(waiting);
  const write = api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 0, draft("private"), "remote");
  await setImmediate(); f.switchAccount(); waiting.resolve();
  await assert.rejects(write, /retired/);
  assert.equal(f.accounts[0].rows.size, 0);
  assert.equal(f.accounts[1].rows.size, 0);
});

test("rapid return waits for all coalesced writes from the previous visit", async () => {
  const f = fixture(), api = f.load(), waiting = deferred(), storage = api.captureCommentDraftStorage();
  const task = (async () => {
    await waiting.promise;
    await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 0, draft("first"), "remote", storage);
    await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 1, draft("latest"), "remote", storage);
  })();
  api.trackCommentDraftPersistence("synthetic-a", "remote", storage, task);
  let complete = false;
  const returning = api.readAnnotationCommentDrafts("synthetic-a", "remote").then(rows => { complete = true; return rows; });
  await setImmediate(); assert.equal(complete, false);
  waiting.resolve(); await task;
  assert.equal((await returning)[0].text, "latest");
});

test("failed discard is retried before hydration and keeps its original version across a return", async () => {
  const f = fixture(), api = f.load();
  await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 0, draft("discard me"), "remote");
  f.accounts[0].failDelete(true);
  await assert.rejects(api.removeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 1, "remote"), /unavailable/);
  await assert.rejects(api.readAnnotationCommentDrafts("synthetic-a", "remote"), /unavailable/);
  // The intent cannot leak into another conversation, mode, tab or account.
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-b", "remote"), []);
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-a", "offline"), []);
  assert.deepEqual(await f.load("synthetic-other-tab").readAnnotationCommentDrafts("synthetic-a", "remote"), []);
  f.switchAccount();
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-a", "remote"), []);
  f.switchAccount(); f.accounts[0].failDelete(false);
  assert.deepEqual(await api.readAnnotationCommentDrafts("synthetic-a", "remote"), []);
  assert.equal(f.accounts[0].rows.size, 0);
});

test("successful newer typing supersedes a failed discard without being removed by the retry", async () => {
  const f = fixture(), api = f.load();
  await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 0, draft("old"), "remote");
  f.accounts[0].failDelete(true);
  await assert.rejects(api.removeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 1, "remote"), /unavailable/);
  await api.writeAnnotationCommentDraft("synthetic-a", "synthetic-annotation", 1, draft("new typing"), "remote");
  f.accounts[0].failDelete(false);
  const recovered = await api.readAnnotationCommentDrafts("synthetic-a", "remote");
  assert.equal(recovered[0].version, 2);
  assert.equal(recovered[0].text, "new typing");
});
