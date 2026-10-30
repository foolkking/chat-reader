import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/e2e/settings-offline-helper.ts", import.meta.url), "utf8");
const module = { exports: {} };
new Function("exports", ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText)(module.exports);

function inspection(opened, options = {}) {
  const userId = "synthetic-user";
  const name = `chat-reader-offline-library--user-${Buffer.from(userId).toString("hex")}`;
  const counters = { opened: 0, aborted: 0, closed: 0 };
  const request = { transaction: { abort: () => counters.aborted++ } };
  const page = { evaluate: (callback, argument) => runInNewContext(`(${callback.toString()})(argument)`, {
    argument, TextEncoder, setTimeout, clearTimeout,
    localStorage: { getItem: () => null },
    indexedDB: {
      databases: async () => options.absent ? [] : [{ name }],
      open: () => {
        counters.opened++;
        queueMicrotask(() => opened(request, counters));
        return request;
      },
    },
  }) };
  return { result: module.exports.readLocal(page, userId), counters, request };
}

test("local inspection never opens or creates an absent database", async () => {
  const f = inspection(() => assert.fail("absent database was opened"), { absent: true });
  assert.deepEqual(JSON.parse(JSON.stringify(await f.result)), { conversations: [], notebooks: [], outbox: [], settings: [] });
  assert.equal(f.counters.opened, 0);
});

test("a database deleted between listing and opening is not recreated by inspection", async () => {
  const f = inspection(request => request.onupgradeneeded());
  await assert.rejects(f.result, /disappeared during local-data inspection/);
  assert.equal(f.counters.aborted, 1);
});

test("blocked inspection rejects and closes a connection that arrives after rejection", async () => {
  const f = inspection((request, counters) => {
    request.onblocked();
    request.result = { close: () => counters.closed++ };
    request.onsuccess();
  });
  await assert.rejects(f.result, /blocked by a pending database operation/);
  assert.equal(f.counters.closed, 1);
});

test("missing stores reject the inspection and close the database instead of hanging", async () => {
  const f = inspection((request, counters) => {
    request.result = {
      close: () => counters.closed++,
      transaction: () => { throw new Error("Synthetic missing object store"); },
    };
    request.onsuccess();
  });
  await assert.rejects(f.result, /Synthetic missing object store/);
  assert.equal(f.counters.closed, 1);
});

for (const outcome of ["complete", "abort", "error"]) test(`inspection settles and releases its connection on transaction ${outcome}`, async () => {
  const f = inspection((request, counters) => {
    const tx = { objectStore: () => ({ getAll: () => ({ result: [] }) }) };
    request.result = { close: () => counters.closed++, transaction: () => tx };
    request.onsuccess();
    queueMicrotask(() => tx[`on${outcome}`]());
  });
  if (outcome === "complete") assert.equal((await f.result).conversations.length, 0);
  else await assert.rejects(f.result, /transaction (was aborted|failed)/);
  assert.equal(f.counters.closed, 1);
});
