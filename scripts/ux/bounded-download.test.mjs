import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript"), exports = {};
const compile = name => ts.transpileModule(readFileSync(new URL(`../../apps/web/lib/${name}.ts`, import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deadline = {};
new Function("exports", compile("request-deadline"))(deadline);
new Function("exports", "require", compile("bounded-download"))(exports, name => {
  assert.equal(name, "./request-deadline"); return deadline;
});
const { readBoundedDownload, DIRECT_DOWNLOAD_MAX_BYTES, DirectDownloadSizeError } = exports;
test("bounded download reports received bytes and refuses truncated success", async () => {
  const progress = [], signal = new AbortController().signal;
  const blob = await readBoundedDownload(new Response("synthetic", { headers: { "content-length": "9" } }), signal, (...value) => progress.push(value));
  assert.equal(await blob.text(), "synthetic");
  assert.deepEqual(progress.at(-1), [9, 9]);
  await assert.rejects(readBoundedDownload(new Response("short", { headers: { "content-length": "99" } }), signal, () => {}), /Incomplete/);
});
test("oversize declarations are cancelled without consuming a body", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": String(DIRECT_DOWNLOAD_MAX_BYTES + 1) } });
  await assert.rejects(readBoundedDownload(response, new AbortController().signal, () => {}), DirectDownloadSizeError);
  assert.equal(cancelled, true);
});
test("missing length is still bounded; cancel clears the reader rather than producing a download", async () => {
  let cancelled = false, sent = 0;
  const response = new Response(new ReadableStream({
    pull(controller) { sent++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readBoundedDownload(response, new AbortController().signal, () => {}), DirectDownloadSizeError);
  assert.equal(cancelled, true);
  assert.ok(sent <= 66);
  const abort = new AbortController();
  await assert.rejects(readBoundedDownload(new Response("synthetic"), abort.signal, () => abort.abort()), /abort/i);
});
test("compressed Content-Length is not treated as the decoded-body size", async () => {
  const blob = await readBoundedDownload(new Response("synthetic", { headers: { "content-length": "2", "content-encoding": "gzip" } }),
    new AbortController().signal, (_received, total) => assert.equal(total, null));
  assert.equal(blob.size, 9);
});
test("NX-EXPORT-01 synthetic transfer records actual retained memory and cancellation boundary", async () => {
  const before = process.memoryUsage(), started = performance.now();
  let chunks = 0;
  const body = new ReadableStream({ pull(controller) {
    if (chunks++ < 128) controller.enqueue(new Uint8Array(64 * 1024));
    else controller.close();
  } });
  const result = await readBoundedDownload(new Response(body), new AbortController().signal, () => {});
  assert.equal(result.size, 8 * 1024 * 1024);
  const after = process.memoryUsage();
  console.info(JSON.stringify({ fixture: "synthetic-bounded-download", bytes: result.size,
    transferMs: performance.now() - started, heapDelta: after.heapUsed - before.heapUsed,
    arrayBufferDelta: after.arrayBuffers - before.arrayBuffers, rss: after.rss }));
});

test("a stalled body times out without imposing a total duration on progressing chunks", async () => {
  let timer = 0, cancelled = 0;
  const timers = new Map(), controlledDeadline = {}, controlled = {};
  new Function("exports", "setTimeout", "clearTimeout", compile("request-deadline"))(
    controlledDeadline, (fn, ms) => { timers.set(++timer, { fn, ms }); return timer; }, id => timers.delete(id));
  new Function("exports", "require", compile("bounded-download"))(controlled, () => controlledDeadline);
  let writer;
  const body = new ReadableStream({ start(controller) { writer = controller; }, cancel() { cancelled++; } });
  const pending = assert.rejects(controlled.readBoundedDownload(new Response(body), new AbortController().signal, () => {}), /REQUEST_TIMEOUT/);
  const drain = () => new Promise(resolve => setImmediate(resolve));
  await drain();
  const first = [...timers.keys()][0];
  writer.enqueue(Uint8Array.of(1)); await drain();
  assert.ok([...timers.keys()][0] > first);
  assert.equal([...timers.values()][0].ms, 30_000);
  [...timers.values()][0].fn();
  await pending; await drain();
  assert.equal(cancelled, 1); assert.equal(body.locked, false); assert.equal(timers.size, 0);
});
