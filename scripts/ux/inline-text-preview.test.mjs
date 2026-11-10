import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compile = path => ts.transpileModule(readFileSync(new URL(`../../apps/web/${path}.ts`, import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function setup(fetch, timers) {
  const deadline = {}, output = {};
  new Function("exports", "setTimeout", "clearTimeout", compile("lib/request-deadline"))(
    deadline, timers?.set ?? setTimeout, timers?.clear ?? clearTimeout);
  new Function("exports", "require", "fetch", compile("features/attachments/inline-text-preview"))(
    output, () => deadline, fetch);
  return output;
}
const signal = () => new AbortController().signal;
test("inline prefix requests a range, retains original text and discloses partial content", async () => {
  const full = setup(async (_url, options) => {
    assert.equal(options.headers.Range, "bytes=0-131071");
    return new Response("中文 preview", { headers: { "content-length": "14" } });
  });
  assert.deepEqual(await full.readInlineTextPreview("/synthetic", signal()), { text: "中文 preview", limited: false });
  const partial = setup(async () => new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/999" } }));
  assert.deepEqual(await partial.readInlineTextPreview("/synthetic", signal()), { text: "abc", limited: true });
  const unknown = setup(async () => new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/*" } }));
  assert.equal((await unknown.readInlineTextPreview("/synthetic", signal())).limited, true);
});
test("a server ignoring Range cannot make an inline preview buffer the entire file", async () => {
  let reads = 0, cancels = 0;
  const module = setup(async () => new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new TextEncoder().encode("x".repeat(8192))); },
    cancel() { cancels++; },
  }), { headers: { "content-length": "999999999" } }));
  const result = await module.readInlineTextPreview("/synthetic", signal());
  assert.equal(result.text.length, module.INLINE_TEXT_BYTES); assert.equal(result.limited, true);
  assert.ok(reads <= 17); assert.equal(cancels, 1);
});
test("UTF-8 split across chunks decodes once; a boundary-cut code point is not invented", async () => {
  const bytes = new TextEncoder().encode("字");
  const module = setup(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("a".repeat(131070)));
    controller.enqueue(bytes.subarray(0, 1)); controller.enqueue(bytes.subarray(1)); controller.close();
  } })));
  const result = await module.readInlineTextPreview("/synthetic", signal());
  assert.equal(result.text, "a".repeat(131070)); assert.equal(result.limited, true);
  const short = setup(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, 1)); controller.enqueue(bytes.subarray(1)); controller.close();
  } })));
  assert.deepEqual(await short.readInlineTextPreview("/synthetic", signal()), { text: "字", limited: false });
});
test("bad ranges, denied responses and truncated bodies fail rather than implying usable data", async () => {
  for (const [body, init] of [
    ["abc", { status: 206, headers: { "content-range": "bytes 1-3/10" } }],
    ["abc", { status: 206, headers: { "content-range": "bytes 0-2/1" } }],
    ["abc", { status: 206, headers: { "content-range": "bytes 0-2/10", "content-encoding": "gzip" } }],
    ["abc", { status: 403 }],
    ["abc", { headers: { "content-length": "9" } }],
    ["abcd", { status: 206, headers: { "content-range": "bytes 0-2/10" } }],
  ]) await assert.rejects(setup(async () => new Response(body, init)).readInlineTextPreview("/synthetic", signal()), /PREVIEW_/);
});
test("finite inactivity retires a stalled preview and a source abort cannot publish late data", async () => {
  let next = 0, cancelled = 0, stream;
  const timers = new Map();
  const module = setup(async () => new Response(new ReadableStream({
    start(controller) { stream = controller; }, cancel() { cancelled++; },
  })), { set: (fn, ms) => { timers.set(++next, { fn, ms }); return next; }, clear: id => timers.delete(id) });
  const drain = () => new Promise(resolve => setImmediate(resolve));
  const timed = assert.rejects(module.readInlineTextPreview("/synthetic", signal()), /REQUEST_TIMEOUT/);
  await drain(); const first = [...timers.keys()][0];
  stream.enqueue(Uint8Array.of(65)); await drain();
  assert.ok([...timers.keys()][0] > first); assert.equal([...timers.values()][0].ms, 30000);
  [...timers.values()][0].fn(); await timed; await drain();
  assert.equal(cancelled, 1); assert.equal(timers.size, 0);
  const controller = new AbortController();
  const aborted = assert.rejects(module.readInlineTextPreview("/synthetic", controller.signal), /ABORT|abort/i);
  await drain(); controller.abort(); await aborted; assert.equal(cancelled, 2);
});
