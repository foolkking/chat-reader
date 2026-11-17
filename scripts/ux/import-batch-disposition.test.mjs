import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const module = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../../apps/web/features/import/import-disposition-state.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function("exports", code)(module.exports);
const { dispositionOutcome, restoreDisposition } = module.exports;
for (const state of ["ANALYZING", "IMPORTING", "CANCELING", "READY"]) test(`${state}: accepted is not stopped`, () => {
  assert.equal(dispositionOutcome("discard", { state }), null);
});
for (const state of ["pending", "failed", "blocked"]) test(`${state}: cleanup is not discard completion`, () => {
  assert.equal(dispositionOutcome("discard", { state: "CANCELED", source_cleanup: { state } }), null);
});
test("retain and discard have different terminal requirements", () => {
  assert.equal(dispositionOutcome("retain", { state: "PAUSED" }), "stopped");
  assert.equal(dispositionOutcome("discard", { state: "PAUSED" }), null);
  assert.equal(dispositionOutcome("discard", { state: "CANCELED", source_cleanup: { state: "completed" } }), "discarded");
  assert.equal(dispositionOutcome("discard", { state: "COMPLETED" }), "completed");
});
test("reload changes pending into check-only and ignores invalid/other-account receipts", () => {
  const value = { action: "discard", state: "pending", operationId: "synthetic" };
  const storage = { getItem: key => key === "owner-A:batch" ? JSON.stringify(value) : null };
  assert.equal(restoreDisposition(storage, "owner-A:batch").state, "unknown");
  assert.equal(restoreDisposition(storage, "owner-B:batch"), null);
  assert.equal(restoreDisposition({ getItem: () => '{"action":"erase","operationId":"x","state":"pending"}' }, "x"), null);
  assert.equal(restoreDisposition({ getItem: () => { throw Error("unavailable"); } }, "x"), null);
});
