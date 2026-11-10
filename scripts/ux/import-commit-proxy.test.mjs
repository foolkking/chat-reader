import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import test from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const code = ts.transpileModule(readFileSync(new URL("../../apps/web/pages/api/imports/[importId]/commit.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture({ error, aborted, status = 202 } = {}) {
  const calls = [], module = { exports: {} };
  const transport = (url, options, receive) => {
    const request = new EventEmitter();
    request.setTimeout = ms => { assert.equal(ms, 300000); };
    request.end = body => {
      calls.push({ url: String(url), options, body });
      queueMicrotask(() => {
        if (error) { request.emit("error", Object.assign(new Error("synthetic reset"), { code: "ECONNRESET" })); return; }
        const response = new EventEmitter();
        response.statusCode = status; response.headers = { "content-type": "application/json" };
        receive(response);
        if (aborted) { response.emit("aborted"); response.emit("error", new Error("synthetic incomplete response")); return; }
        response.emit("data", Buffer.from('{"status":"queued"}')); response.emit("end");
      });
    };
    return request;
  };
  new Function("require", "module", "exports", "console", code)(name => {
    if (name === "node:http" || name === "node:https") return { request: transport };
    if (name === "node:process") return { default: { env: { API_INTERNAL_URL: "http://127.0.0.1:8000" } } };
    throw Error(name);
  }, module, module.exports, { error() {} });
  return { calls, async run(body = "", method = "POST") {
    const request = new PassThrough(); request.method = method; request.query = { importId: "synthetic/id" };
    request.headers = { accept: "application/json", "content-type": "application/json", cookie: "synthetic=only", origin: "https://synthetic.invalid" };
    const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
      status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; }, send(value) { this.body = value; } };
    request.end(body);
    await module.exports.default(request, response);
    return response;
  } };
}
test("commit uses a fresh socket and forwards exact options and same-origin identity once", async () => {
  const f = fixture();
  const body = JSON.stringify({ duplicate_policy: "skip", project_id: "synthetic-project", create_archive_project: false, image_lane_width: 456 });
  assert.equal((await f.run(body)).statusCode, 202);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.options.agent, false);
  assert.equal(call.url, "http://127.0.0.1:8000/api/imports/synthetic%2Fid/commit");
  assert.equal(call.body.toString(), body);
  assert.deepEqual(call.options.headers, { accept: "application/json", "content-length": String(Buffer.byteLength(body)),
    "content-type": "application/json", cookie: "synthetic=only", origin: "https://synthetic.invalid" });
});
for (const mode of ["error", "aborted"]) test(`uncertain ${mode} settles as 502 without replaying the mutation`, async () => {
  const f = fixture({ [mode]: true });
  const result = await f.run("{}");
  assert.equal(result.statusCode, 502); assert.equal(f.calls.length, 1);
  assert.equal(result.headers["cache-control"], "no-store");
});
test("empty legacy commits and upstream validation errors retain the public contract", async () => {
  const f = fixture({ status: 422 }), result = await f.run();
  assert.equal(result.statusCode, 422);
  assert.equal(result.headers["x-chat-reader-proxy"], "import-commit-route");
  assert.equal(f.calls[0].body.length, 0);
});
test("oversize options and non-POST methods never reach upstream", async () => {
  const f = fixture();
  assert.equal((await f.run("x".repeat(16 * 1024 + 1))).statusCode, 413);
  assert.equal((await f.run("", "GET")).statusCode, 405);
  assert.equal(f.calls.length, 0);
});
