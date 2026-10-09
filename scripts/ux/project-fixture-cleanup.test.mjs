import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const source = readFileSync(new URL("../../apps/web/e2e/ux-recovery-followup.spec.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("ux-recovery-followup.spec.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["createArchivedProject", "removeArchivedProjectFixture"].includes(node.name?.text));
assert.equal(functions.length, 2);
const compiled = ts.transpileModule(functions.map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const expect = value => ({ toBe: expected => assert.equal(value, expected) });

// The actual E2E cleanup callbacks run against a transport double that enforces
// the existing archived-before-delete server rule. No API/SQL/browser executes.
function fixture(archived, createConversation = async () => { throw new Error("Unexpected fixture creation"); }) {
  const calls = [];
  const ok = value => ({ ok: () => value });
  const page = { request: {
    post: async path => { calls.push({ method: "POST", path }); return { status: () => 201, json: async () => ({ id: "synthetic-cleanup-project" }) }; },
    patch: async (path, { data }) => { calls.push({ method: "PATCH", path, data }); archived = data.is_archived; return ok(true); },
    delete: async path => { calls.push({ method: "DELETE", path }); return ok(path.startsWith("/api/conversations/") || archived); },
  } };
  const loaded = new Function("expect", "createConversation", `${compiled}\nreturn { createArchivedProject, removeArchivedProjectFixture };`)(expect, createConversation);
  return { page, calls, ...loaded };
}

for (const archived of [false, true]) {
  test(`synthetic project cleanup respects archived-before-delete after ${archived ? "an unchanged archive" : "a restore"}`, async () => {
    const f = fixture(archived);
    await f.removeArchivedProjectFixture(f.page, { project: { id: "synthetic-cleanup-project" }, conversation: { conversation: { id: "synthetic-cleanup-conversation" } } });
    assert.ok(f.calls.some(call => call.method === "DELETE" && call.path === "/api/projects/synthetic-cleanup-project"));
    if (!archived) {
      const archive = f.calls.findIndex(call => call.method === "PATCH" && call.data.is_archived === true);
      const remove = f.calls.findIndex(call => call.method === "DELETE" && call.path === "/api/projects/synthetic-cleanup-project");
      assert.ok(archive >= 0 && archive < remove);
    }
  });
}

test("fixture-creation failure cleans its newly created active project and preserves the original error", async () => {
  const original = new Error("Synthetic conversation-creation failure");
  const f = fixture(false, async () => { throw original; });
  await assert.rejects(f.createArchivedProject(f.page, "Synthetic partial project"), error => error === original);
  assert.ok(f.calls.some(call => call.method === "PATCH" && call.data.is_archived === true));
  assert.equal(f.calls.at(-1).path, "/api/projects/synthetic-cleanup-project");
});

const uploadSource = readFileSync(new URL("../../apps/web/e2e/attachment-upload-flow.spec.ts", import.meta.url), "utf8");
const uploadAst = ts.createSourceFile("attachment-upload-flow.spec.ts", uploadSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const uploadCleanup = uploadAst.statements.filter(node => ts.isFunctionDeclaration(node)
  && node.name?.text === "deleteConversation");
assert.equal(uploadCleanup.length, 1);
const uploadCompiled = ts.transpileModule(uploadCleanup[0].getText(uploadAst), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// Only the real helper is compiled. Requests and the existing HTTP-500 delay
// are explicit doubles; no network, browser, service or wall-clock sleep runs.
function uploadFixture(deleteOutcomes = [200], getOutcomes = [404]) {
  const calls = [];
  const delays = [];
  const request = Object.fromEntries([["delete", deleteOutcomes], ["get", getOutcomes]].map(([method, outcomes]) => [
    method,
    async path => {
      calls.push({ method: method.toUpperCase(), path });
      assert.ok(outcomes.length, `Unexpected ${method} request`);
      const outcome = outcomes.shift();
      if (typeof outcome !== "number") throw outcome;
      return { status: () => outcome, ok: () => outcome >= 200 && outcome < 300 };
    },
  ]));
  const deleteConversation = new Function("expect", "setTimeout", `${uploadCompiled}\nreturn deleteConversation;`)(
    expect,
    (resolve, milliseconds) => { delays.push(milliseconds); resolve(); },
  );
  return {
    calls,
    delays,
    cleanup: () => deleteConversation(request, "synthetic-cleanup-upload-conversation"),
  };
}

const cleanupRequest = method => ({ method, path: "/api/conversations/synthetic-cleanup-upload-conversation" });
const resetError = () => new Error("apiRequestContext.delete: read ECONNRESET");

for (const status of [200, 204]) {
  test(`upload cleanup accepts HTTP ${status} only with confirmed absence`, async () => {
    const f = uploadFixture([status]);
    await f.cleanup();
    assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("GET")]);
    assert.deepEqual(f.delays, []);
  });
}

for (const status of [200, 401, 403, 503]) {
  test(`upload cleanup rejects HTTP ${status} readback after a successful DELETE`, async () => {
    const f = uploadFixture([200], [status]);
    await assert.rejects(f.cleanup(), { name: "AssertionError" });
    assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("GET")]);
    assert.deepEqual(f.delays, []);
  });
}

test("upload cleanup does not reconcile a reset of the normal readback a second time", async () => {
  const original = new Error("apiRequestContext.get: read ECONNRESET");
  const f = uploadFixture([200], [original, 404]);
  await assert.rejects(f.cleanup(), error => error === original);
  assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("GET")]);
});

test("upload cleanup reconciles a lost DELETE response with one same-fixture GET, never another DELETE", async () => {
  const f = uploadFixture([resetError()]);
  await f.cleanup();
  assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("GET")]);
  assert.deepEqual(f.delays, []);
});

for (const status of [200, 401, 403, 503]) {
  test(`upload cleanup retains the original reset when readback returns HTTP ${status}`, async () => {
    const original = resetError();
    const f = uploadFixture([original], [status]);
    await assert.rejects(f.cleanup(), error => error === original);
    assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("GET")]);
    assert.deepEqual(f.delays, []);
  });
}

for (const message of ["apiRequestContext.get: read ECONNRESET", "readback unavailable"]) {
  test(`upload cleanup retains the original DELETE reset after failed readback: ${message}`, async () => {
    const original = resetError();
    const f = uploadFixture([original], [new Error(message)]);
    await assert.rejects(f.cleanup(), error => error === original);
    assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("GET")]);
    assert.deepEqual(f.delays, []);
  });
}

for (const original of [new Error("request timed out"), new Error("ECONNREFUSED"), new Error("NOT_ECONNRESET"), "ECONNRESET"]) {
  test(`upload cleanup does not swallow or read back an unrelated exception: ${String(original)}`, async () => {
    const f = uploadFixture([original]);
    await assert.rejects(f.cleanup(), error => error === original);
    assert.deepEqual(f.calls, [cleanupRequest("DELETE")]);
    assert.deepEqual(f.delays, []);
  });
}

test("upload cleanup retains its existing HTTP-500 retry schedule and final absence check", async () => {
  const f = uploadFixture([500, 500, 200]);
  await f.cleanup();
  assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("DELETE"), cleanupRequest("DELETE"), cleanupRequest("GET")]);
  assert.deepEqual(f.delays, [250, 250]);
});

test("upload cleanup retains the three-attempt HTTP-500 bound", async () => {
  const f = uploadFixture([500, 500, 500, 200]);
  await assert.rejects(f.cleanup(), /Conversation cleanup failed with HTTP 500/);
  assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("DELETE"), cleanupRequest("DELETE")]);
  assert.deepEqual(f.delays, [250, 250, 250]);
});

test("upload cleanup can confirm absence after HTTP 500 followed by a lost DELETE response", async () => {
  const f = uploadFixture([500, resetError()]);
  await f.cleanup();
  assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("DELETE"), cleanupRequest("GET")]);
  assert.deepEqual(f.delays, [250]);
});

for (const status of [401, 403, 404, 503]) {
  test(`upload cleanup keeps HTTP ${status} DELETE failures as failures without retry or readback`, async () => {
    const f = uploadFixture([status]);
    await assert.rejects(f.cleanup(), new RegExp(`Conversation cleanup failed with HTTP ${status}`));
    assert.deepEqual(f.calls, [cleanupRequest("DELETE")]);
    assert.deepEqual(f.delays, []);
  });
}

for (const outcome of [200, resetError()]) {
  test(`confirmed upload cleanup preserves the prior business assertion after ${typeof outcome === "number" ? "HTTP success" : "a lost response"}`, async () => {
    const original = new Error("Synthetic business assertion failed");
    const f = uploadFixture([outcome]);
    await assert.rejects((async () => {
      try {
        throw original;
      } finally {
        await f.cleanup();
      }
    })(), error => error === original);
    assert.deepEqual(f.calls, [cleanupRequest("DELETE"), cleanupRequest("GET")]);
  });
}
