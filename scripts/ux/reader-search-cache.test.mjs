import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript"), { QueryClient, QueryObserver } = require("@tanstack/react-query");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/reader-search-cache.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const key = (source = "remote:1:v7", id = "synthetic-a") => ["conversation-search", source, id, "needle", "message", "all"];

test("content reset clears closed-panel pages but preserves other conversations and modes", async () => {
  const api = {}, events = [], client = new QueryClient();
  new Function("exports", "window", compiled)(api, { dispatchEvent: event => { events.push(event.detail); } });
  try {
    for (const queryKey of [key(), key("remote:1:v7", "synthetic-b"), key("offline:1:v7")])
      client.setQueryData(queryKey, { pages: [{ items: ["synthetic-old-result"] }], pageParams: [0] });
    api.invalidateReaderSearch(client, { mode: "remote", conversationId: "synthetic-a" });
    await setImmediate();
    assert.equal(client.getQueryData(key()), undefined);
    assert.ok(client.getQueryData(key("remote:1:v7", "synthetic-b")));
    assert.ok(client.getQueryData(key("offline:1:v7")));
    assert.deepEqual(events, [{ mode: "remote", conversationId: "synthetic-a" }]);
  } finally { client.clear(); }
});

test("an aborted old query cannot republish after the matching active query resets", async () => {
  const api = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  new Function("exports", "window", compiled)(api, { dispatchEvent() {} });
  let resolveOld, reads = 0, oldSignal;
  const observer = new QueryObserver(client, {
    queryKey: key(),
    queryFn: ({ signal }) => ++reads === 1
      ? new Promise(resolve => { oldSignal = signal; resolveOld = resolve; })
      : Promise.resolve("synthetic-new-result"),
  });
  const stop = observer.subscribe(() => {});
  try {
    const old = observer.refetch();
    await setImmediate();
    api.invalidateReaderSearch(client, { mode: "remote", conversationId: "synthetic-a" });
    assert.equal(oldSignal.aborted, true);
    await observer.refetch();
    resolveOld("synthetic-stale-result"); await old; await setImmediate();
    assert.equal(client.getQueryData(key()), "synthetic-new-result");
  } finally { stop(); observer.destroy(); client.clear(); }
});
