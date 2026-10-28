import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const url = new URL("../../apps/web/lib/offline-search.ts", import.meta.url);
const source = readFileSync(url, "utf8").replaceAll("import.meta.url", JSON.stringify(url.href));
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const document = { id: "synthetic-search-document", plain_text: "Synthetic searchable text" };
const unit = (name, body) => test(name, { timeout: 1500 }, body);

// Actual compiled bridge. Worker transport, clock, UUIDs and access generation
// are explicit adapters; no real Worker, FlexSearch, IndexedDB or browser runs.
function fixture() {
  const workers = [], posts = [], waiters = [], timers = new Map();
  let generation = 1, requestId = 0, timerId = 0, throwPost = false;
  class Worker {
    constructor() { this.listeners = new Map(); this.terminated = false; workers.push(this); }
    addEventListener(type, callback) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(callback); this.listeners.set(type, listeners);
    }
    postMessage(message) {
      if (throwPost) { throwPost = false; throw Error("Synthetic post failure"); }
      const post = { worker: this, message, claimed: false };
      posts.push(post);
      const index = waiters.findIndex(waiter => waiter.type === message.type);
      if (index >= 0) { post.claimed = true; waiters.splice(index, 1)[0].resolve(post); }
    }
    terminate() { this.terminated = true; }
    emit(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  }
  const exports = {};
  new Function("require", "exports", "Worker", "crypto", "setTimeout", "clearTimeout", compiled)(name => {
    assert.equal(name, "./offline-access");
    return { captureOfflineAccess: () => generation, assertOfflineAccess: captured => {
      if (captured !== generation) throw Error("Synthetic retired access");
    } };
  }, exports, Worker, { randomUUID: () => `synthetic-request-${++requestId}` },
  (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  id => timers.delete(id));
  const next = type => {
    const post = posts.find(entry => entry.message.type === type && !entry.claimed);
    if (post) { post.claimed = true; return Promise.resolve(post); }
    return new Promise(resolve => waiters.push({ type, resolve }));
  };
  const reply = (post, body = {}) => post.worker.emit("message", {
    data: { requestId: post.message.requestId, items: [], ...body },
  });
  return {
    ...exports, workers, posts, timers, next, reply,
    async initialize(documents = [document]) {
      const initializing = exports.initializeOfflineSearch(documents);
      reply(await next("init")); await initializing;
    },
    bumpAccess: () => { generation++; },
    failNextPost: () => { throwPost = true; },
    dispose: () => exports.resetOfflineSearch(),
  };
}

unit("nonblank search without initialization rejects without creating an empty Worker", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.searchOffline("synthetic"), /unavailable/);
    assert.equal(f.workers.length, 0);
  } finally { f.dispose(); }
});
unit("blank queries remain empty without an index or Worker", async () => {
  const f = fixture();
  try { assert.deepEqual(await f.searchOffline("  "), []); assert.equal(f.workers.length, 0); }
  finally { f.dispose(); }
});
unit("a runtime-only Worker does not authorize a successful empty search", async () => {
  const f = fixture();
  try {
    const runtime = f.getOfflineSearchRuntime();
    f.reply(await f.next("runtime"), { runtime: { workerUrl: "synthetic-worker.js", assets: ["synthetic-worker.js"] } });
    await runtime;
    await assert.rejects(f.searchOffline("synthetic"), /unavailable/);
    assert.equal(f.posts.length, 1);
  } finally { f.dispose(); }
});
unit("search waits for an already-started initialization before dispatching", async () => {
  const f = fixture();
  try {
    const initializing = f.initializeOfflineSearch([document]), searching = f.searchOffline("synthetic");
    assert.deepEqual(f.posts.map(post => post.message.type), ["init"]);
    f.reply(await f.next("init")); await initializing;
    f.reply(await f.next("search"), { items: [document] });
    assert.deepEqual(await searching, [document]);
  } finally { f.dispose(); }
});
unit("a legitimately initialized empty corpus may return no matches", async () => {
  const f = fixture();
  try {
    await f.initialize([]);
    const searching = f.searchOffline("synthetic");
    f.reply(await f.next("search"));
    assert.deepEqual(await searching, []);
  } finally { f.dispose(); }
});
for (const event of ["error", "messageerror"]) {
  unit(`${event}: idle failure cannot become false emptiness; explicit rebuild recovers`, async () => {
    const f = fixture();
    try {
      await f.initialize(); f.workers[0].emit(event);
      await assert.rejects(f.searchOffline("synthetic"), /unavailable/);
      assert.equal(f.workers.length, 1);
      assert.equal(f.workers[0].terminated, true);
      await f.initialize();
      const searching = f.searchOffline("synthetic");
      f.reply(await f.next("search"), { items: [document] });
      assert.deepEqual(await searching, [document]);
      assert.equal(f.workers.length, 2);
    } finally { f.dispose(); }
  });
}
unit("the existing ten-second deadline retires readiness and clears pending timers", async () => {
  const f = fixture();
  try {
    await f.initialize();
    const searching = f.searchOffline("synthetic");
    await f.next("search");
    const failed = assert.rejects(searching, /unavailable/);
    const timer = [...f.timers.values()][0];
    assert.equal(timer.delay, 10_000); timer.callback(); await failed;
    assert.equal(f.timers.size, 0);
    await assert.rejects(f.searchOffline("synthetic"), /unavailable/);
    assert.equal(f.workers.length, 1);
  } finally { f.dispose(); }
});
unit("synchronous init post failure leaves no usable readiness record", async () => {
  const f = fixture();
  try {
    f.failNextPost();
    await assert.rejects(f.initializeOfflineSearch([document]), /unavailable/);
    await assert.rejects(f.searchOffline("synthetic"), /unavailable/);
    assert.equal(f.workers.length, 1);
    assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});
unit("a new initialization fences an older in-flight search reply", async () => {
  const f = fixture();
  try {
    await f.initialize();
    const searching = f.searchOffline("synthetic"), post = await f.next("search");
    const failed = assert.rejects(searching, /unavailable/);
    const replacement = f.initializeOfflineSearch([]);
    f.reply(post, { items: [document] }); await failed;
    f.reply(await f.next("init")); await replacement;
    const fresh = f.searchOffline("synthetic"); f.reply(await f.next("search"));
    assert.deepEqual(await fresh, []);
  } finally { f.dispose(); }
});
unit("access generation remains bound to the indexed corpus, not only the next query", async () => {
  const f = fixture();
  try {
    await f.initialize(); f.bumpAccess();
    await assert.rejects(f.searchOffline("synthetic"), /retired access/);
    assert.deepEqual(f.posts.map(post => post.message.type), ["init"]);
  } finally { f.dispose(); }
});
unit("reset retires initialization and searches awaiting that initialization", async () => {
  const f = fixture();
  try {
    const initializing = f.initializeOfflineSearch([document]), searching = f.searchOffline("synthetic");
    const failures = [assert.rejects(initializing, /unavailable/), assert.rejects(searching, /unavailable/)];
    f.resetOfflineSearch(); await Promise.all(failures);
    assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});

unit("scope and content field selection reach the existing worker without overfetching", async () => {
  const f = fixture();
  try {
    await f.initialize();
    const scope = { conversationId: "synthetic-conversation", documentType: "message", role: "assistant", contentOnly: true };
    const searching = f.searchOffline("synthetic", 3, scope);
    const post = await f.next("search");
    assert.equal(post.message.limit, 3);
    assert.deepEqual(post.message.scope, scope);
    f.reply(post, { items: [document] });
    assert.deepEqual(await searching, [document]);
  } finally { f.dispose(); }
});
