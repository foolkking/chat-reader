import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compile = path => ts.transpileModule(readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = { turn_key: "synthetic-turn", start_offset: 0, total_messages: 1,
  previous_anchor_message_id: null, next_anchor_message_id: null,
  items: [{ id: "synthetic-message", render_blocks: [] }] };

// Real source module and request-deadline implementation; only transport,
// authentication epoch and asynchronous timers are synthetic controls.
function fixture({ realApi = false, hungLocator = false } = {}) {
  let generation = 1;
  const reads = [], locators = [], timers = new Set();
  const deadline = { exports: {} };
  new Function("exports", "setTimeout", "clearTimeout", compile("lib/request-deadline.ts"))(
    deadline.exports, callback => { timers.add(callback); return callback; }, callback => timers.delete(callback));
  const pending = [], locatorPending = [];
  let api = new Proxy({
    getConversationReaderTurn: (conversation, anchor, signal) => {
      const request = deferred(); pending.push(request); reads.push({ conversation, anchor, signal }); return request.promise;
    },
    resolveConversationLocator: async (conversation, locator, signal) => {
      locators.push({ ...locator, signal });
      if (hungLocator) { const request = deferred(); locatorPending.push(request); return request.promise; }
      return { message_id: "synthetic-message", block_index: locator.block_index };
    },
    getConversationDialogueIndex: async () => ({ items: [], total: 1 }),
    getConversationToc: async () => ({ items: [] }),
  }, { get: (target, key) => target[key] ?? (async () => ({})) });
  if (realApi) {
    const actual = { exports: {} };
    const mocks = {
      "./offline-access": { authenticationGeneration: () => generation, notifyAuthenticationFailure: () => {} },
      "./server-session": { serverSession: () => ({ status: "ready", userId: "synthetic" }), observeSessionResponse: () => {} },
      "./archive-task-state": {}, "./request-deadline": deadline.exports,
    };
    const fetch = async (url, options) => {
      const body = deferred(); pending.push(body); reads.push({ url, ...options });
      return { ok: true, status: 200, headers: new Headers(), json: () => body.promise };
    };
    new Function("require", "exports", "fetch", compile("lib/api.ts"))(name => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected API dependency: ${name}`); return mocks[name];
    }, actual.exports, fetch);
    api = actual.exports;
  }
  const mocks = { "./api": api, "./request-deadline": deadline.exports,
    "./offline-access": { authenticationGeneration: () => generation },
    "./reading-position-sync": {}, "./offline-db": {}, "./offline-search": {},
    "../features/conversations/thinking-summary": {}, "./search-text-matches": {} };
  const module = { exports: {} };
  new Function("require", "exports", compile("lib/reader-data-source.ts"))(name => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module.exports);
  return { source: module.exports.remoteReaderDataSource, reads, pending, locators, locatorPending, timers,
    changeAccount: () => generation++, expire: () => { for (const timer of [...timers]) timer(); } };
}

test("a hung complete-turn read has a finite deadline and releases its deduplication slot", async () => {
  const f = fixture(), first = f.source.getReaderTurn("synthetic-conversation");
  const rejected = assert.rejects(first, /REQUEST_TIMEOUT/);
  assert.equal(f.source.getReaderTurn("synthetic-conversation"), first);
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.size, 1, "Reader currently has no finite network/body deadline");
  f.expire();
  await rejected;
  assert.equal(f.reads[0].signal.aborted, true);
  const retried = f.source.getReaderTurn("synthetic-conversation");
  assert.equal(f.reads.length, 2);
  f.pending[1].resolve(turn);
  assert.equal(await retried, turn);
  assert.equal(f.timers.size, 0);
  f.pending[0].resolve({ ...turn, turn_key: "retired" });
  assert.equal(await retried, turn);
});

test("a new authentication generation never adopts an old in-flight turn", async () => {
  const f = fixture(), first = f.source.getReaderTurn("synthetic-conversation");
  f.changeAccount();
  const next = f.source.getReaderTurn("synthetic-conversation");
  assert.notEqual(next, first, "Account switch reused the previous account's read");
  const rejected = assert.rejects(first, /retired|account|authentication/i);
  f.pending[0].resolve(turn);
  await rejected;
  f.pending[1].resolve({ ...turn, turn_key: "current" });
  assert.equal((await next).turn_key, "current");
});

test("different locator ranges and navigation pipelines must not share target projections", async () => {
  const f = fixture();
  const first = f.source.getTargetContext("synthetic-conversation", { messageId: "synthetic-message", blockIndex: 1 });
  const next = f.source.getTargetContext("synthetic-conversation", { messageId: "synthetic-message", blockIndex: 2, preferTocPipeline: true }, { includeNavigation: true });
  assert.notEqual(first, next);
  const third = f.source.getTargetContext("synthetic-conversation", { messageId: "synthetic-message", blockIndex: 3 });
  assert.notEqual(first, third, "Different block indexes collapsed into one target");
  assert.equal(f.reads.length, 1, "Distinct targets should still share their complete-turn read");
  f.pending[0].resolve(turn);
  const results = await Promise.all([first, next, third]);
  assert.deepEqual(results.map(result => result.resolvedLocator.block_index), [1, 2, 3]);
});

test("a stalled JSON body in the actual API releases the Reader read and permits explicit retry", async () => {
  const f = fixture({ realApi: true });
  const first = f.source.getReaderTurn("synthetic-conversation", "synthetic-message");
  const rejected = assert.rejects(first, /REQUEST_TIMEOUT/);
  await Promise.resolve();
  assert.match(f.reads[0].url, /reader-turn\?anchor_message_id=synthetic-message$/);
  assert.equal(f.reads[0].cache, "no-store");
  f.expire(); await rejected;
  assert.equal(f.reads[0].signal.aborted, true);
  const next = f.source.getReaderTurn("synthetic-conversation", "synthetic-message");
  f.pending[1].resolve(turn);
  assert.equal(await next, turn);
  f.pending[0].resolve({ ...turn, turn_key: "late-body" });
  assert.equal(await next, turn);
});

test("stalled auxiliary locator cannot hold target navigation or its deduplication slot forever", async () => {
  const f = fixture({ hungLocator: true }), target = { messageId: "synthetic-message" };
  const first = f.source.getTargetContext("synthetic-conversation", target);
  assert.equal(first, f.source.getTargetContext("synthetic-conversation", target));
  const rejected = assert.rejects(first, /REQUEST_TIMEOUT/);
  f.pending[0].resolve(turn);
  for (let index = 0; index < 8; index++) await Promise.resolve();
  assert.equal(f.timers.size, 1);
  f.expire(); await rejected;
  assert.equal(f.locators[0].signal.aborted, true);
  const next = f.source.getTargetContext("synthetic-conversation", target);
  assert.notEqual(next, first);
  f.pending[1].resolve(turn);
  f.locatorPending[1].resolve({ message_id: "synthetic-message" });
  assert.equal((await next).targetMessage.id, "synthetic-message");
  f.locatorPending[0].resolve({ message_id: "retired-message" });
});

test("all semantic locator fields and TOC pipeline participate in target deduplication", async () => {
  const f = fixture(), target = { messageId: "synthetic-message" };
  const variants = [target, ...["blockIndex", "attachmentId", "quote", "prefix", "suffix", "preferTocPipeline"].map(
    field => ({ ...target, [field]: field === "blockIndex" ? 1 : field === "preferTocPipeline" ? true : "synthetic" }))];
  const reads = variants.map(value => f.source.getTargetContext("synthetic-conversation", value, { includeNavigation: true }));
  assert.equal(new Set(reads).size, variants.length);
  assert.equal(f.reads.length, 1);
  f.pending[0].resolve(turn);
  await Promise.all(reads);
  assert.equal(f.timers.size, 0);
});
