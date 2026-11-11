import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const output = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/request-deadline.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture() {
  const timers = new Map(), cleared = [];
  const exports = {};
  new Function("exports", "setTimeout", "clearTimeout", output)(exports,
    (fn, ms) => { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; },
    id => { cleared.push(id); });
  return { run: exports.withRequestDeadline, timers, cleared };
}
test("a control request has a 20-second whole-response bound, even when transport ignores abort", async () => {
  const f = fixture();
  let signal, resolve;
  const result = f.run(value => { signal = value; return new Promise(done => { resolve = done; }); });
  assert.equal(f.timers.get(1).ms, 20_000);
  const failed = assert.rejects(result, /REQUEST_TIMEOUT/);
  f.timers.get(1).fn();
  await failed;
  assert.equal(signal.aborted, true);
  assert.deepEqual(f.cleared, [1]);
  resolve("late acknowledgement");
});
test("success clears the deadline; caller abort is forwarded and already-aborted requests never run", async () => {
  const f = fixture(), source = new AbortController();
  assert.equal(await f.run(async () => "ok", source.signal), "ok");
  assert.deepEqual(f.cleared, [1]);
  let called = 0;
  const pending = f.run(() => { called++; return new Promise(() => {}); }, source.signal);
  const rejected = assert.rejects(pending, /REQUEST_ABORTED/);
  source.abort(); await rejected;
  await assert.rejects(f.run(() => { called++; return Promise.resolve("bad"); }, source.signal), /REQUEST_ABORTED/);
  assert.equal(called, 1);
});

test("source exclusion uses the actual JSON API contract and a bounded authenticated control request", async () => {
  const f = fixture(), calls = [], api = {};
  const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/api.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = {
    "./offline-access": { authenticationGeneration: () => 1, notifyAuthenticationFailure: () => {} },
    "./server-session": { serverSession: () => ({ status: "online", userId: "synthetic-owner" }), observeSessionResponse: () => {} },
    "./archive-task-state": {},
    "./upload-transport": {},
    "./request-deadline": { withRequestDeadline: f.run },
  };
  new Function("exports", "require", "fetch", compiled)(api, name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected API dependency ${name}`);
    return dependencies[name];
  }, async (path, init) => {
    calls.push({ path, init });
    return new Response(JSON.stringify({ import_id: "synthetic-import", state: "ANALYZING" }), { status: 202 });
  });
  const result = await api.excludeAdaptiveImportSource("synthetic-import", "synthetic-source", "2026-11-10T00:00:00Z");
  assert.equal(result.state, "ANALYZING");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/adaptive-import/sessions/synthetic-import/artifacts/synthetic-source");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].init.body), { expected_updated_at: "2026-11-10T00:00:00Z" });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(f.timers.get(1).ms, 20_000);
  assert.deepEqual(f.cleared, [1]);
});
