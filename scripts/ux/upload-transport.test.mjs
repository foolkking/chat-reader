import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url)), ts = require("typescript");
const source = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/upload-transport.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  let request, time = 0, count = 0;
  const timers = new Map(), api = {}, events = [];
  class TrackedTarget extends EventTarget {
    listeners = new Map();
    addEventListener(name, callback, options) { this.listeners.set(callback, name); super.addEventListener(name, callback, options); }
    removeEventListener(name, callback, options) { this.listeners.delete(callback); super.removeEventListener(name, callback, options); }
    sendEvent(name, values = {}) { const event = new Event(name); Object.assign(event, values); this.dispatchEvent(event); }
  }
  class XHR extends TrackedTarget {
    upload = new TrackedTarget(); status = 200; responseText = '{"import_id":"synthetic"}'; aborted = 0; sent = 0; headers = {};
    constructor() { super(); request = this; }
    open(...args) { this.opened = args; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.sent++; this.body = body; }
    abort() { this.aborted++; this.sendEvent("abort"); }
    getAllResponseHeaders() { return "Content-Type: application/json\r\nX-Synthetic: retained"; }
  }
  new Function("exports", "XMLHttpRequest", "setTimeout", "clearTimeout", source)(api, XHR,
    (run, delay) => { const id = ++count; timers.set(id, { run, at: time + delay }); return id; },
    id => timers.delete(id));
  const signal = new AbortController();
  const pending = api.sendUpload("/api/synthetic", new FormData(), { headers: { "Idempotency-Key": "synthetic" },
    signal: signal.signal, onProgress: event => events.push(event) });
  function advance(ms) {
    time += ms;
    for (const [id, value] of [...timers]) if (value.at <= time) { timers.delete(id); value.run(); }
  }
  return { request, pending, events, timers, signal, advance, elapsed: () => time };
}

test("slow uploads with byte progress continue beyond total deadlines, then independently wait for confirmation", async () => {
  const f = fixture();
  for (let i = 1; i <= 8; i++) {
    f.advance(110_000);
    f.request.upload.sendEvent("progress", { loaded: i, total: 8, lengthComputable: true });
  }
  assert.equal(f.elapsed(), 880_000); assert.equal(f.request.aborted, 0);
  f.request.upload.sendEvent("load"); f.advance(299_999);
  assert.deepEqual(f.events.at(-1), { stage: "confirming", percent: 100 });
  assert.equal(f.request.aborted, 0);
  f.request.sendEvent("load");
  const response = await f.pending;
  assert.equal(response.status, 200); assert.equal(response.headers.get("X-Synthetic"), "retained");
  assert.equal(f.request.sent, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.request.listeners.size + f.request.upload.listeners.size, 0);
});

for (const confirming of [false, true]) test(`${confirming ? "confirmation" : "upload"} inactivity stops only transport`, async () => {
  const f = fixture(), rejected = assert.rejects(f.pending, /UPLOAD_INACTIVE/);
  if (confirming) f.request.upload.sendEvent("load");
  f.advance(confirming ? 300_000 : 120_000); await rejected;
  assert.equal(f.request.aborted, 1); assert.equal(f.request.sent, 1);
  assert.equal(f.timers.size, 0); assert.equal(f.request.listeners.size + f.request.upload.listeners.size, 0);
});

test("duplicate progress events cannot extend a hung upload and progress renders only changed percentages", async () => {
  const f = fixture(), rejected = assert.rejects(f.pending, /UPLOAD_INACTIVE/);
  f.request.upload.sendEvent("progress", { loaded: 1, total: 1000, lengthComputable: true });
  f.advance(119_000);
  f.request.upload.sendEvent("progress", { loaded: 1, total: 1000, lengthComputable: true });
  f.advance(1000); await rejected;
  assert.equal(f.events.length, 2);
});

test("manual stop, network failure and late loads never produce a success or a second send", async () => {
  for (const failure of ["abort", "error"]) {
    const f = fixture(), rejected = assert.rejects(f.pending, /UPLOAD_STOPPED|CONNECTION_FAILED/);
    if (failure === "abort") f.signal.abort(); else f.request.sendEvent("error");
    await rejected; f.request.sendEvent("load");
    assert.equal(f.request.sent, 1); assert.equal(f.timers.size, 0);
    assert.equal(f.request.listeners.size + f.request.upload.listeners.size, 0);
  }
});

test("actual response byte progress extends only the confirmation inactivity window", async () => {
  const f = fixture();
  f.request.upload.sendEvent("load"); f.advance(299_000);
  f.request.sendEvent("progress", { loaded: 10 });
  f.advance(299_000); assert.equal(f.request.aborted, 0);
  f.request.sendEvent("load"); await f.pending;
});
