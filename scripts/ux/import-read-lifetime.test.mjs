import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url)), ts = require("typescript");
const compile = file => ts.transpileModule(readFileSync(new URL(`../../apps/web/lib/${file}.ts`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const compiledApi = compile("api"), compiledDeadline = compile("request-deadline");
function fixture({ status = 200, hungHeaders = false } = {}) {
  let generation = 1, resolve;
  const calls = [], timers = new Map(), failures = [], deadline = {}, api = {};
  new Function("exports", "setTimeout", "clearTimeout", compiledDeadline)(deadline,
    (fn, ms) => { timers.set(fn, ms); return fn; }, fn => timers.delete(fn));
  const dependencies = {
    "./offline-access": { authenticationGeneration: () => generation, notifyAuthenticationFailure: g => failures.push(g) },
    "./server-session": { serverSession: () => ({ status: "ready", userId: "synthetic-owner" }), observeSessionResponse() {} },
    "./archive-task-state": {}, "./request-deadline": deadline, "./upload-transport": {},
  };
  new Function("exports", "require", "fetch", "window", compiledApi)(api,
    name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
    (url, init) => {
      calls.push({ url, ...init });
      const body = new Promise(done => { resolve = done; });
      return hungHeaders ? body : Promise.resolve({
        status, ok: status === 200, headers: new Headers(), json: () => body, text: () => body,
      });
    }, {});
  return { api, calls, timers, failures, resolve: value => resolve(value), switchAccount: () => generation++,
    expire: () => { for (const fn of [...timers.keys()]) fn(); } };
}
const reads = {
  catalog: (api, signal) => api.getAdaptiveImportArchive("synthetic-import", "synthetic-source", 500, 500, signal),
  operation: (api, signal) => api.readAdaptiveOperationResult("synthetic-task", { signal }),
};
const result = (name, taskId = "synthetic-task") => name === "catalog" ? { offset: 500, limit: 500, members: [], classification_version: 2 }
  : { job_id: taskId, status: "committed", result: { operation_result: { valid: true, groups: [] } } };
for (const [name, read] of Object.entries(reads)) {
  for (const hungHeaders of [true, false]) test(`${name}: hung ${hungHeaders ? "headers" : "body"} has a complete-response deadline`, async () => {
    const f = fixture({ hungHeaders }), pending = read(f.api);
    assert.deepEqual([...f.timers.values()], [20_000]);
    const rejected = assert.rejects(pending, /REQUEST_TIMEOUT/);
    f.expire(); await rejected;
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.timers.size, 0);
    f.resolve(result(name)); // Non-cooperative late reads cannot publish a result.
    assert.equal(f.calls.length, 1);
  });
  test(`${name}: account changes reject late successful data`, async () => {
    const f = fixture(), pending = read(f.api);
    const rejected = assert.rejects(pending, /Account changed/);
    f.switchAccount(); f.resolve(result(name)); await rejected;
    assert.equal(f.timers.size, 0);
  });
  test(`${name}: caller abort retires the read and a successful explicit read clears its deadline`, async () => {
    const f = fixture(), controller = new AbortController(), pending = read(f.api, controller.signal);
    const rejected = assert.rejects(pending, /REQUEST_ABORTED/);
    controller.abort(); await rejected;
    assert.equal(f.calls[0].signal.aborted, true);
    const retried = read(f.api);
    f.resolve(result(name)); await retried;
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 0);
    await assert.rejects(read(f.api, controller.signal), error => error.message === "REQUEST_ABORTED" || error.name === "AbortError");
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(call => call.cache === "no-store" && !call.method));
  });
  for (const status of [401, 403, 503]) test(`${name}: stalled ${status} error body cannot keep the panel busy forever`, async () => {
    const f = fixture({ status }), pending = read(f.api);
    const rejected = assert.rejects(pending, /REQUEST_TIMEOUT/);
    await Promise.resolve(); await Promise.resolve();
    f.expire(); await rejected;
    assert.deepEqual(f.failures, status === 401 ? [1] : []);
    assert.equal(f.timers.size, 0);
  });
}
test("a timed-out known-task health read resumes the same task using GET only", async () => {
  const f = fixture(), queued = [], options = { taskId: "synthetic-original-task", onQueued: id => queued.push(id) };
  const pending = f.api.checkAdaptiveFamilyHealth("synthetic-import", "synthetic-family", options);
  const rejected = assert.rejects(pending, /REQUEST_TIMEOUT/);
  f.expire(); await rejected;
  const retry = f.api.checkAdaptiveFamilyHealth("synthetic-import", "synthetic-family", options);
  f.resolve(result("operation", "synthetic-original-task")); await retry;
  assert.deepEqual(queued, ["synthetic-original-task", "synthetic-original-task"]);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.url === "/api/tasks/synthetic-original-task" && !call.method));
  assert.equal(f.timers.size, 0);
});
test("catalog read preserves paging parameters, and unrelated writes are not assigned a twenty-second upload deadline", async () => {
  const f = fixture(), read = reads.catalog(f.api);
  assert.match(f.calls[0].url, /archives\/synthetic-source\?offset=500&limit=500$/);
  f.resolve(result("catalog")); await read;
  const writing = f.api.replaceAdaptiveImportArtifact("synthetic-import", "synthetic-source", new File(["synthetic"], "sample.md"));
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls[1].method, "PUT");
  f.resolve({ state: "ANALYZING" }); await writing;
});
test("a missing known task is not reported as a missing import or offered for resubmission", async () => {
  const f = fixture({ status: 404 }), pending = f.api.readAdaptiveOperationResult("synthetic-task");
  f.resolve({ detail: "Task not found" });
  await assert.rejects(pending, error => error.code === "IMPORT_OPERATION_UNCONFIRMED");
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});
