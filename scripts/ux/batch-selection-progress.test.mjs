import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const module = { exports: {} };
new Function("module", "exports", ts.transpileModule(
  readFileSync(new URL("../../apps/web/lib/batch-selection.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText)(module, module.exports);
const { runBatchSelection } = module.exports;
const httpError = (status) => Object.assign(new Error("Synthetic HTTP response"), { name: "ApiRequestError", status });

test("batch outcomes separate definite rejection from committed-but-unacknowledged possibilities", async () => {
  const outcomes = { accepted: null, rejected: httpError(422), forbidden: httpError(403),
    timeout: httpError(408), unavailable: httpError(503), disconnected: new Error("Synthetic lost response") };
  const result = await runBatchSelection(Object.keys(outcomes), async id => {
    if (outcomes[id]) throw outcomes[id];
  });
  assert.deepEqual(result.succeededIds, ["accepted"]);
  assert.deepEqual(new Set(result.failedIds), new Set(["rejected", "forbidden"]));
  assert.deepEqual(new Set(result.unconfirmedIds), new Set(["timeout", "unavailable", "disconnected"]));
  assert.deepEqual(result.notStartedIds, []);
});

test("stop prevents new dispatches but does not abort four already in-flight writes", async () => {
  const controller = new AbortController(), started = [], progress = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const ids = Array.from({ length: 12 }, (_, index) => `synthetic-${index}`);
  const pending = runBatchSelection(ids, async id => {
    started.push(id);
    await held;
  }, 4, { signal: controller.signal, onProgress: value => progress.push(value) });
  await setImmediate();
  assert.equal(started.length, 4);
  controller.abort();
  assert.equal(progress.at(-1).stopped, true);
  assert.equal(progress.at(-1).inFlight, 4, "stop acknowledgement must not pretend accepted requests disappeared");
  assert.equal(progress.at(-1).notStarted, 8);
  release();
  const result = await pending;
  assert.equal(started.length, 4);
  assert.deepEqual(new Set(result.succeededIds), new Set(ids.slice(0, 4)));
  assert.deepEqual(result.notStartedIds, ids.slice(4));
  for (const value of progress) {
    assert.equal(value.succeeded + value.failed + value.unconfirmed + value.inFlight + value.notStarted, ids.length);
    assert.ok(value.inFlight <= 4);
  }
});

test("a stopped-before-start batch leaves every item unstarted and sends nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  let writes = 0;
  const result = await runBatchSelection(["synthetic-one"], async () => { writes++; }, 4, { signal: controller.signal });
  assert.equal(writes, 0);
  assert.deepEqual(result, { succeededIds: [], failedIds: [], unconfirmedIds: [], notStartedIds: ["synthetic-one"] });
});
