import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url)), ts = require("typescript");
const compile = file => ts.transpileModule(readFileSync(new URL("../../apps/web/lib/" + file + ".ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture({ status = 200, hungHeaders = false, denied = false, streamChunks } = {}) {
  let generation = 1, body;
  const calls = [], timers = new Map(), failures = [], deadline = {}, api = {};
  new Function("exports", "setTimeout", "clearTimeout", compile("request-deadline"))(deadline,
    (callback, ms) => { timers.set(callback, ms); return callback; }, callback => timers.delete(callback));
  const dependencies = {
    "./offline-access": { authenticationGeneration: () => generation, notifyAuthenticationFailure: value => failures.push(value) },
    "./server-session": { serverSession: () => ({ status: denied ? "sign-in-required" : "ready", userId: "synthetic" }), observeSessionResponse: () => {} },
    "./archive-task-state": {}, "./request-deadline": deadline,
  };
  new Function("require", "exports", "fetch", "window", compile("api"))(name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, api, (url, options) => {
    calls.push({ url, ...options });
    const pending = new Promise(resolve => { body = resolve; });
    return hungHeaders ? pending : Promise.resolve({
      status, ok: status === 200, headers: new Headers(), json: () => pending, text: () => pending,
      body: streamChunks ? new ReadableStream({ start(controller) { for (const chunk of streamChunks) controller.enqueue(chunk); controller.close(); } }) : undefined,
    });
  }, {});
  return { api: api.continuationApi, calls, timers, failures, resolve: value => body(value),
    expire: () => { for (const callback of [...timers.keys()]) callback(); }, switchAccount: () => generation++ };
}
const reads = {
  state: (api, signal) => api.state("synthetic", signal),
  revisions: (api, signal) => api.revisions("synthetic", 0, signal),
  guidance: (api, signal) => api.guidance("synthetic", signal),
  member: (api, signal) => api.member("synthetic", "revisions", "synthetic-revision", "current", signal),
  returnReceipt: (api, signal) => api.returnReceipt("synthetic", "synthetic-key", signal),
};
for (const [name, read] of Object.entries(reads)) {
  for (const hungHeaders of [true, false]) test(`${name}: stalled ${hungHeaders ? "headers" : "body"} has a whole-response bound`, async () => {
    const f = fixture({ hungHeaders }), pending = read(f.api);
    assert.equal(f.timers.size, 1, "Read currently has no finite deadline");
    assert.deepEqual([...f.timers.values()], [20_000]);
    const rejected = assert.rejects(pending, /REQUEST_TIMEOUT/);
    f.expire(); await rejected;
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.timers.size, 0);
  });
  test(`${name}: account replacement fences a late successful body`, async () => {
    const f = fixture(), pending = read(f.api);
    const rejected = assert.rejects(pending, /account|authentication/i);
    f.switchAccount(); f.resolve(name === "member" ? "Synthetic text" : { generation: 0 });
    await rejected;
    assert.equal(f.timers.size, 0);
  });
  test(`${name}: cancellation releases the read and successful retry cleans its timer`, async () => {
    const f = fixture(), controller = new AbortController(), pending = read(f.api, controller.signal);
    const rejected = assert.rejects(pending, /REQUEST_ABORTED/);
    controller.abort(); await rejected;
    assert.equal(f.calls[0].signal.aborted, true);
    const retry = read(f.api); f.resolve(name === "member" ? "Synthetic text" : { generation: 0 });
    await retry;
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].cache, "no-store");
    assert.equal(f.timers.size, 0);
    const before = f.calls.length;
    await assert.rejects(read(f.api, controller.signal), /REQUEST_ABORTED/);
    assert.equal(f.calls.length, before);
  });
}
for (const status of [401, 403]) test(`${status}: an error body cannot keep the panel busy forever`, async () => {
  const f = fixture({ status }), pending = f.api.member("synthetic", "revisions", "synthetic", "current");
  const rejected = assert.rejects(pending, /REQUEST_TIMEOUT/);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.timers.size, 1);
  f.expire(); await rejected;
  assert.deepEqual(f.failures, status === 401 ? [1] : []);
});
test("private member reads respect the paused server session without issuing a request", async () => {
  const f = fixture({ denied: true });
  await assert.rejects(f.api.member("synthetic", "revisions", "synthetic", "current"), error => error.status === 401);
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0);
});
test("uploading file bytes does not inherit a short control-read timeout", async () => {
  for (const name of ["updateFiles", "returnPackage"]) {
    const f = fixture(), pending = f.api[name]("synthetic", new FormData());
    assert.equal(f.timers.size, 0);
    f.resolve({ generation: 1, task_id: "synthetic" }); await pending;
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, name === "updateFiles" ? "PUT" : "POST");
  }
});
test("byte reconciliation preserves BOM/newline bytes and fences account changes", async () => {
  const original = new TextEncoder().encode("\ufeff# Synthetic\r\n"), f = fixture({ streamChunks: [original.slice(0, 4), original.slice(4)] });
  assert.deepEqual(await f.api.memberBytes("synthetic", "synthetic-revision", "current"), original);
  assert.equal(f.calls[0].cache, "no-store"); assert.equal(f.timers.size, 0);
  const pending = f.api.memberBytes("synthetic", "synthetic-revision", "current");
  f.switchAccount();
  await assert.rejects(pending, /account/i); assert.equal(f.timers.size, 0);
});
for (const [member, limit] of [["current", 1], ["index", 8]]) test(`${member} byte reconciliation rejects over-limit responses`, async () => {
  const f = fixture({ streamChunks: [new Uint8Array(limit * 1024 * 1024), new Uint8Array(1)] });
  await assert.rejects(f.api.memberBytes("synthetic", "synthetic-revision", member), /exceeds its limit/);
  assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 1);
});
test("member reconciliation rejects absent response bodies and never treats them as empty content", async () => {
  const f = fixture();
  await assert.rejects(f.api.memberBytes("synthetic", "synthetic-revision", "current"), /body unavailable/);
  assert.equal(f.timers.size, 0);
});
test("package receipt lookup escapes the request key and shares finite read ownership", async () => {
  const f = fixture(), pending = f.api.returnReceipt("synthetic/id", "key?with+punctuation");
  f.resolve({ task: null }); assert.deepEqual(await pending, { task: null });
  assert.equal(f.calls[0].url, "/api/conversations/synthetic%2Fid/continuation/returns/by-request/key%3Fwith%2Bpunctuation");
  assert.equal(f.calls[0].cache, "no-store"); assert.equal(f.timers.size, 0);
});
