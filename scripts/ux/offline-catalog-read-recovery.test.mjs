import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const filename = "../../apps/web/lib/api.ts";
const source = ts.createSourceFile(filename, readFileSync(new URL(filename, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = name => {
  const found = source.statements.find(node => node.name?.text === name);
  assert.ok(found, `Missing actual declaration ${name}`);
  return found.getText(source);
};
const compiled = ts.transpileModule(
  declaration("ApiRequestError") + "\n" + declaration("getOfflineCatalog"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function fixture(outcomes, onDelay = () => {}, onRead = () => {}) {
  const calls = [], delays = [], exports = {};
  let epoch = 1;
  new Function("exports", "fetchJson", "authenticationGeneration", "setTimeout", compiled)(
    exports,
    async (...args) => {
      calls.push(args); onRead(calls.length, () => { epoch += 1; });
      const value = outcomes.shift();
      if (value instanceof Error) throw value;
      return value;
    },
    () => epoch,
    (callback, delay) => { delays.push(delay); onDelay(() => { epoch += 1; }); callback(); },
  );
  return { api: exports, calls, delays };
}

test("transient catalog proxy errors get one bounded read retry, never a mutation", async () => {
  for (const status of [500, 502, 503, 504]) {
    const outcomes = [], f = fixture(outcomes), result = { revision: "synthetic", conversations: [] };
    outcomes.push(new f.api.ApiRequestError("synthetic proxy failure", status, "/api/offline/catalog"), result);
    assert.equal(await f.api.getOfflineCatalog(), result);
    assert.deepEqual(f.calls, [["/api/offline/catalog"], ["/api/offline/catalog"]]);
    assert.deepEqual(f.delays, [250]);
  }
});

test("a network disconnect retries once and a repeated failure is still visible", async () => {
  const failure = new Error("CONNECTION_FAILED"), f = fixture([failure, failure]);
  await assert.rejects(f.api.getOfflineCatalog(), error => error === failure);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.delays, [250]);
});

test("authorization, missing scope, validation and unknown failures are not retried", async () => {
  for (const status of [401, 403, 404, 409, 422, 429]) {
    const outcomes = [], f = fixture(outcomes), failure = new f.api.ApiRequestError("synthetic rejection", status, "/api/offline/catalog");
    outcomes.push(failure);
    await assert.rejects(f.api.getOfflineCatalog(), error => error === failure);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.delays, []);
  }
  const failure = new SyntaxError("synthetic malformed response"), f = fixture([failure]);
  await assert.rejects(f.api.getOfflineCatalog(), error => error === failure);
  assert.equal(f.calls.length, 1);
});

test("account changes before or during the delay prevent a retry under a different account", async () => {
  for (const at of ["read", "delay"]) {
    const failure = new Error("CONNECTION_FAILED");
    const f = fixture([failure], at === "delay" ? change => change() : undefined,
      at === "read" ? (_count, change) => change() : undefined);
    await assert.rejects(f.api.getOfflineCatalog(), error => error === failure);
    assert.equal(f.calls.length, 1);
  }
});

test("a successful response from a retired account is not published", async () => {
  const f = fixture([{ conversations: [] }], undefined, (_count, change) => change());
  await assert.rejects(f.api.getOfflineCatalog(), /Account changed/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.delays, []);
});
