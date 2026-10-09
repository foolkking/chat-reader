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
