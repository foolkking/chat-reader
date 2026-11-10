import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = ts.createSourceFile("offline-db.ts", readFileSync(new URL("../../apps/web/lib/offline-db.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "readOfflineArchiveBounded");
assert.ok(declaration);
const deadline = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/request-deadline.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const readCode = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const drain = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let next = 0;
  const timers = new Map(), exports = {};
  new Function("exports", "setTimeout", "clearTimeout", deadline)(exports, (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; }, id => timers.delete(id));
  class ImportError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const read = new Function("withRequestDeadline", "MAX_OFFLINE_ARCHIVE_COMPRESSED_BYTES", "OfflinePackageImportError",
    readCode + "\nreturn readOfflineArchiveBounded;")(exports.withRequestDeadline, 16, ImportError);
  return { read, timers };
}
test("stalled body rejects at the inactivity deadline, cancels transport and releases reader", async () => {
  const f = fixture(); let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const failed = assert.rejects(f.read(new Response(body)), /REQUEST_TIMEOUT/);
  await drain();
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, 30_000);
  [...f.timers.values()][0].fn();
  await failed; await drain();
  assert.equal(cancelled, 1); assert.equal(body.locked, false); assert.equal(f.timers.size, 0);
});
test("each progressing chunk renews the inactivity deadline; no total time budget truncates a slow copy", async () => {
  const f = fixture(); let source;
  const body = new ReadableStream({ start(controller) { source = controller; } });
  const pending = f.read(new Response(body, { headers: { "content-length": "3" } }));
  await drain();
  let lastTimer = 0;
  for (const value of [1, 2, 3]) {
    const id = [...f.timers.keys()][0]; assert.ok(id > lastTimer); lastTimer = id;
    source.enqueue(Uint8Array.of(value)); await drain();
  }
  source.close();
  assert.deepEqual(await pending, Uint8Array.of(1, 2, 3));
  assert.equal(f.timers.size, 0); assert.equal(body.locked, false);
});
test("user cancellation interrupts a stalled body immediately without waiting for its next chunk", async () => {
  const f = fixture(), controller = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const pending = assert.rejects(f.read(new Response(body), controller.signal), /REQUEST_ABORTED/);
  await drain(); controller.abort(); await pending; await drain();
  assert.equal(cancelled, 1); assert.equal(body.locked, false); assert.equal(f.timers.size, 0);
});
test("length mismatch and expanded compressed budget remain honest errors", async () => {
  const f = fixture();
  await assert.rejects(f.read(new Response(Uint8Array.of(1), { headers: { "content-length": "2" } })), error => error.code === "MALFORMED");
  await assert.rejects(f.read(new Response(new Uint8Array(17))), error => error.code === "CAPACITY");
  await assert.rejects(f.read(new Response(null, { headers: { "content-length": "17" } })), error => error.code === "CAPACITY");
});
