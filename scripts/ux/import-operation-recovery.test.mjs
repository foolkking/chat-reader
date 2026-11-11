import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const path = "../../apps/web/lib/api.ts";
const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = ["ApiRequestError", "readAdaptiveOperationResult", "adaptiveOperationResult", "checkAdaptiveFamilyHealth", "previewAdaptiveFamilyMapping"];
const compiled = ts.transpileModule(names.map(name => {
  const node = source.statements.find(item => item.name?.text === name);
  assert.ok(node, `Missing actual declaration ${name}`);
  return node.getText(source);
}).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deadlineSource = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/request-deadline.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture(outcomes, afterRead = () => {}) {
  const calls = [], delays = [], api = {}, deadlines = new Map(), deadline = {};
  let generation = 1;
  new Function("exports", "setTimeout", "clearTimeout", deadlineSource)(deadline,
    (callback, delay) => { deadlines.set(callback, delay); return callback; }, id => deadlines.delete(id));
  new Function("exports", "fetchJson", "authenticationGeneration", "setTimeout", "clearTimeout", "withRequestDeadline", compiled)(
    api, async (...args) => {
      calls.push(args);
      afterRead(calls.length, () => { generation++; });
      assert.ok(outcomes.length, "Unexpected extra request");
      const result = outcomes.shift();
      if (result instanceof Error) throw result;
      return result;
    }, () => generation,
    (callback, delay) => { delays.push(delay); queueMicrotask(callback); return 1; },
    () => {}, deadline.withRequestDeadline,
  );
  return { api, calls, delays, deadlines };
}

test("queued health submits once, waits with background GETs, then returns the original result", async () => {
  const result = { valid: true, groups: [] }, queued = [];
  const f = fixture([{ operation_task_id: "synthetic-job" },
    { job_id: "synthetic-job", status: "queued", phase: "waiting_resources" },
    { job_id: "synthetic-job", status: "committed", result: { operation_result: result } }]);
  assert.equal(await f.api.checkAdaptiveFamilyHealth("import", "family", { onQueued: id => queued.push(id) }), result);
  assert.deepEqual(queued, ["synthetic-job"]);
  assert.equal(f.calls.filter(([, init]) => init.method === "POST").length, 1);
  assert.ok(f.calls.slice(1).every(([url, init]) => url === "/api/tasks/synthetic-job" && init.headers["X-Chat-Reader-Background"] === "1"));
  assert.deepEqual(f.delays, [1500]);
});

test("a retained job resumes with GET, never replays the mapping POST", async () => {
  const result = { validation: { valid: true } };
  const f = fixture([{ job_id: "original-job", status: "committed", result: { operation_result: result } }]);
  assert.equal(await f.api.previewAdaptiveFamilyMapping("import", "family", { profileName: "Synthetic", mappingSpec: {} },
    { taskId: "original-job" }), result);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], "/api/tasks/original-job");
  assert.equal(f.calls[0][1].method, undefined);
});

test("unknown submission is not retried or reported as definite failure", async () => {
  const f = fixture([new Error("CONNECTION_FAILED")]);
  await assert.rejects(f.api.checkAdaptiveFamilyHealth("import", "family"), error => error.code === "IMPORT_OPERATION_UNCONFIRMED");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.delays, []);
});

test("resource exhaustion stops polling without creating a retry mutation", async () => {
  const f = fixture([{ job_id: "original-job", status: "failed", phase: "resource_paused", error_message: "IMPORT_RESOURCE_WAIT_EXPIRED" }]);
  await assert.rejects(f.api.readAdaptiveOperationResult("original-job"), error => error.code === "IMPORT_RESOURCE_WAIT_EXPIRED");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.delays, []);
});

test("account changes suppress results and abort prevents even the first GET", async () => {
  const f = fixture([{ job_id: "synthetic-job", status: "committed", result: { operation_result: { valid: true } } }], (_n, change) => change());
  await assert.rejects(f.api.readAdaptiveOperationResult("synthetic-job"), /Account changed/);
  const controller = new AbortController();
  controller.abort();
  const stopped = fixture([]);
  await assert.rejects(stopped.api.readAdaptiveOperationResult("synthetic-job", { signal: controller.signal }));
  assert.deepEqual(stopped.calls, []);
});

test("legacy immediate results remain compatible", async () => {
  const result = { valid: true, groups: [] }, f = fixture([result]);
  assert.equal(await f.api.checkAdaptiveFamilyHealth("import", "family"), result);
  assert.equal(f.calls.length, 1);
});

test("normal queued progress can exceed twenty seconds: only each GET has a deadline, never the whole job", async () => {
  const result = { valid: true }, states = Array.from({ length: 18 }, () => ({ job_id: "original-job", status: "queued", phase: "waiting_resources" }));
  const f = fixture([...states, { job_id: "original-job", status: "committed", result: { operation_result: result } }]);
  assert.equal(await f.api.readAdaptiveOperationResult("original-job"), result);
  assert.equal(f.calls.length, 19);
  assert.equal(f.delays.reduce((a, b) => a + b, 0), 27_000);
  assert.equal(f.deadlines.size, 0);
  assert.ok(f.calls.every(([, init]) => !init.method));
});

for (const outcome of [null, {}, { job_id: "different-job", status: "queued" },
  { job_id: "original-job", status: "unknown" }, { job_id: "original-job", status: "committed", result: null },
  { job_id: "original-job", status: "committed", result: { operation_result: [] } }]) {
  test(`invalid task response does not poll forever or claim another task's result: ${JSON.stringify(outcome)}`, async () => {
    const f = fixture([outcome]), seen = [];
    await assert.rejects(f.api.readAdaptiveOperationResult("original-job", { onTask: value => seen.push(value) }),
      error => error.code === "IMPORT_OPERATION_UNCONFIRMED");
    assert.equal(f.calls.length, 1);
    assert.equal(f.delays.length, 0);
    assert.equal(f.deadlines.size, 0);
    if (outcome?.status !== "committed") assert.deepEqual(seen, []);
  });
}
