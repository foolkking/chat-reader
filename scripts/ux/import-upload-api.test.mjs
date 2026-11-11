import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url)), ts = require("typescript");
const compile = file => ts.transpileModule(readFileSync(new URL("../../apps/web/lib/" + file + ".ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture({ session = "verified", responseStatus = 201, payload = { import_id: "synthetic", state: "ANALYZING" } } = {}) {
  let generation = 1, release;
  const events = new EventTarget(), calls = [], observations = [], unauthorized = [], timers = new Map(), deadline = {}, api = {};
  new Function("exports", "setTimeout", "clearTimeout", compile("request-deadline"))(deadline,
    (fn, ms) => { timers.set(fn, ms); return fn; }, fn => timers.delete(fn));
  const dependencies = {
    "./offline-access": { authenticationGeneration: () => generation, AUTH_GENERATION_CHANGED_EVENT: "auth",
      notifyAuthenticationFailure: value => unauthorized.push(value) },
    "./server-session": { serverSession: () => ({ status: session, userId: "synthetic" }),
      observeSessionResponse: (...args) => observations.push(args) },
    "./archive-task-state": {}, "./request-deadline": deadline,
    "./upload-transport": { sendUpload: (path, body, options) => {
      calls.push({ path, body, options });
      return new Promise((resolve, reject) => {
        release = () => resolve(new Response(JSON.stringify(payload), { status: responseStatus }));
        options.signal.addEventListener("abort", () => reject(Error("UPLOAD_STOPPED")), { once: true });
      });
    } },
  };
  new Function("require", "exports", "fetch", "window", compile("api"))(name => {
    assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name];
  }, api, (path, init) => {
    calls.push({ path, init });
    return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify(payload), { status: responseStatus })); });
  }, events);
  return { api, calls, observations, unauthorized, timers,
    release: () => release(), change: () => { generation++; events.dispatchEvent(new Event("auth")); },
    expire: () => { for (const callback of [...timers.keys()]) callback(); } };
}

test("initial upload sends ordered original Files and options through the progress transport without a read deadline", async () => {
  const f = fixture(), files = [new File(["first"], "same.json"), new File(["second"], "same.json")];
  const progress = [], pending = f.api.createAdaptiveImportSession(files, "synthetic-profile", "synthetic-project",
    { requestId: "synthetic-key", onProgress: value => progress.push(value) });
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.length, 1);
  const { path, body, options } = f.calls[0];
  assert.equal(path, "/api/adaptive-import/sessions");
  assert.equal(options.headers["Idempotency-Key"], "synthetic-key");
  assert.equal(body.get("repair_profile_id"), "synthetic-profile");
  assert.equal(body.get("target_project_id"), "synthetic-project");
  assert.deepEqual(await Promise.all(body.getAll("files").map(file => file.text())), ["first", "second"]);
  options.onProgress({ stage: "confirming", percent: 100 });
  assert.equal(progress.length, 1);
  f.release(); assert.equal((await pending).state, "ANALYZING");
  assert.equal(f.observations.length, 1);
});

test("initial upload aborts on account changes and does not apply a late response to a new session", async () => {
  const f = fixture(), progress = [];
  const pending = f.api.createAdaptiveImportSession([], null, null, { requestId: "synthetic", onProgress: value => progress.push(value) });
  const rejected = assert.rejects(pending, /UPLOAD_STOPPED|Account changed/);
  f.change(); f.calls[0].options.onProgress({ stage: "uploading", percent: 90 }); f.release();
  await rejected; assert.deepEqual(progress, []); assert.deepEqual(f.observations, []);
  assert.equal(f.calls[0].options.signal.aborted, true);
});

for (const session of ["sign-in-required", "unavailable"]) test(`${session}: a paused server session does not send file bytes`, async () => {
  const f = fixture({ session });
  await assert.rejects(f.api.createAdaptiveImportSession([], null, null, { requestId: "synthetic" }));
  assert.equal(f.calls.length, 0);
});

for (const payload of [null, {}, { import_id: "synthetic" }]) test(`malformed successful upload body ${JSON.stringify(payload)} is not an acknowledgement`, async () => {
  const f = fixture({ payload }), pending = f.api.createAdaptiveImportSession([], null, null, { requestId: "synthetic" });
  f.release(); await assert.rejects(pending, /IMPORT_UPLOAD_RECEIPT_INVALID/);
});

test("upload error preserves structured server identity and notifies only its own authentication epoch", async () => {
  const f = fixture({ responseStatus: 409, payload: { detail: { code: "IMPORT_UPLOAD_REQUEST_PENDING", message: "Check original receipt" } } });
  const pending = f.api.createAdaptiveImportSession([], null, null, { requestId: "synthetic" });
  f.release();
  await assert.rejects(pending, error => error.status === 409 && error.code === "IMPORT_UPLOAD_REQUEST_PENDING");
  const denied = fixture({ responseStatus: 401 });
  const rejected = denied.api.createAdaptiveImportSession([], null, null, { requestId: "synthetic" });
  denied.release(); await assert.rejects(rejected, error => error.status === 401);
  assert.deepEqual(denied.unauthorized, [1]);
});

test("receipt lookup bounds the complete read, validates null and does not auto-submit", async () => {
  const f = fixture({ responseStatus: 200, payload: { receipt: null } }), pending = f.api.getAdaptiveUploadReceipt("synthetic");
  assert.deepEqual([...f.timers.values()], [20_000]);
  f.release(); assert.deepEqual(await pending, { receipt: null });
  assert.equal(f.timers.size, 0); assert.equal(f.calls[0].init.method, undefined);
  const stalled = f.api.getAdaptiveUploadReceipt("synthetic"), rejected = assert.rejects(stalled, /REQUEST_TIMEOUT/);
  f.expire(); await rejected;
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].init.signal.aborted, true);
});

test("receipt lookup suppresses wrong-generation and malformed results", async () => {
  for (const accountChanged of [true, false]) {
    const f = fixture({ responseStatus: 200, payload: accountChanged ? { receipt: null } : {} });
    const pending = f.api.getAdaptiveUploadReceipt("synthetic");
    if (accountChanged) f.change();
    f.release(); await assert.rejects(pending, /Account changed|IMPORT_UPLOAD_RECEIPT_INVALID/);
  }
});
